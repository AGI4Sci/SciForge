import {
  EMPTY_MULTI_AGENT_USAGE,
  MULTI_AGENT_CONTRACT_VERSION,
  MultiAgentChildRunAggregate,
  MultiAgentChildRunRecord,
  MultiAgentChildThreadRef,
  type MultiAgentChildStatus,
  type MultiAgentDiagnostics,
  MultiAgentRuntimeConfig,
  MultiAgentTranscriptEntry,
  MultiAgentUsage,
  type MultiAgentErrorCode,
  type MultiAgentErrorInfo,
  type MultiAgentEventSink,
  type MultiAgentExecutor,
  type MultiAgentLifecycleControl,
  type MultiAgentExecutorResult,
  type MultiAgentRuntimeConfig as MultiAgentRuntimeConfigType,
  type MultiAgentTerminationReason,
  type MultiAgentTranscriptEntry as MultiAgentTranscriptEntryType,
  type MultiAgentUsage as MultiAgentUsageType
} from './contract.js'
import type { MultiAgentStore } from './store.js'

export class MultiAgentRuntimeError extends Error {
  readonly code: MultiAgentErrorCode
  readonly retryable?: boolean
  readonly details?: unknown

  constructor(error: MultiAgentErrorInfo) {
    super(error.message)
    this.name = 'MultiAgentRuntimeError'
    this.code = error.code
    this.retryable = error.retryable
    this.details = error.details
  }

  toJSON(): MultiAgentErrorInfo {
    return createMultiAgentError(this.code, this.message, {
      retryable: this.retryable,
      details: this.details
    })
  }
}

export type RunChildInput = {
  parentThreadId: string
  parentTurnId: string
  requestId?: string
  label?: string
  prompt: string
  workspace?: string
  model?: string
  allowedToolNames?: readonly string[]
  brokerScope?: Readonly<{ providerFamily: 'managed-mcp'; packageId?: string }>
  deadlineMs?: number
  strictAllowedToolNames?: boolean
  bashCommandPolicy?: Record<string, unknown>
  filePathPolicy?: Record<string, unknown>
  maxToolCalls?: number
  resumeThreadRef?: MultiAgentChildThreadRef
  signal?: AbortSignal
}

export type ResumeChildInput = {
  parentThreadId: string
  parentTurnId: string
  childId: string
  prompt?: string
  signal?: AbortSignal
}

export type MultiAgentWaitResult = {
  record: MultiAgentChildRunRecord
  timedOut: boolean
}

export type MultiAgentRuntimeOptions = {
  config?: Partial<MultiAgentRuntimeConfigType>
  store: MultiAgentStore
  executor?: MultiAgentExecutor
  events?: MultiAgentEventSink
  nowIso?: () => string
  idGenerator?: () => string
  recordUsage?: (parentThreadId: string, usage: MultiAgentUsageType) => void
}

type ExecutorOutcome =
  | { kind: 'result'; result: MultiAgentExecutorResult }
  | { kind: 'error'; error: unknown }

export class MultiAgentRuntime {
  private readonly config: MultiAgentRuntimeConfigType
  private active = 0
  private readonly activeChildIds = new Set<string>()
  private readonly activeRequestsByKey = new Map<string, Promise<MultiAgentChildRunRecord>>()
  private readonly startedRequestsByKey = new Map<string, Promise<MultiAgentChildRunRecord>>()
  private readonly executionsByChildId = new Map<string, Promise<MultiAgentChildRunRecord>>()
  private readonly lifecycleControlsByChildId = new Map<string, MultiAgentLifecycleControl>()
  private readonly boundariesByChildId = new Map<string, ReturnType<typeof createExecutionBoundary>>()
  private startGate: Promise<void> = Promise.resolve()
  private eventSeq = 0

  constructor(private readonly options: MultiAgentRuntimeOptions) {
    this.config = MultiAgentRuntimeConfig.parse(options.config ?? {})
  }

  async runChild(input: RunChildInput): Promise<MultiAgentChildRunRecord> {
    return this.ensureChildExecution(input).execution
  }

  async startChild(input: RunChildInput): Promise<MultiAgentChildRunRecord> {
    return this.ensureChildExecution(input).started
  }

  private ensureChildExecution(input: RunChildInput): {
    execution: Promise<MultiAgentChildRunRecord>
    started: Promise<MultiAgentChildRunRecord>
  } {
    const normalized = normalizeRunChildInput(input)
    const requestKey = normalized.requestId
      ? childRequestKey(normalized.parentThreadId, normalized.parentTurnId, normalized.requestId)
      : ''
    const activeRequest = requestKey ? this.activeRequestsByKey.get(requestKey) : undefined
    const activeStarted = requestKey ? this.startedRequestsByKey.get(requestKey) : undefined
    if (activeRequest && activeStarted) return { execution: activeRequest, started: activeStarted }

    let resolveStarted!: (record: MultiAgentChildRunRecord) => void
    let rejectStarted!: (error: unknown) => void
    let startedSettled = false
    const started = new Promise<MultiAgentChildRunRecord>((resolve, reject) => {
      resolveStarted = resolve
      rejectStarted = reject
    })
    void started.catch(() => undefined)
    let execution!: Promise<MultiAgentChildRunRecord>
    execution = this.executeChild(input, {
      onReserved: (childId) => this.executionsByChildId.set(childId, execution),
      onStarted: (record) => {
        startedSettled = true
        resolveStarted(record)
      }
    })
    void execution.then((record) => {
      if (!startedSettled) resolveStarted(record)
    }, (error) => {
      if (!startedSettled) rejectStarted(error)
    }).finally(() => {
      if (requestKey && this.activeRequestsByKey.get(requestKey) === execution) {
        this.activeRequestsByKey.delete(requestKey)
        this.startedRequestsByKey.delete(requestKey)
      }
    })
    if (requestKey) {
      this.activeRequestsByKey.set(requestKey, execution)
      this.startedRequestsByKey.set(requestKey, started)
    }
    return { execution, started }
  }

  private async executeChild(
    input: RunChildInput,
    observer: {
      onReserved(childId: string): void
      onStarted(record: MultiAgentChildRunRecord): void
    }
  ): Promise<MultiAgentChildRunRecord> {
    const normalized = normalizeRunChildInput(input)
    const reservation: { replayed: MultiAgentChildRunRecord } | { id: string } = await this.withStartGate(async () => {
      if (normalized.requestId) {
        const replayed = await this.options.store.findByRequest(
          normalized.parentThreadId,
          normalized.parentTurnId,
          normalized.requestId
        )
        if (replayed) return { replayed } as const
      }
      this.assertCanStart()
      const id = this.options.idGenerator?.() ?? randomChildId()
      this.active += 1
      this.activeChildIds.add(id)
      return { id } as const
    })
    if ('replayed' in reservation) {
      return normalizeRuntimeView(reservation.replayed, this.activeChildIds)
    }

    const id = reservation.id
    observer.onReserved(id)
    const createdAt = this.now()
    let record = MultiAgentChildRunRecord.parse({
      id,
      parentThreadId: normalized.parentThreadId,
      parentTurnId: normalized.parentTurnId,
      requestId: normalized.requestId,
      label: normalized.label,
      prompt: normalized.prompt,
      workspace: normalized.workspace,
      model: normalized.model,
      status: 'queued',
      usage: EMPTY_MULTI_AGENT_USAGE,
      transcript: [{
        id: `${id}-prompt`,
        kind: 'user_message',
        text: normalized.prompt,
        createdAt
      }],
      createdAt,
      updatedAt: createdAt
    })
    try {
      await this.persistAndEmit(record)
    } catch (error) {
      this.active -= 1
      this.activeChildIds.delete(id)
      throw error
    }

    return this.executeReservedChild(record, normalized, input.signal, observer.onStarted)
  }

  private async executeReservedChild(
    initialRecord: MultiAgentChildRunRecord,
    normalized: NormalizedRunChildInput,
    parentSignal: AbortSignal | undefined,
    onStarted: (record: MultiAgentChildRunRecord) => void
  ): Promise<MultiAgentChildRunRecord> {
    const executor = this.options.executor
    if (!executor) {
      throw new MultiAgentRuntimeError(createMultiAgentError('executor_missing', 'multi-agent executor is not configured'))
    }
    const id = initialRecord.id
    let record = initialRecord

    const boundary = createExecutionBoundary(parentSignal, normalized.deadlineMs)
    this.boundariesByChildId.set(id, boundary)
    let acceptingTranscript = true
    let lifecycleControl: MultiAgentLifecycleControl | undefined
    try {
      const startedAt = this.now()
      record = MultiAgentChildRunRecord.parse({
        ...record,
        status: 'running',
        startedAt,
        updatedAt: startedAt
      })
      await this.persistAndEmit(record)
      onStarted(record)
      if (boundary.signal.aborted) {
        throw new MultiAgentRuntimeError(createMultiAgentError('child_aborted', 'multi-agent child run was aborted'))
      }

      const executorOutcome = Promise.resolve()
        .then(() => executor({
          childId: id,
          parentThreadId: normalized.parentThreadId,
          parentTurnId: normalized.parentTurnId,
          label: normalized.label,
          prompt: normalized.prompt,
          workspace: normalized.workspace,
          model: normalized.model,
          allowedToolNames: normalized.allowedToolNames,
          brokerScope: normalized.brokerScope,
          deadlineMs: normalized.deadlineMs,
          strictAllowedToolNames: normalized.strictAllowedToolNames,
          bashCommandPolicy: normalized.bashCommandPolicy,
          filePathPolicy: normalized.filePathPolicy,
          maxToolCalls: normalized.maxToolCalls,
          resumeThreadRef: normalized.resumeThreadRef,
          signal: boundary.signal,
          registerLifecycleControl: (control) => {
            if (!boundary.signal.aborted) {
              lifecycleControl = control
              this.lifecycleControlsByChildId.set(id, control)
            }
          },
          setThreadRef: async (threadRef) => {
            record = MultiAgentChildRunRecord.parse({
              ...record,
              threadRef: MultiAgentChildThreadRef.parse(threadRef),
              updatedAt: this.now()
            })
            await this.persistAndEmit(record)
          },
          appendTranscript: async (entry) => {
            if (!acceptingTranscript) return
            record = await this.appendTranscript(record, entry)
          }
        }))
        .then<ExecutorOutcome, ExecutorOutcome>(
          (result) => ({ kind: 'result', result }),
          (error: unknown) => ({ kind: 'error', error })
        )
      const initialOutcome = await Promise.race([
        executorOutcome.then((outcome) => ({ kind: 'executor' as const, outcome })),
        boundary.parentAborted.then(() => ({ kind: 'parent_abort' as const }))
      ])
      if (initialOutcome.kind === 'parent_abort') {
        await terminateLifecycleControl(
          lifecycleControl,
          'parent_abort',
          5_000
        )
        throw new MultiAgentRuntimeError(createMultiAgentError(
          'child_aborted',
          'multi-agent child run was aborted'
        ))
      }
      if (initialOutcome.outcome.kind === 'error') throw initialOutcome.outcome.error
      const result = initialOutcome.outcome.result
      if (!result) {
        throw new MultiAgentRuntimeError(createMultiAgentError('executor_missing', 'multi-agent executor returned no result'))
      }

      const finishedAt = this.now()
      record = MultiAgentChildRunRecord.parse({
        ...record,
        status: 'completed',
        summary: summaryFromResult(result),
        usage: normalizeUsage(result.usage),
        transcript: normalizeTranscript({
          record,
          transcript: result.transcript,
          summary: summaryFromResult(result),
          finishedAt,
          maxEntries: this.config.maxTranscriptEntries
        }),
        threadRef: result.threadRef ?? record.threadRef,
        updatedAt: finishedAt,
        finishedAt
      })
      await this.persistAndEmit(record)
      this.recordUsage(record)
      return record
    } catch (error) {
      const finishedAt = this.now()
      const errorInfo = errorInfoFromThrown(error)
      const failureDetails = executorFailureDetailsFromThrown(error)
      const status = errorInfo.code === 'child_aborted' ? 'aborted' : 'failed'
      record = MultiAgentChildRunRecord.parse({
        ...record,
        status,
        ...(failureDetails.summary ? { summary: failureDetails.summary } : {}),
        error: errorInfo,
        usage: normalizeUsage(failureDetails.usage),
        transcript: normalizeTranscript({
          record,
          transcript: failureDetails.transcript,
          summary: failureDetails.summary,
          status,
          error: errorInfo,
          finishedAt,
          maxEntries: this.config.maxTranscriptEntries
        }),
        ...(failureDetails.threadRef ? { threadRef: failureDetails.threadRef } : {}),
        updatedAt: finishedAt,
        finishedAt
      })
      await this.persistAndEmit(record)
      return record
    } finally {
      acceptingTranscript = false
      boundary.dispose()
      this.boundariesByChildId.delete(id)
      this.lifecycleControlsByChildId.delete(id)
      this.executionsByChildId.delete(id)
      this.active -= 1
      this.activeChildIds.delete(id)
    }
  }

  async resumeChild(input: ResumeChildInput): Promise<MultiAgentChildRunRecord> {
    const parentThreadId = input.parentThreadId.trim()
    const parentTurnId = input.parentTurnId.trim()
    const childId = input.childId.trim()
    if (!parentThreadId || !parentTurnId || !childId) {
      throw new MultiAgentRuntimeError(createMultiAgentError(
        'invalid_input',
        'parentThreadId, parentTurnId, and childId are required to resume a child'
      ))
    }

    const reserved = await this.withStartGate(async () => {
      const existing = await this.options.store.get(parentThreadId, childId)
      if (!existing) {
        throw new MultiAgentRuntimeError(createMultiAgentError(
          'child_not_found',
          `multi-agent child ${childId} was not found`
        ))
      }
      if (existing.status !== 'aborted' && existing.status !== 'failed') {
        throw new MultiAgentRuntimeError(createMultiAgentError(
          'invalid_input',
          `multi-agent child ${childId} can only resume from failed or aborted status`
        ))
      }
      if (!existing.threadRef) {
        throw new MultiAgentRuntimeError(createMultiAgentError(
          'invalid_input',
          `multi-agent child ${childId} has no provider thread to resume`
        ))
      }
      this.assertCanStart()
      this.active += 1
      this.activeChildIds.add(childId)
      return existing
    })

    const resumePrompt = input.prompt?.trim() || 'Continue from where you were interrupted and finish the original task.'
    const resumedAt = this.now()
    const { error: _error, finishedAt: _finishedAt, ...resumable } = reserved
    const queued = MultiAgentChildRunRecord.parse({
      ...resumable,
      parentTurnId,
      attempt: reserved.attempt + 1,
      status: 'queued',
      transcript: trimTranscript([...reserved.transcript, {
        id: `${childId}-resume-${reserved.attempt + 1}`,
        kind: 'user_message',
        text: resumePrompt,
        createdAt: resumedAt,
        metadata: { resumed: true, attempt: reserved.attempt + 1 }
      }], this.config.maxTranscriptEntries),
      updatedAt: resumedAt
    })
    try {
      await this.persistAndEmit(queued)
    } catch (error) {
      this.active -= 1
      this.activeChildIds.delete(childId)
      throw error
    }

    let resolveStarted!: (record: MultiAgentChildRunRecord) => void
    let rejectStarted!: (error: unknown) => void
    let startedSettled = false
    const started = new Promise<MultiAgentChildRunRecord>((resolve, reject) => {
      resolveStarted = resolve
      rejectStarted = reject
    })
    const normalized = normalizeRunChildInput({
      parentThreadId,
      parentTurnId,
      label: reserved.label,
      prompt: resumePrompt,
      workspace: reserved.workspace,
      model: reserved.model,
      resumeThreadRef: reserved.threadRef,
      signal: input.signal
    })
    const execution = this.executeReservedChild(queued, normalized, input.signal, (record) => {
      startedSettled = true
      resolveStarted(record)
    })
    this.executionsByChildId.set(childId, execution)
    void execution.then((record) => {
      if (!startedSettled) resolveStarted(record)
    }, (error) => {
      if (!startedSettled) rejectStarted(error)
    })
    return started
  }

  async child(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null> {
    const record = await this.options.store.get(parentThreadId, childId)
    return record ? normalizeRuntimeView(record, this.activeChildIds) : null
  }

  async waitForChild(
    parentThreadId: string,
    childId: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<MultiAgentWaitResult | null> {
    const current = await this.child(parentThreadId, childId)
    if (!current) return null
    if (isTerminalChildStatus(current.status)) return { record: current, timedOut: false }
    const execution = this.executionsByChildId.get(childId)
    if (!execution) return { record: current, timedOut: false }
    const timeoutMs = normalizeWaitTimeoutMs(options.timeoutMs)
    if (timeoutMs === 0) return { record: current, timedOut: true }
    const deadline = startDeadline(timeoutMs)
    const abort = abortPromise(options.signal)
    try {
      const outcome = await Promise.race([
        execution.then((record) => ({ kind: 'completed' as const, record })),
        deadline.promise.then(() => ({ kind: 'timeout' as const })),
        abort.promise.then(() => ({ kind: 'aborted' as const }))
      ])
      if (outcome.kind === 'aborted') {
        throw new MultiAgentRuntimeError(createMultiAgentError('child_aborted', 'multi-agent wait was aborted'))
      }
      if (outcome.kind === 'completed') return { record: outcome.record, timedOut: false }
      return {
        record: (await this.child(parentThreadId, childId)) ?? current,
        timedOut: true
      }
    } finally {
      deadline.cancel()
      abort.dispose()
    }
  }

  async inspectChild(parentThreadId: string, childId: string): Promise<{
    record: MultiAgentChildRunRecord
    liveness: { state: 'active' | 'missing'; observedAt: string }
  } | null> {
    const record = await this.child(parentThreadId, childId)
    if (!record) return null
    if (isTerminalChildStatus(record.status)) {
      return { record, liveness: { state: 'missing', observedAt: this.now() } }
    }
    const control = this.lifecycleControlsByChildId.get(childId)
    if (!control) return { record, liveness: { state: 'missing', observedAt: this.now() } }
    const bounded = startBoundedLifecycleCall(5_000, (signal) => control.inspect(signal))
    const outcome = await bounded.outcome
    if (outcome.kind === 'completed') return { record, liveness: outcome.value }
    return { record, liveness: { state: 'missing', observedAt: this.now() } }
  }

  async sendMessage(parentThreadId: string, childId: string, message: string): Promise<boolean> {
    const record = await this.child(parentThreadId, childId)
    if (!record) throw new MultiAgentRuntimeError(createMultiAgentError('child_not_found', `multi-agent child ${childId} was not found`))
    if (isTerminalChildStatus(record.status)) return false
    const control = this.lifecycleControlsByChildId.get(childId)
    if (!control) return false
    const bounded = startBoundedLifecycleCall(5_000, (signal) => control.sendMessage({ message, signal }))
    const outcome = await bounded.outcome
    return outcome.kind === 'completed' && outcome.value.established
  }

  async cancelChild(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null> {
    const record = await this.child(parentThreadId, childId)
    if (!record || isTerminalChildStatus(record.status)) return record
    const control = this.lifecycleControlsByChildId.get(childId)
    await terminateLifecycleControl(control, 'parent_cancel', 5_000)
    this.boundariesByChildId.get(childId)?.abort(abortError('multi-agent child run was cancelled'))
    const waited = await this.waitForChild(parentThreadId, childId, { timeoutMs: 5_000 })
    return waited?.record ?? record
  }

  suspendChildExecutionDeadline(childId: string, token: string): boolean {
    const boundary = this.boundariesByChildId.get(childId)
    if (!boundary) return false
    return boundary.suspend(token)
  }

  resumeChildExecutionDeadline(childId: string, token: string): boolean {
    const boundary = this.boundariesByChildId.get(childId)
    if (!boundary) return false
    return boundary.resume(token)
  }

  async deleteChild(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null> {
    const cancelled = await this.cancelChild(parentThreadId, childId)
    if (!cancelled) return null
    const removed = await this.options.store.delete(parentThreadId, childId)
    if (!removed) return null
    try {
      await this.options.events?.onChildEvent?.({
        type: 'child_event',
        operation: 'delete',
        seq: ++this.eventSeq,
        childId: cancelled.id,
        parentThreadId: cancelled.parentThreadId,
        parentTurnId: cancelled.parentTurnId,
        status: cancelled.status,
        label: cancelled.label,
        summary: cancelled.summary,
        error: cancelled.error,
        createdAt: this.now()
      }, cancelled)
    } catch {
      // The durable record is already deleted. This event only refreshes views.
    }
    return cancelled
  }

  async transcript(
    parentThreadId: string,
    childId: string,
    options?: { offset?: number; limit?: number }
  ) {
    return this.options.store.readTranscript(parentThreadId, childId, options)
  }

  async diagnostics(parentThreadId?: string): Promise<MultiAgentDiagnostics> {
    const childRuns = (await this.options.store.list(parentThreadId ? { parentThreadId } : {}))
      .map((record) => normalizeRuntimeView(record, this.activeChildIds))
    return {
      contractVersion: MULTI_AGENT_CONTRACT_VERSION,
      config: this.config,
      active: this.active,
      activeLifecycleControls: this.lifecycleControlsByChildId.size,
      activeBoundaries: this.boundariesByChildId.size,
      childRuns,
      statusCounts: countStatuses(childRuns),
      usage: sumUsage(childRuns),
      aggregates: aggregateChildRuns(childRuns),
      storage: await this.options.store.diagnostics()
    }
  }

  async recoverStaleChildren(): Promise<MultiAgentChildRunRecord[]> {
    return this.withStartGate(async () => {
      const recovered: MultiAgentChildRunRecord[] = []
      const records = await this.options.store.list()
      for (const record of records) {
        if (isTerminalChildStatus(record.status) || this.activeChildIds.has(record.id)) continue
        const recoveredAt = this.now()
        const error = createMultiAgentError(
          'child_aborted',
          'multi-agent child run was interrupted before this runtime process started',
          {
            details: {
              staleStatus: record.status,
              originalUpdatedAt: record.updatedAt,
              recoveryReason: 'runtime_restart'
            }
          }
        )
        const next = MultiAgentChildRunRecord.parse({
          ...record,
          status: 'aborted',
          error,
          transcript: normalizeTranscript({
            record,
            status: 'aborted',
            error,
            finishedAt: recoveredAt,
            maxEntries: this.config.maxTranscriptEntries
          }),
          updatedAt: recoveredAt,
          finishedAt: recoveredAt
        })
        await this.persistAndEmit(next)
        recovered.push(next)
      }
      return recovered
    })
  }

  private assertCanStart(): void {
    if (!this.config.enabled) {
      throw new MultiAgentRuntimeError(createMultiAgentError('config_disabled', 'multi-agent runtime is disabled'))
    }
    if (!this.options.executor) {
      throw new MultiAgentRuntimeError(createMultiAgentError('executor_missing', 'multi-agent executor is not configured'))
    }
    if (this.active >= this.config.maxParallel) {
      throw new MultiAgentRuntimeError(createMultiAgentError(
        'parallel_budget_exhausted',
        `multi-agent parallel budget exhausted: ${this.active}/${this.config.maxParallel}. ` +
        'Wait for an existing child to reach a terminal state before starting another child.',
        { retryable: true }
      ))
    }
  }

  private async withStartGate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.startGate
    let release!: () => void
    this.startGate = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private async appendTranscript(
    record: MultiAgentChildRunRecord,
    entry: MultiAgentTranscriptEntryType
  ): Promise<MultiAgentChildRunRecord> {
    const parsed = MultiAgentTranscriptEntry.parse(entry)
    const updatedAt = this.now()
    const next = MultiAgentChildRunRecord.parse({
      ...record,
      transcript: trimTranscript(mergeTranscript(record.transcript, [parsed]), this.config.maxTranscriptEntries),
      updatedAt
    })
    // Transcript entries are consumed through the child's own event stream.
    // Persist them for inspection without publishing a parent child_event for
    // every token/tool update; parent notifications are lifecycle/identity only.
    await this.options.store.upsert(next)
    return next
  }

  private async persistAndEmit(record: MultiAgentChildRunRecord): Promise<void> {
    await this.options.store.upsert(record)
    try {
      await this.options.events?.onChildEvent?.({
        type: 'child_event',
        operation: 'upsert',
        seq: ++this.eventSeq,
        childId: record.id,
        parentThreadId: record.parentThreadId,
        parentTurnId: record.parentTurnId,
        status: record.status,
        label: record.label,
        summary: record.summary,
        error: record.error,
        createdAt: record.updatedAt
      }, record)
    } catch {
      // Child events are refresh notifications. The persisted child record is the
      // canonical state, so a notification transport failure must not abort work.
    }
  }

  private recordUsage(record: MultiAgentChildRunRecord): void {
    if (record.status !== 'completed') return
    const usage = record.usage
    const hasUsage = usage.totalTokens > 0 || usage.costUsd !== undefined || usage.costCny !== undefined
    if (hasUsage) this.options.recordUsage?.(record.parentThreadId, usage)
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}

export function createMultiAgentError(
  code: MultiAgentErrorCode,
  message: string,
  options: { retryable?: boolean; details?: unknown } = {}
): MultiAgentErrorInfo {
  return {
    code,
    message,
    ...(options.retryable !== undefined ? { retryable: options.retryable } : {}),
    ...(options.details !== undefined ? { details: options.details } : {})
  }
}

export function aggregateChildRuns(records: readonly MultiAgentChildRunRecord[]): MultiAgentChildRunAggregate[] {
  const buckets = new Map<string, MultiAgentChildRunAggregate>()
  for (const record of records) {
    const label = record.label?.trim() || undefined
    const model = record.model?.trim() || undefined
    const key = `${label ?? 'unlabeled'}:${model ?? 'default'}`
    const bucket = buckets.get(key) ?? {
      key,
      ...(label ? { label } : {}),
      ...(model ? { model } : {}),
      runs: 0,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      aborted: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      averageTotalTokens: 0
    }
    bucket.runs += 1
    bucket[record.status] += 1
    bucket.promptTokens += record.usage.promptTokens
    bucket.completionTokens += record.usage.completionTokens
    bucket.totalTokens += record.usage.totalTokens
    if (record.usage.costUsd !== undefined) bucket.costUsd = (bucket.costUsd ?? 0) + record.usage.costUsd
    if (record.usage.costCny !== undefined) bucket.costCny = (bucket.costCny ?? 0) + record.usage.costCny
    bucket.averageTotalTokens = bucket.runs > 0 ? bucket.totalTokens / bucket.runs : 0
    bucket.averageCostUsd = bucket.costUsd !== undefined && bucket.runs > 0 ? bucket.costUsd / bucket.runs : undefined
    bucket.averageCostCny = bucket.costCny !== undefined && bucket.runs > 0 ? bucket.costCny / bucket.runs : undefined
    buckets.set(key, bucket)
  }
  return [...buckets.values()]
    .map((bucket) => MultiAgentChildRunAggregate.parse(bucket))
    .sort((a, b) => b.runs - a.runs || b.totalTokens - a.totalTokens || a.key.localeCompare(b.key))
}

type NormalizedRunChildInput = Required<Pick<RunChildInput, 'parentThreadId' | 'parentTurnId' | 'prompt'>> & Omit<RunChildInput, 'parentThreadId' | 'parentTurnId' | 'prompt' | 'signal'>

function normalizeRunChildInput(input: RunChildInput): NormalizedRunChildInput {
  const parentThreadId = input.parentThreadId.trim()
  const parentTurnId = input.parentTurnId.trim()
  const prompt = input.prompt.trim()
  if (!parentThreadId || !parentTurnId) {
    throw new MultiAgentRuntimeError(createMultiAgentError('invalid_input', 'parentThreadId and parentTurnId are required'))
  }
  if (!prompt) {
    throw new MultiAgentRuntimeError(createMultiAgentError('prompt_required', 'delegate_task prompt is required'))
  }
  return {
    parentThreadId,
    parentTurnId,
    prompt,
    requestId: trimOptional(input.requestId),
    label: trimOptional(input.label),
    workspace: trimOptional(input.workspace),
    model: trimOptional(input.model),
    allowedToolNames: normalizeAllowedToolNames(input.allowedToolNames),
    brokerScope: normalizeBrokerScope(input.brokerScope),
    deadlineMs: normalizeDeadlineMs(input.deadlineMs),
    strictAllowedToolNames: input.strictAllowedToolNames === true,
    bashCommandPolicy: input.bashCommandPolicy,
    filePathPolicy: input.filePathPolicy,
    maxToolCalls: normalizePositiveInteger(input.maxToolCalls),
    resumeThreadRef: input.resumeThreadRef
  }
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : undefined
}

function normalizeDeadlineMs(value: number | undefined): number | undefined {
  const normalized = normalizePositiveInteger(value)
  return normalized === undefined ? undefined : Math.min(normalized, 600_000)
}

function normalizeBrokerScope(
  value: RunChildInput['brokerScope']
): RunChildInput['brokerScope'] {
  if (!value || value.providerFamily !== 'managed-mcp') return undefined
  const packageId = value.packageId?.trim()
  return Object.freeze({ providerFamily: 'managed-mcp' as const, ...(packageId ? { packageId } : {}) })
}

function normalizeWaitTimeoutMs(value: number | undefined): number {
  if (value === undefined) return 30_000
  if (!Number.isFinite(value)) return 30_000
  return Math.max(0, Math.min(60_000, Math.trunc(value)))
}

function normalizeAllowedToolNames(value: readonly string[] | undefined): string[] | undefined {
  if (!value) return undefined
  const names = value
    .map((entry) => entry.trim())
    .filter(Boolean)
  return [...new Set(names)]
}

function normalizeUsage(usage: Partial<MultiAgentUsageType> | undefined): MultiAgentUsageType {
  const { hasError: _hasError, ...publicUsage } = (usage ?? {}) as Record<string, unknown>
  return MultiAgentUsage.parse(publicUsage)
}

function summaryFromResult(result: MultiAgentExecutorResult): string | undefined {
  const summary = result.summary?.trim()
  if (summary) return summary
  const assistantMessage = [...(result.transcript ?? [])]
    .reverse()
    .find((entry) => entry.kind === 'assistant_message' && entry.text?.trim())
  return assistantMessage?.text?.trim()
}

function normalizeTranscript(input: {
  record: MultiAgentChildRunRecord
  status?: MultiAgentChildStatus
  transcript?: readonly MultiAgentTranscriptEntryType[]
  summary?: string
  error?: MultiAgentErrorInfo
  finishedAt: string
  maxEntries: number
}): MultiAgentTranscriptEntryType[] {
  const resultEntries = MultiAgentTranscriptEntry.array().catch([]).parse(input.transcript ?? [])
  const entries = mergeTranscript(input.record.transcript, resultEntries)
  const withPrompt = entries.some((entry) => entry.kind === 'user_message')
    ? entries
    : [{
        id: `${input.record.id}-prompt`,
        kind: 'user_message' as const,
        text: input.record.prompt,
        createdAt: input.record.createdAt
      }, ...entries]

  let finalized = withPrompt
  if (input.summary && !finalized.some((entry) => entry.kind === 'assistant_message' && entry.text === input.summary)) {
    finalized = [...finalized, {
      id: `${input.record.id}-summary`,
      kind: 'assistant_message',
      text: input.summary,
      createdAt: input.finishedAt
    }]
  }
  const error = input.error
  if (error && !finalized.some((entry) => entry.metadata?.code === error.code && entry.text === error.message)) {
    finalized = [...finalized, {
      id: `${input.record.id}-error`,
      kind: 'event',
      text: error.message,
      status: input.status ?? input.record.status,
      createdAt: input.finishedAt,
      metadata: { code: error.code }
    }]
  }
  return trimTranscript(finalized, input.maxEntries)
}

function mergeTranscript(
  current: readonly MultiAgentTranscriptEntryType[],
  incoming: readonly MultiAgentTranscriptEntryType[]
): MultiAgentTranscriptEntryType[] {
  const byId = new Map<string, MultiAgentTranscriptEntryType>()
  for (const entry of current) byId.set(entry.id, entry)
  for (const entry of incoming) byId.set(entry.id, entry)
  return [...byId.values()]
}

function trimTranscript(
  entries: readonly MultiAgentTranscriptEntryType[],
  maxEntries: number
): MultiAgentTranscriptEntryType[] {
  if (entries.length <= maxEntries) return [...entries]
  return entries.slice(entries.length - maxEntries)
}

function errorInfoFromThrown(error: unknown): MultiAgentErrorInfo {
  if (error instanceof MultiAgentRuntimeError) return error.toJSON()
  if (isAbortError(error)) return createMultiAgentError('child_aborted', 'multi-agent child run was aborted')
  return createMultiAgentError('child_failed', error instanceof Error ? error.message : String(error))
}

function executorFailureDetailsFromThrown(error: unknown): {
  summary?: string
  transcript?: readonly MultiAgentTranscriptEntryType[]
  usage?: Partial<MultiAgentUsageType>
  threadRef?: MultiAgentChildThreadRef
} {
  if (!error || typeof error !== 'object') return {}
  const record = error as Record<string, unknown>
  const transcriptResult = MultiAgentTranscriptEntry.array().safeParse(record.subagentTranscript)
  const usageResult = MultiAgentUsage.partial().safeParse(record.subagentUsage)
  const threadRefResult = MultiAgentChildThreadRef.safeParse(record.multiAgentThreadRef)
  const explicitSummary = typeof record.subagentSummary === 'string'
    ? record.subagentSummary.trim()
    : ''
  const transcriptSummary = transcriptResult.success
    ? [...transcriptResult.data]
        .reverse()
        .find((entry) => entry.kind === 'assistant_message' && entry.text?.trim())
        ?.text?.trim()
    : undefined
  const summary = explicitSummary || transcriptSummary
  return {
    ...(summary ? { summary } : {}),
    ...(transcriptResult.success ? { transcript: transcriptResult.data } : {}),
    ...(usageResult.success ? { usage: usageResult.data } : {}),
    ...(threadRefResult.success ? { threadRef: threadRefResult.data } : {})
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'))
}

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function isTerminalChildStatus(status: MultiAgentChildStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted'
}

function countStatuses(records: readonly MultiAgentChildRunRecord[]): Record<MultiAgentChildStatus, number> {
  const counts: Record<MultiAgentChildStatus, number> = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    aborted: 0
  }
  for (const record of records) counts[record.status] += 1
  return counts
}

function normalizeRuntimeView(
  record: MultiAgentChildRunRecord,
  activeChildIds: ReadonlySet<string>
): MultiAgentChildRunRecord {
  if ((record.status !== 'queued' && record.status !== 'running') || activeChildIds.has(record.id)) {
    return record
  }
  return MultiAgentChildRunRecord.parse({
    ...record,
    status: 'aborted',
    error: record.error ?? createMultiAgentError(
      'child_aborted',
      'multi-agent child run is no longer active in this runtime process',
      { details: { staleStatus: record.status } }
    ),
    finishedAt: record.finishedAt ?? record.updatedAt
  })
}

function sumUsage(records: readonly MultiAgentChildRunRecord[]): MultiAgentUsageType {
  const usage: MultiAgentUsageType = { ...EMPTY_MULTI_AGENT_USAGE }
  for (const record of records) {
    usage.promptTokens += record.usage.promptTokens
    usage.completionTokens += record.usage.completionTokens
    usage.totalTokens += record.usage.totalTokens
    usage.cachedTokens = sumOptional(usage.cachedTokens, record.usage.cachedTokens)
    usage.cacheHitTokens = sumOptional(usage.cacheHitTokens, record.usage.cacheHitTokens)
    usage.cacheMissTokens = sumOptional(usage.cacheMissTokens, record.usage.cacheMissTokens)
    usage.costUsd = sumOptional(usage.costUsd, record.usage.costUsd)
    usage.costCny = sumOptional(usage.costCny, record.usage.costCny)
    usage.cacheSavingsUsd = sumOptional(usage.cacheSavingsUsd, record.usage.cacheSavingsUsd)
    usage.cacheSavingsCny = sumOptional(usage.cacheSavingsCny, record.usage.cacheSavingsCny)
    usage.tokenEconomySavingsTokens = sumOptional(
      usage.tokenEconomySavingsTokens,
      record.usage.tokenEconomySavingsTokens
    )
    usage.tokenEconomySavingsUsd = sumOptional(usage.tokenEconomySavingsUsd, record.usage.tokenEconomySavingsUsd)
    usage.tokenEconomySavingsCny = sumOptional(usage.tokenEconomySavingsCny, record.usage.tokenEconomySavingsCny)
  }
  if (usage.cacheHitTokens !== undefined && usage.cachedTokens && usage.cachedTokens > 0) {
    usage.cacheHitRate = usage.cacheHitTokens / usage.cachedTokens
  }
  return MultiAgentUsage.parse(usage)
}

function sumOptional(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current
  return (current ?? 0) + next
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}


function childRequestKey(parentThreadId: string, parentTurnId: string, requestId: string): string {
  return `${parentThreadId}\u0000${parentTurnId}\u0000${requestId}`
}

function randomChildId(): string {
  return `child_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function terminateLifecycleControl(
  control: MultiAgentLifecycleControl | undefined,
  reason: MultiAgentTerminationReason,
  timeoutMs: number
): Promise<void> {
  if (!control) return
  const termination = startBoundedLifecycleCall(
    timeoutMs,
    (signal) => control.terminate({ reason, signal })
  )
  const outcome = await termination.outcome
  if (outcome.kind === 'timed_out') {
    termination.cancel(new Error(`multi-agent ${reason} termination timed out`))
  }
}

function startBoundedLifecycleCall<T>(
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<T>
): {
  outcome: Promise<
    | { kind: 'completed'; value: T }
    | { kind: 'failed'; error: unknown }
    | { kind: 'timed_out' }
    | { kind: 'cancelled' }
  >
  cancel(reason?: unknown): void
} {
  const controller = new AbortController()
  let resolveDeadline!: (
    outcome: { kind: 'timed_out' } | { kind: 'cancelled' }
  ) => void
  let settled = false
  const deadline = new Promise<{ kind: 'timed_out' } | { kind: 'cancelled' }>((resolve) => {
    resolveDeadline = resolve
  })
  const timeoutHandle = setTimeout(() => {
    if (settled) return
    controller.abort(new Error('multi-agent lifecycle control timed out'))
    resolveDeadline({ kind: 'timed_out' })
  }, timeoutMs)
  const callOutcome = Promise.resolve()
    .then(() => call(controller.signal))
    .then(
      (value) => ({ kind: 'completed' as const, value }),
      (error: unknown) => ({ kind: 'failed' as const, error })
    )
  const outcome = Promise.race([callOutcome, deadline]).finally(() => {
    settled = true
    clearTimeout(timeoutHandle)
  })
  return {
    outcome,
    cancel(reason?: unknown) {
      if (settled) return
      controller.abort(reason)
      resolveDeadline({ kind: 'cancelled' })
    }
  }
}

function startDeadline(timeoutMs: number): {
  promise: Promise<void>
  cancel(): void
} {
  let resolveDeadline!: () => void
  const promise = new Promise<void>((resolve) => {
    resolveDeadline = resolve
  })
  const timeoutHandle = setTimeout(resolveDeadline, timeoutMs)
  return {
    promise,
    cancel() {
      clearTimeout(timeoutHandle)
    }
  }
}

function abortPromise(signal: AbortSignal | undefined): {
  promise: Promise<void>
  dispose(): void
} {
  let resolveAbort!: () => void
  const promise = new Promise<void>((resolve) => {
    resolveAbort = resolve
  })
  const onAbort = () => resolveAbort()
  if (signal?.aborted) resolveAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  return {
    promise,
    dispose() {
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}

function createExecutionBoundary(parentSignal: AbortSignal | undefined, deadlineMs: number | undefined) {
  const controller = new AbortController()
  const suspensionTokens = new Set<string>()
  let remainingMs = deadlineMs
  let activeSince = deadlineMs === undefined ? undefined : Date.now()
  let deadlineHandle: ReturnType<typeof setTimeout> | undefined
  let resolveParentAbort!: () => void
  const parentAborted = new Promise<void>((resolve) => {
    resolveParentAbort = resolve
  })
  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason)
    resolveParentAbort()
  }
  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })

  const abortFromDeadline = () => {
    if (!controller.signal.aborted) controller.abort(abortError('multi-agent child execution deadline exceeded'))
    resolveParentAbort()
  }
  const stopDeadlineClock = () => {
    if (remainingMs === undefined || activeSince === undefined) return
    remainingMs = Math.max(0, remainingMs - Math.max(0, Date.now() - activeSince))
    activeSince = undefined
    if (deadlineHandle !== undefined) clearTimeout(deadlineHandle)
    deadlineHandle = undefined
  }
  const startDeadlineClock = () => {
    if (remainingMs === undefined || controller.signal.aborted || suspensionTokens.size > 0) return
    if (remainingMs <= 0) {
      abortFromDeadline()
      return
    }
    activeSince = Date.now()
    deadlineHandle = setTimeout(abortFromDeadline, remainingMs)
  }
  startDeadlineClock()
  return {
    signal: controller.signal,
    parentAborted,
    suspend(token: string) {
      if (!token || controller.signal.aborted || suspensionTokens.has(token)) return false
      if (suspensionTokens.size === 0) stopDeadlineClock()
      suspensionTokens.add(token)
      return true
    },
    resume(token: string) {
      if (!suspensionTokens.delete(token)) return false
      if (suspensionTokens.size > 0) return true
      startDeadlineClock()
      return true
    },
    abort(reason?: unknown) {
      if (!controller.signal.aborted) controller.abort(reason)
    },
    dispose() {
      if (deadlineHandle !== undefined) clearTimeout(deadlineHandle)
      suspensionTokens.clear()
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
  }
}
