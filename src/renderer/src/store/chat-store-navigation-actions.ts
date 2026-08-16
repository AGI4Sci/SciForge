import type { NormalizedThread } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError } from '../lib/format-runtime-error'
import {
  deriveThreadTitleFromPrompt,
  hasPlaceholderThreadTitle,
  shouldAutoTitleThread
} from '../lib/thread-title'
import {
  filterThreadsForSidebar,
  shouldHideThreadFromSidebarByDefault
} from '../lib/thread-sidebar-visibility'
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
import { disposeSessionRightPanelWorkspace } from '../lib/session-right-panel-lifecycle'
import {
  getActiveAgentApiKey,
  getActiveAgentRuntime,
  getModelAccessSettings,
  type AgentRuntimeId
} from '@shared/app-settings'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  compactCodeWorkspaceRoots,
  filterHiddenCodeWorkspaceRoots,
  forgetCodeWorkspaceRoot,
  hideCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  optimisticUserModelLabel,
  readCodeWorkspaceRoots,
  readHiddenCodeWorkspaceRoots,
  readStoredComposerModel,
  rememberCodeWorkspaceRoots,
  rememberTurnModel,
  restoreHiddenCodeWorkspaceRoots
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  hasPendingRuntimeWork,
  reconcileOptimisticUserBlock,
  threadSnapshotLooksRunning,
  threadBelongsToWorkspace
} from './chat-store-runtime-helpers'
import {
  isEmptySddAssistantThreadCandidate,
  isSddAssistantThread,
  readSddThreadRegistry
} from '../sdd/sdd-thread-registry'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleRuntimeBootRetry,
  scheduleRuntimeReconnectProbe,
  stopRuntimeBootRetry,
  stopRuntimeReconnectProbe,
  stopRuntimeThreadRefreshPoll,
  stopTurnCompletionPoll,
  syncRuntimeThreadRefreshPoll
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
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  watchTurnCompletionNotification
} from './chat-store-runtime'

type SseAbortRef = { current: AbortController | null }

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

let bootPromise: Promise<void> | null = null
let refreshThreadsRequestSeq = 0
const DEFAULT_THREAD_LIST_LIMIT = 80
const EXPANDED_THREAD_LIST_LIMIT = 200
const RUNTIME_PROBE_TIMEOUT_MS = 8_000

function withRuntimeProbeTimeout<T>(task: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutTask = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out while connecting to the local runtime.`))
    }, RUNTIME_PROBE_TIMEOUT_MS)
  })
  return Promise.race([task, timeoutTask]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

function stateHasRecoverableActiveTurn(state: ChatState): boolean {
  return state.busy || Boolean(state.currentTurnId) || state.blocks.some(hasPendingRuntimeWork)
}

function titleFromLocalUserBlocks(blocks: ChatState['blocks']): string | null {
  for (const block of blocks) {
    if (block.kind !== 'user') continue
    const text = block.meta?.displayText?.trim() || block.text.trim()
    if (!text) continue
    const title = deriveThreadTitleFromPrompt(text)
    if (!title || hasPlaceholderThreadTitle(title)) continue
    return title
  }
  return null
}

function threadNeedsSidebarTitle(thread: Pick<NormalizedThread, 'id' | 'title'>): boolean {
  return shouldAutoTitleThread(thread)
}

function activeThreadFilteredFromSidebar(options: {
  activeId: string | null
  rawThreads: NormalizedThread[]
  sidebarThreads: NormalizedThread[]
}): boolean {
  return options.activeId != null &&
    options.rawThreads.some((thread) => thread.id === options.activeId) &&
    !options.sidebarThreads.some((thread) => thread.id === options.activeId)
}

function preserveLocalActiveThreadForSidebar(
  thread: NormalizedThread | null,
  blocks: ChatState['blocks']
): NormalizedThread | null {
  if (!thread) return null
  if (!threadNeedsSidebarTitle(thread)) return thread
  const title = titleFromLocalUserBlocks(blocks)
  return title ? { ...thread, title } : null
}

function attachedSideConversationThreadIds(state: ChatState): Set<string> {
  return new Set(
    Object.keys(state.sideConversations ?? {})
      .map((threadId) => threadId.trim())
      .filter(Boolean)
  )
}

function threadIsAuxiliarySidebarEntry(
  thread: NormalizedThread | null,
  hiddenThreadIds: Set<string>
): boolean {
  if (!thread) return false
  return hiddenThreadIds.has(thread.id.trim()) ||
    shouldHideThreadFromSidebarByDefault(thread)
}

export function createNavigationActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'openCode' | 'probeRuntime' | 'boot' | 'chooseWorkspace' | 'clearWorkspace' | 'deleteWorkspace' | 'refreshThreads' | 'setThreadSearch' | 'setShowArchivedThreads'> {
  return {
  openCode: async () => {
    const state = get()
    const activeThread = state.activeThreadId
      ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
      : null
    if (activeThread && isCodeThread(activeThread)) {
      set({ route: 'chat' })
      if (stateHasRecoverableActiveTurn(state)) {
        await get().recoverActiveTurn()
      }
      return
    }

    const codeThreads = state.threads.filter((thread) => isCodeThread(thread))
    const selectedWorkspace = normalizeWorkspaceRoot(state.workspaceRoot)
    const target =
      latestThread(codeThreads.filter((thread) => threadBelongsToWorkspace(thread, selectedWorkspace))) ??
      latestThread(codeThreads)

    set({ route: 'chat' })
    if (target && state.runtimeConnection === 'ready') {
      await get().selectThread(target.id)
      return
    }

    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    const nextWatch = { ...state.watchTurnCompletion }
    if (state.activeThreadId && state.busy) {
      nextWatch[state.activeThreadId] = true
      watchTurnCompletionNotification(state.activeThreadId)
    }
    set({
      ...clearedThreadSelection(),
      route: 'chat',
      watchTurnCompletion: nextWatch
    })
    syncTurnCompletionPoll(set, get)
  },

  probeRuntime: async (mode = 'user') => {
    const prev = get().runtimeConnection
    if (mode === 'user') set({ runtimeConnection: 'checking' })
    try {
      if (typeof window.sciforge === 'undefined') {
        throw new Error(
          'Preload bridge missing (window.sciforge). Restart the app or check BrowserWindow preload path.'
        )
      }
      const p = getProvider()
      await withRuntimeProbeTimeout(p.connect(), 'Runtime probe')
      stopRuntimeBootRetry()
      stopRuntimeReconnectProbe()
      set({ runtimeConnection: 'ready', error: null, runtimeErrorDetail: null })
      void get().loadComposerModels()
      try {
        await get().refreshThreads()
      } catch {
        /* refreshThreads sets state */
      }
      // A renderer reload restores the selected thread id before the runtime is
      // connected. Rehydrate that transcript once the bridge returns instead
      // of leaving the user on an empty new-conversation surface.
      const restoredActiveThreadId = get().activeThreadId
      if (
        restoredActiveThreadId &&
        get().blocks.length === 0 &&
        !get().busy &&
        get().runtimeConnection === 'ready'
      ) {
        try {
          await withRuntimeProbeTimeout(
            get().selectThread(restoredActiveThreadId),
            'Restored thread'
          )
          const restoredState = get()
          const restoredThreadExists = (restoredState.threads ?? []).some(
            (thread) => thread.id === restoredActiveThreadId
          )
          if (
            restoredState.activeThreadId === restoredActiveThreadId &&
            !restoredThreadExists &&
            restoredState.blocks.length === 0 &&
            restoredState.error
          ) {
            set({
              ...clearedThreadSelection(),
              error: i18n.t('common:restoredThreadUnavailable')
            })
          }
        } catch {
          // Session restoration is optional. A stale/missing thread or a slow
          // runtime must never keep the renderer on its startup surface.
          set({
            ...clearedThreadSelection(),
            runtimeConnection: 'ready',
            error: i18n.t('common:restoredThreadUnavailable')
          })
        }
      }
      syncRuntimeThreadRefreshPoll(get)
      if (get().activeThreadId && stateHasRecoverableActiveTurn(get())) {
        await get().recoverActiveTurn()
      }
    } catch (e) {
      const msg = formatRuntimeError(e)
      const detail = runtimeErrorDetail(e)
      const needsSettings = shouldOpenSettingsForError(e)
      if (!needsSettings) scheduleRuntimeReconnectProbe(get)
      if (mode === 'user') {
        stopRuntimeThreadRefreshPoll()
        stopTurnCompletionPoll()
        set({
          runtimeConnection: 'offline',
          error: msg,
          runtimeErrorDetail: detail,
          ...(needsSettings
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      } else if (prev === 'ready') {
        stopRuntimeThreadRefreshPoll()
        stopTurnCompletionPoll()
        set({
          runtimeConnection: 'offline',
          error: msg,
          runtimeErrorDetail: detail,
          ...(needsSettings
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
    }
  },

  boot: async () => {
    if (bootPromise) return bootPromise
    bootPromise = (async () => {
      try {
        if (typeof window.sciforge === 'undefined') {
          set({
            error: formatRuntimeError(
              'Preload bridge missing (window.sciforge). Restart the app or check BrowserWindow preload path.'
            ),
            runtimeConnection: 'offline',
            runtimeErrorDetail: 'Preload bridge missing (window.sciforge). Restart the app or check BrowserWindow preload path.',
            initialSetupOpen: false,
            initialSetupMode: 'required'
          })
          return
        }
        const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
        stopRuntimeBootRetry()
        const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
        const hiddenCodeWorkspaceRoots = restoreHiddenCodeWorkspaceRoots(
          readHiddenCodeWorkspaceRoots(),
          [workspaceRoot]
        )
        const codeWorkspaceRoots = rememberCodeWorkspaceRoots(readCodeWorkspaceRoots(), [workspaceRoot])
        // Older SciForge settings can contain a valid runtime key while
        // predating the explicit Model API / Coding Plan selection. Do not
        // probe a runtime with that ambiguous billing configuration: route it
        // through the current setup experience instead. Settings that already
        // completed the new flow (including macOS installs) are unchanged.
        const modelAccess = getModelAccessSettings(settings)
        const needsInitialSetup = !modelAccess || !getActiveAgentApiKey(settings).trim()
        applyTheme(settings.theme)
        applyUiFontScale(settings.uiFontScale)
        await get().applyI18nFromSettings(settings.locale)
        set({
          route: 'chat',
          initialSetupOpen: needsInitialSetup,
          initialSetupMode: 'required',
          workspaceRoot,
          codeWorkspaceRoots,
          hiddenCodeWorkspaceRoots,
          workspaceLabel: workspaceLabelFromPath(workspaceRoot),
          activeAgentRuntime: getActiveAgentRuntime(settings),
          modelAccessMode: modelAccess?.mode ?? null,
          runtimeConnection: needsInitialSetup ? 'idle' : get().runtimeConnection,
          error: needsInitialSetup ? null : get().error,
          runtimeErrorDetail: needsInitialSetup ? null : get().runtimeErrorDetail
        })
        if (needsInitialSetup) return
        const initialPick = get().composerPickList
        const fromStorage = readStoredComposerModel(initialPick)
        if (fromStorage) {
          set({ composerModel: fromStorage })
        }
        await get().probeRuntime('user')
      } catch (e) {
        if (!shouldOpenSettingsForError(e)) scheduleRuntimeBootRetry(get)
        set({
          error: formatRuntimeError(e),
          runtimeErrorDetail: runtimeErrorDetail(e),
          runtimeConnection: 'offline',
          initialSetupOpen: false,
          initialSetupMode: 'required',
          ...(shouldOpenSettingsForError(e)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
    })().finally(() => {
      bootPromise = null
    })
    return bootPromise
  },

  chooseWorkspace: async ({ createThreadAfter = false, selectThreadAfter = true } = {}) => {
    const ownerSessionId = get().activeThreadId
    try {
      if (typeof window.sciforge === 'undefined' || typeof window.sciforge.pickWorkspaceDirectory !== 'function') {
        throw new Error(i18n.t('common:workspacePickerUnavailable'))
      }
      const picked = await window.sciforge.pickWorkspaceDirectory(get().workspaceRoot || undefined)
      if (picked.canceled || !picked.path) {
        if (createThreadAfter) {
          set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
        }
        return null
      }
      const next = await rendererRuntimeClient.setSettings({ workspaceRoot: picked.path })
      const workspaceRoot = normalizeWorkspaceRoot(next.workspaceRoot)
      const hiddenCodeWorkspaceRoots = restoreHiddenCodeWorkspaceRoots(
        get().hiddenCodeWorkspaceRoots ?? [],
        [workspaceRoot]
      )
      const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])

      // Update the active thread's workspace so the current session
      // moves to the newly picked directory instead of creating a
      // new thread or switching away. Only treat the thread as moved
      // when the PATCH actually succeeds — otherwise we must fall
      // through to the fallback selection below, or the global
      // workspaceRoot and the active thread would diverge.
      let movedActiveThread = false
      if (ownerSessionId && workspaceRoot) {
        const p = getProvider()
        if (typeof p.updateThreadWorkspace === 'function') {
          try {
            await p.updateThreadWorkspace(ownerSessionId, workspaceRoot)
            // Update the local threads list so the sidebar shows the
            // thread under the new workspace immediately.
            set((s) => ({
              threads: s.threads.map((thread) =>
                thread.id === ownerSessionId ? { ...thread, workspace: workspaceRoot } : thread
              )
            }))
            movedActiveThread = true
          } catch {
            // PATCH failed — leave movedActiveThread false so we fall
            // through to the existing fallback selection below.
          }
        }
      }

      set((state) => ({
        codeWorkspaceRoots,
        hiddenCodeWorkspaceRoots,
        ...(state.activeThreadId === ownerSessionId
          ? {
              workspaceRoot,
              workspaceLabel: workspaceLabelFromPath(workspaceRoot),
              error: null
            }
          : {})
      }))
      await get().refreshThreads()
      if (workspaceRoot) {
        if (get().activeThreadId !== ownerSessionId) return workspaceRoot
        if (!selectThreadAfter) return workspaceRoot
        // If we successfully moved the active thread, stay on it.
        if (movedActiveThread) return workspaceRoot
        const workspaceThreads = get().threads
          .filter((thread) => isCodeThread(thread))
          .filter((thread) => threadBelongsToWorkspace(thread, workspaceRoot))
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

        if (createThreadAfter) {
          await get().createThread({ workspaceRoot })
        } else {
          const targetThreadId = workspaceThreads[0]?.id
          if (targetThreadId && get().activeThreadId !== targetThreadId) {
            await get().selectThread(targetThreadId)
          } else if (!targetThreadId) {
            const activeThread = get().activeThreadId
              ? get().threads.find((thread) => thread.id === get().activeThreadId) ?? null
              : null
            if (!activeThread || !threadBelongsToWorkspace(activeThread, workspaceRoot)) {
              const state = get()
              const nextWatch = { ...(state.watchTurnCompletion ?? {}) }
              if (state.activeThreadId && state.busy) {
                nextWatch[state.activeThreadId] = true
                watchTurnCompletionNotification(state.activeThreadId)
              }
              sseAbortRef.current?.abort()
              sseAbortRef.current = null
              clearBusyWatchdog()
              set({
                ...clearedThreadSelection(),
                route: 'chat',
                watchTurnCompletion: nextWatch
              })
              syncTurnCompletionPoll(set, get)
            }
          }
        }
      }
      return workspaceRoot
    } catch (e) {
      set({
        error: formatWorkspacePickerError(e)
      })
      return null
    }
  },

  clearWorkspace: async () => {
    try {
      if (typeof window.sciforge === 'undefined' || typeof window.sciforge.setSettings !== 'function') {
        return
      }
      const next = await rendererRuntimeClient.setSettings({ workspaceRoot: '' })
      set({
        workspaceRoot: normalizeWorkspaceRoot(next.workspaceRoot),
        codeWorkspaceRoots: get().codeWorkspaceRoots,
        workspaceLabel: workspaceLabelFromPath(''),
        error: null
      })
      await get().refreshThreads()
    } catch {
      // silently ignore — the workspace will remain set
    }
  },

  deleteWorkspace: async (workspacePath) => {
    const normalizedPath = normalizeWorkspaceRoot(workspacePath)
    if (!normalizedPath) return
    const { activeThreadId } = get()
    const workspaceThreads = get().threads.filter((thread) =>
      threadBelongsToWorkspace(thread, normalizedPath)
    )
    const removingActive = workspaceThreads.some((th) => th.id === activeThreadId)
    if (removingActive) {
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
    }
    const hiddenCodeWorkspaceRoots = hideCodeWorkspaceRoot(
      get().hiddenCodeWorkspaceRoots ?? [],
      normalizedPath
    )
    const codeWorkspaceRoots = forgetCodeWorkspaceRoot(get().codeWorkspaceRoots, normalizedPath)
    const removeIds = new Set(workspaceThreads.map((th) => th.id))
    set((s) => {
      const w = { ...s.watchTurnCompletion }
      const u = { ...s.unreadThreadIds }
      for (const tid of removeIds) {
        delete w[tid]
        delete u[tid]
        clearWatchedCompletionNotification(tid)
      }
      return {
        codeWorkspaceRoots,
        hiddenCodeWorkspaceRoots,
        watchTurnCompletion: w,
        unreadThreadIds: u,
        ...(removingActive ? clearedThreadSelection() : {}),
        error: null
      }
    })
    for (const threadId of removeIds) disposeSessionRightPanelWorkspace(threadId)
    // If the removed workspace is the current workspaceRoot, clear it.
    if (normalizeWorkspaceRoot(get().workspaceRoot) === normalizedPath) {
      try {
        if (typeof window.sciforge?.setSettings === 'function') {
          const next = await rendererRuntimeClient.setSettings({ workspaceRoot: '' })
          set({
            workspaceRoot: normalizeWorkspaceRoot(next.workspaceRoot),
            codeWorkspaceRoots: get().codeWorkspaceRoots,
            workspaceLabel: workspaceLabelFromPath('')
          })
        }
      } catch {
        /* silently keep workspaceRoot if settings clear fails */
      }
    }
    await get().refreshThreads()
  },

  refreshThreads: async () => {
    if (get().runtimeConnection !== 'ready') return
    const requestSeq = ++refreshThreadsRequestSeq
    try {
      const p = getProvider()
      const showArchived = get().showArchivedThreads === true
      const search = get().threadSearch.trim()
      const expandedList = showArchived || search.length > 0
      const hiddenSideThreadIds = attachedSideConversationThreadIds(get())
      let rawThreads: NormalizedThread[]
      try {
        rawThreads = await p.listThreads({
          limit: expandedList ? EXPANDED_THREAD_LIST_LIMIT : DEFAULT_THREAD_LIST_LIMIT,
          ...(showArchived ? { includeArchived: true } : {}),
          ...(search ? { search } : {})
        })
      } catch {
        rawThreads = await p.listThreads()
      }
      const threads = rawThreads.map((thread) => ({
        ...thread,
        workspace: normalizeWorkspaceRoot(thread.workspace)
      }))
      const sddThreadRegistry = readSddThreadRegistry()
      const hiddenCodeWorkspaceRoots = get().hiddenCodeWorkspaceRoots ?? []
      const codeWorkspaceRoots = rememberCodeWorkspaceRoots(
        get().codeWorkspaceRoots,
        filterHiddenCodeWorkspaceRoots(
          threads
            .filter((thread) => isCodeThread(thread))
            .map((thread) => thread.workspace),
          hiddenCodeWorkspaceRoots
        )
      )
      const applySidebarThreads = async (candidateThreads: NormalizedThread[]): Promise<void> => {
        const sidebarThreads = candidateThreads.filter((thread) =>
          !isSddAssistantThread(thread, sddThreadRegistry) &&
          !isEmptySddAssistantThreadCandidate(thread)
        )
        if (requestSeq !== refreshThreadsRequestSeq) return
        const forkRegistry = hydrateThreadForkRegistry(sidebarThreads, readThreadForkRegistry())
        saveThreadForkRegistry(forkRegistry)
        const enrichedThreads = enrichThreadsWithForkInfo(sidebarThreads, forkRegistry)
        // Preserve the active runtime thread when it is not in the listing yet.
        // A brand-new thread can be absent from `listThreads` until the first
        // message is written. Without this, the optimistic thread would be wiped
        // from the sidebar and its live turn aborted by the selection clearing
        // path below.
        const activeId = get().activeThreadId
        const activeRawThread = activeId
          ? threads.find((thread) => thread.id === activeId) ?? null
          : null
        const storedActiveThread = activeId
          ? get().threads.find((thread) => thread.id === activeId) ?? null
          : null
        const activeThreadIsAuxiliary = activeId != null &&
          (
            hiddenSideThreadIds.has(activeId.trim()) ||
            threadIsAuxiliarySidebarEntry(activeRawThread ?? storedActiveThread, hiddenSideThreadIds)
          )
        const activeThreadIsSdd =
          isSddAssistantThread(activeRawThread, sddThreadRegistry) ||
          isSddAssistantThread(
            storedActiveThread,
            sddThreadRegistry
          ) ||
          isEmptySddAssistantThreadCandidate(activeRawThread) ||
          isEmptySddAssistantThreadCandidate(
            storedActiveThread
          )
        const activeThreadWasFilteredFromSidebar =
          !activeThreadIsSdd &&
          (
            activeThreadIsAuxiliary ||
            activeThreadFilteredFromSidebar({ activeId, rawThreads: threads, sidebarThreads })
          )
        const preservedSddActiveThread =
          activeThreadIsSdd && activeId
            ? activeRawThread ?? get().threads.find((thread) => thread.id === activeId) ?? null
            : null
        const pendingActiveThread =
          activeId != null &&
          !activeThreadWasFilteredFromSidebar &&
          !enrichedThreads.some((thread) => thread.id === activeId)
            ? storedActiveThread
            : null
        let displayThreads = pendingActiveThread
          ? [pendingActiveThread, ...enrichedThreads]
          : enrichedThreads
        if (
          preservedSddActiveThread &&
          !displayThreads.some((thread) => thread.id === preservedSddActiveThread.id)
        ) {
          displayThreads = [preservedSddActiveThread, ...displayThreads]
        }
        const activeThreadId = get().activeThreadId
        const activeThread = activeThreadId
          ? displayThreads.find((thread) => thread.id === activeThreadId) ?? null
          : null
        const activeThreadHasLocalConversation =
          activeId != null &&
          (
            get().blocks.length > 0 ||
            Boolean((get().liveAssistant ?? '').trim()) ||
            Boolean((get().liveReasoning ?? '').trim()) ||
            (get().queuedMessages ?? []).some((message) =>
              message.threadId === activeId || message.targetThreadId === activeId
            ) ||
            stateHasRecoverableActiveTurn(get())
          )
        const shouldClearSelection =
          activeThreadId != null &&
          (
            activeThreadIsAuxiliary ||
            (
              !activeThreadHasLocalConversation &&
              !displayThreads.some((thread) => thread.id === activeThreadId)
            )
          )
        const locallyActiveThread =
          activeThreadHasLocalConversation && activeId && !activeThreadIsAuxiliary
            ? preserveLocalActiveThreadForSidebar(
                activeRawThread ?? storedActiveThread,
                get().blocks
              )
            : null
        if (
          locallyActiveThread &&
          !displayThreads.some((thread) => thread.id === locallyActiveThread.id)
        ) {
          displayThreads = [locallyActiveThread, ...displayThreads]
        }
        if (shouldClearSelection) {
          sseAbortRef.current?.abort()
          sseAbortRef.current = null
        }
        const validIds = new Set(displayThreads.map((t) => t.id))
        set((s) => {
          const w: Record<string, boolean> = {}
          for (const [k, v] of Object.entries(s.watchTurnCompletion)) {
            if (v && validIds.has(k)) {
              w[k] = true
            } else {
              clearWatchedCompletionNotification(k)
            }
          }
          const u: Record<string, boolean> = {}
          for (const [k, v] of Object.entries(s.unreadThreadIds)) {
            if (v && validIds.has(k)) u[k] = true
          }
          return {
            threads: displayThreads,
            codeWorkspaceRoots: filterHiddenCodeWorkspaceRoots(
              compactCodeWorkspaceRoots([
                ...displayThreads
                  .filter((thread) => isCodeThread(thread))
                  .map((thread) => thread.workspace),
                ...codeWorkspaceRoots
              ]),
              s.hiddenCodeWorkspaceRoots ?? []
            ),
            watchTurnCompletion: w,
            unreadThreadIds: u,
            ...(shouldClearSelection ? clearedThreadSelection() : {})
          }
        })
        syncTurnCompletionPoll(set, get)
        if (!shouldClearSelection && get().activeThreadId && stateHasRecoverableActiveTurn(get())) {
          armBusyWatchdog(set, get)
        }
        syncRuntimeThreadRefreshPoll(get)
      }

      const filteredThreads = filterThreadsForSidebar(threads, {
        hiddenThreadIds: hiddenSideThreadIds
      })
      await applySidebarThreads(filteredThreads)
    } catch (e) {
      if (requestSeq !== refreshThreadsRequestSeq) return
      stopRuntimeThreadRefreshPoll()
      stopTurnCompletionPoll()
      set({
        runtimeConnection: 'offline',
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  setThreadSearch: (query) => {
    set({ threadSearch: query })
  },

  setShowArchivedThreads: (show) => {
    set({ showArchivedThreads: show })
    if (show && get().runtimeConnection === 'ready') {
      void get().refreshThreads()
    }
  },
  }
}
