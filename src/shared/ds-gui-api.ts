import type {
  AppSettingsPatch,
  AppSettingsV1,
  AgentRuntimeId,
  ClawImAgentProfileV1,
  ClawRunResult,
  ClawTaskFromTextResult,
  ClawRuntimeStatus,
  ScheduleRunResult,
  ScheduleRuntimeStatus,
  ScheduleTaskFromTextResult
} from './app-settings'
import type { EditorListResult, EditorOpenResult, OpenEditorPathOptions } from './editor'
import type { GitBranchesResult } from './git-branches'
import type {
  GuiUpdateChannel,
  GuiUpdateDownloadResult,
  GuiUpdateInfo,
  GuiUpdateInstallResult,
  GuiUpdateState
} from './gui-update'
import type {
  ClipboardImageReadResult,
  WorkspaceClipboardImageSavePayload,
  WorkspaceClipboardImageSaveResult,
  WorkspaceFileReadResult,
  WorkspaceImageReadResult,
  WorkspaceDirectoryCreatePayload,
  WorkspaceDirectoryCreateResult,
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceEntryRenamePayload,
  WorkspaceEntryRenameResult,
  WorkspaceEntryDeletePayload,
  WorkspaceEntryDeleteResult,
  WorkspaceFileChangePayload,
  WorkspaceFileCreatePayload,
  WorkspaceFileCreateResult,
  WorkspaceFileResolveResult,
  WorkspaceFileTarget,
  WorkspaceFileWatchPayload,
  WorkspaceFileWatchResult,
  WorkspaceFileWritePayload,
  WorkspaceFileWriteResult
} from './workspace-file'
import type {
  WriteInlineCompletionDebugEntry,
  WriteInlineCompletionRequest,
  WriteInlineCompletionResult
} from './write-inline-completion'
import type {
  WriteRetrievalRequest,
  WriteRetrievalResult
} from './write-retrieval'
import type {
  WriteExportPayload,
  WriteExportResult,
  WriteRichClipboardPayload,
  WriteRichClipboardResult
} from './write-export'
import type {
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeThreadRelation,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeThreadListInput,
  AgentRuntimeThreadReadInput,
  AgentRuntimeThreadStartInput,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput,
  AgentRuntimeTurnSteerInput,
  AgentRuntimeTurnTargetInput,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from './agent-runtime-contract'
import type {
  SpeechTranscriptionRequest,
  SpeechTranscriptionResult
} from './speech-to-text'
import type {
  FigureStyleExtractRequest,
  FigureStyleExtractResult,
  FigureStyleReviewRequest,
  FigureStyleReviewResult,
  FigureStyleSimilarityRequest,
  FigureStyleSimilarityResult
} from './figure-style'
import type {
  ScientificPlottingPrepareReferenceRequest,
  ScientificPlottingPrepareReferenceResult,
  ScientificPlottingStatusResult
} from './scientific-plotting'

export type WorkspacePickResult = { canceled: boolean; path: string | null }
export type PathOpenResult = { ok: boolean; message?: string }
export type AgentRuntimeEventSubscribeInput = {
  runtimeId?: AgentRuntimeThreadListInput['runtimeId']
  threadId: string
  sinceSeq?: number
  streamId?: string
}
export type AgentRuntimeThreadRenameInput = {
  runtimeId?: AgentRuntimeThreadListInput['runtimeId']
  threadId: string
  title: string
}
export type AgentRuntimeThreadDeleteInput = {
  runtimeId?: AgentRuntimeThreadListInput['runtimeId']
  threadId: string
}
export type AgentRuntimeThreadCompactInput = {
  runtimeId?: AgentRuntimeThreadListInput['runtimeId']
  threadId: string
  reason?: string
}
export type AgentRuntimeThreadForkInput = {
  runtimeId?: AgentRuntimeThreadListInput['runtimeId']
  threadId: string
  relation?: AgentRuntimeThreadRelation
  title?: string
}
export type AgentRuntimeSessionResumeInput = {
  runtimeId?: AgentRuntimeThreadListInput['runtimeId']
  sessionId: string
  model?: string
  mode?: string
}
export type AgentRuntimeSessionResumeHandle = {
  threadId: string
  sessionId: string
}
export type AgentRuntimeThreadRelationInput = {
  runtimeId?: AgentRuntimeThreadListInput['runtimeId']
  threadId: string
  relation: AgentRuntimeThreadRelation
}
export type AgentRuntimeApprovalResolveInput = {
  runtimeId?: AgentRuntimeThreadListInput['runtimeId']
  threadId: string
  approvalId: string
  decision: 'allowed' | 'denied'
  message?: string
}
export type AgentRuntimeUserInputResolveInput = {
  runtimeId?: AgentRuntimeThreadListInput['runtimeId']
  threadId: string
  requestId: string
  answers: Array<{ id: string; label?: string; value: string }>
}
export type AgentRuntimeEventPayload = {
  streamId: string
  event: AgentRuntimeEvent
}
export type AgentRuntimeEventEndPayload = {
  streamId: string
}
export type AgentRuntimeEventErrorPayload = {
  streamId: string
  message?: string
}
export const DESKTOP_COMMANDS = [
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'selectAll',
  'reload',
  'zoomIn',
  'zoomOut',
  'resetZoom',
  'toggleDevTools',
  'minimize',
  'toggleMaximize',
  'close',
  'quit'
] as const
export type DesktopCommand = typeof DESKTOP_COMMANDS[number]
export type SkillSaveResult = { ok: true; path: string } | { ok: false; message: string }
export type SkillListItem = {
  id: string
  name: string
  description?: string
  root: string
  entryPath: string
  scope: 'project' | 'global'
  legacy: boolean
}
export type SkillListResult =
  | { ok: true; skills: SkillListItem[]; validationErrors: Array<{ root: string; message: string }> }
  | { ok: false; message: string }
export type DeepseekConfigFileResult = { path: string; content: string; exists: boolean }
export type DeepseekConfigSaveResult = { ok: true; path: string }
export type ScientificSkillsMcpConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; message: string }
export type ScientificPlottingMcpConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; message: string }
export type ScientificSkillsInstallRequest = {
  workspaceRoot: string
  backend?: 'git' | 'npx'
  ref?: string
}
export type ScientificSkillsInstallResult =
  | {
      ok: true
      status: 'installed' | 'already_installed'
      backend: 'git' | 'npx'
      targetPath: string
      commit?: string
      provenancePath?: string
      stdoutTail?: string
      stderrTail?: string
    }
  | {
      ok: false
      status:
        | 'invalid_workspace'
        | 'invalid_existing_target'
        | 'clone_failed'
        | 'verification_failed'
        | 'npx_failed'
        | 'not_discovered_after_npx'
        | 'unexpected_error'
      backend?: 'git' | 'npx'
      targetPath?: string
      message: string
      stdoutTail?: string
      stderrTail?: string
    }
export type ScientificSkillsStatusResult =
  | {
      ok: true
      installed: boolean
      skillCount: number
      fingerprint: string
      indexedAt: string
      roots: Array<{
        path: string
        source: string
        exists: boolean
        skillCount: number
        error?: string
      }>
      validationErrors: Array<{ path: string; message: string }>
      plottingPack: {
        total: number
        installed: number
        missing: number
        items: Array<{
          skillId: string
          label: string
          installed: boolean
          name?: string
          description?: string
          entryPath?: string
          dependencyRisk?: string
          validationErrors: string[]
        }>
      }
      installHint?: string
      onDemandPolicy: {
        mode: 'manual-approval'
        summary: string
      }
    }
  | { ok: false; message: string }
export type ModelRouterConfigOpenResult =
  | { ok: true; path: string }
  | { ok: false; path: string; message: string }
export type TurnCompleteNotificationPayload = {
  threadId?: string
  title: string
  body: string
}
export type SystemNotificationResult =
  | { ok: true; shown: boolean; reason?: string }
  | { ok: false; message: string }
export type ClawChannelActivityPayload = {
  channelId: string
  threadId: string
  runtimeId?: AgentRuntimeId
  previousThreadId?: string
}
export type ClawActiveThreadContextPayload = {
  threadId: string
  runtimeId?: AgentRuntimeId
  workspaceRoot?: string
}
export type ClawChannelMirrorResult =
  | { ok: true }
  | { ok: false; message: string }
export type UpstreamModelsResult =
  | { ok: true; modelIds: string[]; modelGroups?: ModelProviderModelGroup[] }
  | { ok: false; message: string }
export type ModelProviderModelGroup = {
  providerId: string
  label: string
  modelIds: string[]
}
export type ClawImInstallQrResult =
  | { ok: true; url: string; deviceCode: string; userCode: string; interval: number; expireIn: number }
  | { ok: false; message: string }
export type ClawImInstallPollResult =
  | { done: true; kind: 'feishu'; appId: string; appSecret: string; domain: string }
  | { done: true; kind: 'weixin'; accountId: string; sessionKey: string }
  | { done: false; error?: string }
export type DiscordBotInfo = {
  applicationId: string
  botId: string
  botUsername: string
  inviteUrl: string
}
export type DiscordGuild = {
  id: string
  name: string
}
export type DiscordChannel = {
  id: string
  name: string
  type: number
}
export type DiscordGuardConflictStatus = {
  channelConfigId: string
  guildId: string
  guildName: string
  channelId: string
  channelName: string
  ownerInstallationId: string
  currentInstallationId: string
  takeoverAvailable: boolean
  message: string
}
export type DiscordBotChannelStatus = {
  channelConfigId: string
  guildId: string
  guildName: string
  channelId: string
  channelName: string
  label: string
  enabled: boolean
  connected: boolean
  conflict?: DiscordGuardConflictStatus
  guardOwnerInstallationId?: string
  guardOwnerUpdatedAt?: string
  workspaceRoot: string
  model: string
  runtimeId?: AgentRuntimeId
  agentName: string
  accessError?: string
}
export type DiscordBotStatus = {
  installationId?: string
  clientId?: string
  inviteUrl?: string
  tokenConfigured?: boolean
  proxyUrl?: string
  configured: boolean
  connected: boolean
  enabled: boolean
  bot?: DiscordBotInfo
  channels?: DiscordBotChannelStatus[]
  conflict?: DiscordGuardConflictStatus
  guildId?: string
  guildName?: string
  channelId?: string
  channelName?: string
  message?: string
}
export type DiscordConfigureClientResult =
  | { ok: true; status: DiscordBotStatus }
  | { ok: false; message: string }
export type DiscordConfigureTokenResult =
  | { ok: true; status: DiscordBotStatus }
  | { ok: false; message: string }
export type DiscordConfigureProxyResult =
  | { ok: true; status: DiscordBotStatus }
  | { ok: false; message: string }
export type DiscordGuildListResult =
  | { ok: true; guilds: DiscordGuild[] }
  | { ok: false; message: string }
export type DiscordChannelListResult =
  | { ok: true; channels: DiscordChannel[] }
  | { ok: false; message: string }
export type DiscordBindChannelResult =
  | { ok: true; status: DiscordBotStatus; channelConfigId: string }
  | { ok: false; message: string }
export type DiscordTestSendResult =
  | { ok: true; messageId: string }
  | { ok: false; message: string }
export type DiscordGuardResult =
  | { ok: true; status: DiscordBotStatus }
  | { ok: false; message: string; status?: DiscordBotStatus; conflict?: DiscordGuardConflictStatus }
export type KunRuntimeStatusState =
  | 'starting'
  | 'running'
  | 'restarting'
  | 'crashed'
  | 'failed'
  | 'stopped'
export type KunRuntimeStatusPayload = {
  state: KunRuntimeStatusState
  source: string
  message?: string
  stderrTail?: string
  attempt?: number
  maxAttempts?: number
  at: string
}

export type DsGuiApi = {
  platform: string
  getSettings: () => Promise<AppSettingsV1>
  setSettings: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  fetchUpstreamModels: () => Promise<UpstreamModelsResult>
  getClawStatus: () => Promise<ClawRuntimeStatus>
  runClawTask: (taskId: string) => Promise<ClawRunResult>
  getScheduleStatus: () => Promise<ScheduleRuntimeStatus>
  runScheduleTask: (taskId: string) => Promise<ScheduleRunResult>
  startClawImInstallQr: (
    provider: 'feishu' | 'weixin',
    options?: { isLark?: boolean }
  ) => Promise<ClawImInstallQrResult>
  pollClawImInstall: (
    provider: 'feishu' | 'weixin',
    deviceCode: string
  ) => Promise<ClawImInstallPollResult>
  getDiscordBotStatus: () => Promise<DiscordBotStatus>
  configureDiscordClientId: (clientId: string) => Promise<DiscordConfigureClientResult>
  configureDiscordBotToken: (token: string, clientId?: string) => Promise<DiscordConfigureTokenResult>
  configureDiscordProxy: (proxyUrl: string) => Promise<DiscordConfigureProxyResult>
  listDiscordGuilds: () => Promise<DiscordGuildListResult>
  listDiscordChannels: (guildId: string) => Promise<DiscordChannelListResult>
  bindDiscordChannel: (payload: {
    channelConfigId?: string
    guildId: string
    guildName?: string
    channelId: string
    channelName?: string
    enabled?: boolean
    workspaceRoot?: string
    model?: string
    runtimeId?: AgentRuntimeId
    agentProfile?: Partial<ClawImAgentProfileV1>
  }) => Promise<DiscordBindChannelResult>
  testDiscordChannel: (channelId: string, text?: string, channelConfigId?: string) => Promise<DiscordTestSendResult>
  setDiscordGuard: (
    enabled: boolean,
    channelConfigId?: string,
    forceTakeover?: boolean
  ) => Promise<DiscordGuardResult>
  pickWorkspaceDirectory: (defaultPath?: string) => Promise<WorkspacePickResult>
  pickWorkspaceFile: (defaultPath?: string) => Promise<WorkspacePickResult>
  listSkills: (workspaceRoot?: string) => Promise<SkillListResult>
  saveSkillFile: (rootPath: string, skillName: string, content: string) => Promise<SkillSaveResult>
  openSkillRoot: (rootPath: string) => Promise<PathOpenResult>
  getDeepseekConfigFile: () => Promise<DeepseekConfigFileResult>
  setDeepseekConfigFile: (content: string) => Promise<DeepseekConfigSaveResult>
  openDeepseekConfigDir: () => Promise<PathOpenResult>
  buildScientificSkillsMcpConfig: (workspaceRoot?: string) => Promise<ScientificSkillsMcpConfigResult>
  buildScientificPlottingMcpConfig: (workspaceRoot?: string) => Promise<ScientificPlottingMcpConfigResult>
  getScientificSkillsStatus: (workspaceRoot?: string) => Promise<ScientificSkillsStatusResult>
  installScientificSkills: (request: ScientificSkillsInstallRequest) => Promise<ScientificSkillsInstallResult>
  getScientificPlottingStatus: (workspaceRoot?: string) => Promise<ScientificPlottingStatusResult>
  prepareScientificPlottingReference: (
    request: ScientificPlottingPrepareReferenceRequest
  ) => Promise<ScientificPlottingPrepareReferenceResult>
  extractFigureStyle: (request: FigureStyleExtractRequest) => Promise<FigureStyleExtractResult>
  evaluateFigureStyle: (request: FigureStyleSimilarityRequest) => Promise<FigureStyleSimilarityResult>
  reviewFigureStyle: (request: FigureStyleReviewRequest) => Promise<FigureStyleReviewResult>
  openModelRouterConfigFile: () => Promise<ModelRouterConfigOpenResult>
  getGitBranches: (workspaceRoot: string) => Promise<GitBranchesResult>
  switchGitBranch: (workspaceRoot: string, branch: string) => Promise<GitBranchesResult>
  createAndSwitchGitBranch: (workspaceRoot: string, branch: string) => Promise<GitBranchesResult>
  listEditors: () => Promise<EditorListResult>
  openEditorPath: (options: OpenEditorPathOptions) => Promise<EditorOpenResult>
  listWorkspaceDirectory: (options: WorkspaceDirectoryTarget) => Promise<WorkspaceDirectoryListResult>
  resolveWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileResolveResult>
  readWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileReadResult>
  readWorkspaceImage: (options: WorkspaceFileTarget) => Promise<WorkspaceImageReadResult>
  writeWorkspaceFile: (payload: WorkspaceFileWritePayload) => Promise<WorkspaceFileWriteResult>
  createWorkspaceFile: (payload: WorkspaceFileCreatePayload) => Promise<WorkspaceFileCreateResult>
  createWorkspaceDirectory: (
    payload: WorkspaceDirectoryCreatePayload
  ) => Promise<WorkspaceDirectoryCreateResult>
  saveWorkspaceClipboardImage: (
    payload: WorkspaceClipboardImageSavePayload
  ) => Promise<WorkspaceClipboardImageSaveResult>
  readClipboardImage: () => Promise<ClipboardImageReadResult>
  renameWorkspaceEntry: (
    payload: WorkspaceEntryRenamePayload
  ) => Promise<WorkspaceEntryRenameResult>
  deleteWorkspaceEntry: (
    payload: WorkspaceEntryDeletePayload
  ) => Promise<WorkspaceEntryDeleteResult>
  watchWorkspaceFile: (payload: WorkspaceFileWatchPayload) => Promise<WorkspaceFileWatchResult>
  unwatchWorkspaceFile: (watchId: string) => Promise<boolean>
  onWorkspaceFileChanged: (handler: (payload: WorkspaceFileChangePayload) => void) => () => void
  requestWriteInlineCompletion: (
    payload: WriteInlineCompletionRequest
  ) => Promise<WriteInlineCompletionResult>
  retrieveWriteContext: (payload: WriteRetrievalRequest) => Promise<WriteRetrievalResult>
  listWriteInlineCompletionDebugEntries: () => Promise<WriteInlineCompletionDebugEntry[]>
  clearWriteInlineCompletionDebugEntries: () => Promise<boolean>
  exportWriteDocument: (payload: WriteExportPayload) => Promise<WriteExportResult>
  copyWriteDocumentAsRichText: (
    payload: WriteRichClipboardPayload
  ) => Promise<WriteRichClipboardResult>
  speechToText: {
    transcribe: (payload: SpeechTranscriptionRequest) => Promise<SpeechTranscriptionResult>
  }
  onRuntimeStatus: (handler: (payload: KunRuntimeStatusPayload) => void) => () => void
  agentRuntime: {
    connect: (runtimeId?: AgentRuntimeThreadListInput['runtimeId']) => Promise<void>
    capabilities: (runtimeId?: AgentRuntimeThreadListInput['runtimeId']) => Promise<AgentRuntimeCapabilities>
    listThreads: (input?: AgentRuntimeThreadListInput) => Promise<AgentRuntimeThread[]>
    startThread: (input: AgentRuntimeThreadStartInput) => Promise<AgentRuntimeThread>
    readThread: (input: AgentRuntimeThreadReadInput) => Promise<AgentRuntimeThreadDetail>
    startTurn: (input: AgentRuntimeTurnStartInput) => Promise<AgentRuntimeTurnHandle>
    interruptTurn: (input: AgentRuntimeTurnTargetInput) => Promise<void>
    steerTurn: (input: AgentRuntimeTurnSteerInput) => Promise<void>
    subscribeEvents: (input: AgentRuntimeEventSubscribeInput) => Promise<{ streamId: string }>
    stopEvents: (streamId: string) => Promise<boolean>
    renameThread: (input: AgentRuntimeThreadRenameInput) => Promise<void>
    deleteThread: (input: AgentRuntimeThreadDeleteInput) => Promise<void>
    compactThread: (input: AgentRuntimeThreadCompactInput) => Promise<void>
    forkThread: (input: AgentRuntimeThreadForkInput) => Promise<AgentRuntimeThread>
    resumeSession: (input: AgentRuntimeSessionResumeInput) => Promise<AgentRuntimeSessionResumeHandle>
    updateThreadRelation: (input: AgentRuntimeThreadRelationInput) => Promise<void>
    usage: (input: AgentRuntimeUsageQuery) => Promise<AgentRuntimeUsageResponse>
    auxiliary: (input: AgentRuntimeAuxiliaryInput) => Promise<unknown>
    resolveApproval: (input: AgentRuntimeApprovalResolveInput) => Promise<void>
    resolveUserInput: (input: AgentRuntimeUserInputResolveInput) => Promise<void>
    onEvent: (handler: (payload: AgentRuntimeEventPayload) => void) => () => void
    onEnd: (handler: (payload: AgentRuntimeEventEndPayload) => void) => () => void
    onError: (handler: (payload: AgentRuntimeEventErrorPayload) => void) => () => void
  }
  onClawChannelActivity: (handler: (payload: ClawChannelActivityPayload) => void) => () => void
  updateClawActiveThreadContext: (payload: ClawActiveThreadContextPayload | null) => Promise<void>
  mirrorClawChannelMessage: (
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ) => Promise<ClawChannelMirrorResult>
  mirrorClawChannelMessageToFeishu: (
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ) => Promise<ClawChannelMirrorResult>
  createClawTaskFromText: (
    text: string,
    options?: { channelId?: string; modelHint?: string; mode?: 'agent' | 'plan' }
  ) => Promise<ClawTaskFromTextResult>
  createScheduleTaskFromText: (
    text: string,
    options?: { workspaceRoot?: string; modelHint?: string; mode?: 'agent' | 'plan' }
  ) => Promise<ScheduleTaskFromTextResult>
  runDesktopCommand: (command: DesktopCommand) => Promise<void>
  openExternal: (url: string) => Promise<void>
  showTurnCompleteNotification: (
    payload: TurnCompleteNotificationPayload
  ) => Promise<SystemNotificationResult>
  getAppVersion: () => Promise<string>
  getGuiUpdateState: () => Promise<GuiUpdateState>
  checkGuiUpdate: (channel?: GuiUpdateChannel) => Promise<GuiUpdateInfo>
  downloadGuiUpdate: (channel?: GuiUpdateChannel) => Promise<GuiUpdateDownloadResult>
  installGuiUpdate: () => Promise<GuiUpdateInstallResult>
  onGuiUpdateState: (handler: (payload: GuiUpdateState) => void) => () => void
  logError: (category: string, message: string, detail?: unknown) => Promise<void>
  getLogPath: () => Promise<string>
  openLogDir: () => Promise<{ ok: boolean; message?: string }>
  getPathForFile: (file: File) => string
}
