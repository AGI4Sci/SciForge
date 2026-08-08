import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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

export type EvidenceDagQueuePriority = EvidenceDagUpdateSubmission['priority']

export type EvidenceDagQueueInput = Readonly<{
  idempotencyKey?: string
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
  idempotencyKey?: string
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

export class EvidenceDagQueue {
  private jobs: QueueJob[] = []
  private readonly active = new Set<string>()
  private loaded = false
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
    if (input.idempotencyKey) {
      const replay = this.jobs.find((job) => job.idempotencyKey === input.idempotencyKey)
      if (replay) {
        return { jobId: replay.id, coalesced: true, itemCount: replay.trace.length }
      }
    }
    const matching = this.jobs
      .filter((job) => job.engineThreadId === input.engineThreadId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.updatedAt.localeCompare(left.updatedAt)
      )
    const latest = input.priority === 'immediate'
      ? matching.find((job) =>
          job.status === 'failed' && isArtifactLifecycleJob(job)
        ) ?? matching[0]
      : matching[0]
    const existing = !input.idempotencyKey && latest && (
      latest.status === 'queued' ||
      latest.status === 'retrying' ||
      (latest.status === 'failed' && input.priority === 'immediate')
    )
      ? latest
      : undefined
    if (existing) {
      const revivingFailed = existing.status === 'failed'
      const revivingArtifactLifecycle = revivingFailed && isArtifactLifecycleJob(existing)
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
      existing.targetWatermark = revivingArtifactLifecycle
        ? artifactLifecycleRetryWatermark(input.targetWatermark, existing.idempotencyKey!)
        : input.targetWatermark
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
      await this.persist()
      this.schedulePump(0)
      return { jobId: existing.id, coalesced: true, itemCount: existing.trace.length }
    }

    const timestamp = this.nowIso()
    const job: QueueJob = {
      id: randomUUID(),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
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
    this.jobs.push(job)
    await this.persist()
    this.schedulePump(0)
    return { jobId: job.id, coalesced: false, itemCount: job.trace.length }
  }

  async pending(runtimeId: string, threadId: string): Promise<EvidenceDagPendingUpdate | null> {
    await this.load()
    const matching = this.jobs
      .filter((job) => job.runtimeId === runtimeId && job.threadId === threadId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.updatedAt.localeCompare(left.updatedAt)
      )
    const latest = matching.find((job) =>
      job.status === 'failed' && isArtifactLifecycleJob(job)
    ) ?? matching.find((job) =>
      job.status !== 'succeeded' && isArtifactLifecycleJob(job)
    ) ?? matching[0]
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
    let changed = false
    for (const job of this.jobs) {
      if (job.runtimeId !== runtimeId || job.threadId !== threadId ||
          (job.status !== 'queued' && job.status !== 'retrying')) continue
      if (visible ? PRIORITY[job.priority] < PRIORITY[wanted] : job.priority === 'immediate') {
        job.priority = wanted
        job.updatedAt = this.nowIso()
        changed = true
      }
    }
    if (changed) await this.persist()
    this.schedulePump(0)
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.pumpTimer) clearTimeout(this.pumpTimer)
    this.pumpTimer = undefined
    await this.writing
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed: unknown = JSON.parse(await readFile(this.options.storagePath, 'utf8'))
      const file = record(parsed)
      const values = Array.isArray(file?.jobs) ? file.jobs : []
      this.jobs = values.flatMap((value) => {
        const job = canonicalJob(value)
        return job ? [job] : []
      })
      let recovered = file?.version !== 1 ||
        this.jobs.length !== values.length ||
        values.some((value) => {
          const job = record(value)
          return Boolean(
            job &&
            stringValue(job.phase) !== 'project' &&
            nonnegativeInteger(job.consecutiveNoProgressFailures) === undefined
          )
        })
      for (const job of this.jobs) {
        if (job.status !== 'running') continue
        job.status = 'queued'
        job.updatedAt = this.nowIso()
        recovered = true
      }
      if (recovered) await this.persist()
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : ''
      if (code !== 'ENOENT') throw error
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
          !this.hasPriorFailedLifecycle(candidate) &&
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
      void this.run(job).finally(() => {
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

  private async run(job: QueueJob): Promise<void> {
    if (
      job.snapshot &&
      job.completedBatches !== undefined &&
      job.totalBatches !== undefined &&
      job.completedBatches === job.totalBatches
    ) {
      job.status = 'succeeded'
      job.consecutiveNoProgressFailures = 0
      job.updatedAt = this.nowIso()
      await this.persist()
      return
    }
    job.status = 'running'
    job.attempt += 1
    job.updatedAt = this.nowIso()
    job.nextAttemptAt = undefined
    job.error = undefined
    await this.persist()
    try {
      const snapshot = await this.options.submit(
        {
          jobId: job.id,
          engineThreadId: job.engineThreadId,
          targetWatermark: job.targetWatermark,
          reason: job.reason,
          priority: job.priority,
          trace: job.trace,
          workspaceRoot: job.workspaceRoot,
          ...(job.rebuild ? { rebuild: true } : {}),
          ...(job.rebuildRationale ? { rebuildRationale: job.rebuildRationale } : {}),
          ...(job.completedBatches ? { resumeAfterBatch: job.completedBatches } : {})
        },
        async (progress) => {
          if (job.status !== 'running') return
          job.completedBatches = progress.completedBatches
          job.totalBatches = progress.totalBatches
          job.snapshot = progress.snapshot
          job.consecutiveNoProgressFailures = 0
          job.updatedAt = this.nowIso()
          await this.persist()
        }
      )
      job.snapshot = snapshot
      job.status = 'succeeded'
      job.consecutiveNoProgressFailures = 0
      job.updatedAt = this.nowIso()
      await this.persist()
    } catch (error) {
      const diagnostic = error instanceof EvidenceDagServiceError
        ? error.diagnostic
        : evidenceDagTypedErrorSchema.parse({
            code: 'internal_error',
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
            occurredAt: this.nowIso()
          })
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
      await this.persist()
    }
  }

  private hasPriorFailedLifecycle(candidate: QueueJob): boolean {
    const candidateIndex = this.jobs.indexOf(candidate)
    return candidateIndex > 0 && this.jobs.slice(0, candidateIndex).some((job) =>
      job.engineThreadId === candidate.engineThreadId &&
      job.status === 'failed' &&
      isArtifactLifecycleJob(job)
    )
  }

  private persist(): Promise<void> {
    const unresolvedLifecycleFailureIds = new Set<string>()
    for (const job of this.jobs) {
      if (
        job.status === 'failed' &&
        isArtifactLifecycleJob(job)
      ) {
        unresolvedLifecycleFailureIds.add(job.id)
      }
    }
    const retainedTerminalIds = new Set(this.jobs
      .filter((job) => job.status === 'failed' || job.status === 'succeeded')
      .slice(-200)
      .map((job) => job.id))
    const file: QueueFile = {
      version: 1,
      jobs: this.jobs.filter((job) =>
        job.status !== 'failed' && job.status !== 'succeeded' ||
        retainedTerminalIds.has(job.id) ||
        unresolvedLifecycleFailureIds.has(job.id)
      )
    }
    this.jobs = file.jobs
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.options.storagePath), { recursive: true })
      const temporaryPath = `${this.options.storagePath}.${randomUUID()}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, this.options.storagePath)
    })
    return this.writing
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))()
  }

  private nowIso(): string {
    return this.now().toISOString()
  }
}

function isArtifactLifecycleJob(job: Pick<QueueJob, 'idempotencyKey'>): boolean {
  return job.idempotencyKey?.startsWith('artifact-lifecycle:') === true
}

function artifactLifecycleRetryWatermark(targetWatermark: string, idempotencyKey: string): string {
  const receipt = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16)
  return `${targetWatermark}:artifact-lifecycle-retry:${receipt}`
}

function canonicalJob(value: unknown): QueueJob | null {
  const job = record(value)
  if (!job || stringValue(job.phase) === 'project') return null
  const id = stringValue(job.id)
  const runtimeId = stringValue(job.runtimeId)
  const threadId = stringValue(job.threadId)
  const engineThreadId = stringValue(job.engineThreadId)
  const targetWatermark = stringValue(job.targetWatermark)
  const workspaceRoot = stringValue(job.workspaceRoot)
  const createdAt = validTimestamp(job.createdAt)
  const updatedAt = validTimestamp(job.updatedAt)
  const trace = Array.isArray(job.trace)
    ? job.trace.flatMap((item) => record(item) ? [structuredClone(item) as Record<string, unknown>] : [])
    : []
  if (!id || !runtimeId || !threadId || !engineThreadId || !targetWatermark || !workspaceRoot ||
      !createdAt || !updatedAt || !trace.length) return null
  const rawStatus = stringValue(job.status)
  const status: QueueJobStatus = rawStatus === 'retry_scheduled'
    ? 'retrying'
    : rawStatus === 'queued' || rawStatus === 'running' || rawStatus === 'retrying' ||
        rawStatus === 'failed' || rawStatus === 'succeeded'
      ? rawStatus
      : 'queued'
  const rawPriority = stringValue(job.priority)
  const priority: EvidenceDagQueuePriority =
    rawPriority === 'background' || rawPriority === 'normal' ||
    rawPriority === 'high' || rawPriority === 'immediate'
      ? rawPriority
      : 'normal'
  const error = evidenceDagTypedErrorSchema.safeParse(job.error).success
    ? evidenceDagTypedErrorSchema.parse(job.error)
    : job.lastError
      ? evidenceDagTypedErrorSchema.parse({
          code: 'internal_error',
          message: String(job.lastError).slice(0, 4_000),
          retryable: false,
          occurredAt: updatedAt
        })
      : undefined
  const snapshot = canonicalStoredSnapshot(job.snapshot)
  return {
    id,
    ...(stringValue(job.idempotencyKey)
      ? { idempotencyKey: stringValue(job.idempotencyKey) }
      : {}),
    runtimeId,
    threadId,
    engineThreadId,
    targetWatermark,
    reason: stringValue(job.reason) ?? 'recovery',
    priority,
    trace,
    workspaceRoot,
    ...(job.rebuild === true ? { rebuild: true } : {}),
    ...(stringValue(job.rebuildRationale)
      ? { rebuildRationale: stringValue(job.rebuildRationale) }
      : {}),
    status,
    attempt: Number.isInteger(job.attempt)
      ? Number(job.attempt)
      : Number.isInteger(job.attempts)
        ? Number(job.attempts)
        : 0,
    consecutiveNoProgressFailures: nonnegativeInteger(
      job.consecutiveNoProgressFailures
    ) ?? 0,
    createdAt,
    updatedAt,
    ...(validTimestamp(job.nextAttemptAt) ? { nextAttemptAt: validTimestamp(job.nextAttemptAt) } : {}),
    ...(error ? { error } : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(positiveInteger(job.completedBatches) ? {
      completedBatches: positiveInteger(job.completedBatches)
    } : {}),
    ...(positiveInteger(job.totalBatches) ? {
      totalBatches: positiveInteger(job.totalBatches)
    } : {})
  }
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined
}

function nonnegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function canonicalStoredSnapshot(value: unknown): EvidenceDagCommittedSnapshot | null {
  const snapshot = record(value)
  if (!snapshot) return null
  const parsed = evidenceDagCommittedSnapshotSchema.safeParse({
    threadId: snapshot.threadId,
    version: snapshot.version,
    digest: snapshot.digest,
    inputWatermark: snapshot.inputWatermark,
    schemaVersion: snapshot.schemaVersion,
    extractorVersion: snapshot.extractorVersion,
    verifierVersion: snapshot.verifierVersion,
    artifactDigests: snapshot.artifactDigests,
    createdAt: snapshot.createdAt,
    ...(stringValue(snapshot.url) ? { url: stringValue(snapshot.url) } : {})
  })
  return parsed.success ? parsed.data : null
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

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function validTimestamp(value: unknown): string | undefined {
  const timestamp = stringValue(value)
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : undefined
}
