import { z } from 'zod'
import {
  REMOTE_CHANNEL_MODEL_IDS,
  SCHEDULE_MODEL_IDS,
  SCHEDULE_REASONING_EFFORT_IDS,
  SPEECH_TO_TEXT_PROTOCOLS
} from '../../shared/app-settings'
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
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_CWD_LENGTH,
  TERMINAL_MAX_DATA_WRITE_BYTES,
  TERMINAL_MAX_ROWS,
  TERMINAL_MAX_SESSION_ID_LENGTH
} from '../../shared/terminal'
import { WRITE_EXPORT_FORMATS } from '../../shared/write-export'
import {
  RESEARCH_CARD_DECISIONS,
  RESEARCH_CARD_KINDS,
  RESEARCH_CARD_ORIGINS,
  RESEARCH_CARD_PRIORITIES,
  RESEARCH_CARD_REF_KINDS,
  RESEARCH_CARD_STAGES,
  RESEARCH_CARD_STATUSES
} from '../../shared/research-cards'
import {
  workspacePreviewByteRangeSchema,
  workspacePreviewEditOperationSchema,
  workspacePreviewExportTargetSchema,
  workspacePreviewAnchorSchema,
  workspacePreviewIntegrityExpectationSchema,
  workspacePreviewModeSchema,
  workspacePreviewPrepareArtifactRequestSchema,
  workspacePreviewPluginActionInputSchema,
  workspacePreviewReadArtifactRangeRequestSchema,
  workspaceStructuredSelectionSchema
} from '../../shared/workspace-preview'
import { workspaceFileConflictPolicySchema } from '../../shared/workspace-file'
export {
  visibleContextCapturePreviewRequestSchema as visibleContextCapturePreviewPayloadSchema,
  visibleContextSnapshotSchema as visibleContextPublishPayloadSchema
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
const MAX_CONFIG_FILE_BYTES = 2_000_000
const MAX_WORKSPACE_BINARY_BODY_BASE64_CHARS = 90_000_000
const MAX_DEVICE_CODE_LENGTH = 8_192
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

const localeSchema = z.enum(['en', 'zh'])
const themeSchema = z.enum(['system', 'light', 'dark'])
const uiFontScaleSchema = z.enum(['small', 'medium', 'large'])
const agentRuntimeIdSchema = z.enum(['sciforge', 'codex', 'claude'])
const agentRuntimeThreadRelationSchema = z.string().trim().pipe(z.enum(['primary', 'fork', 'side']))
const agentRuntimeUsageGroupBySchema = z.string().trim().pipe(z.enum(['day', 'model', 'thread']))
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
const remoteChannelProviderSchema = z.enum(['feishu', 'weixin', 'discord', 'zulip'])
const remoteChannelGuardModeSchema = z.enum(['only_mention', 'all_messages', 'off'])
const connectPhoneInstallProviderSchema = z.enum(['feishu', 'weixin'])
const scheduleKindSchema = z.enum(['manual', 'interval', 'daily', 'at'])
const taskStatusSchema = z.enum(['idle', 'running', 'success', 'error'])
const scheduleReasoningEffortSchema = z.enum(SCHEDULE_REASONING_EFFORT_IDS)
const speechToTextProtocolSchema = z.enum(SPEECH_TO_TEXT_PROTOCOLS)
const paperRadarSourceSchema = z.enum(['arxiv', 'biorxiv'])
const researchCardKindSchema = z.enum(RESEARCH_CARD_KINDS)
const researchCardStatusSchema = z.enum(RESEARCH_CARD_STATUSES)
const researchCardStageSchema = z.enum(RESEARCH_CARD_STAGES)
const researchCardPrioritySchema = z.enum(RESEARCH_CARD_PRIORITIES)
const researchCardRefKindSchema = z.enum(RESEARCH_CARD_REF_KINDS)
const researchCardOriginKindSchema = z.enum(RESEARCH_CARD_ORIGINS)
const researchCardDecisionSchema = z.enum(RESEARCH_CARD_DECISIONS)
const agentThreadIdsSchema = z.object({
  sciforge: z.string().max(MAX_ID_LENGTH).optional(),
  codex: z.string().max(MAX_ID_LENGTH).optional(),
  claude: z.string().max(MAX_ID_LENGTH).optional()
}).strict()
const agentRuntimeGovernanceProfileSchema = z.enum(['default', 'write', 'remote_guard'])
const agentRuntimeFileReferenceSchema = z.object({
  path: trimmedString(MAX_PATH_LENGTH),
  relativePath: trimmedString(MAX_PATH_LENGTH),
  name: trimmedString(512),
  kind: z.enum(['file', 'directory', 'image', 'pdf', 'text']).optional(),
  delivery: z.enum(['inline_context', 'model_router_object']).optional(),
  mimeType: optionalTrimmedString(MAX_MIME_TYPE_LENGTH),
  modelRouterObject: z.boolean().optional()
}).strict()

export const agentRuntimeConnectPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional()
}).strict()

export const agentRuntimeListThreadsPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
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
  title: z.string().trim().max(200).optional(),
  mode: z.string().trim().max(64).optional(),
  model: z.string().trim().max(128).optional()
}).strict()

export const agentRuntimeReadThreadPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH)
}).strict()

export const agentRuntimeReadThreadSidebarProbePayloadSchema = agentRuntimeReadThreadPayloadSchema

export const agentRuntimeStartTurnPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
  workspace: defaultPathSchema,
  mode: z.string().trim().max(64).optional(),
  model: z.string().trim().max(128).optional(),
  reasoningEffort: z.string().trim().max(64).optional(),
  remoteTargetId: z.string().trim().max(MAX_ID_LENGTH).optional(),
  governanceProfile: agentRuntimeGovernanceProfileSchema.optional(),
  displayText: z.string().trim().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
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
  discard: z.boolean().optional()
}).strict()

export const agentRuntimeTurnSteerPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  turnId: trimmedString(MAX_ID_LENGTH),
  text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH)
}).strict()

export const agentRuntimeEventSubscribePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  sinceSeq: z.number().int().nonnegative().optional(),
  streamId: optionalTrimmedString(MAX_ID_LENGTH)
}).strict()

export const agentRuntimeThreadRenamePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  title: z.string().trim().min(1).max(200)
}).strict()

export const terminalSessionIdSchema = trimmedString(TERMINAL_MAX_SESSION_ID_LENGTH)

export const terminalCreatePayloadSchema = z
  .object({
    sessionId: terminalSessionIdSchema,
    ownerToken: optionalTrimmedString(TERMINAL_MAX_SESSION_ID_LENGTH),
    cwd: optionalTrimmedString(TERMINAL_MAX_CWD_LENGTH),
    cols: z.number().int().min(1).max(TERMINAL_MAX_COLS).optional(),
    rows: z.number().int().min(1).max(TERMINAL_MAX_ROWS).optional()
  })
  .strict()

export const terminalWritePayloadSchema = z
  .object({
    sessionId: terminalSessionIdSchema,
    data: z.string().min(1).max(TERMINAL_MAX_DATA_WRITE_BYTES)
  })
  .strict()

export const terminalResizePayloadSchema = z
  .object({
    sessionId: terminalSessionIdSchema,
    cols: z.number().int().min(1).max(TERMINAL_MAX_COLS).default(TERMINAL_DEFAULT_COLS),
    rows: z.number().int().min(1).max(TERMINAL_MAX_ROWS).default(TERMINAL_DEFAULT_ROWS)
  })
  .strict()

export const agentRuntimeThreadDeletePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH)
}).strict()

export const agentRuntimeThreadCompactPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  reason: z.string().trim().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

export const agentRuntimeThreadForkPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  relation: agentRuntimeThreadRelationSchema.optional(),
  title: z.string().trim().max(200).optional()
}).strict()

export const agentRuntimeSessionResumePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  sessionId: trimmedString(MAX_ID_LENGTH),
  model: z.string().trim().max(128).optional(),
  mode: z.string().trim().max(64).optional(),
  maxResumeCount: z.number().int().positive().max(1_000).optional()
}).strict()

export const agentRuntimeThreadRelationPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  relation: agentRuntimeThreadRelationSchema
}).strict()

export const agentRuntimeUsagePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  groupBy: agentRuntimeUsageGroupBySchema,
  from: z.string().trim().max(64).optional(),
  to: z.string().trim().max(64).optional(),
  timezone: z.string().trim().max(128).optional(),
  threadId: optionalTrimmedString(MAX_ID_LENGTH)
}).strict()

const agentRuntimeAuxiliaryRuntimeScopedPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  operation: agentRuntimeAuxiliaryOperationSchema,
  payload: agentRuntimeAuxiliaryPayloadRecordSchema
}).strict()

const agentRuntimeAuxiliaryActiveScopedPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  operation: agentRuntimeAuxiliaryActiveScopedOperationSchema,
  payload: agentRuntimeAuxiliaryPayloadRecordSchema
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
  message: z.string().trim().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

export const agentRuntimeUserInputResolvePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema,
  threadId: trimmedString(MAX_ID_LENGTH),
  requestId: trimmedString(MAX_ID_LENGTH),
  answers: z.array(z.object({
    id: trimmedString(MAX_ID_LENGTH),
    label: z.string().trim().max(200).optional(),
    value: z.string().trim().max(MAX_CHANNEL_TEXT_LENGTH)
  }).strict()).max(50)
}).strict()

export const paperRadarArxivSyncPayloadSchema = z.object({
  categories: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  since: z.string().trim().max(64).optional(),
  until: z.string().trim().max(64).optional(),
  maxRecords: z.number().int().positive().max(2_000).optional()
}).strict()

export const paperRadarBiorxivSyncPayloadSchema = z.object({
  from: z.string().trim().max(64).optional(),
  to: z.string().trim().max(64).optional(),
  maxRecords: z.number().int().positive().max(2_000).optional()
}).strict()

export const paperRadarProfileSyncPayloadSchema = z.object({
  profile: z.string().trim().max(128).optional(),
  from: z.string().trim().max(64).optional(),
  to: z.string().trim().max(64).optional(),
  maxRecords: z.number().int().positive().max(2_000).optional()
}).strict()

export const paperRadarSearchPayloadSchema = z.object({
  query: z.string().trim().max(1_000).optional(),
  sources: z.array(paperRadarSourceSchema).max(2).optional(),
  categories: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  from: z.string().trim().max(64).optional(),
  to: z.string().trim().max(64).optional(),
  topK: z.number().int().positive().max(100).optional()
}).strict()

export const paperRadarProfilePayloadSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  keywords: z.array(z.string().trim().min(1).max(128)).max(100),
  excludeKeywords: z.array(z.string().trim().min(1).max(128)).max(100),
  arxivCategories: z.array(z.string().trim().min(1).max(64)).max(50),
  biorxivSubjects: z.array(z.string().trim().min(1).max(128)).max(50)
}).strict()

export const paperRadarReviewPayloadSchema = z.object({
  profile: paperRadarProfilePayloadSchema,
  days: z.number().int().positive().max(365).optional(),
  topK: z.number().int().positive().max(100).optional(),
  maxRecords: z.number().int().positive().max(2_000).optional()
}).strict()

export const paperRadarRankPayloadSchema = paperRadarSearchPayloadSchema.extend({
  profile: z.string().trim().max(128).optional(),
  keywords: z.array(z.string().trim().min(1).max(128)).max(50).optional(),
  excludeKeywords: z.array(z.string().trim().min(1).max(128)).max(50).optional(),
  days: z.number().int().positive().max(365).optional()
}).strict()

export const paperRadarDigestPayloadSchema = paperRadarSearchPayloadSchema.extend({
  profile: z.string().trim().max(128).optional(),
  keywords: z.array(z.string().trim().min(1).max(128)).max(50).optional(),
  excludeKeywords: z.array(z.string().trim().min(1).max(128)).max(50).optional(),
  days: z.number().int().positive().max(365).optional()
}).strict()

const researchCardMetadataSchema = z.record(z.string(), z.unknown())

const researchCardRefSchema = z.object({
  kind: researchCardRefKindSchema,
  id: trimmedString(512),
  label: z.string().trim().max(512).optional(),
  uri: z.string().trim().max(MAX_URL_LENGTH).optional(),
  metadata: researchCardMetadataSchema.optional()
}).strict()

const researchCardOriginSchema = z.object({
  kind: researchCardOriginKindSchema,
  id: z.string().trim().max(512).optional(),
  label: z.string().trim().max(512).optional()
}).strict()

const researchCardDecisionPayloadSchema = z.object({
  value: researchCardDecisionSchema,
  reason: z.string().trim().max(2_000).optional(),
  decidedBy: z.string().trim().max(256).optional(),
  decidedAt: z.string().trim().max(64)
}).strict()

export const researchCardListPayloadSchema = z.object({
  workspaceRoot: defaultPathSchema,
  kind: researchCardKindSchema.optional(),
  status: researchCardStatusSchema.optional(),
  stage: researchCardStageSchema.optional(),
  threadId: optionalTrimmedString(MAX_ID_LENGTH),
  query: z.string().trim().max(1_000).optional(),
  tags: z.array(z.string().trim().min(1).max(128)).max(50).optional(),
  includeArchived: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional()
}).strict()

export const researchCardCreatePayloadSchema = z.object({
  id: optionalTrimmedString(MAX_ID_LENGTH),
  kind: researchCardKindSchema,
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(4_000).optional(),
  status: researchCardStatusSchema.optional(),
  stage: researchCardStageSchema.optional(),
  priority: researchCardPrioritySchema.optional(),
  workspaceRoot: defaultPathSchema,
  runtimeId: agentRuntimeIdSchema.optional(),
  threadId: optionalTrimmedString(MAX_ID_LENGTH),
  turnId: optionalTrimmedString(MAX_ID_LENGTH),
  evidenceRefs: z.array(researchCardRefSchema).max(200).optional(),
  artifactRefs: z.array(researchCardRefSchema).max(200).optional(),
  sourceRefs: z.array(researchCardRefSchema).max(200).optional(),
  relatedCardIds: z.array(trimmedString(MAX_ID_LENGTH)).max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  decision: researchCardDecisionPayloadSchema.optional(),
  nextAction: z.string().trim().max(2_000).optional(),
  createdFrom: researchCardOriginSchema.optional(),
  metadata: researchCardMetadataSchema.optional()
}).strict()

const researchCardUpdatePatchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  summary: z.string().trim().max(4_000).nullable().optional(),
  status: researchCardStatusSchema.optional(),
  stage: researchCardStageSchema.optional(),
  priority: researchCardPrioritySchema.optional(),
  workspaceRoot: z.string().trim().max(MAX_PATH_LENGTH).nullable().optional(),
  runtimeId: agentRuntimeIdSchema.nullable().optional(),
  threadId: z.string().trim().max(MAX_ID_LENGTH).nullable().optional(),
  turnId: z.string().trim().max(MAX_ID_LENGTH).nullable().optional(),
  evidenceRefs: z.array(researchCardRefSchema).max(200).optional(),
  artifactRefs: z.array(researchCardRefSchema).max(200).optional(),
  sourceRefs: z.array(researchCardRefSchema).max(200).optional(),
  relatedCardIds: z.array(trimmedString(MAX_ID_LENGTH)).max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  decision: researchCardDecisionPayloadSchema.nullable().optional(),
  nextAction: z.string().trim().max(2_000).nullable().optional(),
  createdFrom: researchCardOriginSchema.optional(),
  metadata: researchCardMetadataSchema.nullable().optional(),
  archived: z.boolean().optional()
}).strict()

export const researchCardUpdatePayloadSchema = z.object({
  cardId: trimmedString(MAX_ID_LENGTH),
  patch: researchCardUpdatePatchSchema
}).strict()

export const researchCardArchivePayloadSchema = z.object({
  cardId: trimmedString(MAX_ID_LENGTH),
  archived: z.boolean().optional()
}).strict()

const modelProviderPatchSchema = z.object({
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  providers: z.array(z.object({
    id: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    apiKey: z.string().max(MAX_BODY_BYTES).optional(),
    baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
    models: z.array(z.string().trim().min(1).max(128)).max(200).optional()
  }).strict()).max(50).optional()
}).strict()

const modelRouterMemberProviderPatchSchema = z.object({
  provider: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  model: z.string().trim().max(128).optional(),
  maxSupplementRounds: z.number().int().min(0).max(3).optional()
}).strict()

const modelRouterScientificTranslatorPatchSchema = z.object({
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  model: z.string().trim().max(128).optional(),
  timeoutMs: z.number().int().min(1).max(3_600_000).optional()
}).strict()

const modelRouterPatchSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  autoStart: z.boolean().optional(),
  publicModelAlias: z.string().trim().min(1).max(128).optional(),
  runtimeApiKey: z.string().max(MAX_BODY_BYTES).optional(),
  profiles: z.object({
    default: z.object({
      textReasoner: modelRouterMemberProviderPatchSchema.optional(),
      imageGenerator: modelRouterMemberProviderPatchSchema.optional(),
      translators: z.object({
        vision: modelRouterMemberProviderPatchSchema.optional(),
        scientific: modelRouterScientificTranslatorPatchSchema.optional()
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

const runtimeToolBudgetProfilePatchSchema = z.object({
  softLimit: z.number().int().positive().max(10_000).optional(),
  hardLimit: z.number().int().positive().max(10_000).optional(),
  maxAutomaticPhases: z.number().int().positive().max(32).optional(),
  totalLimit: z.number().int().positive().max(100_000).optional()
}).strict()

const localRuntimePatchSchema = z.object({
  binaryPath: defaultPathSchema,
  port: z.number().int().min(1).max(65_535).optional(),
  autoStart: z.boolean().optional(),
  providerId: z.string().trim().max(64).optional(),
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
  }).strict().optional(),
  runtimeTuning: z.object({
    toolArgumentRepair: z.object({
      maxStringBytes: z.number().int().positive().max(16 * 1024 * 1024).optional()
    }).strict().optional(),
    toolBudget: z.object({
      enabled: z.boolean().optional(),
      profiles: z.object({
        explanation: runtimeToolBudgetProfilePatchSchema.optional(),
        review: runtimeToolBudgetProfilePatchSchema.optional(),
        implementation: runtimeToolBudgetProfilePatchSchema.optional(),
        long: runtimeToolBudgetProfilePatchSchema.optional()
      }).strict().optional()
    }).strict().optional(),
    parallelism: z.object({
      localReadOnly: z.number().int().positive().max(64).optional(),
      networkMcp: z.number().int().positive().max(64).optional()
    }).strict().optional()
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
  toolStorm: z.object({
    enabled: z.boolean().optional(),
    windowSize: z.number().int().positive().max(256).optional(),
    threshold: z.number().int().min(2).max(128).optional()
  }).strict().optional()
}).strict()

const agentCapabilityPatchSchema = z.object({
  subagents: z.object({
    enabled: z.boolean().optional(),
    maxParallel: z.number().int().positive().max(16).optional(),
    maxChildRuns: z.number().int().positive().max(4).optional()
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

const remoteChannelSkillPatchSchema = z.object({
  defaultNames: z.array(trimmedString(128)).max(128).optional(),
  extraDirs: z.array(trimmedString(MAX_PATH_LENGTH)).max(128).optional(),
  promptPrefix: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

const remoteChannelImPatchSchema = z.object({
  enabled: z.boolean().optional(),
  provider: remoteChannelProviderSchema.optional(),
  port: z.number().int().min(1024).max(65_535).optional(),
  path: trimmedString(MAX_PATH_LENGTH).optional(),
  secret: z.string().max(MAX_BODY_BYTES).optional(),
  workspaceRoot: defaultPathSchema,
  model: z.string().trim().min(1).max(128).optional(),
  mode: runModeSchema.optional(),
  responseTimeoutMs: z.number().int().min(5_000).max(600_000).optional()
}).strict()

const remoteChannelAgentProfilePatchSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2_000).optional(),
  identity: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  personality: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  userContext: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  replyRules: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

const remoteChannelPlatformCredentialPatchSchema = z.union([
  z.object({
    kind: z.literal('feishu').optional(),
    appId: z.string().max(512).optional(),
    appSecret: z.string().max(MAX_BODY_BYTES).optional(),
    domain: z.string().max(512).optional(),
    createdAt: z.string().max(128).optional()
  }).strict(),
  z.object({
    kind: z.literal('weixin'),
    accountId: z.string().max(512).optional(),
    sessionKey: z.string().max(MAX_BODY_BYTES).optional(),
    createdAt: z.string().max(128).optional()
  }).strict(),
  z.object({
    kind: z.literal('discord'),
    applicationId: z.string().max(MAX_ID_LENGTH).optional(),
    botId: z.string().max(MAX_ID_LENGTH).optional(),
    botUsername: z.string().max(512).optional(),
    guildId: z.string().max(MAX_ID_LENGTH).optional(),
    guildName: z.string().max(512).optional(),
    channelId: z.string().max(MAX_ID_LENGTH).optional(),
    channelName: z.string().max(512).optional(),
    installationId: z.string().max(128).optional(),
    guardOwnerInstallationId: z.string().max(128).optional(),
    guardOwnerUpdatedAt: z.string().max(128).optional(),
    createdAt: z.string().max(128).optional()
  }).strict(),
  z.object({
    kind: z.literal('zulip'),
    realmUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
    botEmail: z.string().trim().max(512).optional(),
    botUserId: z.string().trim().max(MAX_ID_LENGTH).optional(),
    botFullName: z.string().trim().max(512).optional(),
    streamId: z.string().trim().max(MAX_ID_LENGTH).optional(),
    streamName: z.string().trim().max(512).optional(),
    topicName: z.string().trim().max(512).optional(),
    installationId: z.string().max(128).optional(),
    guardOwnerInstallationId: z.string().max(128).optional(),
    guardOwnerUpdatedAt: z.string().max(128).optional(),
    createdAt: z.string().max(128).optional()
  }).strict()
])

const remoteChannelRemoteSessionPatchSchema = z.object({
  chatId: z.string().max(MAX_ID_LENGTH).optional(),
  messageId: z.string().max(MAX_ID_LENGTH).optional(),
  threadId: z.string().max(MAX_ID_LENGTH).optional(),
  senderId: z.string().max(MAX_ID_LENGTH).optional(),
  senderName: z.string().max(512).optional(),
  updatedAt: z.string().max(128).optional()
}).strict()

const remoteChannelRecentMessagePatchSchema = z.object({
  provider: remoteChannelProviderSchema.optional(),
  channelId: z.string().max(MAX_ID_LENGTH).optional(),
  chatId: z.string().max(MAX_ID_LENGTH).optional(),
  remoteThreadId: z.string().max(MAX_ID_LENGTH).optional(),
  messageId: z.string().max(MAX_ID_LENGTH).optional(),
  senderName: z.string().max(512).optional(),
  text: z.string().max(2_000).optional(),
  receivedAt: z.string().max(128).optional()
}).strict()

const remoteChannelConversationPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  chatId: z.string().max(MAX_ID_LENGTH).optional(),
  remoteThreadId: z.string().max(MAX_ID_LENGTH).optional(),
  latestMessageId: z.string().max(MAX_ID_LENGTH).optional(),
  senderId: z.string().max(MAX_ID_LENGTH).optional(),
  senderName: z.string().max(512).optional(),
  runtimeId: agentRuntimeIdSchema.optional(),
  agentThreadIds: agentThreadIdsSchema.optional(),
  workspaceRoot: defaultPathSchema,
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional()
}).strict()

const remoteChannelPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  provider: remoteChannelProviderSchema.optional(),
  label: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  guardMode: remoteChannelGuardModeSchema.optional(),
  model: z.string().trim().min(1).max(128).optional(),
  runtimeId: agentRuntimeIdSchema.optional(),
  agentThreadIds: agentThreadIdsSchema.optional(),
  workspaceRoot: defaultPathSchema,
  agentProfile: remoteChannelAgentProfilePatchSchema.optional(),
  platformCredential: remoteChannelPlatformCredentialPatchSchema.optional(),
  remoteSession: remoteChannelRemoteSessionPatchSchema.optional(),
  conversations: z.array(remoteChannelConversationPatchSchema).max(512).optional(),
  recentMessages: z.array(remoteChannelRecentMessagePatchSchema).max(2_000).optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional()
}).strict()

const remoteChannelSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  skills: remoteChannelSkillPatchSchema.optional(),
  im: remoteChannelImPatchSchema.optional(),
  channels: z.array(remoteChannelPatchSchema).max(512).optional()
}).strict()

const connectPhoneSettingsPatchSchema = z.object({
  weixinBridgeUrl: z.string().trim().max(MAX_URL_LENGTH).optional()
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

const remoteExecutorSshSettingsPatchSchema = z.object({
  host: optionalTrimmedString(512),
  user: optionalTrimmedString(256),
  port: z.number().int().min(1).max(65_535).optional(),
  pythonPath: defaultPathSchema,
  identityFile: defaultPathSchema
}).strict()

const remoteExecutorSlurmDefaultsPatchSchema = z.object({
  partition: optionalTrimmedString(256),
  account: optionalTrimmedString(256),
  qos: optionalTrimmedString(256),
  timeLimit: optionalTrimmedString(128),
  nodes: z.number().int().positive().max(1_000_000).optional(),
  ntasks: z.number().int().positive().max(1_000_000).optional(),
  cpusPerTask: z.number().int().positive().max(1_000_000).optional(),
  gpus: z.number().int().positive().max(1_000_000).optional(),
  memory: optionalTrimmedString(128),
  constraint: optionalTrimmedString(512),
  gres: optionalTrimmedString(512),
  extraArgs: z.array(z.string().trim().max(512)).max(100).optional()
}).strict()

const remoteExecutorSlurmSettingsPatchSchema = z.object({
  defaults: remoteExecutorSlurmDefaultsPatchSchema.optional()
}).strict()

const remoteExecutorTrustedWorkspacePatchSchema = z.object({
  workspaceRoot: defaultPathSchema,
  targetFingerprint: optionalTrimmedString(512),
  trustedAt: optionalTrimmedString(128),
  trustedBy: optionalTrimmedString(256),
  approvalBypass: z.literal(true).optional()
}).strict()

const remoteExecutorTargetPatchSchema = z.object({
  id: optionalTrimmedString(128),
  label: optionalTrimmedString(256),
  enabled: z.boolean().optional(),
  kind: z.enum(['ssh', 'slurm']).optional(),
  ssh: remoteExecutorSshSettingsPatchSchema.optional(),
  remoteWorkspaceRoot: defaultPathSchema,
  slurm: remoteExecutorSlurmSettingsPatchSchema.optional(),
  trustedWorkspaces: z.array(remoteExecutorTrustedWorkspacePatchSchema).max(200).optional()
}).strict()

const remoteExecutorSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  defaultTargetId: optionalTrimmedString(128),
  targets: z.array(remoteExecutorTargetPatchSchema).max(100).optional()
}).strict()

export const workflowRunNodePayloadSchema = z
  .object({
    workflowId: trimmedString(MAX_ID_LENGTH),
    nodeId: trimmedString(MAX_ID_LENGTH)
  })
  .strict()

export const workflowTestNodePayloadSchema = z
  .object({
    workflowId: trimmedString(MAX_ID_LENGTH),
    nodeId: trimmedString(MAX_ID_LENGTH),
    mockJson: z.string().max(MAX_BODY_BYTES)
  })
  .strict()

export const workflowResolveApprovalPayloadSchema = z
  .object({
    token: trimmedString(MAX_ID_LENGTH),
    decision: z.enum(['approved', 'rejected'])
  })
  .strict()

export const workflowCodeCheckPayloadSchema = z
  .object({
    language: z.enum(['javascript', 'python', 'bash']),
    code: z.string().max(MAX_BODY_BYTES)
  })
  .strict()

const settingsPatchObjectSchema = z.object({
  version: z.literal(1).optional(),
  installationId: z.string().max(128).optional(),
  locale: localeSchema.optional(),
  theme: themeSchema.optional(),
  uiFontScale: uiFontScaleSchema.optional(),
  provider: modelProviderPatchSchema.optional(),
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
  keyboardShortcuts: keyboardShortcutsPatchSchema.optional(),
  write: writeSettingsPatchSchema.optional(),
  speechToText: speechToTextPatchSchema.optional(),
  remoteChannel: remoteChannelSettingsPatchSchema.optional(),
  connectPhone: connectPhoneSettingsPatchSchema.optional(),
  schedule: scheduleSettingsPatchSchema.optional(),
  workflow: workflowSettingsPatchSchema.optional(),
  remoteExecutor: remoteExecutorSettingsPatchSchema.optional(),
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

const visualDocumentIdSchema = trimmedString(120)
const normalizedCoordinateSchema = z.number().finite().min(0).max(1)
const normalizedPointSchema = z.object({
  x: normalizedCoordinateSchema,
  y: normalizedCoordinateSchema
}).strict()
const normalizedBoundsSchema = z.object({
  x: normalizedCoordinateSchema,
  y: normalizedCoordinateSchema,
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1)
}).strict().refine(
  ({ x, y, width, height }) => x + width <= 1 && y + height <= 1,
  'Normalized bounds must remain inside the artifact.'
)

const visualAnnotationGeometrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('box'), bounds: normalizedBoundsSchema }).strict(),
  z.object({ kind: z.literal('pin'), point: normalizedPointSchema }).strict(),
  z.object({ kind: z.literal('arrow'), from: normalizedPointSchema, to: normalizedPointSchema }).strict(),
  z.object({
    kind: z.literal('freehand'),
    points: z.array(normalizedPointSchema).min(2).max(10_000)
  }).strict()
])

const visualNodeSchema = z.object({
  id: trimmedString(MAX_ID_LENGTH),
  kind: z.enum(['generated_asset', 'scientific_plot', 'text', 'shape', 'connector', 'group']),
  bounds: normalizedBoundsSchema,
  semanticRef: optionalTrimmedString(1_000),
  sourceSpecRef: optionalTrimmedString(MAX_PATH_LENGTH),
  assetPath: optionalTrimmedString(MAX_PATH_LENGTH),
  maskPath: optionalTrimmedString(MAX_PATH_LENGTH),
  parentId: optionalTrimmedString(MAX_ID_LENGTH),
  childIds: z.array(trimmedString(MAX_ID_LENGTH)).max(10_000).optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  editable: z.boolean(),
  truthLocked: z.boolean()
}).strict()

const visualTruthLockSchema = z.object({
  id: trimmedString(MAX_ID_LENGTH),
  description: trimmedString(5_000),
  nodeIds: z.array(trimmedString(MAX_ID_LENGTH)).max(10_000),
  sourceRef: optionalTrimmedString(MAX_PATH_LENGTH)
}).strict()

export const visualDocumentStatusPayloadSchema = z.object({
  workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH)
}).strict()

export const visualDocumentOpenPayloadSchema = z.object({
  workspaceRoot: trimmedString(MAX_PATH_LENGTH),
  documentId: visualDocumentIdSchema.optional(),
  createIfMissing: z.boolean().optional(),
  canvas: z.object({
    width: z.number().finite().positive().max(100_000).optional(),
    height: z.number().finite().positive().max(100_000).optional(),
    background: trimmedString(128).optional()
  }).strict().optional(),
  styleProfileRef: z.string().trim().max(MAX_PATH_LENGTH).nullable().optional()
}).strict()

export const visualDocumentInsertArtifactPayloadSchema = z.object({
  workspaceRoot: trimmedString(MAX_PATH_LENGTH),
  documentId: visualDocumentIdSchema.optional(),
  kind: z.enum(['image', 'generated_image', 'edited_image', 'scientific_plot', 'presentation_slide']),
  sourcePath: trimmedString(MAX_PATH_LENGTH),
  manifestPath: optionalTrimmedString(MAX_PATH_LENGTH),
  title: optionalTrimmedString(300),
  caption: optionalTrimmedString(5_000),
  mimeType: optionalTrimmedString(MAX_MIME_TYPE_LENGTH),
  width: z.number().finite().positive().max(100_000).optional(),
  height: z.number().finite().positive().max(100_000).optional(),
  nodes: z.array(visualNodeSchema).max(10_000).optional(),
  truthLocks: z.array(visualTruthLockSchema).max(10_000).optional(),
  styleProfileRef: z.string().trim().max(MAX_PATH_LENGTH).nullable().optional()
}).strict()

export const visualDocumentUpdateContextPayloadSchema = z.object({
  workspaceRoot: trimmedString(MAX_PATH_LENGTH),
  documentId: visualDocumentIdSchema.optional(),
  styleProfileRef: z.string().trim().max(MAX_PATH_LENGTH).nullable().optional(),
  truthLocks: z.array(visualTruthLockSchema).max(10_000).optional(),
  nodes: z.array(visualNodeSchema).max(10_000).optional()
}).strict().refine(
  ({ styleProfileRef, truthLocks, nodes }) => styleProfileRef !== undefined || truthLocks !== undefined || nodes !== undefined,
  'At least one VisualDocument context field is required.'
)

export const visualDocumentSaveAnnotationsPayloadSchema = z.object({
  workspaceRoot: trimmedString(MAX_PATH_LENGTH),
  documentId: visualDocumentIdSchema.optional(),
  annotations: z.array(z.object({
    id: visualDocumentIdSchema.optional(),
    geometry: visualAnnotationGeometrySchema,
    instruction: trimmedString(20_000),
    targetNodeIds: z.array(trimmedString(MAX_ID_LENGTH)).max(10_000).optional(),
    status: z.enum(['open', 'resolved']).optional()
  }).strict()).max(10_000)
}).strict()

export const visualDocumentExportReviewPacketPayloadSchema = z.object({
  workspaceRoot: trimmedString(MAX_PATH_LENGTH),
  documentId: visualDocumentIdSchema.optional(),
  packetId: visualDocumentIdSchema.optional()
}).strict()

export const visualDocumentCreateCandidatePayloadSchema = z.object({
  workspaceRoot: trimmedString(MAX_PATH_LENGTH),
  documentId: visualDocumentIdSchema.optional(),
  candidatePath: trimmedString(MAX_PATH_LENGTH),
  summary: trimmedString(20_000),
  reviewEvidence: z.object({
    tool: z.literal('visual_artifact_review'),
    ok: z.literal(true),
    reviewedArtifactPath: trimmedString(MAX_PATH_LENGTH),
    reviewedArtifactHash: z.string().trim().regex(/^[a-f0-9]{64}$/i),
    reviewedAt: z.string().datetime(),
    score: z.object({
      overall: z.number().min(0).max(1),
      dimensions: z.number().min(0).max(1),
      nonEmpty: z.number().min(0).max(1),
      background: z.number().min(0).max(1),
      reference: z.number().min(0).max(1).optional(),
      semantic: z.number().min(0).max(1),
      warnings: z.array(z.string().max(2_000)).max(100)
    }).strict(),
    semantic: z.object({
      pass: z.literal(true),
      summary: trimmedString(4_000),
      violations: z.array(z.string().max(2_000)).max(0),
      repairInstructions: z.array(z.string().max(2_000)).max(0)
    }).strict(),
    repairable: z.literal(false),
    warnings: z.array(z.string().max(2_000)).max(100)
  }).strict(),
  expectedBaseHash: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional(),
  width: z.number().finite().positive().max(100_000).optional(),
  height: z.number().finite().positive().max(100_000).optional()
}).strict()

export const visualDocumentRevisionDecisionPayloadSchema = z.object({
  workspaceRoot: trimmedString(MAX_PATH_LENGTH),
  documentId: visualDocumentIdSchema.optional(),
  revisionId: visualDocumentIdSchema
}).strict()

export const scientificPlottingStatusPayloadSchema = z
  .object({
    workspaceRoot: z.string().trim().max(MAX_PATH_LENGTH).optional()
  })
  .strict()

const scientificPlottingCropBoxPayloadSchema = z
  .object({
    unit: z.enum(['ratio', 'pixel']).optional(),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive()
  })
  .strict()

export const scientificPlottingPrepareReferencePayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    sourcePath: trimmedString(MAX_PATH_LENGTH),
    sourceType: z.enum(['image', 'pdf']).optional(),
    page: z.number().int().positive().max(10_000).optional(),
    cropBox: scientificPlottingCropBoxPayloadSchema.optional(),
    figureId: z.string().trim().max(128).optional(),
    outputDir: z.string().trim().max(MAX_PATH_LENGTH).optional(),
    dpi: z.number().int().min(72).max(600).optional(),
    extractStyle: z.boolean().optional()
  })
  .strict()

export const scientificSkillsInstallPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    backend: z.enum(['git', 'npx']).optional(),
    ref: z.string().trim().min(1).max(128).optional()
  })
  .strict()

export const visualStyleExtractPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    sourcePath: trimmedString(MAX_PATH_LENGTH),
    sourceType: z.enum(['image', 'pdf']).optional(),
    sourceKind: z.enum(['reference', 'current']).optional(),
    scope: z.enum(['manuscript', 'workspace', 'artifact']).optional(),
    figureId: z.string().trim().max(128).optional(),
    notes: z.string().trim().max(1_000).optional()
  })
  .strict()

const visualStyleProfileSchema = z.object({
  version: z.literal(1),
  id: z.string().trim().min(1).max(200),
  scope: z.enum(['manuscript', 'workspace', 'artifact']),
  source: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('reference'),
      path: trimmedString(MAX_PATH_LENGTH),
      figureId: z.string().trim().max(128).optional(),
      notes: z.string().trim().max(1_000).optional()
    }).strict(),
    z.object({ type: z.literal('preset'), presetId: trimmedString(200) }).strict(),
    z.object({ type: z.literal('inherited'), profileId: trimmedString(200) }).strict(),
    z.object({ type: z.literal('current'), artifactPath: trimmedString(MAX_PATH_LENGTH).optional() }).strict()
  ]),
  tokens: z.object({
    canvas: z.object({
      width: z.number().finite().positive(),
      height: z.number().finite().positive(),
      aspectRatio: z.number().finite().positive(),
      background: trimmedString(100)
    }).strict(),
    palette: z.object({
      colors: z.array(trimmedString(100)).min(1).max(64),
      background: trimmedString(100),
      ink: trimmedString(100),
      accent: z.array(trimmedString(100)).max(32),
      colorMode: z.enum(['monochrome', 'limited', 'multi-hue'])
    }).strict(),
    typography: z.object({
      fontFamily: trimmedString(200),
      axisSize: z.number().finite().nonnegative(),
      labelSize: z.number().finite().nonnegative(),
      titleSize: z.number().finite().nonnegative(),
      weight: z.enum(['regular', 'medium', 'bold'])
    }).strict(),
    strokes: z.object({
      ink: trimmedString(100),
      primaryWidth: z.number().finite().nonnegative(),
      secondaryWidth: z.number().finite().nonnegative(),
      lineCap: z.enum(['butt', 'round', 'square', 'unknown'])
    }).strict(),
    spacing: z.object({
      margin: z.object({
        left: z.number().finite(),
        right: z.number().finite(),
        top: z.number().finite(),
        bottom: z.number().finite()
      }).strict(),
      gutter: z.enum(['compact', 'balanced', 'spacious']),
      density: z.enum(['sparse', 'balanced', 'dense'])
    }).strict(),
    shapes: z.object({
      fillMode: z.enum(['solid', 'outlined', 'mixed', 'unknown']),
      cornerRadius: z.number().finite().nonnegative().optional(),
      borderWidth: z.number().finite().nonnegative().optional(),
      shadow: z.enum(['none', 'subtle', 'prominent', 'unknown'])
    }).strict(),
    plots: z.object({
      panelGrid: z.string().trim().max(100),
      panelLabels: z.enum(['none', 'A/B/C', 'a/b/c', 'numeric', 'unknown']),
      axes: z.object({
        spine: z.enum(['none', 'left-bottom', 'box', 'minimal', 'unknown']),
        tickDirection: z.enum(['in', 'out', 'none', 'unknown']),
        grid: z.boolean(),
        gridTone: z.enum(['none', 'light', 'medium']),
        gridColor: trimmedString(100),
        gridAlpha: z.number().finite(),
        gridLineWidth: z.number().finite().nonnegative()
      }).strict(),
      marks: z.object({
        lineWidth: z.number().finite().nonnegative(),
        markerSize: z.number().finite().nonnegative(),
        errorBarStyle: z.enum(['none', 'caps', 'unknown']),
        density: z.enum(['sparse', 'balanced', 'dense'])
      }).strict(),
      annotations: z.object({
        significance: z.enum(['none', 'stars', 'brackets', 'unknown']),
        legend: z.enum(['none', 'frameless', 'boxed', 'unknown'])
      }).strict(),
      export: z.object({
        formats: z.array(z.enum(['pdf', 'svg', 'png'])).min(1).max(3),
        dpi: z.number().finite().positive(),
        transparent: z.boolean()
      }).strict()
    }).strict().optional(),
    generatedAssets: z.object({
      visualTreatment: z.enum(['flat', 'illustrative', 'photorealistic', 'mixed', 'unknown']),
      backgroundTreatment: z.enum(['transparent', 'solid', 'textured', 'unknown']),
      edgeTreatment: z.enum(['crisp', 'soft', 'mixed', 'unknown']),
      detailLevel: z.enum(['sparse', 'balanced', 'rich', 'unknown'])
    }).strict().optional()
  }).strict(),
  semanticDescription: z.string().trim().max(4_000),
  confidence: z.object({
    overall: z.number().min(0).max(1),
    palette: z.number().min(0).max(1),
    spacing: z.number().min(0).max(1),
    plots: z.number().min(0).max(1),
    typography: z.number().min(0).max(1),
    generatedAssets: z.number().min(0).max(1)
  }).strict()
}).strict()

export const visualStyleSaveProfilePayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    path: z.string().trim().max(MAX_PATH_LENGTH).optional(),
    profile: visualStyleProfileSchema,
    diagnostics: z.object({
      analyzedAt: z.string().datetime(),
      sampledPixels: z.number().int().nonnegative(),
      foregroundRatio: z.number().min(0).max(1),
      darkPixelRatio: z.number().min(0).max(1),
      chromaRatio: z.number().min(0).max(1),
      warnings: z.array(z.string().trim().max(2_000)).max(100)
    }).strict()
  })
  .strict()

export const pptMasterMcpConfigPayloadSchema = z
  .object({
    workspaceRoot: z.string().trim().max(MAX_PATH_LENGTH).optional()
  })
  .strict()

export const rootPathSchema = trimmedString(MAX_PATH_LENGTH)
export const runtimeConfigContentSchema = z.string().max(MAX_CONFIG_FILE_BYTES)

export const workspaceRootSchema = trimmedString(MAX_PATH_LENGTH)
export const gitBranchPayloadSchema = z
  .object({
    workspaceRoot: workspaceRootSchema,
    branch: trimmedString(MAX_BRANCH_LENGTH)
  })
  .strict()

export const openEditorPathPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
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
    line: z.number().int().positive().max(1_000_000).optional(),
    column: z.number().int().positive().max(1_000_000).optional()
  })
  .strict()

export const workspacePreviewListPluginsPayloadSchema = z.object({}).strict()

export const workspacePreviewOpenPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    mimeType: optionalTrimmedString(MAX_MIME_TYPE_LENGTH),
    mode: z.string().trim().pipe(workspacePreviewModeSchema).optional(),
    line: z.number().int().positive().max(1_000_000).optional(),
    column: z.number().int().positive().max(1_000_000).optional(),
    selection: workspaceStructuredSelectionSchema.optional(),
    anchor: workspacePreviewAnchorSchema.optional(),
    integrity: workspacePreviewIntegrityExpectationSchema.optional()
  })
  .strict()

export const workspacePreviewObservePayloadSchema = z
  .object({
    sessionId: trimmedString(MAX_ID_LENGTH)
  })
  .strict()

export const workspacePreviewReleaseSessionPayloadSchema = z
  .object({
    sessionId: trimmedString(MAX_ID_LENGTH)
  })
  .strict()

export const workspacePreviewDescribeAssetPayloadSchema = z
  .object({
    sessionId: trimmedString(MAX_ID_LENGTH)
  })
  .strict()

export const workspacePreviewReadRangePayloadSchema = z
  .object({
    sessionId: trimmedString(MAX_ID_LENGTH),
    range: workspacePreviewByteRangeSchema
  })
  .strict()

export const workspacePreviewPrepareArtifactPayloadSchema = z
  .object({
    sessionId: trimmedString(MAX_ID_LENGTH),
    request: workspacePreviewPrepareArtifactRequestSchema
  })
  .strict()

export const workspacePreviewReadArtifactRangePayloadSchema = z
  .object({
    sessionId: trimmedString(MAX_ID_LENGTH),
    request: workspacePreviewReadArtifactRangeRequestSchema
  })
  .strict()

export const workspacePreviewApplyEditPayloadSchema = z
  .object({
    sessionId: trimmedString(MAX_ID_LENGTH),
    operation: workspacePreviewEditOperationSchema
  })
  .strict()

const workspacePreviewIpcExportTargetSchema = workspacePreviewExportTargetSchema.refine(
  (target) => target.kind !== 'workspace-file' || Boolean(target.path?.trim()),
  {
    path: ['path'],
    message: 'workspace-file export targets require a path over IPC.'
  }
)

export const workspacePreviewExportPayloadSchema = z
  .object({
    sessionId: trimmedString(MAX_ID_LENGTH),
    target: workspacePreviewIpcExportTargetSchema
  })
  .strict()

export const workspacePreviewInvokeActionPayloadSchema = z
  .object({
    sessionId: trimmedString(MAX_ID_LENGTH),
    action: workspacePreviewPluginActionInputSchema
  })
  .strict()

export const workspaceDirectoryTargetPayloadSchema = z
  .object({
    path: optionalTrimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceFileWritePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    content: z.string().max(MAX_BODY_BYTES).optional(),
    contentBase64: z.string().max(MAX_WORKSPACE_BINARY_BODY_BASE64_CHARS).optional()
  })
  .refine((payload) => payload.content !== undefined || payload.contentBase64 !== undefined, {
    message: 'Either content or contentBase64 is required.'
  })
  .strict()

export const workspaceFileCreatePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    content: z.string().max(MAX_BODY_BYTES).optional()
  })
  .strict()

export const workspaceDirectoryCreatePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceClipboardImageSavePayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    currentFilePath: trimmedString(MAX_PATH_LENGTH),
    imageDirectory: optionalTrimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceClipboardPastePayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    targetDirectory: z.string().trim().max(MAX_PATH_LENGTH),
    conflictPolicy: workspaceFileConflictPolicySchema.optional()
  })
  .strict()

export const workspaceNativeFileDragPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceEntryRenamePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    newName: trimmedString(255)
  })
  .strict()

export const workspaceEntryCopyPayloadSchema = z
  .object({
    sourcePath: trimmedString(MAX_PATH_LENGTH),
    sourceWorkspaceRoot: trimmedString(MAX_PATH_LENGTH),
    targetDirectory: z.string().trim().max(MAX_PATH_LENGTH),
    targetWorkspaceRoot: trimmedString(MAX_PATH_LENGTH),
    conflictPolicy: workspaceFileConflictPolicySchema.optional()
  })
  .strict()

export const workspaceEntryImportPayloadSchema = z
  .object({
    sourcePaths: z.array(trimmedString(MAX_PATH_LENGTH)).min(1).max(512),
    targetDirectory: z.string().trim().max(MAX_PATH_LENGTH),
    targetWorkspaceRoot: trimmedString(MAX_PATH_LENGTH),
    conflictPolicy: workspaceFileConflictPolicySchema.optional()
  })
  .strict()

export const workspaceEntryMovePayloadSchema = z
  .object({
    sourcePath: trimmedString(MAX_PATH_LENGTH),
    sourceWorkspaceRoot: trimmedString(MAX_PATH_LENGTH),
    targetDirectory: z.string().trim().max(MAX_PATH_LENGTH),
    targetWorkspaceRoot: trimmedString(MAX_PATH_LENGTH),
    conflictPolicy: workspaceFileConflictPolicySchema.optional()
  })
  .strict()

export const workspaceEntryDeletePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const workspaceFileWatchPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH)
  })
  .strict()

export const writeExportPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    format: z.enum(WRITE_EXPORT_FORMATS),
    content: z.string().max(MAX_BODY_BYTES),
    threadId: optionalTrimmedString(MAX_ID_LENGTH),
    runtimeId: agentRuntimeIdSchema.optional(),
    evidenceDagGateOverride: z.boolean().optional()
  })
  .strict()

export const writeRichClipboardPayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    content: z.string().max(MAX_BODY_BYTES)
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

export const evidenceDagViewPayloadSchema = z
  .object({
    threadId: optionalTrimmedString(MAX_ID_LENGTH),
    runtimeId: agentRuntimeIdSchema.optional()
  })
  .strict()

export const evidenceDagUpdatePayloadSchema = z
  .object({
    threadId: trimmedString(MAX_ID_LENGTH),
    runtimeId: agentRuntimeIdSchema,
    operation: z.enum(['update', 'rebuild']).optional(),
    rebuildKind: z.enum(['schema_upgrade', 'corruption_recovery', 'reinterpretation']).optional(),
    rebuildRationale: optionalTrimmedString(1000)
  })
  .strict()
  .refine((payload) => payload.operation !== 'rebuild' || Boolean(payload.rebuildKind && payload.rebuildRationale), {
    message: 'rebuildKind and rebuildRationale are required for an explicit rebuild'
  })
  .refine((payload) => payload.operation === 'rebuild' || (!payload.rebuildKind && !payload.rebuildRationale), {
    message: 'rebuild fields are only valid for an explicit rebuild'
  })

export const evidenceDagPriorityPayloadSchema = z
  .object({
    threadId: trimmedString(MAX_ID_LENGTH),
    runtimeId: agentRuntimeIdSchema,
    visible: z.boolean()
  })
  .strict()

export const evidenceDagEvidencePreviewResolvePayloadSchema = z
  .object({
    runtimeId: agentRuntimeIdSchema,
    threadId: trimmedString(MAX_ID_LENGTH),
    snapshotDigest: trimmedString(MAX_ID_LENGTH).regex(/^sha256:[0-9a-f]{64}$/i),
    sourceAssertionId: trimmedString(MAX_ID_LENGTH),
    artifactVersionId: trimmedString(MAX_ID_LENGTH),
    sourceAnchorId: trimmedString(MAX_ID_LENGTH)
  })
  .strict()

const projectDagViewNameSchema = z.enum(['home', 'goals', 'graph', 'attention'])

export const projectDagViewPayloadSchema = z
  .object({
    view: projectDagViewNameSchema.optional(),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    projectRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    project: optionalTrimmedString(MAX_ID_LENGTH),
    sessions: z.array(trimmedString(MAX_ID_LENGTH)).max(500).optional()
  })
  .strict()

const dagAutonomyModeSchema = z.enum(['autonomous', 'checkpointed', 'supervised'])

export const projectDagUpdatePayloadSchema = z
  .object({
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    projectRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    project: optionalTrimmedString(MAX_ID_LENGTH),
    sessions: z.array(trimmedString(MAX_ID_LENGTH)).max(500).optional(),
    scope: z.union([
      z.literal('all'),
      z.array(trimmedString(MAX_ID_LENGTH)).max(500)
    ]).optional(),
    excludedSessions: z.array(trimmedString(MAX_ID_LENGTH)).max(500).optional(),
    isolatedSessions: z.array(trimmedString(MAX_ID_LENGTH)).max(500).optional(),
    autonomyMode: dagAutonomyModeSchema.optional()
  })
  .strict()

export const projectDagGoalSavePayloadSchema = z
  .object({
    title: trimmedString(500),
    description: optionalTrimmedString(4000),
    rootGoalId: optionalTrimmedString(MAX_ID_LENGTH),
    workspaceRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    projectRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    project: optionalTrimmedString(MAX_ID_LENGTH),
    sessions: z.array(trimmedString(MAX_ID_LENGTH)).max(500).optional(),
    autonomyMode: dagAutonomyModeSchema.optional()
  })
  .strict()

export const projectDagEvidencePreviewResolvePayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    projectRoot: optionalTrimmedString(MAX_PATH_LENGTH),
    project: optionalTrimmedString(MAX_ID_LENGTH),
    snapshotDigest: trimmedString(MAX_ID_LENGTH),
    claimId: trimmedString(MAX_ID_LENGTH),
    artifactVersionId: trimmedString(MAX_ID_LENGTH),
    sourceAnchorId: trimmedString(MAX_ID_LENGTH)
  })
  .strict()

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

export const remoteChannelMirrorPayloadSchema = z
  .object({
    threadId: trimmedString(MAX_ID_LENGTH),
    text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    direction: z.enum(['user', 'assistant'])
  })
  .strict()

export const remoteChannelActiveThreadContextPayloadSchema = z
  .object({
    threadId: trimmedString(MAX_ID_LENGTH),
    runtimeId: agentRuntimeIdSchema.optional(),
    workspaceRoot: defaultPathSchema.optional()
  })
  .strict()
  .nullable()

export const remoteChannelTaskFromTextPayloadSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    channelId: z.string().trim().min(1).max(MAX_ID_LENGTH).nullable().optional(),
    modelHint: z.string().trim().min(1).max(128).nullable().optional(),
    mode: z.enum(['agent', 'plan']).nullable().optional()
  })
  .strict()

export const discordConfigureTokenPayloadSchema = z
  .object({
    token: z.string().trim().min(20).max(4_096),
    clientId: z.string().trim().max(MAX_ID_LENGTH).optional()
  })
  .strict()

export const discordConfigureClientPayloadSchema = z
  .object({
    clientId: trimmedString(MAX_ID_LENGTH)
  })
  .strict()

export const discordConfigureProxyPayloadSchema = z
  .object({
    proxyUrl: z.string().trim().max(2_048)
  })
  .strict()

export const discordGuildChannelsPayloadSchema = z
  .object({
    guildId: trimmedString(MAX_ID_LENGTH)
  })
  .strict()

export const discordBindChannelPayloadSchema = z
  .object({
    channelConfigId: z.string().trim().max(MAX_ID_LENGTH).optional(),
    guildId: trimmedString(MAX_ID_LENGTH),
    guildName: z.string().trim().max(512).optional(),
    channelId: trimmedString(MAX_ID_LENGTH),
    channelName: z.string().trim().max(512).optional(),
    enabled: z.boolean().optional(),
    workspaceRoot: defaultPathSchema,
    model: z.union([z.enum(REMOTE_CHANNEL_MODEL_IDS), trimmedString(128)]).optional(),
    runtimeId: agentRuntimeIdSchema.optional(),
    agentProfile: remoteChannelAgentProfilePatchSchema.optional()
  })
  .strict()

export const discordTestSendPayloadSchema = z
  .object({
    channelId: trimmedString(MAX_ID_LENGTH),
    text: z.string().trim().min(1).max(2_000).optional(),
    channelConfigId: z.string().trim().max(MAX_ID_LENGTH).optional()
  })
  .strict()

export const discordSetGuardPayloadSchema = z
  .object({
    enabled: z.boolean(),
    channelConfigId: z.string().trim().max(MAX_ID_LENGTH).optional(),
    forceTakeover: z.boolean().optional()
  })
  .strict()

export const zulipConfigurePayloadSchema = z
  .object({
    realmUrl: z.string().trim().min(1).max(MAX_URL_LENGTH),
    botEmail: z.string().trim().min(3).max(512),
    apiKey: z.string().trim().min(8).max(4_096)
  })
  .strict()

export const zulipStreamTopicsPayloadSchema = z
  .object({
    streamId: trimmedString(MAX_ID_LENGTH)
  })
  .strict()

export const zulipBindChannelPayloadSchema = z
  .object({
    channelConfigId: z.string().trim().max(MAX_ID_LENGTH).optional(),
    streamId: trimmedString(MAX_ID_LENGTH),
    streamName: z.string().trim().max(512).optional(),
    topicName: z.string().trim().max(512).optional(),
    enabled: z.boolean().optional(),
    workspaceRoot: defaultPathSchema,
    model: z.union([z.enum(REMOTE_CHANNEL_MODEL_IDS), trimmedString(128)]).optional(),
    runtimeId: agentRuntimeIdSchema.optional(),
    agentProfile: remoteChannelAgentProfilePatchSchema.optional()
  })
  .strict()

export const zulipTestSendPayloadSchema = z
  .object({
    channelId: trimmedString(MAX_ID_LENGTH),
    topicName: z.string().trim().max(512).optional(),
    text: z.string().trim().min(1).max(10_000).optional(),
    channelConfigId: z.string().trim().max(MAX_ID_LENGTH).optional()
  })
  .strict()

export const zulipSetGuardPayloadSchema = z
  .object({
    enabled: z.boolean(),
    channelConfigId: z.string().trim().max(MAX_ID_LENGTH).optional(),
    forceTakeover: z.boolean().optional()
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

export const connectPhoneInstallQrPayloadSchema = z
  .object({
    provider: connectPhoneInstallProviderSchema,
    isLark: z.boolean().optional()
  })
  .strict()

export const connectPhoneInstallPollPayloadSchema = z
  .object({
    provider: connectPhoneInstallProviderSchema,
    deviceCode: trimmedString(MAX_DEVICE_CODE_LENGTH)
  })
  .strict()

export const streamIdSchema = trimmedString(MAX_ID_LENGTH)
