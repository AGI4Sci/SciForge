import type {
  AssistantMessageEventPayload,
  ChatBlock,
  CompactionBlock,
  NormalizedThread,
  ReviewBlock,
  ReviewEventPayload,
  RuntimeDisclosureMetadata,
  RuntimeStatusEventPayload,
  ThreadDeltaEvent,
  ThreadEventSink,
  ToolBlock,
  TurnLifecycleEventPayload
} from '../agent/types'
import { getProvider } from '../agent/registry'
import {
  AGENT_RUNTIME_EVENT_REPLAY_FILTER,
  type AgentRuntimeEventReplayFilter
} from '../agent/agent-runtime-event-dispatcher'
import i18n from '../i18n'
import { describeRuntimeError, formatRuntimeError } from '../lib/format-runtime-error'
import { isClawWorkspacePath, isInternalTemporaryWorkspace, normalizeWorkspaceRoot } from '../lib/workspace-path'
import { mirrorRemoteChannelMessageApi } from '../lib/remote-channel-api'
import type { ClawImChannelV1 } from '@shared/app-settings'
import {
  isAgentRuntimeActiveTurnState,
  isAgentRuntimeTerminalTurnState
} from '@shared/agent-runtime-contract'
import type { AgentRuntimeEvent } from '@shared/agent-runtime-contract'
import type { ChatState } from './chat-store-types'
import { hydrateBlockModelLabels, isClawThread } from './chat-store-helpers'
import {
  collectAssistantTextForTurn,
  hasPendingRuntimeWork,
  rememberProviderThreadRuntime,
  reconcileOptimisticUserBlock,
  settlePendingRuntimeWorkAfterCompletion,
  settlePendingRuntimeWorkAfterInterrupt,
  threadSnapshotLooksRunning,
  upsertUserBlock
} from './chat-store-runtime-helpers'
import { isEmptySddAssistantThreadCandidate, isSddAssistantThread } from '../sdd/sdd-thread-registry'
import {
  armBusyWatchdog as armBusyWatchdogImpl,
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  syncTurnCompletionPoll as syncTurnCompletionPollImpl
} from './chat-store-schedulers'

const BUSY_WATCHDOG_MS = 180_000
const MAX_BUSY_RECOVERY_ATTEMPTS = 3
const MAX_RUNTIME_EVENT_TIMER_AGE_MS = 30 * 60_000
const CLOCK_SKEW_TOLERANCE_MS = 5_000
const RUNTIME_STREAM_RECOVERING_KEY = 'common:runtimeStreamRecovering'
const LEGACY_RUNTIME_STREAM_RECOVERING_VALUE = 'runtimeStreamRecovering'
const COMPLETION_NOTIFICATION_DEDUPE_LIMIT = 200
export const MAX_WATCHED_COMPLETION_NOTIFICATIONS = 200
export const MAX_PENDING_REMOTE_CHANNEL_MIRRORS = 50
const completionNotificationKeys: string[] = []
const completionNotificationKeySet = new Set<string>()
const watchCompletionNotificationKeys = new Map<string, string>()

export type PendingRemoteChannelMirror = {
  threadId: string
  userBlockId: string
  userText: string
}

const pendingRemoteChannelMirrors = new Map<string, PendingRemoteChannelMirror>()

export function watchTurnCompletionNotification(threadId: string, now = Date.now()): void {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return
  watchCompletionNotificationKeys.delete(normalizedThreadId)
  watchCompletionNotificationKeys.set(normalizedThreadId, `watch:${normalizedThreadId}:${now}`)
  while (watchCompletionNotificationKeys.size > MAX_WATCHED_COMPLETION_NOTIFICATIONS) {
    const oldestThreadId = watchCompletionNotificationKeys.keys().next().value
    if (!oldestThreadId) break
    watchCompletionNotificationKeys.delete(oldestThreadId)
  }
}

export function completionNotificationDedupeKeyForWatchedThread(
  threadId: string | null | undefined,
  now = Date.now()
): string {
  const normalizedThreadId = threadId?.trim()
  if (!normalizedThreadId) return `watch:unknown:${now}`
  return watchCompletionNotificationKeys.get(normalizedThreadId) ?? `watch:${normalizedThreadId}:${now}`
}

export function clearWatchedCompletionNotifications(): void {
  watchCompletionNotificationKeys.clear()
}

export function rememberPendingRemoteChannelMirror(
  turnId: string,
  mirror: PendingRemoteChannelMirror
): void {
  const normalizedTurnId = turnId.trim()
  const normalizedMirror = {
    threadId: mirror.threadId.trim(),
    userBlockId: mirror.userBlockId.trim(),
    userText: mirror.userText.trim()
  }
  if (
    !normalizedTurnId ||
    !normalizedMirror.threadId ||
    !normalizedMirror.userBlockId ||
    !normalizedMirror.userText
  ) {
    return
  }
  pendingRemoteChannelMirrors.delete(normalizedTurnId)
  pendingRemoteChannelMirrors.set(normalizedTurnId, normalizedMirror)
  while (pendingRemoteChannelMirrors.size > MAX_PENDING_REMOTE_CHANNEL_MIRRORS) {
    const oldestTurnId = pendingRemoteChannelMirrors.keys().next().value
    if (!oldestTurnId) break
    pendingRemoteChannelMirrors.delete(oldestTurnId)
  }
}

export function takePendingRemoteChannelMirror(
  turnId: string | null | undefined
): PendingRemoteChannelMirror | undefined {
  const normalizedTurnId = turnId?.trim()
  if (!normalizedTurnId) return undefined
  const mirror = pendingRemoteChannelMirrors.get(normalizedTurnId)
  pendingRemoteChannelMirrors.delete(normalizedTurnId)
  return mirror
}

export function clearPendingRemoteChannelMirrors(): void {
  pendingRemoteChannelMirrors.clear()
}

function isUserInputInterruptError(message: string | undefined): boolean {
  const lowered = message?.toLowerCase() ?? ''
  return lowered.includes('cancel') && lowered.includes('awaiting user input')
}

export function runtimeErrorDetail(error: unknown): string {
  const view = describeRuntimeError(error)
  if (view.detail) return view.detail
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return raw === view.summary ? '' : raw
}

export function runtimeStreamRecoveringMessage(): string {
  return i18n.t(RUNTIME_STREAM_RECOVERING_KEY)
}

function isRuntimeStreamRecoveringError(error: string | null | undefined): boolean {
  return (
    error === runtimeStreamRecoveringMessage() ||
    error === LEGACY_RUNTIME_STREAM_RECOVERING_VALUE ||
    error === RUNTIME_STREAM_RECOVERING_KEY
  )
}

function clearRuntimeStreamRecoveringError(error: string | null): string | null {
  return isRuntimeStreamRecoveringError(error) ? null : error
}

function runtimeEventStartedAt(createdAt: string | undefined, now = Date.now()): number {
  if (!createdAt) return now
  const parsed = Date.parse(createdAt)
  if (!Number.isFinite(parsed)) return now
  if (parsed > now + CLOCK_SKEW_TOLERANCE_MS) return now
  if (now - parsed > MAX_RUNTIME_EVENT_TIMER_AGE_MS) return now
  return parsed
}

function mergeLiveReasoningMeta(
  current: RuntimeDisclosureMetadata | null,
  incoming: RuntimeDisclosureMetadata | undefined
): RuntimeDisclosureMetadata | null {
  if (!incoming) return current
  return {
    ...(current ?? {}),
    ...incoming,
    reasoning: {
      ...(current?.reasoning ?? {}),
      ...(incoming.reasoning ?? {})
    }
  }
}

export function forkedMessageCount(blocks: ChatBlock[]): number {
  return blocks.filter((block) => block.kind === 'user' || block.kind === 'assistant').length
}

export function forkedTurnCount(blocks: ChatBlock[]): number {
  return blocks.filter((block) => block.kind === 'user').length
}

function rememberCompletionNotificationKey(key: string): boolean {
  if (!key) return true
  if (completionNotificationKeySet.has(key)) return false
  completionNotificationKeySet.add(key)
  completionNotificationKeys.push(key)
  while (completionNotificationKeys.length > COMPLETION_NOTIFICATION_DEDUPE_LIMIT) {
    const stale = completionNotificationKeys.shift()
    if (stale) completionNotificationKeySet.delete(stale)
  }
  return true
}

export function clearWatchedCompletionNotification(threadId: string): void {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return
  watchCompletionNotificationKeys.delete(normalizedThreadId)
}

function notifyTurnComplete(threadId: string | null, state: ChatState, dedupeKey: string): void {
  if (
    !threadId ||
    typeof window === 'undefined' ||
    typeof window.sciforge?.showTurnCompleteNotification !== 'function'
  ) return
  if (!rememberCompletionNotificationKey(dedupeKey)) return

  const threadTitle =
    state.threads.find((thread) => thread.id === threadId)?.title?.trim() ||
    i18n.t('common:untitledThread')

  void window.sciforge
    .showTurnCompleteNotification({
      threadId,
      title: i18n.t('common:turnCompleteNotificationTitle'),
      body: i18n.t('common:turnCompleteNotificationBody', { title: threadTitle })
    })
    .then((result) => {
      if (result.ok || typeof window.sciforge?.logError !== 'function') return
      void window.sciforge.logError('notification', 'Turn completion notification failed', {
        message: result.message,
        threadId
      }).catch(() => undefined)
    })
    .catch((error: unknown) => {
      if (typeof window.sciforge?.logError !== 'function') return
      void window.sciforge.logError('notification', 'Turn completion notification failed', {
        message: error instanceof Error ? error.message : String(error),
        threadId
      }).catch(() => undefined)
    })
}

/**
 * Compute the patch that finalizes timing for the current in-progress turn.
 * No-op if there is no current turn or its start time was not recorded.
 */
export function finalizeTurnTiming(state: ChatState): Partial<ChatState> {
  const userId = state.currentTurnUserId
  if (!userId) return {}
  const startedAt = state.turnStartedAtByUserId[userId]
  if (typeof startedAt !== 'number') {
    return { currentTurnUserId: null }
  }
  return {
    currentTurnUserId: null,
    turnDurationByUserId: {
      ...state.turnDurationByUserId,
      [userId]: Math.max(0, Date.now() - startedAt)
    }
  }
}

export function flushLiveBlocks(state: ChatState, base: Partial<ChatState> = {}): Partial<ChatState> {
  const nextBlocks = [...state.blocks]
  const now = Date.now()
  const createdAt = new Date(now).toISOString()
  if (state.liveReasoning.trim()) {
    nextBlocks.push({
      kind: 'reasoning',
      id: `r-${now}`,
      createdAt,
      text: state.liveReasoning,
      ...(state.liveReasoningMeta ? { meta: state.liveReasoningMeta } : {})
    })
  }
  if (state.liveAssistant.trim()) {
    nextBlocks.push({ kind: 'assistant', id: `a-${now}`, createdAt, text: state.liveAssistant })
  }
  if (nextBlocks.length === state.blocks.length) {
    return state.liveReasoningMeta ? { ...base, liveReasoningMeta: null } : base
  }
  return {
    ...base,
    blocks: nextBlocks,
    liveReasoning: '',
    liveReasoningMeta: null,
    liveAssistant: ''
  }
}

function flushLiveReasoningOnly(state: ChatState): { blocks: ChatBlock[]; changed: boolean } {
  if (!state.liveReasoning.trim()) return { blocks: state.blocks, changed: false }
  const now = Date.now()
  return {
    blocks: [
      ...state.blocks,
      {
        kind: 'reasoning',
        id: `r-${now}`,
        createdAt: new Date(now).toISOString(),
        text: state.liveReasoning,
        ...(state.liveReasoningMeta ? { meta: state.liveReasoningMeta } : {})
      }
    ],
    changed: true
  }
}

function dedupeChatBlocksById(blocks: ChatBlock[]): ChatBlock[] {
  const seen = new Set<string>()
  const next: ChatBlock[] = []
  let changed = false

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (seen.has(block.id)) {
      changed = true
      continue
    }
    seen.add(block.id)
    next.push(block)
  }

  return changed ? next.reverse() : blocks
}

function upsertAssistantMessageBlock(
  blocks: ChatBlock[],
  ev: AssistantMessageEventPayload
): ChatBlock[] {
  return insertCanonicalAssistantBlock(blocks, {
    kind: 'assistant',
    id: ev.itemId,
    createdAt: ev.createdAt ?? new Date().toISOString(),
    text: ev.text,
    ...(ev.meta ? { meta: ev.meta } : {})
  }, null)
}

function sameAssistantText(left: string, right: string): boolean {
  return left.trim() === right.trim()
}

function turnBoundsForUserBlock(blocks: ChatBlock[], userBlockId: string): { start: number; end: number } | null {
  const start = blocks.findIndex((block) => block.kind === 'user' && block.id === userBlockId)
  if (start < 0) return null
  let end = blocks.length
  for (let index = start + 1; index < blocks.length; index += 1) {
    if (blocks[index].kind === 'user') {
      end = index
      break
    }
  }
  return { start, end }
}

function insertCanonicalAssistantBlock(
  blocks: ChatBlock[],
  assistant: Extract<ChatBlock, { kind: 'assistant' }>,
  userBlockId: string | null
): ChatBlock[] {
  const existingIndex = blocks.findIndex((block) => block.kind === 'assistant' && block.id === assistant.id)
  if (existingIndex >= 0) {
    const existing = blocks[existingIndex]
    if (existing.kind !== 'assistant') return blocks
    if (
      existing.text === assistant.text &&
      existing.createdAt === assistant.createdAt &&
      existing.meta === assistant.meta
    ) {
      return dedupeChatBlocksById(blocks)
    }
    const next = [...blocks]
    next[existingIndex] = {
      ...existing,
      createdAt: assistant.createdAt,
      text: assistant.text,
      ...(assistant.meta ? { meta: assistant.meta } : {})
    }
    return dedupeChatBlocksById(next)
  }

  const bounds = userBlockId ? turnBoundsForUserBlock(blocks, userBlockId) : null
  const searchStart = bounds ? bounds.start + 1 : 0
  const searchEnd = bounds ? bounds.end : blocks.length
  for (let index = searchEnd - 1; index >= searchStart; index -= 1) {
    const block = blocks[index]
    if (
      block.kind === 'assistant' &&
      block.id.startsWith('a-') &&
      sameAssistantText(block.text, assistant.text)
    ) {
      const next = [...blocks]
      next[index] = {
        ...block,
        id: assistant.id,
        createdAt: assistant.createdAt,
        text: assistant.text,
        ...(assistant.meta ? { meta: assistant.meta } : {})
      }
      return dedupeChatBlocksById(next)
    }
  }

  const next = [...blocks]
  next.splice(bounds?.end ?? blocks.length, 0, assistant)
  return dedupeChatBlocksById(next)
}

function mergeCanonicalAssistantBlocks(current: ChatBlock[], canonical: ChatBlock[]): ChatBlock[] {
  let next = current
  let currentUserBlockId: string | null = null

  for (const block of canonical) {
    if (block.kind === 'user') {
      currentUserBlockId = block.id
      continue
    }
    if (block.kind !== 'assistant' || !block.text.trim()) continue
    next = insertCanonicalAssistantBlock(next, block, currentUserBlockId)
  }

  return dedupeChatBlocksById(next)
}

function goalStatusText(status: string): string {
  switch (status) {
    case 'active':
      return i18n.t('common:goalStatusActive')
    case 'paused':
      return i18n.t('common:goalStatusPaused')
    case 'blocked':
      return i18n.t('common:goalStatusBlocked')
    case 'usageLimited':
      return i18n.t('common:goalStatusUsageLimited')
    case 'budgetLimited':
      return i18n.t('common:goalStatusBudgetLimited')
    case 'complete':
      return i18n.t('common:goalStatusComplete')
    default:
      return status
  }
}

function goalTimelineText(goal: NonNullable<ChatState['activeThreadGoal']> | null, cleared?: boolean): string {
  if (!goal || cleared) return i18n.t('common:goalClearedTimeline')
  return i18n.t('common:goalUpdatedTimeline', {
    status: goalStatusText(goal.status),
    objective: goal.objective
  })
}

export function shouldOpenSettingsForError(error: unknown): boolean {
  return describeRuntimeError(error).settingsAction === 'agents'
}

export function isCodeThread(
  thread: NormalizedThread,
  clawChannels: ClawImChannelV1[] = []
): boolean {
  const workspace = normalizeWorkspaceRoot(thread.workspace)
  return Boolean(workspace) &&
    thread.archived !== true &&
    !isInternalTemporaryWorkspace(thread.workspace) &&
    !isClawWorkspacePath(thread.workspace) &&
    !isClawThread(thread, clawChannels) &&
    !isSddAssistantThread(thread) &&
    !isEmptySddAssistantThreadCandidate(thread)
}

export function latestThread(threads: NormalizedThread[]): NormalizedThread | null {
  return [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null
}

function runtimeStatusText(event: RuntimeStatusEventPayload): string {
  if (event.kind === 'tool_result_upload_wait') {
    return i18n.t('common:toolUploadWaitStatus', { count: event.toolResultCount ?? 0 })
  }
  if (event.kind === 'tool_catalog_changed') {
    return event.message?.trim() || i18n.t('common:toolCatalogChangedStatus')
  }
  if (event.kind === 'tool_storm_suppressed') {
    return event.message?.trim() || i18n.t('common:toolStormSuppressedStatus', {
      tool: event.toolName ?? 'tool'
    })
  }
  if (event.kind === 'compaction_summary_fallback') {
    return event.message?.trim() || i18n.t('common:compactionSummaryFallbackStatus')
  }
  if (event.kind === 'runtime_handoff') {
    return i18n.t('common:runtimeHandoffStatus', {
      source: runtimeDisplayName(event.sourceRuntimeId),
      target: runtimeDisplayName(event.targetRuntimeId)
    })
  }
  return event.message?.trim() || ''
}

function runtimeDisplayName(runtimeId: string | undefined): string {
  if (runtimeId === 'sciforge') return 'SciForge Runtime'
  if (runtimeId === 'codex') return 'Codex'
  if (runtimeId === 'claude') return 'Claude'
  return runtimeId?.trim() || 'runtime'
}

function isThreadLifecycleRuntimeStatus(event: RuntimeStatusEventPayload): boolean {
  return event.phase === 'thread_start_done'
}

function isBusyWatchdogRuntimeActivity(event: RuntimeStatusEventPayload): boolean {
  return event.phase === 'tool_running' ||
    event.phase === 'tool_waiting' ||
    event.phase === 'reconnecting' ||
    event.phase === 'stream_recovering'
}

function terminalStateFromRuntimeStatus(event: RuntimeStatusEventPayload): TurnLifecycleEventPayload['state'] | null {
  if (event.phase !== 'turn_done') return null
  const message = event.message?.trim().toLowerCase() ?? ''
  if (message.includes('cancel')) return 'cancelled'
  if (message.includes('abort') || message.includes('interrupt')) return 'aborted'
  if (message.includes('error') || message.includes('fail')) return 'failed'
  return 'completed'
}

function runtimeErrorPayloadToError(event: {
  message: string
  code?: string
  details?: unknown
  severity?: string
}): Error {
  return new Error(JSON.stringify({
    ...(event.code ? { code: event.code } : {}),
    message: event.message,
    ...(event.details !== undefined ? { details: event.details } : {}),
    ...(event.severity ? { severity: event.severity } : {})
  }))
}

function upsertRuntimeErrorBlock(blocks: ChatBlock[], block: Extract<ChatBlock, { kind: 'system' }>): ChatBlock[] {
  const index = blocks.findIndex((candidate) => candidate.kind === 'system' && candidate.id === block.id)
  if (index < 0) return [...blocks, block]
  const next = [...blocks]
  next[index] = block
  return next
}

export function armBusyWatchdog(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): void {
  const timeoutMinutes = Math.max(1, Math.round((BUSY_WATCHDOG_MS * (MAX_BUSY_RECOVERY_ATTEMPTS + 1)) / 60_000))
  armBusyWatchdogImpl(set, get, {
    timeoutMs: BUSY_WATCHDOG_MS,
    maxAttempts: MAX_BUSY_RECOVERY_ATTEMPTS,
    finalizeBusyState: finalizeTurnTiming,
    flushLiveBlocks,
    busyTimeoutMessage: () => i18n.t('common:busyTimeout', { minutes: timeoutMinutes })
  })
}

export function syncTurnCompletionPoll(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): void {
  syncTurnCompletionPollImpl(set, get, {
    loadThreadState: async (state, threadId) => {
      const provider = getProvider()
      rememberProviderThreadRuntime(provider, threadId, state.threads)
      return provider.getThreadDetail(threadId)
    },
    threadLooksRunning: threadSnapshotLooksRunning,
    onCompletedThreads: async (doneIds, state, setState, getState) => {
      for (const id of doneIds) {
        notifyTurnComplete(
          id,
          state,
          completionNotificationDedupeKeyForWatchedThread(id)
        )
        clearWatchedCompletionNotification(id)
      }
      setState((snapshot) => {
        const watchTurnCompletion = { ...snapshot.watchTurnCompletion }
        const unreadThreadIds = { ...snapshot.unreadThreadIds }
        for (const id of doneIds) {
          delete watchTurnCompletion[id]
          unreadThreadIds[id] = true
        }
        return { watchTurnCompletion, unreadThreadIds }
      })
      void getState().refreshThreads()
    }
  })
}

function refreshCompletedThreadSnapshot(
  threadId: string | null,
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): void {
  const targetThreadId = threadId?.trim()
  if (!targetThreadId) return

  void (async () => {
    try {
      const provider = getProvider()
      rememberProviderThreadRuntime(provider, targetThreadId, get().threads)
      const detail = await provider.getThreadDetail(targetThreadId)
      const canonicalBlocks = hydrateBlockModelLabels(targetThreadId, detail.blocks)
      set((state) => {
        if (state.activeThreadId !== targetThreadId) return {}
        if (state.busy || state.currentTurnId) return {}
        const mergedBlocks = mergeCanonicalAssistantBlocks(state.blocks, canonicalBlocks)
        const latestSeq =
          typeof detail.latestSeq === 'number'
            ? Math.max(state.lastSeq, detail.latestSeq)
            : state.lastSeq
        const activeThreadGoal = detail.goal ?? null
        const activeThreadTodos = detail.todos ?? null
        const threads = state.threads.map((thread) =>
          thread.id === targetThreadId
            ? { ...thread, goal: activeThreadGoal, todos: activeThreadTodos }
            : thread
        )
        return {
          blocks: mergedBlocks,
          lastSeq: latestSeq,
          threads,
          activeThreadGoal,
          activeThreadTodos,
          liveAssistant: '',
          liveReasoning: '',
          liveReasoningMeta: null
        }
      })
    } catch {
      /* Best-effort snapshot refresh; the live stream path already completed. */
    }
  })()
}

export type ThreadEventSinkBinding = {
  threadId?: string
  signal?: AbortSignal
  sinceSeq?: number
}

function runtimeEventReplayKey(event: AgentRuntimeEvent): string {
  const record = event as unknown as Record<string, unknown>
  const child = record.child && typeof record.child === 'object'
    ? record.child as Record<string, unknown>
    : null
  return [
    event.kind,
    event.threadId ?? '',
    event.turnId ?? '',
    stringRecordValue(record, 'itemId'),
    stringRecordValue(record, 'approvalId'),
    stringRecordValue(record, 'requestId'),
    stringRecordValue(record, 'phase'),
    stringRecordValue(record, 'state'),
    stringRecordValue(record, 'status'),
    stringRecordValue(record, 'decision'),
    child ? stringRecordValue(child, 'id') : '',
    event.kind === 'assistant_delta' || event.kind === 'reasoning_delta'
      ? stringRecordValue(record, 'text')
      : ''
  ].join('\u0001')
}

function deltaReplayKey(delta: ThreadDeltaEvent): string {
  return [
    delta.kind,
    delta.itemId ?? '',
    delta.itemId ? '' : delta.text
  ].join('\u0001')
}

function stringRecordValue(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

export function buildThreadEventSink(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
  binding: ThreadEventSinkBinding = {}
): ThreadEventSink {
  const boundThreadId = binding.threadId?.trim() ?? ''
  let appliedEventSeqFloor = binding.sinceSeq ?? 0
  let appliedEventKeysAtFloor: Set<string> | null = null
  let appliedDeltaSeqFloor = binding.sinceSeq ?? 0
  let appliedDeltaKeysAtFloor: Set<string> | null = null
  const settledTerminalTurnKeys = new Set<string>()
  const isCurrentStream = (): boolean => {
    if (binding.signal?.aborted) return false
    return !boundThreadId || get().activeThreadId === boundThreadId
  }

  const shouldApplyRuntimeEvent: AgentRuntimeEventReplayFilter = (event) => {
    if (!isCurrentStream()) return false
    if (event.kind === 'heartbeat') return false
    if (typeof event.seq !== 'number') return true
    const key = runtimeEventReplayKey(event)
    if (event.seq < appliedEventSeqFloor) return false
    if (event.seq === appliedEventSeqFloor) {
      if (!appliedEventKeysAtFloor || appliedEventKeysAtFloor.has(key)) return false
      appliedEventKeysAtFloor.add(key)
      return true
    }
    appliedEventSeqFloor = event.seq
    appliedEventKeysAtFloor = new Set([key])
    return true
  }

  const terminalTurnKey = (ev: TurnLifecycleEventPayload, state: ChatState): string => {
    const turnId = ev.turnId?.trim() || state.currentTurnId?.trim()
    if (turnId) return `turn:${turnId}`
    return ''
  }

  const hasTerminalWorkToSettle = (state: ChatState): boolean =>
    state.busy ||
    Boolean(state.currentTurnId) ||
    Boolean(state.liveAssistant.trim()) ||
    Boolean(state.liveReasoning.trim()) ||
    state.blocks.some(hasPendingRuntimeWork)

  const settleTerminalTurn = (ev: TurnLifecycleEventPayload): void => {
    if (!isCurrentStream()) return
    if (!isAgentRuntimeTerminalTurnState(ev.state)) return
    const beforeState = get()
    const terminalKey = terminalTurnKey(ev, beforeState)
    if (terminalKey && settledTerminalTurnKeys.has(terminalKey)) return
    if (!hasTerminalWorkToSettle(beforeState)) return
    if (terminalKey) settledTerminalTurnKeys.add(terminalKey)
    resetBusyRecoveryAttempts()
    clearBusyWatchdog()
    const completedState = get()
    const completedThreadId = completedState.activeThreadId
    const completedTurnId = completedState.currentTurnId
    const completedKey = completedState.currentTurnId
      ? `turn:${completedState.currentTurnId}`
      : `active:${completedThreadId ?? 'unknown'}:${completedState.lastSeq}`
    const completed = ev.state === 'completed'
    const pendingMirror = takePendingRemoteChannelMirror(completedTurnId)
    const assistantMirrorText =
      completed && pendingMirror
        ? collectAssistantTextForTurn(
            completedState.blocks,
            pendingMirror.userBlockId,
            completedState.liveAssistant
          )
        : ''
    set((s) => {
      const base = flushLiveBlocks(s, {
        ...finalizeTurnTiming(s),
        error: completed || ev.state === 'cancelled' || ev.state === 'aborted'
          ? null
          : ev.message?.trim() || 'Turn failed',
        currentTurnId: null,
        currentTurnUserId: null
      })
      if (s.busy) base.busy = false
      base.blocks = completed
        ? settlePendingRuntimeWorkAfterCompletion(base.blocks ?? s.blocks)
        : settlePendingRuntimeWorkAfterInterrupt(base.blocks ?? s.blocks)
      const id = s.activeThreadId
      if (id) {
        const w = { ...s.watchTurnCompletion }
        delete w[id]
        clearWatchedCompletionNotification(id)
        base.watchTurnCompletion = w
        const u = { ...s.unreadThreadIds }
        delete u[id]
        base.unreadThreadIds = u
      }
      return base
    })
    if (completed) refreshCompletedThreadSnapshot(completedThreadId, set, get)
    const mirrorRemoteChannelMessage = typeof window !== 'undefined'
      ? mirrorRemoteChannelMessageApi(window.sciforge)
      : undefined
    if (
      completed &&
      pendingMirror &&
      assistantMirrorText &&
      typeof mirrorRemoteChannelMessage === 'function'
    ) {
      void mirrorRemoteChannelMessage(
        pendingMirror.threadId,
        assistantMirrorText,
        'assistant'
      ).catch(() => undefined)
    }
    if (completed) notifyTurnComplete(completedThreadId, completedState, completedKey)
    syncTurnCompletionPoll(set, get)
    void get().refreshThreads()
    void get().drainQueuedMessages()
  }

  const sink: ThreadEventSink & {
    [AGENT_RUNTIME_EVENT_REPLAY_FILTER]: AgentRuntimeEventReplayFilter
  } = {
    [AGENT_RUNTIME_EVENT_REPLAY_FILTER]: shouldApplyRuntimeEvent,
    onSeq: (seq) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((s) => ({
        lastSeq: Math.max(s.lastSeq, seq),
        error: clearRuntimeStreamRecoveringError(s.error)
      }))
    },
    onUserMessage: (ev) =>
      set((s) => {
        if (!isCurrentStream()) return {}
        resetBusyRecoveryAttempts()
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const optimisticCurrentUserId = s.currentTurnUserId
        const reconciledBlocks =
          optimisticCurrentUserId &&
          optimisticCurrentUserId !== ev.itemId &&
          baseBlocks.some((block) => block.kind === 'user' && block.id === optimisticCurrentUserId)
            ? reconcileOptimisticUserBlock(
                baseBlocks,
                optimisticCurrentUserId,
                ev.itemId,
                ev.text,
                ev.modelLabel
              )
            : baseBlocks
        const nextBlocks = upsertUserBlock(reconciledBlocks, ev)
        const startedAt = runtimeEventStartedAt(ev.createdAt)
        armBusyWatchdog(set, get)
        return {
          ...flushed,
          blocks: nextBlocks,
          busy: true,
          currentTurnId: ev.turnId ?? s.currentTurnId,
          currentTurnUserId: ev.itemId,
          turnStartedAtByUserId: {
            ...s.turnStartedAtByUserId,
            [ev.itemId]: s.turnStartedAtByUserId[ev.itemId] ?? startedAt
          },
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      }),
    onAssistantMessage: (ev) =>
      set((s) => {
        if (!isCurrentStream()) return {}
        if (!ev.text.trim()) return {}
        resetBusyRecoveryAttempts()
        const flushedReasoning = flushLiveReasoningOnly(s)
        const nextBlocks = upsertAssistantMessageBlock(flushedReasoning.blocks, ev)
        return {
          blocks: nextBlocks,
          ...(flushedReasoning.changed || s.liveReasoning
            ? { liveReasoning: '', liveReasoningMeta: null }
            : {}),
          ...(s.liveAssistant ? { liveAssistant: '' } : {}),
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      }),
    onDeltas: (rawDeltas) => {
      if (!isCurrentStream()) return
      const deltas: typeof rawDeltas = []
      for (const delta of rawDeltas) {
        if (typeof delta.seq === 'number') {
          const key = deltaReplayKey(delta)
          if (delta.seq < appliedDeltaSeqFloor) continue
          if (delta.seq === appliedDeltaSeqFloor) {
            if (!appliedDeltaKeysAtFloor || appliedDeltaKeysAtFloor.has(key)) continue
            appliedDeltaKeysAtFloor.add(key)
            deltas.push(delta)
            continue
          }
          appliedDeltaSeqFloor = delta.seq
          appliedDeltaKeysAtFloor = new Set([key])
        }
        deltas.push(delta)
      }
      if (deltas.length === 0) return
      set((s) => {
        if (!isCurrentStream()) return {}
        resetBusyRecoveryAttempts()
        const nextError = clearRuntimeStreamRecoveringError(s.error)
        const seqs = deltas
          .map((delta) => delta.seq)
          .filter((value): value is number => typeof value === 'number')
        const nextLastSeq = seqs.length > 0 ? Math.max(s.lastSeq, ...seqs) : s.lastSeq
        const base: Partial<ChatState> = {
          error: nextError,
          ...(nextLastSeq !== s.lastSeq ? { lastSeq: nextLastSeq } : {})
        }
        let liveReasoning = s.liveReasoning
        let liveReasoningMeta = s.liveReasoning.trim() ? s.liveReasoningMeta : null
        let liveAssistant = s.liveAssistant
        let nextReasoningFirstAtByUserId = s.turnReasoningFirstAtByUserId
        let nextReasoningLastAtByUserId = s.turnReasoningLastAtByUserId
        const userId = s.currentTurnUserId
        for (const delta of deltas) {
          if (delta.kind === 'agent_reasoning') {
            if (!liveReasoning.trim()) liveReasoningMeta = null
            liveReasoning += delta.text
            liveReasoningMeta = mergeLiveReasoningMeta(liveReasoningMeta, delta.meta)
            if (userId) {
              const now = Date.now()
              if (typeof nextReasoningFirstAtByUserId[userId] !== 'number') {
                nextReasoningFirstAtByUserId =
                  nextReasoningFirstAtByUserId === s.turnReasoningFirstAtByUserId
                    ? { ...s.turnReasoningFirstAtByUserId, [userId]: now }
                    : { ...nextReasoningFirstAtByUserId, [userId]: now }
              }
              nextReasoningLastAtByUserId =
                nextReasoningLastAtByUserId === s.turnReasoningLastAtByUserId
                  ? { ...s.turnReasoningLastAtByUserId, [userId]: now }
                  : { ...nextReasoningLastAtByUserId, [userId]: now }
            }
            continue
          }
          liveAssistant += delta.text
        }
        return {
          ...base,
          ...(liveReasoning !== s.liveReasoning ? { liveReasoning } : {}),
          ...(liveReasoningMeta !== s.liveReasoningMeta ? { liveReasoningMeta } : {}),
          ...(liveAssistant !== s.liveAssistant ? { liveAssistant } : {}),
          ...(nextReasoningFirstAtByUserId !== s.turnReasoningFirstAtByUserId
            ? { turnReasoningFirstAtByUserId: nextReasoningFirstAtByUserId }
            : {}),
          ...(nextReasoningLastAtByUserId !== s.turnReasoningLastAtByUserId
            ? { turnReasoningLastAtByUserId: nextReasoningLastAtByUserId }
            : {})
        }
      })
    },
    onTool: (ev) => {
      if (!isCurrentStream()) return
      set((s) => {
        resetBusyRecoveryAttempts()
        const base: Partial<ChatState> = {}
        if (s.busy) {
          armBusyWatchdog(set, get)
        }
        const idx = s.blocks.findIndex((b) => b.kind === 'tool' && b.id === ev.itemId)
        if (idx >= 0) {
          const cur = s.blocks[idx]
          if (cur.kind !== 'tool') return { ...base }
          const next: ToolBlock = {
            ...cur,
            summary: ev.summary || cur.summary,
            status: ev.status,
            toolKind: ev.toolKind ?? cur.toolKind,
            detail: ev.detail ?? cur.detail,
            filePath: ev.filePath ?? cur.filePath,
            meta: ev.meta ?? cur.meta
          }
          const blocks = [...s.blocks]
          blocks[idx] = next
          return {
            ...base,
            blocks,
            error: clearRuntimeStreamRecoveringError(s.error)
          }
        }
        // New tool — flush pending live reasoning/assistant first so each
        // reasoning segment becomes its own timeline block in chronological
        // order, rather than collapsing into one giant trailing block.
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const block: ToolBlock = {
          kind: 'tool',
          id: ev.itemId,
          createdAt: new Date().toISOString(),
          summary: ev.summary,
          status: ev.status,
          toolKind: ev.toolKind,
          detail: ev.detail,
          filePath: ev.filePath,
          meta: ev.meta
        }
        return {
          ...base,
          ...flushed,
          blocks: [...baseBlocks, block],
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onCompaction: (ev) => {
      if (!isCurrentStream()) return
      void get().refreshActiveThreadContextState?.(boundThreadId || undefined)
      set((s) => {
        resetBusyRecoveryAttempts()
        const base: Partial<ChatState> = {}
        if (!s.busy && ev.status === 'running') {
          base.busy = true
          armBusyWatchdog(set, get)
        }
        const idx = s.blocks.findIndex((b) => b.kind === 'compaction' && b.id === ev.itemId)
        if (idx >= 0) {
          const cur = s.blocks[idx]
          if (cur.kind !== 'compaction') return { ...base }
          const next: CompactionBlock = {
            ...cur,
            summary: ev.summary || cur.summary,
            status: ev.status,
            detail: ev.detail ?? cur.detail,
            auto: ev.auto ?? cur.auto,
            messagesBefore: ev.messagesBefore ?? cur.messagesBefore,
            messagesAfter: ev.messagesAfter ?? cur.messagesAfter,
            replacedTokens: ev.replacedTokens ?? cur.replacedTokens,
            sourceDigest: ev.sourceDigest ?? cur.sourceDigest,
            digestMarker: ev.digestMarker ?? cur.digestMarker,
            sourceItemIds: ev.sourceItemIds ?? cur.sourceItemIds,
            createdAt: cur.createdAt ?? ev.createdAt
          }
          const blocks = [...s.blocks]
          blocks[idx] = next
          return {
            ...base,
            blocks,
            error: clearRuntimeStreamRecoveringError(s.error)
          }
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const block: CompactionBlock = {
          kind: 'compaction',
          id: ev.itemId,
          createdAt: ev.createdAt ?? new Date().toISOString(),
          summary: ev.summary,
          status: ev.status,
          detail: ev.detail,
          auto: ev.auto,
          messagesBefore: ev.messagesBefore,
          messagesAfter: ev.messagesAfter,
          replacedTokens: ev.replacedTokens,
          sourceDigest: ev.sourceDigest,
          digestMarker: ev.digestMarker,
          sourceItemIds: ev.sourceItemIds
        }
        return {
          ...base,
          ...flushed,
          blocks: [...baseBlocks, block],
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onReview: (ev: ReviewEventPayload) => {
      if (!isCurrentStream()) return
      set((s) => {
        resetBusyRecoveryAttempts()
        const base: Partial<ChatState> = {}
        if (!s.busy && ev.status === 'running') {
          base.busy = true
          armBusyWatchdog(set, get)
        }
        const idx = s.blocks.findIndex((b) => b.kind === 'review' && b.id === ev.itemId)
        if (idx >= 0) {
          const cur = s.blocks[idx]
          if (cur.kind !== 'review') return { ...base }
          const next: ReviewBlock = {
            ...cur,
            title: ev.title || cur.title,
            status: ev.status,
            target: ev.target ?? cur.target,
            reviewText: ev.reviewText ?? cur.reviewText,
            output: ev.output ?? cur.output,
            createdAt: cur.createdAt ?? ev.createdAt
          }
          const blocks = [...s.blocks]
          blocks[idx] = next
          return {
            ...base,
            blocks,
            error: clearRuntimeStreamRecoveringError(s.error)
          }
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const block: ReviewBlock = {
          kind: 'review',
          id: ev.itemId,
          createdAt: ev.createdAt ?? new Date().toISOString(),
          title: ev.title,
          status: ev.status,
          target: ev.target,
          reviewText: ev.reviewText,
          output: ev.output
        }
        return {
          ...base,
          ...flushed,
          blocks: [...baseBlocks, block],
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onApproval: (req) =>
      set((s) => {
        if (!isCurrentStream()) return {}
        resetBusyRecoveryAttempts()
        const status = req.status ?? 'pending'
        const idx = s.blocks.findIndex((b) => b.kind === 'approval' && b.approvalId === req.approvalId)
        if (idx >= 0) {
          const cur = s.blocks[idx]
          if (cur.kind !== 'approval') return {}
          const blocks = [...s.blocks]
          blocks[idx] = {
            ...cur,
            summary: req.summary || cur.summary,
            toolName: req.toolName ?? cur.toolName,
            status,
            errorMessage: req.errorMessage ?? cur.errorMessage,
            meta: req.meta ?? cur.meta
          }
          return {
            blocks,
            error: clearRuntimeStreamRecoveringError(s.error)
          }
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        return {
          ...flushed,
          blocks: [
            ...baseBlocks,
            {
              kind: 'approval',
              id: `approval-${req.approvalId}`,
              createdAt: new Date().toISOString(),
              approvalId: req.approvalId,
              summary: req.summary,
              toolName: req.toolName,
              status,
              ...(req.errorMessage ? { errorMessage: req.errorMessage } : {}),
              ...(req.meta ? { meta: req.meta } : {})
            }
          ],
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      }),
    onUserInput: (req) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      set((s) => {
        const existingIndex = s.blocks.findIndex((b) => b.kind === 'user_input' && b.requestId === req.requestId)
        if (existingIndex >= 0) {
          const blocks = [...s.blocks]
          const existing = blocks[existingIndex]
          if (existing?.kind === 'user_input') {
            blocks[existingIndex] = {
              ...existing,
              id: req.itemId,
              requestId: req.requestId,
              questions: req.questions.length > 0 ? req.questions : existing.questions,
              status: existing.status === 'pending' ? 'pending' : existing.status
            }
          }
          return { blocks, error: clearRuntimeStreamRecoveringError(s.error) }
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        return {
          ...flushed,
          blocks: [
            ...baseBlocks,
            {
              kind: 'user_input',
              id: req.itemId,
              createdAt: new Date().toISOString(),
              requestId: req.requestId,
              questions: req.questions,
              status: 'pending' as const
            }
          ],
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onUserInputStatus: (ev) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      if (ev.status === 'submitted' && get().busy) {
        armBusyWatchdog(set, get)
      }
      set((s) => ({
        error: clearRuntimeStreamRecoveringError(s.error),
        blocks: s.blocks.map((b) =>
          b.kind === 'user_input' && b.id === ev.itemId
            ? b.status === 'submitted' && ev.status === 'error' && isUserInputInterruptError(ev.errorMessage)
              ? b
              : {
                  ...b,
                  status: ev.status,
                  answers: ev.answers ?? b.answers,
                  errorMessage: ev.errorMessage ?? b.errorMessage
                }
            : b
        )
      }))
    },
    onRuntimeStatus: (ev) => {
      if (!isCurrentStream()) return
      if (isThreadLifecycleRuntimeStatus(ev)) return
      const terminalState = terminalStateFromRuntimeStatus(ev)
      set((s) => {
        resetBusyRecoveryAttempts()
        const base: Partial<ChatState> = {}
        if (s.busy && isBusyWatchdogRuntimeActivity(ev)) {
          armBusyWatchdog(set, get)
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const text = runtimeStatusText(ev)
        const block: ChatBlock = {
          kind: 'system',
          id: ev.itemId,
          createdAt: ev.createdAt ?? new Date().toISOString(),
          text
        }
        const idx = baseBlocks.findIndex((candidate) => candidate.kind === 'system' && candidate.id === ev.itemId)
        const blocks = [...baseBlocks]
        if (idx >= 0) blocks[idx] = block
        else blocks.push(block)
        return {
          ...base,
          ...flushed,
          blocks,
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
      if (terminalState) {
        settleTerminalTurn({
          turnId: ev.turnId,
          state: terminalState,
          message: ev.message,
          createdAt: ev.createdAt
        })
      }
    },
    onRuntimeError: (ev) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      set((s) => {
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const view = describeRuntimeError(runtimeErrorPayloadToError(ev))
        const block: Extract<ChatBlock, { kind: 'system' }> = {
          kind: 'system',
          id: ev.itemId,
          createdAt: ev.createdAt ?? new Date().toISOString(),
          text: view.summary,
          ...(view.code ? { code: view.code } : {}),
          ...(view.detail ? { detail: view.detail } : {}),
          severity: ev.severity ?? 'error'
        }
        return {
          ...flushed,
          blocks: upsertRuntimeErrorBlock(baseBlocks, block),
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onTurnLifecycle: (ev) => {
      if (!isCurrentStream()) return
      if (isAgentRuntimeTerminalTurnState(ev.state)) {
        settleTerminalTurn(ev)
        return
      }
      if (!isAgentRuntimeActiveTurnState(ev.state)) return
      resetBusyRecoveryAttempts()
      set((s) => ({
        busy: true,
        currentTurnId: ev.turnId ?? s.currentTurnId,
        error: clearRuntimeStreamRecoveringError(s.error)
      }))
      armBusyWatchdog(set, get)
    },
    onGoal: (ev) => {
      if (!isCurrentStream()) return
      if (!ev.threadId) return
      void get().refreshActiveThreadContextState?.(ev.threadId)
      resetBusyRecoveryAttempts()
      set((s) => {
        const currentThread = s.activeThreadId === ev.threadId
        const updatedAt = ev.goal?.updatedAt ?? ev.createdAt ?? new Date().toISOString()
        const nextThreads = s.threads.map((thread) =>
          thread.id === ev.threadId
            ? {
                ...thread,
                goal: ev.goal,
                updatedAt
              }
            : thread
        )
        if (!currentThread) {
          return { threads: nextThreads }
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const block: ChatBlock = {
          kind: 'system',
          id: `goal-${ev.threadId}-${updatedAt}-${ev.goal?.status ?? 'cleared'}`,
          createdAt: updatedAt,
          text: goalTimelineText(ev.goal, ev.cleared)
        }
        return {
          ...flushed,
          activeThreadGoal: ev.goal,
          threads: nextThreads,
          blocks: [...baseBlocks, block],
          error: clearRuntimeStreamRecoveringError(s.error)
        }
      })
    },
    onTodos: (ev) => {
      if (!isCurrentStream()) return
      if (!ev.threadId) return
      resetBusyRecoveryAttempts()
      set((s) => {
        const currentThread = s.activeThreadId === ev.threadId
        const todos = ev.cleared ? null : ev.todos
        const updatedAt = todos?.updatedAt ?? ev.createdAt ?? new Date().toISOString()
        const nextThreads = s.threads.map((thread) =>
          thread.id === ev.threadId
            ? {
                ...thread,
                todos,
                updatedAt
              }
            : thread
        )
        return currentThread
          ? {
              activeThreadTodos: todos,
              threads: nextThreads,
              error: clearRuntimeStreamRecoveringError(s.error)
            }
          : { threads: nextThreads }
      })
    },
    onTurnComplete: () => {
      settleTerminalTurn({ state: 'completed' })
    },
    onError: (err) => {
      if (!isCurrentStream()) return
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const state = get()
      const message = formatRuntimeError(err)
      const detail = runtimeErrorDetail(err)
      takePendingRemoteChannelMirror(state.currentTurnId)
      set((s) => {
        const wasBusy = s.busy
        const out = flushLiveBlocks(s, {
          ...finalizeTurnTiming(s),
          error: message,
          runtimeErrorDetail: detail || null
        })
        // Keep the busy flag if the turn was active — the interrupt button
        // should stay visible so the user can interrupt a stuck turn. The
        // watchdog (re-armed below) will eventually time out if the turn
        // never recovers.
        if (!wasBusy) {
          out.busy = false
          out.currentTurnId = null
          out.currentTurnUserId = null
          out.blocks = settlePendingRuntimeWorkAfterInterrupt(out.blocks ?? s.blocks)
        }
        return out
      })
      // Re-arm the watchdog so a stuck SSE stream doesn't leave the UI
      // permanently in the busy state.
      if (get().busy) armBusyWatchdog(set, get)
    },
    onChild: () => {
      if (!isCurrentStream()) return
      set((s) => ({ childRefreshKey: (s.childRefreshKey ?? 0) + 1 }))
    },
    onUsage: () => {
      if (!isCurrentStream()) return
      set((s) => ({ usageRefreshKey: s.usageRefreshKey + 1 }))
    }
  }
  return sink
}
