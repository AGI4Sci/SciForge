import { z } from 'zod'
import type { CompletionChecksResult } from './completion-checks.js'

export const RUNTIME_INSPECTOR_MCP_SERVER_NAME = 'sciforge-runtime-inspector'
export const RUNTIME_INSPECTOR_MCP_SERVER_VERSION = '0.1.0'
export const RUNTIME_INSPECTOR_WORKER_TRANSPORT = 'stdio'

export const RUNTIME_INSPECTOR_DIAGNOSTICS_RESOURCE_URI = 'runtime-inspector://diagnostics'
export const GIT_STATUS_RESOURCE_URI = 'git://status'
export const GIT_BRANCHES_RESOURCE_URI = 'git://branches'
export const GIT_DIFF_RESOURCE_URI = 'git://diff'
export const GIT_DIFF_RESOURCE_URI_TEMPLATE = 'git://diff/{+path}'
export const RUNTIME_PORTS_RESOURCE_URI = 'runtime://ports'
export const RUNTIME_HEALTH_RESOURCE_URI = 'runtime://health'
export const RUNTIME_DEPENDENCIES_RESOURCE_URI = 'runtime://dependencies'
export const RUNTIME_MODEL_ROUTER_RESOURCE_URI = 'runtime://model-router'
export const RUNTIME_LOCAL_RESOURCE_URI = 'runtime://local'
export const LSP_STATUS_RESOURCE_URI = 'lsp://status'

export const RUNTIME_INSPECTOR_DEFAULT_LIMIT = 100
export const RUNTIME_INSPECTOR_MAX_LIMIT = 500
export const RUNTIME_INSPECTOR_DEFAULT_DIFF_BYTES = 64 * 1024
export const RUNTIME_INSPECTOR_MAX_DIFF_BYTES = 200 * 1024
export const RUNTIME_INSPECTOR_DEFAULT_TIMEOUT_MS = 5_000
export const RUNTIME_INSPECTOR_MAX_TIMEOUT_MS = 30_000
export const RUNTIME_INSPECTOR_DEFAULT_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
export const RUNTIME_INSPECTOR_DEFAULT_RUNTIME_BASE_URL = 'http://127.0.0.1:8899'

export const RuntimeInspectorToolNames = [
  'gui_git_status',
  'gui_git_branches',
  'gui_git_diff_preview',
  'gui_runtime_ports',
  'gui_runtime_health',
  'gui_runtime_dependency_report',
  'gui_runtime_model_router_status',
  'gui_runtime_status',
  'gui_lsp_status',
  'gui_lsp_query',
  'gui_completion_check'
] as const

export type RuntimeInspectorToolName = typeof RuntimeInspectorToolNames[number]
export type RuntimeInspectorWorkerHealthStatus = 'healthy' | 'degraded' | 'unhealthy'

export type RuntimeInspectorWorkerHealth = {
  status: RuntimeInspectorWorkerHealthStatus
  available: boolean
  reason?: string
}

export type RuntimeInspectorErrorCode =
  | 'invalid_request'
  | 'workspace_root_required'
  | 'workspace_root_not_found'
  | 'path_outside_repository'
  | 'not_git_repo'
  | 'git_unavailable'
  | 'git_error'
  | 'runtime_unavailable'
  | 'runtime_http_error'
  | 'runtime_not_configured'
  | 'dependency_missing'
  | 'lsp_not_started'
  | 'language_server_missing'
  | 'unsupported_language'
  | 'file_not_found'
  | 'file_read_failed'
  | 'lsp_request_failed'
  | 'lsp_request_timeout'
  | 'lsp_session_closed'
  | 'aborted'
  | 'unknown'

export type RuntimeInspectorError = {
  code: RuntimeInspectorErrorCode
  reason: string
  retryable: boolean
  suggestion: string
  details?: unknown
}

export type RuntimeInspectorFailure = {
  ok: false
  error: RuntimeInspectorError
}

export type RuntimeInspectorResult<T extends Record<string, unknown>> =
  | ({ ok: true } & T)
  | RuntimeInspectorFailure

export const RuntimeInspectorErrorCodeSchema = z.enum([
  'invalid_request',
  'workspace_root_required',
  'workspace_root_not_found',
  'path_outside_repository',
  'not_git_repo',
  'git_unavailable',
  'git_error',
  'runtime_unavailable',
  'runtime_http_error',
  'runtime_not_configured',
  'dependency_missing',
  'lsp_not_started',
  'language_server_missing',
  'unsupported_language',
  'file_not_found',
  'file_read_failed',
  'lsp_request_failed',
  'lsp_request_timeout',
  'lsp_session_closed',
  'aborted',
  'unknown'
])

export const RuntimeInspectorErrorSchema = z.object({
  code: RuntimeInspectorErrorCodeSchema,
  reason: z.string().min(1),
  retryable: z.boolean(),
  suggestion: z.string().min(1),
  details: z.unknown().optional()
}).strict()

export const RuntimeInspectorFailureSchema = z.object({
  ok: z.literal(false),
  error: RuntimeInspectorErrorSchema
}).strict()

const workspacePathSchema = z.string().trim().min(1).max(4096)
const optionalWorkspacePathSchema = z.string().trim().max(4096).optional()
const cursorSchema = z.string().trim().min(1).max(64).optional()
const limitSchema = z.number().int().min(1).max(RUNTIME_INSPECTOR_MAX_LIMIT).optional()

export const RuntimeInspectorWorkspaceInputSchema = z.object({
  workspace_root: optionalWorkspacePathSchema.describe('Workspace directory. Defaults to the worker configured workspace root.')
}).strict()

export const GitStatusInputSchema = RuntimeInspectorWorkspaceInputSchema.extend({
  limit: limitSchema,
  cursor: cursorSchema,
  include_untracked: z.boolean().optional()
}).strict()

export const GitBranchesInputSchema = RuntimeInspectorWorkspaceInputSchema.extend({
  include_remote: z.boolean().optional(),
  limit: limitSchema,
  cursor: cursorSchema
}).strict()

export const GitDiffScopeSchema = z.enum(['unstaged', 'staged', 'all'])

export const GitDiffPreviewInputSchema = RuntimeInspectorWorkspaceInputSchema.extend({
  scope: GitDiffScopeSchema.optional(),
  path: z.string().trim().max(4096).optional(),
  context_lines: z.number().int().min(0).max(20).optional(),
  max_bytes: z.number().int().min(1).max(RUNTIME_INSPECTOR_MAX_DIFF_BYTES).optional(),
  cursor: cursorSchema
}).strict()

export const RuntimePortsInputSchema = z.object({
  include_reachability: z.boolean().optional()
}).strict()

export const RuntimeHealthInputSchema = z.object({
  include_tools: z.boolean().optional()
}).strict()

export const RuntimeDependencyReportInputSchema = z.object({
  workspace_root: optionalWorkspacePathSchema,
  include_runtime_http: z.boolean().optional()
}).strict()

export const RuntimeModelRouterStatusInputSchema = z.object({}).strict()

export const RuntimeLocalStatusInputSchema = z.object({
  include_tools: z.boolean().optional()
}).strict()

export const LspOperationSchema = z.enum([
  'goToDefinition',
  'findReferences',
  'hover',
  'documentSymbol',
  'workspaceSymbol',
  'goToImplementation'
])

export const LspStatusInputSchema = RuntimeInspectorWorkspaceInputSchema.extend({
  include_dependency_probe: z.boolean().optional()
}).strict()

export const LspQueryInputSchema = z.object({
  workspace_root: workspacePathSchema,
  operation: LspOperationSchema,
  file_path: z.string().trim().max(4096).optional(),
  line: z.number().int().min(1).optional(),
  character: z.number().int().min(1).optional(),
  query: z.string().trim().max(512).optional(),
  unsaved_buffer_policy: z.literal('reject').optional()
}).strict().superRefine((input, context) => {
  const positionRequired = ['goToDefinition', 'findReferences', 'hover', 'goToImplementation'].includes(input.operation)
  if (input.operation !== 'workspaceSymbol' && !input.file_path) {
    context.addIssue({
      code: 'custom',
      path: ['file_path'],
      message: 'file_path is required for file-scoped LSP operations.'
    })
  }
  if (positionRequired && (input.line === undefined || input.character === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['line'],
      message: `${input.operation} requires 1-based line and character.`
    })
  }
})

export type GitStatusInput = z.infer<typeof GitStatusInputSchema>
export type GitBranchesInput = z.infer<typeof GitBranchesInputSchema>
export type GitDiffPreviewInput = z.infer<typeof GitDiffPreviewInputSchema>
export type RuntimePortsInput = z.infer<typeof RuntimePortsInputSchema>
export type RuntimeHealthInput = z.infer<typeof RuntimeHealthInputSchema>
export type RuntimeDependencyReportInput = z.infer<typeof RuntimeDependencyReportInputSchema>
export type RuntimeModelRouterStatusInput = z.infer<typeof RuntimeModelRouterStatusInputSchema>
export type RuntimeLocalStatusInput = z.infer<typeof RuntimeLocalStatusInputSchema>
export type LspStatusInput = z.infer<typeof LspStatusInputSchema>
export type LspQueryInput = z.infer<typeof LspQueryInputSchema>
export type LspOperation = z.infer<typeof LspOperationSchema>
export type GitDiffScope = z.infer<typeof GitDiffScopeSchema>

export type GitStatusEntry = {
  index: string
  workingTree: string
  path: string
  originalPath?: string
}

export type GitStatusResult = RuntimeInspectorResult<{
  workspaceRoot: string
  repositoryRoot: string
  currentBranch: string | null
  head: string | null
  dirtyCount: number
  entries: GitStatusEntry[]
  limit: number
  cursor?: string
  nextCursor?: string
  truncated: boolean
  resourceUri: string
}>

export type GitBranchSummary = {
  name: string
  kind: 'local' | 'remote'
  current: boolean
  head: string
  upstream?: string
  updatedAt?: string
}

export type GitBranchesResult = RuntimeInspectorResult<{
  workspaceRoot: string
  repositoryRoot: string
  currentBranch: string | null
  branches: GitBranchSummary[]
  total: number
  limit: number
  cursor?: string
  nextCursor?: string
  truncated: boolean
  resourceUri: string
}>

export type TextChunk = {
  text: string
  offset: number
  bytesRead: number
  truncated: boolean
  nextOffset?: number
  nextCursor?: string
}

export type GitDiffPreviewResult = RuntimeInspectorResult<{
  workspaceRoot: string
  repositoryRoot: string
  scope: GitDiffScope
  path?: string
  stat: string
  patch: TextChunk
  resourceUri: string
}>

export type RuntimePortSummary = {
  id: 'model-router' | 'local-runtime'
  label: string
  baseUrl: string
  host: string
  port: number | null
  configured: boolean
  local: boolean
  reachable?: boolean
  reason?: string
}

export type RuntimePortsResult = RuntimeInspectorResult<{
  ports: RuntimePortSummary[]
  resourceUri: string
}>

export type RuntimeEndpointStatus = {
  status: 'healthy' | 'degraded' | 'unavailable' | 'not_configured' | 'auth_required'
  reachable: boolean
  statusCode?: number
  message: string
}

export type RuntimeModelRouterStatusResult = RuntimeInspectorResult<{
  baseUrl: string
  managementUrl: string
  port: number | null
  health: RuntimeEndpointStatus
  resourceUri: string
}>

export type RuntimeLocalStatusResult = RuntimeInspectorResult<{
  baseUrl: string
  port: number | null
  health: RuntimeEndpointStatus
  runtimeInfo?: Record<string, unknown>
  toolDiagnostics?: Record<string, unknown>
  lifecycleBoundary: {
    processControl: 'not_exposed'
    managedProcessState: 'not_available_from_worker'
  }
  resourceUri: string
}>

export type RuntimeHealthResult = RuntimeInspectorResult<{
  status: 'healthy' | 'degraded' | 'unavailable'
  modelRouter: RuntimeModelRouterStatusResult
  localRuntime: RuntimeLocalStatusResult
  resourceUri: string
}>

export type RuntimeDependency = {
  id: string
  available: boolean
  version?: string
  path?: string
  status?: string
  reason?: string
}

export type RuntimeDependencyReportResult = RuntimeInspectorResult<{
  generatedAt: string
  dependencies: RuntimeDependency[]
  resourceUri: string
}>

export type LspSessionSummary = {
  workspaceRoot: string
  pid: number | null
  initialized: boolean
  refCount: number
  pendingRequests: number
  openDocuments: number
  cleanupScheduled: boolean
  startedAt: string
  lastUsedAt: string
}

export type LspStatusResult = RuntimeInspectorResult<{
  workspaceRoot?: string
  status: 'available' | 'unavailable' | 'running'
  available: boolean
  lifecycle: {
    mode: 'per_workspace'
    longLivedServerStarted: boolean
    activeSessionCount: number
    cleanupPolicy: 'ref_counted_delayed_shutdown'
    cleanupDelayMs: number
    requestTimeoutMs: number
    sessions: LspSessionSummary[]
    workspaceActiveSession?: LspSessionSummary
  }
  boundaries: {
    unsavedBuffers: 'rejected'
    fileSource: 'saved_files_only'
    realLanguageServer: 'available' | 'missing' | 'running'
  }
  dependency?: RuntimeDependency
  resourceUri: string
}>

export type LspQueryResult = RuntimeInspectorResult<{
  operation: LspOperation
  workspaceRoot: string
  filePath?: string
  query?: string
  result: unknown
  unsavedBufferPolicy: 'reject'
  languageServer: {
    name: 'typescript-language-server'
    command: string
    pid?: number
    sessionReused: boolean
  }
}>

export type RuntimeInspectorDiagnosticsResult = RuntimeInspectorResult<{
  version: string
  transport: typeof RUNTIME_INSPECTOR_WORKER_TRANSPORT
  health: RuntimeInspectorWorkerHealth
  recentError: string | null
  capabilities: RuntimeInspectorToolName[]
  resources: string[]
  configured: {
    workspaceRoot?: string
    modelRouterBaseUrl: string
    runtimeBaseUrl: string
    runtimeTokenConfigured: boolean
  }
}>

export type RuntimeInspectorAnyResult =
  | GitStatusResult
  | GitBranchesResult
  | GitDiffPreviewResult
  | RuntimePortsResult
  | RuntimeHealthResult
  | RuntimeDependencyReportResult
  | RuntimeModelRouterStatusResult
  | RuntimeLocalStatusResult
  | LspStatusResult
  | LspQueryResult
  | CompletionChecksResult
  | RuntimeInspectorDiagnosticsResult

export function gitDiffResourceUri(path?: string): string {
  const normalized = normalizeResourcePath(path)
  return normalized ? `git://diff/${normalized}` : GIT_DIFF_RESOURCE_URI
}

function normalizeResourcePath(path: string | undefined): string {
  const normalized = path?.replace(/\\/g, '/').replace(/^\/+/, '').trim() ?? ''
  if (!normalized) return ''
  return normalized
    .split('/')
    .filter((part) => part.length > 0)
    .map(encodeURIComponent)
    .join('/')
}
