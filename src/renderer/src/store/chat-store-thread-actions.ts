import type { AgentProvider, ChatBlock, NormalizedThread, ReviewTarget, ThreadEventSink } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError } from '../lib/format-runtime-error'
import { parseRuntimeErrorBody } from '@shared/runtime-error'
import {
  deriveThreadTitleFromPrompt,
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
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { parseSteerCommand } from '../lib/steer-command'
import {
  buildCodeRuntimePrompt,
  getActiveAgentApiKey
} from '@shared/app-settings'
import type { AgentRuntimeContextState } from '@shared/agent-runtime-contract'
import type { ChatState, ChatStoreGet, ChatStoreSet, QueuedUserMessage } from './chat-store-types'
import { resetAgentFocusState } from './chat-store-focus-actions'
import {
  createClientDirectiveId,
  compactCodeWorkspaceRoots,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
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
  reconcileOptimisticUserBlock,
  rememberProviderThreadRuntime,
  settlePendingRuntimeWorkAfterCompletion,
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
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import { providerSupportsCapability } from './chat-store-provider-capabilities'
import { rekeySessionRightPanelWorkspace } from '../lib/session-right-panel-lifecycle'
import { draftSessionRightPanelId } from '../lib/session-right-panel-owner'
import { normalizeRuntimeFileReferences } from '../lib/runtime-file-references'

type SseAbortRef = { current: AbortController | null }

function adoptExplicitHandoffThread(
  threads: NormalizedThread[],
  previousThreadId: string,
  deliveredThreadId: string,
  runtimeId: NormalizedThread['runtimeId']
): NormalizedThread[] {
  const delivered = threads.find((thread) => thread.id === deliveredThreadId) ?? null
  let changed = false
  const next: NormalizedThread[] = []

  for (const thread of threads) {
    if (thread.id === previousThreadId && previousThreadId !== deliveredThreadId) {
      changed = true
      if (!delivered) {
        next.push({
          ...thread,
          id: deliveredThreadId,
          ...(runtimeId ? { runtimeId } : {})
        })
      }
      continue
    }
    if (thread.id === deliveredThreadId && runtimeId && thread.runtimeId !== runtimeId) {
      changed = true
      next.push({ ...thread, runtimeId })
      continue
    }
    next.push(thread)
  }

  return changed ? next : threads
}

function watchBackgroundThreadCompletion(
  set: ChatStoreSet,
  get: ChatStoreGet,
  threadId: string
): void {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return
  set((s) => ({
    watchTurnCompletion: { ...s.watchTurnCompletion, [normalizedThreadId]: true }
  }))
  watchTurnCompletionNotification(normalizedThreadId)
  syncTurnCompletionPoll(set, get)
}

async function readProviderContextState(
  provider: AgentProvider,
  threadId: string
): Promise<AgentRuntimeContextState | null> {
  if (typeof provider.getContextState !== 'function') return null
  try {
    return await provider.getContextState(threadId)
  } catch {
    return null
  }
}

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

let drainingQueuedMessages = false
const backgroundQueueDrains = new Set<string>()

function resolveDraftWorkspaceRoot(
  state: ChatState,
  settingsWorkspaceRoot?: string | null,
  requestedWorkspaceRoot?: string | null
): string {
  const activeThread = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId)
    : null
  const [workspaceRoot] = compactCodeWorkspaceRoots([
    requestedWorkspaceRoot,
    activeThread?.workspace,
    state.workspaceRoot,
    state.codeWorkspaceRoots[0],
    settingsWorkspaceRoot
  ])
  return workspaceRoot ?? ''
}

function stripIpcErrorPrefix(message: string): string {
  return message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

function structuredRuntimeErrorCode(error: unknown): string | null {
  const raw = stripIpcErrorPrefix(error instanceof Error ? error.message : String(error ?? ''))
  const parsed = parseRuntimeErrorBody(raw, '')
  return parsed.code === 'unknown' ? null : parsed.code
}

function canSteerPlainTextMessage(
  message: Pick<QueuedUserMessage, 'attachmentIds' | 'attachments' | 'fileReferences' | 'guiPlan'>
): boolean {
  return !message.attachmentIds?.length &&
    !message.attachments?.length &&
    !message.fileReferences?.length &&
    !message.guiPlan
}

function subscribeThreadEventsWithRecovery(
  provider: AgentProvider,
  threadId: string,
  sinceSeq: number,
  sink: ThreadEventSink,
  signal: AbortSignal,
  get: ChatStoreGet
): void {
  rememberProviderThreadRuntime(provider, threadId, get().threads)
  void provider.subscribeThreadEvents(threadId, sinceSeq, sink, signal)
    .catch(() => undefined)
    .then(() => {
      if (signal.aborted) return
      const state = get()
      if (state.activeThreadId !== threadId || !state.busy) return
      void state.recoverActiveTurn()
    })
}

function threadSnapshotHasTurnEvidence(
  blocks: Parameters<typeof threadSnapshotLooksRunning>[0],
  latestTurnId?: string,
  latestUserMessageId?: string
): boolean {
  return Boolean(
    latestTurnId?.trim() ||
    latestUserMessageId?.trim() ||
    blocks.some(hasPendingRuntimeWork)
  )
}

function settleStalePendingBlocksWhenIdle<T extends Parameters<typeof threadSnapshotLooksRunning>[0]>(
  blocks: T,
  busy: boolean
): T {
  return busy ? blocks : settlePendingRuntimeWorkAfterCompletion(blocks) as T
}

function blocksContainUserMessage(blocks: ChatBlock[], userMessageId: string): boolean {
  return blocks.some((block) => block.kind === 'user' && block.id === userMessageId)
}

function userBlockText(block: ChatBlock): string {
  return block.kind === 'user' ? (block.meta?.displayText?.trim() || block.text.trim()) : ''
}

function blocksContainUserText(blocks: ChatBlock[], text: string): boolean {
  const normalizedText = text.trim()
  return Boolean(normalizedText) &&
    blocks.some((block) => block.kind === 'user' && userBlockText(block) === normalizedText)
}

function snapshotEndsWithUserMessage(
  blocks: ChatBlock[],
  userMessageId: string,
  text: string
): boolean {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (!block || block.kind === 'system' || block.kind === 'compaction') continue
    return block.kind === 'user' && (
      block.id === userMessageId || userBlockText(block) === text.trim()
    )
  }
  return false
}

function snapshotAttemptedUserMessageState(
  blocks: ChatBlock[],
  userMessageId: string,
  text: string,
  attemptedAt?: number
): 'absent' | 'pending' | 'answered' {
  const normalizedText = text.trim()
  let matchedIndex = -1
  for (const [index, block] of blocks.entries()) {
    if (block.kind !== 'user') continue
    if (block.id === userMessageId) {
      matchedIndex = index
      continue
    }
    if (userBlockText(block) !== normalizedText || attemptedAt === undefined) continue
    const createdAt = Date.parse(block.createdAt ?? '')
    // Runtime and renderer clocks can differ slightly. A bounded tolerance
    // still distinguishes this attempt from an old identical instruction.
    if (Number.isFinite(createdAt) && createdAt >= attemptedAt - 60_000) matchedIndex = index
  }
  if (matchedIndex < 0 && snapshotEndsWithUserMessage(blocks, userMessageId, normalizedText)) {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index]
      if (block?.kind === 'user' && (block.id === userMessageId || userBlockText(block) === normalizedText)) {
        matchedIndex = index
        break
      }
    }
  }
  if (matchedIndex < 0) return 'absent'
  return blocks.slice(matchedIndex + 1).some((block) => block.kind === 'assistant')
    ? 'answered'
    : 'pending'
}

function snapshotLooksStaleForCurrentTurn(
  state: ChatState,
  snapshotBlocks: ChatBlock[],
  latestTurnId?: string,
  latestUserMessageId?: string
): boolean {
  if (!state.busy && !state.currentTurnId && !state.currentTurnUserId) return false

  const currentUserId = state.currentTurnUserId?.trim()
  if (currentUserId) {
    const localCurrentUserBlock = state.blocks.find(
      (block) => block.kind === 'user' && block.id === currentUserId
    )
    const localHasCurrentUser = Boolean(localCurrentUserBlock)
    const localCurrentUserText = localCurrentUserBlock ? userBlockText(localCurrentUserBlock) : ''
    const snapshotHasCurrentUser =
      blocksContainUserMessage(snapshotBlocks, currentUserId) ||
      latestUserMessageId?.trim() === currentUserId ||
      blocksContainUserText(snapshotBlocks, localCurrentUserText)
    if (localHasCurrentUser && !snapshotHasCurrentUser) return true
  }

  const currentTurnId = state.currentTurnId?.trim()
  if (currentTurnId && !latestTurnId?.trim() && state.blocks.length > 0 && snapshotBlocks.length === 0) {
    return true
  }

  return false
}

export function queuedMessageMatchesThread(
  message: Pick<QueuedUserMessage, 'threadId' | 'runtimeId'>,
  threadId: string | null,
  runtimeId?: string
): boolean {
  if (!threadId) return false
  if (message.threadId && message.threadId !== threadId) return false
  // Thread ids are the primary routing key. A missing runtime id in a freshly
  // hydrated thread must not make an otherwise matching queue disappear.
  if (message.runtimeId && runtimeId && message.runtimeId !== runtimeId) return false
  return true
}

export function createThreadActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'createThread' | 'refreshActiveThreadContextState' | 'recoverActiveTurn' | 'selectThread' | 'loadEarlierThreadHistory' | 'drainQueuedMessages' | 'drainQueuedMessagesForThread' | 'removeQueuedMessage' | 'updateQueuedMessage' | 'retryQueuedMessage' | 'steerQueuedMessage' | 'sendMessage' | 'reviewActiveThread'> {
  let selectThreadRequestSeq = 0

  return {
  loadEarlierThreadHistory: async () => {
    const state = get()
    const threadId = state.activeThreadId
    const cursor = state.threadHistoryCursor
    if (!threadId || !cursor || state.threadHistoryLoading) return
    set({ threadHistoryLoading: true })
    try {
      const provider = getProvider()
      rememberProviderThreadRuntime(provider, threadId, state.threads)
      const page = await provider.getThreadPage(threadId, cursor)
      if (get().activeThreadId !== threadId) return
      const olderBlocks = hydrateBlockModelLabels(threadId, page.blocks)
      set((snapshot) => {
        const currentIds = new Set(snapshot.blocks.map((block) => block.id))
        return {
          blocks: [
            ...olderBlocks.filter((block) => !currentIds.has(block.id)),
            ...snapshot.blocks
          ],
          threadHistoryCursor: page.nextCursor
        }
      })
    } catch (error) {
      set({ error: formatRuntimeError(error) })
    } finally {
      if (get().activeThreadId === threadId) set({ threadHistoryLoading: false })
    }
  },

  refreshActiveThreadContextState: async (threadId) => {
    const targetThreadId = threadId?.trim() || get().activeThreadId
    if (!targetThreadId) {
      set({ activeThreadContextState: null })
      return
    }
    const p = getProvider()
    const contextState = await readProviderContextState(p, targetThreadId)
    if (get().activeThreadId !== targetThreadId) return
    set({ activeThreadContextState: contextState })
  },

  createThread: async (options = {}) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    try {
      const settings = await rendererRuntimeClient.getSettings()
      const workspaceLocator = get().workspaceLocator
      const requestedWorkspaceRoot = normalizeWorkspaceRoot(
        options.workspaceRoot ?? workspaceLocator?.path
      )
      const settingsWorkspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
      const workspaceRoot = resolveDraftWorkspaceRoot(get(), settingsWorkspaceRoot, requestedWorkspaceRoot)
      if (!workspaceLocator && workspaceRoot && workspaceRoot !== settingsWorkspaceRoot) {
        try {
          await rendererRuntimeClient.setSettings({ workspaceRoot })
        } catch (error) {
          void window.sciforge.logError('create-thread', requestedWorkspaceRoot
            ? 'Failed to sync requested workspace before creating thread'
            : 'Failed to sync draft workspace before creating thread', {
            message: error instanceof Error ? error.message : String(error),
            workspaceRoot
          }).catch(() => undefined)
        } finally {
          set((s) => ({
            workspaceRoot,
            workspaceLabel: workspaceLabelFromPath(workspaceRoot),
            codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [workspaceRoot])
          }))
        }
      }
      if (!workspaceRoot) {
        await get().chooseWorkspace({ createThreadAfter: true })
        return
      }
      const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
      set({ codeWorkspaceRoots })
      let reusableThreadId: string | null = null
      if (!options.forceNew && !workspaceLocator) {
        reusableThreadId = await findReusableEmptyThreadId(
          get(),
          workspaceRoot,
          (thread) => isCodeThread(thread)
        )
      }
      if (reusableThreadId) {
        if (get().activeThreadId !== reusableThreadId) {
          await get().selectThread(reusableThreadId)
        } else {
          set({ error: null })
        }
        return
      }
      const state = get()
      const nextWatch = { ...(state.watchTurnCompletion ?? {}) }
      if (state.activeThreadId && state.busy) {
        nextWatch[state.activeThreadId] = true
        watchTurnCompletionNotification(state.activeThreadId)
      }
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
      set((s) => ({
        ...clearedThreadSelection(),
        route: 'chat',
        workspaceRoot,
        workspaceLabel: workspaceLabelFromPath(workspaceRoot),
        codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [workspaceRoot]),
        error: null,
        watchTurnCompletion: nextWatch
      }))
      syncTurnCompletionPoll(set, get)
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  recoverActiveTurn: async () => {
    const state = get()
    if (!state.activeThreadId) return false
    const { activeThreadId } = state
    const p = getProvider()
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    set({ error: runtimeStreamRecoveringMessage() })
    try {
      rememberProviderThreadRuntime(p, activeThreadId, state.threads)
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestUserMessageId,
        turnDurationByUserId = {},
        goal,
        todos,
        nextCursor
      } = await p.getRecentThreadView(activeThreadId)
      const contextState = await readProviderContextState(p, activeThreadId)
      if (get().activeThreadId !== activeThreadId) {
        if (get().error === runtimeStreamRecoveringMessage()) {
          set({ error: null })
        }
        return false
      }
      const hydratedBlocks = hydrateBlockModelLabels(activeThreadId, rawBlocks)
      if (snapshotLooksStaleForCurrentTurn(state, hydratedBlocks, latestTurnId, latestUserMessageId)) {
        const ac = new AbortController()
        sseAbortRef.current = ac
        const sink = buildThreadEventSink(set, get, {
          threadId: activeThreadId,
          signal: ac.signal,
          sinceSeq: state.lastSeq
        })
        void p.subscribeThreadEvents(activeThreadId, state.lastSeq, sink, ac.signal).catch(() => undefined)
        if (state.busy) armBusyWatchdog(set, get)
        return state.busy
      }
      const busy = threadSnapshotHasTurnEvidence(hydratedBlocks, latestTurnId, latestUserMessageId) &&
        threadSnapshotLooksRunning(hydratedBlocks, threadStatus)
      const blocks = settleStalePendingBlocksWhenIdle(hydratedBlocks, busy)
      const currentTurnUserId = busy
        ? state.currentTurnUserId ?? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      const currentTurnId = busy ? state.currentTurnId ?? latestTurnId ?? null : null

      set((s) => ({
        activeThreadId,
        activeThreadGoal: goal ?? null,
        activeThreadTodos: todos ?? null,
        activeThreadContextState: contextState,
        blocks,
        lastSeq: latestSeq,
        threadHistoryCursor: nextCursor ?? null,
        threadHistoryLoading: false,
        liveReasoning: '',
        liveAssistant: '',
        error: busy ? runtimeStreamRecoveringMessage() : null,
        busy,
        currentTurnId,
        currentTurnUserId,
        turnDurationByUserId,
        queuedMessages: s.queuedMessages
      }))
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: activeThreadId, signal: ac.signal, sinceSeq: latestSeq })
      void p.subscribeThreadEvents(activeThreadId, latestSeq, sink, ac.signal)
      if (busy) {
        armBusyWatchdog(set, get)
      } else {
        resetBusyRecoveryAttempts()
        if (get().queuedMessages.length > 0) {
          void get().drainQueuedMessages()
        }
      }
      return busy
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      if (state.busy) armBusyWatchdog(set, get)
      return state.busy
    }
  },

  selectThread: async (id) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const requestSeq = ++selectThreadRequestSeq
    const isCurrentSelection = () => selectThreadRequestSeq === requestSeq && get().activeThreadId === id
    const prevId = get().activeThreadId
    const selectionChanged = prevId !== id
    const prevBusy = get().busy
    let nextWatch = { ...get().watchTurnCompletion }
    delete nextWatch[id]
    clearWatchedCompletionNotification(id)
    if (prevId && selectionChanged && prevBusy) {
      nextWatch[prevId] = true
      watchTurnCompletionNotification(prevId)
    }
    const nextUnread = { ...get().unreadThreadIds }
    delete nextUnread[id]

    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    const p = getProvider()
    resetBusyRecoveryAttempts()
    clearBusyWatchdog()
    set({
      ...(selectionChanged ? clearedThreadSelection() : {}),
      watchTurnCompletion: nextWatch,
      unreadThreadIds: nextUnread,
      activeThreadId: id,
      error: null,
      threadHistoryCursor: null,
      threadHistoryLoading: false
    })
    if (selectionChanged) {
      set(resetAgentFocusState(get(), id))
    }
    syncTurnCompletionPoll(set, get)
    try {
      rememberProviderThreadRuntime(p, id, get().threads)
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestUserMessageId,
        turnDurationByUserId = {},
        usage: threadUsage,
        goal,
        todos,
        nextCursor
      } = await p.getRecentThreadView(id)
      if (!isCurrentSelection()) return
      const contextState = await readProviderContextState(p, id)
      if (!isCurrentSelection()) return
      const hydratedBlocks = hydrateBlockModelLabels(id, rawBlocks)
      const busy = threadSnapshotHasTurnEvidence(hydratedBlocks, latestTurnId, latestUserMessageId) &&
        threadSnapshotLooksRunning(hydratedBlocks, threadStatus)
      const blocks = settleStalePendingBlocksWhenIdle(hydratedBlocks, busy)
      const currentTurnUserId = busy
        ? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      set({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        activeThreadId: id,
        activeThreadGoal: goal ?? null,
        activeThreadTodos: todos ?? null,
        activeThreadContextState: contextState,
        blocks,
        lastSeq: latestSeq,
        threadHistoryCursor: nextCursor ?? null,
        threadHistoryLoading: false,
        liveReasoning: '',
        liveAssistant: '',
        error: null,
        busy,
        currentTurnId: busy ? latestTurnId ?? null : null,
        currentTurnUserId,
        turnStartedAtByUserId: {},
        turnDurationByUserId,
        turnReasoningFirstAtByUserId: {},
        turnReasoningLastAtByUserId: {}
      })
      syncTurnCompletionPoll(set, get)
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: id, signal: ac.signal, sinceSeq: latestSeq })
      subscribeThreadEventsWithRecovery(p, id, latestSeq, sink, ac.signal, get)
      if (busy) {
        armBusyWatchdog(set, get)
      } else {
        void get().drainQueuedMessages()
      }
    } catch (e) {
      if (!isCurrentSelection()) return
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  drainQueuedMessages: async () => {
    if (drainingQueuedMessages) return
    drainingQueuedMessages = true
    try {
      while (true) {
        const state = get()
        const activeThread = state.threads.find((thread) => thread.id === state.activeThreadId)
        const activeQueuedMessages = state.queuedMessages.filter(
          (message) =>
            queuedMessageMatchesThread(message, state.activeThreadId, activeThread?.runtimeId)
        )
        const stalePlanIds = new Set(
          activeQueuedMessages.filter((message) => message.guiPlan).map((message) => message.id)
        )
        if (stalePlanIds.size > 0) {
          set((s) => ({
            queuedMessages: s.queuedMessages.filter((message) => !stalePlanIds.has(message.id))
          }))
          continue
        }
        const next = activeQueuedMessages[0]
        // A failed send is an ordering barrier. Later scientific instructions
        // must not overtake it while the user decides whether to retry/remove.
        if (
          !next || next.sendFailure || next.restoredAttachmentWarning ||
          next.deliveryAttempt || state.busy
        ) return
        const started = await get().sendMessage(next.text, next.mode, { queued: next })
        if (!started) return
      }
    } finally {
      drainingQueuedMessages = false
    }
  },

  drainQueuedMessagesForThread: async (threadId) => {
    const targetThreadId = threadId.trim()
    if (!targetThreadId || backgroundQueueDrains.has(targetThreadId)) return false
    const initialState = get()
    if (initialState.runtimeConnection !== 'ready' || initialState.activeThreadId === targetThreadId) {
      return false
    }
    const thread = initialState.threads.find((item) => item.id === targetThreadId)
    const queued = initialState.queuedMessages.find(
      (message) =>
        queuedMessageMatchesThread(message, targetThreadId, thread?.runtimeId)
    )
    if (
      !thread || !queued || queued.guiPlan || queued.sendFailure ||
      queued.restoredAttachmentWarning || queued.deliveryAttempt
    ) return false

    // The provider hands a thread off when its runtime differs from the
    // globally selected runtime. A background continuation must never change
    // runtime or session identity behind the user's back.
    const targetRuntimeId = queued.runtimeId ?? thread.runtimeId
    if (!targetRuntimeId || targetRuntimeId !== initialState.activeAgentRuntime) return false
    backgroundQueueDrains.add(targetThreadId)
    let deliveryStartedAt: number | undefined
    try {
      const provider = getProvider()
      rememberProviderThreadRuntime(provider, targetThreadId, initialState.threads)
      const settings = await rendererRuntimeClient.getSettings()
      const latestState = get()
      const latestQueued = latestState.queuedMessages.find((message) => message.id === queued.id)
      if (
        !latestQueued ||
        latestState.activeThreadId === targetThreadId ||
        latestState.activeAgentRuntime !== targetRuntimeId
      ) {
        return false
      }
      const startedAt = Date.now()
      deliveryStartedAt = startedAt
      set((state) => ({
        queuedMessages: state.queuedMessages.map((message) =>
          message.id === queued.id
            ? {
                ...message,
                deliveryAttempt: {
                  startedAt,
                  userBlockId: queued.id,
                  attemptedText: latestQueued.text,
                  attemptedDisplayText: latestQueued.displayText ?? latestQueued.text
                }
              }
            : message
        )
      }))
      const runtimeText = buildCodeRuntimePrompt(settings, latestQueued.text)
      const fileReferences = normalizeRuntimeFileReferences(latestQueued.fileReferences)
      const turnHandle = await provider.sendUserMessage(targetThreadId, runtimeText, {
        clientDirectiveId: queued.id,
        ...(latestQueued.mode ? { mode: latestQueued.mode } : {}),
        ...(thread.workspace ? { workspace: thread.workspace } : {}),
        ...(thread.title ? { title: thread.title } : {}),
        ...(latestQueued.model ? { model: latestQueued.model } : {}),
        ...(latestQueued.reasoningEffort ? { reasoningEffort: latestQueued.reasoningEffort } : {}),
        ...(latestQueued.workspaceLocator
          ? { workspaceLocator: latestQueued.workspaceLocator }
          : {}),
        ...(latestQueued.governanceProfile ? { governanceProfile: latestQueued.governanceProfile } : {}),
        displayText: latestQueued.displayText ?? latestQueued.text,
        ...(latestQueued.attachmentIds?.length ? { attachmentIds: latestQueued.attachmentIds } : {}),
        ...(fileReferences.length ? { fileReferences } : {})
      })
      const deliveredThreadId = turnHandle.threadId?.trim() || targetThreadId
      set((state) => ({
        queuedMessages: state.queuedMessages.filter((message) => message.id !== queued.id)
      }))
      if (turnHandle.userMessageItemId && latestQueued.modelLabel) {
        rememberTurnModel(deliveredThreadId, turnHandle.userMessageItemId, latestQueued.modelLabel)
      }
      watchBackgroundThreadCompletion(set, get, deliveredThreadId)
      return true
    } catch (error) {
      if (structuredRuntimeErrorCode(error) === 'turn_in_progress') {
        set((state) => ({
          queuedMessages: state.queuedMessages.map((message) => {
            if (message.id !== queued.id) return message
            const { deliveryAttempt: _deliveryAttempt, ...retryable } = message
            return retryable
          })
        }))
        watchBackgroundThreadCompletion(set, get, targetThreadId)
      } else {
        set((state) => ({
          queuedMessages: state.queuedMessages.map((message) => {
            if (message.id !== queued.id) return message
            return {
              ...message,
              sendFailure: {
                userBlockId: queued.id,
                message: formatRuntimeError(error),
                ...(deliveryStartedAt !== undefined ? { attemptedAt: deliveryStartedAt } : {})
              }
            }
          })
        }))
      }
      if (typeof window !== 'undefined' && typeof window.sciforge?.logError === 'function') {
        void window.sciforge.logError('queued-message', 'Failed to drain a background queued message', {
          message: error instanceof Error ? error.message : String(error),
          threadId: targetThreadId,
          queuedMessageId: queued.id
        }).catch(() => undefined)
      }
      return false
    } finally {
      backgroundQueueDrains.delete(targetThreadId)
    }
  },

  removeQueuedMessage: (id) =>
    set((s) => ({
      queuedMessages: s.queuedMessages.filter((message) => message.id !== id)
    })),

  updateQueuedMessage: (id, text) => {
    const trimmedText = text.trim()
    const queued = get().queuedMessages.find((message) => message.id === id)
    // Once a payload crossed the delivery boundary, its text is immutable.
    // Editing would destroy the identity used to distinguish resend from
    // continuation after an uncertain provider response.
    if (!trimmedText || !queued || queued.sendFailure || queued.deliveryAttempt) return false
    set((s) => ({
      queuedMessages: s.queuedMessages.map((message) =>
        message.id === id
          ? {
              ...message,
              text: trimmedText,
              ...(message.displayText != null ? { displayText: trimmedText } : {})
            }
          : message
      )
    }))
    return true
  },

  retryQueuedMessage: async (id) => {
    const state = get()
    const queued = state.queuedMessages.find((message) => message.id === id)
    if (
      (!queued?.sendFailure && !queued?.restoredAttachmentWarning &&
        !queued?.deliveryAttempt?.restored) ||
      !state.activeThreadId
    ) return false
    const activeThread = state.threads.find((thread) => thread.id === state.activeThreadId)
    if (
      state.runtimeConnection !== 'ready' ||
      state.busy ||
      !queuedMessageMatchesThread(queued, state.activeThreadId, activeThread?.runtimeId)
    ) {
      set({ error: state.busy
        ? i18n.t('common:runtimeActiveTurn')
        : i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }

    if (queued.restoredAttachmentWarning && !queued.sendFailure && !queued.deliveryAttempt?.restored) {
      const { restoredAttachmentWarning: _warning, ...retryable } = queued
      return get().sendMessage(queued.text, queued.mode, { queued: retryable })
    }

    const p = getProvider()
    const threadId = state.activeThreadId
    try {
      rememberProviderThreadRuntime(p, threadId, state.threads)
      const detail = await p.getRecentThreadView(threadId)
      if (get().activeThreadId !== threadId) return false
      const blocks = hydrateBlockModelLabels(threadId, detail.blocks)
      const running = threadSnapshotHasTurnEvidence(
        blocks,
        detail.latestTurnId,
        detail.latestUserMessageId
      ) && threadSnapshotLooksRunning(blocks, detail.threadStatus)
      set({
        blocks: settleStalePendingBlocksWhenIdle(blocks, running),
        lastSeq: detail.latestSeq,
        busy: running,
        currentTurnId: running ? detail.latestTurnId ?? null : null,
        currentTurnUserId: running
          ? detail.latestUserMessageId ?? findLatestUserBlockId(blocks)
          : null
      })
      if (running) {
        set({ error: i18n.t('common:runtimeActiveTurn') })
        return false
      }

      const sendFailure = queued.sendFailure
      const recoveryUserBlockId = queued.deliveryAttempt?.userBlockId ?? sendFailure?.userBlockId ?? queued.id
      const attemptedDisplayText = queued.deliveryAttempt?.attemptedDisplayText ??
        queued.deliveryAttempt?.attemptedText ?? queued.displayText ?? queued.text
      const persistedUserState = snapshotAttemptedUserMessageState(
        blocks,
        recoveryUserBlockId,
        attemptedDisplayText,
        sendFailure?.attemptedAt ?? queued.deliveryAttempt?.startedAt
      )
      const {
        sendFailure: _sendFailure,
        restoredAttachmentWarning: _restoredAttachmentWarning,
        deliveryAttempt: _deliveryAttempt,
        ...retryable
      } = queued
      if (persistedUserState === 'absent') {
        return get().sendMessage(queued.text, queued.mode, { queued: retryable })
      }
      if (persistedUserState === 'answered') {
        set((current) => ({
          queuedMessages: current.queuedMessages.filter((message) => message.id !== queued.id),
          error: null
        }))
        return true
      }

      // The original user item is already part of the runtime transcript.
      // Sending it again would duplicate the scientific instruction. Start a
      // continuation turn instead and omit attachments already present there.
      const {
        attachmentIds: _attachmentIds,
        attachments: _attachments,
        fileReferences: _fileReferences,
        guiPlan: _guiPlan,
        ...continuationBase
      } = retryable
      const recoveryPrompt = i18n.t('common:failedSendRecoveryPrompt')
      return get().sendMessage(recoveryPrompt, queued.mode, {
        queued: {
          ...continuationBase,
          text: recoveryPrompt,
          displayText: i18n.t('common:failedSendRecoveryDisplay')
        }
      })
    } catch (error) {
      set({ error: formatRuntimeError(error) })
      return false
    }
  },

  steerQueuedMessage: async (id) => {
    const state = get()
    const queued = state.queuedMessages.find((message) => message.id === id)
    if (!queued) return false
    const activeThreadId = state.activeThreadId
    const currentTurnId = state.currentTurnId
    const p = getProvider()
    const canSteerActiveTurn =
      Boolean(activeThreadId && currentTurnId) &&
      (!queued.threadId || queued.threadId === activeThreadId) &&
      (!queued.runtimeId || get().threads.find((thread) => thread.id === activeThreadId)?.runtimeId === queued.runtimeId) &&
      typeof p.steerUserMessage === 'function' &&
      providerSupportsCapability(p, 'steer') &&
      canSteerPlainTextMessage(queued)
    if (!canSteerActiveTurn || !activeThreadId || !currentTurnId || !p.steerUserMessage) {
      set({ error: i18n.t('common:runtimeSteerUnsupported') })
      return false
    }
    try {
      rememberProviderThreadRuntime(p, activeThreadId, get().threads)
      await p.steerUserMessage(activeThreadId, currentTurnId, queued.text, {
        clientDirectiveId: queued.id
      })
      set((s) => ({
        queuedMessages: s.queuedMessages.filter((message) => message.id !== id),
        error: null
      }))
      return true
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return false
    }
  },

  sendMessage: async (text, mode, overrides) => {
    const trimmedText = text.trim()
    if (!trimmedText) return false
    const steerCommandText = parseSteerCommand(trimmedText)
    const explicitSteerText = steerCommandText !== false ? steerCommandText.trim() : null
    const messageText = explicitSteerText ?? trimmedText
    if (!messageText) {
      set({ error: i18n.t('common:steerCommandRequiresMessage') })
      return false
    }
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    const queued = overrides?.queued
    const explicitSteerDirectiveId = explicitSteerText !== null
      ? queued?.id ?? createClientDirectiveId()
      : null
    const sourceRoute = queued?.sourceRoute ?? overrides?.sourceRoute ?? get().route
    const requestedGovernanceProfile = queued?.governanceProfile ?? overrides?.governanceProfile
    const workspaceLocator = queued?.workspaceLocator ?? overrides?.workspaceLocator
    const requestedTargetThreadId = (queued?.targetThreadId ?? overrides?.targetThreadId)?.trim() || ''
    const initialState = get()
    const initialActiveThreadId = initialState.activeThreadId
    const initialActiveRuntimeId = initialState.activeAgentRuntime
    const deliveryStartedInForeground =
      !requestedTargetThreadId || requestedTargetThreadId === initialActiveThreadId
    const ownerThreadId = requestedTargetThreadId || initialActiveThreadId || ''
    const hasPendingOwnerTurn = deliveryStartedInForeground &&
      initialState.blocks.some(hasPendingRuntimeWork)
    if (deliveryStartedInForeground && (initialState.busy || hasPendingOwnerTurn)) {
      if (overrides?.guiPlan) {
        set({ error: i18n.t('common:composerQueuePlaceholder') })
        return false
      }
      const now = Date.now()
      const activeThreadId = initialActiveThreadId
      const threadSnap = activeThreadId
        ? initialState.threads.find((thread) => thread.id === activeThreadId)
        : undefined
      const queuedTargetThreadId = ownerThreadId || undefined
      const overrideModel = overrides?.model?.trim()
      const composerModel =
        overrideModel ?? initialState.composerModel.trim()
      const userModelChip =
        overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
      const displayText = overrides?.displayText?.trim()
      const reasoningEffort = overrides?.reasoningEffort?.trim()
      const attachmentIds = overrides?.attachmentIds?.filter((id) => id.trim().length > 0)
      const attachments = overrides?.attachments?.filter((attachment) => attachment.id.trim().length > 0)
      const fileReferences = normalizeRuntimeFileReferences(overrides?.fileReferences)
      const currentTurnId = initialState.currentTurnId
      const canSteerActiveTurn =
        explicitSteerText !== null &&
        Boolean(activeThreadId && currentTurnId) &&
        typeof p.steerUserMessage === 'function' &&
        providerSupportsCapability(p, 'steer') &&
        !attachmentIds?.length &&
        !attachments?.length &&
        fileReferences.length === 0 &&
        !overrides?.guiPlan
      if (explicitSteerText !== null && !canSteerActiveTurn) {
        set({ error: i18n.t('common:runtimeSteerUnsupported') })
        return false
      }
      if (
        canSteerActiveTurn && activeThreadId && currentTurnId &&
        explicitSteerDirectiveId && p.steerUserMessage
      ) {
        try {
          rememberProviderThreadRuntime(p, activeThreadId, get().threads)
          await p.steerUserMessage(activeThreadId, currentTurnId, messageText, {
            clientDirectiveId: explicitSteerDirectiveId
          })
          set({ error: null })
          return true
        } catch (e) {
          const code = structuredRuntimeErrorCode(e)
          if (code !== 'turn_not_running' && code !== 'capability_unavailable') {
            set({
              error: formatRuntimeError(e),
              ...(shouldOpenSettingsForError(e)
                ? { route: 'settings' as const, settingsSection: 'agents' as const }
                : {})
            })
            return false
          }
        }
      }
      set((s) => ({
        queuedMessages: [
          ...s.queuedMessages,
          {
            id: explicitSteerDirectiveId ?? `q-${now}-${s.queuedMessages.length}`,
            ...(activeThreadId ? { threadId: activeThreadId } : {}),
            ...(threadSnap?.runtimeId ? { runtimeId: threadSnap.runtimeId } : {}),
            text: messageText,
            ...(displayText ? { displayText } : {}),
            ...(mode ? { mode } : {}),
            sourceRoute,
            ...(queuedTargetThreadId ? { targetThreadId: queuedTargetThreadId } : {}),
            ...(requestedGovernanceProfile ? { governanceProfile: requestedGovernanceProfile } : {}),
            ...(composerModel ? { model: composerModel } : {}),
            ...(userModelChip ? { modelLabel: userModelChip } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(workspaceLocator ? { workspaceLocator } : {}),
            ...(overrides?.guiPlan ? { guiPlan: overrides.guiPlan } : {}),
            ...(attachmentIds?.length ? { attachmentIds } : {}),
            ...(attachments?.length ? { attachments } : {}),
            ...(fileReferences?.length ? { fileReferences } : {})
          }
        ],
        error: null
      }))
      // UI/runtime can briefly drift (busy=false while runtime still has an active turn).
      // Kick recovery so queued input drains as soon as the in-flight turn settles.
      if (!get().busy && hasPendingOwnerTurn) {
        void get().recoverActiveTurn()
      }
      return true
    }
    const now = Date.now()
    const userBlockId = queued?.id ?? explicitSteerDirectiveId ?? `u-${createClientDirectiveId()}`
    const attachmentIds =
      queued?.attachmentIds ??
      overrides?.attachmentIds?.filter((id) => id.trim().length > 0) ??
      []
    const attachments =
      queued?.attachments ??
      overrides?.attachments?.filter((attachment) => attachment.id.trim().length > 0) ??
      []
    const fileReferences = normalizeRuntimeFileReferences(
      queued?.fileReferences ?? overrides?.fileReferences
    )
    let activeThreadId = ownerThreadId || null
    const displayText = queued?.displayText ?? overrides?.displayText?.trim() ?? messageText
    const userDisplayText = displayText !== messageText ? displayText : undefined
    const generatedTitle = deriveThreadTitleFromPrompt(displayText)
    const shouldAutoRenameForRoute = sourceRoute === 'chat'
    const activeThread = activeThreadId
      ? initialState.threads.find((thread) => thread.id === activeThreadId) ?? null
      : null
    let shouldRenameThreadAfterSend =
      shouldAutoRenameForRoute &&
      !!activeThreadId &&
      shouldAutoTitleThread(activeThread)
    const threadSnap = initialState.threads.find((thread) => thread.id === activeThreadId)
    const overrideModel = overrides?.model?.trim()
    const composerModel =
      queued?.model ?? overrideModel ?? initialState.composerModel.trim()
    const reasoningEffort = queued?.reasoningEffort ?? overrides?.reasoningEffort?.trim()
    const userModelChip =
      queued?.modelLabel ?? overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
    const deliveryAttempt: NonNullable<QueuedUserMessage['deliveryAttempt']> = {
      startedAt: now,
      userBlockId,
      attemptedText: messageText,
      attemptedDisplayText: displayText,
      ...(!queued ? { journalOnly: true } : {})
    }
    const directDeliveryJournal: QueuedUserMessage = {
      id: userBlockId,
      ...(activeThreadId ? { threadId: activeThreadId, targetThreadId: activeThreadId } : {}),
      ...(threadSnap?.runtimeId ? { runtimeId: threadSnap.runtimeId } : {}),
      text: messageText,
      ...(displayText ? { displayText } : {}),
      ...(mode ? { mode } : {}),
      sourceRoute,
      ...(overrides?.workspaceRoot ? { workspaceRoot: overrides.workspaceRoot } : {}),
      ...(requestedGovernanceProfile ? { governanceProfile: requestedGovernanceProfile } : {}),
      ...(composerModel ? { model: composerModel } : {}),
      ...(userModelChip ? { modelLabel: userModelChip } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(workspaceLocator ? { workspaceLocator } : {}),
      ...(overrides?.guiPlan ? { guiPlan: overrides.guiPlan } : {}),
      ...(attachmentIds.length ? { attachmentIds } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(fileReferences.length ? { fileReferences } : {}),
      deliveryAttempt
    }
    const previousBlocks = initialState.blocks
    const previousActiveThreadId = initialActiveThreadId
    const previousLastSeq = initialState.lastSeq
    const previousCurrentTurnId = initialState.currentTurnId
    const previousCurrentTurnUserId = initialState.currentTurnUserId
    const previousTurnStartedAtByUserId = initialState.turnStartedAtByUserId
    const previousTurnDurationByUserId = initialState.turnDurationByUserId
    const previousTurnReasoningFirstAtByUserId = initialState.turnReasoningFirstAtByUserId
    const previousTurnReasoningLastAtByUserId = initialState.turnReasoningLastAtByUserId
    const previousQueuedMessages = initialState.queuedMessages
    const sendSessionStillFocused = (): boolean =>
      get().activeThreadId === previousActiveThreadId && get().currentTurnUserId === userBlockId
    if (deliveryStartedInForeground) resetBusyRecoveryAttempts()
    set((s) => ({
      ...(deliveryStartedInForeground
        ? {
            busy: true,
            blocks: [
              ...s.blocks,
              {
                kind: 'user' as const,
                id: userBlockId,
                createdAt: new Date(now).toISOString(),
                text: displayText,
                ...(userModelChip ? { modelLabel: userModelChip } : {}),
                ...(userDisplayText || attachmentIds.length || attachments.length
                  ? {
                      meta: {
                        source: 'desktop',
                        ...(userDisplayText ? { displayText: userDisplayText } : {}),
                        ...(attachmentIds.length ? { attachmentIds } : {}),
                        ...(attachments.length ? { attachments } : {})
                      }
                    }
                  : { meta: { source: 'desktop' } })
              }
            ],
            liveReasoning: '',
            liveAssistant: '',
            error: null,
            currentTurnUserId: userBlockId,
            turnStartedAtByUserId: { ...s.turnStartedAtByUserId, [userBlockId]: now }
          }
        : {}),
      queuedMessages: queued
        ? s.queuedMessages.map((message) =>
            message.id === queued.id
              ? { ...message, deliveryAttempt }
              : message
          )
        : activeThreadId
          ? [...s.queuedMessages, directDeliveryJournal]
          : s.queuedMessages
    }))
    if (!activeThreadId) {
      try {
        const settings = await rendererRuntimeClient.getSettings()
        const workspaceRoot = resolveDraftWorkspaceRoot(
          get(),
          settings.workspaceRoot,
          workspaceLocator?.path
        )
        if (!workspaceRoot) {
          if (!sendSessionStillFocused()) return false
          set({
            blocks: previousBlocks,
            busy: false,
            currentTurnId: previousCurrentTurnId,
            currentTurnUserId: previousCurrentTurnUserId,
            turnStartedAtByUserId: previousTurnStartedAtByUserId,
            turnDurationByUserId: previousTurnDurationByUserId,
            turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
            turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
            queuedMessages: previousQueuedMessages,
            error: i18n.t('common:workspaceRequiredToCreateThread')
          })
          return false
        }
        const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
        set({ codeWorkspaceRoots })
        const reusableThreadId = workspaceLocator
          ? null
          : await findReusableEmptyThreadId(
              get(),
              workspaceRoot,
              (thread) => isCodeThread(thread)
            )
        const reusableThread = reusableThreadId
          ? get().threads.find((thread) => thread.id === reusableThreadId) ?? null
          : null
        shouldRenameThreadAfterSend =
          shouldAutoRenameForRoute &&
          reusableThreadId != null && shouldAutoTitleThread(reusableThread)
        const createdThread =
          reusableThreadId == null
            ? await p.createThread({
                workspace: workspaceRoot,
                ...(workspaceLocator ? { workspaceLocator } : {}),
                title: generatedTitle,
                mode: mode ?? 'agent'
              })
            : null
        const threadId = reusableThreadId ?? createdThread?.id ?? null
        if (!threadId) {
          throw new Error('Failed to resolve target thread id.')
        }
        if (!initialActiveThreadId && sendSessionStillFocused()) {
          const draftSessionId = draftSessionRightPanelId(workspaceRoot)
          if (draftSessionId) rekeySessionRightPanelWorkspace(draftSessionId, threadId)
        }
        activeThreadId = threadId
        if (sendSessionStillFocused()) {
          set((s) => ({
            activeThreadId: threadId,
            codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [workspaceRoot, createdThread?.workspace]),
            lastSeq: 0,
            threads:
              createdThread && !s.threads.some((thread) => thread.id === createdThread.id)
                ? [createdThread, ...s.threads]
                : s.threads,
            ...(!queued ? {
              queuedMessages: [
                ...s.queuedMessages,
                {
                  ...directDeliveryJournal,
                  threadId,
                  targetThreadId: threadId,
                  ...(createdThread?.runtimeId || reusableThread?.runtimeId
                    ? { runtimeId: createdThread?.runtimeId ?? reusableThread?.runtimeId }
                    : {})
                }
              ]
            } : {})
          }))
        } else {
          set((s) => ({
            codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [workspaceRoot, createdThread?.workspace]),
            threads:
              createdThread && !s.threads.some((thread) => thread.id === createdThread.id)
                ? [createdThread, ...s.threads]
                : s.threads
          }))
        }
        void get().refreshThreads()
      } catch (e) {
        void window.sciforge.logError('create-thread', 'Failed to create thread', {
          message: e instanceof Error ? e.message : String(e)
        }).catch(() => undefined)
        if (!sendSessionStillFocused()) return false
        set({
          activeThreadId: previousActiveThreadId,
          blocks: previousBlocks,
          lastSeq: previousLastSeq,
          busy: false,
          currentTurnId: previousCurrentTurnId,
          currentTurnUserId: previousCurrentTurnUserId,
          turnStartedAtByUserId: previousTurnStartedAtByUserId,
          turnDurationByUserId: previousTurnDurationByUserId,
          turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
          turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
          queuedMessages: previousQueuedMessages,
          error: formatRuntimeError(e),
          ...(shouldOpenSettingsForError(e)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
        return false
      }
    }
    if (deliveryStartedInForeground) {
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
    }
    let turnAccepted = false
    let acceptedUserMessageItemId: string | undefined
    const deliveryOwnsActiveSession = (): boolean => {
      if (!deliveryStartedInForeground || get().activeThreadId !== activeThreadId) return false
      const currentUserId = get().currentTurnUserId
      return currentUserId === userBlockId || (
        Boolean(acceptedUserMessageItemId) && currentUserId === acceptedUserMessageItemId
      )
    }
    try {
      if (!activeThreadId) throw new Error('Failed to resolve target thread id.')
      const previousThreadId = activeThreadId
      const seqAtSend = deliveryStartedInForeground ? previousLastSeq : 0
      const sendingThread = get().threads.find((thread) => thread.id === previousThreadId)
      rememberProviderThreadRuntime(p, previousThreadId, get().threads)
      const desiredRuntimeId = deliveryStartedInForeground
        ? initialActiveRuntimeId
        : sendingThread?.runtimeId
      const sendingRuntimeId = sendingThread?.runtimeId
      const runtimeSwitchExpected = Boolean(
        sendingRuntimeId && desiredRuntimeId && sendingRuntimeId !== desiredRuntimeId
      )
      const settings = await rendererRuntimeClient.getSettings()
      const runtimeText = buildCodeRuntimePrompt(settings, messageText)
      const runtimeDisplayText = userDisplayText ?? messageText
      const governanceProfile = requestedGovernanceProfile
      const turnHandle = await p.sendUserMessage(previousThreadId, runtimeText, {
        clientDirectiveId: userBlockId,
        mode,
        ...(sendingThread?.workspace ? { workspace: sendingThread.workspace } : {}),
        ...(sendingThread?.title ? { title: sendingThread.title } : {}),
        ...(composerModel ? { model: composerModel } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(workspaceLocator ? { workspaceLocator } : {}),
        ...(governanceProfile ? { governanceProfile } : {}),
        ...(runtimeDisplayText ? { displayText: runtimeDisplayText } : {}),
        ...((queued?.guiPlan ?? overrides?.guiPlan) ? { guiPlan: queued?.guiPlan ?? overrides?.guiPlan } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(fileReferences.length ? { fileReferences } : {})
      })
      turnAccepted = true
      set((state) => ({
        queuedMessages: state.queuedMessages.filter((message) => message.id !== userBlockId)
      }))
      const deliveredThreadId = turnHandle.threadId?.trim() || previousThreadId
      const deliveredThreadChanged = deliveredThreadId !== previousThreadId
      const subscribedRuntimeId = runtimeSwitchExpected
        ? desiredRuntimeId
        : sendingRuntimeId
      const subscribedFromSeq = runtimeSwitchExpected ? 0 : seqAtSend
      const threadIdChange = turnHandle.threadIdChange
      const deliveredSessionAlreadyExists = get().threads.some(
        (thread) => thread.id === deliveredThreadId
      )
      const sourceSessionStillExists = get().threads.some(
        (thread) => thread.id === previousThreadId && !thread.archived
      )
      const canAdoptDeliveredThread =
        deliveredThreadChanged &&
        Boolean(subscribedRuntimeId) &&
        sourceSessionStillExists &&
        (threadIdChange === 'handoff' || threadIdChange === 'promote')
      const ownedActiveSessionBeforeHandoff = deliveryOwnsActiveSession()
      if (canAdoptDeliveredThread && subscribedRuntimeId) {
        get().rekeySessionSideConversations(previousThreadId, deliveredThreadId)
        rekeySessionRightPanelWorkspace(previousThreadId, deliveredThreadId)
        set((s) => ({
          ...(ownedActiveSessionBeforeHandoff
            ? {
                activeThreadId: deliveredThreadId,
                lastSeq: subscribedFromSeq,
                ...(deliveredSessionAlreadyExists
                  ? { blocks: s.threadBlocksById[deliveredThreadId] ?? [] }
                  : {})
              }
            : {}),
          threads: adoptExplicitHandoffThread(
            s.threads,
            previousThreadId,
            deliveredThreadId,
            subscribedRuntimeId
          )
        }))
        p.rememberThreadRuntime?.(deliveredThreadId, subscribedRuntimeId)
        activeThreadId = deliveredThreadId
      } else if (runtimeSwitchExpected && subscribedRuntimeId) {
        set((s) => ({
          ...(ownedActiveSessionBeforeHandoff ? { lastSeq: subscribedFromSeq } : {}),
          threads: s.threads.map((thread) =>
            thread.id === previousThreadId ? { ...thread, runtimeId: subscribedRuntimeId } : thread
          )
        }))
        p.rememberThreadRuntime?.(previousThreadId, subscribedRuntimeId)
      }
      if (deliveredThreadChanged && !canAdoptDeliveredThread && typeof window.sciforge?.logError === 'function') {
        void window.sciforge.logError('session-identity', 'Runtime returned a different thread id for a stable GUI session', {
          sessionId: previousThreadId,
          deliveredThreadId,
          runtimeId: subscribedRuntimeId
        }).catch(() => undefined)
      }
      const { turnId, userMessageItemId } = turnHandle
      acceptedUserMessageItemId = userMessageItemId
      // Mirror the composer model selection against the runtime's stable
      // user_message item id so the badge survives page refresh / thread
      // re-selection. The runtime itself doesn't persist per-turn metadata.
      if (userMessageItemId && userModelChip) {
        rememberTurnModel(activeThreadId, userMessageItemId, userModelChip)
      }
      if (
        userMessageItemId && userMessageItemId !== userBlockId &&
        deliveryOwnsActiveSession()
      ) {
        set((s) => ({
          blocks: reconcileOptimisticUserBlock(
            s.blocks,
            userBlockId,
            userMessageItemId,
            displayText,
            userModelChip
          ),
          currentTurnUserId: s.currentTurnUserId === userBlockId ? userMessageItemId : s.currentTurnUserId,
          turnStartedAtByUserId: (() => {
            if (s.turnStartedAtByUserId[userBlockId] === undefined) return s.turnStartedAtByUserId
            const next = { ...s.turnStartedAtByUserId, [userMessageItemId]: s.turnStartedAtByUserId[userBlockId] }
            delete next[userBlockId]
            return next
          })(),
          turnDurationByUserId: (() => {
            if (s.turnDurationByUserId[userBlockId] === undefined) return s.turnDurationByUserId
            const next = { ...s.turnDurationByUserId, [userMessageItemId]: s.turnDurationByUserId[userBlockId] }
            delete next[userBlockId]
            return next
          })(),
          turnReasoningFirstAtByUserId: (() => {
            if (s.turnReasoningFirstAtByUserId[userBlockId] === undefined) return s.turnReasoningFirstAtByUserId
            const next = {
              ...s.turnReasoningFirstAtByUserId,
              [userMessageItemId]: s.turnReasoningFirstAtByUserId[userBlockId]
            }
            delete next[userBlockId]
            return next
          })(),
          turnReasoningLastAtByUserId: (() => {
            if (s.turnReasoningLastAtByUserId[userBlockId] === undefined) return s.turnReasoningLastAtByUserId
            const next = {
              ...s.turnReasoningLastAtByUserId,
              [userMessageItemId]: s.turnReasoningLastAtByUserId[userBlockId]
            }
            delete next[userBlockId]
            return next
          })()
        }))
      }
      if (shouldRenameThreadAfterSend) {
        const renamed = await p.renameThread(activeThreadId, generatedTitle).then(() => true).catch(() => {
          /* keep message delivery successful even if auto-title update fails */
          return false
        })
        if (renamed) {
          set((s) => ({
            threads: s.threads.map((thread) =>
              thread.id === activeThreadId ? { ...thread, title: generatedTitle } : thread
            )
          }))
        }
      }
      if (!deliveryOwnsActiveSession()) {
        watchBackgroundThreadCompletion(set, get, activeThreadId)
        await get().refreshThreads()
        return true
      }
      set({ currentTurnId: turnId })
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: activeThreadId, signal: ac.signal, sinceSeq: subscribedFromSeq })
      subscribeThreadEventsWithRecovery(p, activeThreadId, subscribedFromSeq, sink, ac.signal, get)
      armBusyWatchdog(set, get)
      await get().refreshThreads()
      return true
    } catch (e) {
      const failedThreadId = activeThreadId
      const failedDeliveryOwnsActiveSession = deliveryOwnsActiveSession()
      if (failedDeliveryOwnsActiveSession) clearBusyWatchdog()
      void window.sciforge.logError('send-message', 'Failed to send message', {
        message: e instanceof Error ? e.message : String(e),
        threadId: failedThreadId
      }).catch(() => undefined)
      if (turnAccepted) {
        // A turn handle is the delivery boundary. Failures in mirroring,
        // renaming, subscription setup, or thread refresh must not turn a
        // successfully accepted prompt into a retryable send.
        if (!failedDeliveryOwnsActiveSession) {
          if (!failedThreadId) return true
          watchBackgroundThreadCompletion(set, get, failedThreadId)
          await get().refreshThreads().catch(() => undefined)
          return true
        }
        set({ error: formatRuntimeError(e) })
        await get().recoverActiveTurn()
        return true
      }
      if (failedThreadId && !failedDeliveryOwnsActiveSession) {
        // The user may switch threads while the provider call is in flight.
        // Keep the durable journal visible and retryable on its original
        // thread; never strand a journalOnly entry until the next restart.
        set((state) => ({
          queuedMessages: state.queuedMessages.map((message) => {
            if (message.id !== userBlockId) return message
            const attempt = message.deliveryAttempt ?? deliveryAttempt
            const { journalOnly: _journalOnly, ...visibleAttempt } = attempt
            return {
              ...message,
              deliveryAttempt: visibleAttempt,
              sendFailure: {
                userBlockId,
                message: formatRuntimeError(e),
                attemptedAt: attempt.startedAt
              }
            }
          })
        }))
        await get().refreshThreads().catch(() => undefined)
        return false
      }
      if (structuredRuntimeErrorCode(e) === 'turn_in_progress' && queued) {
        set({
          blocks: previousBlocks,
          busy: false,
          currentTurnId: previousCurrentTurnId,
          currentTurnUserId: previousCurrentTurnUserId,
          turnStartedAtByUserId: previousTurnStartedAtByUserId,
          turnDurationByUserId: previousTurnDurationByUserId,
          turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
          turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
          queuedMessages: previousQueuedMessages,
          error: i18n.t('common:runtimeActiveTurn')
        })
        await get().recoverActiveTurn()
        await get().refreshThreads()
        return false
      }
      const failedMessageId = queued?.id ?? userBlockId
      const { journalOnly: _journalOnly, ...visibleDeliveryAttempt } = deliveryAttempt
      const failedMessage: QueuedUserMessage = {
        ...(queued ?? directDeliveryJournal),
        id: failedMessageId,
        ...(failedThreadId ? { threadId: failedThreadId, targetThreadId: failedThreadId } : {}),
        deliveryAttempt: visibleDeliveryAttempt,
        sendFailure: {
          userBlockId,
          message: formatRuntimeError(e),
          attemptedAt: now
        }
      }
      const retryQueue = previousQueuedMessages.some((message) => message.id === failedMessageId)
        ? previousQueuedMessages.map((message) => message.id === failedMessageId ? failedMessage : message)
        : [...previousQueuedMessages, failedMessage]
      set({
        blocks: previousBlocks,
        error: i18n.t('common:failedSendRetryRequired', { message: formatRuntimeError(e) }),
        busy: false,
        currentTurnId: previousCurrentTurnId,
        currentTurnUserId: previousCurrentTurnUserId,
        turnStartedAtByUserId: previousTurnStartedAtByUserId,
        turnDurationByUserId: previousTurnDurationByUserId,
        turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
        turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
        queuedMessages: retryQueue,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      await get().refreshThreads()
      return false
    }
  },

  reviewActiveThread: async (target: ReviewTarget) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    if (typeof p.reviewThread !== 'function') {
      set({ error: i18n.t('common:reviewUnavailable') })
      return false
    }
    if (get().busy || get().blocks.some(hasPendingRuntimeWork)) {
      set({ error: i18n.t('common:composerQueuePlaceholder') })
      return false
    }
    let activeThreadId = get().activeThreadId
    try {
      if (!activeThreadId) {
        const settings = await rendererRuntimeClient.getSettings()
        const workspaceLocator = get().workspaceLocator
        const workspaceRoot = resolveDraftWorkspaceRoot(
          get(),
          settings.workspaceRoot,
          workspaceLocator?.path
        )
        if (!workspaceRoot) {
          set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
          return false
        }
        const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
        set({ codeWorkspaceRoots })
        const reusableThreadId = workspaceLocator
          ? null
          : await findReusableEmptyThreadId(
              get(),
              workspaceRoot,
              (thread) => isCodeThread(thread)
            )
        const createdThread =
          reusableThreadId == null
            ? await p.createThread({
                workspace: workspaceRoot,
                ...(workspaceLocator ? { workspaceLocator } : {}),
                title: i18n.t('common:slashCommandReviewTitle'),
                mode: 'agent'
              })
            : null
        activeThreadId = reusableThreadId ?? createdThread?.id ?? null
        if (!activeThreadId) throw new Error('Failed to resolve target thread id.')
        set((s) => ({
          activeThreadId,
          codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [workspaceRoot, createdThread?.workspace]),
          lastSeq: 0,
          threads:
            createdThread && !s.threads.some((thread) => thread.id === createdThread.id)
              ? [createdThread, ...s.threads]
              : s.threads
        }))
      }
      const threadSnap = get().threads.find((thread) => thread.id === activeThreadId)
      rememberProviderThreadRuntime(p, activeThreadId, get().threads)
      const composerModel = get().composerModel.trim()
      const userModelChip = optimisticUserModelLabel(composerModel, threadSnap?.model)
      const seqAtSend = get().lastSeq
      resetBusyRecoveryAttempts()
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
      set({
        busy: true,
        liveReasoning: '',
        liveAssistant: '',
        error: null,
        currentTurnId: null,
        currentTurnUserId: null
      })
      const { turnId, userMessageItemId } = await p.reviewThread(activeThreadId, target, {
        ...(composerModel ? { model: composerModel } : {})
      })
      if (userMessageItemId && userModelChip) {
        rememberTurnModel(activeThreadId, userMessageItemId, userModelChip)
      }
      set({ currentTurnId: turnId })
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: activeThreadId, signal: ac.signal, sinceSeq: seqAtSend })
      subscribeThreadEventsWithRecovery(p, activeThreadId, seqAtSend, sink, ac.signal, get)
      armBusyWatchdog(set, get)
      await get().refreshThreads()
      return true
    } catch (e) {
      clearBusyWatchdog()
      set({
        error: formatRuntimeError(e),
        busy: false,
        currentTurnId: null,
        currentTurnUserId: null,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      await get().refreshThreads()
      return false
    }
  },
  }
}
