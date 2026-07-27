import type { ChatBlock } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'

let startupRuntimeProbeTimer: ReturnType<typeof setTimeout> | null = null
let busyWatchdogTimer: ReturnType<typeof setTimeout> | null = null
let busyRecoveryAttempts = 0
let turnCompletionPollTimer: ReturnType<typeof setTimeout> | null = null
let turnCompletionPollInFlight = false
let turnCompletionPollGeneration = 0
let runtimeThreadRefreshPollTimer: ReturnType<typeof setTimeout> | null = null
let runtimeThreadRefreshInFlight = false
let runtimeThreadRefreshIdleDelayMs = 0
let runtimeThreadRefreshFocusCleanup: (() => void) | null = null
let runtimeReconnectProbeTimer: ReturnType<typeof setTimeout> | null = null
let runtimeReconnectProbeAttempt = 0
let runtimeBootRetryTimer: ReturnType<typeof setTimeout> | null = null

const ACTIVE_RUNTIME_THREAD_REFRESH_POLL_MS = 5_000
const FOCUSED_IDLE_RUNTIME_THREAD_REFRESH_POLL_MS = 30_000
const HIDDEN_IDLE_RUNTIME_THREAD_REFRESH_POLL_MS = 120_000
const MAX_IDLE_RUNTIME_THREAD_REFRESH_POLL_MS = 120_000
const RUNTIME_RECONNECT_PROBE_MIN_MS = 1_500
const RUNTIME_RECONNECT_PROBE_MAX_MS = 10_000
const RUNTIME_BOOT_RETRY_MS = 1_500
const TURN_COMPLETION_POLL_MS = 2_500
const HIDDEN_TURN_COMPLETION_POLL_MS = 15_000

type RuntimeThreadRefreshPollOptions = {
  activeIntervalMs?: number
  focusedIdleIntervalMs?: number
  hiddenIdleIntervalMs?: number
  maxIdleIntervalMs?: number
  intervalMs?: number
}

type BusyWatchdogOptions = {
  timeoutMs: number
  maxAttempts: number
  finalizeBusyState: (state: ChatState) => Partial<ChatState>
  flushLiveBlocks: (state: ChatState, base: Partial<ChatState>) => Partial<ChatState>
  busyTimeoutMessage: () => string
}

type TurnCompletionPollOptions = {
  loadThreadState: (
    state: ChatState,
    threadId: string
  ) => Promise<{ blocks: ChatBlock[]; threadStatus?: string }>
  threadLooksRunning: (blocks: ChatBlock[], threadStatus?: string) => boolean
  onCompletedThreads: (
    doneIds: string[],
    state: ChatState,
    set: ChatStoreSet,
    get: ChatStoreGet
  ) => void | Promise<void>
  intervalMs?: number
  hiddenIntervalMs?: number
}

export function scheduleStartupRuntimeProbe(get: ChatStoreGet): void {
  if (startupRuntimeProbeTimer) {
    clearTimeout(startupRuntimeProbeTimer)
  }
  startupRuntimeProbeTimer = setTimeout(() => {
    startupRuntimeProbeTimer = null
    void get().probeRuntime('user')
  }, 900)
}

export function clearBusyWatchdog(): void {
  if (busyWatchdogTimer) {
    clearTimeout(busyWatchdogTimer)
    busyWatchdogTimer = null
  }
}

export function resetBusyRecoveryAttempts(): void {
  busyRecoveryAttempts = 0
}

export function armBusyWatchdog(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: BusyWatchdogOptions
): void {
  clearBusyWatchdog()
  busyWatchdogTimer = setTimeout(() => {
    const state = get()
    if (!state.busy) return
    busyRecoveryAttempts += 1
    if (busyRecoveryAttempts <= options.maxAttempts && state.activeThreadId) {
      void state.recoverActiveTurn()
      return
    }
    set((snapshot) => {
      const base: Partial<ChatState> = {
        ...options.finalizeBusyState(snapshot),
        busy: false,
        currentTurnId: null,
        error: options.busyTimeoutMessage()
      }
      return options.flushLiveBlocks(snapshot, base)
    })
  }, options.timeoutMs)
}

export function stopTurnCompletionPoll(): void {
  turnCompletionPollGeneration += 1
  if (turnCompletionPollTimer) {
    clearTimeout(turnCompletionPollTimer)
    turnCompletionPollTimer = null
  }
}

export function stopRuntimeThreadRefreshPoll(): void {
  if (runtimeThreadRefreshPollTimer) {
    clearTimeout(runtimeThreadRefreshPollTimer)
    runtimeThreadRefreshPollTimer = null
  }
  runtimeThreadRefreshFocusCleanup?.()
  runtimeThreadRefreshFocusCleanup = null
  runtimeThreadRefreshInFlight = false
  runtimeThreadRefreshIdleDelayMs = 0
}

export function stopRuntimeReconnectProbe(): void {
  if (runtimeReconnectProbeTimer) {
    clearTimeout(runtimeReconnectProbeTimer)
    runtimeReconnectProbeTimer = null
  }
  runtimeReconnectProbeAttempt = 0
}

export function scheduleRuntimeReconnectProbe(
  get: ChatStoreGet,
  options: { minDelayMs?: number; maxDelayMs?: number } = {}
): void {
  if (runtimeReconnectProbeTimer || get().runtimeConnection === 'ready') return
  const minDelayMs = options.minDelayMs ?? RUNTIME_RECONNECT_PROBE_MIN_MS
  const maxDelayMs = options.maxDelayMs ?? RUNTIME_RECONNECT_PROBE_MAX_MS
  const delay = Math.min(
    maxDelayMs,
    minDelayMs * Math.max(1, 2 ** runtimeReconnectProbeAttempt)
  )
  runtimeReconnectProbeTimer = setTimeout(() => {
    runtimeReconnectProbeTimer = null
    if (get().runtimeConnection === 'ready') {
      runtimeReconnectProbeAttempt = 0
      return
    }
    runtimeReconnectProbeAttempt += 1
    void get().probeRuntime('background').finally(() => {
      if (get().runtimeConnection === 'ready') {
        runtimeReconnectProbeAttempt = 0
        return
      }
      scheduleRuntimeReconnectProbe(get, options)
    })
  }, delay)
}

export function stopRuntimeBootRetry(): void {
  if (runtimeBootRetryTimer) {
    clearTimeout(runtimeBootRetryTimer)
    runtimeBootRetryTimer = null
  }
}

export function scheduleRuntimeBootRetry(
  get: ChatStoreGet,
  options: { delayMs?: number } = {}
): void {
  if (runtimeBootRetryTimer || get().runtimeConnection === 'ready') return
  runtimeBootRetryTimer = setTimeout(() => {
    runtimeBootRetryTimer = null
    if (get().runtimeConnection === 'ready') return
    void get().boot()
  }, options.delayMs ?? RUNTIME_BOOT_RETRY_MS)
}

function hasActiveRuntimeTurn(state: ChatState): boolean {
  return Boolean(
    state.busy ||
    state.currentTurnId ||
    Object.values(state.watchTurnCompletion).some(Boolean)
  )
}

function runtimeWindowIsFocused(): boolean {
  if (typeof document === 'undefined') return true
  return document.visibilityState !== 'hidden'
}

function nextRuntimeThreadRefreshDelay(
  state: ChatState,
  options: RuntimeThreadRefreshPollOptions
): number {
  if (hasActiveRuntimeTurn(state)) {
    runtimeThreadRefreshIdleDelayMs = 0
    return options.activeIntervalMs ?? options.intervalMs ?? ACTIVE_RUNTIME_THREAD_REFRESH_POLL_MS
  }

  const baseDelay = runtimeWindowIsFocused()
    ? options.focusedIdleIntervalMs ?? options.intervalMs ?? FOCUSED_IDLE_RUNTIME_THREAD_REFRESH_POLL_MS
    : options.hiddenIdleIntervalMs ?? options.intervalMs ?? HIDDEN_IDLE_RUNTIME_THREAD_REFRESH_POLL_MS
  const maxDelay = options.maxIdleIntervalMs ?? options.intervalMs ?? MAX_IDLE_RUNTIME_THREAD_REFRESH_POLL_MS
  runtimeThreadRefreshIdleDelayMs = runtimeThreadRefreshIdleDelayMs
    ? Math.min(runtimeThreadRefreshIdleDelayMs * 2, maxDelay)
    : baseDelay
  return runtimeThreadRefreshIdleDelayMs
}

function runRuntimeThreadRefresh(
  get: ChatStoreGet,
  options: RuntimeThreadRefreshPollOptions
): void {
  runtimeThreadRefreshPollTimer = null
  if (runtimeThreadRefreshInFlight) return
  const state = get()
  if (state.runtimeConnection !== 'ready') {
    stopRuntimeThreadRefreshPoll()
    return
  }
  runtimeThreadRefreshInFlight = true
  void Promise.resolve(state.refreshThreads())
    .catch(() => undefined)
    .finally(() => {
      runtimeThreadRefreshInFlight = false
      if (get().runtimeConnection === 'ready' && runtimeThreadRefreshPollTimer == null) {
        syncRuntimeThreadRefreshPoll(get, options)
      }
    })
}

function ensureRuntimeThreadRefreshFocusListener(
  get: ChatStoreGet,
  options: RuntimeThreadRefreshPollOptions
): void {
  if (runtimeThreadRefreshFocusCleanup) return
  const cleanups: Array<() => void> = []
  const onFocused = (): void => {
    if (!runtimeWindowIsFocused()) return
    runtimeThreadRefreshIdleDelayMs = 0
    syncRuntimeThreadRefreshPoll(get, options)
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', onFocused)
    cleanups.push(() => document.removeEventListener('visibilitychange', onFocused))
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('focus', onFocused)
    cleanups.push(() => window.removeEventListener('focus', onFocused))
  }
  runtimeThreadRefreshFocusCleanup = () => {
    for (const cleanup of cleanups) cleanup()
  }
}

export function requestRuntimeThreadRefresh(
  get: ChatStoreGet,
  options: RuntimeThreadRefreshPollOptions & { immediate?: boolean } = {}
): void {
  if (get().runtimeConnection !== 'ready') {
    stopRuntimeThreadRefreshPoll()
    return
  }
  if (runtimeThreadRefreshPollTimer) {
    clearTimeout(runtimeThreadRefreshPollTimer)
    runtimeThreadRefreshPollTimer = null
  }
  runtimeThreadRefreshIdleDelayMs = 0
  if (options.immediate === false) {
    syncRuntimeThreadRefreshPoll(get, options)
    return
  }
  runRuntimeThreadRefresh(get, options)
}

export function syncRuntimeThreadRefreshPoll(
  get: ChatStoreGet,
  options: RuntimeThreadRefreshPollOptions = {}
): void {
  if (get().runtimeConnection !== 'ready') {
    stopRuntimeThreadRefreshPoll()
    return
  }
  ensureRuntimeThreadRefreshFocusListener(get, options)
  if (runtimeThreadRefreshInFlight) return
  if (runtimeThreadRefreshPollTimer != null) {
    clearTimeout(runtimeThreadRefreshPollTimer)
    runtimeThreadRefreshPollTimer = null
  }

  runtimeThreadRefreshPollTimer = setTimeout(
    () => runRuntimeThreadRefresh(get, options),
    nextRuntimeThreadRefreshDelay(get(), options)
  )
}

export function syncTurnCompletionPoll(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: TurnCompletionPollOptions
): void {
  const ids = Object.keys(get().watchTurnCompletion).filter((id) => get().watchTurnCompletion[id])
  if (ids.length === 0) {
    stopTurnCompletionPoll()
    return
  }
  if (turnCompletionPollTimer != null || turnCompletionPollInFlight) return

  const generation = turnCompletionPollGeneration
  void runTurnCompletionPoll(set, get, options, generation)
}

async function runTurnCompletionPoll(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: TurnCompletionPollOptions,
  generation: number
): Promise<void> {
  if (turnCompletionPollInFlight || generation !== turnCompletionPollGeneration) return
  turnCompletionPollInFlight = true
  try {
    await pollTurnCompletionWatch(set, get, options)
  } finally {
    turnCompletionPollInFlight = false
  }

  if (generation !== turnCompletionPollGeneration) return
  const state = get()
  const hasWatchedThreads = Object.keys(state.watchTurnCompletion)
    .some((id) => state.watchTurnCompletion[id])
  if (state.runtimeConnection !== 'ready' || !hasWatchedThreads) {
    stopTurnCompletionPoll()
    return
  }

  const delay = runtimeWindowIsFocused()
    ? options.intervalMs ?? TURN_COMPLETION_POLL_MS
    : options.hiddenIntervalMs ?? HIDDEN_TURN_COMPLETION_POLL_MS
  turnCompletionPollTimer = setTimeout(() => {
    turnCompletionPollTimer = null
    void runTurnCompletionPoll(set, get, options, generation)
  }, delay)
}

async function pollTurnCompletionWatch(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: TurnCompletionPollOptions
): Promise<void> {
  const state = get()
  if (state.runtimeConnection !== 'ready') {
    stopTurnCompletionPoll()
    return
  }

  const ids = Object.keys(state.watchTurnCompletion).filter((id) => state.watchTurnCompletion[id])
  if (ids.length === 0) {
    stopTurnCompletionPoll()
    return
  }

  const doneIds: string[] = []
  for (const threadId of ids) {
    try {
      const { blocks, threadStatus } = await options.loadThreadState(state, threadId)
      if (!options.threadLooksRunning(blocks, threadStatus)) {
        doneIds.push(threadId)
      }
    } catch {
      /* ignore */
    }
  }

  if (doneIds.length > 0) {
    await options.onCompletedThreads(doneIds, state, set, get)
  }

  if (Object.keys(get().watchTurnCompletion).filter((id) => get().watchTurnCompletion[id]).length === 0) {
    stopTurnCompletionPoll()
  }
}
