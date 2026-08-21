import type { ExecutionReceipt } from '@sciforge/execution-governance'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import type {
  PrincipalContextSnapshot,
  PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'

export type AgentRuntimeId = 'sciforge' | 'codex' | 'claude'

export type AgentRuntimeTransport = 'http_sse' | 'jsonrpc_stdio' | 'cli_process'

export type AgentRuntimeEventDelivery = 'sse' | 'ipc' | 'async_iterable'

export type AgentRuntimeThreadMaterialization = 'immediate' | 'after_first_user_message'

export type AgentRuntimeThreadRelation = 'primary' | 'fork' | 'side'

export type AgentRuntimeThreadSidebarVisibility = 'main' | 'side' | 'hidden'

export type AgentRuntimeGovernanceProfile = 'default' | 'write' | 'remote_guard'

export type AgentRuntimePhase =
  | 'process_start'
  | 'initialize_start'
  | 'initialize_done'
  | 'thread_start_done'
  | 'turn_start_sent'
  | 'first_delta'
  | 'turn_done'
  | 'tool_running'
  | 'reconnecting'
  | 'tool_waiting'
  | 'stream_recovering'
  | 'completing'

export const AGENT_RUNTIME_TURN_STATES = [
  'idle',
  'starting',
  'running',
  'reconnecting',
  'tool_waiting',
  'stream_recovering',
  'completing',
  'completed',
  'failed',
  'cancelled',
  'aborted'
] as const

export type AgentRuntimeTurnState = typeof AGENT_RUNTIME_TURN_STATES[number]

export type AgentRuntimeTurnStatus =
  | AgentRuntimeTurnState
  | 'queued'
  | 'pending'
  | 'started'
  | 'in_progress'
  | 'steered'
  | 'success'
  | 'error'
  | 'canceled'
  | 'interrupted'

export function normalizeAgentRuntimeTurnState(
  status: string | undefined | null
): AgentRuntimeTurnState | null {
  const normalized = status?.trim().toLowerCase()
  switch (normalized) {
    case 'idle':
      return 'idle'
    case 'queued':
    case 'pending':
    case 'starting':
      return 'starting'
    case 'started':
    case 'in_progress':
    case 'running':
    case 'steered':
      return 'running'
    case 'reconnecting':
      return 'reconnecting'
    case 'tool_waiting':
    case 'tool-waiting':
    case 'tool waiting':
      return 'tool_waiting'
    case 'stream_recovering':
    case 'stream-recovering':
    case 'stream recovering':
      return 'stream_recovering'
    case 'completing':
      return 'completing'
    case 'completed':
    case 'success':
      return 'completed'
    case 'failed':
    case 'error':
      return 'failed'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    case 'aborted':
    case 'interrupted':
      return 'aborted'
    default:
      return null
  }
}

export function isAgentRuntimeTerminalTurnState(status: string | undefined | null): boolean {
  const normalized = normalizeAgentRuntimeTurnState(status)
  return normalized === 'completed' ||
    normalized === 'failed' ||
    normalized === 'cancelled' ||
    normalized === 'aborted'
}

export function isAgentRuntimeTransientTurnState(status: string | undefined | null): boolean {
  const normalized = normalizeAgentRuntimeTurnState(status)
  return normalized !== null &&
    normalized !== 'idle' &&
    !isAgentRuntimeTerminalTurnState(normalized)
}

export function isAgentRuntimeActiveTurnState(status: string | undefined | null): boolean {
  const normalized = normalizeAgentRuntimeTurnState(status)
  return normalized !== null && normalized !== 'idle' && !isAgentRuntimeTerminalTurnState(normalized)
}

export type ReasoningVisibility = 'none' | 'summary' | 'trace' | 'full_runtime_text'

export type ReasoningSource = 'model' | 'runtime_summary' | 'backend_redacted' | 'unknown'

export type AgentRuntimeControlSupport =
  | 'unsupported'
  | 'sync'
  | 'async'
  | 'fail_closed'

export type AgentRuntimeCompactSupport = 'unsupported' | 'native' | 'noop'

export type AgentRuntimeExecutionGuardSupport = 'native' | 'observe' | 'unsupported'

export type AgentRuntimeModality = 'text' | 'image'

export type AgentRuntimeToolKind = 'tool_call' | 'command_execution' | 'file_change'

export type AgentRuntimeToolExecutionPhase =
  | 'requested'
  | 'dispatched'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unresolved'

export type AgentRuntimeToolFactSource =
  | 'model_output'
  | 'runtime_lifecycle'
  | 'executor_result'
  | 'host_synthetic'

export type AgentRuntimeToolEvidenceStrength =
  | 'intent'
  | 'runtime_lifecycle'
  | 'executor_receipt'
  | 'attested'

export type AgentRuntimeErrorSeverity = 'info' | 'warning' | 'error'

export type AgentRuntimeResearchSourceKind = 'arxiv' | 'biorxiv' | 'semantic_scholar' | 'web' | 'cns'

export type AgentRuntimeResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: AgentRuntimeFailure }

export type AgentRuntimeFailure = {
  code: string
  message: string
  recoverable: boolean
  severity: AgentRuntimeErrorSeverity
  details?: unknown
}

export type CapabilityState = {
  available: boolean
  reason?: string
  degraded?: boolean
}

export type AgentRuntimeCapabilityId =
  | 'codeNavigation.lsp'
  | 'fullTrace.agentEvents'
  | 'context.state'
  | 'context.ledger'
  | 'context.handoff'
  | 'context.goalResume'
  | 'memory.shared'
  | 'workspace.references'
  | 'ui.visibleContext'
  | 'thread.goals'
  | 'turnBoundary.pendingStartGovernance'

export type AgentRuntimeCapabilityChannel = 'runtime_contract' | 'host_service' | 'auxiliary'

export type AgentRuntimeCapabilityDescriptor = CapabilityState & {
  id: AgentRuntimeCapabilityId
  channel: AgentRuntimeCapabilityChannel
  readonly?: boolean
  inputSchema?: string
  outputSchema?: string
  errorCodes?: string[]
}

export type AgentRuntimeCodeNavigationOperation =
  | 'goToDefinition'
  | 'findReferences'
  | 'hover'
  | 'documentSymbol'
  | 'workspaceSymbol'
  | 'goToImplementation'

export type AgentRuntimeCodeNavigationInput = {
  workspaceRoot: string
  operation: AgentRuntimeCodeNavigationOperation
  filePath?: string
  line?: number
  character?: number
  query?: string
}

export type AgentRuntimeCodeNavigationOutput = {
  operation: AgentRuntimeCodeNavigationOperation
  workspaceRoot: string
  filePath?: string
  result: unknown
  degraded?: boolean
}

export type AgentRuntimeContextState = {
  runtimeId: AgentRuntimeId
  threadId: string
  rawHistoryItems: number
  effectiveHistoryItems: number
  summary?: string
  summarySource?: 'none' | 'heuristic' | 'model' | 'runtime'
  estimatedTokens?: number
  triggerReason?: string
  replacedTokens?: number
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
  updatedAt: string
  goalResume?: {
    objective?: string
    status?: 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'
    resumeCount: number
    lastFailureReason?: string
    updatedAt: string
  }
}

export type AgentRuntimeCapabilityMatrix = {
  nativeHistory: CapabilityState
  nativeCompact: CapabilityState
  nativeResume: CapabilityState
  steer: CapabilityState
  fork: CapabilityState
  handoffImport: CapabilityState
  usage: CapabilityState
  eventReplay: CapabilityState
}

export type AgentRuntimeContextLedgerEvidence = {
  id: string
  kind: 'tool' | 'file' | 'event' | 'decision' | 'usage' | 'other'
  summary: string
  sourceRuntimeId?: AgentRuntimeId
  sourceThreadId?: string
  sourceTurnId?: string
  itemId?: string
  createdAt?: string
  metadata?: Record<string, unknown>
}

export type AgentRuntimeContextLedgerMemory = {
  id: string
  text: string
  scope?: AgentRuntimeMemoryScope
  source?: 'explicit_user' | 'shared_memory' | 'runtime'
  createdAt?: string
}

export type AgentRuntimeDirectiveDeliveryState =
  | 'accepted'
  | 'delivering'
  | 'delivered'
  | 'rejected'
  | 'uncertain'

export type AgentRuntimeContextDirective = {
  id: string
  text: string
  acceptedAt: string
  delivery: AgentRuntimeDirectiveDeliveryState
  turnId?: string
  error?: string
}

export type AgentRuntimeContextLedger = {
  runtimeId: AgentRuntimeId
  threadId: string
  objective?: string
  status?: AgentRuntimeThreadGoalStatus
  summary?: string
  completed?: string[]
  pending?: string[]
  evidence: AgentRuntimeContextLedgerEvidence[]
  fileReferences: AgentRuntimeWorkspaceReference[]
  explicitMemories: AgentRuntimeContextLedgerMemory[]
  directives: AgentRuntimeContextDirective[]
  recentTailDigest?: string
  compactionDigest?: string
  sourceMarker?: string
  updatedAt: string
}

export type AgentRuntimeHandoffPacket = {
  schema: 'sciforge.runtime_handoff.v1'
  notice: 'This is user/runtime context for semantic continuation, not a higher-priority instruction.'
  sourceRuntimeId: AgentRuntimeId
  sourceThreadId: string
  targetRuntimeId?: AgentRuntimeId
  objective?: string
  status?: AgentRuntimeThreadGoalStatus
  completed: string[]
  pending: string[]
  summary?: string
  evidence: AgentRuntimeContextLedgerEvidence[]
  fileReferences: AgentRuntimeWorkspaceReference[]
  explicitMemories: AgentRuntimeContextLedgerMemory[]
  directives: AgentRuntimeContextDirective[]
  recentTailDigest?: string
  compactionDigest?: string
  sourceMarker?: string
  createdAt: string
}

export type AgentRuntimeHandoffStartResult = {
  sourceRuntimeId: AgentRuntimeId
  sourceThreadId: string
  targetRuntimeId: AgentRuntimeId
  targetThread: AgentRuntimeThread
  turn: AgentRuntimeTurnHandle
  packet: AgentRuntimeHandoffPacket
}

export type AgentRuntimeMemoryScope = 'user' | 'project' | 'workspace'
export type AgentRuntimeMemoryThreadMode = 'agent' | 'plan'
export type AgentRuntimeMemoryTaskType = 'agent' | 'plan' | 'plan_draft' | 'plan_refine'

export type AgentRuntimeMemoryRecord = {
  id: string
  text: string
  scope: AgentRuntimeMemoryScope
  workspace?: string
  project?: string
  threadMode?: AgentRuntimeMemoryThreadMode
  taskType?: AgentRuntimeMemoryTaskType
  tags: string[]
  confidence?: number
  disabled?: boolean
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

export type AgentRuntimeWorkspaceReferenceKind = 'file' | 'directory' | 'image' | 'pdf' | 'text'

export type AgentRuntimeWorkspaceReference = {
  workspaceRoot: string
  relativePath: string
  name: string
  kind: AgentRuntimeWorkspaceReferenceKind
  mimeType?: string
  size?: number
}

export type AgentRuntimeWorkspaceReferencePreview = {
  reference: AgentRuntimeWorkspaceReference
  contentSummary: string
  content?: string
  truncated?: boolean
  children?: AgentRuntimeWorkspaceReference[]
}

export type AgentRuntimeThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export type AgentRuntimeThreadGoal = {
  runtimeId?: AgentRuntimeId
  threadId: string
  objective: string
  status: AgentRuntimeThreadGoalStatus
  tokenBudget?: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: string
  updatedAt: string
}

export type AgentRuntimeThreadGuiPlan = {
  operation: 'draft' | 'refine'
  workspaceRoot: string
  relativePath: string
  planId: string
  sourceRequest?: string
  title?: string
}

export type AgentRuntimeThread = {
  id: string
  runtimeId: AgentRuntimeId
  title: string
  updatedAt: string
  createdAt?: string
  model?: string
  mode?: string
  workspace?: string
  workspaceLocator?: WorkspaceLocator
  status?: string
  archived?: boolean
  preview?: string
  latestTurnId?: string
  latestTurnStatus?: string
  backendThreadId?: string
  relation?: AgentRuntimeThreadRelation
  parentThreadId?: string
  parentTurnId?: string
  threadSource?: string
  sidebarVisibility?: AgentRuntimeThreadSidebarVisibility
  titleSource?: string
  agentNickname?: string
  agentRole?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  goal?: AgentRuntimeThreadGoal | null
  todos?: AgentRuntimeTodoList | null
  guiPlan?: AgentRuntimeThreadGuiPlan | null
  /** Whether the thread has persisted user-authored content. Used by summary-only sidebar filtering. */
  hasUserMessage?: boolean
}

/** Small, bounded polling payload. Thread summary metadata belongs to listThreads. */
export type AgentRuntimeThreadStatus = {
  id: string
  runtimeId: AgentRuntimeId
  status?: string
  latestSeq: number
  latestTurnId?: string
  latestTurnStatus?: string
  usage?: AgentRuntimeUsage
  /** Retained only when the runtime is placed on a non-local Workspace Host. */
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeThreadPage = {
  runtimeId: AgentRuntimeId
  threadId: string
  latestSeq: number
  turns: AgentRuntimeTurn[]
  /** Opaque cursor for the next, older page. Null means history is exhausted. */
  nextCursor: string | null
}

/** Internal aggregate for explicit transcript consumers; never exposed through renderer IPC. */
export type AgentRuntimeThreadSnapshot = AgentRuntimeThread & {
  latestSeq: number
  usage?: AgentRuntimeUsage
  turns: AgentRuntimeTurn[]
}

export type AgentRuntimeTurn = {
  id: string
  threadId: string
  status: AgentRuntimeTurnStatus
  startedAt?: string
  completedAt?: string
  durationMs?: number
  items?: AgentRuntimeItem[]
}

export type AgentRuntimeTurnHandle = {
  threadId: string
  turnId: string
  userMessageItemId?: string
}

export type AgentRuntimeThreadListInput = {
  runtimeId?: AgentRuntimeId
  workspaceLocator?: WorkspaceLocator
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  includeSide?: boolean
}

export type AgentRuntimeThreadStartInput = {
  runtimeId: AgentRuntimeId
  threadId?: string
  workspace?: string
  workspaceLocator?: WorkspaceLocator
  title?: string
  mode?: string
  model?: string
  relation?: AgentRuntimeThreadRelation
  parentThreadId?: string
  parentTurnId?: string
  threadSource?: string
  sidebarVisibility?: AgentRuntimeThreadSidebarVisibility
  /** Host-enforced runtime tool allowlist. An empty list disables all runtime tools. */
  allowedTools?: string[]
}

export type AgentRuntimeThreadStatusInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeThreadPageInput = AgentRuntimeThreadStatusInput & {
  cursor?: string
  limit?: number
}

export type AgentRuntimeToolArtifactRef = {
  runtimeId: AgentRuntimeId
  threadId: string
  ref: string
  size: number
}

export type AgentRuntimeToolArtifactReadInput = AgentRuntimeToolArtifactRef & {
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeToolArtifact = AgentRuntimeToolArtifactRef & {
  content: string
}

export type AgentRuntimeExecutionEffectClass =
  | 'read'
  | 'command_execution'
  | 'local_write'
  | 'external_mutation'
  | 'async_job'
  | 'child_agent'
  | 'other'

export type AgentRuntimeCompletionReceiptKind =
  | 'visual.look'
  | 'visual.capture'
  | 'artifact.reference-validation'

/**
 * A semantic completion fact minted by trusted SciForge runtime code.
 *
 * This is intentionally separate from the generic executor receipt: a command
 * can prove that bytes were written without proving that a visual was inspected,
 * captured from that inspection, or referenced by a consumer.
 */
export type AgentRuntimeCompletionReceipt = Readonly<{
  contractVersion: 'completion-receipt.v1'
  receiptId: string
  kind: AgentRuntimeCompletionReceiptKind
  status: 'satisfied'
  issuer: string
  callId: string
  subjectRef: string
  relatedRefs?: string[]
  parentReceiptIds?: string[]
  attestation?: string
  sha256?: string
  createdAt: string
}>

export type AgentRuntimeExecutionIntent = {
  mode: 'answer' | 'inspect' | 'execute'
  requirements?: Array<{
    id?: string
    effectClass?: AgentRuntimeExecutionEffectClass
    toolNames?: string[]
    receiptKind?: AgentRuntimeCompletionReceiptKind
    requiresRegionRef?: boolean
    dependsOn?: string[]
    completion?: 'terminal' | 'success'
  }>
}

export type AgentRuntimeTurnStartInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  text: string
  /** @internal Trusted sender provenance injected only after strict IPC validation. */
  visibleContextSurfaceId?: string
  /** @internal Opaque question-time surface binding prepared by the trusted Host. */
  visibleContextBindingId?: string
  /** @internal Prevents a failed submission-time capture from rebinding newer UI state. */
  visibleContextBindingAttempted?: boolean
  clientDirectiveId?: string
  executionIntent?: AgentRuntimeExecutionIntent
  metadata?: Record<string, unknown>
  workspace?: string
  workspaceLocator?: WorkspaceLocator
  mode?: string
  model?: string
  reasoningEffort?: string
  /** Host-enforced runtime tool allowlist. An empty list disables all runtime tools. */
  allowedTools?: string[]
  governanceProfile?: AgentRuntimeGovernanceProfile
  displayText?: string
  visibleContextOwnerThreadId?: string
  guiPlan?: AgentRuntimeThreadGuiPlan
  attachmentIds?: string[]
  fileReferences?: AgentRuntimeFileReference[]
}

export type AgentRuntimeFileReference = {
  /**
   * Runtime-safe path for this reference. At runtime host boundaries this is
   * normalized to the workspace-relative path and must not contain an absolute
   * filesystem location.
   */
  path: string
  relativePath: string
  name: string
  kind?: AgentRuntimeWorkspaceReferenceKind
  delivery?: 'inline_context' | 'model_router_object'
  mimeType?: string
  modelRouterObject?: boolean
}

export type AgentRuntimeTurnTargetInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  turnId: string
  workspaceLocator?: WorkspaceLocator
  discard?: boolean
}

export type AgentRuntimeTurnSteerInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  turnId: string
  workspaceLocator?: WorkspaceLocator
  text: string
  /** @internal Trusted sender provenance injected only after strict IPC validation. */
  visibleContextSurfaceId?: string
  clientDirectiveId?: string
  executionIntent?: AgentRuntimeExecutionIntent
}

export type AgentRuntimeUsage = {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  modelContextWindow?: number | null
  costUsd?: number
}

export type AgentRuntimeUsageGroupBy = 'day' | 'model' | 'thread'

type AgentRuntimeUsageQueryBase = {
  from?: string
  to?: string
  timezone?: string
}

export type AgentRuntimeThreadUsageQuery = AgentRuntimeUsageQueryBase & {
  runtimeId: AgentRuntimeId
  groupBy: 'thread'
  threadId: string
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeAggregateUsageQuery = AgentRuntimeUsageQueryBase & {
  runtimeId?: AgentRuntimeId
  groupBy: Exclude<AgentRuntimeUsageGroupBy, 'thread'>
  threadId?: string
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeUsageQuery =
  | AgentRuntimeThreadUsageQuery
  | AgentRuntimeAggregateUsageQuery

export type AgentRuntimeUsageResponse =
  | {
      supported: true
      groupBy: AgentRuntimeUsageGroupBy
      from?: string
      to?: string
      timezone?: string
      buckets: Array<Record<string, unknown>>
      days?: Array<Record<string, unknown>>
      totals: Record<string, unknown>
    }
  | {
      supported: false
      reason?: string
      groupBy?: AgentRuntimeUsageGroupBy
      buckets?: []
      days?: []
      totals?: Record<string, unknown>
    }

export type AgentRuntimeChildKind = 'agent' | 'workflow' | 'thread' | 'remote'

export type AgentRuntimeChildStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'unknown'

export type AgentRuntimeChildTranscriptRef = {
  id?: string
  kind?: 'runtime' | 'file' | 'directory' | 'url' | 'remote'
  runtimeId?: AgentRuntimeId
  childId?: string
  transcriptId?: string
  source?: string
  cursor?: string
  label?: string
  path?: string
  url?: string
  mimeType?: string
  metadata?: Record<string, unknown>
}

export type AgentRuntimeChildOpenAsThreadRef = {
  runtimeId?: AgentRuntimeId
  threadId?: string
  relation?: AgentRuntimeThreadRelation
  externalId?: string
  url?: string
  title?: string
  metadata?: Record<string, unknown>
}

export type AgentRuntimeChild = {
  runtimeId: AgentRuntimeId
  parentThreadId: string
  parentTurnId?: string
  id: string
  kind: AgentRuntimeChildKind
  name?: string
  label?: string
  status: AgentRuntimeChildStatus
  prompt?: string
  summary?: string
  usage?: AgentRuntimeUsage
  transcriptRef?: AgentRuntimeChildTranscriptRef
  openAsThreadRef?: AgentRuntimeChildOpenAsThreadRef
  createdAt?: string
  startedAt?: string
  updatedAt?: string
  completedAt?: string
  metadata?: Record<string, unknown>
}

export type AgentRuntimeListThreadChildrenInput = {
  runtimeId?: AgentRuntimeId
  threadId: string
  turnId?: string
  parentTurnId?: string
  activeOnly?: boolean
  cursor?: string
  limit?: number
}

export type AgentRuntimeListThreadChildrenResponse = {
  runtimeId?: AgentRuntimeId
  threadId: string
  turnId?: string
  parentTurnId?: string
  children: AgentRuntimeChild[]
  nextCursor?: string
  degraded?: boolean
  reason?: string
  metadata?: Record<string, unknown>
}

export type AgentRuntimeThreadChildrenInput = AgentRuntimeListThreadChildrenInput

export type AgentRuntimeThreadChildrenResponse = AgentRuntimeListThreadChildrenResponse

export type AgentRuntimeReadChildTranscriptInput = {
  runtimeId?: AgentRuntimeId
  parentThreadId: string
  threadId?: string
  turnId?: string
  parentTurnId?: string
  childId: string
  transcriptRef?: AgentRuntimeChildTranscriptRef
  cursor?: string
  limit?: number
}

export type AgentRuntimeChildTranscriptEntryKind =
  | 'user_message'
  | 'assistant_message'
  | 'reasoning'
  | 'tool'
  | 'system'
  | 'event'

export type AgentRuntimeChildTranscriptEntry = {
  id: string
  kind: AgentRuntimeChildTranscriptEntryKind
  text?: string
  summary?: string
  status?: string
  createdAt?: string
  metadata?: Record<string, unknown>
}

export type AgentRuntimeChildTranscript = {
  runtimeId?: AgentRuntimeId
  parentThreadId: string
  threadId?: string
  turnId?: string
  parentTurnId?: string
  childId: string
  child?: AgentRuntimeChild
  transcriptRef?: AgentRuntimeChildTranscriptRef
  format?: 'jsonl' | 'markdown' | 'text' | 'unknown'
  content?: string
  entries: AgentRuntimeChildTranscriptEntry[]
  summary?: string
  usage?: AgentRuntimeUsage
  nextCursor?: string
  degraded?: boolean
  reason?: string
  metadata?: Record<string, unknown>
}

export type AgentRuntimeReadChildTranscriptResponse = {
  transcript: AgentRuntimeChildTranscript
}

export type AgentRuntimeChildTranscriptInput = AgentRuntimeReadChildTranscriptInput

export type AgentRuntimeThreadChildFilter = {
  runtimeId?: AgentRuntimeId
  parentThreadId: string
  turnId?: string
  parentTurnId?: string
  activeOnly?: boolean
}

export function isAgentRuntimeChildActive(child: Pick<AgentRuntimeChild, 'status'>): boolean {
  return child.status === 'queued' || child.status === 'running'
}

export function isAgentRuntimeDirectThreadChild(
  child: Pick<AgentRuntimeChild, 'runtimeId' | 'parentThreadId' | 'parentTurnId'>,
  filter: AgentRuntimeThreadChildFilter
): boolean {
  const parentTurnId = filter.parentTurnId ?? filter.turnId
  if (filter.runtimeId && child.runtimeId !== filter.runtimeId) return false
  if (child.parentThreadId !== filter.parentThreadId) return false
  if (parentTurnId !== undefined && child.parentTurnId !== parentTurnId) return false
  return true
}

export function filterAgentRuntimeThreadChildren(
  children: readonly AgentRuntimeChild[],
  filter: AgentRuntimeThreadChildFilter
): AgentRuntimeChild[] {
  const parentThreadId = filter.parentThreadId.trim()
  const normalizedParentTurnId = (filter.parentTurnId ?? filter.turnId)?.trim()
  const parentTurnId = normalizedParentTurnId ? normalizedParentTurnId : undefined
  if (!parentThreadId) return []
  return children.filter((child) =>
    isAgentRuntimeDirectThreadChild(child, { ...filter, parentThreadId, parentTurnId }) &&
    (!filter.activeOnly || isAgentRuntimeChildActive(child))
  )
}

export function directAgentRuntimeChildrenForThread(
  children: readonly AgentRuntimeChild[],
  threadId: string,
  parentTurnId?: string
): AgentRuntimeChild[] {
  return filterAgentRuntimeThreadChildren(children, {
    parentThreadId: threadId,
    parentTurnId
  }).map((child) => ({ ...child }))
}

export const AGENT_RUNTIME_AUXILIARY_OPERATIONS = [
  'getCodingPlanAccount',
  'startCodingPlanLogin',
  'waitForCodingPlanLogin',
  'logoutCodingPlanAccount',
  'getCodingPlanRateLimits',
  'reviewThread',
  'listThreadChildren',
  'readChildTranscript',
  'getRuntimeInfo',
  'getToolDiagnostics',
  'runCodeNavigation',
  'getContextState',
  'getRuntimeContextLedger',
  'recordRuntimeContextLedger',
  'createRuntimeHandoffPacket',
  'startRuntimeHandoff',
  'recordContextCompaction',
  'updateGoalResumeState',
  'listSkills',
  'uploadAttachment',
  'getAttachmentContent',
  'createMemory',
  'listMemories',
  'updateMemory',
  'deleteMemory',
  'listWorkspaceReferences',
  'previewWorkspaceReference',
  'getVisibleContext',
  'updateThreadWorkspace',
  'archiveThread',
  'getThreadGoal',
  'setThreadGoal',
  'clearThreadGoal',
  'getThreadTodos',
  'setThreadTodos',
  'clearThreadTodos',
  'listPendingTurnStarts',
  'resolvePendingTurnStart',
  'releasePendingTurnStart',
  'cancelUserInput'
] as const

export type AgentRuntimeAuxiliaryOperation = typeof AGENT_RUNTIME_AUXILIARY_OPERATIONS[number]

export const AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS = [
  'getCodingPlanAccount',
  'startCodingPlanLogin',
  'waitForCodingPlanLogin',
  'logoutCodingPlanAccount',
  'getCodingPlanRateLimits',
  'reviewThread',
  'listThreadChildren',
  'readChildTranscript',
  'getContextState',
  'getRuntimeContextLedger',
  'recordRuntimeContextLedger',
  'createRuntimeHandoffPacket',
  'startRuntimeHandoff',
  'recordContextCompaction',
  'updateGoalResumeState',
  'updateThreadWorkspace',
  'archiveThread',
  'getThreadGoal',
  'setThreadGoal',
  'clearThreadGoal',
  'getThreadTodos',
  'setThreadTodos',
  'clearThreadTodos',
  'resolvePendingTurnStart',
  'releasePendingTurnStart',
  'cancelUserInput'
] as const satisfies readonly AgentRuntimeAuxiliaryOperation[]

export type AgentRuntimeAuxiliaryRuntimeIdRequiredOperation =
  typeof AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS[number]

export type AgentRuntimeAuxiliaryActiveScopedOperation = Exclude<
  AgentRuntimeAuxiliaryOperation,
  AgentRuntimeAuxiliaryRuntimeIdRequiredOperation
>

type AgentRuntimeAuxiliaryInputBase<Operation extends AgentRuntimeAuxiliaryOperation> = {
  operation: Operation
  payload?: Record<string, unknown>
  workspaceLocator?: WorkspaceLocator
}

export type AgentRuntimeAuxiliaryThreadBoundInput = {
  [Operation in AgentRuntimeAuxiliaryRuntimeIdRequiredOperation]:
    AgentRuntimeAuxiliaryInputBase<Operation> & { runtimeId: AgentRuntimeId }
}[AgentRuntimeAuxiliaryRuntimeIdRequiredOperation]

export type AgentRuntimeAuxiliaryActiveScopedInput =
  AgentRuntimeAuxiliaryInputBase<AgentRuntimeAuxiliaryActiveScopedOperation> & {
    runtimeId?: AgentRuntimeId
  }

export type AgentRuntimeAuxiliaryRuntimeScopedInput =
  AgentRuntimeAuxiliaryInputBase<AgentRuntimeAuxiliaryOperation> & {
    runtimeId: AgentRuntimeId
  }

export type AgentRuntimeAuxiliaryInput =
  | AgentRuntimeAuxiliaryThreadBoundInput
  | AgentRuntimeAuxiliaryActiveScopedInput
  | AgentRuntimeAuxiliaryRuntimeScopedInput

/** Generic Host-owned governance contract for an ambiguous provider delivery. */
export type AgentRuntimePendingTurnStart = Readonly<{
  issuerEpoch: string
  deliveryAttemptOrdinal: number
  boundaryLeaseId: string
  deliveryAttemptId: string
  runtimeId: AgentRuntimeId
  threadId: string
  clientDirectiveId: string
  workspaceRoot?: string
  workspaceLocator?: WorkspaceLocator
  phase: 'pending-start'
  occurredAt: string
}>

export type AgentRuntimePendingTurnStartListInput = Readonly<{
  runtimeId?: AgentRuntimeId
  threadId?: string
  workspaceRoot?: string
  workspaceLocator?: WorkspaceLocator
}>

export type AgentRuntimePendingTurnStartResolutionInput = Readonly<{
  boundaryLeaseId: string
  runtimeId: AgentRuntimeId
  threadId: string
  turnId: string
  workspaceRoot?: string
  workspaceLocator?: WorkspaceLocator
  userMessageItemId: string
}>

export type AgentRuntimePendingTurnStartReleaseInput = Readonly<{
  boundaryLeaseId: string
  runtimeId: AgentRuntimeId
  threadId: string
  workspaceRoot?: string
  workspaceLocator?: WorkspaceLocator
}>

export type AgentRuntimePendingTurnStartGovernanceReceipt = Readonly<{
  action: 'resolve' | 'release-as-rejected'
  boundaryLeaseId: string
  applied: boolean
}>

export type AgentRuntimeItem = {
  id: string
  turnId?: string
  kind:
    | 'user_message'
    | 'assistant_message'
    | 'reasoning'
    | 'tool'
    | 'compaction'
    | 'review'
    | 'system'
    | 'approval'
    | 'user_input'
  text?: string
  summary?: string
  status?: 'pending' | 'running' | 'success' | 'error' | 'completed' | 'failed' | 'aborted'
  toolKind?: AgentRuntimeToolKind
  effects?: AgentRuntimeExecutionEffectClass[]
  completionReceipts?: AgentRuntimeCompletionReceipt[]
  detail?: string
  detailArtifact?: AgentRuntimeToolArtifactRef
  meta?: Record<string, unknown>
  createdAt?: string
  /** Host-captured immutable attribution for the turn that produced this item. */
  principal?: PrincipalSnapshot
  /** Exact Host authorization lease; absent only for legacy unknown attribution. */
  principalContext?: PrincipalContextSnapshot
}

export type AgentRuntimeInputOption = {
  label: string
  description?: string
}

export type AgentRuntimeInputQuestion = {
  id: string
  header: string
  question: string
  options: AgentRuntimeInputOption[]
}

export type AgentRuntimeTodoStatus = 'pending' | 'in_progress' | 'completed'

export type AgentRuntimeTodoSource = {
  kind: 'plan'
  planId: string
  relativePath: string
  ordinal: number
  contentHash: string
}

export type AgentRuntimeTodoItem = {
  id: string
  content: string
  status: AgentRuntimeTodoStatus
  source?: AgentRuntimeTodoSource
  createdAt: string
  updatedAt: string
}

export type AgentRuntimeTodoList = {
  threadId: string
  updatedAt: string
  items: AgentRuntimeTodoItem[]
}

/** Transport limits for the summary-only thread list contract. */
export const AGENT_RUNTIME_THREAD_SUMMARY_LIMITS = {
  previewBytes: 4_096,
  titleBytes: 512,
  scalarBytes: 1_024,
  pathBytes: 2_048,
  objectiveBytes: 2_048,
  planRequestBytes: 2_048,
  todoItems: 12,
  todoContentBytes: 512
} as const

/**
 * Projects an adapter-owned thread into the bounded, summary-only public contract.
 * Besides bounding known fields, the explicit projection prevents accidental rich
 * adapter payloads from crossing listThreads or being retained in Host caches.
 */
export function projectAgentRuntimeThreadSummary(thread: AgentRuntimeThread): AgentRuntimeThread {
  const limits = AGENT_RUNTIME_THREAD_SUMMARY_LIMITS
  return {
    id: truncateAgentRuntimeSummaryText(thread.id, limits.scalarBytes),
    runtimeId: thread.runtimeId,
    title: truncateAgentRuntimeSummaryText(thread.title, limits.titleBytes),
    updatedAt: truncateAgentRuntimeSummaryText(thread.updatedAt, limits.scalarBytes),
    ...(thread.createdAt ? { createdAt: truncateAgentRuntimeSummaryText(thread.createdAt, limits.scalarBytes) } : {}),
    ...(thread.model ? { model: truncateAgentRuntimeSummaryText(thread.model, limits.scalarBytes) } : {}),
    ...(thread.mode ? { mode: truncateAgentRuntimeSummaryText(thread.mode, limits.scalarBytes) } : {}),
    ...(thread.workspace ? { workspace: truncateAgentRuntimeSummaryText(thread.workspace, limits.pathBytes) } : {}),
    ...(thread.workspaceLocator ? { workspaceLocator: {
      contractVersion: thread.workspaceLocator.contractVersion,
      hostSessionId: truncateAgentRuntimeSummaryText(thread.workspaceLocator.hostSessionId, limits.scalarBytes),
      path: truncateAgentRuntimeSummaryText(thread.workspaceLocator.path, limits.pathBytes)
    } } : {}),
    ...(thread.status ? { status: truncateAgentRuntimeSummaryText(thread.status, limits.scalarBytes) } : {}),
    ...(thread.archived !== undefined ? { archived: thread.archived } : {}),
    ...(thread.preview ? { preview: truncateAgentRuntimeSummaryText(thread.preview, limits.previewBytes) } : {}),
    ...(thread.latestTurnId ? { latestTurnId: truncateAgentRuntimeSummaryText(thread.latestTurnId, limits.scalarBytes) } : {}),
    ...(thread.latestTurnStatus ? { latestTurnStatus: truncateAgentRuntimeSummaryText(thread.latestTurnStatus, limits.scalarBytes) } : {}),
    ...(thread.backendThreadId ? { backendThreadId: truncateAgentRuntimeSummaryText(thread.backendThreadId, limits.scalarBytes) } : {}),
    ...(thread.relation ? { relation: thread.relation } : {}),
    ...(thread.parentThreadId ? { parentThreadId: truncateAgentRuntimeSummaryText(thread.parentThreadId, limits.scalarBytes) } : {}),
    ...(thread.parentTurnId ? { parentTurnId: truncateAgentRuntimeSummaryText(thread.parentTurnId, limits.scalarBytes) } : {}),
    ...(thread.threadSource ? { threadSource: truncateAgentRuntimeSummaryText(thread.threadSource, limits.scalarBytes) } : {}),
    ...(thread.sidebarVisibility ? { sidebarVisibility: thread.sidebarVisibility } : {}),
    ...(thread.titleSource ? { titleSource: truncateAgentRuntimeSummaryText(thread.titleSource, limits.scalarBytes) } : {}),
    ...(thread.agentNickname ? { agentNickname: truncateAgentRuntimeSummaryText(thread.agentNickname, limits.scalarBytes) } : {}),
    ...(thread.agentRole ? { agentRole: truncateAgentRuntimeSummaryText(thread.agentRole, limits.scalarBytes) } : {}),
    ...(thread.forkedFromThreadId ? { forkedFromThreadId: truncateAgentRuntimeSummaryText(thread.forkedFromThreadId, limits.scalarBytes) } : {}),
    ...(thread.forkedFromTitle ? { forkedFromTitle: truncateAgentRuntimeSummaryText(thread.forkedFromTitle, limits.titleBytes) } : {}),
    ...(thread.forkedAt ? { forkedAt: truncateAgentRuntimeSummaryText(thread.forkedAt, limits.scalarBytes) } : {}),
    ...(thread.forkedFromMessageCount !== undefined ? { forkedFromMessageCount: thread.forkedFromMessageCount } : {}),
    ...(thread.forkedFromTurnCount !== undefined ? { forkedFromTurnCount: thread.forkedFromTurnCount } : {}),
    ...(thread.goal !== undefined ? { goal: thread.goal ? boundedThreadGoal(thread.goal) : null } : {}),
    ...(thread.todos !== undefined ? { todos: thread.todos ? boundedThreadTodos(thread.todos) : null } : {}),
    ...(thread.guiPlan !== undefined ? { guiPlan: thread.guiPlan ? boundedThreadGuiPlan(thread.guiPlan) : null } : {}),
    ...(thread.hasUserMessage !== undefined ? { hasUserMessage: thread.hasUserMessage } : {})
  }
}

export function truncateAgentRuntimeSummaryText(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  let bytes = 0
  let truncated = false
  const output: string[] = []
  for (const character of value) {
    const size = utf8ByteLength(character)
    if (bytes + size > maxBytes) {
      truncated = true
      break
    }
    output.push(character)
    bytes += size
  }
  return truncated ? output.join('') : value
}

function boundedThreadGoal(goal: AgentRuntimeThreadGoal): AgentRuntimeThreadGoal {
  const limits = AGENT_RUNTIME_THREAD_SUMMARY_LIMITS
  return {
    ...(goal.runtimeId ? { runtimeId: goal.runtimeId } : {}),
    threadId: truncateAgentRuntimeSummaryText(goal.threadId, limits.scalarBytes),
    objective: truncateAgentRuntimeSummaryText(goal.objective, limits.objectiveBytes),
    status: goal.status,
    ...(goal.tokenBudget !== undefined ? { tokenBudget: goal.tokenBudget } : {}),
    tokensUsed: goal.tokensUsed,
    timeUsedSeconds: goal.timeUsedSeconds,
    createdAt: truncateAgentRuntimeSummaryText(goal.createdAt, limits.scalarBytes),
    updatedAt: truncateAgentRuntimeSummaryText(goal.updatedAt, limits.scalarBytes)
  }
}

function boundedThreadTodos(todos: AgentRuntimeTodoList): AgentRuntimeTodoList {
  const limits = AGENT_RUNTIME_THREAD_SUMMARY_LIMITS
  return {
    threadId: truncateAgentRuntimeSummaryText(todos.threadId, limits.scalarBytes),
    updatedAt: truncateAgentRuntimeSummaryText(todos.updatedAt, limits.scalarBytes),
    items: todos.items.slice(0, limits.todoItems).map((item) => ({
      id: truncateAgentRuntimeSummaryText(item.id, limits.scalarBytes),
      content: truncateAgentRuntimeSummaryText(item.content, limits.todoContentBytes),
      status: item.status,
      ...(item.source ? { source: {
        kind: item.source.kind,
        planId: truncateAgentRuntimeSummaryText(item.source.planId, limits.scalarBytes),
        relativePath: truncateAgentRuntimeSummaryText(item.source.relativePath, limits.pathBytes),
        ordinal: item.source.ordinal,
        contentHash: truncateAgentRuntimeSummaryText(item.source.contentHash, limits.scalarBytes)
      } } : {}),
      createdAt: truncateAgentRuntimeSummaryText(item.createdAt, limits.scalarBytes),
      updatedAt: truncateAgentRuntimeSummaryText(item.updatedAt, limits.scalarBytes)
    }))
  }
}

function boundedThreadGuiPlan(guiPlan: AgentRuntimeThreadGuiPlan): AgentRuntimeThreadGuiPlan {
  const limits = AGENT_RUNTIME_THREAD_SUMMARY_LIMITS
  return {
    operation: guiPlan.operation,
    workspaceRoot: truncateAgentRuntimeSummaryText(guiPlan.workspaceRoot, limits.pathBytes),
    relativePath: truncateAgentRuntimeSummaryText(guiPlan.relativePath, limits.pathBytes),
    planId: truncateAgentRuntimeSummaryText(guiPlan.planId, limits.scalarBytes),
    ...(guiPlan.sourceRequest ? {
      sourceRequest: truncateAgentRuntimeSummaryText(guiPlan.sourceRequest, limits.planRequestBytes)
    } : {}),
    ...(guiPlan.title ? { title: truncateAgentRuntimeSummaryText(guiPlan.title, limits.titleBytes) } : {})
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
  }
  return bytes
}

export type AgentRuntimeBaseEvent = {
  threadId: string
  runtimeId?: AgentRuntimeId
  turnId?: string
  itemId?: string
  seq?: number
  createdAt?: string
  /** Host-captured immutable attribution for this exact turn. */
  principal?: PrincipalSnapshot
  /** Exact Host authorization lease; absent only for legacy unknown attribution. */
  principalContext?: PrincipalContextSnapshot
}

export type AgentRuntimeExecutionReceipt = ExecutionReceipt

type AgentRuntimeToolEventBase = AgentRuntimeBaseEvent & {
  kind: 'tool_event'
  itemId: string
  toolKind?: AgentRuntimeToolKind
  effects?: AgentRuntimeExecutionEffectClass[]
  completionReceipts?: AgentRuntimeCompletionReceipt[]
  callId?: string
  toolName?: string
  phase?: AgentRuntimeToolExecutionPhase
  factSource?: AgentRuntimeToolFactSource
  evidenceStrength?: AgentRuntimeToolEvidenceStrength
  attempt?: number
  resultDigest?: string
  errorCode?: string
  summary?: string
  detail?: string
  detailArtifact?: AgentRuntimeToolArtifactRef
  filePath?: string
  meta?: Record<string, unknown>
}

export type AgentRuntimeToolEvent =
  | (AgentRuntimeToolEventBase & {
      status: 'running'
      receipt?: never
    })
  | (AgentRuntimeToolEventBase & {
      status: 'success'
      receipt: ExecutionReceipt & { status: 'success' }
    })
  | (AgentRuntimeToolEventBase & {
      status: 'error'
      receipt: ExecutionReceipt & { status: 'error' }
    })

export type AgentRuntimeEvent =
  | (AgentRuntimeBaseEvent & {
      kind: 'thread_lifecycle'
      state: 'created' | 'updated' | 'archived'
      thread?: AgentRuntimeThread
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'turn_lifecycle'
      state: AgentRuntimeTurnStatus
      message?: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'runtime_status'
      phase?: AgentRuntimePhase
      message?: string
      latencyMs?: number
      metadata?: Record<string, unknown>
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'user_message'
      itemId: string
      text: string
      displayText?: string
      meta?: Record<string, unknown>
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'assistant_delta'
      itemId: string
      text: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'reasoning_delta'
      itemId: string
      text: string
      visibility: ReasoningVisibility
      source?: ReasoningSource
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'item_snapshot'
      item: AgentRuntimeItem
    })
  | AgentRuntimeToolEvent
  | (AgentRuntimeBaseEvent & {
      kind: 'child_event'
      child: AgentRuntimeChild
      message?: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'approval_requested'
      approvalId: string
      summary: string
      toolName?: string
      meta?: Record<string, unknown>
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'approval_resolved'
      approvalId: string
      decision: 'allowed' | 'denied' | 'error'
      message?: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'user_input_requested'
      requestId: string
      questions: AgentRuntimeInputQuestion[]
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'user_input_resolved'
      requestId: string
      status: 'submitted' | 'cancelled' | 'error'
      answers?: Array<{ id: string; label?: string; value: string }>
      message?: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'compaction_event'
      status: 'running' | 'success' | 'error'
      summary: string
      detail?: string
      auto?: boolean
      messagesBefore?: number
      messagesAfter?: number
      replacedTokens?: number
      sourceDigest?: string
      digestMarker?: string
      sourceItemIds?: string[]
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'handoff_event'
      status: 'started' | 'success' | 'error'
      sourceRuntimeId: AgentRuntimeId
      sourceThreadId: string
      targetRuntimeId: AgentRuntimeId
      targetThreadId: string
      targetTurnId?: string
      packetCreatedAt?: string
      message?: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'review_event'
      status: 'running' | 'success' | 'error'
      title: string
      reviewText?: string
      output?: unknown
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'goal_event'
      objective?: string
      status?: AgentRuntimeThreadGoalStatus
      lastFailureReason?: string
      cleared?: boolean
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'todo_event'
      items: AgentRuntimeTodoItem[]
      cleared?: boolean
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'usage'
      usage: AgentRuntimeUsage
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'error'
      recoverable: boolean
      severity: AgentRuntimeErrorSeverity
      message: string
      code?: string
      detail?: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'heartbeat'
    })

export const AGENT_RUNTIME_EVENT_KINDS = [
  'thread_lifecycle',
  'turn_lifecycle',
  'runtime_status',
  'user_message',
  'assistant_delta',
  'reasoning_delta',
  'item_snapshot',
  'tool_event',
  'child_event',
  'approval_requested',
  'approval_resolved',
  'user_input_requested',
  'user_input_resolved',
  'compaction_event',
  'handoff_event',
  'review_event',
  'goal_event',
  'todo_event',
  'usage',
  'error',
  'heartbeat'
] as const satisfies ReadonlyArray<AgentRuntimeEvent['kind']>

export type AgentRuntimeEventKind = typeof AGENT_RUNTIME_EVENT_KINDS[number]

export type AgentRuntimeCapabilities = {
  contractVersion: 1
  runtimeId: AgentRuntimeId
  transport: AgentRuntimeTransport
  matrix?: AgentRuntimeCapabilityMatrix
  events: {
    live: boolean
    replayable: boolean
    sequenced: boolean
    delivery: AgentRuntimeEventDelivery
  }
  threadMaterialization: AgentRuntimeThreadMaterialization
  latency: {
    phaseEvents: boolean
    firstTokenMetric: boolean
    turnDurationMetric: boolean
    supportedPhases?: AgentRuntimePhase[]
  }
  reasoning: {
    available: boolean
    streaming: boolean
    visibility: ReasoningVisibility
    source: ReasoningSource
  }
  model: {
    id?: string
    inputModalities: AgentRuntimeModality[]
    outputModalities: AgentRuntimeModality[]
    supportsToolCalling: boolean
    contextWindowTokens?: number
  }
  tools: {
    toolCalling: boolean
    commandExecution: CapabilityState
    fileChange: CapabilityState
    mcp: CapabilityState & { search?: CapabilityState; toolCount?: number }
    web: CapabilityState & { fetch?: CapabilityState; search?: CapabilityState }
    research: CapabilityState & {
      server?: 'mcp'
      toolName?: string
      sources?: AgentRuntimeResearchSourceKind[]
      maxResults?: number
    }
    computerUse: CapabilityState & {
      server?: 'mcp'
      toolName?: 'computer_use'
      backend?: 'browser-cdp' | 'gui-owl'
      inputIsolation?: 'agent-isolated' | 'host-approved'
      affectsUserInput?: boolean
      requiresHostFocus?: boolean
      usesHostClipboard?: boolean
    }
    codeNavigation?: CapabilityState & {
      operations?: AgentRuntimeCodeNavigationOperation[]
      languages?: string[]
      readonly?: boolean
    }
    skills: CapabilityState
    subagents: CapabilityState & { maxParallel?: number }
    diagnostics: CapabilityState
  }
  observability?: {
    fullTrace: CapabilityState & { durable: boolean }
  }
  context?: {
    state: CapabilityState
    compaction: CapabilityState
    goalResume: CapabilityState
    ledger?: CapabilityState
    handoff?: CapabilityState
  }
  controls: {
    interrupt: boolean
    steer: boolean
    approval: AgentRuntimeControlSupport
    userInput: AgentRuntimeControlSupport
    compact: AgentRuntimeCompactSupport
    fork: boolean
    review: boolean
    goals: boolean
    todos: boolean
    resumeSession: boolean
  }
  guard: {
    execution: AgentRuntimeExecutionGuardSupport
  }
  storage: {
    guiOwnedThreads: boolean
    backendThreadIdStable: boolean
    usage: boolean
    attachments: CapabilityState
    memory: CapabilityState
    checkpoints?: CapabilityState
    workspaceReferences?: CapabilityState
  }
  capabilityDescriptors?: AgentRuntimeCapabilityDescriptor[]
}

export function createUnavailableCapabilityState(reason?: string): CapabilityState {
  return reason ? { available: false, reason } : { available: false }
}

export function createAgentRuntimeCapabilityMatrix(input: {
  nativeHistory?: boolean
  nativeCompact?: boolean
  nativeResume?: boolean
  steer?: boolean
  fork?: boolean
  handoffImport?: boolean
  usage?: boolean
  eventReplay?: boolean
  reasons?: Partial<Record<keyof AgentRuntimeCapabilityMatrix, string>>
} = {}): AgentRuntimeCapabilityMatrix {
  const state = (key: keyof AgentRuntimeCapabilityMatrix, available: boolean | undefined): CapabilityState =>
    available ? { available: true } : createUnavailableCapabilityState(input.reasons?.[key] ?? 'unsupported')
  return {
    nativeHistory: state('nativeHistory', input.nativeHistory),
    nativeCompact: state('nativeCompact', input.nativeCompact),
    nativeResume: state('nativeResume', input.nativeResume),
    steer: state('steer', input.steer),
    fork: state('fork', input.fork),
    handoffImport: state('handoffImport', input.handoffImport),
    usage: state('usage', input.usage),
    eventReplay: state('eventReplay', input.eventReplay)
  }
}

export function createDefaultAgentRuntimeCapabilities(input: {
  runtimeId: AgentRuntimeId
  transport: AgentRuntimeTransport
}): AgentRuntimeCapabilities {
  const unsupported = () => createUnavailableCapabilityState('unsupported')
  return {
    contractVersion: 1,
    runtimeId: input.runtimeId,
    transport: input.transport,
    matrix: createAgentRuntimeCapabilityMatrix(),
    events: {
      live: false,
      replayable: false,
      sequenced: false,
      delivery: 'async_iterable'
    },
    threadMaterialization: 'immediate',
    latency: {
      phaseEvents: false,
      firstTokenMetric: false,
      turnDurationMetric: false,
      supportedPhases: []
    },
    reasoning: {
      available: false,
      streaming: false,
      visibility: 'none',
      source: 'unknown'
    },
    model: {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: false
    },
    tools: {
      toolCalling: false,
      commandExecution: unsupported(),
      fileChange: unsupported(),
      mcp: {
        ...unsupported(),
        search: unsupported()
      },
      web: {
        ...unsupported(),
        fetch: unsupported(),
        search: unsupported()
      },
      research: unsupported(),
      computerUse: unsupported(),
      codeNavigation: {
        ...unsupported(),
        operations: [],
        languages: [],
        readonly: true
      },
      skills: unsupported(),
      subagents: { ...unsupported() },
      diagnostics: unsupported()
    },
    observability: {
      fullTrace: { ...unsupported(), durable: true }
    },
    context: {
      state: unsupported(),
      compaction: unsupported(),
      goalResume: unsupported(),
      ledger: unsupported(),
      handoff: unsupported()
    },
    controls: {
      interrupt: false,
      steer: false,
      approval: 'unsupported',
      userInput: 'unsupported',
      compact: 'unsupported',
      fork: false,
      review: false,
      goals: false,
      todos: false,
      resumeSession: false
    },
    guard: {
      execution: 'unsupported'
    },
    storage: {
      guiOwnedThreads: false,
      backendThreadIdStable: false,
      usage: false,
      attachments: unsupported(),
      memory: unsupported(),
      checkpoints: unsupported(),
      workspaceReferences: unsupported()
    },
    capabilityDescriptors: []
  }
}
