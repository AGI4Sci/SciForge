import { z } from 'zod'
import {
  MAX_SUBAGENT_MAX_PARALLEL,
  SCHEDULE_MODEL_IDS,
  SCHEDULE_REASONING_EFFORT_IDS,
  SPEECH_TO_TEXT_PROTOCOLS
} from '../../shared/app-settings'
import {
  WORKBENCH_TOOLBAR_COMMAND_ID_MAX_LENGTH,
  WORKBENCH_TOOLBAR_MAX_COMMANDS
} from '../../shared/app-settings-workbench-toolbar'
import { DESKTOP_COMMANDS } from '../../shared/sciforge-api'
import { GUI_UPDATE_CHANNELS } from '../../shared/gui-update'
import { KEYBOARD_SHORTCUT_COMMANDS } from '../../shared/keyboard-shortcuts'
import { isSafeExternalUrl as isSafeOpenExternalUrl } from '../../shared/external-url-policy'
import {
  SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS,
  SPEECH_TRANSCRIPTION_MAX_DURATION_MS
} from '../../shared/speech-to-text'
import {
  AGENT_RUNTIME_AUXILIARY_OPERATIONS,
  AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS,
  type AgentRuntimeAuxiliaryActiveScopedOperation,
  type AgentRuntimeAuxiliaryOperation
} from '../../shared/agent-runtime-contract'
import { WRITE_EXPORT_FORMATS } from '../../shared/write-export'
import {
  workspacePreviewAnchorSchema,
  workspacePreviewIntegrityExpectationSchema,
  workspacePreviewModeSchema,
  workspaceStructuredSelectionSchema
} from '../../shared/workspace-preview'
import { workspaceFileConflictPolicySchema } from '../../shared/workspace-file'
import {
  DOMAIN_EXTENSION_EXECUTIONS,
  DOMAIN_EXTENSION_SOURCES,
  DOMAIN_EXTENSION_STATUSES,
  DOMAIN_EXTENSION_VERIFICATIONS
} from '../../shared/domain-extensions'
import {
  domainPackageContributionKindSchema,
  domainPackageModuleIdSchema,
  domainPackageNameSchema,
  domainPackagePermissionIdSchema,
  domainPackagePublisherIdSchema,
  domainPackageVersionSchema
} from '@sciforge/domain-sdk'
import { domainMainAgentExecutionOutputSchemaSchema } from '@sciforge/domain-sdk/agent-execution'
import { TRACE_EVENT_KINDS } from '@sciforge/full-trace'
import {
  WORKSPACE_HOST_LIMITS,
  workspaceHostResumeSchema,
  workspaceLocatorSchema
} from '@sciforge/domain-sdk/workspace-host'
export {
  visibleContextCapturePreviewRequestSchema as visibleContextCapturePreviewPayloadSchema,
  visibleContextPublishInputSchema as visibleContextPublishPayloadSchema,
  visibleContextTargetRefRequestSchema as visibleContextTargetRefPayloadSchema
} from '../../shared/visible-context'

const MAX_BODY_BYTES = 2_000_000
const MAX_PATH_LENGTH = 4_096
const MAX_URL_LENGTH = 4_096
const MAX_ID_LENGTH = 256
const MAX_BRANCH_LENGTH = 255
const MAX_EDITOR_ID_LENGTH = 64
const MAX_NOTIFICATION_TITLE_LENGTH = 200
const MAX_NOTIFICATION_BODY_LENGTH = 5_000
const MAX_CHANNEL_TEXT_LENGTH = 100_000
const MAX_SKILL_FILE_BYTES = 1_000_000
const MAX_WORKSPACE_BINARY_BODY_BASE64_CHARS = 90_000_000
const MAX_EDITOR_COMPLETION_TEXT = 200_000
const MAX_MIME_TYPE_LENGTH = 128

export { isSafeExternalUrl as isSafeOpenExternalUrl } from '../../shared/external-url-policy'

function trimmedString(max: number): z.ZodString {
  return z.string().trim().min(1).max(max)
}

function optionalTrimmedString(max: number): z.ZodOptional<z.ZodString> {
  return z.string().trim().max(max).optional()
}

export const defaultPathSchema = optionalTrimmedString(MAX_PATH_LENGTH)

export const domainExtensionListPayloadSchema = z.object({}).strict()

export const domainExtensionInstallPayloadSchema = z.object({
  path: trimmedString(MAX_PATH_LENGTH)
}).strict()

export const domainExtensionPackagePayloadSchema = z.object({
  packageName: domainPackageNameSchema
}).strict()

export const domainExtensionSetEnabledPayloadSchema = z.object({
  packageName: domainPackageNameSchema,
  enabled: z.boolean()
}).strict()

export const domainExtensionSummarySchema = z.object({
  packageName: domainPackageNameSchema,
  moduleId: domainPackageModuleIdSchema,
  moduleDisplayName: trimmedString(160),
  version: domainPackageVersionSchema,
  publisher: z.object({
    id: domainPackagePublisherIdSchema,
    displayName: trimmedString(160)
  }).strict(),
  source: z.enum(DOMAIN_EXTENSION_SOURCES),
  verification: z.enum(DOMAIN_EXTENSION_VERIFICATIONS),
  execution: z.enum(DOMAIN_EXTENSION_EXECUTIONS),
  status: z.enum(DOMAIN_EXTENSION_STATUSES),
  permissions: z.array(domainPackagePermissionIdSchema).max(1_000),
  contributionKinds: z.array(domainPackageContributionKindSchema).max(1_000),
  contributionCount: z.number().int().min(0).max(2_000),
  canRollback: z.boolean(),
  installedAt: z.string().datetime({ offset: true }).optional(),
  diagnostic: z.string().trim().min(1).max(4_000).optional()
}).strict()

export const domainExtensionListResultSchema = z.array(domainExtensionSummarySchema).max(1_024)

const localeSchema = z.enum(['en', 'zh'])
const themeSchema = z.enum(['system', 'light', 'dark'])
const uiFontScaleSchema = z.enum(['small', 'medium', 'large'])
const agentRuntimeIdSchema = z.enum(['sciforge', 'codex', 'claude'])
const agentRuntimeThreadRelationSchema = z.string().trim().pipe(z.enum(['primary', 'fork', 'side']))
const agentRuntimeThreadSidebarVisibilitySchema = z.string().trim().pipe(z.enum(['main', 'side', 'hidden']))
const agentRuntimeAuxiliaryOperationSchema = z.enum(AGENT_RUNTIME_AUXILIARY_OPERATIONS)
const agentRuntimeAuxiliaryRuntimeIdRequiredOperations = new Set<AgentRuntimeAuxiliaryOperation>(
  AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS
)
const agentRuntimeAuxiliaryActiveScopedOperations = AGENT_RUNTIME_AUXILIARY_OPERATIONS.filter(
  (operation): operation is AgentRuntimeAuxiliaryActiveScopedOperation =>
    !agentRuntimeAuxiliaryRuntimeIdRequiredOperations.has(operation)
) as [AgentRuntimeAuxiliaryActiveScopedOperation, ...AgentRuntimeAuxiliaryActiveScopedOperation[]]
const agentRuntimeAuxiliaryActiveScopedOperationSchema = z.enum(agentRuntimeAuxiliaryActiveScopedOperations)
const agentRuntimeAuxiliaryPayloadRecordSchema = z.record(z.string(), z.unknown()).optional()
const approvalPolicySchema = z.enum(['on-request', 'untrusted', 'never', 'auto', 'suggest'])
const sandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access', 'external-sandbox'])
const claudeApprovalPolicySchema = z.enum(['on-request', 'untrusted', 'never', 'auto'])
const claudeSandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access'])
const mcpSearchModeSchema = z.enum(['direct', 'search', 'auto'])
const localRuntimeStorageBackendSchema = z.enum(['hybrid', 'file'])
const localRuntimeCompactionSummaryModeSchema = z.enum(['heuristic', 'model'])
const runModeSchema = z.enum(['agent', 'plan'])
const scheduleKindSchema = z.enum(['manual', 'interval', 'daily', 'at'])
const taskStatusSchema = z.enum(['idle', 'running', 'success', 'error'])
const scheduleReasoningEffortSchema = z.enum(SCHEDULE_REASONING_EFFORT_IDS)
const speechToTextProtocolSchema = z.enum(SPEECH_TO_TEXT_PROTOCOLS)
const agentThreadIdsSchema = z.object({
  sciforge: z.string().max(MAX_ID_LENGTH).optional(),
  codex: z.string().max(MAX_ID_LENGTH).optional(),
  claude: z.string().max(MAX_ID_LENGTH).optional()
}).strict()
const agentRuntimeGovernanceProfileSchema = z.enum(['default', 'write', 'remote_guard'])
const traceEventKindSchema = z.enum(TRACE_EVENT_KINDS)
const traceIdListSchema = z.array(trimmedString(MAX_ID_LENGTH)).max(500).optional()
const traceQueryFields = {
  traceIds: traceIdListSchema,
  runtimeId: optionalTrimmedString(MAX_ID_LENGTH),
  threadId: optionalTrimmedString(MAX_ID_LENGTH),
  turnId: optionalTrimmedString(MAX_ID_LENGTH),
  parentRequestId: optionalTrimmedString(MAX_ID_LENGTH),
  from: optionalTrimmedString(64),
  to: optionalTrimmedString(64),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().positive().max(10_000).optional()
} as const

export const traceReadPayloadSchema = z.object({
  ...traceQueryFields,
  limit: traceQueryFields.limit.default(500),
  requestId: optionalTrimmedString(MAX_ID_LENGTH),
  kinds: z.array(traceEventKindSchema).max(TRACE_EVENT_KINDS.length).optional()
}).strict()

export const traceSummariesPayloadSchema = z.object(traceQueryFields).strict()

export const traceExportPayloadSchema = z.object({
  traceIds: traceIdListSchema
}).strict()
const agentRuntimeFileReferenceSchema = z.object({
  path: trimmedString(MAX_PATH_LENGTH),
  relativePath: trimmedString(MAX_PATH_LENGTH),
  name: trimmedString(512),
  kind: z.enum(['file', 'directory', 'image', 'pdf', 'text']).optional(),
  mimeType: optionalTrimmedString(MAX_MIME_TYPE_LENGTH)
}).strict()

const agentRuntimeExecutionRequirementSchema = z.object({
  id: optionalTrimmedString(MAX_ID_LENGTH),
  effectClass: z.enum([
    'read',
    'command_execution',
    'local_write',
    'external_mutation',
    'async_job',
    'child_agent',
    'other'
  ]).optional(),
  toolNames: z.array(trimmedString(512)).max(100).optional(),
  receiptKind: z.enum([
    'visual.look',
    'visual.capture',
    'artifact.reference-validation'
  ]).optional(),
  requiresRegionRef: z.boolean().optional(),
  dependsOn: z.array(trimmedString(MAX_ID_LENGTH)).max(100).optional(),
  completion: z.enum(['terminal', 'success']).optional()
}).strict()

const agentRuntimeExecutionIntentSchema = z.object({
  mode: z.enum(['answer', 'inspect', 'execute']),
  requirements: z.array(agentRuntimeExecutionRequirementSchema).max(100).optional()
}).strict()

export const agentRuntimeConnectPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional()
}).strict()

export const remoteWorkspaceAttachPayloadSchema = z.object({
  providerId: trimmedString(MAX_ID_LENGTH),
  authorizedSessionId: trimmedString(MAX_ID_LENGTH),
  resume: workspaceHostResumeSchema.optional()
}).strict()

export const remoteWorkspaceSelectPayloadSchema = z.object({
  sessionId: trimmedString(MAX_ID_LENGTH).nullable()
}).strict()

export const remoteWorkspaceSessionPayloadSchema = z.object({
  sessionId: trimmedString(MAX_ID_LENGTH)
}).strict()

export const agentRuntimeListThreadsPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  workspaceLocator: workspaceLocatorSchema.optional(),
  limit: z.number().int().positive().max(500).optional(),
  search: z.string().trim().max(256).optional(),
  includeArchived: z.boolean().optional(),
  archivedOnly: z.boolean().optional(),
  includeSide: z.boolean().optional(),
  summary: z.boolean().optional()
}).strict()

export const agentRuntimeStartThreadPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: optionalTrimmedString(MAX_ID_LENGTH),
  workspace: defaultPathSchema,
  workspaceLocator: workspaceLocatorSchema.optional(),
  title: z.string().trim().max(200).optional(),
  mode: z.string().trim().max(64).optional(),
  model: z.string().trim().max(128).optional(),
  relation: agentRuntimeThreadRelationSchema.optional(),
  parentThreadId: optionalTrimmedString(MAX_ID_LENGTH),
  parentTurnId: optionalTrimmedString(MAX_ID_LENGTH),
  threadSource: optionalTrimmedString(MAX_ID_LENGTH),
  sidebarVisibility: agentRuntimeThreadSidebarVisibilitySchema.optional()
}).strict()

export const agentRuntimeReadThreadStatusPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  workspaceLocator: workspaceLocatorSchema.optional()
}).strict()

export const agentRuntimeReadThreadPagePayloadSchema = agentRuntimeReadThreadStatusPayloadSchema.extend({
  cursor: z.string().trim().max(2_048).optional(),
  limit: z.number().int().min(1).max(100).optional()
}).strict()

export const agentRuntimeReadToolArtifactPayloadSchema = agentRuntimeReadThreadStatusPayloadSchema.extend({
  ref: z.string().trim().min(1).max(2_048),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
}).strict()

export const agentRuntimeStartTurnPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
  outputSchema: domainMainAgentExecutionOutputSchemaSchema.optional(),
  clientDirectiveId: optionalTrimmedString(MAX_ID_LENGTH),
  executionIntent: agentRuntimeExecutionIntentSchema.optional(),
  workspace: defaultPathSchema,
  workspaceLocator: workspaceLocatorSchema.optional(),
  mode: z.string().trim().max(64).optional(),
  model: z.string().trim().max(128).optional(),
  reasoningEffort: z.string().trim().max(64).optional(),
  governanceProfile: agentRuntimeGovernanceProfileSchema.optional(),
  displayText: z.string().trim().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  visibleContextOwnerThreadId: optionalTrimmedString(MAX_ID_LENGTH),
  guiPlan: z.object({
    operation: z.enum(['draft', 'refine']),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    relativePath: trimmedString(MAX_PATH_LENGTH),
    planId: trimmedString(MAX_ID_LENGTH),
    sourceRequest: z.string().trim().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    title: z.string().trim().max(200).optional()
  }).strict().optional(),
  attachmentIds: z.array(trimmedString(MAX_ID_LENGTH)).max(50).optional(),
  fileReferences: z.array(agentRuntimeFileReferenceSchema).max(50).optional()
}).strict()

export const agentRuntimeTurnTargetPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  turnId: trimmedString(MAX_ID_LENGTH),
  workspaceLocator: workspaceLocatorSchema.optional(),
  discard: z.boolean().optional()
}).strict()

export const agentRuntimeTurnSteerPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  turnId: trimmedString(MAX_ID_LENGTH),
  workspaceLocator: workspaceLocatorSchema.optional(),
  text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
  clientDirectiveId: optionalTrimmedString(MAX_ID_LENGTH),
  executionIntent: agentRuntimeExecutionIntentSchema.optional()
}).strict()

export const agentRuntimeEventSubscribePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  workspaceLocator: workspaceLocatorSchema.optional(),
  sinceSeq: z.number().int().nonnegative().optional(),
  streamId: optionalTrimmedString(MAX_ID_LENGTH)
}).strict()

export const agentRuntimeThreadRenamePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  title: z.string().trim().min(1).max(200),
  workspaceLocator: workspaceLocatorSchema.optional()
}).strict()

export const agentRuntimeThreadDeletePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  workspaceLocator: workspaceLocatorSchema.optional()
}).strict()

export const agentRuntimeThreadCompactPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  workspaceLocator: workspaceLocatorSchema.optional(),
  reason: z.string().trim().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

export const agentRuntimeThreadForkPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  workspaceLocator: workspaceLocatorSchema.optional(),
  relation: agentRuntimeThreadRelationSchema.optional(),
  title: z.string().trim().max(200).optional()
}).strict()

export const agentRuntimeSessionResumePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  sessionId: trimmedString(MAX_ID_LENGTH),
  model: z.string().trim().max(128).optional(),
  mode: z.string().trim().max(64).optional(),
  maxResumeCount: z.number().int().positive().max(1_000).optional(),
  workspaceLocator: workspaceLocatorSchema.optional()
}).strict()

export const agentRuntimeThreadRelationPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  relation: agentRuntimeThreadRelationSchema,
  workspaceLocator: workspaceLocatorSchema.optional()
}).strict()

const agentRuntimeUsageRangePayloadSchema = {
  from: z.string().trim().max(64).optional(),
  to: z.string().trim().max(64).optional(),
  timezone: z.string().trim().max(128).optional()
}

export const agentRuntimeUsagePayloadSchema = z.discriminatedUnion('groupBy', [
  z.object({
    ...agentRuntimeUsageRangePayloadSchema,
    runtimeId: agentRuntimeIdSchema,
    groupBy: z.literal('thread'),
    threadId: trimmedString(MAX_ID_LENGTH),
    workspaceLocator: workspaceLocatorSchema.optional()
  }).strict(),
  z.object({
    ...agentRuntimeUsageRangePayloadSchema,
    runtimeId: agentRuntimeIdSchema.optional(),
    groupBy: z.enum(['day', 'model']),
    threadId: optionalTrimmedString(MAX_ID_LENGTH),
    workspaceLocator: workspaceLocatorSchema.optional()
  }).strict()
])

const agentRuntimeAuxiliaryRuntimeScopedPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  operation: agentRuntimeAuxiliaryOperationSchema,
  payload: agentRuntimeAuxiliaryPayloadRecordSchema,
  workspaceLocator: workspaceLocatorSchema.optional()
}).strict()

const agentRuntimeAuxiliaryActiveScopedPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  operation: agentRuntimeAuxiliaryActiveScopedOperationSchema,
  payload: agentRuntimeAuxiliaryPayloadRecordSchema,
  workspaceLocator: workspaceLocatorSchema.optional()
}).strict()

export const agentRuntimeAuxiliaryPayloadSchema = z.union([
  agentRuntimeAuxiliaryRuntimeScopedPayloadSchema,
  agentRuntimeAuxiliaryActiveScopedPayloadSchema
])

export const agentRuntimeApprovalResolvePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  approvalId: trimmedString(MAX_ID_LENGTH),
  decision: z.enum(['allowed', 'denied']),
  message: z.string().trim().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  workspaceLocator: workspaceLocatorSchema.optional()
}).strict()

export const agentRuntimeUserInputResolvePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  requestId: trimmedString(MAX_ID_LENGTH),
  workspaceLocator: workspaceLocatorSchema.optional(),
  answers: z.array(z.object({
    id: trimmedString(MAX_ID_LENGTH),
    label: z.string().trim().max(200).optional(),
    value: z.string().trim().max(MAX_CHANNEL_TEXT_LENGTH)
  }).strict()).max(50)
}).strict()

const modelAccessPatchSchema = z.object({
  mode: z.enum(['api', 'coding-plan']).optional(),
  planAdapterId: z.string().trim().max(128).optional()
}).strict()

const modelRouterMemberPatchSchema = z.object({
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  model: z.string().trim().max(128).optional(),
  protocol: z.enum(['auto', 'responses', 'chat-completions', 'anthropic-messages']).optional()
}).strict()

const modelRouterPatchSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  autoStart: z.boolean().optional(),
  publicModelAlias: z.string().trim().min(1).max(128).optional(),
  runtimeApiKey: z.string().max(MAX_BODY_BYTES).optional(),
  profiles: z.object({
    default: z.object({
      textReasoner: modelRouterMemberPatchSchema.optional(),
      imageGenerator: modelRouterMemberPatchSchema.optional(),
      translators: z.object({
        vision: modelRouterMemberPatchSchema.optional(),
        scientific: modelRouterMemberPatchSchema.optional()
      }).strict().optional()
    }).strict().optional()
  }).strict().optional()
}).strict()

const imageGenerationPatchSchema = z.object({
  componentSegmentationRunnerPath: defaultPathSchema,
  componentSegmentationModelPath: defaultPathSchema,
  fastSamRunnerPath: defaultPathSchema,
  fastSamModelPath: defaultPathSchema
}).strict()

const localRuntimePatchSchema = z.object({
  binaryPath: defaultPathSchema,
  port: z.number().int().min(1).max(65_535).optional(),
  autoStart: z.boolean().optional(),
  runtimeToken: z.string().max(MAX_BODY_BYTES).optional(),
  dataDir: defaultPathSchema,
  model: z.string().trim().min(1).max(128).optional(),
  approvalPolicy: approvalPolicySchema.optional(),
  sandboxMode: sandboxModeSchema.optional(),
  tokenEconomyMode: z.boolean().optional(),
  tokenEconomy: z.object({
    enabled: z.boolean().optional(),
    compressToolDescriptions: z.boolean().optional(),
    compressToolResults: z.boolean().optional(),
    conciseResponses: z.boolean().optional(),
    historyHygiene: z.object({
      maxToolResultLines: z.number().int().positive().max(100_000).optional(),
      maxToolResultBytes: z.number().int().positive().max(8 * 1024 * 1024).optional(),
      maxToolResultTokens: z.number().int().positive().max(256_000).optional(),
      maxToolArgumentStringBytes: z.number().int().positive().max(8 * 1024 * 1024).optional(),
      maxToolArgumentStringTokens: z.number().int().positive().max(64_000).optional(),
      maxArrayItems: z.number().int().positive().max(10_000).optional()
    }).strict().optional()
  }).strict().optional(),
  insecure: z.boolean().optional(),
  mcpSearch: z.object({
    enabled: z.boolean().optional(),
    mode: mcpSearchModeSchema.optional(),
    autoThresholdToolCount: z.number().int().positive().optional(),
    topKDefault: z.number().int().positive().optional(),
    topKMax: z.number().int().positive().optional(),
    minScore: z.number().nonnegative().optional()
  }).strict().optional(),
  storage: z.object({
    backend: localRuntimeStorageBackendSchema.optional(),
    sqlitePath: defaultPathSchema
  }).strict().optional(),
  contextCompaction: z.object({
    defaultSoftThreshold: z.number().int().positive().optional(),
    defaultHardThreshold: z.number().int().positive().optional(),
    summaryMode: localRuntimeCompactionSummaryModeSchema.optional(),
    summaryTimeoutMs: z.number().int().positive().max(120_000).optional(),
    summaryMaxTokens: z.number().int().positive().max(16_000).optional(),
    summaryInputMaxBytes: z.number().int().positive().max(8 * 1024 * 1024).optional()
  }).strict().optional()
}).strict()

const codexRuntimePatchSchema = z.object({
  command: z.string().trim().min(1).max(MAX_PATH_LENGTH).optional(),
  autoStart: z.boolean().optional(),
  codexHome: defaultPathSchema,
  profile: z.string().trim().max(128).optional(),
  model: z.string().trim().max(128).optional(),
  modelProvider: z.string().trim().max(128).optional(),
  approvalPolicy: approvalPolicySchema.optional(),
  sandboxMode: sandboxModeSchema.optional(),
  extraArgs: z.array(z.string().trim().min(1).max(512)).max(64).optional()
}).strict()

const runtimeGuardPatchSchema = z.object({
  execution: z.object({
    enabled: z.boolean().optional(),
    windowSize: z.number().int().positive().max(256).optional(),
    exactRepeatThreshold: z.number().int().min(2).max(128).optional()
  }).strict().optional()
}).strict()

const agentCapabilityPatchSchema = z.object({
  subagents: z.object({
    enabled: z.boolean().optional(),
    maxParallel: z.number().int().positive().max(MAX_SUBAGENT_MAX_PARALLEL).optional()
  }).strict().optional()
}).strict()

const computerUsePatchSchema = z.object({
  enabled: z.boolean().optional(),
  runtimeEnabled: z.object({
    sciforge: z.boolean().optional(),
    codex: z.boolean().optional(),
    claude: z.boolean().optional()
  }).strict().optional()
}).strict()

const claudeRuntimePatchSchema = z.object({
  command: z.string().trim().min(1).max(MAX_PATH_LENGTH).optional(),
  configDir: defaultPathSchema,
  model: z.string().trim().max(128).optional(),
  approvalPolicy: claudeApprovalPolicySchema.optional(),
  sandboxMode: claudeSandboxModeSchema.optional(),
  extraArgs: z.array(z.string().trim().min(1).max(512)).max(64).optional()
}).strict()

const logPatchSchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(365).optional()
}).strict()

const notificationsPatchSchema = z.object({
  turnComplete: z.boolean().optional()
}).strict()

const appBehaviorPatchSchema = z.object({
  openAtLogin: z.boolean().optional(),
  startMinimized: z.boolean().optional(),
  closeToTray: z.boolean().optional()
}).strict()

const keyboardShortcutCommandIds = KEYBOARD_SHORTCUT_COMMANDS.map((command) => command.id) as [
  typeof KEYBOARD_SHORTCUT_COMMANDS[number]['id'],
  ...Array<typeof KEYBOARD_SHORTCUT_COMMANDS[number]['id']>
]

const keyboardShortcutsPatchSchema = z.object({
  bindings: z.partialRecord(
    z.enum(keyboardShortcutCommandIds),
    z.array(z.string().trim().max(64)).max(4)
  ).optional()
}).strict()

const writeInlineCompletionPatchSchema = z.object({
  enabled: z.boolean().optional(),
  retrievalEnabled: z.boolean().optional(),
  longCompletionEnabled: z.boolean().optional(),
  debounceMs: z.number().int().min(150).max(5_000).optional(),
  longDebounceMs: z.number().int().min(1_000).max(15_000).optional(),
  minAcceptScore: z.number().min(0.1).max(0.95).optional(),
  longMinAcceptScore: z.number().min(0.1).max(0.95).optional(),
  maxTokens: z.number().int().min(16).max(512).optional(),
  longMaxTokens: z.number().int().min(64).max(1_024).optional()
}).strict()

const writeSettingsPatchSchema = z.object({
  defaultWorkspaceRoot: defaultPathSchema,
  activeWorkspaceRoot: defaultPathSchema,
  workspaces: z.array(trimmedString(MAX_PATH_LENGTH)).max(256).optional(),
  inlineCompletion: writeInlineCompletionPatchSchema.optional()
}).strict()

const speechToTextPatchSchema = z.object({
  enabled: z.boolean().optional(),
  protocol: speechToTextProtocolSchema.optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  model: z.string().trim().max(128).optional(),
  language: z.string().trim().max(64).optional(),
  timeoutMs: z.number().int().min(5_000).max(600_000).optional()
}).strict()

const skillsSettingsPatchSchema = z.object({
  extraDirs: z.array(trimmedString(MAX_PATH_LENGTH)).max(128).optional()
}).strict()

const scheduleSkillPatchSchema = z.object({
  defaultNames: z.array(trimmedString(128)).max(128).optional(),
  extraDirs: z.array(trimmedString(MAX_PATH_LENGTH)).max(128).optional()
}).strict()

const scheduleInternalPatchSchema = z.object({
  port: z.number().int().min(1024).max(65_535).optional(),
  secret: z.string().max(MAX_BODY_BYTES).optional()
}).strict()

const scheduledTaskSchedulePatchSchema = z.object({
  kind: scheduleKindSchema.optional(),
  everyMinutes: z.number().int().min(1).max(10_080).optional(),
  timeOfDay: z.string().max(16).optional(),
  atTime: z.string().max(128).optional()
}).strict()

const scheduledTaskPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  title: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  prompt: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  model: z.string().trim().min(1).max(128).optional(),
  reasoningEffort: scheduleReasoningEffortSchema.optional(),
  mode: runModeSchema.optional(),
  runtimeId: agentRuntimeIdSchema.optional(),
  agentThreadIds: agentThreadIdsSchema.optional(),
  schedule: scheduledTaskSchedulePatchSchema.optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional(),
  lastRunAt: z.string().max(128).optional(),
  nextRunAt: z.string().max(128).optional(),
  lastStatus: taskStatusSchema.optional(),
  lastMessage: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

const scheduleSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  defaultWorkspaceRoot: defaultPathSchema,
  model: z.union([z.enum(SCHEDULE_MODEL_IDS), trimmedString(128)]).optional(),
  mode: runModeSchema.optional(),
  promptPrefix: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  skills: scheduleSkillPatchSchema.optional(),
  keepAwake: z.boolean().optional(),
  internal: scheduleInternalPatchSchema.optional(),
  tasks: z.array(scheduledTaskPatchSchema).max(512).optional()
}).strict()

// --- Workflow (node-based automation) ---

const workflowScheduleKindSchema = z.enum(['manual', 'interval', 'daily', 'at', 'cron'])
const workflowConditionOperatorSchema = z.enum([
  'contains',
  'notContains',
  'equals',
  'notEquals',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
  'gt',
  'gte',
  'lt',
  'lte'
])
const workflowHttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const workflowNodeRunStatusSchema = z.enum(['pending', 'running', 'success', 'error', 'skipped'])

const workflowPositionSchema = z
  .object({ x: z.number(), y: z.number() })
  .strict()

const workflowScheduleSchema = z
  .object({
    kind: workflowScheduleKindSchema.optional(),
    everyMinutes: z.number().int().min(1).max(10_080).optional(),
    timeOfDay: z.string().max(16).optional(),
    atTime: z.string().max(128).optional(),
    cron: z.string().max(256).optional()
  })
  .strict()

const workflowAiAgentConfigSchema = z
  .object({
    prompt: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    workspaceRoot: defaultPathSchema,
    runtimeId: agentRuntimeIdSchema.optional(),
    providerId: z.string().trim().max(64).optional(),
    model: optionalTrimmedString(128),
    reasoningEffort: scheduleReasoningEffortSchema.optional(),
    mode: runModeSchema.optional()
  })
  .strict()

const workflowLlmConfigSchema = z
  .object({
    prompt: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    model: optionalTrimmedString(128),
    maxTokens: z.number().int().min(0).max(128_000).optional()
  })
  .strict()

const workflowGenerateImageConfigSchema = z
  .object({
    prompt: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    providerId: z.string().max(MAX_ID_LENGTH).optional(),
    model: z.string().max(256).optional(),
    size: z.string().max(32).optional(),
    outputDir: z.string().max(1024).optional()
  })
  .strict()

const workflowConditionConfigSchema = z
  .object({
    leftExpr: z.string().max(2_000).optional(),
    operator: workflowConditionOperatorSchema.optional(),
    rightValue: z.string().max(4_000).optional(),
    caseSensitive: z.boolean().optional()
  })
  .strict()

const workflowHttpHeaderSchema = z
  .object({
    key: z.string().max(256),
    value: z.string().max(4_000)
  })
  .strict()

const workflowHttpRequestConfigSchema = z
  .object({
    method: workflowHttpMethodSchema.optional(),
    url: z.string().max(MAX_URL_LENGTH).optional(),
    headers: z.array(workflowHttpHeaderSchema).max(50).optional(),
    body: z.string().max(MAX_BODY_BYTES).optional(),
    timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
    parseJson: z.boolean().optional()
  })
  .strict()

const workflowResearchSourceSchema = z.enum(['arxiv', 'biorxiv', 'semantic_scholar', 'web', 'cns'])

const workflowResearchSearchConfigSchema = z
  .object({
    query: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    intent: z.enum(['overview', 'latest', 'baseline', 'sota', 'dataset', 'code', 'gap']).optional(),
    domain: z.enum(['ai4s', 'biology', 'chemistry', 'materials', 'physics', 'climate', 'general']).optional(),
    sinceYear: z.number().int().min(0).max(3000).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    sources: z.array(workflowResearchSourceSchema).max(5).optional()
  })
  .strict()

const workflowPaperDownloadConfigSchema = z
  .object({
    outputDir: z.string().max(1024).optional(),
    maxFiles: z.number().int().min(1).max(50).optional()
  })
  .strict()

const workflowDelayConfigSchema = z
  .object({ delayMs: z.number().int().min(0).max(86_400_000).optional() })
  .strict()

const workflowCustomConfigSchema = z
  .object({
    moduleId: z.string().max(MAX_ID_LENGTH).optional(),
    values: z.record(z.string(), z.string().max(MAX_BODY_BYTES)).optional()
  })
  .strict()

const workflowTemplateConfigSchema = z
  .object({
    template: z.string().max(MAX_BODY_BYTES).optional(),
    outputMode: z.enum(['text', 'json']).optional()
  })
  .strict()

const workflowJsonConfigSchema = z
  .object({
    mode: z.enum(['parse', 'stringify']).optional(),
    strict: z.boolean().optional()
  })
  .strict()

const workflowOutputConfigSchema = z
  .object({
    mode: z.enum(['auto', 'text', 'json']).optional(),
    textTemplate: z.string().max(MAX_BODY_BYTES).optional(),
    jsonPath: z.string().max(2_000).optional()
  })
  .strict()

const workflowFieldSchema = z
  .object({ key: z.string().max(256), value: z.string().max(MAX_BODY_BYTES) })
  .strict()

const workflowSetFieldsConfigSchema = z
  .object({
    fields: z.array(workflowFieldSchema).max(50).optional(),
    keepIncoming: z.boolean().optional(),
    scope: z.enum(['payload', 'run']).optional()
  })
  .strict()

const workflowSwitchRuleSchema = z
  .object({
    leftExpr: z.string().max(2_000),
    operator: workflowConditionOperatorSchema,
    rightValue: z.string().max(4_000),
    caseSensitive: z.boolean()
  })
  .partial()
  .strict()

const workflowSwitchConfigSchema = z
  .object({
    rules: z.array(workflowSwitchRuleSchema).max(20).optional(),
    fallback: z.boolean().optional()
  })
  .strict()

const workflowCodeConfigSchema = z
  .object({
    language: z.enum(['javascript', 'python', 'bash']).optional(),
    code: z.string().max(MAX_BODY_BYTES).optional()
  })
  .strict()

const workflowMergeConfigSchema = z.object({ mode: z.enum(['array', 'object']).optional() }).strict()

const workflowFilterConfigSchema = z
  .object({
    leftExpr: z.string().max(2_000).optional(),
    operator: workflowConditionOperatorSchema.optional(),
    rightValue: z.string().max(4_000).optional(),
    caseSensitive: z.boolean().optional()
  })
  .strict()

const workflowSortConfigSchema = z
  .object({
    field: z.string().max(256).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    numeric: z.boolean().optional()
  })
  .strict()

const workflowLimitConfigSchema = z
  .object({ count: z.number().int().min(1).max(100_000).optional(), from: z.enum(['first', 'last']).optional() })
  .strict()

const workflowAggregateConfigSchema = z
  .object({
    mode: z.enum(['count', 'sum', 'collect', 'join']).optional(),
    field: z.string().max(256).optional(),
    separator: z.string().max(32).optional()
  })
  .strict()

const workflowSubWorkflowConfigSchema = z
  .object({ workflowId: z.string().max(MAX_ID_LENGTH).optional() })
  .strict()

const workflowLoopConfigSchema = z
  .object({
    workflowId: z.string().max(MAX_ID_LENGTH).optional(),
    mode: z.enum(['condition', 'foreach']).optional(),
    arraySource: z.string().max(2_000).optional(),
    execution: z.enum(['sequential', 'parallel']).optional(),
    concurrency: z.number().int().min(1).max(8).optional(),
    continueOnError: z.boolean().optional(),
    maxIterations: z.number().int().min(1).max(100).optional(),
    leftExpr: z.string().max(2_000).optional(),
    operator: workflowConditionOperatorSchema.optional(),
    rightValue: z.string().max(4_000).optional(),
    caseSensitive: z.boolean().optional()
  })
  .strict()

const workflowWebhookTriggerConfigSchema = z
  .object({
    path: z.string().max(256).optional(),
    method: z.enum(['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    workspaceRoot: defaultPathSchema
  })
  .strict()

const workflowNodeBaseShape = {
  id: z.string().max(MAX_ID_LENGTH),
  name: z.string().max(512).optional(),
  position: workflowPositionSchema.optional(),
  disabled: z.boolean().optional(),
  onError: z.enum(['fail', 'continue', 'fallback']).optional(),
  retries: z.number().int().min(0).max(10).optional(),
  retryDelayMs: z.number().int().min(0).max(600_000).optional(),
  fallbackJson: z.string().max(MAX_BODY_BYTES).optional(),
  inputs: z
    .array(
      z
        .object({
          key: z.string().max(128),
          type: z.enum(['text', 'number', 'boolean', 'json']),
          source: z.string().max(4_000)
        })
        .strict()
    )
    .max(30)
    .optional()
}

const workflowInputFieldSchema = z
  .object({
    key: z.string().max(128),
    label: z.string().max(200).optional(),
    type: z.enum(['text', 'paragraph', 'number', 'boolean', 'select', 'json']).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().max(500)).max(50).optional(),
    defaultValue: z.string().max(MAX_BODY_BYTES).optional(),
    description: z.string().max(500).optional()
  })
  .strict()

const workflowParameterExtractorConfigSchema = z
  .object({
    source: z.string().max(MAX_BODY_BYTES).optional(),
    instruction: z.string().max(MAX_BODY_BYTES).optional(),
    fields: z.array(workflowInputFieldSchema).max(50).optional(),
    providerId: z.string().trim().max(64).optional(),
    model: optionalTrimmedString(128),
    reasoningEffort: scheduleReasoningEffortSchema.optional()
  })
  .strict()

const workflowQuestionClassifierConfigSchema = z
  .object({
    source: z.string().max(MAX_BODY_BYTES).optional(),
    instruction: z.string().max(MAX_BODY_BYTES).optional(),
    categories: z
      .array(z.object({ id: z.string().max(64).optional(), label: z.string().max(200).optional() }).strict())
      .max(20)
      .optional(),
    providerId: z.string().trim().max(64).optional(),
    model: optionalTrimmedString(128),
    reasoningEffort: scheduleReasoningEffortSchema.optional()
  })
  .strict()

const workflowHumanApprovalConfigSchema = z
  .object({
    title: z.string().max(200).optional(),
    instruction: z.string().max(MAX_BODY_BYTES).optional(),
    timeoutMs: z.number().int().min(0).max(86_400_000).optional(),
    onTimeout: z.enum(['approved', 'rejected']).optional()
  })
  .strict()

const workflowNodePatchSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...workflowNodeBaseShape,
      type: z.literal('manual-trigger'),
      config: z
        .object({
          workspaceRoot: defaultPathSchema,
          inputSchema: z.array(workflowInputFieldSchema).max(50).optional()
        })
        .strict()
        .optional()
    })
    .strict(),
  z
    .object({
      ...workflowNodeBaseShape,
      type: z.literal('schedule-trigger'),
      config: z
        .object({ schedule: workflowScheduleSchema.optional(), workspaceRoot: defaultPathSchema })
        .strict()
        .optional()
    })
    .strict(),
  z
    .object({
      ...workflowNodeBaseShape,
      type: z.literal('webhook-trigger'),
      config: workflowWebhookTriggerConfigSchema.optional()
    })
    .strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('llm'), config: workflowLlmConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('ai-agent'), config: workflowAiAgentConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('generate-image'), config: workflowGenerateImageConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('condition'), config: workflowConditionConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('switch'), config: workflowSwitchConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('filter'), config: workflowFilterConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('set-fields'), config: workflowSetFieldsConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('code'), config: workflowCodeConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('sort'), config: workflowSortConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('limit'), config: workflowLimitConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('aggregate'), config: workflowAggregateConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('research-search'), config: workflowResearchSearchConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('paper-download'), config: workflowPaperDownloadConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('http-request'), config: workflowHttpRequestConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('merge'), config: workflowMergeConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('subworkflow'), config: workflowSubWorkflowConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('loop'), config: workflowLoopConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('delay'), config: workflowDelayConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('template'), config: workflowTemplateConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('json'), config: workflowJsonConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('output'), config: workflowOutputConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('parameter-extractor'), config: workflowParameterExtractorConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('question-classifier'), config: workflowQuestionClassifierConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('human-approval'), config: workflowHumanApprovalConfigSchema.optional() }).strict(),
  z.object({ ...workflowNodeBaseShape, type: z.literal('custom'), config: workflowCustomConfigSchema.optional() }).strict()
])

const workflowConnectionPatchSchema = z
  .object({
    id: z.string().max(MAX_ID_LENGTH).optional(),
    source: z.string().max(MAX_ID_LENGTH),
    sourceHandle: z.string().max(64).optional(),
    target: z.string().max(MAX_ID_LENGTH),
    targetHandle: z.string().max(64).optional()
  })
  .strict()

const workflowNodeResultPatchSchema = z
  .object({
    nodeId: z.string().max(MAX_ID_LENGTH).optional(),
    status: workflowNodeRunStatusSchema.optional(),
    startedAt: z.string().max(128).optional(),
    finishedAt: z.string().max(128).optional(),
    message: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    outputJson: z.string().max(MAX_BODY_BYTES).optional(),
    inputJson: z.string().max(MAX_BODY_BYTES).optional(),
    retries: z.number().int().min(0).max(100).optional(),
    threadId: z.string().max(MAX_ID_LENGTH).optional(),
    error: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
  })
  .strict()

const workflowRunPatchSchema = z
  .object({
    id: z.string().max(MAX_ID_LENGTH).optional(),
    trigger: z.string().max(128).optional(),
    status: taskStatusSchema.optional(),
    startedAt: z.string().max(128).optional(),
    finishedAt: z.string().max(128).optional(),
    message: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    nodeResults: z.array(workflowNodeResultPatchSchema).max(200).optional()
  })
  .strict()

const workflowPatchSchema = z
  .object({
    id: z.string().max(MAX_ID_LENGTH).optional(),
    name: z.string().max(512).optional(),
    enabled: z.boolean().optional(),
    callableByAgent: z.boolean().optional(),
    env: z
      .array(
        z
          .object({
            key: z.string().max(128),
            value: z.string().max(MAX_BODY_BYTES),
            type: z.enum(['string', 'number', 'boolean', 'secret'])
          })
          .strict()
      )
      .max(100)
      .optional(),
    nodes: z.array(workflowNodePatchSchema).max(200).optional(),
    connections: z.array(workflowConnectionPatchSchema).max(512).optional(),
    createdAt: z.string().max(128).optional(),
    updatedAt: z.string().max(128).optional(),
    lastRunAt: z.string().max(128).optional(),
    nextRunAt: z.string().max(128).optional(),
    lastStatus: taskStatusSchema.optional(),
    lastMessage: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
    runs: z.array(workflowRunPatchSchema).max(50).optional()
  })
  .strict()

const workflowModuleFieldSchema = z
  .object({
    key: z.string().max(128),
    label: z.string().max(200).optional(),
    type: z.enum(['text', 'textarea', 'number', 'boolean', 'select']).optional(),
    defaultValue: z.string().max(MAX_BODY_BYTES).optional(),
    options: z.array(z.string().max(200)).max(50).optional(),
    placeholder: z.string().max(200).optional()
  })
  .strict()

const workflowCustomModuleSchema = z
  .object({
    id: z.string().max(MAX_ID_LENGTH),
    name: z.string().max(200).optional(),
    description: z.string().max(2_000).optional(),
    icon: z.string().max(64).optional(),
    language: z.enum(['javascript', 'python', 'bash']).optional(),
    fields: z.array(workflowModuleFieldSchema).max(50).optional(),
    code: z.string().max(MAX_BODY_BYTES).optional()
  })
  .strict()

// Lenient: nodeType / config are re-validated per kind by normalizeNodePreset.
const workflowNodePresetSchema = z
  .object({
    id: z.string().max(MAX_ID_LENGTH),
    label: z.string().max(200),
    icon: z.string().max(64).optional(),
    nodeType: z.string().max(64),
    nodeName: z.string().max(200).optional(),
    config: z.record(z.string(), z.unknown()).optional()
  })
  .strict()

const workflowSettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultWorkspaceRoot: defaultPathSchema,
    providerId: z.string().trim().max(64).optional(),
    model: optionalTrimmedString(128),
    mode: runModeSchema.optional(),
    keepAwake: z.boolean().optional(),
    webhookPort: z.number().int().min(1024).max(65_535).optional(),
    webhookSecret: z.string().max(MAX_BODY_BYTES).optional(),
    workflows: z.array(workflowPatchSchema).max(200).optional(),
    presets: z.array(workflowNodePresetSchema).max(100).optional(),
    modules: z.array(workflowCustomModuleSchema).max(100).optional(),
    hookTriggers: z
      .array(
        z
          .object({
            id: z.string().max(MAX_ID_LENGTH).optional(),
            enabled: z.boolean().optional(),
            workflowId: z.string().max(MAX_ID_LENGTH).optional(),
            phase: z.enum(['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'TurnStart', 'TurnEnd', 'PreCompact']).optional(),
            toolNames: z.array(z.string().max(128)).max(50).optional(),
            mode: z.enum(['observe', 'block', 'rewrite']).optional(),
            timeoutMs: z.number().int().min(0).max(3_600_000).optional()
          })
          .strict()
      )
      .max(50)
      .optional()
  })
  .strict()

const settingsPatchObjectSchema = z.object({
  version: z.literal(1).optional(),
  installationId: z.string().max(128).optional(),
  locale: localeSchema.optional(),
  theme: themeSchema.optional(),
  uiFontScale: uiFontScaleSchema.optional(),
  modelAccess: modelAccessPatchSchema.optional(),
  modelRouter: modelRouterPatchSchema.optional(),
  runtimeGuards: runtimeGuardPatchSchema.optional(),
  agentCapabilities: agentCapabilityPatchSchema.optional(),
  imageGeneration: imageGenerationPatchSchema.optional(),
  computerUse: computerUsePatchSchema.optional(),
  activeAgentRuntime: agentRuntimeIdSchema.optional(),
  agents: z.object({
    sciforge: localRuntimePatchSchema.optional(),
    codex: codexRuntimePatchSchema.optional(),
    claude: claudeRuntimePatchSchema.optional()
  }).strict().optional(),
  workspaceRoot: defaultPathSchema,
  log: logPatchSchema.optional(),
  notifications: notificationsPatchSchema.optional(),
  appBehavior: appBehaviorPatchSchema.optional(),
  workbenchToolbar: z.object({
    hiddenCommandIds: z.array(
      trimmedString(WORKBENCH_TOOLBAR_COMMAND_ID_MAX_LENGTH)
    ).max(WORKBENCH_TOOLBAR_MAX_COMMANDS).optional(),
    commandOrder: z.array(
      trimmedString(WORKBENCH_TOOLBAR_COMMAND_ID_MAX_LENGTH)
    ).max(WORKBENCH_TOOLBAR_MAX_COMMANDS).optional()
  }).strict().optional(),
  keyboardShortcuts: keyboardShortcutsPatchSchema.optional(),
  write: writeSettingsPatchSchema.optional(),
  speechToText: speechToTextPatchSchema.optional(),
  skills: skillsSettingsPatchSchema.optional(),
  schedule: scheduleSettingsPatchSchema.optional(),
  workflow: workflowSettingsPatchSchema.optional(),
  guiUpdate: z.object({
    channel: z.enum(GUI_UPDATE_CHANNELS).optional()
  }).strict().optional(),
  codePromptPrefix: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

export const settingsPatchSchema = settingsPatchObjectSchema

export const skillSaveFilePayloadSchema = z
  .object({
    rootPath: trimmedString(MAX_PATH_LENGTH),
    skillName: trimmedString(128),
    content: z.string().max(MAX_SKILL_FILE_BYTES)
  })
  .strict()

export const skillListPayloadSchema = z
  .object({
    workspaceRoot: z.string().trim().max(MAX_PATH_LENGTH).optional()
  })
  .strict()

export const scientificSkillsMcpConfigPayloadSchema = z
  .object({
    workspaceRoot: z.string().trim().max(MAX_PATH_LENGTH).optional()
  })
  .strict()

export const scientificPlottingMcpConfigPayloadSchema = z
  .object({
    workspaceRoot: z.string().trim().max(MAX_PATH_LENGTH).optional()
  })
  .strict()

export const scientificSkillsInstallPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    backend: z.enum(['git', 'npx']).optional(),
    ref: z.string().trim().min(1).max(128).optional()
  })
  .strict()

export const pptMasterMcpConfigPayloadSchema = z
  .object({
    workspaceRoot: z.string().trim().max(MAX_PATH_LENGTH).optional()
  })
  .strict()

export const rootPathSchema = trimmedString(MAX_PATH_LENGTH)
export const workspaceRootSchema = trimmedString(MAX_PATH_LENGTH)
export const gitWorkspacePayloadSchema = z
  .object({
    workspaceRoot: workspaceRootSchema,
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()
export const gitBranchPayloadSchema = z
  .object({
    workspaceRoot: workspaceRootSchema,
    branch: trimmedString(MAX_BRANCH_LENGTH),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const openEditorPathPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    workspaceLocator: workspaceLocatorSchema.optional(),
    editorId: optionalTrimmedString(MAX_EDITOR_ID_LENGTH),
    line: z.number().int().positive().max(1_000_000).optional(),
    column: z.number().int().positive().max(1_000_000).optional(),
    selection: workspaceStructuredSelectionSchema.optional(),
    anchor: workspacePreviewAnchorSchema.optional(),
    integrity: workspacePreviewIntegrityExpectationSchema.optional()
  })
  .strict()

export const workspaceFileTargetPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    workspaceLocator: workspaceLocatorSchema.optional(),
    line: z.number().int().positive().max(1_000_000).optional(),
    column: z.number().int().positive().max(1_000_000).optional()
  })
  .strict()

export const workspacePreviewOpenPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    workspaceLocator: workspaceLocatorSchema.optional(),
    mimeType: optionalTrimmedString(MAX_MIME_TYPE_LENGTH),
    mode: z.string().trim().pipe(workspacePreviewModeSchema).optional(),
    line: z.number().int().positive().max(1_000_000).optional(),
    column: z.number().int().positive().max(1_000_000).optional(),
    selection: workspaceStructuredSelectionSchema.optional(),
    anchor: workspacePreviewAnchorSchema.optional(),
    integrity: workspacePreviewIntegrityExpectationSchema.optional()
  })
  .strict()

export const workspaceDirectoryTargetPayloadSchema = z
  .object({
    path: optionalTrimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const workspaceFileWritePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    content: z.string().max(MAX_BODY_BYTES).optional(),
    contentBase64: z.string().max(MAX_WORKSPACE_BINARY_BODY_BASE64_CHARS).optional(),
    expectedRevision: z.string().trim().min(1).max(512).optional(),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .refine((payload) => payload.content !== undefined || payload.contentBase64 !== undefined, {
    message: 'Either content or contentBase64 is required.'
  })
  .strict()

export const workspaceFileCreatePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    content: z.string().max(MAX_BODY_BYTES).optional(),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const workspaceDirectoryCreatePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const workspaceClipboardImageSavePayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    currentFilePath: trimmedString(MAX_PATH_LENGTH),
    imageDirectory: optionalTrimmedString(MAX_PATH_LENGTH),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const workspaceClipboardPastePayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    targetDirectory: z.string().trim().max(MAX_PATH_LENGTH),
    conflictPolicy: workspaceFileConflictPolicySchema.optional(),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const workspaceEntryRenamePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    newName: trimmedString(255),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const workspacePdfRenameSuggestionPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const workspaceEntryCopyPayloadSchema = z
  .object({
    sourcePath: trimmedString(MAX_PATH_LENGTH),
    sourceWorkspaceRoot: trimmedString(MAX_PATH_LENGTH),
    targetDirectory: z.string().trim().max(MAX_PATH_LENGTH),
    targetWorkspaceRoot: trimmedString(MAX_PATH_LENGTH),
    conflictPolicy: workspaceFileConflictPolicySchema.optional(),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const workspaceEntryImportPayloadSchema = z
  .object({
    sourcePaths: z.array(trimmedString(MAX_PATH_LENGTH)).min(1).max(512),
    targetDirectory: z.string().trim().max(MAX_PATH_LENGTH),
    targetWorkspaceRoot: trimmedString(MAX_PATH_LENGTH),
    conflictPolicy: workspaceFileConflictPolicySchema.optional(),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const workspaceEntryMovePayloadSchema = z
  .object({
    sourcePath: trimmedString(MAX_PATH_LENGTH),
    sourceWorkspaceRoot: trimmedString(MAX_PATH_LENGTH),
    targetDirectory: z.string().trim().max(MAX_PATH_LENGTH),
    targetWorkspaceRoot: trimmedString(MAX_PATH_LENGTH),
    conflictPolicy: workspaceFileConflictPolicySchema.optional(),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const workspaceEntryDeletePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const workspaceFileWatchPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    workspaceLocator: workspaceLocatorSchema.optional()
  })
  .strict()

export const workspaceFileRangeReadPayloadSchema = z.object({
  path: trimmedString(MAX_PATH_LENGTH),
  workspaceRoot: trimmedString(MAX_PATH_LENGTH),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  length: z.number().int().positive().max(WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes),
  workspaceLocator: workspaceLocatorSchema.optional()
}).strict()

export const workspaceTextSearchPayloadSchema = z.object({
  workspaceRoot: trimmedString(MAX_PATH_LENGTH),
  query: z.string().min(1).max(10_000),
  path: optionalTrimmedString(MAX_PATH_LENGTH),
  glob: z.string().min(1).max(1_024).optional(),
  caseSensitive: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(10_000).optional(),
  workspaceLocator: workspaceLocatorSchema.optional()
}).strict()

export const writeExportPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    format: z.enum(WRITE_EXPORT_FORMATS),
    content: z.string().max(MAX_BODY_BYTES),
    threadId: optionalTrimmedString(MAX_ID_LENGTH),
    runtimeId: agentRuntimeIdSchema.optional(),
    overrideConfirmed: z.boolean().optional()
  })
  .strict()

const writeInlineEditRecentEditSchema = z
  .object({
    source: z.enum(['user', 'inline-edit']),
    ageMs: z.number().int().min(0).max(24 * 60 * 60 * 1_000),
    filePath: optionalTrimmedString(MAX_PATH_LENGTH),
    from: z.number().int().min(0).max(MAX_BODY_BYTES),
    to: z.number().int().min(0).max(MAX_BODY_BYTES),
    deletedText: z.string().max(8_000),
    insertedText: z.string().max(8_000),
    beforeContext: z.string().max(4_000),
    afterContext: z.string().max(4_000),
    instruction: z.string().trim().min(1).max(10_000).optional(),
    scopeKind: z.enum(['selection', 'paragraph']).optional()
  })
  .strict()
  .refine((edit) => edit.to >= edit.from, {
    message: 'Recent edit end must be greater than or equal to start.'
  })

const writeInlineCompletionEditCandidateSchema = z
  .object({
    kind: z.enum(['selection', 'paragraph']),
    from: z.number().int().min(0).max(MAX_BODY_BYTES),
    to: z.number().int().min(0).max(MAX_BODY_BYTES),
    startLine: z.number().int().positive().max(1_000_000),
    startColumn: z.number().int().positive().max(1_000_000),
    endLine: z.number().int().positive().max(1_000_000),
    endColumn: z.number().int().positive().max(1_000_000),
    original: z.string().max(MAX_EDITOR_COMPLETION_TEXT),
    selectedText: z.string().max(50_000).optional()
  })
  .strict()
  .refine((scope) => scope.to >= scope.from, {
    message: 'Completion edit candidate end must be greater than or equal to start.'
  })

export const writeInlineCompletionPayloadSchema = z
  .object({
    prefix: z.string().max(MAX_EDITOR_COMPLETION_TEXT),
    suffix: z.string().max(MAX_EDITOR_COMPLETION_TEXT),
    mode: z.enum(['short', 'long', 'edit']).optional(),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    currentFilePath: optionalTrimmedString(MAX_PATH_LENGTH),
    cursor: z
      .object({
        line: z.number().int().positive().max(1_000_000),
        column: z.number().int().min(0).max(1_000_000)
      })
      .strict(),
    context: z
      .object({
        language: trimmedString(64),
        currentLinePrefix: z.string().max(20_000),
        currentLineSuffix: z.string().max(20_000),
        previousLine: z.string().max(20_000),
        previousNonEmptyLine: z.string().max(20_000),
        nextLine: z.string().max(20_000),
        indentation: z.string().max(2_000),
        signals: z
          .object({
            list: z.boolean(),
            quote: z.boolean(),
            heading: z.boolean(),
            table: z.boolean(),
            atLineEnd: z.boolean(),
            endsWithSentencePunctuation: z.boolean(),
            previousLineEndsWithSentencePunctuation: z.boolean(),
            prefersNewLineCompletion: z.boolean(),
            paragraphBreakOpportunity: z.boolean()
          })
          .strict()
      })
      .strict(),
    policy: z
      .object({
        name: trimmedString(128),
        instruction: z.string().max(50_000),
        acceptanceCriteria: z.array(z.string().max(5_000)).max(12),
        rejectionCriteria: z.array(z.string().max(5_000)).max(12)
      })
      .strict(),
    preview: z
      .object({
        local: z.string().max(5_000),
        documentTail: z.string().max(20_000)
    })
      .strict(),
    editCandidate: writeInlineCompletionEditCandidateSchema.optional(),
    recentEdits: z.array(writeInlineEditRecentEditSchema).max(12).optional()
  })
  .strict()

export const writeRetrievalPayloadSchema = z
  .object({
    workspaceRoot: defaultPathSchema,
    currentFilePath: defaultPathSchema,
    query: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    maxSnippets: z.number().int().min(1).max(8).optional(),
    includeCurrentFile: z.boolean().optional()
  })
  .strict()

export const speechToTextSettingsPayloadSchema = z
  .object({
    enabled: z.boolean(),
    protocol: speechToTextProtocolSchema,
    model: z.string().trim().max(128),
    language: z.string().trim().max(64).optional(),
    timeoutMs: z.number().int().min(5_000).max(600_000)
  })
  .strict()

export const speechTranscriptionPayloadSchema = z
  .object({
    audioBase64: z.string().min(1).max(SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS),
    mimeType: z.string().trim().min(1).max(MAX_MIME_TYPE_LENGTH),
    durationMs: z.number().int().positive().max(SPEECH_TRANSCRIPTION_MAX_DURATION_MS).optional()
  })
  .strict()
  .refine((payload) => payload.mimeType.toLowerCase().startsWith('audio/'), {
    message: 'mimeType must be an audio MIME type'
  })
  .refine((payload) => /^[A-Za-z0-9+/]+={0,2}$/.test(payload.audioBase64), {
    message: 'audioBase64 must be base64-encoded audio bytes'
  })

export const shellOpenExternalUrlSchema = trimmedString(MAX_URL_LENGTH).refine(
  isSafeOpenExternalUrl,
  { message: 'Only http, https, and mailto URLs are allowed.' }
)

export const notificationPayloadSchema = z
  .object({
    threadId: optionalTrimmedString(MAX_ID_LENGTH),
    title: trimmedString(MAX_NOTIFICATION_TITLE_LENGTH),
    body: trimmedString(MAX_NOTIFICATION_BODY_LENGTH)
  })
  .strict()

export const guiUpdateChannelSchema = z.enum(GUI_UPDATE_CHANNELS).optional()

export const desktopCommandSchema = z.enum(DESKTOP_COMMANDS)

export const computerUsePermissionKindSchema = z.enum(['accessibility', 'screenRecording'])

export const logErrorPayloadSchema = z
  .object({
    category: trimmedString(128),
    message: trimmedString(2_000),
    detail: z.unknown().optional()
  })
  .strict()

export const scheduleTaskFromTextPayloadSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    workspaceRoot: defaultPathSchema,
    modelHint: z.string().trim().min(1).max(128).nullable().optional(),
    mode: z.enum(['agent', 'plan']).nullable().optional()
  })
  .strict()

export const streamIdSchema = trimmedString(MAX_ID_LENGTH)
