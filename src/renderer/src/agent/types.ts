import type {
  LocalRuntimeAttachmentContentResponseJson,
  LocalRuntimeAttachmentMetadataJson,
  LocalRuntimeAttachmentTextFallbackJson,
  LocalRuntimeMemoryRecordJson,
  LocalRuntimeInfoJson,
  LocalRuntimeSkillJson,
  LocalRuntimeToolDiagnosticsJson
} from './local-runtime-contract'
import type { AgentRuntimeId } from '@shared/app-settings'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import type {
  ScientificObjectComparison,
  ScientificObjectRef,
  WorkspaceObservation
} from '@shared/scientific-objects'
import type {
  AgentRuntimeCodeNavigationInput,
  AgentRuntimeCodeNavigationOutput,
  AgentRuntimeChild,
  AgentRuntimeContextState,
  AgentRuntimeExecutionIntent,
  AgentRuntimeFileReference,
  AgentRuntimeListThreadChildrenResponse,
  AgentRuntimeMemoryRecord,
  AgentRuntimePhase,
  AgentRuntimeReadChildTranscriptInput,
  AgentRuntimeReadChildTranscriptResponse,
  AgentRuntimeResult,
  AgentRuntimeThreadGuiPlan,
  AgentRuntimeThreadRelation,
  AgentRuntimeThreadSidebarVisibility,
  AgentRuntimeToolArtifactRef,
  AgentRuntimeTurnStatus,
  AgentRuntimeWorkspaceReference,
  AgentRuntimeWorkspaceReferencePreview,
  ReasoningSource,
  ReasoningVisibility
} from '@shared/agent-runtime-contract'

export type ToolItemKind = 'tool_call' | 'command_execution' | 'file_change'
export type RuntimeErrorSeverity = 'info' | 'warning' | 'error'
export type UserMessageManagedBy = 'remoteChannel' | 'claw'

export function isRemoteChannelManagedBy(value: unknown): value is UserMessageManagedBy {
  return value === 'remoteChannel' || value === 'claw'
}

export function normalizeUserMessageManagedBy(value: unknown): UserMessageManagedBy | undefined {
  if (value === 'remoteChannel') return 'remoteChannel'
  if (value === 'claw') return 'remoteChannel'
  return undefined
}

export type AttachmentReference = {
  id: string
  name?: string
  mimeType?: string
  byteSize?: number
  width?: number
  height?: number
  previewUrl?: string
  path?: string
  relativePath?: string
  absolutePath?: string
}

export type GeneratedFileReference = {
  id?: string
  name?: string
  fileName?: string
  mimeType?: string
  byteSize?: number
  width?: number
  height?: number
  previewUrl?: string
  dataUrl?: string
  url?: string
  path?: string
  relativePath?: string
  absolutePath?: string
}

export type RuntimeChildMetadata = {
  parentThreadId: string
  parentTurnId: string
  childId: string
  childLabel?: string
  childStatus: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
  childSeq: number
}

export type WebCitationSource = {
  sourceId?: string
  url?: string
  title?: string
  retrievedAt?: string
}

export type RuntimeReasoningMetadata = {
  visibility?: ReasoningVisibility
  source?: ReasoningSource
}

export type RuntimeDisclosureMetadata = {
  displayText?: string
  source?: 'desktop' | 'feishu' | 'weixin' | 'discord' | string
  sourceLabel?: string
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  generatedFiles?: GeneratedFileReference[]
  activeSkillIds?: string[]
  injectedMemoryIds?: string[]
  skillInjectionBytes?: number
  child?: RuntimeChildMetadata
  sources?: WebCitationSource[]
  reasoning?: RuntimeReasoningMetadata
  scientificObjects?: ScientificObjectRef[]
  scientificObjectComparisons?: ScientificObjectComparison[]
  workspaceObservations?: WorkspaceObservation[]
}

export type UserInputOption = {
  label: string
  description: string
}

export type UserInputQuestion = {
  header: string
  id: string
  question: string
  options: UserInputOption[]
}

export type UserInputAnswer = {
  id: string
  label: string
  value: string
}

export type NormalizedThread = {
  id: string
  runtimeId?: AgentRuntimeId
  workspaceLocator?: WorkspaceLocator
  title: string
  updatedAt: string
  model: string
  mode: string
  workspace?: string
  status?: string
  archived?: boolean
  preview?: string
  latestTurnId?: string
  latestTurnStatus?: string
  threadSource?: string
  visibility?: string
  sidebarVisibility?: string
  titleSource?: string
  relation?: 'primary' | 'fork' | 'side'
  parentThreadId?: string
  parentTurnId?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  agentNickname?: string
  agentRole?: string
  goal?: ThreadGoal | null
  todos?: ThreadTodoList | null
  guiPlan?: AgentRuntimeThreadGuiPlan | null
  hasUserMessage?: boolean
}

export type ThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export type ThreadGoal = {
  threadId: string
  objective: string
  status: ThreadGoalStatus
  tokenBudget?: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: string
  updatedAt: string
}

export type ThreadTodoStatus = 'pending' | 'in_progress' | 'completed'

export type ThreadTodoSource = {
  kind: 'plan'
  planId: string
  relativePath: string
  ordinal: number
  contentHash: string
}

export type ThreadTodoItem = {
  id: string
  content: string
  status: ThreadTodoStatus
  source?: ThreadTodoSource
  createdAt: string
  updatedAt: string
}

export type ThreadTodoList = {
  threadId: string
  items: ThreadTodoItem[]
  updatedAt: string
}

export type RuntimeConnectionStatus = 'idle' | 'checking' | 'ready' | 'offline'

export type ThreadListOptions = {
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  includeSide?: boolean
  summary?: boolean
}

export type ThreadCreateInput = {
  workspace?: string
  workspaceLocator?: WorkspaceLocator
  title?: string
  mode?: string
  relation?: AgentRuntimeThreadRelation
  parentThreadId?: string
  parentTurnId?: string
  threadSource?: string
  sidebarVisibility?: AgentRuntimeThreadSidebarVisibility
}

export type ToolBlock = {
  kind: 'tool'
  id: string
  createdAt?: string
  summary: string
  status: 'running' | 'success' | 'error'
  toolKind?: ToolItemKind
  /** Full text content from runtime: stdout/stderr or unified patch text */
  detail?: string
  detailArtifact?: AgentRuntimeToolArtifactRef
  /** Resolved file path for file_change items, when known */
  filePath?: string
  /** Optional structured metadata, e.g. { exit_code, duration_ms, command } */
  meta?: Record<string, unknown>
}

export type CompactionBlock = {
  kind: 'compaction'
  id: string
  createdAt?: string
  summary: string
  status: 'running' | 'success' | 'error'
  detail?: string
  auto?: boolean
  messagesBefore?: number
  messagesAfter?: number
  replacedTokens?: number
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
}

export type ReviewTarget =
  | { kind: 'uncommittedChanges' }
  | { kind: 'baseBranch'; branch: string }
  | { kind: 'commit'; sha: string }
  | { kind: 'custom'; instructions: string }

export type ReviewFinding = {
  title: string
  body: string
  confidenceScore: number
  priority: number
  codeLocation: {
    absoluteFilePath: string
    lineRange: { start: number; end: number }
  }
}

export type ReviewOutput = {
  findings: ReviewFinding[]
  overallCorrectness: 'patch is correct' | 'patch is incorrect'
  overallExplanation: string
  overallConfidenceScore: number
}

export type ReviewBlock = {
  kind: 'review'
  id: string
  createdAt?: string
  title: string
  status: 'running' | 'success' | 'error'
  target?: ReviewTarget
  reviewText?: string
  output?: ReviewOutput
}

export type ChatBlock =
  | {
      kind: 'user'
      id: string
      turnId?: string
      createdAt?: string
      text: string
      modelLabel?: string
      managedBy?: UserMessageManagedBy
      meta?: RuntimeDisclosureMetadata
      turnStatus?: string
    }
  | { kind: 'assistant'; id: string; createdAt?: string; text: string; meta?: RuntimeDisclosureMetadata }
  | { kind: 'reasoning'; id: string; createdAt?: string; text: string; meta?: RuntimeDisclosureMetadata }
  | ToolBlock
  | CompactionBlock
  | ReviewBlock
  | {
      kind: 'system'
      id: string
      createdAt?: string
      text: string
      code?: string
      detail?: string
      severity?: RuntimeErrorSeverity
    }
  | {
      kind: 'approval'
      id: string
      createdAt?: string
      approvalId: string
      summary: string
      toolName?: string
      status: 'pending' | 'allowed' | 'denied' | 'error'
      errorMessage?: string
      meta?: RuntimeDisclosureMetadata
    }
  | {
      kind: 'user_input'
      id: string
      createdAt?: string
      requestId: string
      questions: UserInputQuestion[]
      status: 'pending' | 'submitted' | 'cancelled' | 'error'
      answers?: UserInputAnswer[]
      errorMessage?: string
    }

export type ApprovalRequestPayload = {
  approvalId: string
  summary: string
  toolName?: string
  status?: 'pending' | 'allowed' | 'denied' | 'error'
  errorMessage?: string
  meta?: RuntimeDisclosureMetadata
}

export type ToolEventPayload = {
  itemId: string
  summary: string
  status: 'running' | 'success' | 'error'
  toolKind?: ToolItemKind
  detail?: string
  detailArtifact?: AgentRuntimeToolArtifactRef
  filePath?: string
  meta?: Record<string, unknown>
}

export type RuntimeStatusEventPayload = {
  kind:
    | 'tool_result_upload_wait'
    | 'tool_catalog_changed'
    | 'execution_suppressed'
    | 'compaction_summary_fallback'
    | 'runtime_handoff'
  itemId: string
  turnId?: string
  createdAt?: string
  phase?: AgentRuntimePhase
  message?: string
  sourceRuntimeId?: string
  sourceThreadId?: string
  targetRuntimeId?: string
  targetThreadId?: string
  toolResultCount?: number
  changeKind?: 'additive' | 'breaking'
  toolName?: string
  callId?: string
}

export type RuntimeErrorEventPayload = {
  itemId: string
  createdAt?: string
  message: string
  code?: string
  details?: unknown
  severity?: RuntimeErrorSeverity
}

export type CompactionEventPayload = {
  itemId: string
  summary: string
  status: 'running' | 'success' | 'error'
  detail?: string
  auto?: boolean
  messagesBefore?: number
  messagesAfter?: number
  replacedTokens?: number
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
  createdAt?: string
}

export type ReviewEventPayload = {
  itemId: string
  createdAt?: string
  title: string
  status: 'running' | 'success' | 'error'
  target?: ReviewTarget
  reviewText?: string
  output?: ReviewOutput
}

export type UserInputRequestPayload = {
  itemId: string
  requestId: string
  questions: UserInputQuestion[]
}

export type UserInputStatusPayload = {
  itemId: string
  status: 'submitted' | 'cancelled' | 'error'
  answers?: UserInputAnswer[]
  errorMessage?: string
}

export type UserMessageEventPayload = {
  itemId: string
  turnId?: string
  createdAt?: string
  text: string
  modelLabel?: string
  managedBy?: UserMessageManagedBy
  meta?: RuntimeDisclosureMetadata
}

export type TurnLifecycleEventPayload = {
  threadId?: string
  turnId?: string
  state: AgentRuntimeTurnStatus
  message?: string
  createdAt?: string
}

export type ThreadLifecycleEventPayload = {
  threadId: string
  state: 'created' | 'updated' | 'archived'
  createdAt?: string
}

export type ChildEventPayload = {
  threadId: string
  turnId?: string
  seq?: number
  createdAt?: string
  child: AgentRuntimeChild
  message?: string
}

export type ThreadDeltaEvent = {
  itemId?: string
  text: string
  kind: 'agent_message' | 'agent_reasoning'
  seq?: number
  meta?: RuntimeDisclosureMetadata
}

export type AssistantMessageEventPayload = {
  itemId: string
  turnId?: string
  createdAt?: string
  text: string
  meta?: RuntimeDisclosureMetadata
}

/** Cumulative usage/cost for a local runtime thread. */
export type ThreadUsageSnapshot = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  cacheHitRate: number | null
  totalTokens: number
  costUsd: number
  costCny: number | null
  cacheSavingsUsd: number
  cacheSavingsCny: number | null
  tokenEconomySavingsTokens: number
  tokenEconomySavingsUsd: number
  tokenEconomySavingsCny: number | null
  turns: number
}

export type ThreadEventSink = {
  onSeq(seq: number): void
  onDeltas(deltas: ThreadDeltaEvent[]): void
  onAssistantMessage?(ev: AssistantMessageEventPayload): void
  onUserMessage(ev: UserMessageEventPayload): void
  onTool(ev: ToolEventPayload): void
  onCompaction(ev: CompactionEventPayload): void
  onReview?(ev: ReviewEventPayload): void
  onApproval(req: ApprovalRequestPayload): void
  onUserInput(req: UserInputRequestPayload): void
  onUserInputStatus(ev: UserInputStatusPayload): void
  onRuntimeStatus?(ev: RuntimeStatusEventPayload): void
  onRuntimeError?(ev: RuntimeErrorEventPayload): void
  onThreadLifecycle?(ev: ThreadLifecycleEventPayload): void
  onTurnLifecycle?(ev: TurnLifecycleEventPayload): void
  onChild?(ev: ChildEventPayload): void
  onGoal(ev: { threadId: string; goal: ThreadGoal | null; cleared?: boolean; createdAt?: string }): void
  onTodos?(ev: { threadId: string; todos: ThreadTodoList | null; cleared?: boolean; createdAt?: string }): void
  onTurnComplete(): void
  onError(err: Error): void
  /** Optional: cumulative usage update for the thread. */
  onUsage?(usage: ThreadUsageSnapshot): void
}

export type AgentProviderCapabilities = {
  interrupt: boolean
  stream: boolean
  approvals: boolean
  attachFiles: boolean
  review?: boolean
  compact?: boolean
  fork?: boolean
  steer?: boolean
  goals?: boolean
  todos?: boolean
  skills?: boolean
  checkpoints?: boolean
  sideConversations?: boolean
}

export type AgentProviderDirectiveOptions = {
  /** Stable renderer identity used to make persisted runtime delivery idempotent. */
  clientDirectiveId?: string
}

export interface AgentProvider {
  readonly id: AgentRuntimeId
  readonly displayName: string
  getCapabilities(): AgentProviderCapabilities
  rememberThreadRuntime?(
    threadId: string,
    runtimeId?: AgentRuntimeId,
    workspaceLocator?: WorkspaceLocator
  ): void
  connect(): Promise<void>
  listThreads(options?: ThreadListOptions): Promise<NormalizedThread[]>
  createThread(input: ThreadCreateInput): Promise<NormalizedThread>
  getRecentThreadView(threadId: string): Promise<{
    runtimeId?: AgentRuntimeId
    workspaceLocator?: WorkspaceLocator
    blocks: ChatBlock[]
    latestSeq: number
    threadStatus?: string
    latestTurnId?: string
    latestTurnStatus?: string
    latestUserMessageId?: string
    turnDurationByUserId?: Record<string, number>
    usage?: ThreadUsageSnapshot
    goal?: ThreadGoal | null
    todos?: ThreadTodoList | null
    guiPlan?: AgentRuntimeThreadGuiPlan | null
    nextCursor?: string | null
  }>
  getThreadStatus(threadId: string): Promise<{
    runtimeId?: AgentRuntimeId
    latestSeq: number
    threadStatus?: string
    latestTurnId?: string
    latestTurnStatus?: string
    usage?: ThreadUsageSnapshot
  }>
  getThreadPage(threadId: string, cursor?: string): Promise<{
    blocks: ChatBlock[]
    latestSeq: number
    nextCursor: string | null
  }>
  readToolArtifact(ref: AgentRuntimeToolArtifactRef): Promise<string>
  sendUserMessage(
    threadId: string,
    text: string,
    options?: {
      mode?: string
      workspace?: string
      title?: string
      model?: string
      reasoningEffort?: string
      workspaceLocator?: WorkspaceLocator
      executionIntent?: AgentRuntimeExecutionIntent
      governanceProfile?: 'default' | 'write' | 'remote_guard'
      displayText?: string
      visibleContextOwnerThreadId?: string
      guiPlan?: {
        operation: 'draft' | 'refine'
        workspaceRoot: string
        relativePath: string
        planId: string
        sourceRequest?: string
        title?: string
      }
      attachmentIds?: string[]
      fileReferences?: AgentRuntimeFileReference[]
    } & AgentProviderDirectiveOptions
  ): Promise<{
    turnId: string
    threadId: string
    userMessageItemId?: string
    threadIdChange?: 'handoff' | 'promote'
  }>
  reviewThread?(
    threadId: string,
    target: ReviewTarget,
    options?: { model?: string }
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string; reviewItemId?: string }>
  getRuntimeInfo?(): Promise<LocalRuntimeInfoJson>
  getToolDiagnostics?(): Promise<LocalRuntimeToolDiagnosticsJson>
  listSkills?(): Promise<LocalRuntimeSkillJson[]>
  uploadAttachment?(input: {
    name: string
    mimeType?: string
    dataBase64: string
    localFilePath?: string
    textFallback?: LocalRuntimeAttachmentTextFallbackJson
    threadId?: string
    workspace?: string
  }): Promise<LocalRuntimeAttachmentMetadataJson>
  getAttachmentContent?(
    attachmentId: string,
    options?: { threadId?: string; workspace?: string }
  ): Promise<LocalRuntimeAttachmentContentResponseJson>
  runCodeNavigation?(
    input: AgentRuntimeCodeNavigationInput
  ): Promise<AgentRuntimeResult<AgentRuntimeCodeNavigationOutput>>
  getContextState?(threadId: string): Promise<AgentRuntimeContextState>
  listThreadChildren?(threadId: string, options?: {
    turnId?: string
    activeOnly?: boolean
    cursor?: string
    limit?: number
  }): Promise<AgentRuntimeListThreadChildrenResponse>
  readChildTranscript?(input: AgentRuntimeReadChildTranscriptInput): Promise<AgentRuntimeReadChildTranscriptResponse>
  createMemory?(input: {
    content: string
    scope?: AgentRuntimeMemoryRecord['scope']
    workspace?: string
    project?: string
    threadMode?: AgentRuntimeMemoryRecord['threadMode']
    taskType?: AgentRuntimeMemoryRecord['taskType']
    tags?: string[]
    confidence?: number
    disabled?: boolean
  }): Promise<LocalRuntimeMemoryRecordJson>
  listMemories?(options?: {
    scope?: AgentRuntimeMemoryRecord['scope']
    workspace?: string
    project?: string
    threadMode?: AgentRuntimeMemoryRecord['threadMode']
    taskType?: AgentRuntimeMemoryRecord['taskType']
    includeDeleted?: boolean
    includeDisabled?: boolean
    query?: string
    limit?: number
  }): Promise<LocalRuntimeMemoryRecordJson[]>
  updateMemory?(
    memoryId: string,
    patch: { content?: string; tags?: string[]; confidence?: number; disabled?: boolean }
  ): Promise<LocalRuntimeMemoryRecordJson>
  deleteMemory?(memoryId: string): Promise<LocalRuntimeMemoryRecordJson>
  listWorkspaceReferences?(input: {
    workspaceRoot: string
    path?: string
    recursive?: boolean
    limit?: number
  }): Promise<{ ok: true; references: AgentRuntimeWorkspaceReference[] } | { ok: false; message: string }>
  previewWorkspaceReference?(input: {
    workspaceRoot: string
    path: string
  }): Promise<{ ok: true; preview: AgentRuntimeWorkspaceReferencePreview } | { ok: false; message: string }>
  steerUserMessage?(
    threadId: string,
    turnId: string,
    text: string,
    options?: AgentProviderDirectiveOptions
  ): Promise<void>
  interruptTurn(threadId: string, turnId: string, options?: { discard?: boolean }): Promise<void>
  renameThread(threadId: string, title: string): Promise<void>
  updateThreadRelation?(threadId: string, relation: 'primary' | 'fork' | 'side'): Promise<void>
  updateThreadWorkspace?(threadId: string, workspace: string): Promise<void>
  archiveThread?(threadId: string, archived: boolean): Promise<void>
  deleteThread(threadId: string): Promise<void>
  compactThread?(threadId: string, reason?: string): Promise<void>
  getThreadGoal?(threadId: string): Promise<ThreadGoal | null>
  setThreadGoal?(
    threadId: string,
    patch: { objective?: string; status?: ThreadGoalStatus; tokenBudget?: number | null }
  ): Promise<ThreadGoal>
  clearThreadGoal?(threadId: string): Promise<boolean>
  getThreadTodos?(threadId: string): Promise<ThreadTodoList | null>
  setThreadTodos?(
    threadId: string,
    todos: Array<{
      id?: string
      content: string
      status: ThreadTodoStatus
      source?: ThreadTodoSource
    }>
  ): Promise<ThreadTodoList>
  clearThreadTodos?(threadId: string): Promise<boolean>
  forkThread?(
    threadId: string,
    options?: { relation?: 'primary' | 'fork' | 'side'; title?: string }
  ): Promise<NormalizedThread>
  resumeSession?(
    sessionId: string,
    options?: {
      model?: string
      mode?: string
      maxResumeCount?: number
      workspaceLocator?: WorkspaceLocator
    }
  ): Promise<{ threadId: string; sessionId: string }>
  subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void>
  /** Resolve a runtime approval request through the active provider. */
  submitApprovalDecision?(
    approvalId: string,
    decision: 'allow' | 'deny',
    remember?: boolean
  ): Promise<void>
  /** Resolve a runtime user-input request through the active provider. */
  submitUserInputResponse?(requestId: string, answers: UserInputAnswer[]): Promise<void>
  cancelUserInput?(requestId: string): Promise<void>
}
