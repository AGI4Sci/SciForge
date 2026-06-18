import { z } from 'zod'
import {
  CLAW_MODEL_IDS,
  MODEL_ENDPOINT_FORMATS,
  SCHEDULE_MODEL_IDS,
  SCHEDULE_REASONING_EFFORT_IDS,
  SPEECH_TO_TEXT_PROTOCOLS,
  WRITE_INLINE_COMPLETION_MODEL_IDS
} from '../../shared/app-settings'
import { DESKTOP_COMMANDS } from '../../shared/ds-gui-api'
import { GUI_UPDATE_CHANNELS } from '../../shared/gui-update'
import { KEYBOARD_SHORTCUT_COMMANDS } from '../../shared/keyboard-shortcuts'
import {
  SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS,
  SPEECH_TRANSCRIPTION_MAX_DURATION_MS
} from '../../shared/speech-to-text'
import { WRITE_EXPORT_FORMATS } from '../../shared/write-export'

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
const MAX_DEVICE_CODE_LENGTH = 8_192
const MAX_EDITOR_COMPLETION_TEXT = 200_000
const MAX_MIME_TYPE_LENGTH = 128

const SAFE_OPEN_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function trimmedString(max: number): z.ZodString {
  return z.string().trim().min(1).max(max)
}

function optionalTrimmedString(max: number): z.ZodOptional<z.ZodString> {
  return z.string().trim().max(max).optional()
}

export function isSafeOpenExternalUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return SAFE_OPEN_EXTERNAL_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}

export const defaultPathSchema = optionalTrimmedString(MAX_PATH_LENGTH)

const localeSchema = z.enum(['en', 'zh'])
const themeSchema = z.enum(['system', 'light', 'dark'])
const uiFontScaleSchema = z.enum(['small', 'medium', 'large'])
const agentRuntimeIdSchema = z.enum(['kun', 'codex'])
const agentRuntimeThreadRelationSchema = z.string().trim().pipe(z.enum(['primary', 'fork', 'side']))
const agentRuntimeUsageGroupBySchema = z.string().trim().pipe(z.enum(['day', 'model', 'thread']))
const agentRuntimeAuxiliaryOperationSchema = z.enum([
  'reviewThread',
  'getRuntimeInfo',
  'getToolDiagnostics',
  'listSkills',
  'uploadAttachment',
  'getAttachmentContent',
  'listMemories',
  'updateMemory',
  'deleteMemory',
  'updateThreadWorkspace',
  'archiveThread',
  'getThreadGoal',
  'setThreadGoal',
  'clearThreadGoal',
  'getThreadTodos',
  'setThreadTodos',
  'clearThreadTodos',
  'cancelUserInput'
])
const agentRuntimeAuxiliaryPayloadRecordSchema = z.record(z.string(), z.unknown()).optional()
const approvalPolicySchema = z.enum(['on-request', 'untrusted', 'never', 'auto', 'suggest'])
const sandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access', 'external-sandbox'])
const mcpSearchModeSchema = z.enum(['direct', 'search', 'auto'])
const kunStorageBackendSchema = z.enum(['hybrid', 'file'])
const kunCompactionSummaryModeSchema = z.enum(['heuristic', 'model'])
const clawRunModeSchema = z.enum(['agent', 'plan'])
const clawImProviderSchema = z.enum(['feishu', 'weixin', 'discord'])
const clawImChannelGuardModeSchema = z.enum(['only_mention', 'all_messages', 'off'])
const clawImOfficialInstallProviderSchema = z.enum(['feishu', 'weixin'])
const clawScheduleKindSchema = z.enum(['manual', 'interval', 'daily', 'at'])
const clawTaskStatusSchema = z.enum(['idle', 'running', 'success', 'error'])
const clawModelSchema = z.enum(CLAW_MODEL_IDS)
const scheduleReasoningEffortSchema = z.enum(SCHEDULE_REASONING_EFFORT_IDS)
const speechToTextProtocolSchema = z.enum(SPEECH_TO_TEXT_PROTOCOLS)
const paperRadarSourceSchema = z.enum(['arxiv', 'biorxiv'])
const writeInlineCompletionModelSchema = z.union([
  z.enum(WRITE_INLINE_COMPLETION_MODEL_IDS),
  trimmedString(128)
])
const modelEndpointFormatSchema = z.enum(MODEL_ENDPOINT_FORMATS)
const agentThreadIdsSchema = z.object({
  kun: z.string().max(MAX_ID_LENGTH).optional(),
  codex: z.string().max(MAX_ID_LENGTH).optional()
}).strict()
const agentRuntimeGovernanceProfileSchema = z.enum(['default', 'write', 'remote_guard'])
const agentRuntimeFileReferenceSchema = z.object({
  path: trimmedString(MAX_PATH_LENGTH),
  relativePath: trimmedString(MAX_PATH_LENGTH),
  name: trimmedString(512),
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
  summary: z.boolean().optional()
}).strict()

export const agentRuntimeStartThreadPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  workspace: defaultPathSchema,
  title: z.string().trim().max(200).optional(),
  mode: z.string().trim().max(64).optional(),
  model: z.string().trim().max(128).optional()
}).strict()

export const agentRuntimeReadThreadPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  threadId: trimmedString(MAX_ID_LENGTH)
}).strict()

export const agentRuntimeStartTurnPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  threadId: trimmedString(MAX_ID_LENGTH),
  text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
  workspace: defaultPathSchema,
  mode: z.string().trim().max(64).optional(),
  model: z.string().trim().max(128).optional(),
  reasoningEffort: z.string().trim().max(64).optional(),
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
  runtimeId: agentRuntimeIdSchema.optional(),
  threadId: trimmedString(MAX_ID_LENGTH),
  turnId: trimmedString(MAX_ID_LENGTH),
  discard: z.boolean().optional()
}).strict()

export const agentRuntimeTurnSteerPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  threadId: trimmedString(MAX_ID_LENGTH),
  turnId: trimmedString(MAX_ID_LENGTH),
  text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH)
}).strict()

export const agentRuntimeEventSubscribePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  threadId: trimmedString(MAX_ID_LENGTH),
  sinceSeq: z.number().int().nonnegative().optional(),
  streamId: optionalTrimmedString(MAX_ID_LENGTH)
}).strict()

export const agentRuntimeThreadRenamePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  threadId: trimmedString(MAX_ID_LENGTH),
  title: z.string().trim().min(1).max(200)
}).strict()

export const agentRuntimeThreadDeletePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  threadId: trimmedString(MAX_ID_LENGTH)
}).strict()

export const agentRuntimeThreadCompactPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  threadId: trimmedString(MAX_ID_LENGTH),
  reason: z.string().trim().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

export const agentRuntimeThreadForkPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  threadId: trimmedString(MAX_ID_LENGTH),
  relation: agentRuntimeThreadRelationSchema.optional(),
  title: z.string().trim().max(200).optional()
}).strict()

export const agentRuntimeSessionResumePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  sessionId: trimmedString(MAX_ID_LENGTH),
  model: z.string().trim().max(128).optional(),
  mode: z.string().trim().max(64).optional()
}).strict()

export const agentRuntimeThreadRelationPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
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

export const agentRuntimeAuxiliaryPayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  operation: agentRuntimeAuxiliaryOperationSchema,
  payload: agentRuntimeAuxiliaryPayloadRecordSchema
}).strict()

export const agentRuntimeApprovalResolvePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
  threadId: trimmedString(MAX_ID_LENGTH),
  approvalId: trimmedString(MAX_ID_LENGTH),
  decision: z.enum(['allowed', 'denied']),
  message: z.string().trim().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

export const agentRuntimeUserInputResolvePayloadSchema = z.object({
  runtimeId: agentRuntimeIdSchema.optional(),
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
  maxRecords: z.number().int().positive().max(2000).optional()
}).strict()

export const paperRadarBiorxivSyncPayloadSchema = z.object({
  from: z.string().trim().max(64).optional(),
  to: z.string().trim().max(64).optional(),
  maxRecords: z.number().int().positive().max(2000).optional()
}).strict()

export const paperRadarProfileSyncPayloadSchema = z.object({
  profile: z.string().trim().max(128).optional(),
  from: z.string().trim().max(64).optional(),
  to: z.string().trim().max(64).optional(),
  maxRecords: z.number().int().positive().max(2000).optional()
}).strict()

export const paperRadarSearchPayloadSchema = z.object({
  query: z.string().trim().max(1000).optional(),
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

const modelProviderPatchSchema = z.object({
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  providers: z.array(z.object({
    id: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    apiKey: z.string().max(MAX_BODY_BYTES).optional(),
    baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
    endpointFormat: modelEndpointFormatSchema.optional(),
    models: z.array(z.string().trim().min(1).max(128)).max(200).optional()
  }).strict()).max(50).optional()
}).strict()

const modelRouterMemberProviderPatchSchema = z.object({
  provider: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  model: z.string().trim().max(128).optional()
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
      translators: z.object({
        vision: modelRouterMemberProviderPatchSchema.optional()
      }).strict().optional()
    }).strict().optional()
  }).strict().optional()
}).strict()

const kunRuntimePatchSchema = z.object({
  binaryPath: defaultPathSchema,
  port: z.number().int().min(1).max(65_535).optional(),
  autoStart: z.boolean().optional(),
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  providerId: z.string().trim().max(64).optional(),
  endpointFormat: modelEndpointFormatSchema.optional(),
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
    backend: kunStorageBackendSchema.optional(),
    sqlitePath: defaultPathSchema
  }).strict().optional(),
  contextCompaction: z.object({
    defaultSoftThreshold: z.number().int().positive().optional(),
    defaultHardThreshold: z.number().int().positive().optional(),
    summaryMode: kunCompactionSummaryModeSchema.optional(),
    summaryTimeoutMs: z.number().int().positive().max(120_000).optional(),
    summaryMaxTokens: z.number().int().positive().max(16_000).optional(),
    summaryInputMaxBytes: z.number().int().positive().max(8 * 1024 * 1024).optional()
  }).strict().optional(),
  runtimeTuning: z.object({
    toolArgumentRepair: z.object({
      maxStringBytes: z.number().int().positive().max(16 * 1024 * 1024).optional()
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
    softThreshold: z.number().int().min(2).max(128).optional(),
    hardThreshold: z.number().int().min(2).max(256).optional()
  }).strict().optional(),
  budgets: z.object({
    defaultMaxToolEvents: z.number().int().positive().max(10_000).optional(),
    writeMaxToolEvents: z.number().int().positive().max(10_000).optional(),
    remoteGuardMaxToolEvents: z.number().int().positive().max(10_000).optional()
  }).strict().optional()
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
  apiKey: z.string().max(MAX_BODY_BYTES).optional(),
  baseUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  inheritModel: z.boolean().optional(),
  model: writeInlineCompletionModelSchema.optional(),
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

const clawSkillPatchSchema = z.object({
  defaultNames: z.array(trimmedString(128)).max(128).optional(),
  extraDirs: z.array(trimmedString(MAX_PATH_LENGTH)).max(128).optional(),
  promptPrefix: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

const clawImPatchSchema = z.object({
  enabled: z.boolean().optional(),
  provider: clawImProviderSchema.optional(),
  port: z.number().int().min(1024).max(65_535).optional(),
  path: trimmedString(MAX_PATH_LENGTH).optional(),
  secret: z.string().max(MAX_BODY_BYTES).optional(),
  weixinBridgeUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  openClawGatewayUrl: z.string().trim().max(MAX_URL_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  model: z.string().trim().min(1).max(128).optional(),
  mode: clawRunModeSchema.optional(),
  responseTimeoutMs: z.number().int().min(5_000).max(600_000).optional()
}).strict()

const clawImAgentProfilePatchSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2_000).optional(),
  identity: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  personality: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  userContext: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  replyRules: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

const clawImPlatformCredentialPatchSchema = z.union([
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
  }).strict()
])

const clawImRemoteSessionPatchSchema = z.object({
  chatId: z.string().max(MAX_ID_LENGTH).optional(),
  messageId: z.string().max(MAX_ID_LENGTH).optional(),
  threadId: z.string().max(MAX_ID_LENGTH).optional(),
  senderId: z.string().max(MAX_ID_LENGTH).optional(),
  senderName: z.string().max(512).optional(),
  updatedAt: z.string().max(128).optional()
}).strict()

const clawImRecentMessagePatchSchema = z.object({
  provider: clawImProviderSchema.optional(),
  channelId: z.string().max(MAX_ID_LENGTH).optional(),
  chatId: z.string().max(MAX_ID_LENGTH).optional(),
  remoteThreadId: z.string().max(MAX_ID_LENGTH).optional(),
  messageId: z.string().max(MAX_ID_LENGTH).optional(),
  senderName: z.string().max(512).optional(),
  text: z.string().max(2_000).optional(),
  receivedAt: z.string().max(128).optional()
}).strict()

const clawImConversationPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  chatId: z.string().max(MAX_ID_LENGTH).optional(),
  remoteThreadId: z.string().max(MAX_ID_LENGTH).optional(),
  latestMessageId: z.string().max(MAX_ID_LENGTH).optional(),
  senderId: z.string().max(MAX_ID_LENGTH).optional(),
  senderName: z.string().max(512).optional(),
  localThreadId: z.string().max(MAX_ID_LENGTH).optional(),
  runtimeId: agentRuntimeIdSchema.optional(),
  agentThreadIds: agentThreadIdsSchema.optional(),
  workspaceRoot: defaultPathSchema,
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional()
}).strict()

const clawImChannelPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  provider: clawImProviderSchema.optional(),
  label: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  guardMode: clawImChannelGuardModeSchema.optional(),
  model: z.string().trim().min(1).max(128).optional(),
  threadId: z.string().max(MAX_ID_LENGTH).optional(),
  runtimeId: agentRuntimeIdSchema.optional(),
  agentThreadIds: agentThreadIdsSchema.optional(),
  workspaceRoot: defaultPathSchema,
  agentProfile: clawImAgentProfilePatchSchema.optional(),
  platformCredential: clawImPlatformCredentialPatchSchema.optional(),
  remoteSession: clawImRemoteSessionPatchSchema.optional(),
  conversations: z.array(clawImConversationPatchSchema).max(512).optional(),
  recentMessages: z.array(clawImRecentMessagePatchSchema).max(2_000).optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional()
}).strict()

const clawTaskSchedulePatchSchema = z.object({
  kind: clawScheduleKindSchema.optional(),
  everyMinutes: z.number().int().min(1).max(10_080).optional(),
  timeOfDay: z.string().max(16).optional(),
  atTime: z.string().max(128).optional()
}).strict()

const clawTaskPatchSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  title: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  prompt: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  workspaceRoot: defaultPathSchema,
  model: z.string().trim().min(1).max(128).optional(),
  reasoningEffort: scheduleReasoningEffortSchema.optional(),
  mode: clawRunModeSchema.optional(),
  runtimeId: agentRuntimeIdSchema.optional(),
  agentThreadIds: agentThreadIdsSchema.optional(),
  schedule: clawTaskSchedulePatchSchema.optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional(),
  lastRunAt: z.string().max(128).optional(),
  nextRunAt: z.string().max(128).optional(),
  lastStatus: clawTaskStatusSchema.optional(),
  lastMessage: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  lastThreadId: z.string().max(MAX_ID_LENGTH).optional()
}).strict()

const clawSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  skills: clawSkillPatchSchema.optional(),
  im: clawImPatchSchema.optional(),
  channels: z.array(clawImChannelPatchSchema).max(512).optional(),
  tasks: z.array(clawTaskPatchSchema).max(512).optional()
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
  kind: clawScheduleKindSchema.optional(),
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
  mode: clawRunModeSchema.optional(),
  runtimeId: agentRuntimeIdSchema.optional(),
  agentThreadIds: agentThreadIdsSchema.optional(),
  schedule: scheduledTaskSchedulePatchSchema.optional(),
  createdAt: z.string().max(128).optional(),
  updatedAt: z.string().max(128).optional(),
  lastRunAt: z.string().max(128).optional(),
  nextRunAt: z.string().max(128).optional(),
  lastStatus: clawTaskStatusSchema.optional(),
  lastMessage: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  lastThreadId: z.string().max(MAX_ID_LENGTH).optional()
}).strict()

const scheduleSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  defaultWorkspaceRoot: defaultPathSchema,
  model: z.union([z.enum(SCHEDULE_MODEL_IDS), trimmedString(128)]).optional(),
  mode: clawRunModeSchema.optional(),
  promptPrefix: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional(),
  skills: scheduleSkillPatchSchema.optional(),
  keepAwake: z.boolean().optional(),
  internal: scheduleInternalPatchSchema.optional(),
  tasks: z.array(scheduledTaskPatchSchema).max(512).optional()
}).strict()

function stripLegacySettingsPatchKeys(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload
  const source = payload as Record<string, unknown>
  const next: Record<string, unknown> = { ...source }

  delete next.agentProvider
  delete next.deepseek
  delete next.reasonix
  delete next.quickChat

  if (typeof next.agents === 'object' && next.agents !== null && !Array.isArray(next.agents)) {
    const agents = { ...(next.agents as Record<string, unknown>) }
    delete agents.codewhale
    delete agents.reasonix
    delete agents.quickChat
    next.agents = agents
  }

  return next
}

const settingsPatchObjectSchema = z.object({
  version: z.literal(1).optional(),
  installationId: z.string().max(128).optional(),
  locale: localeSchema.optional(),
  theme: themeSchema.optional(),
  uiFontScale: uiFontScaleSchema.optional(),
  provider: modelProviderPatchSchema.optional(),
  modelRouter: modelRouterPatchSchema.optional(),
  runtimeGuards: runtimeGuardPatchSchema.optional(),
  activeAgentRuntime: agentRuntimeIdSchema.optional(),
  agents: z.object({
    kun: kunRuntimePatchSchema.optional(),
    codex: codexRuntimePatchSchema.optional()
  }).strict().optional(),
  workspaceRoot: defaultPathSchema,
  log: logPatchSchema.optional(),
  notifications: notificationsPatchSchema.optional(),
  appBehavior: appBehaviorPatchSchema.optional(),
  keyboardShortcuts: keyboardShortcutsPatchSchema.optional(),
  write: writeSettingsPatchSchema.optional(),
  speechToText: speechToTextPatchSchema.optional(),
  claw: clawSettingsPatchSchema.optional(),
  schedule: scheduleSettingsPatchSchema.optional(),
  guiUpdate: z.object({
    channel: z.enum(GUI_UPDATE_CHANNELS).optional()
  }).strict().optional(),
  codePromptPrefix: z.string().max(MAX_CHANNEL_TEXT_LENGTH).optional()
}).strict()

export const settingsPatchSchema = z.preprocess(stripLegacySettingsPatchKeys, settingsPatchObjectSchema)

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

export const rootPathSchema = trimmedString(MAX_PATH_LENGTH)
export const deepseekConfigContentSchema = z.string().max(MAX_CONFIG_FILE_BYTES)

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
    column: z.number().int().positive().max(1_000_000).optional()
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
    content: z.string().max(MAX_BODY_BYTES)
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

export const workspaceEntryRenamePayloadSchema = z
  .object({
    path: trimmedString(MAX_PATH_LENGTH),
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    newName: trimmedString(255)
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
    content: z.string().max(MAX_BODY_BYTES)
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
    recentEdits: z.array(writeInlineEditRecentEditSchema).max(12).optional(),
    model: optionalTrimmedString(128)
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
    baseUrl: z.string().trim().max(MAX_URL_LENGTH),
    apiKey: z.string().max(MAX_BODY_BYTES),
    model: z.string().trim().max(128),
    language: z.string().trim().max(64).optional(),
    timeoutMs: z.number().int().min(5_000).max(600_000)
  })
  .strict()

export const speechTranscriptionPayloadSchema = z
  .object({
    audioBase64: z.string().min(1).max(SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS),
    mimeType: z.string().trim().min(1).max(MAX_MIME_TYPE_LENGTH),
    durationMs: z.number().int().positive().max(SPEECH_TRANSCRIPTION_MAX_DURATION_MS).optional(),
    speechToText: speechToTextSettingsPayloadSchema.optional()
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


export const logErrorPayloadSchema = z
  .object({
    category: trimmedString(128),
    message: trimmedString(2_000),
    detail: z.unknown().optional()
  })
  .strict()

export const clawMirrorPayloadSchema = z
  .object({
    threadId: trimmedString(MAX_ID_LENGTH),
    text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    direction: z.enum(['user', 'assistant'])
  })
  .strict()

export const clawActiveThreadContextPayloadSchema = z
  .object({
    threadId: trimmedString(MAX_ID_LENGTH),
    runtimeId: agentRuntimeIdSchema.optional(),
    workspaceRoot: defaultPathSchema.optional()
  })
  .strict()
  .nullable()

export const clawTaskFromTextPayloadSchema = z
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
    model: z.union([z.enum(CLAW_MODEL_IDS), trimmedString(128)]).optional(),
    runtimeId: agentRuntimeIdSchema.optional(),
    agentProfile: clawImAgentProfilePatchSchema.optional()
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

export const scheduleTaskFromTextPayloadSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_CHANNEL_TEXT_LENGTH),
    workspaceRoot: defaultPathSchema,
    modelHint: z.string().trim().min(1).max(128).nullable().optional(),
    mode: z.enum(['agent', 'plan']).nullable().optional()
  })
  .strict()

export const clawImInstallPollPayloadSchema = z
  .object({
    provider: clawImOfficialInstallProviderSchema,
    deviceCode: trimmedString(MAX_DEVICE_CODE_LENGTH)
  })
  .strict()

export const streamIdSchema = trimmedString(MAX_ID_LENGTH)
