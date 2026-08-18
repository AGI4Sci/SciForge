import { z } from 'zod'

export const MULTI_AGENT_CONTRACT_VERSION = 2

export const MultiAgentChildStatus = z.enum(['queued', 'running', 'completed', 'failed', 'aborted'])
export type MultiAgentChildStatus = z.infer<typeof MultiAgentChildStatus>

export const MultiAgentTranscriptEntryKind = z.enum([
  'user_message',
  'assistant_message',
  'reasoning',
  'tool',
  'system',
  'event'
])
export type MultiAgentTranscriptEntryKind = z.infer<typeof MultiAgentTranscriptEntryKind>

export const MultiAgentErrorCode = z.enum([
  'config_disabled',
  'executor_missing',
  'prompt_required',
  'parallel_budget_exhausted',
  'child_not_found',
  'child_failed',
  'child_aborted',
  'invalid_input',
  'store_read_failed',
  'store_write_failed'
])
export type MultiAgentErrorCode = z.infer<typeof MultiAgentErrorCode>

export const MultiAgentUsage = z
  .object({
    promptTokens: z.number().int().nonnegative().default(0),
    completionTokens: z.number().int().nonnegative().default(0),
    totalTokens: z.number().int().nonnegative().default(0),
    cachedTokens: z.number().int().nonnegative().optional(),
    cacheHitTokens: z.number().int().nonnegative().optional(),
    cacheMissTokens: z.number().int().nonnegative().optional(),
    cacheHitRate: z.number().min(0).max(1).nullable().optional(),
    turns: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
    costCny: z.number().nonnegative().optional(),
    cacheSavingsUsd: z.number().nonnegative().optional(),
    cacheSavingsCny: z.number().nonnegative().optional(),
    tokenEconomySavingsTokens: z.number().int().nonnegative().optional(),
    tokenEconomySavingsUsd: z.number().nonnegative().optional(),
    tokenEconomySavingsCny: z.number().nonnegative().optional()
  })
  .strict()
export type MultiAgentUsage = z.infer<typeof MultiAgentUsage>

export const EMPTY_MULTI_AGENT_USAGE: MultiAgentUsage = MultiAgentUsage.parse({})

export const MultiAgentErrorInfo = z
  .object({
    code: MultiAgentErrorCode,
    message: z.string().min(1),
    retryable: z.boolean().optional(),
    details: z.unknown().optional()
  })
  .strict()
export type MultiAgentErrorInfo = z.infer<typeof MultiAgentErrorInfo>

export const MultiAgentTranscriptEntry = z
  .object({
    id: z.string().min(1),
    kind: MultiAgentTranscriptEntryKind,
    text: z.string().optional(),
    summary: z.string().optional(),
    status: z.string().optional(),
    createdAt: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict()
export type MultiAgentTranscriptEntry = z.infer<typeof MultiAgentTranscriptEntry>

export const MultiAgentChildThreadRef = z
  .object({
    runtime: z.string().min(1).optional(),
    threadId: z.string().min(1),
    turnId: z.string().min(1).optional(),
    url: z.string().min(1).optional()
  })
  .strict()
export type MultiAgentChildThreadRef = z.infer<typeof MultiAgentChildThreadRef>

export const MultiAgentChildRunRecord = z
  .object({
    contractVersion: z.literal(MULTI_AGENT_CONTRACT_VERSION).default(MULTI_AGENT_CONTRACT_VERSION),
    id: z.string().min(1),
    parentThreadId: z.string().min(1),
    parentTurnId: z.string().min(1),
    requestId: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    prompt: z.string().min(1),
    workspace: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    attempt: z.number().int().positive().default(1),
    status: MultiAgentChildStatus,
    summary: z.string().optional(),
    error: MultiAgentErrorInfo.optional(),
    usage: MultiAgentUsage.default(() => ({ ...EMPTY_MULTI_AGENT_USAGE })),
    transcript: z.array(MultiAgentTranscriptEntry).default([]),
    threadRef: MultiAgentChildThreadRef.optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    startedAt: z.string().min(1).optional(),
    finishedAt: z.string().min(1).optional()
  })
  .strict()
export type MultiAgentChildRunRecord = z.infer<typeof MultiAgentChildRunRecord>

export const MultiAgentRuntimeConfig = z
  .object({
    enabled: z.boolean().default(true),
    maxParallel: z.number().int().nonnegative().default(2),
    maxTranscriptEntries: z.number().int().positive().default(1000)
  })
  .strict()
export type MultiAgentRuntimeConfig = z.infer<typeof MultiAgentRuntimeConfig>

export const DelegateTaskInput = z
  .object({
    prompt: z.string().min(1),
    label: z.string().min(1).optional(),
    workspace: z.string().min(1).optional(),
    model: z.string().min(1).optional()
  })
  .strict()
export type DelegateTaskInput = z.infer<typeof DelegateTaskInput>

export const DelegateTaskRunRequest = DelegateTaskInput.extend({
  parentThreadId: z.string().min(1),
  parentTurnId: z.string().min(1)
}).strict()
export type DelegateTaskRunRequest = z.infer<typeof DelegateTaskRunRequest>

export const DelegateTaskOutput = z
  .object({
    childId: z.string().min(1).optional(),
    status: MultiAgentChildStatus,
    summary: z.string().optional(),
    usage: MultiAgentUsage.optional(),
    error: MultiAgentErrorInfo.optional()
  })
  .strict()
export type DelegateTaskOutput = z.infer<typeof DelegateTaskOutput>

export const MultiAgentChildRunAggregate = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    runs: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    aborted: z.number().int().nonnegative(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().optional(),
    costCny: z.number().nonnegative().optional(),
    averageTotalTokens: z.number().nonnegative(),
    averageCostUsd: z.number().nonnegative().optional(),
    averageCostCny: z.number().nonnegative().optional()
  })
  .strict()
export type MultiAgentChildRunAggregate = z.infer<typeof MultiAgentChildRunAggregate>

export const MultiAgentStoreIssue = z
  .object({
    code: MultiAgentErrorCode,
    file: z.string().min(1).optional(),
    message: z.string().min(1)
  })
  .strict()
export type MultiAgentStoreIssue = z.infer<typeof MultiAgentStoreIssue>

export const MultiAgentStoreDiagnostics = z
  .object({
    rootDir: z.string().min(1).optional(),
    records: z.number().int().nonnegative(),
    invalidRecords: z.number().int().nonnegative(),
    issues: z.array(MultiAgentStoreIssue).default([])
  })
  .strict()
export type MultiAgentStoreDiagnostics = z.infer<typeof MultiAgentStoreDiagnostics>

export const MultiAgentStatusCounts = z
  .object({
    queued: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    aborted: z.number().int().nonnegative()
  })
  .strict()
export type MultiAgentStatusCounts = z.infer<typeof MultiAgentStatusCounts>

export const MultiAgentDiagnostics = z
  .object({
    contractVersion: z.literal(MULTI_AGENT_CONTRACT_VERSION),
    config: MultiAgentRuntimeConfig,
    active: z.number().int().nonnegative(),
    childRuns: z.array(MultiAgentChildRunRecord),
    statusCounts: MultiAgentStatusCounts,
    usage: MultiAgentUsage,
    aggregates: z.array(MultiAgentChildRunAggregate),
    storage: MultiAgentStoreDiagnostics
  })
  .strict()
export type MultiAgentDiagnostics = z.infer<typeof MultiAgentDiagnostics>

export const MultiAgentTranscriptPage = z
  .object({
    childId: z.string().min(1),
    parentThreadId: z.string().min(1),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    entries: z.array(MultiAgentTranscriptEntry)
  })
  .strict()
export type MultiAgentTranscriptPage = z.infer<typeof MultiAgentTranscriptPage>

export type MultiAgentExecutorResult = {
  summary?: string
  usage?: Partial<MultiAgentUsage>
  transcript?: readonly MultiAgentTranscriptEntry[]
  threadRef?: MultiAgentChildThreadRef
}

export type MultiAgentMessageRequest = {
  message: string
  signal: AbortSignal
}

export type MultiAgentMessageReceipt = {
  established: boolean
}

export type MultiAgentLiveness = {
  state: 'active' | 'missing'
  observedAt: string
}

export type MultiAgentTerminationReason =
  | 'parent_abort'
  | 'parent_cancel'

export type MultiAgentTerminationRequest = {
  reason: MultiAgentTerminationReason
  signal: AbortSignal
}

export type MultiAgentLifecycleControl = {
  sendMessage(request: MultiAgentMessageRequest): Promise<MultiAgentMessageReceipt>
  inspect(signal: AbortSignal): Promise<MultiAgentLiveness>
  terminate(request: MultiAgentTerminationRequest): Promise<void>
}

export type MultiAgentExecutorInput = {
  childId: string
  parentThreadId: string
  parentTurnId: string
  label?: string
  prompt: string
  workspace?: string
  model?: string
  allowedToolNames?: readonly string[]
  strictAllowedToolNames?: boolean
  bashCommandPolicy?: Record<string, unknown>
  filePathPolicy?: Record<string, unknown>
  maxToolCalls?: number
  resumeThreadRef?: MultiAgentChildThreadRef
  signal: AbortSignal
  registerLifecycleControl(control: MultiAgentLifecycleControl): void
  setThreadRef(threadRef: MultiAgentChildThreadRef): Promise<void>
  appendTranscript: (entry: MultiAgentTranscriptEntry) => Promise<void>
}

export type MultiAgentExecutor = (input: MultiAgentExecutorInput) => Promise<MultiAgentExecutorResult>

export type MultiAgentChildEvent = {
  type: 'child_event'
  operation?: 'upsert' | 'delete'
  seq: number
  childId: string
  parentThreadId: string
  parentTurnId: string
  status: MultiAgentChildStatus
  label?: string
  summary?: string
  error?: MultiAgentErrorInfo
  createdAt: string
}

export type MultiAgentEventSink = {
  onChildEvent?: (
    event: MultiAgentChildEvent,
    record: MultiAgentChildRunRecord
  ) => void | Promise<void>
}

export type MultiAgentUsageSnapshot = MultiAgentUsage
export type ChildRunStatus = MultiAgentChildStatus
export const ChildRunUsage = MultiAgentUsage
export type ChildRunUsage = MultiAgentUsage
export const ChildRunTranscriptEntryKind = MultiAgentTranscriptEntryKind
export type ChildRunTranscriptEntryKind = MultiAgentTranscriptEntryKind
export const ChildRunTranscriptEntry = MultiAgentTranscriptEntry
export type ChildRunTranscriptEntry = MultiAgentTranscriptEntry
export const ChildRunRecord = MultiAgentChildRunRecord
export type ChildRunRecord = MultiAgentChildRunRecord
export type ChildRunExecutor = MultiAgentExecutor
export type ChildRunAggregate = MultiAgentChildRunAggregate
