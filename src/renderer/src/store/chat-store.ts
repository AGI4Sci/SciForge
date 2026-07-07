import { create } from 'zustand'
import type { NormalizedThread } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { applyDocumentLocale, applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError } from '../lib/format-runtime-error'
import {
  deriveThreadTitleFromPrompt,
  getDefaultThreadTitle,
  shouldAutoTitleThread
} from '../lib/thread-title'
import { filterThreadsForSidebar } from '../lib/thread-sidebar-visibility'
import {
  enrichThreadsWithForkInfo,
  forgetThreadFork,
  hydrateThreadForkRegistry,
  markThreadFork,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from '../lib/thread-fork-registry'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import { isInternalTemporaryWorkspace, normalizeWorkspaceRoot } from '../lib/workspace-path'
import { buildRemoteChannelRuntimePrompt, getActiveAgentApiKey } from '@shared/app-settings'
import type {
  AppRoute,
  ChatState,
  InitialSetupMode,
  PluginHostRoute,
  QueuedUserMessage,
  SendMessageOverrides,
  SettingsRouteSection
} from './chat-store-types'
import { createAppActions } from './chat-store-app-actions'
import { createRemoteChannelActions } from './chat-store-remote-channel-actions'
import { createSideActions } from './chat-store-side-actions'
import {
  activeRemoteChannel,
  compactCodeWorkspaceRoots,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isRemoteChannelThread,
  mergeComposerPickList,
  newRemoteChannel,
  normalizeRemoteChannelComposerModel,
  optimisticUserModelLabel,
  persistComposerModel,
  readCodeWorkspaceRoots,
  readStoredComposerModel,
  rememberCodeWorkspaceRoots,
  rememberTurnModel
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  hasPendingRuntimeWork,
  threadBelongsToWorkspace
} from './chat-store-runtime-helpers'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopTurnCompletionPoll
} from './chat-store-schedulers'
import {
  armBusyWatchdog,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  finalizeTurnTiming,
  flushLiveBlocks,
  forkedMessageCount,
  forkedTurnCount,
  isCodeThread,
  latestThread,
  rememberPendingRemoteChannelMirror,
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import { createNavigationActions } from './chat-store-navigation-actions'
import { createThreadActions } from './chat-store-thread-actions'
import { createMaintenanceActions } from './chat-store-maintenance-actions'
import { trackZustandSet } from '../lib/performance-monitor'

export type { AppRoute, SettingsRouteSection } from './chat-store-types'
export { REMOTE_CHANNEL_COMPOSER_MODEL_IDS } from './chat-store-helpers'

let sseAbort: AbortController | null = null
const sseAbortRef = {
  get current(): AbortController | null {
    return sseAbort
  },
  set current(value: AbortController | null) {
    sseAbort = value
  }
}
let composerModelLoadPromise: Promise<void> | null = null

export const useChatStore = create<ChatState>((set, get) => {
  const trackedSet = trackZustandSet<ChatState>('chat', set)
  return {
  route: 'chat',
  settingsReturnRoute: 'chat',
  pluginHostRoute: 'chat',
  settingsSection: 'general',
  initialSetupOpen: false,
  initialSetupMode: 'required',
  connectPhonePanelOpen: false,
  workspaceRoot: '',
  workspaceLabel: i18n.t('common:workingDirectory'),
  runtimeConnection: 'idle',
  activeAgentRuntime: 'sciforge',
  codeWorkspaceRoots: [],
  hiddenCodeWorkspaceRoots: [],
  threads: [],
  threadSearch: '',
  showArchivedThreads: false,
  activeThreadId: null,
  activeThreadGoal: null,
  activeThreadTodos: null,
  activeThreadContextState: null,
  blocks: [],
  liveReasoning: '',
  liveReasoningMeta: null,
  liveAssistant: '',
  lastSeq: 0,
  usageRefreshKey: 0,
  childRefreshKey: 0,
  busy: false,
  error: null,
  runtimeErrorDetail: null,
  currentTurnId: null,
  currentTurnUserId: null,
  turnStartedAtByUserId: {},
  turnDurationByUserId: {},
  turnReasoningFirstAtByUserId: {},
  turnReasoningLastAtByUserId: {},
  inspectorSelectedId: null,
  composerModel: '',
  composerPickList: mergeComposerPickList(false, []),
  composerModelGroups: [],
  queuedMessages: [],
  watchTurnCompletion: {},
  unreadThreadIds: {},
  sideConversations: {},
  sidePanel: { open: false, activeSideId: null },
  remoteChannels: [],
  activeRemoteChannelId: '',
  remoteGuardChannelId: null,
  remoteTargetId: null,
  setRemoteTargetId: (targetId) => trackedSet({ remoteTargetId: targetId?.trim() || null }),

  ...createRemoteChannelActions({
    set: trackedSet,
    get,
    i18n,
    getProvider,
    newRemoteChannel,
    normalizeRemoteChannelComposerModel,
    activeRemoteChannel,
    normalizeWorkspaceRoot: (workspaceRoot) => normalizeWorkspaceRoot(workspaceRoot ?? undefined),
    formatRuntimeError,
    shouldOpenSettingsForError,
    clearedThreadSelection,
    sseAbortRef,
    clearBusyWatchdog
  }),

  ...createAppActions({
    set: trackedSet,
    get,
    i18n,
    persistComposerModel,
    readStoredComposerModel,
    mergeComposerPickList,
    getComposerModelLoadPromise: () => composerModelLoadPromise,
    setComposerModelLoadPromise: (promise) => {
      composerModelLoadPromise = promise
    },
    applyTheme,
    applyUiFontScale,
    applyDocumentLocale,
    workspaceLabelFromPath,
    normalizeWorkspaceRoot: (workspaceRoot) => normalizeWorkspaceRoot(workspaceRoot ?? undefined)
  }),

  ...createSideActions({
    set: trackedSet,
    get,
    getProvider,
    t: (key) => i18n.t(key),
    formatRuntimeError,
    shouldOpenSettingsForError
  }),

  ...createNavigationActions({ set: trackedSet, get, sseAbortRef }),

  ...createThreadActions({ set: trackedSet, get, sseAbortRef }),

  ...createMaintenanceActions({ set: trackedSet, get, sseAbortRef })
  }
})

if (import.meta.env.DEV && typeof document !== 'undefined') {
  const publishDevState = (): void => {
    const state = useChatStore.getState()
    const root = document.documentElement
    root.dataset.sciforgeRuntimeConnection = state.runtimeConnection
    root.dataset.sciforgeThreadCount = String(state.threads.length)
    root.dataset.sciforgeActiveRuntime = state.activeAgentRuntime
    root.dataset.sciforgeRuntimeError = state.error ?? ''
  }
  publishDevState()
  useChatStore.subscribe(publishDevState)
}
