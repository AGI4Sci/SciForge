import type {
  ThreadGoal,
  ThreadGoalStatus,
  ThreadTodoList,
  ThreadTodoStatus
} from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
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
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  activeRemoteChannel,
  compactCodeWorkspaceRoots,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isRemoteChannelThread,
  optimisticUserModelLabel,
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
  rememberProviderThreadRuntime,
  reconcileOptimisticUserBlock,
  settlePendingRuntimeWorkAfterInterrupt,
  threadSnapshotLooksRunning,
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
import {
  extractPlanTodos,
  mergePlanTodosForRenderer,
  sameTodoWriteItems,
  threadTodoWriteItems
} from '../plan/plan-todo-sync'
import { providerSupportsCapability } from './chat-store-provider-capabilities'
import { disposeSessionRightPanelWorkspace } from '../lib/session-right-panel-lifecycle'

type SseAbortRef = { current: AbortController | null }

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

function applyGoalSnapshot(
  set: ChatStoreSet,
  threadId: string,
  goal: ThreadGoal | null,
  updatedAt = new Date().toISOString()
): void {
  set((s) => ({
    activeThreadGoal: s.activeThreadId === threadId ? goal : s.activeThreadGoal,
    threads: s.threads.map((thread) =>
      thread.id === threadId
        ? { ...thread, goal, updatedAt: goal?.updatedAt ?? updatedAt }
        : thread
    )
  }))
}

function applyTodosSnapshot(
  set: ChatStoreSet,
  threadId: string,
  todos: ThreadTodoList | null,
  updatedAt = new Date().toISOString()
): void {
  set((s) => ({
    activeThreadTodos: s.activeThreadId === threadId ? todos : s.activeThreadTodos,
    threads: s.threads.map((thread) =>
      thread.id === threadId
        ? { ...thread, todos, updatedAt: todos?.updatedAt ?? updatedAt }
        : thread
    )
  }))
}

function reportThreadOwnedError(
  set: ChatStoreSet,
  get: ChatStoreGet,
  threadId: string,
  cause: unknown
): void {
  if (get().activeThreadId !== threadId) return
  set({
    error: formatRuntimeError(cause),
    ...(shouldOpenSettingsForError(cause)
      ? { route: 'settings' as const, settingsSection: 'agents' as const }
      : {})
  })
}

function settleInterruptedTurn(set: ChatStoreSet, get: ChatStoreGet): void {
  resetBusyRecoveryAttempts()
  clearBusyWatchdog()
  set((s) => {
    const out = flushLiveBlocks(s, {
      ...finalizeTurnTiming(s),
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      error: null
    })
    const blocks = settlePendingRuntimeWorkAfterInterrupt(out.blocks ?? s.blocks)
    return { ...out, blocks }
  })
}

function rememberActionThreadRuntime(
  provider: { rememberThreadRuntime?: (threadId: string, runtimeId?: ChatState['threads'][number]['runtimeId']) => void },
  get: ChatStoreGet,
  threadId: string
): void {
  rememberProviderThreadRuntime(provider, threadId, get().threads)
}

export function createMaintenanceActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'renameActiveThread' | 'renameThread' | 'archiveThread' | 'compactActiveThread' | 'forkActiveThread' | 'setActiveThreadGoal' | 'setActiveThreadGoalStatus' | 'clearActiveThreadGoal' | 'setThreadTodoStatus' | 'clearThreadTodos' | 'syncPlanTodosFromMarkdown' | 'resumeSessionIntoThread' | 'deleteThread' | 'rewindAndResend' | 'resolveApproval' | 'resolveUserInput' | 'interrupt'> {
  return {
  renameActiveThread: async (title) => {
    const { activeThreadId } = get()
    if (!activeThreadId) return
    await get().renameThread(activeThreadId, title)
  },

  renameThread: async (threadId, title) => {
    const targetId = threadId.trim()
    const nextTitle = title.trim()
    if (!targetId || !nextTitle) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const p = getProvider()
    try {
      rememberActionThreadRuntime(p, get, targetId)
      await p.renameThread(targetId, nextTitle)
      set((s) => ({
        threads: s.threads.map((thread) =>
          thread.id === targetId ? { ...thread, title: nextTitle } : thread
        ),
        error: null
      }))
      await get().refreshThreads()
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  archiveThread: async (threadId, archived) => {
    const targetId = threadId.trim()
    if (!targetId) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const { activeThreadId } = get()
    const p = getProvider()
    const archivingActive = archived && activeThreadId === targetId
    try {
      rememberActionThreadRuntime(p, get, targetId)
      if (typeof p.archiveThread === 'function') {
        await p.archiveThread(targetId, archived)
      } else if (archived) {
        await p.deleteThread(targetId)
      } else {
        throw new Error(i18n.t('common:runtimeFeatureUnsupported'))
      }
      if (archivingActive) {
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
        clearBusyWatchdog()
      }
      set((s) => {
        const w = { ...s.watchTurnCompletion }
        const u = { ...s.unreadThreadIds }
        if (archived) {
          delete w[targetId]
          delete u[targetId]
          clearWatchedCompletionNotification(targetId)
        }
        return {
          threads: s.threads.map((thread) =>
            thread.id === targetId ? { ...thread, archived } : thread
          ),
          watchTurnCompletion: w,
          unreadThreadIds: u,
          ...(archivingActive ? clearedThreadSelection() : {}),
          error: null
        }
      })
      if (archived) disposeSessionRightPanelWorkspace(targetId)
      await get().refreshThreads()
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  compactActiveThread: async (reason) => {
    const { activeThreadId, busy } = get()
    if (!activeThreadId) return
    if (busy) {
      set({ error: i18n.t('common:threadActionBusy') })
      return
    }
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const p = getProvider()
    if (typeof p.compactThread !== 'function' || !providerSupportsCapability(p, 'compact')) {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return
    }
    try {
      rememberActionThreadRuntime(p, get, activeThreadId)
      await p.compactThread(activeThreadId, reason)
      await get().refreshThreads()
      await get().selectThread(activeThreadId)
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  forkActiveThread: async () => {
    const { activeThreadId, busy, blocks } = get()
    if (!activeThreadId) return
    if (busy) {
      set({ error: i18n.t('common:threadActionBusy') })
      return
    }
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const p = getProvider()
    if (typeof p.forkThread !== 'function' || !providerSupportsCapability(p, 'fork')) {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return
    }
    try {
      rememberActionThreadRuntime(p, get, activeThreadId)
      const parentThread =
        get().threads.find((thread) => thread.id === activeThreadId) ?? {
          id: activeThreadId,
          title: activeThreadId.slice(0, 8)
        }
      const forked = await p.forkThread(activeThreadId)
      saveThreadForkRegistry(
        markThreadFork(
          forked.id,
          parentThread,
          {
            createdAt: forked.forkedAt ?? new Date().toISOString(),
            forkedFromMessageCount: forked.forkedFromMessageCount ?? forkedMessageCount(blocks),
            forkedFromTurnCount: forked.forkedFromTurnCount ?? forkedTurnCount(blocks)
          },
          readThreadForkRegistry()
        )
      )
      await get().refreshThreads()
      await get().selectThread(forked.id)
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  setActiveThreadGoal: async (objective) => {
    const trimmed = objective.trim()
    if (!trimmed) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    let { activeThreadId } = get()
    if (!activeThreadId) {
      await get().createThread()
      activeThreadId = get().activeThreadId
    }
    if (!activeThreadId) return false
    const p = getProvider()
    if (typeof p.setThreadGoal !== 'function' || !providerSupportsCapability(p, 'goals')) {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return false
    }
    try {
      rememberActionThreadRuntime(p, get, activeThreadId)
      const goal = await p.setThreadGoal(activeThreadId, {
        objective: trimmed,
        status: 'active'
      })
      applyGoalSnapshot(set, activeThreadId, goal)
      await get().refreshThreads()
      return get().sendMessage(goal.objective, 'agent', {
        displayText: i18n.t('common:goalUserMessage', { objective: goal.objective })
      })
    } catch (e) {
      reportThreadOwnedError(set, get, activeThreadId, e)
      return false
    }
  },

  setActiveThreadGoalStatus: async (status: ThreadGoalStatus) => {
    const { activeThreadId } = get()
    if (!activeThreadId) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    if (typeof p.setThreadGoal !== 'function' || !providerSupportsCapability(p, 'goals')) {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return false
    }
    try {
      rememberActionThreadRuntime(p, get, activeThreadId)
      const goal = await p.setThreadGoal(activeThreadId, { status })
      applyGoalSnapshot(set, activeThreadId, goal)
      await get().refreshThreads()
      return true
    } catch (e) {
      reportThreadOwnedError(set, get, activeThreadId, e)
      return false
    }
  },

  clearActiveThreadGoal: async () => {
    const { activeThreadId } = get()
    if (!activeThreadId) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    if (typeof p.clearThreadGoal !== 'function' || !providerSupportsCapability(p, 'goals')) {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return false
    }
    try {
      rememberActionThreadRuntime(p, get, activeThreadId)
      const cleared = await p.clearThreadGoal(activeThreadId)
      if (cleared) {
        applyGoalSnapshot(set, activeThreadId, null)
      }
      await get().refreshThreads()
      return cleared
    } catch (e) {
      reportThreadOwnedError(set, get, activeThreadId, e)
      return false
    }
  },

  setThreadTodoStatus: async (threadId: string, todoId: string, status: ThreadTodoStatus) => {
    const targetThreadId = threadId.trim()
    const state = get()
    const threadTodos = state.activeThreadId === targetThreadId
      ? state.activeThreadTodos
      : state.threads.find((thread) => thread.id === targetThreadId)?.todos ?? null
    if (!targetThreadId || !threadTodos) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    if (typeof p.setThreadTodos !== 'function' || !providerSupportsCapability(p, 'todos')) {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return false
    }
    try {
      rememberActionThreadRuntime(p, get, targetThreadId)
      const nextItems = threadTodos.items.map((item) => {
        if (item.id === todoId) return { ...item, status }
        if (status === 'in_progress' && item.status === 'in_progress') {
          return { ...item, status: 'pending' as const }
        }
        return item
      })
      const todos = await p.setThreadTodos(targetThreadId, threadTodoWriteItems({
        ...threadTodos,
        items: nextItems
      }))
      applyTodosSnapshot(set, targetThreadId, todos)
      return true
    } catch (e) {
      reportThreadOwnedError(set, get, targetThreadId, e)
      return false
    }
  },

  clearThreadTodos: async (threadId: string) => {
    const targetThreadId = threadId.trim()
    if (!targetThreadId) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    if (typeof p.clearThreadTodos !== 'function' || !providerSupportsCapability(p, 'todos')) {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return false
    }
    try {
      rememberActionThreadRuntime(p, get, targetThreadId)
      const cleared = await p.clearThreadTodos(targetThreadId)
      if (cleared) applyTodosSnapshot(set, targetThreadId, null)
      return cleared
    } catch (e) {
      reportThreadOwnedError(set, get, targetThreadId, e)
      return false
    }
  },

  syncPlanTodosFromMarkdown: async (threadId, plan, markdown) => {
    const targetThreadId = threadId.trim()
    if (!targetThreadId) return false
    const state = get()
    const existingTodos = state.activeThreadId === targetThreadId
      ? state.activeThreadTodos
      : (state.threads.find((thread) => thread.id === targetThreadId)?.todos ?? null)
    if (get().runtimeConnection !== 'ready') return false
    const p = getProvider()
    if (typeof p.setThreadTodos !== 'function') return false
    const now = new Date().toISOString()
    const planItems = extractPlanTodos({
      markdown,
      threadId: targetThreadId,
      planId: plan.id,
      relativePath: plan.relativePath,
      now
    })
    const nextTodos = mergePlanTodosForRenderer({
      threadId: targetThreadId,
      existing: existingTodos,
      planItems,
      now
    })
    const currentWriteItems = existingTodos ? threadTodoWriteItems(existingTodos) : []
    const nextWriteItems = threadTodoWriteItems(nextTodos)
    if (sameTodoWriteItems(currentWriteItems, nextWriteItems)) return true
    try {
      rememberActionThreadRuntime(p, get, targetThreadId)
      const todos = await p.setThreadTodos(targetThreadId, nextWriteItems)
      applyTodosSnapshot(set, targetThreadId, todos)
      return true
    } catch (e) {
      reportThreadOwnedError(set, get, targetThreadId, e)
      return false
    }
  },

  resumeSessionIntoThread: async (sessionId, options) => {
    const id = sessionId.trim()
    if (!id) return null
    const sourceThreadId = get().activeThreadId ?? id
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return null
    }
    const p = getProvider()
    if (typeof p.resumeSession !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return null
    }
    try {
      const result = await p.resumeSession(id, options)
      await get().refreshThreads()
      await get().selectThread(result.threadId)
      return result.threadId
    } catch (e) {
      if (sourceThreadId) {
        await get().refreshActiveThreadContextState(sourceThreadId)
      }
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return null
    }
  },

  deleteThread: async (threadId) => {
    const targetId = threadId.trim()
    if (!targetId) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const { activeThreadId } = get()
    const p = getProvider()
    const deletingActive = activeThreadId === targetId
    try {
      rememberActionThreadRuntime(p, get, targetId)
      await p.deleteThread(targetId)
      saveThreadForkRegistry(forgetThreadFork(targetId))
      if (deletingActive) {
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
        clearBusyWatchdog()
      }
      set((s) => {
        const w = { ...s.watchTurnCompletion }
        delete w[targetId]
        clearWatchedCompletionNotification(targetId)
        const u = { ...s.unreadThreadIds }
        delete u[targetId]
        return {
          threads: s.threads.filter((thread) => thread.id !== targetId),
          watchTurnCompletion: w,
          unreadThreadIds: u,
          ...(deletingActive ? clearedThreadSelection() : {}),
          error: null
        }
      })
      disposeSessionRightPanelWorkspace(targetId)
      await get().refreshThreads()
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  rewindAndResend: async (userBlockId, newText) => {
    const trimmed = newText.trim()
    if (!trimmed) return
    const state = get()
    if (state.busy) {
      set({ error: i18n.t('common:rewindBusyError') })
      return
    }
    const idx = state.blocks.findIndex((b) => b.id === userBlockId && b.kind === 'user')
    if (idx < 0) return

    // Drop the target user block and everything after it. The runtime keeps
    // the old items on disk; this only truncates what the UI shows. A future
    // reload of this thread will surface the old items again — acceptable
    // tradeoff while no rewind endpoint is exposed by the runtime.
    const trimmedBlocks = state.blocks.slice(0, idx)

    const droppedUserIds = state.blocks
      .slice(idx)
      .filter((b) => b.kind === 'user')
      .map((b) => b.id)
    const turnStartedAtByUserId = { ...state.turnStartedAtByUserId }
    const turnDurationByUserId = { ...state.turnDurationByUserId }
    const turnReasoningFirstAtByUserId = { ...state.turnReasoningFirstAtByUserId }
    const turnReasoningLastAtByUserId = { ...state.turnReasoningLastAtByUserId }
    for (const id of droppedUserIds) {
      delete turnStartedAtByUserId[id]
      delete turnDurationByUserId[id]
      delete turnReasoningFirstAtByUserId[id]
      delete turnReasoningLastAtByUserId[id]
    }

    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()

    set({
      blocks: trimmedBlocks,
      liveReasoning: '',
      liveAssistant: '',
      currentTurnId: null,
      currentTurnUserId: null,
      turnStartedAtByUserId,
      turnDurationByUserId,
      turnReasoningFirstAtByUserId,
      turnReasoningLastAtByUserId,
      queuedMessages: [],
      error: null
    })

    await get().sendMessage(trimmed)
  },

  resolveApproval: async (blockId, decision) => {
    const { blocks } = get()
    const block = blocks.find((b) => b.id === blockId)
    if (!block || block.kind !== 'approval' || block.status !== 'pending') return
    const p = getProvider()
    if (typeof p.submitApprovalDecision !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return
    }
    try {
      await p.submitApprovalDecision(
        block.approvalId,
        decision === 'allow' ? 'allow' : 'deny',
        false
      )
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'approval'
            ? { ...b, status: decision === 'allow' ? ('allowed' as const) : ('denied' as const) }
            : b
        )
      }))
    } catch (e) {
      const msg = formatRuntimeError(e)
      void window.sciforge.logError('approval', 'Failed to submit approval decision', {
        message: msg,
        blockId
      }).catch(() => undefined)
      set((s) => ({
        error: msg,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {}),
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'approval'
            ? { ...b, status: 'error' as const, errorMessage: msg }
            : b
        )
      }))
    }
  },

  resolveUserInput: async (blockId, action) => {
    const { blocks } = get()
    const block = blocks.find((b) => b.id === blockId)
    if (!block || block.kind !== 'user_input' || block.status !== 'pending') return
    const p = getProvider()
    try {
      if (action.kind === 'submit') {
        if (typeof p.submitUserInputResponse !== 'function') {
          throw new Error(i18n.t('common:runtimeUserInputUnsupported'))
        }
        await p.submitUserInputResponse(block.requestId, action.answers)
        if (get().busy) armBusyWatchdog(set, get)
        set((s) => ({
          blocks: s.blocks.map((b) =>
            b.id === blockId && b.kind === 'user_input'
              ? { ...b, status: 'submitted' as const, answers: action.answers }
              : b
          )
        }))
        return
      }

      if (typeof p.cancelUserInput !== 'function') {
        throw new Error(i18n.t('common:runtimeUserInputUnsupported'))
      }
      await p.cancelUserInput(block.requestId)
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'user_input'
            ? { ...b, status: 'cancelled' as const }
            : b
        )
      }))
    } catch (e) {
      const msg = formatRuntimeError(e)
      void window.sciforge.logError('user-input', 'Failed to resolve user input', {
        message: msg,
        blockId
      }).catch(() => undefined)
      set((s) => ({
        error: msg,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {}),
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'user_input'
            ? { ...b, status: 'error' as const, errorMessage: msg }
            : b
        )
      }))
    }
  },

  interrupt: async (options) => {
    const { activeThreadId, busy, currentTurnId } = get()
    if (!activeThreadId) return
    if (!currentTurnId) {
      if (!busy) return
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      settleInterruptedTurn(set, get)
      void get().refreshThreads()
      return
    }
    const p = getProvider()
    try {
      const interruptOptions = options?.discard === undefined
        ? undefined
        : { discard: options.discard === true }
      rememberActionThreadRuntime(p, get, activeThreadId)
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      settleInterruptedTurn(set, get)
      await p.interruptTurn(activeThreadId, currentTurnId, interruptOptions)
      void get().refreshThreads()
    } catch (e) {
      if (getRuntimeErrorCode(e) === 'turn_not_running') {
        settleInterruptedTurn(set, get)
        void get().refreshThreads()
        return
      }
      const msg = formatRuntimeError(e)
      if (typeof window !== 'undefined' && typeof window.sciforge?.logError === 'function') {
        void window.sciforge.logError('interrupt', 'Failed to interrupt turn', { message: msg }).catch(() => undefined)
      }
      set({
        error: msg,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  }
  }
}
