import type {
  AttachmentReference,
  ChatBlock,
  NormalizedThread,
  RuntimeDisclosureMetadata,
  RuntimeConnectionStatus,
  ReviewTarget,
  ThreadGoal,
  ThreadGoalStatus,
  ThreadTodoList,
  ThreadTodoStatus,
  UserInputAnswer
} from '../agent/types'
import type {
  RemoteChannelAgentProfileV1,
  RemoteChannelV1,
  RemoteChannelPlatformCredentialV1,
  RemoteChannelProvider,
  RemoteChannelImSettingsV1,
  AgentRuntimeId,
  RemoteChannelModel
} from '@shared/app-settings'
import type {
  AgentRuntimeContextState,
  AgentRuntimeFileReference,
  AgentRuntimeGovernanceProfile
} from '@shared/agent-runtime-contract'
import type { ModelProviderModelGroup } from '@shared/sciforge-api'

export type QueuedUserMessage = {
  id: string
  threadId?: string
  runtimeId?: AgentRuntimeId
  text: string
  displayText?: string
  mode?: string
  sourceRoute?: AppRoute
  targetThreadId?: string
  workspaceRoot?: string
  governanceProfile?: AgentRuntimeGovernanceProfile
  model?: string
  modelLabel?: string
  reasoningEffort?: string
  remoteTargetId?: string
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  fileReferences?: AgentRuntimeFileReference[]
  /**
   * Optional GUI plan context forwarded to the runtime. The renderer
   * attaches it for plan/refine turns so the runtime can advertise
   * the native `create_plan` tool and gate the write to the reserved
   * plan artifact.
   */
  guiPlan?: {
    operation: 'draft' | 'refine'
    workspaceRoot: string
    relativePath: string
    planId: string
    sourceRequest?: string
    title?: string
  }
}

/**
 * GUI plan context attached to a send-message call. Mirrors the
 * local runtime `GuiPlanContextSchema` and is forwarded to the runtime
 * request body so plan/refine turns are scoped to a reserved path.
 */
export type GuiPlanMessageContext = {
  operation: 'draft' | 'refine'
  workspaceRoot: string
  relativePath: string
  planId: string
  sourceRequest?: string
  title?: string
}

export type SendMessageOverrides = {
  queued?: QueuedUserMessage
  model?: string
  modelLabel?: string
  reasoningEffort?: string
  remoteTargetId?: string
  displayText?: string
  sourceRoute?: AppRoute
  targetThreadId?: string
  workspaceRoot?: string
  governanceProfile?: AgentRuntimeGovernanceProfile
  guiPlan?: GuiPlanMessageContext
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  fileReferences?: AgentRuntimeFileReference[]
}

export type InitialSetupMode = 'required' | 'preview'
export type SettingsRouteSection =
  | 'general'
  | 'speechToText'
  | 'agents'
  | 'skill'
  | 'mcp'
  | 'shortcuts'
  | 'connectPhone'
  | 'remoteResources'
export type AppRoute = 'chat' | 'settings' | 'plugins' | 'schedule' | 'workflow'
export type PluginHostRoute = 'chat'

/**
 * A side conversation ("by-the-way") running alongside the active
 * thread. It owns its own timeline, composer, busy state, and SSE
 * subscription so it can stream in parallel with the main thread.
 *
 * The slice is namespaced under `sideConversations[threadId]` and
 * MUST NOT mutate any main-thread state (`activeThreadId`, `blocks`,
 * `busy`, etc.) — isolation is structural.
 */
export type SideConversation = {
  threadId: string
  runtimeId?: AgentRuntimeId
  parentThreadId: string
  source?: 'side' | 'child_agent' | 'pdf_annotation'
  title: string
  createdAt: string
  /** Timestamp the snapshot was taken from the parent. */
  inheritedAt: string
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  lastSeq: number
  input: string
  /** Follow-up messages waiting for the current side turn to finish. */
  queuedMessages?: SideQueuedMessage[]
  model: string
  reasoningEffort: string
  busy: boolean
  turnId: string | null
  userItemId: string | null
  error: string | null
}

export type SideMessageOverrides = {
  attachmentIds?: string[]
  fileReferences?: AgentRuntimeFileReference[]
  displayText?: string
}

export type SideQueuedMessage = SideMessageOverrides & {
  id: string
  text: string
  model: string
  reasoningEffort?: string
}

export type SidePanelState = {
  open: boolean
  activeSideId: string | null
}

export type ChatState = {
  route: AppRoute
  settingsReturnRoute: Exclude<AppRoute, 'settings'>
  pluginHostRoute: PluginHostRoute
  settingsSection: SettingsRouteSection
  initialSetupOpen: boolean
  initialSetupMode: InitialSetupMode
  connectPhonePanelOpen: boolean
  workspaceRoot: string
  workspaceLabel: string
  runtimeConnection: RuntimeConnectionStatus
  activeAgentRuntime: AgentRuntimeId
  codeWorkspaceRoots: string[]
  hiddenCodeWorkspaceRoots: string[]
  threads: NormalizedThread[]
  threadSearch: string
  showArchivedThreads: boolean
  activeThreadId: string | null
  activeThreadGoal: ThreadGoal | null
  activeThreadTodos: ThreadTodoList | null
  activeThreadContextState: AgentRuntimeContextState | null
  blocks: ChatBlock[]
  liveReasoning: string
  liveReasoningMeta: RuntimeDisclosureMetadata | null
  liveAssistant: string
  lastSeq: number
  usageRefreshKey: number
  childRefreshKey: number
  busy: boolean
  error: string | null
  runtimeErrorDetail: string | null
  currentTurnId: string | null
  currentTurnUserId: string | null
  turnStartedAtByUserId: Record<string, number>
  turnDurationByUserId: Record<string, number>
  turnReasoningFirstAtByUserId: Record<string, number>
  turnReasoningLastAtByUserId: Record<string, number>
  inspectorSelectedId: string | null
  composerModel: string
  composerPickList: string[]
  composerModelGroups: ModelProviderModelGroup[]
  queuedMessages: QueuedUserMessage[]
  watchTurnCompletion: Record<string, boolean>
  unreadThreadIds: Record<string, boolean>
  /**
   * Side conversations opened via `/btw`. The main thread selection
   * and subscription are never touched by these entries.
   */
  sideConversations: Record<string, SideConversation>
  sidePanel: SidePanelState
  remoteChannels: RemoteChannelV1[]
  activeRemoteChannelId: string
  remoteGuardChannelId: string | null
  remoteTargetId: string | null
  appendLocalRemoteChannelTurn: (userText: string, replyText: string) => void
  setError: (message: string | null) => void
  setComposerModel: (modelId: string) => void
  setActiveAgentRuntime: (runtimeId: AgentRuntimeId) => Promise<void>
  loadComposerModels: () => Promise<void>
  setRoute: (r: AppRoute) => void
  openCode: () => Promise<void>
  openSettings: (section?: SettingsRouteSection) => void
  openPlugins: (host?: PluginHostRoute) => void
  openConnectPhone: () => void
  setConnectPhonePanelOpen: (open: boolean) => void
  openSchedule: () => void
  openWorkflow: () => void
  selectRemoteGuardChannel: (channelId: string) => void
  clearRemoteGuardChannel: () => void
  setRemoteTargetId: (targetId: string | null) => void
  refreshRemoteChannels: () => Promise<void>
  addRemoteChannel: (
    provider: RemoteChannelProvider,
    agentProfile?: Partial<RemoteChannelAgentProfileV1>,
    platformCredential?: RemoteChannelPlatformCredentialV1,
    options?: {
      channelId?: string
      model?: string
      workspaceRoot?: string
      enabled?: boolean
      im?: Partial<RemoteChannelImSettingsV1>
      preserveRoute?: boolean
    }
  ) => Promise<void>
  selectRemoteChannel: (channelId: string) => Promise<void>
  selectRemoteChannelConversation: (channelId: string, threadId: string) => Promise<void>
  deleteRemoteChannel: (channelId: string) => Promise<void>
  resetRemoteChannelSession: (channelId: string) => Promise<void>
  setRemoteChannelModel: (channelId: string, model: string) => Promise<void>
  openInitialSetup: (mode?: InitialSetupMode) => void
  closeInitialSetup: () => void
  boot: () => Promise<void>
  probeRuntime: (mode?: 'user' | 'background') => Promise<void>
  chooseWorkspace: (options?: { createThreadAfter?: boolean; selectThreadAfter?: boolean }) => Promise<string | null>
  clearWorkspace: () => Promise<void>
  deleteWorkspace: (workspacePath: string) => Promise<void>
  refreshThreads: () => Promise<void>
  setThreadSearch: (query: string) => void
  setShowArchivedThreads: (show: boolean) => void
  createThread: (options?: { workspaceRoot?: string; forceNew?: boolean }) => Promise<void>
  selectThread: (id: string) => Promise<void>
  refreshActiveThreadContextState: (threadId?: string) => Promise<void>
  recoverActiveTurn: () => Promise<boolean>
  sendMessage: (text: string, mode?: string, overrides?: SendMessageOverrides) => Promise<boolean>
  reviewActiveThread: (target: ReviewTarget) => Promise<boolean>
  drainQueuedMessages: () => Promise<void>
  removeQueuedMessage: (id: string) => void
  steerQueuedMessage: (id: string) => Promise<boolean>
  rewindAndResend: (userBlockId: string, newText: string) => Promise<void>
  interrupt: (options?: { discard?: boolean }) => Promise<void>
  renameActiveThread: (title: string) => Promise<void>
  renameThread: (threadId: string, title: string) => Promise<void>
  archiveThread: (threadId: string, archived: boolean) => Promise<void>
  compactActiveThread: (reason?: string) => Promise<void>
  forkActiveThread: () => Promise<void>
  setActiveThreadGoal: (objective: string) => Promise<boolean>
  setActiveThreadGoalStatus: (status: ThreadGoalStatus) => Promise<boolean>
  clearActiveThreadGoal: () => Promise<boolean>
  setActiveThreadTodoStatus: (todoId: string, status: ThreadTodoStatus) => Promise<boolean>
  clearActiveThreadTodos: () => Promise<boolean>
  syncPlanTodosFromMarkdown: (
    plan: { id: string; relativePath: string },
    markdown: string
  ) => Promise<boolean>
  /**
   * Spawn a side conversation from the active thread. Available even
   * while the active thread is running. Does not change `activeThreadId`.
   * If `seedText` is provided, immediately sends it as the first turn.
   */
  spawnSideConversation: (
    seedText?: string,
    options?: {
      source?: SideConversation['source']
      title?: string
      openPanel?: boolean
      allowStandalone?: boolean
      standalone?: boolean
    }
  ) => Promise<string | null>
  /**
   * Attach an existing auxiliary thread to the isolated right-side
   * conversation state without changing the active main thread.
   */
  attachSideConversation: (input: {
    threadId: string
    parentThreadId: string
    runtimeId?: AgentRuntimeId
    title?: string
    model?: string
    source?: SideConversation['source']
    openPanel?: boolean
  }) => Promise<string | null>
  /**
   * Open the side chat surface without creating an underlying side
   * thread. The first draft send will create the side thread.
   */
  openSideConversationDraft: () => void
  sendSideMessage: (
    sideId: string,
    text: string,
    overrides?: SideMessageOverrides
  ) => Promise<boolean>
  removeSideQueuedMessage: (sideId: string, messageId: string) => void
  interruptSide: (sideId: string) => Promise<void>
  setSideInput: (sideId: string, text: string) => void
  setSideModel: (sideId: string, model: string) => void
  setSideReasoningEffort: (sideId: string, effort: string) => void
  selectSideConversation: (sideId: string) => void
  setSidePanelOpen: (open: boolean) => void
  closeSideConversation: (sideId: string) => Promise<void>
  discardSideConversation: (sideId: string) => Promise<void>
  promoteSideConversation: (sideId: string) => Promise<void>
  resumeSessionIntoThread: (
    sessionId: string,
    options?: { model?: string; mode?: string; maxResumeCount?: number }
  ) => Promise<string | null>
  deleteThread: (threadId: string) => Promise<void>
  resolveApproval: (blockId: string, decision: 'allow' | 'deny') => Promise<void>
  resolveUserInput: (
    blockId: string,
    action: { kind: 'submit'; answers: UserInputAnswer[] } | { kind: 'cancel' }
  ) => Promise<void>
  selectInspectorItem: (id: string | null) => void
  applyI18nFromSettings: (locale: 'en' | 'zh') => Promise<void>
  reloadUiSettings: () => Promise<void>
}

export type ChatStoreSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)
) => void

export type ChatStoreGet = () => ChatState
