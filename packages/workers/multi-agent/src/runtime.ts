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
  strictAllowedToolNames?: boolean
  bashCommandPolicy?: Record<string, unknown>
  filePathPolicy?: Record<string, unknown>
  maxToolCalls?: number
  childTimeoutMs?: number
  signal?: AbortSignal
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

const TIMEOUT_PROGRESS_SUMMARY_MESSAGE = [
  'Your child run exceeded its execution deadline.',
  'Stop starting new work and return a concise progress summary now.',
  'Include completed work, files changed, verification or evidence, unfinished work, and blockers.',
  'Do not call more tools unless one is strictly required to produce the summary.'
].join(' ')

export class MultiAgentRuntime {
  private readonly config: MultiAgentRuntimeConfigType
  private active = 0
  private readonly activeChildIds = new Set<string>()
  private readonly pendingChildReservations = new Map<string, number>()
  private readonly activeRequestsByKey = new Map<string, Promise<MultiAgentChildRunRecord>>()
  private startGate: Promise<void> = Promise.resolve()
  private eventSeq = 0

  constructor(private readonly options: MultiAgentRuntimeOptions) {
    this.config = MultiAgentRuntimeConfig.parse(options.config ?? {})
  }

  async runChild(input: RunChildInput): Promise<MultiAgentChildRunRecord> {
    const normalized = normalizeRunChildInput(input)
    const requestKey = normalized.requestId
      ? childRequestKey(normalized.parentThreadId, normalized.parentTurnId, normalized.requestId)
      : ''
    const activeRequest = requestKey ? this.activeRequestsByKey.get(requestKey) : undefined
    if (activeRequest) return activeRequest

    const execution = this.executeChild(input)
    if (requestKey) this.activeRequestsByKey.set(requestKey, execution)
    try {
      return await execution
    } finally {
      if (requestKey && this.activeRequestsByKey.get(requestKey) === execution) {
        this.activeRequestsByKey.delete(requestKey)
      }
    }
  }

  private async executeChild(input: RunChildInput): Promise<MultiAgentChildRunRecord> {
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
      await this.assertCanStart(normalized.parentThreadId, normalized.parentTurnId)
      const id = this.options.idGenerator?.() ?? randomChildId()
      this.active += 1
      this.activeChildIds.add(id)
      this.incrementPendingChildReservation(normalized.parentThreadId, normalized.parentTurnId)
      return { id } as const
    })
    if ('replayed' in reservation) {
      return normalizeRuntimeView(reservation.replayed, this.activeChildIds)
    }

    const executor = this.options.executor
    if (!executor) {
      throw new MultiAgentRuntimeError(createMultiAgentError('executor_missing', 'multi-agent executor is not configured'))
    }
    const id = reservation.id
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
      this.releasePendingChildReservation(normalized.parentThreadId, normalized.parentTurnId)
      this.active -= 1
      this.activeChildIds.delete(id)
      throw error
    }
    this.releasePendingChildReservation(normalized.parentThreadId, normalized.parentTurnId)

    const boundary = createExecutionBoundary(input.signal, normalized.childTimeoutMs ?? this.config.childTimeoutMs)
    let acceptingTranscript = true
    let childTimedOut = false
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
          strictAllowedToolNames: normalized.strictAllowedToolNames,
          bashCommandPolicy: normalized.bashCommandPolicy,
          filePathPolicy: normalized.filePathPolicy,
          maxToolCalls: normalized.maxToolCalls,
          signal: boundary.signal,
          registerLifecycleControl: (control) => {
            if (!boundary.signal.aborted) lifecycleControl = control
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
        boundary.timeout.then(() => ({ kind: 'timeout' as const })),
        boundary.parentAborted.then(() => ({ kind: 'parent_abort' as const }))
      ])
      if (initialOutcome.kind === 'parent_abort') {
        await terminateLifecycleControl(
          lifecycleControl,
          'parent_abort',
          this.config.timeoutHandshakeMs
        )
        throw new MultiAgentRuntimeError(createMultiAgentError(
          'child_aborted',
          'multi-agent child run was aborted'
        ))
      }
      if (initialOutcome.kind === 'timeout') {
        childTimedOut = true
        throw await timeoutFailureAfterHandshake({
          executorOutcome,
          lifecycleControl,
          boundary,
          handshakeMs: this.config.timeoutHandshakeMs,
          summaryGraceMs: this.config.timeoutSummaryGraceMs
        })
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
        threadRef: result.threadRef,
        updatedAt: finishedAt,
        finishedAt
      })
      await this.persistAndEmit(record)
      this.recordUsage(record)
      return record
    } catch (error) {
      const finishedAt = this.now()
      const errorInfo = errorInfoFromThrown(error, childTimedOut)
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
      this.active -= 1
      this.activeChildIds.delete(id)
    }
  }

  async child(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null> {
    const record = await this.options.store.get(parentThreadId, childId)
    return record ? normalizeRuntimeView(record, this.activeChildIds) : null
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
      childRuns,
      statusCounts: countStatuses(childRuns),
      usage: sumUsage(childRuns),
      aggregates: aggregateChildRuns(childRuns),
      storage: await this.options.store.diagnostics()
    }
  }

  private async assertCanStart(parentThreadId: string, parentTurnId: string): Promise<void> {
    if (!this.config.enabled) {
      throw new MultiAgentRuntimeError(createMultiAgentError('config_disabled', 'multi-agent runtime is disabled'))
    }
    if (!this.options.executor) {
      throw new MultiAgentRuntimeError(createMultiAgentError('executor_missing', 'multi-agent executor is not configured'))
    }
    if (this.active >= this.config.maxParallel) {
      throw new MultiAgentRuntimeError(createMultiAgentError(
        'parallel_budget_exhausted',
        `multi-agent parallel budget exhausted: ${this.active}/${this.config.maxParallel}`,
        { retryable: true }
      ))
    }
    const existing = (await this.options.store.list({ parentThreadId }))
      .filter((record) => record.parentTurnId === parentTurnId)
    const reserved = this.pendingChildReservations.get(childReservationKey(parentThreadId, parentTurnId)) ?? 0
    if (existing.length + reserved >= this.config.maxChildren) {
      throw new MultiAgentRuntimeError(createMultiAgentError(
        'child_budget_exhausted',
        `multi-agent child budget exhausted for parent turn ${parentTurnId}: ${existing.length + reserved}/${this.config.maxChildren}`
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

  private incrementPendingChildReservation(parentThreadId: string, parentTurnId: string): void {
    const key = childReservationKey(parentThreadId, parentTurnId)
    this.pendingChildReservations.set(key, (this.pendingChildReservations.get(key) ?? 0) + 1)
  }

  private releasePendingChildReservation(parentThreadId: string, parentTurnId: string): void {
    const key = childReservationKey(parentThreadId, parentTurnId)
    const next = (this.pendingChildReservations.get(key) ?? 1) - 1
    if (next > 0) this.pendingChildReservations.set(key, next)
    else this.pendingChildReservations.delete(key)
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
    await this.persistAndEmit(next)
    return next
  }

  private async persistAndEmit(record: MultiAgentChildRunRecord): Promise<void> {
    await this.options.store.upsert(record)
    await this.options.events?.onChildEvent?.({
      type: 'child_event',
      seq: ++this.eventSeq,
      childId: record.id,
      parentThreadId: record.parentThreadId,
      parentTurnId: record.parentTurnId,
      status: record.status,
      label: record.label,
      summary: record.summary,
      error: record.error,
      createdAt: record.updatedAt
    })
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

function normalizeRunChildInput(input: RunChildInput): Required<Pick<RunChildInput, 'parentThreadId' | 'parentTurnId' | 'prompt'>> & Omit<RunChildInput, 'parentThreadId' | 'parentTurnId' | 'prompt' | 'signal'> {
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
    strictAllowedToolNames: input.strictAllowedToolNames === true,
    bashCommandPolicy: input.bashCommandPolicy,
    filePathPolicy: input.filePathPolicy,
    maxToolCalls: normalizePositiveInteger(input.maxToolCalls),
    childTimeoutMs: normalizeChildTimeoutMs(input.childTimeoutMs)
  }
}

function normalizeChildTimeoutMs(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : undefined
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : undefined
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

function errorInfoFromThrown(error: unknown, timedOut: boolean): MultiAgentErrorInfo {
  if (error instanceof MultiAgentRuntimeError) return error.toJSON()
  if (timedOut) {
    const details = objectRecord(error).multiAgentTimeoutDetails
    return createMultiAgentError('timeout', 'multi-agent child run timed out', {
      retryable: true,
      ...(details !== undefined ? { details } : {})
    })
  }
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
  const transcriptResult = MultiAgentTranscriptEntry.array().safeParse(record.multiAgentTranscript)
  const usageResult = MultiAgentUsage.partial().safeParse(record.multiAgentUsage)
  const threadRefResult = MultiAgentChildThreadRef.safeParse(record.multiAgentThreadRef)
  const explicitSummary = typeof record.multiAgentSummary === 'string'
    ? record.multiAgentSummary.trim()
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

function childReservationKey(parentThreadId: string, parentTurnId: string): string {
  return `${parentThreadId}\u0000${parentTurnId}`
}

function childRequestKey(parentThreadId: string, parentTurnId: string, requestId: string): string {
  return `${parentThreadId}\u0000${parentTurnId}\u0000${requestId}`
}

function randomChildId(): string {
  return `child_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function timeoutFailureAfterHandshake(input: {
  executorOutcome: Promise<ExecutorOutcome>
  lifecycleControl?: MultiAgentLifecycleControl
  boundary: ReturnType<typeof createExecutionBoundary>
  handshakeMs: number
  summaryGraceMs: number
}): Promise<Error> {
  const control = input.lifecycleControl
  if (!control) {
    const error = timeoutFailureError({
      disposition: 'channel_unavailable'
    })
    input.boundary.abort(error)
    return error
  }

  const summaryRequest = startBoundedLifecycleCall(
    input.handshakeMs,
    (signal) => control.requestProgressSummary({
      reason: 'timeout',
      message: TIMEOUT_PROGRESS_SUMMARY_MESSAGE,
      signal
    })
  )
  const handshake = await Promise.race([
    summaryRequest.outcome.then((outcome) => ({ kind: 'handshake' as const, outcome })),
    input.executorOutcome.then((outcome) => ({ kind: 'executor' as const, outcome })),
    input.boundary.parentAborted.then(() => ({ kind: 'parent_abort' as const }))
  ])

  if (handshake.kind === 'parent_abort') {
    summaryRequest.cancel(new Error('parent aborted during timeout summary handshake'))
    await terminateLifecycleControl(control, 'parent_abort', input.handshakeMs)
    throw new MultiAgentRuntimeError(createMultiAgentError(
      'child_aborted',
      'multi-agent child run was aborted'
    ))
  }
  if (handshake.kind === 'executor') {
    summaryRequest.cancel(new Error('child settled during timeout summary handshake'))
    return timeoutFailureError({
      disposition: 'child_settled_during_handshake',
      outcome: handshake.outcome,
      fallbackThreadRef: control.threadRef
    })
  }

  const channelEstablished = handshake.outcome.kind === 'completed' &&
    handshake.outcome.value.established === true
  if (!channelEstablished) {
    await terminateLifecycleControl(
      control,
      'timeout_channel_unavailable',
      input.handshakeMs
    )
    const errorWithoutOutcome = timeoutFailureError({
      disposition: 'channel_unavailable',
      fallbackThreadRef: control.threadRef
    })
    input.boundary.abort(errorWithoutOutcome)
    const outcome = await executorOutcomeAfterAbort(
      input.executorOutcome,
      input.handshakeMs
    )
    return timeoutFailureError({
      disposition: 'channel_unavailable',
      ...(outcome ? { outcome } : {}),
      fallbackThreadRef: control.threadRef
    })
  }

  const summaryGrace = startDeadline(input.summaryGraceMs)
  const summary = await Promise.race([
    input.executorOutcome.then((outcome) => ({ kind: 'executor' as const, outcome })),
    input.boundary.parentAborted.then(() => ({ kind: 'parent_abort' as const })),
    summaryGrace.promise.then(() => ({ kind: 'grace_expired' as const }))
  ])
  summaryGrace.cancel()

  if (summary.kind === 'parent_abort') {
    await terminateLifecycleControl(control, 'parent_abort', input.handshakeMs)
    throw new MultiAgentRuntimeError(createMultiAgentError(
      'child_aborted',
      'multi-agent child run was aborted'
    ))
  }
  if (summary.kind === 'executor') {
    return timeoutFailureError({
      disposition: summary.outcome.kind === 'result'
        ? 'progress_summary_received'
        : 'child_failed_after_summary_request',
      outcome: summary.outcome,
      fallbackThreadRef: control.threadRef
    })
  }

  await terminateLifecycleControl(
    control,
    'timeout_summary_grace_expired',
    input.handshakeMs
  )
  const errorWithoutOutcome = timeoutFailureError({
    disposition: 'summary_grace_expired',
    fallbackThreadRef: control.threadRef
  })
  input.boundary.abort(errorWithoutOutcome)
  const outcome = await executorOutcomeAfterAbort(
    input.executorOutcome,
    input.handshakeMs
  )
  return timeoutFailureError({
    disposition: 'summary_grace_expired',
    ...(outcome ? { outcome } : {}),
    fallbackThreadRef: control.threadRef
  })
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

function timeoutFailureError(input: {
  disposition: string
  outcome?: ExecutorOutcome
  fallbackThreadRef?: MultiAgentChildThreadRef
}): Error {
  const failure = input.outcome?.kind === 'error'
    ? executorFailureDetailsFromThrown(input.outcome.error)
    : undefined
  const result = input.outcome?.kind === 'result'
    ? input.outcome.result
    : undefined
  const summary = result ? summaryFromResult(result) : failure?.summary
  return Object.assign(new Error('multi-agent child run timed out'), {
    multiAgentTimeoutDetails: {
      disposition: input.disposition
    },
    ...(summary ? { multiAgentSummary: summary } : {}),
    ...(result?.transcript || failure?.transcript
      ? { multiAgentTranscript: result?.transcript ?? failure?.transcript }
      : {}),
    ...(result?.usage || failure?.usage
      ? { multiAgentUsage: result?.usage ?? failure?.usage }
      : {}),
    ...(result?.threadRef || failure?.threadRef || input.fallbackThreadRef
      ? {
          multiAgentThreadRef:
            result?.threadRef ?? failure?.threadRef ?? input.fallbackThreadRef
        }
      : {})
  })
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

async function executorOutcomeAfterAbort(
  executorOutcome: Promise<ExecutorOutcome>,
  timeoutMs: number
): Promise<ExecutorOutcome | undefined> {
  const deadline = startDeadline(timeoutMs)
  const outcome = await Promise.race([
    executorOutcome.then((value) => ({ kind: 'executor' as const, value })),
    deadline.promise.then(() => ({ kind: 'deadline' as const }))
  ])
  deadline.cancel()
  return outcome.kind === 'executor' ? outcome.value : undefined
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}

function createExecutionBoundary(parentSignal: AbortSignal | undefined, timeoutMs: number | undefined) {
  const controller = new AbortController()
  let resolveParentAbort!: () => void
  let resolveTimeout!: () => void
  const parentAborted = new Promise<void>((resolve) => {
    resolveParentAbort = resolve
  })
  const timeout = new Promise<void>((resolve) => {
    resolveTimeout = resolve
  })
  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason)
    resolveParentAbort()
  }
  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  const timeoutHandle = timeoutMs === undefined
    ? undefined
    : setTimeout(() => {
        resolveTimeout()
      }, timeoutMs)
  return {
    signal: controller.signal,
    timeout,
    parentAborted,
    abort(reason?: unknown) {
      if (!controller.signal.aborted) controller.abort(reason)
    },
    dispose() {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
  }
}
