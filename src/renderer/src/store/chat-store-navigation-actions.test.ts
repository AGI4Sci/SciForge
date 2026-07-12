import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeId, AppSettingsV1 } from '@shared/app-settings'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { rememberProviderThreadRuntime } from './chat-store-runtime-helpers'
import { stopRuntimeBootRetry, stopRuntimeReconnectProbe, stopRuntimeThreadRefreshPoll } from './chat-store-schedulers'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))
const runtimeClientMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))
vi.mock('../agent/runtime-client', () => ({
  rendererRuntimeClient: {
    getSettings: runtimeClientMock.getSettings,
    setSettings: runtimeClientMock.setSettings
  }
}))

import { createNavigationActions, syncRemoteChannelActivityToStore } from './chat-store-navigation-actions'

function thread(id: string, runtimeId?: AgentRuntimeId): NormalizedThread {
  return {
    id,
    runtimeId,
    title: id,
    updatedAt: '2026-06-11T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/sciforge',
    status: 'idle'
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function sideConversation(threadId: string, parentThreadId: string): ChatState['sideConversations'][string] {
  return {
    threadId,
    runtimeId: 'codex',
    parentThreadId,
    source: 'child_agent',
    title: 'research child',
    createdAt: '2026-06-11T00:00:00.000Z',
    inheritedAt: '2026-06-11T00:00:00.000Z',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    input: '',
    model: 'deepseek-v4-pro',
    reasoningEffort: 'max',
    busy: false,
    turnId: null,
    userItemId: null,
    error: null
  }
}

function buildHarness(options: {
  activeRuntime: AgentRuntimeId
  activeThread: NormalizedThread
  listedThreads: NormalizedThread[]
  blocks?: ChatState['blocks']
  detailBlocks?: ChatState['blocks']
  showArchivedThreads?: boolean
  threadSearch?: string
  sideConversations?: ChatState['sideConversations']
}): {
  refreshThreads: ReturnType<typeof createNavigationActions>['refreshThreads']
  state: ChatState
  provider: {
    listThreads: ReturnType<typeof vi.fn>
    getThreadDetail: ReturnType<typeof vi.fn>
  }
} {
  let state: ChatState
  const storedBlocks = options.detailBlocks ?? [{ kind: 'user' as const, id: 'stored-user', text: 'stored' }]
  const provider = {
    listThreads: vi.fn(async () => options.listedThreads),
    getThreadDetail: vi.fn(async () => ({ blocks: storedBlocks }))
  }
  registryMock.getProvider.mockReturnValue(provider)
  runtimeClientMock.getSettings.mockResolvedValue({ activeAgentRuntime: options.activeRuntime })

  state = {
    activeThreadId: options.activeThread.id,
    blocks: options.blocks ?? [],
    busy: false,
    remoteChannels: [],
    codeWorkspaceRoots: [],
    error: null,
    route: 'chat',
    runtimeConnection: 'ready',
    showArchivedThreads: options.showArchivedThreads ?? false,
    threadSearch: options.threadSearch ?? '',
    threads: [options.activeThread],
    sideConversations: options.sideConversations ?? {},
    unreadThreadIds: {},
    watchTurnCompletion: {}
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createNavigationActions({
    set,
    get,
    sseAbortRef: { current: null }
  })
  state.refreshThreads = actions.refreshThreads
  return { refreshThreads: actions.refreshThreads, state, provider }
}

describe('chat-store-navigation-actions refreshThreads', () => {
  let currentSddRegistryJson: string | null = null

  beforeEach(() => {
    stopRuntimeThreadRefreshPoll()
    stopRuntimeBootRetry()
    stopRuntimeReconnectProbe()
    vi.useRealTimers()
    registryMock.getProvider.mockReset()
    runtimeClientMock.getSettings.mockReset()
    runtimeClientMock.setSettings.mockReset()
    currentSddRegistryJson = null
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn((key: string) =>
          key === 'sciforge.sdd.threadRegistry.v1'
            ? currentSddRegistryJson
            : null
        ),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
  })

  afterEach(() => {
    stopRuntimeThreadRefreshPoll()
    stopRuntimeBootRetry()
    stopRuntimeReconnectProbe()
    vi.useRealTimers()
  })

  it('preserves the active thread when refreshing after a runtime switch', async () => {
    const codexThread = thread('codex-thread', 'codex')
    const sciforgeThread = thread('sciforge-thread', 'sciforge')
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'codex',
      activeThread: sciforgeThread,
      listedThreads: [codexThread]
    })

    await refreshThreads()

    expect(state.threads).toEqual([sciforgeThread, codexThread])
    expect(state.activeThreadId).toBe('sciforge-thread')
  })

  it('starts the runtime thread refresh poll after refreshing navigation threads', async () => {
    vi.useFakeTimers()
    const activeThread = thread('active-thread', 'codex')
    const listedThread = thread('listed-thread', 'codex')
    const { refreshThreads, provider } = buildHarness({
      activeRuntime: 'codex',
      activeThread,
      listedThreads: [listedThread]
    })

    await refreshThreads()

    expect(provider.listThreads).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30_000)

    expect(provider.listThreads).toHaveBeenCalledTimes(2)
  })

  it('uses a capped non-archived list during default navigation refresh', async () => {
    const activeThread = thread('active-thread', 'sciforge')
    const listedThread = thread('listed-thread', 'sciforge')
    const { refreshThreads, provider } = buildHarness({
      activeRuntime: 'sciforge',
      activeThread,
      listedThreads: [listedThread]
    })

    await refreshThreads()

    expect(provider.listThreads).toHaveBeenCalledWith({ limit: 80 })
  })

  it('requests archived threads only when the archived sidebar view is enabled', async () => {
    const activeThread = thread('active-thread', 'sciforge')
    const listedThread = thread('listed-thread', 'sciforge')
    const { refreshThreads, provider } = buildHarness({
      activeRuntime: 'sciforge',
      activeThread,
      listedThreads: [listedThread],
      showArchivedThreads: true
    })

    await refreshThreads()

    expect(provider.listThreads).toHaveBeenCalledWith({ limit: 200, includeArchived: true })
  })

  it('expands the list and passes server-side search when a thread search is active', async () => {
    const activeThread = thread('active-thread', 'sciforge')
    const listedThread = thread('listed-thread', 'sciforge')
    const { refreshThreads, provider } = buildHarness({
      activeRuntime: 'sciforge',
      activeThread,
      listedThreads: [listedThread],
      threadSearch: 'paper'
    })

    await refreshThreads()

    expect(provider.listThreads).toHaveBeenCalledWith({ limit: 200, search: 'paper' })
  })

  it('filters suspicious fallback threads before applying the sidebar list', async () => {
    const activeThread = { ...thread('active-thread', 'codex'), title: 'Active thread' }
    const fallbackThread = { ...thread('thr_279f3fef', 'codex'), title: 'thr_279f' }
    const { refreshThreads, state, provider } = buildHarness({
      activeRuntime: 'codex',
      activeThread,
      listedThreads: [fallbackThread]
    })
    provider.getThreadDetail.mockResolvedValueOnce({ blocks: [] })

    await refreshThreads()

    expect(provider.getThreadDetail).toHaveBeenCalledWith('thr_279f3fef')
    expect(state.threads.map((item) => item.id)).toEqual(['active-thread'])
  })

  it('derives real titles for fallback threads before applying the sidebar list', async () => {
    const activeThread = { ...thread('active-thread', 'codex'), title: 'Active thread' }
    const fallbackThread = { ...thread('thr_279f3fef', 'codex'), title: 'New Thread' }
    const { refreshThreads, state, provider } = buildHarness({
      activeRuntime: 'codex',
      activeThread,
      listedThreads: [fallbackThread]
    })
    provider.getThreadDetail.mockResolvedValueOnce({
      blocks: [{ kind: 'user', id: 'fallback-user', text: 'fix the sidebar placeholder titles' }]
    })

    await refreshThreads()

    expect(provider.getThreadDetail).toHaveBeenCalledWith('thr_279f3fef')
    expect(state.threads.map((item) => [item.id, item.title])).toEqual([
      ['active-thread', 'Active thread'],
      ['thr_279f3fef', 'fix the sidebar placeholder titles']
    ])
  })

  it('keeps child and attached side conversation threads out of the sidebar list', async () => {
    const activeThread = { ...thread('parent-thread', 'codex'), title: 'Parent research' }
    const attachedChildThread = { ...thread('child-thread', 'codex'), title: 'research child' }
    const sideThread = {
      ...thread('side-thread', 'codex'),
      title: 'side branch',
      relation: 'side' as const,
      parentThreadId: 'parent-thread'
    }
    const lineageChildThread = {
      ...thread('lineage-child-thread', 'codex'),
      title: 'lineage child',
      parentThreadId: 'parent-thread'
    }
    const forkThread = {
      ...thread('fork-thread', 'codex'),
      title: 'Forked session',
      relation: 'fork' as const,
      parentThreadId: 'parent-thread'
    }
    const { refreshThreads, state, provider } = buildHarness({
      activeRuntime: 'codex',
      activeThread,
      listedThreads: [activeThread, attachedChildThread, sideThread, lineageChildThread, forkThread],
      sideConversations: {
        'child-thread': sideConversation('child-thread', 'parent-thread')
      }
    })

    await refreshThreads()

    expect(provider.getThreadDetail).not.toHaveBeenCalled()
    expect(state.threads.map((item) => item.id)).toEqual(['parent-thread', 'fork-thread'])
    expect(state.activeThreadId).toBe('parent-thread')
  })

  it('clears an active PDF annotation side thread from the main conversation surface', async () => {
    const pdfSideThread = {
      ...thread('pdf-side-thread', 'codex'),
      title: 'PDF: selected text',
      relation: 'side' as const,
      sidebarVisibility: 'hidden' as const
    }
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'codex',
      activeThread: pdfSideThread,
      listedThreads: [pdfSideThread],
      blocks: [{ kind: 'assistant', id: 'assistant-1', text: 'temporary answer' }],
      sideConversations: {
        'pdf-side-thread': {
          ...sideConversation('pdf-side-thread', 'pdf-side-thread'),
          source: 'pdf_annotation'
        }
      }
    })

    await refreshThreads()

    expect(state.threads).toEqual([])
    expect(state.activeThreadId).toBeNull()
    expect(state.blocks).toEqual([])
  })

  it('ignores an older refresh result when a newer refresh has already applied', async () => {
    const activeThread = { ...thread('active-thread', 'codex'), title: 'Active thread' }
    const oldThread = { ...thread('old-thread', 'codex'), title: 'Old thread' }
    const newThread = { ...thread('new-thread', 'codex'), title: 'New thread' }
    const { refreshThreads, state, provider } = buildHarness({
      activeRuntime: 'codex',
      activeThread,
      listedThreads: []
    })
    let resolveOldRefresh: (threads: NormalizedThread[]) => void = () => {
      throw new Error('old refresh was not started')
    }
    let resolveNewRefresh: (threads: NormalizedThread[]) => void = () => {
      throw new Error('new refresh was not started')
    }
    provider.listThreads
      .mockImplementationOnce(() => new Promise<NormalizedThread[]>((resolve) => {
        resolveOldRefresh = resolve
      }))
      .mockImplementationOnce(() => new Promise<NormalizedThread[]>((resolve) => {
        resolveNewRefresh = resolve
      }))

    const oldRefresh = refreshThreads()
    await Promise.resolve()
    const newRefresh = refreshThreads()
    await Promise.resolve()

    resolveNewRefresh([newThread])
    await newRefresh
    expect(state.threads.map((item) => item.id)).toEqual(['active-thread', 'new-thread'])

    resolveOldRefresh([oldThread])
    await oldRefresh

    expect(state.threads.map((item) => item.id)).toEqual(['active-thread', 'new-thread'])
  })

  it('ignores an older refresh failure after a newer refresh has already applied', async () => {
    const activeThread = { ...thread('active-thread', 'codex'), title: 'Active thread' }
    const newThread = { ...thread('new-thread', 'codex'), title: 'New thread' }
    const { refreshThreads, state, provider } = buildHarness({
      activeRuntime: 'codex',
      activeThread,
      listedThreads: []
    })
    let rejectOldRefresh: (error: Error) => void = () => {
      throw new Error('old refresh was not started')
    }
    let resolveNewRefresh: (threads: NormalizedThread[]) => void = () => {
      throw new Error('new refresh was not started')
    }
    provider.listThreads
      .mockImplementationOnce(() => new Promise<NormalizedThread[]>((_resolve, reject) => {
        rejectOldRefresh = reject
      }))
      .mockImplementationOnce(() => new Promise<NormalizedThread[]>((resolve) => {
        resolveNewRefresh = resolve
      }))

    const oldRefresh = refreshThreads()
    await Promise.resolve()
    const newRefresh = refreshThreads()
    await Promise.resolve()

    resolveNewRefresh([newThread])
    await newRefresh
    rejectOldRefresh(new Error('stale list failure'))
    await oldRefresh

    expect(state.runtimeConnection).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.threads.map((item) => item.id)).toEqual(['active-thread', 'new-thread'])
  })

  it('preserves an unlisted active thread when it belongs to the active runtime', async () => {
    const pendingCodexThread = thread('pending-codex-thread', 'codex')
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'codex',
      activeThread: pendingCodexThread,
      listedThreads: []
    })

    await refreshThreads()

    expect(state.threads).toEqual([pendingCodexThread])
    expect(state.activeThreadId).toBe('pending-codex-thread')
  })

  it('preserves a legacy local runtime pending active thread without a runtime id when SciForge is active', async () => {
    const legacyLocalRuntimeThread = thread('legacy-local-runtime-thread')
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'sciforge',
      activeThread: legacyLocalRuntimeThread,
      listedThreads: []
    })

    await refreshThreads()

    expect(state.threads).toEqual([legacyLocalRuntimeThread])
    expect(state.activeThreadId).toBe('legacy-local-runtime-thread')
  })

  it('preserves a hidden SDD active thread when refreshing after a runtime switch', async () => {
    currentSddRegistryJson = JSON.stringify({
      version: 1,
      drafts: {
        draft: {
          draftId: 'draft',
          threadId: 'sdd-codex-thread',
          threadIds: ['sdd-codex-thread'],
          publicThreadIds: [],
          workspaceRoot: '/workspace/sciforge',
          updatedAt: '2026-06-11T00:00:00.000Z'
        }
      }
    })
    const sciforgeThread = thread('sciforge-thread', 'sciforge')
    const sddThread = thread('sdd-codex-thread', 'codex')
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'sciforge',
      activeThread: sddThread,
      listedThreads: [sciforgeThread]
    })

    await refreshThreads()

    expect(state.threads).toEqual([sddThread, sciforgeThread])
    expect(state.activeThreadId).toBe('sdd-codex-thread')
  })

  it('keeps the active thread selected when sidebar filtering sees an empty detail during send', async () => {
    const activeThread = {
      ...thread('12345678abcdef', 'codex'),
      title: '12345678'
    }
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'codex',
      activeThread,
      listedThreads: [activeThread],
      detailBlocks: [],
      blocks: [{ kind: 'user', id: 'optimistic-user', text: 'continue this thread' }]
    })

    await refreshThreads()

    expect(state.threads).toEqual([{ ...activeThread, title: 'continue this thread' }])
    expect(state.activeThreadId).toBe('12345678abcdef')
    expect(state.blocks).toEqual([{ kind: 'user', id: 'optimistic-user', text: 'continue this thread' }])
  })

  it('still clears an empty active fallback-title thread that sidebar filtering hides', async () => {
    const activeThread = {
      ...thread('87654321abcdef', 'codex'),
      title: '87654321'
    }
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'codex',
      activeThread,
      listedThreads: [activeThread],
      detailBlocks: [],
      blocks: []
    })

    await refreshThreads()

    expect(state.threads).toEqual([])
    expect(state.activeThreadId).toBeNull()
    expect(state.blocks).toEqual([])
  })
})

describe('chat-store-navigation-actions chooseWorkspace', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
    runtimeClientMock.getSettings.mockReset()
    runtimeClientMock.setSettings.mockReset()
  })

  function buildChooseWorkspaceHarness(): {
    chooseWorkspace: ReturnType<typeof createNavigationActions>['chooseWorkspace']
    state: ChatState
  } {
    registryMock.getProvider.mockReturnValue({})
    runtimeClientMock.setSettings.mockImplementation(async (patch: { workspaceRoot?: string }) => ({
      activeAgentRuntime: 'codex',
      workspaceRoot: patch.workspaceRoot ?? '/workspace/new',
      remoteChannel: { channels: [] }
    }))
    const state = {
      activeThreadId: 'old-thread',
      remoteGuardChannelId: null,
      blocks: [],
      busy: false,
      remoteChannels: [],
      codeWorkspaceRoots: ['/workspace/old'],
      hiddenCodeWorkspaceRoots: [],
      error: null,
      route: 'chat',
      runtimeConnection: 'ready',
      threads: [thread('old-thread', 'codex')],
      unreadThreadIds: {},
      watchTurnCompletion: {},
      workspaceRoot: '/workspace/old',
      createThread: vi.fn(async () => undefined),
      refreshThreads: vi.fn(async () => undefined),
      selectThread: vi.fn(async (threadId: string) => {
        state.activeThreadId = threadId
      })
    } as unknown as ChatState
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      sciforge: {
        pickWorkspaceDirectory: vi.fn(async () => ({ canceled: false, path: '/workspace/new' }))
      },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }
    const actions = createNavigationActions({
      set,
      get: () => state,
      sseAbortRef: { current: null }
    })
    return { chooseWorkspace: actions.chooseWorkspace, state }
  }

  it('does not create an empty thread when selecting an empty workspace', async () => {
    const { chooseWorkspace, state } = buildChooseWorkspaceHarness()

    await expect(chooseWorkspace()).resolves.toBe('/workspace/new')

    expect(runtimeClientMock.setSettings).toHaveBeenCalledWith({ workspaceRoot: '/workspace/new' })
    expect(state.refreshThreads).toHaveBeenCalledTimes(1)
    expect(state.createThread).not.toHaveBeenCalled()
    expect(state.selectThread).not.toHaveBeenCalled()
    expect(state.activeThreadId).toBeNull()
    expect(state.workspaceRoot).toBe('/workspace/new')
  })

  it('creates a draft only when workspace selection explicitly asks for it', async () => {
    const { chooseWorkspace, state } = buildChooseWorkspaceHarness()

    await expect(chooseWorkspace({ createThreadAfter: true })).resolves.toBe('/workspace/new')

    expect(state.createThread).toHaveBeenCalledWith({ workspaceRoot: '/workspace/new' })
    expect(state.activeThreadId).toBe('old-thread')
  })
})

describe('chat-store-runtime helper defaults', () => {
  it('does not remember legacy threads without a runtime id as SciForge threads', () => {
    const provider = {
      rememberThreadRuntime: vi.fn<(threadId: string, runtimeId?: AgentRuntimeId) => void>()
    }

    rememberProviderThreadRuntime(provider, 'legacy-thread', [thread('legacy-thread')])

    expect(provider.rememberThreadRuntime).not.toHaveBeenCalled()
  })
})

describe('chat-store-navigation-actions boot', () => {
  beforeEach(() => {
    stopRuntimeBootRetry()
    stopRuntimeReconnectProbe()
    runtimeClientMock.getSettings.mockReset()
    runtimeClientMock.setSettings.mockReset()
    const documentElement = {
      dataset: {} as Record<string, string>,
      setAttribute: vi.fn(),
      getAttribute: vi.fn(() => 'en'),
      style: { setProperty: vi.fn() }
    }
    vi.stubGlobal('document', {
      documentElement,
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    vi.stubGlobal('window', {
      sciforge: {},
      matchMedia: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })),
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  })

  afterEach(() => {
    stopRuntimeBootRetry()
    stopRuntimeReconnectProbe()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('probes the runtime immediately after loading settings', async () => {
    const settings = {
      version: 1,
      locale: 'en',
      theme: 'system',
      uiFontScale: 'small',
      activeAgentRuntime: 'codex',
      workspaceRoot: '/workspace/sciforge',
      modelRouter: { runtimeApiKey: 'runtime-key' },
      agents: {},
      remoteChannel: { channels: [] }
    } as unknown as AppSettingsV1
    runtimeClientMock.getSettings.mockResolvedValue(settings)
    let state: ChatState
    state = {
      runtimeConnection: 'idle',
      error: 'stale',
      runtimeErrorDetail: 'stale detail',
      composerPickList: [],
      codeWorkspaceRoots: [],
      hiddenCodeWorkspaceRoots: [],
      applyI18nFromSettings: vi.fn(async () => undefined),
      probeRuntime: vi.fn(async () => undefined)
    } as unknown as ChatState
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }
    const actions = createNavigationActions({
      set,
      get: () => state,
      sseAbortRef: { current: null }
    })

    await actions.boot()

    expect(runtimeClientMock.getSettings).toHaveBeenCalledWith({ forceRefresh: true })
    expect(state.probeRuntime).toHaveBeenCalledWith('user')
  })
})

describe('chat-store-navigation-actions probeRuntime', () => {
  beforeEach(() => {
    stopRuntimeBootRetry()
    stopRuntimeReconnectProbe()
    registryMock.getProvider.mockReset()
    runtimeClientMock.getSettings.mockReset()
    runtimeClientMock.setSettings.mockReset()
    vi.stubGlobal('window', {
      sciforge: {},
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
  })

  afterEach(() => {
    stopRuntimeBootRetry()
    stopRuntimeReconnectProbe()
    vi.useRealTimers()
  })

  it('times out a stalled runtime probe instead of leaving the UI checking forever', async () => {
    vi.useFakeTimers()
    const provider = {
      connect: vi.fn(() => new Promise<void>(() => undefined))
    }
    registryMock.getProvider.mockReturnValue(provider)
    runtimeClientMock.getSettings.mockResolvedValue({ activeAgentRuntime: 'codex' })
    const state = {
      runtimeConnection: 'idle',
      error: null,
      runtimeErrorDetail: null,
      activeThreadId: null,
      blocks: [],
      busy: false,
      currentTurnId: null,
      loadComposerModels: vi.fn(),
      refreshThreads: vi.fn()
    } as unknown as ChatState
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }
    const actions = createNavigationActions({
      set,
      get: () => state,
      sseAbortRef: { current: null }
    })
    state.probeRuntime = actions.probeRuntime

    const task = actions.probeRuntime('user')
    await vi.advanceTimersByTimeAsync(0)

    expect(state.runtimeConnection).toBe('checking')

    await vi.advanceTimersByTimeAsync(8_000)
    await task

    expect(state.runtimeConnection).toBe('offline')
    expect(state.error).toMatch(/timed out/)
  })

  it('refreshes sidebar threads after any successful runtime probe', async () => {
    const provider = {
      connect: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    const state = {
      runtimeConnection: 'ready',
      error: 'stale',
      runtimeErrorDetail: 'stale detail',
      activeThreadId: null,
      blocks: [],
      busy: false,
      currentTurnId: null,
      watchTurnCompletion: {},
      loadComposerModels: vi.fn(),
      refreshThreads: vi.fn(async () => undefined)
    } as unknown as ChatState
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }
    const actions = createNavigationActions({
      set,
      get: () => state,
      sseAbortRef: { current: null }
    })
    state.probeRuntime = actions.probeRuntime

    await actions.probeRuntime('background')

    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(state.refreshThreads).toHaveBeenCalledTimes(1)
    expect(state.error).toBeNull()
  })

  it('rehydrates the persisted active thread after the runtime bridge reconnects', async () => {
    const provider = {
      connect: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    const state = {
      runtimeConnection: 'offline',
      error: 'bridge disconnected',
      runtimeErrorDetail: 'bridge disconnected',
      activeThreadId: 'persisted-thread',
      blocks: [],
      busy: false,
      currentTurnId: null,
      watchTurnCompletion: {},
      loadComposerModels: vi.fn(),
      refreshThreads: vi.fn(async () => undefined),
      selectThread: vi.fn(async () => undefined),
      recoverActiveTurn: vi.fn(async () => false)
    } as unknown as ChatState
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }
    const actions = createNavigationActions({
      set,
      get: () => state,
      sseAbortRef: { current: null }
    })
    state.probeRuntime = actions.probeRuntime

    await actions.probeRuntime('background')

    expect(state.refreshThreads).toHaveBeenCalledTimes(1)
    expect(state.selectThread).toHaveBeenCalledWith('persisted-thread')
    expect(state.activeThreadId).toBe('persisted-thread')
    expect(state.runtimeConnection).toBe('ready')
  })

  it('fails open when a persisted active thread no longer exists', async () => {
    const provider = { connect: vi.fn(async () => undefined) }
    registryMock.getProvider.mockReturnValue(provider)
    const state = {
      runtimeConnection: 'offline',
      error: null,
      runtimeErrorDetail: null,
      activeThreadId: 'deleted-thread',
      blocks: [],
      busy: false,
      currentTurnId: null,
      threads: [],
      queuedMessages: [{ id: 'kept-q', threadId: 'deleted-thread', text: 'preserve me' }],
      watchTurnCompletion: {},
      loadComposerModels: vi.fn(),
      refreshThreads: vi.fn(async () => undefined),
      selectThread: vi.fn(async () => {
        state.error = 'thread not found'
      }),
      recoverActiveTurn: vi.fn(async () => false)
    } as unknown as ChatState
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }
    const actions = createNavigationActions({ set, get: () => state, sseAbortRef: { current: null } })
    state.probeRuntime = actions.probeRuntime

    await actions.probeRuntime('background')

    expect(state.activeThreadId).toBeNull()
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({ id: 'kept-q', text: 'preserve me' })
    ])
    expect(state.runtimeConnection).toBe('ready')
    expect(state.error).toMatch(/previous conversation|上次会话/i)
  })

  it('times out a late persisted-thread read without taking the runtime offline', async () => {
    vi.useFakeTimers()
    const provider = { connect: vi.fn(async () => undefined) }
    registryMock.getProvider.mockReturnValue(provider)
    const lateThread = deferred<void>()
    const state = {
      runtimeConnection: 'offline',
      error: null,
      runtimeErrorDetail: null,
      activeThreadId: 'slow-restored-thread',
      blocks: [],
      busy: false,
      currentTurnId: null,
      threads: [thread('slow-restored-thread', 'sciforge')],
      queuedMessages: [],
      watchTurnCompletion: {},
      loadComposerModels: vi.fn(),
      refreshThreads: vi.fn(async () => undefined),
      selectThread: vi.fn(() => lateThread.promise),
      recoverActiveTurn: vi.fn(async () => false)
    } as unknown as ChatState
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }
    const actions = createNavigationActions({ set, get: () => state, sseAbortRef: { current: null } })
    state.probeRuntime = actions.probeRuntime

    const task = actions.probeRuntime('background')
    await vi.advanceTimersByTimeAsync(8_000)
    await task

    expect(state.activeThreadId).toBeNull()
    expect(state.runtimeConnection).toBe('ready')
    expect(state.error).toMatch(/previous conversation|上次会话/i)

    lateThread.resolve()
    await Promise.resolve()
    expect(state.activeThreadId).toBeNull()
  })
})

describe('chat-store-navigation-actions deleteWorkspace', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
    runtimeClientMock.getSettings.mockReset()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
  })

  it('removes the workspace from the project list without deleting its threads', async () => {
    const provider = {
      deleteThread: vi.fn(async () => undefined),
      rememberThreadRuntime: vi.fn<(threadId: string, runtimeId?: AgentRuntimeId) => void>()
    }
    registryMock.getProvider.mockReturnValue(provider)

    const staleThread = thread('stale-thread', 'codex')
    const healthyThread = thread('healthy-thread', 'codex')
    const otherThread = {
      ...thread('other-thread', 'sciforge'),
      workspace: '/workspace/other'
    }
    const state = {
      activeThreadId: 'other-thread',
      blocks: [],
      busy: false,
      remoteChannels: [],
      codeWorkspaceRoots: ['/workspace/sciforge', '/workspace/other'],
      hiddenCodeWorkspaceRoots: [],
      error: 'previous error',
      refreshThreads: vi.fn(async () => undefined),
      route: 'chat',
      runtimeConnection: 'idle',
      threads: [staleThread, healthyThread, otherThread],
      unreadThreadIds: { 'stale-thread': true },
      watchTurnCompletion: { 'healthy-thread': true },
      workspaceRoot: '/workspace/other'
    } as unknown as ChatState
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }
    const actions = createNavigationActions({
      set,
      get: () => state,
      sseAbortRef: { current: null }
    })

    await actions.deleteWorkspace('/workspace/sciforge')

    expect(provider.deleteThread).not.toHaveBeenCalled()
    expect(state.threads.map((item) => item.id)).toEqual([
      'stale-thread',
      'healthy-thread',
      'other-thread'
    ])
    expect(state.codeWorkspaceRoots).toEqual(['/workspace/other'])
    expect(state.hiddenCodeWorkspaceRoots).toEqual(['/workspace/sciforge'])
    expect(state.unreadThreadIds).toEqual({})
    expect(state.watchTurnCompletion).toEqual({})
    expect(state.error).toBeNull()
    expect(state.refreshThreads).toHaveBeenCalledTimes(1)
  })
})

describe('remote-channel activity sync', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
    runtimeClientMock.getSettings.mockReset()
  })

  function buildActivityHarness(options?: Partial<ChatState>): {
    state: ChatState
    provider: { rememberThreadRuntime: ReturnType<typeof vi.fn> }
  } {
    const provider = {
      rememberThreadRuntime: vi.fn()
    }
    registryMock.getProvider.mockReturnValue(provider)
    runtimeClientMock.getSettings.mockResolvedValue({
      remoteChannel: {
        channels: [{
          id: 'channel-1',
          enabled: true,
          provider: 'weixin',
          label: 'WeChat',
          threadId: '',
          conversations: []
        }]
      }
    })
    const state = {
      activeRemoteChannelId: '',
      activeThreadId: 'desktop-thread',
      connectPhonePanelOpen: false,
      remoteChannels: [],
      recoverActiveTurn: vi.fn(async () => true),
      refreshThreads: vi.fn(async () => undefined),
      route: 'chat',
      selectRemoteChannelConversation: vi.fn(async () => undefined),
      selectThread: vi.fn(async (threadId: string) => {
        state.activeThreadId = threadId
      }),
      unreadThreadIds: {},
      watchTurnCompletion: {},
      ...options
    } as unknown as ChatState
    return { state, provider }
  }

  it('recovers the current desktop thread when phone activity targets it outside IM route', async () => {
    const { state, provider } = buildActivityHarness()
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }

    await syncRemoteChannelActivityToStore(set, () => state, {
      channelId: 'channel-1',
      threadId: 'desktop-thread',
      runtimeId: 'codex'
    })

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('desktop-thread', 'codex')
    expect(state.recoverActiveTurn).toHaveBeenCalledTimes(1)
    expect(state.refreshThreads).toHaveBeenCalledTimes(1)
    expect(state.selectRemoteChannelConversation).not.toHaveBeenCalled()
    expect(state.activeRemoteChannelId).toBe('channel-1')
  })

  it('marks a different phone-updated thread unread without switching the desktop selection', async () => {
    const { state } = buildActivityHarness()
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }

    await syncRemoteChannelActivityToStore(set, () => state, {
      channelId: 'channel-1',
      threadId: 'remote-thread',
      runtimeId: 'codex'
    })

    expect(state.activeThreadId).toBe('desktop-thread')
    expect(state.recoverActiveTurn).not.toHaveBeenCalled()
    expect(state.selectRemoteChannelConversation).not.toHaveBeenCalled()
    expect(state.refreshThreads).toHaveBeenCalledTimes(1)
    expect(state.unreadThreadIds['remote-thread']).toBe(true)
    expect(state.watchTurnCompletion['remote-thread']).toBe(true)
  })

  it('follows phone activity while the Connect phone panel is open', async () => {
    const { state } = buildActivityHarness({ connectPhonePanelOpen: true })
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }

    await syncRemoteChannelActivityToStore(set, () => state, {
      channelId: 'channel-1',
      threadId: 'remote-thread',
      runtimeId: 'codex'
    })

    expect(state.activeRemoteChannelId).toBe('channel-1')
    expect(state.selectRemoteChannelConversation).toHaveBeenCalledWith('channel-1', 'remote-thread')
    expect(state.refreshThreads).not.toHaveBeenCalled()
    expect(state.unreadThreadIds['remote-thread']).toBeUndefined()
  })

  it('follows a replacement thread when phone activity replaces the current desktop thread', async () => {
    const { state } = buildActivityHarness()
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }

    await syncRemoteChannelActivityToStore(set, () => state, {
      channelId: 'channel-1',
      threadId: 'replacement-thread',
      previousThreadId: 'desktop-thread',
      runtimeId: 'codex'
    })

    expect(state.selectThread).toHaveBeenCalledWith('replacement-thread')
    expect(state.activeThreadId).toBe('replacement-thread')
    expect(state.recoverActiveTurn).not.toHaveBeenCalled()
    expect(state.refreshThreads).not.toHaveBeenCalled()
    expect(state.unreadThreadIds['replacement-thread']).toBeUndefined()
  })
})
