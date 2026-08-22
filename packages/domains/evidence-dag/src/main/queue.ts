import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  evidenceDagCommittedSnapshotSchema,
  evidenceDagTypedErrorSchema,
  laterEvidenceDagWatermark,
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
  traceRef?: string
  traceItemCount: number
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

type QueueThreadState = {
  runtimeId: string
  threadId: string
  engineThreadId: string
  workspaceRoot: string
  workspacePhysicalRoot: string
  workspaceScopeKey: string
  updatedAt: string
  committed?: EvidenceDagCommittedSnapshot
}

type WorkspaceBinding = Readonly<{
  workspaceRoot: string
  workspacePhysicalRoot: string
  workspaceScopeKey: string
}>

type QueueFile = {
  version: 3
  jobs: StoredQueueJob[]
  threads: QueueThreadState[]
}

type StoredQueueJob = Omit<QueueJob, 'trace' | 'traceRef' | 'traceItemCount'> & {
  traceRef: string
  traceItemCount: number
}

const PRIORITY: Record<EvidenceDagQueuePriority, number> = {
  background: 0,
  normal: 1,
  high: 2,
  immediate: 3
}

const MAX_QUEUE_JOBS = 200
const MAX_QUEUE_THREADS = 10_000
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
  private threads = new Map<string, QueueThreadState>()
  private readonly active = new Set<string>()
  private readonly running = new Set<Promise<void>>()
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
    if (input.engineThreadId !== `${input.runtimeId}:${input.threadId}`) {
      throw new Error('Evidence DAG queue scope is not bound to its canonical runtime/thread identity.')
    }
    const workspaceRoot = canonicalWorkspaceRoot(input.workspaceRoot)
    if (!workspaceRoot) {
      throw new Error('Evidence DAG queue workspace authority must be an absolute path.')
    }
    const workspace = await resolveWorkspaceBinding(workspaceRoot)
    await this.hydrateCoalescingCandidate(input)
    const result = await this.mutateJobs((jobs, threads) => {
      const authority = threads.get(input.engineThreadId)
      if (authority && (
        authority.runtimeId !== input.runtimeId || authority.threadId !== input.threadId
      )) {
        throw new Error('Evidence DAG canonical thread identity collides with another scope.')
      }
      if (authority && !sameWorkspace(authority.workspaceRoot, workspace.workspaceRoot)) {
        throw new Error('Cannot bind one Evidence DAG thread identity to multiple workspaces.')
      }
      if (authority && (
        authority.workspacePhysicalRoot !== workspace.workspacePhysicalRoot ||
        authority.workspaceScopeKey !== workspace.workspaceScopeKey
      )) {
        throw new Error('Evidence DAG workspace authority changed its physical target.')
      }
      requireThreadCapacity(threads, input.engineThreadId)
      const matching = jobs
        .filter((job) => job.engineThreadId === input.engineThreadId)
        .sort(compareNewestJob)
      if (matching.some((job) =>
        job.runtimeId !== input.runtimeId || job.threadId !== input.threadId
      )) {
        throw new Error('Evidence DAG canonical thread identity collides with another scope.')
      }
      if (matching.some((job) =>
        !sameWorkspace(job.workspaceRoot, workspace.workspacePhysicalRoot)
      )) {
        throw new Error('Cannot bind one Evidence DAG thread identity to multiple workspaces.')
      }
      if (input.idempotencyKey) {
        const replay = jobs.find((job) => job.idempotencyKey === input.idempotencyKey)
        if (replay) {
          if (
            replay.engineThreadId !== input.engineThreadId ||
            !sameWorkspace(replay.workspaceRoot, workspace.workspacePhysicalRoot)
          ) {
            throw new Error('Evidence DAG idempotency key is already bound to another scope.')
          }
          return {
            changed: false,
            value: { jobId: replay.id, coalesced: true, itemCount: replay.traceItemCount }
          }
        }
      }
      const latest = input.priority === 'immediate'
        ? matching.find((job) => job.status === 'failed' && isArtifactLifecycleJob(job))
          ?? matching[0]
        : matching[0]
      const candidate = !input.idempotencyKey && latest && (
        latest.status === 'queued' ||
        latest.status === 'retrying' ||
        (latest.status === 'failed' && input.priority === 'immediate')
      )
        ? latest
        : undefined
      const revivingArtifactLifecycle = candidate?.status === 'failed' &&
        isArtifactLifecycleJob(candidate)
      const coalescedWatermark = !candidate
        ? undefined
        : revivingArtifactLifecycle
          ? artifactLifecycleRetryWatermark(input.targetWatermark, candidate.idempotencyKey!)
          : laterEvidenceDagWatermark(candidate.targetWatermark, input.targetWatermark)
      const existing = coalescedWatermark === undefined ? undefined : candidate
      if (existing && coalescedWatermark !== undefined) {
        const revivingFailed = existing.status === 'failed'
        if (revivingFailed) requireActiveCapacity(jobs)
        if (!sameWorkspace(existing.workspaceRoot, workspace.workspacePhysicalRoot)) {
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
        existing.targetWatermark = coalescedWatermark
        existing.trace = mergedTrace
        existing.traceRef = undefined
        existing.traceItemCount = mergedTrace.length
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
          value: { jobId: existing.id, coalesced: true, itemCount: existing.traceItemCount }
        }
      }

      requireActiveCapacity(jobs)
      const timestamp = this.nowIso()
      if (!authority) {
        threads.set(input.engineThreadId, {
          runtimeId: input.runtimeId,
          threadId: input.threadId,
          engineThreadId: input.engineThreadId,
          workspaceRoot: workspace.workspaceRoot,
          workspacePhysicalRoot: workspace.workspacePhysicalRoot,
          workspaceScopeKey: workspace.workspaceScopeKey,
          updatedAt: timestamp
        })
      }
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
        traceItemCount: input.trace.length,
        workspaceRoot: workspace.workspacePhysicalRoot,
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
        value: { jobId: job.id, coalesced: false, itemCount: job.traceItemCount }
      }
    })
    this.schedulePump(0)
    return result
  }

  async pending(
    runtimeId: string,
    threadId: string,
    workspaceRoot?: string
  ): Promise<EvidenceDagPendingUpdate | null> {
    const state = await this.authorizedThreadState(runtimeId, threadId, workspaceRoot)
    if (!state) return null
    const matching = this.jobs
      .filter((job) =>
        job.runtimeId === runtimeId &&
        job.threadId === threadId
      )
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
    threadId: string,
    workspaceRoot?: string
  ): Promise<EvidenceDagCommittedSnapshot | null> {
    const state = await this.authorizedThreadState(runtimeId, threadId, workspaceRoot)
    if (!state) return null
    return state.committed ? structuredClone(state.committed) : null
  }

  async workspaceRoot(runtimeId: string, threadId: string): Promise<string | null> {
    const state = await this.authorizedThreadState(runtimeId, threadId)
    if (!state) return null
    return state.workspaceRoot
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
      if (job.status === 'succeeded' && job.snapshot) return structuredClone(job.snapshot)
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
    await this.authorizedThreadState(runtimeId, threadId)
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
    await Promise.all([...this.running])
    await this.writing
  }

  private async authorizedThreadState(
    runtimeId: string,
    threadId: string,
    workspaceRoot?: string
  ): Promise<QueueThreadState | null> {
    await this.load()
    const state = this.threads.get(`${runtimeId}:${threadId}`)
    if (!state || state.runtimeId !== runtimeId || state.threadId !== threadId) return null
    if (workspaceRoot && !sameWorkspace(state.workspaceRoot, workspaceRoot)) return null
    const current = await resolveWorkspaceBinding(state.workspaceRoot)
    if (
      current.workspacePhysicalRoot !== state.workspacePhysicalRoot ||
      current.workspaceScopeKey !== state.workspaceScopeKey
    ) {
      throw new Error('Evidence DAG workspace authority changed its physical target.')
    }
    return state
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
      if (loaded.legacyVersion !== null) {
        const legacyPath = `${this.options.storagePath}.legacy-v${loaded.legacyVersion}.` +
          `${this.now().getTime()}.${randomUUID()}.json`
        await rename(this.options.storagePath, legacyPath)
        try {
          await this.writeQueueFile([], new Map())
        } catch (error) {
          await rename(legacyPath, this.options.storagePath).catch(() => undefined)
          throw error
        }
        this.jobs = []
        this.threads = new Map()
        return
      }
      let recovered = false
      const threads = cloneThreadStates(loaded.threads)
      for (const job of loaded.jobs) {
        if (job.status !== 'running') continue
        job.status = 'queued'
        job.updatedAt = this.nowIso()
        recovered = true
      }
      const threadsRecovered = mergeThreadStates(threads, loaded.jobs)
      recovered ||= threadsRecovered
      const compacted = compactQueueJobs(loaded.jobs)
      recovered ||= compacted.length !== loaded.jobs.length
      if (recovered) await this.writeQueueFile(compacted, threads)
      this.jobs = compacted
      this.threads = threads
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
      this.jobs = []
      this.threads = new Map()
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
      const running = this.run(job.id).catch(() => undefined)
      this.running.add(running)
      void running.finally(() => {
        this.active.delete(job.id)
        this.running.delete(running)
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
    await this.hydrateJobTrace(jobId)
    const queued = this.jobs.find((job) => job.id === jobId)
    if (!queued) return
    try {
      await this.authorizedThreadState(queued.runtimeId, queued.threadId)
    } catch (error) {
      await this.mutateJobs((jobs) => {
        const job = requireQueueJob(jobs, jobId)
        if (job.status !== 'queued' && job.status !== 'retrying') {
          return { changed: false, value: undefined }
        }
        job.status = 'failed'
        job.nextAttemptAt = undefined
        job.error = evidenceDagTypedErrorSchema.parse({
          code: 'access_restricted',
          message: errorMessage(error).slice(0, 4_000),
          retryable: false,
          occurredAt: this.nowIso()
        })
        job.updatedAt = this.nowIso()
        return { changed: true, value: undefined }
      })
      return
    }
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

    try {
      const snapshot = await this.options.submit(
        started,
        async (progress) => {
          if (
            !Number.isSafeInteger(progress.completedBatches) ||
            progress.completedBatches < 0 ||
            !Number.isSafeInteger(progress.totalBatches) ||
            progress.totalBatches <= 0 ||
            progress.completedBatches > progress.totalBatches
          ) {
            throw new Error('Evidence DAG update progress has an invalid batch cursor.')
          }
          const committed = snapshotForThread(progress.snapshot, started.engineThreadId)
          await this.mutateJobs((jobs, threads) => {
            const job = requireQueueJob(jobs, jobId)
            if (job.status !== 'running') return { changed: false, value: undefined }
            assertSnapshotAdvance(threads.get(job.engineThreadId)?.committed, committed)
            assertSnapshotAdvance(job.snapshot, committed)
            job.completedBatches = progress.completedBatches
            job.totalBatches = progress.totalBatches
            job.snapshot = committed
            job.consecutiveNoProgressFailures = 0
            job.updatedAt = this.nowIso()
            return { changed: true, value: undefined }
          })
        }
      )
      const committed = snapshotForThread(snapshot, started.engineThreadId)
      await this.mutateJobs((jobs, threads) => {
        const job = requireQueueJob(jobs, jobId)
        assertSnapshotAdvance(threads.get(job.engineThreadId)?.committed, committed)
        assertSnapshotAdvance(job.snapshot, committed)
        job.snapshot = committed
        job.status = 'succeeded'
        job.consecutiveNoProgressFailures = 0
        job.updatedAt = this.nowIso()
        return { changed: true, value: undefined }
      })
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
  }

  private hasPriorFailedLifecycle(candidate: QueueJob): boolean {
    const candidateIndex = this.jobs.indexOf(candidate)
    return candidateIndex > 0 && this.jobs.slice(0, candidateIndex).some((job) =>
      job.engineThreadId === candidate.engineThreadId &&
      job.status === 'failed' &&
      isArtifactLifecycleJob(job)
    )
  }

  private mutateJobs<T>(
    transform: (
      jobs: QueueJob[],
      threads: Map<string, QueueThreadState>
    ) => Readonly<{ changed: boolean; value: T }>
  ): Promise<T> {
    const pending = this.writing.then(async () => {
      const candidate = structuredClone(this.jobs) as QueueJob[]
      const threads = cloneThreadStates(this.threads)
      const result = transform(candidate, threads)
      if (!result.changed) return result.value
      mergeThreadStates(threads, candidate)
      const compacted = compactQueueJobs(candidate)
      await this.writeQueueFile(compacted, threads)
      this.jobs = compacted
      this.threads = threads
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

  private async writeQueueFile(
    jobs: QueueJob[],
    threads: ReadonlyMap<string, QueueThreadState>
  ): Promise<void> {
    const directory = dirname(this.options.storagePath)
    const temporaryPath = `${this.options.storagePath}.${process.pid}.${randomUUID()}.tmp`
    let temporaryHandle: Awaited<ReturnType<typeof open>> | undefined
    let replaced = false
    try {
      for (const job of jobs) await this.ensureTraceAsset(job)
      const file: QueueFile = {
        version: 3,
        jobs: jobs.map(storedQueueJob),
        threads: [...threads.values()]
          .map((state) => structuredClone(state))
          .sort((left, right) => left.engineThreadId.localeCompare(right.engineThreadId))
      }
      const contents = `${JSON.stringify(file, null, 2)}\n`
      await this.ensureStorageDirectory()
      temporaryHandle = await open(temporaryPath, 'wx', 0o600)
      await temporaryHandle.chmod(0o600)
      await temporaryHandle.writeFile(contents, 'utf8')
      await temporaryHandle.sync()
      await temporaryHandle.close()
      temporaryHandle = undefined
      await rename(temporaryPath, this.options.storagePath)
      replaced = true
      if (process.platform !== 'win32') {
        const directoryHandle = await open(directory, 'r')
        try {
          await directoryHandle.sync()
        } finally {
          await directoryHandle.close()
        }
      }
    } catch (error) {
      // rename() is the atomic commit point. A later directory fsync failure may
      // weaken crash durability, but rolling back only memory would diverge from
      // the already-replaced file for the rest of this process.
      if (replaced) return
      throw new EvidenceDagQueuePersistenceError(error)
    } finally {
      await temporaryHandle?.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
    }
  }

  private async ensureTraceAsset(job: QueueJob): Promise<void> {
    if (job.traceRef) return
    const contents = `${JSON.stringify({ version: 1, trace: job.trace })}\n`
    const traceRef = `sha256:${createHash('sha256').update(contents).digest('hex')}`
    const traceDirectory = `${this.options.storagePath}.traces`
    const tracePath = join(traceDirectory, `${traceRef.slice('sha256:'.length)}.json`)
    await mkdir(traceDirectory, { recursive: true, mode: 0o700 })
    await chmod(traceDirectory, 0o700)
    try {
      await chmod(tracePath, 0o600)
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
      const temporaryPath = `${tracePath}.${process.pid}.${randomUUID()}.tmp`
      let temporaryHandle: Awaited<ReturnType<typeof open>> | undefined
      try {
        temporaryHandle = await open(temporaryPath, 'wx', 0o600)
        await temporaryHandle.writeFile(contents, 'utf8')
        await temporaryHandle.sync()
        await temporaryHandle.close()
        temporaryHandle = undefined
        await rename(temporaryPath, tracePath)
      } finally {
        await temporaryHandle?.close().catch(() => undefined)
        await unlink(temporaryPath).catch(() => undefined)
      }
    }
    job.traceRef = traceRef
  }

  private async hydrateCoalescingCandidate(input: EvidenceDagQueueInput): Promise<void> {
    await this.writing
    if (input.idempotencyKey) return
    const matching = this.jobs
      .filter((job) => job.engineThreadId === input.engineThreadId)
      .sort(compareNewestJob)
    const latest = input.priority === 'immediate'
      ? matching.find((job) => job.status === 'failed' && isArtifactLifecycleJob(job))
        ?? matching[0]
      : matching[0]
    if (!latest || latest.trace.length || !latest.traceRef) return
    const eligible = latest.status === 'queued' || latest.status === 'retrying' ||
      (latest.status === 'failed' && input.priority === 'immediate')
    if (eligible) latest.trace = await this.readTraceAsset(latest.traceRef)
  }

  private async hydrateJobTrace(jobId: string): Promise<void> {
    await this.writing
    const job = this.jobs.find((candidate) => candidate.id === jobId)
    if (!job || job.trace.length || !job.traceRef) return
    job.trace = await this.readTraceAsset(job.traceRef)
  }

  private async readTraceAsset(traceRef: string): Promise<Record<string, unknown>[]> {
    if (!isTraceRef(traceRef)) throw new Error('Evidence DAG queue trace reference is invalid.')
    const tracePath = join(
      `${this.options.storagePath}.traces`,
      `${traceRef.slice('sha256:'.length)}.json`
    )
    const contents = await readFile(tracePath, 'utf8')
    const digest = `sha256:${createHash('sha256').update(contents).digest('hex')}`
    if (digest !== traceRef) throw new Error('Evidence DAG queue trace asset failed integrity validation.')
    const asset = record(JSON.parse(contents))
    const trace = asset?.version === 1 && Array.isArray(asset.trace) &&
      asset.trace.every((item) => record(item) !== null)
      ? asset.trace.map((item) => structuredClone(item) as Record<string, unknown>)
      : null
    if (!trace?.length) throw new Error('Evidence DAG queue trace asset is invalid.')
    return trace
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

const QUEUE_FILE_KEYS = new Set(['version', 'jobs', 'threads'])
const QUEUE_THREAD_KEYS = new Set([
  'runtimeId',
  'threadId',
  'engineThreadId',
  'workspaceRoot',
  'workspacePhysicalRoot',
  'workspaceScopeKey',
  'updatedAt',
  'committed'
])
const QUEUE_JOB_KEYS = new Set([
  'id',
  'idempotencyKey',
  'runtimeId',
  'threadId',
  'engineThreadId',
  'targetWatermark',
  'reason',
  'priority',
  'traceRef',
  'traceItemCount',
  'workspaceRoot',
  'rebuild',
  'rebuildRationale',
  'status',
  'attempt',
  'consecutiveNoProgressFailures',
  'createdAt',
  'updatedAt',
  'nextAttemptAt',
  'error',
  'snapshot',
  'completedBatches',
  'totalBatches'
])

function parseQueueFile(value: unknown): Readonly<{
  jobs: QueueJob[]
  threads: Map<string, QueueThreadState>
  legacyVersion: 1 | 2 | null
}> {
  const file = record(value)
  if (!file) {
    throw new Error('Evidence DAG update queue storage has an invalid root object.')
  }
  if (file.version === 1 || file.version === 2) {
    return {
      jobs: [],
      threads: new Map(),
      legacyVersion: file.version
    }
  }
  if (file.version !== 3) {
    throw new Error('Evidence DAG update queue storage has an unsupported version.')
  }
  if (!hasOnlyKeys(file, QUEUE_FILE_KEYS) || !Array.isArray(file.jobs)) {
    throw new Error('Evidence DAG update queue storage has an invalid root object.')
  }
  if (!Array.isArray(file.threads)) {
    throw new Error('Evidence DAG update queue storage has an invalid thread registry.')
  }
  const storedThreads = file.threads as unknown[]

  const jobs: QueueJob[] = []
  const jobIds = new Set<string>()
  const threads = new Map<string, QueueThreadState>()
  if (storedThreads.length > MAX_QUEUE_THREADS) {
    throw new Error('Evidence DAG update queue thread registry exceeds its capacity.')
  }
  for (const [index, value] of storedThreads.entries()) {
    const state = canonicalThreadState(value)
    if (!state || threads.has(state.engineThreadId)) {
      throw invalidStoredThread(index)
    }
    threads.set(state.engineThreadId, state)
  }
  const workspaceByEngineThread = new Map(
    [...threads.values()].map((state) => [state.engineThreadId, state.workspacePhysicalRoot])
  )
  for (const [index, value] of file.jobs.entries()) {
    const stored = record(value)
    if (!stored || !hasOnlyKeys(stored, QUEUE_JOB_KEYS)) {
      throw invalidStoredJob(index)
    }
    const job = canonicalJob(stored)
    if (!job || jobIds.has(job.id)) throw invalidStoredJob(index)
    if (!threads.has(job.engineThreadId)) {
      throw new Error(
        `Evidence DAG update queue job at index ${index} has no thread authority.`
      )
    }
    const boundWorkspace = workspaceByEngineThread.get(job.engineThreadId)
    if (boundWorkspace && !sameWorkspace(boundWorkspace, job.workspaceRoot)) {
      throw new Error(
        `Evidence DAG update queue thread identity spans multiple workspaces at index ${index}.`
      )
    }
    workspaceByEngineThread.set(job.engineThreadId, job.workspaceRoot)
    jobIds.add(job.id)
    jobs.push(job)
  }
  return { jobs, threads, legacyVersion: null }
}

function canonicalThreadState(value: unknown): QueueThreadState | null {
  const stored = record(value)
  if (!stored || !hasOnlyKeys(stored, QUEUE_THREAD_KEYS)) return null
  const runtimeId = stringValue(stored.runtimeId)
  const threadId = stringValue(stored.threadId)
  const engineThreadId = stringValue(stored.engineThreadId)
  const workspaceRoot = canonicalWorkspaceRoot(stored.workspaceRoot)
  const workspacePhysicalRoot = canonicalWorkspaceRoot(stored.workspacePhysicalRoot)
  const workspaceScopeKey = stringValue(stored.workspaceScopeKey)
  const updatedAt = validTimestamp(stored.updatedAt)
  const committed = stored.committed === undefined
    ? undefined
    : canonicalStoredSnapshot(stored.committed)
  if (
    !runtimeId || !threadId || !engineThreadId ||
    engineThreadId !== `${runtimeId}:${threadId}` ||
    !workspaceRoot || !workspacePhysicalRoot || !workspaceScopeKey ||
    !isWorkspaceScopeKey(workspaceScopeKey, workspacePhysicalRoot) ||
    !updatedAt ||
    (stored.committed !== undefined && !committed) ||
    (committed && committed.threadId !== engineThreadId)
  ) return null
  return {
    runtimeId,
    threadId,
    engineThreadId,
    workspaceRoot,
    workspacePhysicalRoot,
    workspaceScopeKey,
    updatedAt,
    ...(committed ? { committed } : {})
  }
}

function canonicalJob(job: Record<string, unknown>): QueueJob | null {
  const id = stringValue(job.id)
  const idempotencyKey = job.idempotencyKey === undefined
    ? undefined
    : stringValue(job.idempotencyKey)
  const runtimeId = stringValue(job.runtimeId)
  const threadId = stringValue(job.threadId)
  const engineThreadId = stringValue(job.engineThreadId)
  const targetWatermark = stringValue(job.targetWatermark)
  const workspaceRoot = canonicalWorkspaceRoot(job.workspaceRoot)
  const createdAt = validTimestamp(job.createdAt)
  const updatedAt = validTimestamp(job.updatedAt)
  const reason = stringValue(job.reason)
  const traceRef = stringValue(job.traceRef)
  const traceItemCount = positiveInteger(job.traceItemCount)
  if (!id || !runtimeId || !threadId || !engineThreadId ||
      engineThreadId !== `${runtimeId}:${threadId}` || !targetWatermark || !workspaceRoot ||
      !reason || !createdAt || !updatedAt ||
      (job.idempotencyKey !== undefined && !idempotencyKey) ||
      !traceRef || !isTraceRef(traceRef) || !traceItemCount) return null
  const status = canonicalQueueStatus(job.status)
  if (!status) return null
  const priority = canonicalQueuePriority(job.priority)
  if (!priority) return null
  const parsedError = job.error === undefined
    ? undefined
    : evidenceDagTypedErrorSchema.safeParse(job.error)
  if (parsedError && !parsedError.success) return null
  const error = parsedError?.success ? parsedError.data : undefined
  const snapshot = job.snapshot === undefined ? undefined : canonicalStoredSnapshot(job.snapshot)
  if (
    (job.snapshot !== undefined && !snapshot) ||
    (snapshot && snapshot.threadId !== engineThreadId)
  ) return null
  const attempt = nonnegativeInteger(job.attempt)
  const consecutiveNoProgressFailures = nonnegativeInteger(job.consecutiveNoProgressFailures)
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
  const hasBatchCursor = completedBatches !== undefined || totalBatches !== undefined
  if (
    attempt === undefined ||
    consecutiveNoProgressFailures === undefined ||
    (job.nextAttemptAt !== undefined && !nextAttemptAt) ||
    (job.completedBatches !== undefined && completedBatches === undefined) ||
    (job.totalBatches !== undefined && totalBatches === undefined) ||
    ((completedBatches === undefined) !== (totalBatches === undefined)) ||
    (completedBatches !== undefined && totalBatches !== undefined && completedBatches > totalBatches) ||
    (hasBatchCursor && !snapshot) ||
    (job.rebuild !== undefined && typeof job.rebuild !== 'boolean') ||
    (job.rebuildRationale !== undefined && !rebuildRationale) ||
    (status === 'retrying' && (!nextAttemptAt || !error)) ||
    (status === 'failed' && !error) ||
    (status === 'succeeded' && !snapshot) ||
    (status !== 'retrying' && nextAttemptAt !== undefined) ||
    (status !== 'retrying' && status !== 'failed' && error !== undefined) ||
    ((status === 'running' || status === 'retrying' || status === 'succeeded') && attempt === 0)
  ) return null
  return {
    id,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    runtimeId,
    threadId,
    engineThreadId,
    targetWatermark,
    reason,
    priority,
    trace: [],
    traceRef,
    traceItemCount,
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

function storedQueueJob(job: QueueJob): StoredQueueJob {
  if (!job.traceRef) throw new Error(`Evidence DAG queue job ${job.id} has no trace reference.`)
  const { trace: _trace, traceRef, traceItemCount: _traceItemCount, ...stored } = job
  return { ...stored, traceRef, traceItemCount: job.traceItemCount }
}

function isTraceRef(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(value)
}

function canonicalQueueStatus(value: unknown): QueueJobStatus | undefined {
  const status = stringValue(value)
  return status === 'queued' || status === 'running' || status === 'retrying' ||
    status === 'failed' || status === 'succeeded'
    ? status
    : undefined
}

function canonicalQueuePriority(value: unknown): EvidenceDagQueuePriority | undefined {
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

function snapshotForThread(
  value: unknown,
  engineThreadId: string
): EvidenceDagCommittedSnapshot {
  const snapshot = canonicalStoredSnapshot(value)
  if (!snapshot || snapshot.threadId !== engineThreadId) {
    throw new Error('Evidence DAG committed snapshot is not bound to its queue thread identity.')
  }
  return structuredClone(snapshot)
}

function assertSnapshotAdvance(
  previous: EvidenceDagCommittedSnapshot | undefined,
  next: EvidenceDagCommittedSnapshot
): void {
  if (!previous) return
  if (next.version < previous.version) {
    throw new Error('Evidence DAG committed snapshot version cannot regress within one update.')
  }
  if (next.version === previous.version && !isDeepStrictEqual(next, previous)) {
    throw new Error('Evidence DAG committed snapshot version is immutable within one update.')
  }
}

function cloneThreadStates(
  states: ReadonlyMap<string, QueueThreadState>
): Map<string, QueueThreadState> {
  return new Map([...states].map(([key, state]) => [key, structuredClone(state)]))
}

function mergeThreadStates(
  states: Map<string, QueueThreadState>,
  jobs: readonly QueueJob[]
): boolean {
  let changed = false
  for (const job of jobs) {
    const existing = states.get(job.engineThreadId)
    if (!existing) {
      throw new Error(`Evidence DAG queue job ${job.id} has no thread authority.`)
    }
    if (existing.runtimeId !== job.runtimeId || existing.threadId !== job.threadId) {
      throw new Error('Evidence DAG canonical thread identity collides with another scope.')
    }
    if (!sameWorkspace(existing.workspacePhysicalRoot, job.workspaceRoot)) {
      throw new Error('Evidence DAG queue thread identity spans multiple workspaces.')
    }
    if (job.updatedAt > existing.updatedAt) {
      existing.updatedAt = job.updatedAt
      changed = true
    }
    if (!job.snapshot) continue
    const snapshot = snapshotForThread(job.snapshot, job.engineThreadId)
    job.snapshot = snapshot
    if (!existing.committed || snapshot.version > existing.committed.version) {
      existing.committed = structuredClone(snapshot)
      changed = true
      continue
    }
    if (
      snapshot.version === existing.committed.version &&
      !isDeepStrictEqual(snapshot, existing.committed)
    ) {
      throw new Error(
        `Evidence DAG queue has conflicting committed snapshot version ${snapshot.version} ` +
        `for thread ${job.engineThreadId}.`
      )
    }
  }
  return changed
}

function compactQueueJobs(jobs: QueueJob[]): QueueJob[] {
  const overflow = jobs.length - MAX_QUEUE_JOBS
  if (overflow <= 0) return jobs
  const oldestTerminalIds = new Set(jobs
    .filter((job) =>
      !ACTIVE_QUEUE_STATUSES.has(job.status) &&
      !(job.status === 'failed' && isArtifactLifecycleJob(job))
    )
    .sort(compareOldestJob)
    .slice(0, overflow)
    .map((job) => job.id))
  if (!oldestTerminalIds.size) return jobs
  return jobs.filter((job) => !oldestTerminalIds.has(job.id))
}

function requireThreadCapacity(
  states: ReadonlyMap<string, QueueThreadState>,
  engineThreadId: string
): void {
  if (states.has(engineThreadId) || states.size < MAX_QUEUE_THREADS) return
  throw new Error(
    `Evidence DAG queue thread registry is at capacity with ${states.size} identities; ` +
    'enqueue was rejected.'
  )
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

function sameWorkspace(left: string, right: string): boolean {
  const canonicalLeft = canonicalWorkspaceRoot(left)
  const canonicalRight = canonicalWorkspaceRoot(right)
  return canonicalLeft !== undefined && canonicalLeft === canonicalRight
}

function canonicalWorkspaceRoot(value: unknown): string | undefined {
  const workspaceRoot = stringValue(value)
  if (!workspaceRoot || workspaceRoot.includes('\0') || !isAbsolute(workspaceRoot)) {
    return undefined
  }
  return resolve(workspaceRoot)
}

async function resolveWorkspaceBinding(workspaceRoot: string): Promise<WorkspaceBinding> {
  const lexicalRoot = canonicalWorkspaceRoot(workspaceRoot)
  if (!lexicalRoot) {
    throw new Error('Evidence DAG queue workspace authority must be an absolute path.')
  }
  let kind = 'real'
  let physicalRoot: string
  try {
    physicalRoot = resolve(await realpath(lexicalRoot))
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
    kind = 'lexical'
    physicalRoot = lexicalRoot
  }
  return {
    workspaceRoot: lexicalRoot,
    workspacePhysicalRoot: physicalRoot,
    workspaceScopeKey: workspaceScopeKey(kind, physicalRoot)
  }
}

function workspaceScopeKey(kind: string, physicalRoot: string): string {
  return `${kind}:sha256:${createHash('sha256').update(physicalRoot).digest('hex')}`
}

function isWorkspaceScopeKey(value: string, physicalRoot: string): boolean {
  const kind = /^(real|lexical):sha256:[a-f0-9]{64}$/u.exec(value)?.[1]
  return kind !== undefined && value === workspaceScopeKey(kind, physicalRoot)
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

function invalidStoredThread(index: number): Error {
  return new Error(`Evidence DAG update queue storage has an invalid thread at index ${index}.`)
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
