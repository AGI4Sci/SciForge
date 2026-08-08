import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  evidenceDagCommittedSnapshotSchema,
  evidenceDagTypedErrorSchema,
  type EvidenceDagCommittedSnapshot,
  type EvidenceDagPendingUpdate,
  type EvidenceDagTypedError
} from '../contract.js'
import {
  EvidenceDagServiceError,
  traceBatches,
  type EvidenceDagUpdateProgress,
  type EvidenceDagUpdateSubmission
} from './client.js'
import { laterEvidenceDagWatermark } from './watermark.js'

export type EvidenceDagQueuePriority = EvidenceDagUpdateSubmission['priority']

export type EvidenceDagQueueInput = Readonly<{
  runtimeId: string
  threadId: string
  engineThreadId: string
  targetWatermark: string
  reason: string
  priority: EvidenceDagQueuePriority
  trace: readonly Readonly<Record<string, unknown>>[]
  workspaceRoot: string
  rebuild?: boolean
  rebuildRationale?: string
}>

export type EvidenceDagQueueEnqueueResult = Readonly<{
  jobId: string
  coalesced: boolean
  itemCount: number
}>

type QueueJobStatus = 'queued' | 'running' | 'retrying' | 'failed' | 'succeeded'

type QueueJob = {
  id: string
  runtimeId: string
  threadId: string
  engineThreadId: string
  targetWatermark: string
  reason: string
  priority: EvidenceDagQueuePriority
  trace: Record<string, unknown>[]
  workspaceRoot: string
  rebuild?: boolean
  rebuildRationale?: string
  status: QueueJobStatus
  attempt: number
  createdAt: string
  updatedAt: string
  nextAttemptAt?: string
  error?: EvidenceDagTypedError
  snapshot?: EvidenceDagCommittedSnapshot
  completedBatches?: number
  totalBatches?: number
  consecutiveNoProgressFailures: number
}

type QueueFile = {
  version: 1
  jobs: QueueJob[]
}

const PRIORITY: Record<EvidenceDagQueuePriority, number> = {
  background: 0,
  normal: 1,
  high: 2,
  immediate: 3
}

const MAX_QUEUE_JOBS = 200
const ACTIVE_QUEUE_STATUSES = new Set<QueueJobStatus>(['queued', 'running', 'retrying'])
const ISO_TIMESTAMP_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u

class EvidenceDagQueuePersistenceError extends Error {
  constructor(cause: unknown) {
    super(
      `Failed to persist the Evidence DAG update queue: ${errorMessage(cause)}`,
      { cause }
    )
    this.name = 'EvidenceDagQueuePersistenceError'
  }
}

export class EvidenceDagQueue {
  private jobs: QueueJob[] = []
  private readonly active = new Set<string>()
  private loading: Promise<void> | undefined
  private enabled = false
  private closed = false
  private pumpTimer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly options: Readonly<{
    storagePath: string
    submit: (
      input: EvidenceDagUpdateSubmission,
      reportActivity: (progress: EvidenceDagUpdateProgress) => Promise<void>
    ) => Promise<EvidenceDagCommittedSnapshot>
    now?: () => Date
    maxAttempts?: number
    maxConcurrency?: number
    retryBaseMs?: number
    canRunBackground?: () => boolean
  }>) {}

  async start(enabled: boolean): Promise<void> {
    await this.load()
    this.enabled = enabled
    this.schedulePump(0)
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.load()
    this.enabled = enabled
    if (enabled) this.schedulePump(0)
  }

  async enqueue(input: EvidenceDagQueueInput): Promise<EvidenceDagQueueEnqueueResult> {
    await this.load()
    if (!input.trace.length) throw new Error('Evidence DAG update requires at least one artifact.')
    const result = await this.mutateJobs((jobs) => {
      const latest = jobs
        .filter((job) => job.engineThreadId === input.engineThreadId)
        .sort(compareNewestJob)[0]
      const existing = latest && (
        latest.status === 'queued' ||
        latest.status === 'retrying' ||
        (latest.status === 'failed' && input.priority === 'immediate')
      )
        ? latest
        : undefined
      if (existing) {
        const revivingFailed = existing.status === 'failed'
        if (revivingFailed) requireActiveCapacity(jobs)
        if (existing.workspaceRoot !== input.workspaceRoot) {
          throw new Error('Cannot coalesce Evidence DAG updates from different workspaces.')
        }
        const mergedTrace = mergeTrace(existing.trace, input.trace)
        const completedBatches = existing.completedBatches
        const previousBatches = traceBatches(existing.trace)
        const mergedBatches = traceBatches(mergedTrace)
        const sharedCommittedPrefix = completedBatches === undefined
          ? 0
          : commonBatchPrefix(previousBatches, mergedBatches, completedBatches)
        const cursorIntentMatches =
          existing.targetWatermark === input.targetWatermark &&
          existing.reason === input.reason &&
          Boolean(existing.rebuild) === Boolean(input.rebuild) &&
          existing.rebuildRationale === input.rebuildRationale
        existing.targetWatermark = laterEvidenceDagWatermark(
          existing.targetWatermark,
          input.targetWatermark
        )
        existing.trace = mergedTrace
        existing.reason = input.reason
        if (revivingFailed) {
          if (input.rebuild) existing.rebuild = true
          else delete existing.rebuild
          if (input.rebuildRationale) existing.rebuildRationale = input.rebuildRationale
          else delete existing.rebuildRationale
        } else {
          existing.rebuild = input.rebuild || existing.rebuild
          existing.rebuildRationale = input.rebuildRationale ?? existing.rebuildRationale
        }
        if (PRIORITY[input.priority] > PRIORITY[existing.priority]) {
          existing.priority = input.priority
        }
        existing.status = 'queued'
        existing.nextAttemptAt = undefined
        existing.error = undefined
        if (revivingFailed) existing.consecutiveNoProgressFailures = 0
        if (cursorIntentMatches && sharedCommittedPrefix > 0) {
          existing.completedBatches = sharedCommittedPrefix
          existing.totalBatches = mergedBatches.length
        } else {
          existing.completedBatches = undefined
          existing.totalBatches = undefined
          existing.consecutiveNoProgressFailures = 0
        }
        existing.updatedAt = this.nowIso()
        return {
          changed: true,
          value: { jobId: existing.id, coalesced: true, itemCount: existing.trace.length }
        }
      }

      requireActiveCapacity(jobs)
      const timestamp = this.nowIso()
      const job: QueueJob = {
        id: randomUUID(),
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        engineThreadId: input.engineThreadId,
        targetWatermark: input.targetWatermark,
        reason: input.reason,
        priority: input.priority,
        trace: input.trace.map((item) => structuredClone(item) as Record<string, unknown>),
        workspaceRoot: input.workspaceRoot,
        ...(input.rebuild ? { rebuild: true } : {}),
        ...(input.rebuildRationale ? { rebuildRationale: input.rebuildRationale } : {}),
        status: 'queued',
        attempt: 0,
        consecutiveNoProgressFailures: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      jobs.push(job)
      return {
        changed: true,
        value: { jobId: job.id, coalesced: false, itemCount: job.trace.length }
      }
    })
    this.schedulePump(0)
    return result
  }

  async pending(runtimeId: string, threadId: string): Promise<EvidenceDagPendingUpdate | null> {
    await this.load()
    const latest = this.jobs
      .filter((job) => job.runtimeId === runtimeId && job.threadId === threadId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.updatedAt.localeCompare(left.updatedAt)
      )[0]
    if (!latest || latest.status === 'succeeded') return null
    const base = {
      jobId: latest.id,
      targetWatermark: latest.targetWatermark,
      attempt: latest.attempt,
      createdAt: latest.createdAt,
      updatedAt: latest.updatedAt,
      ...(latest.completedBatches !== undefined ? {
        completedBatches: latest.completedBatches
      } : {}),
      ...(latest.totalBatches !== undefined ? {
        totalBatches: latest.totalBatches
      } : {})
    }
    if (latest.status === 'running') {
      return { ...base, state: 'running', phase: 'extracting' }
    }
    if (latest.status === 'retrying' && latest.nextAttemptAt && latest.error) {
      return {
        ...base,
        state: 'retrying',
        nextAttemptAt: latest.nextAttemptAt,
        error: latest.error
      }
    }
    if (latest.status === 'failed' && latest.error) {
      return { ...base, state: 'failed', error: latest.error }
    }
    return { ...base, state: 'queued' }
  }

  async committed(
    runtimeId: string,
    threadId: string
  ): Promise<EvidenceDagCommittedSnapshot | null> {
    await this.load()
    return this.jobs
      .filter((job) =>
        job.runtimeId === runtimeId &&
        job.threadId === threadId &&
        job.snapshot
      )
      .sort((left, right) =>
        right.snapshot!.version - left.snapshot!.version ||
        right.updatedAt.localeCompare(left.updatedAt)
      )[0]?.snapshot ?? null
  }

  async waitForCommitted(
    jobId: string,
    timeoutMs = 600_000
  ): Promise<EvidenceDagCommittedSnapshot> {
    await this.load()
    const deadline = Date.now() + timeoutMs
    while (!this.closed && Date.now() < deadline) {
      const job = this.jobs.find((candidate) => candidate.id === jobId)
      if (!job) throw new Error(`Evidence DAG queue job ${jobId} was not found.`)
      if (job.status === 'succeeded' && job.snapshot) return job.snapshot
      if (job.status === 'failed' && job.error) throw new EvidenceDagServiceError(job.error)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new EvidenceDagServiceError(evidenceDagTypedErrorSchema.parse({
      code: 'upstream_timeout',
      message: 'Timed out waiting for the Evidence DAG committed snapshot.',
      retryable: true,
      occurredAt: this.nowIso()
    }))
  }

  async prioritize(runtimeId: string, threadId: string, visible: boolean): Promise<void> {
    await this.load()
    const wanted: EvidenceDagQueuePriority = visible ? 'immediate' : 'background'
    await this.mutateJobs((jobs) => {
      let changed = false
      for (const job of jobs) {
        if (job.runtimeId !== runtimeId || job.threadId !== threadId ||
            (job.status !== 'queued' && job.status !== 'retrying')) continue
        if (visible ? PRIORITY[job.priority] < PRIORITY[wanted] : job.priority === 'immediate') {
          job.priority = wanted
          job.updatedAt = this.nowIso()
          changed = true
        }
      }
      return { changed, value: undefined }
    })
    this.schedulePump(0)
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.pumpTimer) clearTimeout(this.pumpTimer)
    this.pumpTimer = undefined
    await this.writing
  }

  private load(): Promise<void> {
    this.loading ??= this.loadFromDisk()
    return this.loading
  }

  private async loadFromDisk(): Promise<void> {
    await this.ensureStorageDirectory()
    try {
      const contents = await readFile(this.options.storagePath, 'utf8')
      await chmod(this.options.storagePath, 0o600)
      const parsed: unknown = JSON.parse(contents)
      const loaded = parseQueueFile(parsed)
      let recovered = loaded.recovered
      for (const job of loaded.jobs) {
        if (job.status !== 'running') continue
        job.status = 'queued'
        job.updatedAt = this.nowIso()
        recovered = true
      }
      const compacted = compactQueueJobs(loaded.jobs)
      recovered ||= compacted.length !== loaded.jobs.length
      if (recovered) await this.writeQueueFile(compacted)
      this.jobs = compacted
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
      this.jobs = []
    }
  }

  private schedulePump(delayMs: number): void {
    if (this.closed || !this.enabled || this.pumpTimer) return
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = undefined
      void this.pump()
    }, delayMs)
  }

  private async pump(): Promise<void> {
    if (this.closed || !this.enabled) return
    const canRunBackground = this.options.canRunBackground?.() !== false
    const maxConcurrency = this.options.maxConcurrency ?? 1
    while (this.active.size < maxConcurrency) {
      const now = this.nowIso()
      const activeThreads = new Set(this.jobs
        .filter((job) => this.active.has(job.id))
        .map((job) => job.engineThreadId))
      const job = this.jobs
        .filter((candidate) =>
          !activeThreads.has(candidate.engineThreadId) &&
          (candidate.priority !== 'background' || canRunBackground) &&
          (candidate.status === 'queued' ||
            (candidate.status === 'retrying' && candidate.nextAttemptAt! <= now))
        )
        .sort((left, right) =>
          PRIORITY[right.priority] - PRIORITY[left.priority] ||
          left.createdAt.localeCompare(right.createdAt)
        )[0]
      if (!job) break
      this.active.add(job.id)
      void this.run(job.id).catch(() => undefined).finally(() => {
        this.active.delete(job.id)
        this.schedulePump(0)
      })
    }
    if (this.active.size === 0 && !canRunBackground && this.jobs.some((job) =>
      job.priority === 'background' &&
      (job.status === 'queued' || job.status === 'retrying')
    )) {
      this.schedulePump(500)
    }
    const nextRetry = this.jobs
      .filter((job) =>
        job.status === 'retrying' &&
        job.nextAttemptAt &&
        (job.priority !== 'background' || canRunBackground)
      )
      .sort((left, right) => left.nextAttemptAt!.localeCompare(right.nextAttemptAt!))[0]
    if (nextRetry) {
      this.schedulePump(Math.max(0, Date.parse(nextRetry.nextAttemptAt!) - this.now().getTime()))
    }
  }

  private async run(jobId: string): Promise<void> {
    const started = await this.mutateJobs((jobs) => {
      const job = requireQueueJob(jobs, jobId)
      if (
        job.snapshot &&
        job.completedBatches !== undefined &&
        job.totalBatches !== undefined &&
        job.completedBatches === job.totalBatches
      ) {
        job.status = 'succeeded'
        job.consecutiveNoProgressFailures = 0
        job.updatedAt = this.nowIso()
        return { changed: true, value: null }
      }
      job.status = 'running'
      job.attempt += 1
      job.updatedAt = this.nowIso()
      job.nextAttemptAt = undefined
      job.error = undefined
      return {
        changed: true,
        value: {
          jobId: job.id,
          engineThreadId: job.engineThreadId,
          targetWatermark: job.targetWatermark,
          reason: job.reason,
          priority: job.priority,
          trace: job.trace,
          workspaceRoot: job.workspaceRoot,
          ...(job.rebuild ? { rebuild: true as const } : {}),
          ...(job.rebuildRationale ? { rebuildRationale: job.rebuildRationale } : {}),
          ...(job.completedBatches ? { resumeAfterBatch: job.completedBatches } : {})
        } satisfies EvidenceDagUpdateSubmission
      }
    })
    if (!started) return

    let snapshot: EvidenceDagCommittedSnapshot
    try {
      snapshot = await this.options.submit(
        started,
        async (progress) => {
          await this.mutateJobs((jobs) => {
            const job = requireQueueJob(jobs, jobId)
            if (job.status !== 'running') return { changed: false, value: undefined }
            job.completedBatches = progress.completedBatches
            job.totalBatches = progress.totalBatches
            job.snapshot = progress.snapshot
            job.consecutiveNoProgressFailures = 0
            job.updatedAt = this.nowIso()
            return { changed: true, value: undefined }
          })
        }
      )
    } catch (error) {
      if (error instanceof EvidenceDagQueuePersistenceError) throw error
      const diagnostic = error instanceof EvidenceDagServiceError
        ? error.diagnostic
        : evidenceDagTypedErrorSchema.parse({
            code: 'internal_error',
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
            occurredAt: this.nowIso()
          })
      await this.mutateJobs((jobs) => {
        const job = requireQueueJob(jobs, jobId)
        job.error = diagnostic
        job.consecutiveNoProgressFailures += 1
        job.updatedAt = this.nowIso()
        if (
          diagnostic.retryable &&
          job.consecutiveNoProgressFailures < (this.options.maxAttempts ?? 5)
        ) {
          const delay = (this.options.retryBaseMs ?? 1_000) *
            2 ** (job.consecutiveNoProgressFailures - 1)
          job.status = 'retrying'
          job.nextAttemptAt = new Date(this.now().getTime() + delay).toISOString()
        } else {
          job.status = 'failed'
          job.nextAttemptAt = undefined
        }
        return { changed: true, value: undefined }
      })
      return
    }

    await this.mutateJobs((jobs) => {
      const job = requireQueueJob(jobs, jobId)
      job.snapshot = snapshot
      job.status = 'succeeded'
      job.consecutiveNoProgressFailures = 0
      job.updatedAt = this.nowIso()
      return { changed: true, value: undefined }
    })
  }

  private mutateJobs<T>(
    transform: (jobs: QueueJob[]) => Readonly<{ changed: boolean; value: T }>
  ): Promise<T> {
    const pending = this.writing.then(async () => {
      const candidate = structuredClone(this.jobs) as QueueJob[]
      const result = transform(candidate)
      if (!result.changed) return result.value
      const compacted = compactQueueJobs(candidate)
      await this.writeQueueFile(compacted)
      this.jobs = compacted
      return result.value
    })
    this.writing = pending.then(() => undefined, () => undefined)
    return pending
  }

  private async ensureStorageDirectory(): Promise<void> {
    const directory = dirname(this.options.storagePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
  }

  private async writeQueueFile(jobs: QueueJob[]): Promise<void> {
    const directory = dirname(this.options.storagePath)
    const temporaryPath = `${this.options.storagePath}.${process.pid}.${randomUUID()}.tmp`
    let temporaryHandle: Awaited<ReturnType<typeof open>> | undefined
    try {
      const file: QueueFile = { version: 1, jobs }
      const contents = `${JSON.stringify(file, null, 2)}\n`
      await this.ensureStorageDirectory()
      temporaryHandle = await open(temporaryPath, 'wx', 0o600)
      await temporaryHandle.chmod(0o600)
      await temporaryHandle.writeFile(contents, 'utf8')
      await temporaryHandle.sync()
      await temporaryHandle.close()
      temporaryHandle = undefined
      await rename(temporaryPath, this.options.storagePath)
      if (process.platform !== 'win32') {
        const directoryHandle = await open(directory, 'r')
        try {
          await directoryHandle.sync()
        } finally {
          await directoryHandle.close()
        }
      }
    } catch (error) {
      throw new EvidenceDagQueuePersistenceError(error)
    } finally {
      await temporaryHandle?.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
    }
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))()
  }

  private nowIso(): string {
    return this.now().toISOString()
  }
}

const QUEUE_FILE_KEYS = new Set(['version', 'jobs'])
const QUEUE_JOB_KEYS = new Set([
  'id',
  'runtimeId',
  'threadId',
  'engineThreadId',
  'targetWatermark',
  'reason',
  'priority',
  'trace',
  'workspaceRoot',
  'rebuild',
  'rebuildRationale',
  'status',
  'attempt',
  'attempts',
  'consecutiveNoProgressFailures',
  'createdAt',
  'updatedAt',
  'nextAttemptAt',
  'error',
  'lastError',
  'snapshot',
  'completedBatches',
  'totalBatches',
  'phase'
])

function parseQueueFile(value: unknown): Readonly<{
  jobs: QueueJob[]
  recovered: boolean
}> {
  const file = record(value)
  if (!file || !hasOnlyKeys(file, QUEUE_FILE_KEYS) || !Array.isArray(file.jobs)) {
    throw new Error('Evidence DAG update queue storage has an invalid root object.')
  }
  if (file.version !== 1 && file.version !== 2) {
    throw new Error('Evidence DAG update queue storage has an unsupported version.')
  }

  const jobs: QueueJob[] = []
  const jobIds = new Set<string>()
  let recovered = file.version !== 1
  for (const [index, value] of file.jobs.entries()) {
    const stored = record(value)
    if (!stored) throw invalidStoredJob(index)
    const phase = stored.phase === undefined ? undefined : stringValue(stored.phase)
    if (phase === 'project') {
      recovered = true
      continue
    }
    if (
      (stored.phase !== undefined && phase === undefined) ||
      (phase !== undefined && phase !== 'evidence') ||
      !hasOnlyKeys(stored, QUEUE_JOB_KEYS)
    ) {
      throw invalidStoredJob(index)
    }
    const job = canonicalJob(stored)
    if (!job || jobIds.has(job.id)) throw invalidStoredJob(index)
    jobIds.add(job.id)
    if (!isDeepStrictEqual(job, stored)) recovered = true
    jobs.push(job)
  }
  return { jobs, recovered }
}

function canonicalJob(job: Record<string, unknown>): QueueJob | null {
  const id = stringValue(job.id)
  const runtimeId = stringValue(job.runtimeId)
  const threadId = stringValue(job.threadId)
  const engineThreadId = stringValue(job.engineThreadId)
  const targetWatermark = stringValue(job.targetWatermark)
  const workspaceRoot = stringValue(job.workspaceRoot)
  const createdAt = validTimestamp(job.createdAt)
  const updatedAt = validTimestamp(job.updatedAt)
  const reason = job.reason === undefined ? 'recovery' : stringValue(job.reason)
  const trace = Array.isArray(job.trace) && job.trace.every((item) => record(item) !== null)
    ? job.trace.map((item) => structuredClone(item) as Record<string, unknown>)
    : []
  if (!id || !runtimeId || !threadId || !engineThreadId || !targetWatermark || !workspaceRoot ||
      !reason || !createdAt || !updatedAt || !trace.length) return null
  const status = canonicalQueueStatus(job.status)
  if (!status) return null
  const priority = canonicalQueuePriority(job.priority)
  if (!priority) return null
  const parsedError = job.error === undefined
    ? undefined
    : evidenceDagTypedErrorSchema.safeParse(job.error)
  if (parsedError && !parsedError.success) return null
  const legacyError = job.lastError === undefined ? undefined : stringValue(job.lastError)
  if (job.lastError !== undefined && !legacyError) return null
  const error = parsedError?.success
    ? parsedError.data
    : legacyError
      ? evidenceDagTypedErrorSchema.parse({
          code: 'internal_error',
          message: legacyError.slice(0, 4_000),
          retryable: false,
          occurredAt: updatedAt
        })
      : undefined
  const snapshot = job.snapshot === undefined ? undefined : canonicalStoredSnapshot(job.snapshot)
  if (job.snapshot !== undefined && !snapshot) return null
  const attempt = storedNonnegativeInteger(job.attempt, job.attempts)
  const consecutiveNoProgressFailures = job.consecutiveNoProgressFailures === undefined
    ? 0
    : nonnegativeInteger(job.consecutiveNoProgressFailures)
  const nextAttemptAt = job.nextAttemptAt === undefined
    ? undefined
    : validTimestamp(job.nextAttemptAt)
  const completedBatches = job.completedBatches === undefined
    ? undefined
    : nonnegativeInteger(job.completedBatches)
  const totalBatches = job.totalBatches === undefined
    ? undefined
    : positiveInteger(job.totalBatches)
  const rebuildRationale = job.rebuildRationale === undefined
    ? undefined
    : stringValue(job.rebuildRationale)
  if (
    attempt === undefined ||
    consecutiveNoProgressFailures === undefined ||
    (job.nextAttemptAt !== undefined && !nextAttemptAt) ||
    (job.completedBatches !== undefined && completedBatches === undefined) ||
    (job.totalBatches !== undefined && totalBatches === undefined) ||
    (completedBatches !== undefined && totalBatches !== undefined && completedBatches > totalBatches) ||
    (job.rebuild !== undefined && typeof job.rebuild !== 'boolean') ||
    (job.rebuildRationale !== undefined && !rebuildRationale) ||
    (status === 'retrying' && (!nextAttemptAt || !error)) ||
    (status === 'failed' && !error) ||
    (status === 'succeeded' && !snapshot)
  ) return null
  return {
    id,
    runtimeId,
    threadId,
    engineThreadId,
    targetWatermark,
    reason,
    priority,
    trace,
    workspaceRoot,
    ...(job.rebuild === true ? { rebuild: true } : {}),
    ...(rebuildRationale ? { rebuildRationale } : {}),
    status,
    attempt,
    consecutiveNoProgressFailures,
    createdAt,
    updatedAt,
    ...(nextAttemptAt ? { nextAttemptAt } : {}),
    ...(error ? { error } : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(completedBatches !== undefined ? { completedBatches } : {}),
    ...(totalBatches !== undefined ? { totalBatches } : {})
  }
}

function storedNonnegativeInteger(primary: unknown, legacy: unknown): number | undefined {
  if (primary !== undefined) return nonnegativeInteger(primary)
  if (legacy !== undefined) return nonnegativeInteger(legacy)
  return 0
}

function canonicalQueueStatus(value: unknown): QueueJobStatus | undefined {
  if (value === undefined) return 'queued'
  const status = stringValue(value)
  if (status === 'retry_scheduled') return 'retrying'
  return status === 'queued' || status === 'running' || status === 'retrying' ||
    status === 'failed' || status === 'succeeded'
    ? status
    : undefined
}

function canonicalQueuePriority(value: unknown): EvidenceDagQueuePriority | undefined {
  if (value === undefined) return 'normal'
  const priority = stringValue(value)
  return priority === 'background' || priority === 'normal' || priority === 'high' ||
    priority === 'immediate'
    ? priority
    : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined
}

function nonnegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function canonicalStoredSnapshot(value: unknown): EvidenceDagCommittedSnapshot | null {
  const parsed = evidenceDagCommittedSnapshotSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function compactQueueJobs(jobs: QueueJob[]): QueueJob[] {
  const overflow = jobs.length - MAX_QUEUE_JOBS
  if (overflow <= 0) return jobs
  const oldestTerminalIds = new Set(jobs
    .filter((job) => !ACTIVE_QUEUE_STATUSES.has(job.status))
    .sort(compareOldestJob)
    .slice(0, overflow)
    .map((job) => job.id))
  if (!oldestTerminalIds.size) return jobs
  return jobs.filter((job) => !oldestTerminalIds.has(job.id))
}

function requireActiveCapacity(jobs: readonly QueueJob[]): void {
  const activeJobs = jobs.filter((job) => ACTIVE_QUEUE_STATUSES.has(job.status)).length
  if (activeJobs < MAX_QUEUE_JOBS) return
  throw new Error(
    `Evidence DAG update queue is at capacity with ${activeJobs} active jobs; enqueue was rejected.`
  )
}

function requireQueueJob(jobs: QueueJob[], jobId: string): QueueJob {
  const job = jobs.find((candidate) => candidate.id === jobId)
  if (!job) throw new Error(`Evidence DAG queue job ${jobId} was not found.`)
  return job
}

function compareNewestJob(left: QueueJob, right: QueueJob): number {
  return right.createdAt.localeCompare(left.createdAt) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.id.localeCompare(left.id)
}

function compareOldestJob(left: QueueJob, right: QueueJob): number {
  return left.createdAt.localeCompare(right.createdAt) ||
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.id.localeCompare(right.id)
}

function mergeTrace(
  left: readonly Record<string, unknown>[],
  right: readonly Readonly<Record<string, unknown>>[]
): Record<string, unknown>[] {
  const values = new Map<string, Record<string, unknown>>()
  for (const [index, item] of [...left, ...right].entries()) {
    const copy = structuredClone(item) as Record<string, unknown>
    const id = stringValue(copy.id) ?? `trace-${index}:${JSON.stringify(copy).slice(0, 128)}`
    values.set(id, copy)
  }
  return [...values.values()]
}

function commonBatchPrefix(
  previous: readonly (readonly Record<string, unknown>[])[],
  next: readonly (readonly Record<string, unknown>[])[],
  committedBatches: number
): number {
  const limit = Math.min(committedBatches, previous.length, next.length)
  let matched = 0
  while (matched < limit && isDeepStrictEqual(previous[matched], next[matched])) {
    matched += 1
  }
  return matched
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function invalidStoredJob(index: number): Error {
  return new Error(`Evidence DAG update queue storage has an invalid job at index ${index}.`)
}

function hasErrorCode(value: unknown, code: string): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'code' in value &&
    String(value.code) === code
  )
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function validTimestamp(value: unknown): string | undefined {
  const timestamp = stringValue(value)
  const match = timestamp ? ISO_TIMESTAMP_WITH_OFFSET.exec(timestamp) : null
  if (!timestamp || !match) return undefined
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
    return undefined
  }
  if (offset !== 'Z') {
    const [offsetHour, offsetMinute] = offset.slice(1).split(':').map(Number)
    if (offsetHour! > 23 || offsetMinute! > 59) return undefined
  }
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : undefined
}
