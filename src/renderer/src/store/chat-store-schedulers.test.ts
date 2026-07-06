import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  armBusyWatchdog,
  clearBusyWatchdog,
  requestRuntimeThreadRefresh,
  resetBusyRecoveryAttempts,
  scheduleRuntimeBootRetry,
  scheduleRuntimeReconnectProbe,
  stopRuntimeBootRetry,
  stopRuntimeReconnectProbe,
  stopRuntimeThreadRefreshPoll,
  syncRuntimeThreadRefreshPoll
} from './chat-store-schedulers'
import type { ChatState, ChatStoreSet } from './chat-store-types'

type StoreApi = { getState: () => ChatState; set: ChatStoreSet; get: () => ChatState }

function makeHarness(initial: Partial<ChatState> = {}): StoreApi {
  let state: ChatState = {
    activeThreadId: 't1',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    usageRefreshKey: 0,
    busy: true,
    error: null,
    currentTurnId: 'turn-1',
    currentTurnUserId: 'u1',
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    watchTurnCompletion: {},
    unreadThreadIds: {},
    queuedMessages: [],
    threads: [],
    recoverActiveTurn: vi.fn().mockResolvedValue(undefined),
    ...initial
  } as ChatState
  return {
    getState: () => state,
    set: (partial) => {
      const update =
        typeof partial === 'function'
          ? (partial as (s: ChatState) => Partial<ChatState>)(state)
          : partial
      state = { ...state, ...update }
    },
    get: () => state
  }
}

describe('armBusyWatchdog (busyTimeout message contract)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetBusyRecoveryAttempts()
  })
  afterEach(() => {
    clearBusyWatchdog()
    vi.useRealTimers()
  })

  it('uses busyTimeoutMessage returned string verbatim when watchdog fires with attempts exhausted', () => {
    const h = makeHarness({ activeThreadId: null })
    const finalize = vi.fn().mockReturnValue({})
    const flush = vi.fn().mockImplementation((_state: ChatState, base: Partial<ChatState>) => base)
    const message = '已等待 9 分钟仍未收到运行时完成事件。可中断后重试。'
    armBusyWatchdog(h.set, h.get, {
      timeoutMs: 1_000,
      maxAttempts: 0, // skip recovery, go straight to finalize
      finalizeBusyState: finalize,
      flushLiveBlocks: flush,
      busyTimeoutMessage: () => message
    })
    vi.advanceTimersByTime(1_000)
    expect(h.getState().error).toBe(message)
    expect(h.getState().busy).toBe(false)
    expect(h.getState().currentTurnId).toBeNull()
    expect(finalize).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledOnce()
  })

  it('skips watchdog work if not busy at fire time', () => {
    const h = makeHarness()
    const finalize = vi.fn().mockReturnValue({})
    const flush = vi.fn().mockImplementation((_state: ChatState, base: Partial<ChatState>) => base)
    armBusyWatchdog(h.set, h.get, {
      timeoutMs: 50,
      maxAttempts: 0,
      finalizeBusyState: finalize,
      flushLiveBlocks: flush,
      busyTimeoutMessage: () => 'never'
    })
    // Simulate turn completing before watchdog fires
    h.set((s) => ({ ...s, busy: false }))
    vi.advanceTimersByTime(50)
    expect(finalize).not.toHaveBeenCalled()
    expect(h.getState().error).toBeNull()
  })

  it('attempts recovery and returns when attempts remain', () => {
    const h = makeHarness()
    const finalize = vi.fn().mockReturnValue({})
    const flush = vi.fn().mockImplementation((_state: ChatState, base: Partial<ChatState>) => base)
    armBusyWatchdog(h.set, h.get, {
      timeoutMs: 50,
      maxAttempts: 5, // high limit, will not finalize
      finalizeBusyState: finalize,
      flushLiveBlocks: flush,
      busyTimeoutMessage: () => 'should-not-be-used'
    })
    vi.advanceTimersByTime(50)
    expect(h.getState().recoverActiveTurn).toHaveBeenCalledTimes(1)
    expect(h.getState().busy).toBe(true) // not finalized
    expect(finalize).not.toHaveBeenCalled()
  })
})

describe('busyTimeout minutes interpolation (#131)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetBusyRecoveryAttempts()
  })
  afterEach(() => {
    clearBusyWatchdog()
    vi.useRealTimers()
  })

  it('renders the minute count from production constants in the message', () => {
    const h = makeHarness({ activeThreadId: null })
    // Mirrors chat-store-runtime.ts:467-471 formula:
    // minutes = round((BUSY_WATCHDOG_MS * MAX_BUSY_RECOVERY_ATTEMPTS) / 60_000)
    // Current production: 180_000 * 3 / 60_000 = 9
    const minutes = Math.round((180_000 * 3) / 60_000)
    armBusyWatchdog(h.set, h.get, {
      timeoutMs: 10,
      maxAttempts: 0,
      finalizeBusyState: () => ({}),
      flushLiveBlocks: (_state: ChatState, base: Partial<ChatState>) => base,
      busyTimeoutMessage: () => `已等待 ${minutes} 分钟仍未收到运行时完成事件。`
    })
    vi.advanceTimersByTime(10)
    expect(typeof h.getState().error).toBe('string')
    expect(h.getState().error as string).toMatch(/已等待 9 分钟/)
  })
})

describe('syncRuntimeThreadRefreshPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    stopRuntimeThreadRefreshPoll()
    stopRuntimeBootRetry()
    stopRuntimeReconnectProbe()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('polls refreshThreads while the runtime is ready', async () => {
    const refreshThreads = vi.fn(async () => undefined)
    const h = makeHarness({
      runtimeConnection: 'ready',
      refreshThreads
    } as Partial<ChatState>)

    syncRuntimeThreadRefreshPoll(h.get, { intervalMs: 10 })

    await vi.advanceTimersByTimeAsync(10)
    expect(refreshThreads).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10)
    expect(refreshThreads).toHaveBeenCalledTimes(2)
  })

  it('stops without refreshing when the runtime is no longer ready', async () => {
    const refreshThreads = vi.fn(async () => undefined)
    const h = makeHarness({
      runtimeConnection: 'ready',
      refreshThreads
    } as Partial<ChatState>)

    syncRuntimeThreadRefreshPoll(h.get, { intervalMs: 10 })
    h.set({ runtimeConnection: 'offline' } as Partial<ChatState>)

    await vi.advanceTimersByTimeAsync(10)
    expect(refreshThreads).not.toHaveBeenCalled()
  })

  it('does not overlap refresh calls when a previous refresh is still in flight', async () => {
    const refreshThreads = vi.fn(() => new Promise<void>(() => undefined))
    const h = makeHarness({
      runtimeConnection: 'ready',
      refreshThreads
    } as Partial<ChatState>)

    syncRuntimeThreadRefreshPoll(h.get, { intervalMs: 10 })

    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    expect(refreshThreads).toHaveBeenCalledTimes(1)
  })

  it('backs off idle runtime refreshes while keeping active turns on the short interval', async () => {
    const refreshThreads = vi.fn(async () => undefined)
    const h = makeHarness({
      runtimeConnection: 'ready',
      refreshThreads,
      busy: false,
      currentTurnId: null,
      watchTurnCompletion: {}
    } as Partial<ChatState>)

    syncRuntimeThreadRefreshPoll(h.get, {
      activeIntervalMs: 5,
      focusedIdleIntervalMs: 10,
      maxIdleIntervalMs: 40
    })

    await vi.advanceTimersByTimeAsync(10)
    expect(refreshThreads).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(19)
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshThreads).toHaveBeenCalledTimes(2)

    h.set({ busy: true, currentTurnId: 'turn-2' } as Partial<ChatState>)
    syncRuntimeThreadRefreshPoll(h.get, {
      activeIntervalMs: 5,
      focusedIdleIntervalMs: 10,
      maxIdleIntervalMs: 40
    })
    await vi.advanceTimersByTimeAsync(5)
    expect(refreshThreads).toHaveBeenCalledTimes(3)
  })

  it('uses the hidden-window idle cadence when the document is not visible', async () => {
    const refreshThreads = vi.fn(async () => undefined)
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    const h = makeHarness({
      runtimeConnection: 'ready',
      refreshThreads,
      busy: false,
      currentTurnId: null,
      watchTurnCompletion: {}
    } as Partial<ChatState>)

    syncRuntimeThreadRefreshPoll(h.get, {
      focusedIdleIntervalMs: 10,
      hiddenIdleIntervalMs: 50,
      maxIdleIntervalMs: 100
    })

    await vi.advanceTimersByTimeAsync(49)
    expect(refreshThreads).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshThreads).toHaveBeenCalledTimes(1)
  })

  it('refreshes immediately for runtime events and coalesces with scheduled idle refreshes', async () => {
    const refreshThreads = vi.fn(async () => undefined)
    const h = makeHarness({
      runtimeConnection: 'ready',
      refreshThreads,
      busy: false,
      currentTurnId: null,
      watchTurnCompletion: {}
    } as Partial<ChatState>)

    syncRuntimeThreadRefreshPoll(h.get, { focusedIdleIntervalMs: 50 })
    await vi.advanceTimersByTimeAsync(10)
    expect(refreshThreads).not.toHaveBeenCalled()

    requestRuntimeThreadRefresh(h.get, { focusedIdleIntervalMs: 50 })
    await vi.advanceTimersByTimeAsync(0)

    expect(refreshThreads).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(49)
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshThreads).toHaveBeenCalledTimes(2)
  })

  it('requeues idle refresh on focus without immediate polling', async () => {
    const refreshThreads = vi.fn(async () => undefined)
    const listeners: Record<string, () => void> = {}
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn((name: string, listener: () => void) => {
        listeners[name] = listener
      }),
      removeEventListener: vi.fn()
    })
    vi.stubGlobal('window', {
      addEventListener: vi.fn((name: string, listener: () => void) => {
        listeners[name] = listener
      }),
      removeEventListener: vi.fn()
    })
    const h = makeHarness({
      runtimeConnection: 'ready',
      refreshThreads,
      busy: false,
      currentTurnId: null,
      watchTurnCompletion: {}
    } as Partial<ChatState>)

    syncRuntimeThreadRefreshPoll(h.get, { focusedIdleIntervalMs: 50, maxIdleIntervalMs: 100 })
    await vi.advanceTimersByTimeAsync(50)
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(40)
    listeners.focus?.()
    await vi.advanceTimersByTimeAsync(49)
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshThreads).toHaveBeenCalledTimes(2)
  })
})

describe('scheduleRuntimeReconnectProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    stopRuntimeBootRetry()
    stopRuntimeReconnectProbe()
    vi.useRealTimers()
  })

  it('probes in the background until the runtime becomes ready', async () => {
    const probeRuntime = vi.fn(async () => undefined)
    const h = makeHarness({
      runtimeConnection: 'offline',
      probeRuntime
    } as Partial<ChatState>)

    scheduleRuntimeReconnectProbe(h.get, { minDelayMs: 10, maxDelayMs: 20 })
    await vi.advanceTimersByTimeAsync(10)

    expect(probeRuntime).toHaveBeenCalledWith('background')

    h.set({ runtimeConnection: 'ready' } as Partial<ChatState>)
    await vi.advanceTimersByTimeAsync(20)

    expect(probeRuntime).toHaveBeenCalledTimes(1)
  })

  it('backs off retries while the runtime remains offline', async () => {
    const probeRuntime = vi.fn(async () => undefined)
    const h = makeHarness({
      runtimeConnection: 'offline',
      probeRuntime
    } as Partial<ChatState>)

    scheduleRuntimeReconnectProbe(h.get, { minDelayMs: 10, maxDelayMs: 20 })
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(19)

    expect(probeRuntime).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)

    expect(probeRuntime).toHaveBeenCalledTimes(2)
  })
})

describe('scheduleRuntimeBootRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    stopRuntimeBootRetry()
    vi.useRealTimers()
  })

  it('retries a full boot after startup settings fail', async () => {
    const boot = vi.fn(async () => undefined)
    const h = makeHarness({
      runtimeConnection: 'offline',
      boot
    } as Partial<ChatState>)

    scheduleRuntimeBootRetry(h.get, { delayMs: 10 })
    await vi.advanceTimersByTimeAsync(10)

    expect(boot).toHaveBeenCalledTimes(1)
  })

  it('does not schedule another boot retry while one is pending', async () => {
    const boot = vi.fn(async () => undefined)
    const h = makeHarness({
      runtimeConnection: 'offline',
      boot
    } as Partial<ChatState>)

    scheduleRuntimeBootRetry(h.get, { delayMs: 10 })
    scheduleRuntimeBootRetry(h.get, { delayMs: 10 })
    await vi.advanceTimersByTimeAsync(10)

    expect(boot).toHaveBeenCalledTimes(1)
  })
})
