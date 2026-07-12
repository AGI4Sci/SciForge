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
  type MultiAgentExecutorResult,
  type MultiAgentRuntimeConfig as MultiAgentRuntimeConfigType,
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

export class MultiAgentRuntime {
  private readonly config: MultiAgentRuntimeConfigType
  private active = 0
  private readonly activeChildIds = new Set<string>()
  private eventSeq = 0

  constructor(private readonly options: MultiAgentRuntimeOptions) {
    this.config = MultiAgentRuntimeConfig.parse(options.config ?? {})
  }

  async runChild(input: RunChildInput): Promise<MultiAgentChildRunRecord> {
    const normalized = normalizeRunChildInput(input)
    if (normalized.requestId) {
      const replayed = await this.options.store.findByRequest(
        normalized.parentThreadId,
        normalized.parentTurnId,
        normalized.requestId
      )
      if (replayed) return normalizeRuntimeView(replayed, this.activeChildIds)
    }
    await this.assertCanStart(normalized.parentThreadId, normalized.parentTurnId)
    const executor = this.options.executor
    if (!executor) {
      throw new MultiAgentRuntimeError(createMultiAgentError('executor_missing', 'multi-agent executor is not configured'))
    }

    const id = this.options.idGenerator?.() ?? randomChildId()
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
    await this.persistAndEmit(record)

    const boundary = createExecutionBoundary(input.signal, normalized.childTimeoutMs ?? this.config.childTimeoutMs)
    let acceptingTranscript = true
    this.active += 1
    this.activeChildIds.add(id)
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

      const result = await Promise.race([
        executor({
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
          appendTranscript: async (entry) => {
            if (!acceptingTranscript) return
            record = await this.appendTranscript(record, entry)
          }
        }),
        boundary.aborted
      ])
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
      const errorInfo = errorInfoFromThrown(error, boundary.timedOut)
      const failureDetails = executorFailureDetailsFromThrown(error)
      const status = errorInfo.code === 'child_aborted' ? 'aborted' : 'failed'
      record = MultiAgentChildRunRecord.parse({
        ...record,
        status,
        error: errorInfo,
        usage: normalizeUsage(failureDetails.usage),
        transcript: normalizeTranscript({
          record,
          transcript: failureDetails.transcript,
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
    if (existing.length >= this.config.maxChildren) {
      throw new MultiAgentRuntimeError(createMultiAgentError(
        'child_budget_exhausted',
        `multi-agent child budget exhausted for parent turn ${parentTurnId}: ${existing.length}/${this.config.maxChildren}`
      ))
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

  if (input.summary && !withPrompt.some((entry) => entry.kind === 'assistant_message' && entry.text === input.summary)) {
    return trimTranscript([...withPrompt, {
      id: `${input.record.id}-summary`,
      kind: 'assistant_message',
      text: input.summary,
      createdAt: input.finishedAt
    }], input.maxEntries)
  }
  const error = input.error
  if (error && !withPrompt.some((entry) => entry.metadata?.code === error.code && entry.text === error.message)) {
    return trimTranscript([...withPrompt, {
      id: `${input.record.id}-error`,
      kind: 'event',
      text: error.message,
      status: input.status ?? input.record.status,
      createdAt: input.finishedAt,
      metadata: { code: error.code }
    }], input.maxEntries)
  }
  return trimTranscript(withPrompt, input.maxEntries)
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
  if (timedOut) return createMultiAgentError('timeout', 'multi-agent child run timed out', { retryable: true })
  if (error instanceof MultiAgentRuntimeError) return error.toJSON()
  if (isAbortError(error)) return createMultiAgentError('child_aborted', 'multi-agent child run was aborted')
  return createMultiAgentError('child_failed', error instanceof Error ? error.message : String(error))
}

function executorFailureDetailsFromThrown(error: unknown): {
  transcript?: readonly MultiAgentTranscriptEntryType[]
  usage?: Partial<MultiAgentUsageType>
  threadRef?: MultiAgentChildThreadRef
} {
  if (!error || typeof error !== 'object') return {}
  const record = error as Record<string, unknown>
  const transcriptResult = MultiAgentTranscriptEntry.array().safeParse(record.multiAgentTranscript)
  const usageResult = MultiAgentUsage.partial().safeParse(record.multiAgentUsage)
  const threadRefResult = MultiAgentChildThreadRef.safeParse(record.multiAgentThreadRef)
  return {
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

function randomChildId(): string {
  return `child_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function createExecutionBoundary(parentSignal: AbortSignal | undefined, timeoutMs: number | undefined) {
  const controller = new AbortController()
  let timedOut = false
  let closed = false
  let rejectAbort: ((error: Error) => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  aborted.catch(() => undefined)
  const rejectOnce = (error: Error) => {
    if (closed) return
    closed = true
    rejectAbort?.(error)
  }
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason)
    rejectOnce(new Error('multi-agent child run aborted'))
  }
  if (parentSignal?.aborted) controller.abort(parentSignal.reason)
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  const timeout = timeoutMs === undefined
    ? undefined
    : setTimeout(() => {
        timedOut = true
        const error = new Error('multi-agent child run timed out')
        controller.abort(error)
        rejectOnce(error)
      }, timeoutMs)
  return {
    signal: controller.signal,
    aborted,
    get timedOut() {
      return timedOut
    },
    dispose() {
      closed = true
      if (timeout) clearTimeout(timeout)
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
  }
}
