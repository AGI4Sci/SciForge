import { GUI_PLAN_CREATE_PLAN_TOOL_NAME } from '@shared/gui-plan'

export type LocalRuntimeThreadStatus = 'idle' | 'running' | 'archived' | 'deleted'
export type LocalRuntimeTurnStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
export type LocalRuntimeItemStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'allowed'
  | 'denied'
  | 'expired'
  | string

export type LocalRuntimeThreadSummaryJson = {
  id: string
  title: string
  workspace?: string
  model: string
  mode: string
  status: LocalRuntimeThreadStatus
  relation?: 'primary' | 'fork' | 'side'
  parentThreadId?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  goal?: LocalRuntimeThreadGoalJson | null
  todos?: LocalRuntimeThreadTodoListJson | null
  guiPlan?: LocalRuntimeThreadGuiPlanJson | null
  createdAt: string
  updatedAt: string
}

export type LocalRuntimeThreadJson = LocalRuntimeThreadSummaryJson & {
  turns?: LocalRuntimeTurnJson[]
  latestSeq?: number
}

export type LocalRuntimeAttachmentMetadataJson = {
  id: string
  name: string
  mimeType: string
  byteSize: number
  hash: string
  width?: number
  height?: number
  localFilePath?: string
  textFallback?: LocalRuntimeAttachmentTextFallbackJson
  threadIds?: string[]
  workspaces?: string[]
  createdAt: string
  updatedAt: string
}

export type LocalRuntimeAttachmentTextFallbackJson = {
  dataBase64: string
  mimeType: string
  byteSize: number
  width?: number
  height?: number
  wasCompressed?: boolean
}

export type LocalRuntimeAttachmentDiagnosticsJson = {
  enabled: boolean
  rootDir: string
  count: number
  totalBytes: number
}

export type LocalRuntimeMemoryRecordJson = {
  id: string
  content: string
  scope: 'user' | 'workspace' | 'project'
  workspace?: string
  project?: string
  threadMode?: 'agent' | 'plan'
  taskType?: 'agent' | 'plan' | 'plan_draft' | 'plan_refine'
  sourceThreadId?: string
  sourceTurnId?: string
  tags?: string[]
  confidence?: number
  createdAt: string
  updatedAt: string
  disabledAt?: string
  deletedAt?: string
}

export type LocalRuntimeThreadGoalStatusJson =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export type LocalRuntimeThreadGoalJson = {
  threadId: string
  objective: string
  status: LocalRuntimeThreadGoalStatusJson
  tokenBudget?: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: string
  updatedAt: string
}

export type LocalRuntimeThreadGoalResponseJson = {
  goal: LocalRuntimeThreadGoalJson | null
}

export type LocalRuntimeThreadGuiPlanJson = {
  operation: 'draft' | 'refine'
  workspaceRoot: string
  relativePath: string
  planId: string
  sourceRequest?: string
  title?: string
}

export type LocalRuntimeClearThreadGoalResponseJson = {
  cleared: boolean
}

export type LocalRuntimeThreadTodoStatusJson = 'pending' | 'in_progress' | 'completed'

export type LocalRuntimeThreadTodoSourceJson = {
  kind: 'plan'
  planId: string
  relativePath: string
  ordinal: number
  contentHash: string
}

export type LocalRuntimeThreadTodoItemJson = {
  id: string
  content: string
  status: LocalRuntimeThreadTodoStatusJson
  source?: LocalRuntimeThreadTodoSourceJson
  createdAt: string
  updatedAt: string
}

export type LocalRuntimeThreadTodoListJson = {
  threadId: string
  items: LocalRuntimeThreadTodoItemJson[]
  updatedAt: string
}

export type LocalRuntimeThreadTodosResponseJson = {
  todos: LocalRuntimeThreadTodoListJson | null
}

export type LocalRuntimeClearThreadTodosResponseJson = {
  cleared: boolean
}

export type LocalRuntimeMemoryDiagnosticsJson = {
  enabled: boolean
  rootDir: string
  activeCount: number
  tombstoneCount: number
  lastInjectedIds?: string[]
}

export type LocalRuntimeCapabilityStateJson = {
  status: 'available' | 'disabled' | 'unavailable'
  enabled: boolean
  available: boolean
  reason?: string
}

export type LocalRuntimeCapabilityManifestJson = {
  contractVersion: number
  model: {
    id: string
    inputModalities: Array<'text' | 'image'>
    outputModalities: Array<'text' | 'image'>
    supportsToolCalling: boolean
    contextWindowTokens?: number
    messageParts: Array<'text' | 'image_url' | 'input_image'>
  }
  cli: Record<'serve' | 'run' | 'chat' | 'exec', LocalRuntimeCapabilityStateJson>
  mcp: LocalRuntimeCapabilityStateJson & {
    configuredServers: number
    connectedServers: number
    toolCount: number
    search?: {
      enabled: boolean
      mode: 'direct' | 'search' | 'auto'
      active: boolean
      indexedToolCount: number
      advertisedToolCount: number
    }
  }
  web: LocalRuntimeCapabilityStateJson & {
    fetch: LocalRuntimeCapabilityStateJson
    search: LocalRuntimeCapabilityStateJson
    provider?: string
  }
  research: LocalRuntimeCapabilityStateJson & {
    server: 'mcp'
    toolName: string
    sources: Array<'arxiv' | 'biorxiv' | 'semantic_scholar' | 'web' | 'cns'>
    maxResults: number
  }
  skills: LocalRuntimeCapabilityStateJson & {
    configuredRoots: number
    discoveredSkills: number
  }
  subagents: LocalRuntimeCapabilityStateJson & {
    maxParallel: number
  }
  attachments: LocalRuntimeCapabilityStateJson & {
    maxImageBytes: number
    maxImageDimension: number
    allowedMimeTypes: string[]
    textFallbackMaxBase64Bytes?: number
    textFallbackMaxImageDimension?: number
    textFallbackPreferredMimeType?: string
  }
  memory: LocalRuntimeCapabilityStateJson & {
    scopes: Array<'user' | 'workspace' | 'project'>
    maxInjectedRecords: number
  }
}

export type LocalRuntimeInfoJson = {
  host: string
  port: number
  dataDir: string
  configPath?: string
  model?: string
  approvalPolicy?: string
  sandboxMode?: string
  tokenEconomyMode?: boolean
  insecure?: boolean
  startedAt: string
  pid?: number
  capabilities: LocalRuntimeCapabilityManifestJson
}

export type LocalRuntimeToolDiagnosticsJson = {
  providers?: Array<Record<string, unknown>>
  mcpServers?: Array<Record<string, unknown>>
  mcpSearch?: {
    enabled?: boolean
    mode?: 'direct' | 'search' | 'auto'
    active?: boolean
    indexedToolCount?: number
    advertisedToolCount?: number
    topKDefault?: number
    topKMax?: number
	    minScore?: number
	    lastRefreshedAt?: string
	    lastError?: string
	    catalogFingerprint?: string
	    catalogDrift?: boolean
	  }
  webProviders?: Array<Record<string, unknown>>
  skills?: {
    enabled?: boolean
    roots?: Array<Record<string, unknown>>
    skills?: Array<Record<string, unknown>>
    validationErrors?: Array<Record<string, unknown> | string>
    lastActivations?: Array<Record<string, unknown>>
  }
  attachments?: LocalRuntimeAttachmentDiagnosticsJson
  memory?: LocalRuntimeMemoryDiagnosticsJson
  subagents?: {
    enabled?: boolean
    active?: number
    childRuns?: Array<Record<string, unknown>>
  }
}

export type LocalRuntimeSkillJson = {
  id: string
  name: string
  description?: string
  version?: string
  root?: string
  scope?: 'project' | 'global'
  legacy?: boolean
  triggers?: {
    commands?: string[]
    promptPatterns?: string[]
    fileTypes?: string[]
  }
  allowedTools?: string[]
}

export type LocalRuntimeSkillsResponseJson = {
  enabled?: boolean
  roots?: string[]
  skills?: LocalRuntimeSkillJson[]
  validationErrors?: Array<Record<string, unknown> | string>
}

export type LocalRuntimeChildRuntimeMetadataJson = {
  parentThreadId: string
  parentTurnId: string
  childId: string
  childLabel?: string
  childStatus: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
  childSeq: number
}

export type LocalRuntimeWebSourceJson = {
  sourceId?: string
  url?: string
  title?: string
  retrievedAt?: string
}

export type LocalRuntimeTurnJson = {
  id: string
  threadId: string
  status: LocalRuntimeTurnStatus
  prompt: string
  model?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  items?: LocalRuntimeTurnItemJson[]
  attachmentIds?: string[]
  activeSkillIds?: string[]
  injectedMemoryIds?: string[]
  skillInjectionBytes?: number
  error?: string
}

export type LocalRuntimeTurnItemJson = {
  id: string
  turnId: string
  threadId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  status: LocalRuntimeItemStatus
  createdAt: string
  finishedAt?: string
  kind: string
  text?: string
  displayText?: string
  toolName?: string
  callId?: string
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  arguments?: Record<string, unknown>
  output?: unknown
  isError?: boolean
  approvalId?: string
  inputId?: string
  prompt?: string
  questions?: Array<{
    header: string
    id: string
    question: string
    options: Array<{ label: string; description: string }>
  }>
  summary?: string
  replacedTokens?: number
  pinnedConstraints?: string[]
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
  message?: string
  code?: string
  details?: unknown
  severity?: 'info' | 'warning' | 'error'
  attachmentIds?: string[]
  activeSkillIds?: string[]
  injectedMemoryIds?: string[]
  skillInjectionBytes?: number
  target?: LocalRuntimeReviewTargetJson
  title?: string
  reviewText?: string
}

export type LocalRuntimeReviewTargetJson =
  | { kind: 'uncommittedChanges' }
  | { kind: 'baseBranch'; branch: string }
  | { kind: 'commit'; sha: string }
  | { kind: 'custom'; instructions: string }

export type LocalRuntimeReviewFindingJson = {
  title: string
  body: string
  confidenceScore: number
  priority: number
  codeLocation: {
    absoluteFilePath: string
    lineRange: { start: number; end: number }
  }
}

export type LocalRuntimeReviewOutputJson = {
  findings: LocalRuntimeReviewFindingJson[]
  overallCorrectness: 'patch is correct' | 'patch is incorrect'
  overallExplanation: string
  overallConfidenceScore: number
}

/**
 * Structured plan metadata the renderer expects on a successful
 * `create_plan` tool result. Mirrors the local runtime output contract
 * so the Workbench can reload the saved plan file and update the
 * Plan panel without parsing assistant prose.
 */
export type LocalRuntimePlanToolResultJson = {
  summary?: string
  plan_id: string
  workspace_root: string
  relative_path: string
  absolute_path?: string
  source_request?: string
  title?: string
  operation: 'draft' | 'refine'
  saved_at: string
  content_hash?: string
  byte_size?: number
}

export type LocalRuntimeStartTurnResponseJson = {
  threadId: string
  turnId: string
  userMessageItemId?: string
}

export type LocalRuntimeStartReviewResponseJson = LocalRuntimeStartTurnResponseJson & {
  reviewItemId?: string
}

export type LocalRuntimeAttachmentUploadResponseJson = {
  attachment: LocalRuntimeAttachmentMetadataJson
}

export type LocalRuntimeAttachmentContentResponseJson = {
  attachment: LocalRuntimeAttachmentMetadataJson
  dataBase64: string
}

export type LocalRuntimeMemoryListResponseJson = {
  memories: LocalRuntimeMemoryRecordJson[]
}

export type LocalRuntimeResumeSessionResponseJson = {
  thread_id?: string
  threadId?: string
  session_id?: string
  sessionId?: string
  message_count?: number
  summary?: string
}

/**
 * Optional plan context attached to a start-turn request. Carries the
 * reserved plan id, workspace root, and relative path the runtime
 * should expose to the model via the `create_plan` tool.
 */
export type LocalRuntimeStartTurnPlanContextJson = {
  operation: 'draft' | 'refine'
  workspaceRoot: string
  relativePath: string
  planId: string
  sourceRequest?: string
  title?: string
}

/**
 * Native local-runtime plan tool name. Re-exported alongside the shared
 * constant for renderer consumers.
 */
export const LOCAL_RUNTIME_PLAN_TOOL_NAME = GUI_PLAN_CREATE_PLAN_TOOL_NAME

export type LocalRuntimeUsageSnapshotJson = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cachedTokens?: number
  cacheHitTokens?: number
  cacheMissTokens?: number
  cacheHitRate?: number
  turns?: number
  costUsd?: number
  costCny?: number
  cacheSavingsUsd?: number
  cacheSavingsCny?: number
  tokenEconomySavingsTokens?: number
  tokenEconomySavingsUsd?: number
  tokenEconomySavingsCny?: number
}

export type LocalRuntimeEventJson = {
  kind?: string
  seq?: number
  timestamp?: string
  threadId?: string
  turnId?: string
  itemId?: string
  item?: LocalRuntimeTurnItemJson
  approvalId?: string
  toolName?: string
  callId?: string
  readyCount?: number
  toolResultCount?: number
	  fingerprint?: string
	  toolCount?: number
	  changeKind?: 'additive' | 'breaking'
	  toolNames?: string[]
  status?: string
  stage?:
    | 'setup'
    | 'pre_start'
    | 'post_start'
    | 'input_received'
    | 'input_cached'
    | 'input_routed'
    | 'input_compressed'
    | 'input_remembered'
    | 'pre_send'
    | 'post_send'
    | 'response_received'
  label?: string
  details?: unknown
  summary?: string
  prompt?: string
  inputId?: string
  questions?: Array<{
    header: string
    id: string
    question: string
    options: Array<{ label: string; description: string }>
  }>
  replacedTokens?: number
  pinnedConstraints?: string[]
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
  usage?: LocalRuntimeUsageSnapshotJson
  goal?: LocalRuntimeThreadGoalJson | null
  todos?: LocalRuntimeThreadTodoListJson | null
  cleared?: boolean
  message?: string
  code?: string
  severity?: 'info' | 'warning' | 'error'
  child?: LocalRuntimeChildRuntimeMetadataJson
}

export type RuntimeErrorJson = {
  code?: string
  error?: string | { message?: string; status?: number }
  message?: string
  details?: unknown
  severity?: 'info' | 'warning' | 'error'
}
