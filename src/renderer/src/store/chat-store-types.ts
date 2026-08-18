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
  AgentRuntimeId
} from '@shared/app-settings'
import type {
  AgentRuntimeContextState,
  AgentRuntimeFileReference,
  AgentRuntimeGovernanceProfile
} from '@shared/agent-runtime-contract'
import type { ModelProviderModelGroup } from '@shared/sciforge-api'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'

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
  governanceProfile?: Extract<AgentRuntimeGovernanceProfile, 'default' | 'write'>
  model?: string
  modelLabel?: string
  reasoningEffort?: string
  workspaceLocator?: WorkspaceLocator
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  fileReferences?: AgentRuntimeFileReference[]
  /**
   * A send that did not return a turn handle. These entries are deliberately
   * excluded from automatic queue draining: the runtime may already have
   * persisted the user item before rejecting turn startup, so retry must first
   * inspect the thread and choose between resend and continuation.
   */
  sendFailure?: {
    userBlockId: string
    message: string
    /** Delivery start time used to reconcile a persisted user item after failure. */
    attemptedAt?: number
  }
  /** Require explicit confirmation before retrying restored attachment ids. */
  restoredAttachmentWarning?: string
  /** Durable send journal used to reconcile a crash at the delivery boundary. */
  deliveryAttempt?: {
    startedAt: number
    /** Immutable optimistic user id for the payload that crossed the delivery boundary. */
    userBlockId: string
    /** Immutable payload identity; queued text may only change before this exists. */
    attemptedText: string
    attemptedDisplayText?: string
    /** Hide a normal direct send journal until it is restored or fails. */
    journalOnly?: boolean
    /** True only after the journal has been restored by a new renderer. */
    restored?: boolean
  }
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
  workspaceLocator?: WorkspaceLocator
  displayText?: string
  sourceRoute?: AppRoute
  targetThreadId?: string
  workspaceRoot?: string
  governanceProfile?: Extract<AgentRuntimeGovernanceProfile, 'default' | 'write'>
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
  | 'remoteResources'
export type AppRoute = 'chat' | 'settings' | 'plugins' | 'schedule'
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
  workspaceLocator?: WorkspaceLocator
  parentThreadId: string
  source?: 'side' | 'child_agent' | 'pdf_annotation' | 'sdd_assistant'
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
  mode?: string
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

/** A thread in the currently focused agent's root-to-leaf navigation path. */
export type AgentFocusNode = {
  threadId: string
  parentThreadId: string | null
  runtimeId?: AgentRuntimeId
  title?: string
}

/** A browser-history entry for the agent shown in the center workbench. */
export type AgentFocusLocation = {
  threadId: string
  runtimeId?: AgentRuntimeId
  lineage: AgentFocusNode[]
}

export type FocusAgentThreadInput = {
  threadId: string
  parentThreadId?: string | null
  runtimeId?: AgentRuntimeId
  title?: string
  /** Optional complete path for deep-linking an agent that is not attached yet. */
  lineage?: AgentFocusNode[]
}

export type ChatState = {
  route: AppRoute
  settingsReturnRoute: Exclude<AppRoute, 'settings'>
  pluginHostRoute: PluginHostRoute
  settingsSection: SettingsRouteSection
  initialSetupOpen: boolean
  initialSetupMode: InitialSetupMode
  workspaceRoot: string
  workspaceLabel: string
  runtimeConnection: RuntimeConnectionStatus
  activeAgentRuntime: AgentRuntimeId
  modelAccessMode: 'api' | 'coding-plan' | null
  codeWorkspaceRoots: string[]
  hiddenCodeWorkspaceRoots: string[]
  threads: NormalizedThread[]
  threadSearch: string
  showArchivedThreads: boolean
  activeThreadId: string | null
  /**
   * Thread displayed in the center workbench. Unlike `activeThreadId`, this
   * may be a descendant sub-agent and never changes the selected root chat.
   */
  focusedAgentThreadId: string | null
  focusedAgentRuntimeId: AgentRuntimeId | null
  agentFocusLineage: AgentFocusNode[]
  agentFocusHistory: AgentFocusLocation[]
  agentFocusHistoryIndex: number
  activeThreadGoal: ThreadGoal | null
  activeThreadTodos: ThreadTodoList | null
  activeThreadContextState: AgentRuntimeContextState | null
  /** In-memory canonical block snapshots for resident Session workspaces. */
  threadBlocksById: Record<string, ChatBlock[]>
  blocks: ChatBlock[]
  liveReasoning: string
  liveReasoningMeta: RuntimeDisclosureMetadata | null
  liveAssistant: string
  lastSeq: number
  threadHistoryCursor: string | null
  threadHistoryLoading: boolean
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
  composerModel: string
  composerPickList: string[]
  composerModelGroups: ModelProviderModelGroup[]
  queuedMessages: QueuedUserMessage[]
  /** True when only the bounded recovery outbox, rather than the full session, is durable. */
  chatSessionPersistenceDegraded: boolean
  watchTurnCompletion: Record<string, boolean>
  unreadThreadIds: Record<string, boolean>
  /**
   * Side conversations opened via `/btw`. The main thread selection
   * and subscription are never touched by these entries.
   */
  sideConversations: Record<string, SideConversation>
  sidePanel: SidePanelState
  workspaceLocator: WorkspaceLocator | null
  setError: (message: string | null) => void
  setComposerModel: (modelId: string) => void
  setActiveAgentRuntime: (runtimeId: AgentRuntimeId) => Promise<void>
  loadComposerModels: () => Promise<void>
  setRoute: (r: AppRoute) => void
  openCode: () => Promise<void>
  openSettings: (section?: SettingsRouteSection) => void
  openPlugins: (host?: PluginHostRoute) => void
  openSchedule: () => void
  setWorkspaceLocator: (locator: WorkspaceLocator | null) => void
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
  loadEarlierThreadHistory: () => Promise<void>
  focusAgentThread: (target: FocusAgentThreadInput) => boolean
  focusAgentBack: () => boolean
  focusAgentForward: () => boolean
  focusAgentParent: () => boolean
  resetAgentFocus: (rootThreadId?: string | null) => void
  refreshActiveThreadContextState: (threadId?: string) => Promise<void>
  recoverActiveTurn: () => Promise<boolean>
  sendMessage: (text: string, mode?: string, overrides?: SendMessageOverrides) => Promise<boolean>
  reviewActiveThread: (target: ReviewTarget) => Promise<boolean>
  drainQueuedMessages: () => Promise<void>
  drainQueuedMessagesForThread: (threadId: string) => Promise<boolean>
  removeQueuedMessage: (id: string) => void
  updateQueuedMessage: (id: string, text: string) => boolean
  retryQueuedMessage: (id: string) => Promise<boolean>
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
  setThreadTodoStatus: (threadId: string, todoId: string, status: ThreadTodoStatus) => Promise<boolean>
  clearThreadTodos: (threadId: string) => Promise<boolean>
  syncPlanTodosFromMarkdown: (
    threadId: string,
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
      displayText?: string
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
  rekeySessionSideConversations: (previousSessionId: string, nextSessionId: string) => void
  closeSideConversation: (sideId: string) => Promise<void>
  discardSideConversation: (sideId: string) => Promise<void>
  promoteSideConversation: (sideId: string) => Promise<void>
  resumeSessionIntoThread: (
    sessionId: string,
    options?: {
      model?: string
      mode?: string
      maxResumeCount?: number
      workspaceLocator?: WorkspaceLocator
    }
  ) => Promise<string | null>
  deleteThread: (threadId: string) => Promise<void>
  resolveApproval: (
    blockId: string,
    decision: 'allow' | 'deny',
    threadId?: string
  ) => Promise<void>
  resolveUserInput: (
    blockId: string,
    action: { kind: 'submit'; answers: UserInputAnswer[] } | { kind: 'cancel' }
  ) => Promise<void>
  applyI18nFromSettings: (locale: 'en' | 'zh') => Promise<void>
  reloadUiSettings: () => Promise<void>
}

export type ChatStoreSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)
) => void

export type ChatStoreGet = () => ChatState
