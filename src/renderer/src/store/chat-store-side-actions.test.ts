import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSideActions,
  teardownAllSideSubscriptions
} from './chat-store-side-actions'
import { DEFAULT_LOCAL_RUNTIME_MODEL } from '@shared/app-settings'
import type { ChatState } from './chat-store-types'
import type { AgentProvider, NormalizedThread, ThreadEventSink } from '../agent/types'

type Harness = {
  state: ChatState
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void
  get: () => ChatState
  provider: FakeProvider
  actions: ReturnType<typeof createSideActions>
}

class FakeProvider implements AgentProvider {
  readonly id = 'sciforge' as const
  readonly displayName = 'Fake'
  capabilities: ReturnType<AgentProvider['getCapabilities']> = {
    interrupt: true,
    stream: true,
    approvals: true,
    attachFiles: false
  }
  threadDetail: Awaited<ReturnType<AgentProvider['getRecentThreadView']>> = {
    blocks: [],
    latestSeq: 0
  }
  createMock = vi.fn()
  connectMock = vi.fn()
  subscribeError: Error | null = null
  forkMock = vi.fn()
  getDetailMock = vi.fn()
  sendMock = vi.fn()
  steerMock = vi.fn()
  deleteMock = vi.fn()
  patchMock = vi.fn()
  updateRelationMock = vi.fn()
  interruptMock = vi.fn()
  subscribeMock = vi.fn()
  rememberMock = vi.fn()
  refreshThreadsMock = vi.fn()
  closeSideMock = vi.fn()
  getCapabilities() {
    return this.capabilities
  }
  rememberThreadRuntime(threadId: string, runtimeId?: NormalizedThread['runtimeId']) {
    this.rememberMock(threadId, runtimeId)
  }
  async connect() {
    this.connectMock()
  }
  async listThreads(): Promise<NormalizedThread[]> {
    return []
  }
  async createThread(input: Parameters<AgentProvider['createThread']>[0]): Promise<NormalizedThread> {
    this.createMock(input)
    return {
      id: 'created-side-thread',
      title: input.title ?? 'Standalone side',
      updatedAt: '2026-06-02T00:00:00.000Z',
      model: 'deepseek-chat',
      mode: input.mode ?? 'agent',
      workspace: input.workspace,
      workspaceLocator: input.workspaceLocator,
      status: 'idle'
    }
  }
  async getRecentThreadView(threadId: string) {
    this.getDetailMock(threadId)
    return this.threadDetail
  }
  async getThreadStatus() {
    return { latestSeq: this.threadDetail.latestSeq }
  }
  async getThreadPage() {
    return { blocks: this.threadDetail.blocks, latestSeq: this.threadDetail.latestSeq, nextCursor: null }
  }
  async readToolArtifact() {
    return ''
  }
  async sendUserMessage(
    threadId: string,
    text: string,
    options?: Parameters<AgentProvider['sendUserMessage']>[2]
  ) {
    this.sendMock(threadId, text, options)
    return { threadId, turnId: `turn_${threadId}_${Date.now()}` }
  }
  async steerUserMessage(
    threadId: string,
    turnId: string,
    text: string,
    options?: Parameters<NonNullable<AgentProvider['steerUserMessage']>>[3]
  ) {
    this.steerMock(threadId, turnId, text, options)
  }
  async interruptTurn(threadId: string, turnId: string) {
    this.interruptMock(threadId, turnId)
  }
  async renameThread() {}
  async archiveThread() {}
  async deleteThread(threadId: string) {
    this.deleteMock(threadId)
  }
  async updateThreadRelation(threadId: string, relation: 'primary' | 'fork' | 'side') {
    this.updateRelationMock(threadId, relation)
  }
  async compactThread() {}
  async forkThread(
    threadId: string,
    options?: { relation?: 'primary' | 'fork' | 'side'; title?: string }
  ) {
    this.forkMock(threadId, options)
    return {
      id: `side_${threadId}`,
      title: options?.title ?? `${threadId} · side`,
      updatedAt: '2026-06-02T00:00:00.000Z',
      model: 'deepseek-chat',
      mode: 'agent',
      workspace: '/tmp',
      status: 'idle',
      relation: 'side' as const,
      parentThreadId: threadId,
      forkedFromThreadId: threadId,
      forkedFromTitle: 'Parent',
      forkedAt: '2026-06-02T00:00:00.000Z'
    }
  }
  async resumeSession() {
    return { threadId: 'resumed', sessionId: 'sid' }
  }
  async subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void> {
    this.subscribeMock(threadId, sinceSeq, sink, signal)
    if (this.subscribeError) throw this.subscribeError
    signal.addEventListener('abort', () => {
      // simulate cleanup; the real implementation stops the SSE stream
    })
    return new Promise(() => {
      sink.onSeq(0)
    })
  }
  async submitApprovalDecision() {}
  async submitUserInputResponse() {}
  async cancelUserInput() {}
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function buildHarness(overrides: Partial<ChatState> = {}): Harness {
  const state: ChatState = {
    route: 'chat',
    settingsReturnRoute: 'chat',
    pluginHostRoute: 'chat',
    settingsSection: 'general',
    initialSetupOpen: false,
    initialSetupMode: 'required',
    workspaceRoot: '/tmp',
    workspaceLabel: '/tmp',
    runtimeConnection: 'ready',
    codeWorkspaceRoots: [],
    threads: [
      {
        id: 'thr_main',
        title: 'Parent',
        updatedAt: '2026-06-02T00:00:00.000Z',
        model: 'deepseek-chat',
        mode: 'agent',
        status: 'idle'
      }
    ],
    threadSearch: '',
    showArchivedThreads: false,
    activeThreadId: 'thr_main',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    usageRefreshKey: 0,
    busy: true,
    error: null,
    runtimeErrorDetail: null,
    currentTurnId: 'turn_main',
    currentTurnUserId: 'item_main',
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    inspectorSelectedId: null,
    composerModel: 'deepseek-chat',
    composerPickList: ['deepseek-chat'],
    queuedMessages: [],
    watchTurnCompletion: {},
    unreadThreadIds: {},
    sideConversations: {},
    sidePanel: { open: false, activeSideId: null },
    setError: () => undefined,
    setComposerModel: () => undefined,
    loadComposerModels: async () => undefined,
    setRoute: () => undefined,
    openCode: async () => undefined,
    openSettings: () => undefined,
    openPlugins: () => undefined,
    openSchedule: () => undefined,
    openInitialSetup: () => undefined,
    closeInitialSetup: () => undefined,
    boot: async () => undefined,
    probeRuntime: async () => undefined,
    chooseWorkspace: async () => null,
    clearWorkspace: async () => undefined,
    deleteWorkspace: async () => undefined,
    refreshThreads: async () => provider.refreshThreadsMock(),
    setThreadSearch: () => undefined,
    setShowArchivedThreads: () => undefined,
    createThread: async () => undefined,
    selectThread: async () => undefined,
    recoverActiveTurn: async () => false,
    sendMessage: async () => false,
    drainQueuedMessages: async () => undefined,
    removeQueuedMessage: () => undefined,
    rewindAndResend: async () => undefined,
    interrupt: async () => undefined,
    renameActiveThread: async () => undefined,
    renameThread: async () => undefined,
    archiveThread: async () => undefined,
    compactActiveThread: async () => undefined,
    forkActiveThread: async () => undefined,
    spawnSideConversation: async () => null,
    attachSideConversation: async () => null,
    openSideConversationDraft: () => undefined,
    sendSideMessage: async () => false,
    removeSideQueuedMessage: () => undefined,
    interruptSide: async () => undefined,
    setSideInput: () => undefined,
    setSideModel: () => undefined,
    setSideReasoningEffort: () => undefined,
    selectSideConversation: () => undefined,
    setSidePanelOpen: () => undefined,
    closeSideConversation: async () => undefined,
    discardSideConversation: async () => undefined,
    promoteSideConversation: async () => undefined,
    resumeSessionIntoThread: async () => null,
    deleteThread: async () => undefined,
    resolveApproval: async () => undefined,
    resolveUserInput: async () => undefined,
    selectInspectorItem: () => undefined,
    applyI18nFromSettings: async () => undefined,
    reloadUiSettings: async () => undefined,
    ...overrides
  } as ChatState
  const set: Harness['set'] = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: Harness['get'] = () => state
  const provider = new FakeProvider()
  const actions = createSideActions({
    set,
    get,
    getProvider: () => provider,
    t: (key) => key,
    formatRuntimeError: (e) => (e instanceof Error ? e.message : String(e ?? '')),
    shouldOpenSettingsForError: () => false
  })
  return { state, set, get, provider, actions }
}

describe('chat-store-side-actions', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      sciforge: {
        forbiddenDirectCall: vi.fn(async () => ({ ok: true, status: 200, body: '{}' })),
        logError: vi.fn(async () => undefined)
      }
    }
  })
  afterEach(() => {
    teardownAllSideSubscriptions()
    delete (globalThis as { window?: unknown }).window
  })

  it('spawnSideConversation does not change activeThreadId or main busy, even when main is running', async () => {
    const { actions, state, provider } = buildHarness()
    expect(state.activeThreadId).toBe('thr_main')
    expect(state.busy).toBe(true)

    const id = await actions.spawnSideConversation()

    expect(id).toBe('side_thr_main')
    expect(state.activeThreadId).toBe('thr_main')
    expect(state.busy).toBe(true)
    expect(state.sideConversations[id!]).toBeDefined()
    expect(state.sideConversations[id!].parentThreadId).toBe('thr_main')
    expect(state.sidePanel.open).toBe(true)
    expect(state.sidePanel.activeSideId).toBe(id)
    expect(provider.forkMock).toHaveBeenCalledWith('thr_main', { relation: 'side', title: 'Paren · side' })
    // A dedicated subscription was started for the side thread.
    expect(provider.subscribeMock).toHaveBeenCalledWith('side_thr_main', 0, expect.anything(), expect.anything())
  })

  it('spawns PDF annotation side conversations without opening the regular side panel', async () => {
    const { actions, state, provider } = buildHarness()

    const id = await actions.spawnSideConversation('Answer this selected PDF text.', {
      source: 'pdf_annotation',
      title: 'PDF: selected text',
      openPanel: false,
      displayText: 'What does this mean?'
    })

    expect(id).toBe('side_thr_main')
    expect(state.activeThreadId).toBe('thr_main')
    expect(state.sidePanel.open).toBe(false)
    expect(state.sidePanel.activeSideId).toBeNull()
    expect(state.sideConversations[id!]).toEqual(
      expect.objectContaining({
        source: 'pdf_annotation',
        title: 'PDF: selected text',
        parentThreadId: 'thr_main',
        busy: true
      })
    )
    expect(provider.forkMock).toHaveBeenCalledWith('thr_main', { relation: 'side', title: 'PDF: selected text' })
    expect(provider.sendMock).toHaveBeenCalledWith(
      'side_thr_main',
      'Answer this selected PDF text.',
      expect.objectContaining({
        clientDirectiveId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        model: 'deepseek-chat',
        reasoningEffort: 'max',
        displayText: 'What does this mean?',
        visibleContextOwnerThreadId: 'thr_main'
      })
    )
  })

  it('creates hidden PDF annotation side threads when fork is unavailable', async () => {
    const { actions, state, provider } = buildHarness()
    provider.capabilities = {
      ...provider.capabilities,
      fork: false,
      sideConversations: false
    }
    state.threads = [
      ...state.threads,
      {
        id: 'created-side-thread',
        title: 'PDF: selected text',
        updatedAt: '2026-06-02T00:00:00.000Z',
        model: 'deepseek-chat',
        mode: 'agent',
        status: 'running'
      }
    ]
    state.watchTurnCompletion = { 'created-side-thread': true }
    state.unreadThreadIds = { 'created-side-thread': true }

    const id = await actions.spawnSideConversation('Answer this selected PDF text.', {
      source: 'pdf_annotation',
      title: 'PDF: selected text',
      openPanel: false
    })

    expect(id).toBe('created-side-thread')
    expect(state.activeThreadId).toBe('thr_main')
    expect(state.sidePanel.open).toBe(false)
    expect(state.sideConversations[id!]).toEqual(
      expect.objectContaining({
        source: 'pdf_annotation',
        title: 'PDF: selected text',
        parentThreadId: 'thr_main',
        busy: true
      })
    )
    expect(state.threads.map((thread) => thread.id)).toEqual(['thr_main'])
    expect(state.watchTurnCompletion).toEqual({})
    expect(state.unreadThreadIds).toEqual({})
    expect(provider.forkMock).not.toHaveBeenCalled()
    expect(provider.createMock).toHaveBeenCalledWith({
      title: 'PDF: selected text',
      mode: 'agent',
      workspace: '/tmp',
      relation: 'side',
      threadSource: 'pdf_annotation',
      sidebarVisibility: 'hidden'
    })
    expect(provider.updateRelationMock).not.toHaveBeenCalled()
    expect(provider.sendMock).toHaveBeenCalledWith(
      'created-side-thread',
      'Answer this selected PDF text.',
      expect.objectContaining({
        clientDirectiveId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        model: 'deepseek-chat',
        reasoningEffort: 'max',
        visibleContextOwnerThreadId: 'thr_main'
      })
    )
  })

  it('keeps a remote parent locator on fallback side threads and turns', async () => {
    const { actions, state, provider } = buildHarness()
    const workspaceLocator = {
      contractVersion: 1 as const,
      hostSessionId: 'workspace-session-side',
      path: '/shared/remote-project'
    }
    provider.capabilities = {
      ...provider.capabilities,
      fork: false,
      sideConversations: false
    }
    state.threads = state.threads.map((item) => item.id === 'thr_main'
      ? {
          ...item,
          workspace: workspaceLocator.path,
          workspaceLocator
        }
      : item)

    const id = await actions.spawnSideConversation('inspect this branch')

    expect(provider.createMock).toHaveBeenCalledWith(expect.objectContaining({
      workspace: workspaceLocator.path,
      workspaceLocator
    }))
    expect(state.sideConversations[id!]).toEqual(expect.objectContaining({
      workspaceLocator
    }))
    expect(provider.sendMock).toHaveBeenCalledWith(
      id,
      'inspect this branch',
      expect.objectContaining({ workspaceLocator })
    )
  })

  it('openSideConversationDraft opens the side surface without forking a thread', () => {
    const { actions, state, provider } = buildHarness()

    actions.openSideConversationDraft()

    expect(state.sidePanel.open).toBe(true)
    expect(state.sidePanel.activeSideId).toBeNull()
    expect(state.sideConversations).toEqual({})
    expect(provider.forkMock).not.toHaveBeenCalled()
  })

  it('attaches an existing child thread without opening the side panel or changing the main thread', async () => {
    const { actions, state, provider } = buildHarness()
    expect(state.activeThreadId).toBe('thr_main')

    const id = await actions.attachSideConversation({
      threadId: 'child-thread',
      parentThreadId: 'thr_main',
      runtimeId: 'codex',
      title: 'research-child',
      source: 'child_agent'
    })

    expect(id).toBe('child-thread')
    expect(provider.forkMock).not.toHaveBeenCalled()
    expect(provider.getDetailMock).toHaveBeenCalledWith('child-thread')
    expect(provider.subscribeMock).toHaveBeenCalledWith('child-thread', 0, expect.anything(), expect.anything())
    expect(state.activeThreadId).toBe('thr_main')
    expect(state.sidePanel.open).toBe(false)
    expect(state.sidePanel.activeSideId).toBeNull()
    expect(state.sideConversations['child-thread']).toEqual(
      expect.objectContaining({
        threadId: 'child-thread',
        parentThreadId: 'thr_main',
        runtimeId: 'codex',
        title: 'research-child',
        source: 'child_agent'
      })
    )
  })

  it('persists the detail runtime owner when attaching without an explicit runtimeId', async () => {
    const { actions, state, provider } = buildHarness()
    provider.threadDetail = {
      blocks: [],
      latestSeq: 3,
      runtimeId: 'codex'
    }

    const id = await actions.attachSideConversation({
      threadId: 'child-thread',
      parentThreadId: 'thr_main',
      title: 'research-child'
    })

    expect(id).toBe('child-thread')
    expect(state.sideConversations['child-thread']).toEqual(
      expect.objectContaining({
        threadId: 'child-thread',
        parentThreadId: 'thr_main',
        runtimeId: 'codex',
        title: 'research-child'
      })
    )
    expect(provider.rememberMock).toHaveBeenCalledWith('child-thread', 'codex')
  })

  it('logs side subscription failures and settles attached side state', async () => {
    const { actions, state, provider } = buildHarness()
    provider.subscribeError = new Error('SSE failed')
    provider.threadDetail = {
      blocks: [],
      latestSeq: 7,
      threadStatus: 'running',
      latestTurnId: 'turn_child'
    }

    const id = await actions.attachSideConversation({
      threadId: 'child-thread',
      parentThreadId: 'thr_main',
      openPanel: true
    })
    await flushPromises()

    expect(id).toBe('child-thread')
    expect(state.sideConversations['child-thread']).toEqual(
      expect.objectContaining({
        busy: false,
        turnId: null,
        error: 'SSE failed'
      })
    )
    expect(window.sciforge.logError).toHaveBeenCalledWith(
      'side-conversation',
      'Side conversation subscription failed',
      {
        message: 'SSE failed',
        sideId: 'child-thread'
      }
    )
  })

  it('logs side subscription failures and settles spawned side state without touching the main thread', async () => {
    const { actions, state, provider } = buildHarness()
    provider.subscribeError = new Error('SSE failed after spawn')
    state.busy = true

    const id = await actions.spawnSideConversation()
    await flushPromises()

    expect(id).toBe('side_thr_main')
    expect(state.activeThreadId).toBe('thr_main')
    expect(state.busy).toBe(true)
    expect(state.sideConversations['side_thr_main']).toEqual(
      expect.objectContaining({
        busy: false,
        turnId: null,
        error: 'SSE failed after spawn'
      })
    )
    expect(window.sciforge.logError).toHaveBeenCalledWith(
      'side-conversation',
      'Side conversation subscription failed',
      {
        message: 'SSE failed after spawn',
        sideId: 'side_thr_main'
      }
    )
  })

  it('spawnSideConversation with seedText immediately sends the first turn', async () => {
    const { actions, state, provider } = buildHarness()
    const id = await actions.spawnSideConversation('what is the dependency tree?')
    expect(id).toBe('side_thr_main')
    expect(provider.sendMock).toHaveBeenCalledWith(
      'side_thr_main',
      'what is the dependency tree?',
      expect.objectContaining({ model: 'deepseek-chat', reasoningEffort: 'max' })
    )
    const side = state.sideConversations[id!]
    expect(side.busy).toBe(true)
    expect(side.turnId).toMatch(/^turn_side_thr_main_/)
    expect(side.input).toBe('')
  })

  it('sends the selected side reasoning effort with side turns', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!

    actions.setSideReasoningEffort(id, 'low')
    const sent = await actions.sendSideMessage(id, 'use less reasoning')

    expect(sent).toBe(true)
    expect(state.sideConversations[id].reasoningEffort).toBe('low')
    expect(provider.sendMock).toHaveBeenLastCalledWith(
      id,
      'use less reasoning',
      expect.objectContaining({
        clientDirectiveId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        model: 'deepseek-chat',
        reasoningEffort: 'off'
      })
    )
  })

  it('uses the local runtime default model when side creation has no parent or composer model to inherit', async () => {
    const { actions, state } = buildHarness({
      threads: [],
      activeThreadId: 'thr_missing',
      composerModel: '',
      composerPickList: []
    })

    const id = await actions.spawnSideConversation()

    expect(id).toBe('side_thr_missing')
    expect(state.sideConversations[id!].model).toBe(DEFAULT_LOCAL_RUNTIME_MODEL)
  })

  it('a side turn updates only its own blocks/busy and tears down its subscription on close', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!

    // The main thread is still untouched.
    expect(state.blocks).toEqual([])
    expect(state.busy).toBe(true)

    // Send a side message; only the side slice's busy flips.
    const sent = await actions.sendSideMessage(id, 'hi from side')
    expect(sent).toBe(true)
    expect(state.sideConversations[id].busy).toBe(true)
    expect(state.busy).toBe(true)

    // Close tears the subscription (abort() called on the controller).
    const lastCall = provider.subscribeMock.mock.calls.at(-1) as
      | [string, number, ThreadEventSink, AbortSignal]
      | undefined
    const signal = lastCall?.[3]
    expect(signal?.aborted).toBe(false)
    await actions.closeSideConversation(id)
    expect(state.sideConversations[id]).toBeUndefined()
    expect(signal?.aborted).toBe(true)
    expect(state.busy).toBe(true)
  })

  it('reconnects and queues the message when send discovers an already-running turn', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    provider.subscribeMock.mockClear()
    provider.sendMock.mockImplementationOnce(() => {
      throw new Error(JSON.stringify({ code: 'turn_in_progress', message: 'active turn' }))
    })

    const sent = await actions.sendSideMessage(id, 'hi from side')
    const attemptedDirectiveId = provider.sendMock.mock.calls[0]?.[2]?.clientDirectiveId

    expect(sent).toBe(true)
    expect(attemptedDirectiveId).toMatch(/^[0-9a-f-]{36}$/)
    expect(state.sideConversations[id]).toEqual(expect.objectContaining({
      busy: true,
      error: null,
      queuedMessages: [expect.objectContaining({
        id: attemptedDirectiveId,
        text: 'hi from side'
      })]
    }))
    expect(provider.subscribeMock).toHaveBeenCalledWith(id, 0, expect.anything(), expect.any(AbortSignal))
  })

  it('steers a running child-agent turn and strips an explicit /steer command', async () => {
    const { actions, state, provider } = buildHarness()
    provider.capabilities = { ...provider.capabilities, steer: true }
    provider.threadDetail = {
      blocks: [],
      latestSeq: 4,
      threadStatus: 'running',
      latestTurnId: 'turn-child'
    }
    const id = (await actions.attachSideConversation({
      threadId: 'child-thread',
      parentThreadId: 'thr_main',
      source: 'child_agent'
    }))!

    const sent = await actions.sendSideMessage(id, '/steer inspect the visual evidence')

    expect(sent).toBe(true)
    expect(provider.steerMock).toHaveBeenCalledWith(
      'child-thread',
      'turn-child',
      'inspect the visual evidence',
      { clientDirectiveId: expect.stringMatching(/^[0-9a-f-]{36}$/) }
    )
    expect(provider.sendMock).not.toHaveBeenCalled()
    expect(state.sideConversations[id].queuedMessages).toEqual([])
  })

  it('reuses the steer identity when turn_not_running falls back to a new side turn', async () => {
    const { actions, state, provider } = buildHarness()
    provider.capabilities = { ...provider.capabilities, steer: true }
    provider.threadDetail = {
      blocks: [],
      latestSeq: 4,
      threadStatus: 'running',
      latestTurnId: 'turn-child'
    }
    provider.steerMock.mockImplementationOnce(() => {
      throw new Error(JSON.stringify({ code: 'turn_not_running', message: 'turn ended' }))
    })
    const id = (await actions.attachSideConversation({
      threadId: 'child-thread',
      parentThreadId: 'thr_main',
      source: 'child_agent'
    }))!

    await expect(actions.sendSideMessage(id, '/steer continue safely')).resolves.toBe(true)

    const steerDirectiveId = provider.steerMock.mock.calls[0]?.[3]?.clientDirectiveId
    expect(steerDirectiveId).toMatch(/^[0-9a-f-]{36}$/)
    expect(provider.sendMock).toHaveBeenCalledWith(
      id,
      'continue safely',
      expect.objectContaining({ clientDirectiveId: steerDirectiveId })
    )
    expect(state.sideConversations[id]).toEqual(expect.objectContaining({
      busy: true,
      queuedMessages: []
    }))
  })

  it('queues complete multimodal payloads when a running child turn cannot be steered', async () => {
    const { actions, state, provider } = buildHarness()
    provider.capabilities = { ...provider.capabilities, steer: true }
    provider.threadDetail = {
      blocks: [],
      latestSeq: 4,
      threadStatus: 'running',
      latestTurnId: 'turn-child'
    }
    const id = (await actions.attachSideConversation({
      threadId: 'child-thread',
      parentThreadId: 'thr_main',
      source: 'child_agent'
    }))!
    const fileReference = {
      path: '/workspace/sciforge/figure.png',
      relativePath: 'figure.png',
      name: 'figure.png',
      kind: 'image' as const,
      mimeType: 'image/png',
      workspaceRoot: '/workspace/sciforge',
      delivery: 'model_router_object',
      modelRouterObject: true
    }

    const sent = await actions.sendSideMessage(id, 'use this image', {
      attachmentIds: ['attachment-1'],
      fileReferences: [fileReference]
    })

    expect(sent).toBe(true)
    expect(provider.steerMock).not.toHaveBeenCalled()
    expect(state.sideConversations[id].queuedMessages).toEqual([
      expect.objectContaining({
        text: 'use this image',
        attachmentIds: ['attachment-1'],
        fileReferences: [{
          path: 'figure.png',
          relativePath: 'figure.png',
          name: 'figure.png',
          kind: 'image',
          mimeType: 'image/png'
        }]
      })
    ])
  })

  it('sends side file references as workspace-relative locator metadata only', async () => {
    const { actions, provider } = buildHarness()
    provider.threadDetail = { blocks: [], latestSeq: 0, threadStatus: 'idle' }
    const id = (await actions.attachSideConversation({
      threadId: 'child-thread',
      parentThreadId: 'thr_main',
      source: 'child_agent'
    }))!
    const rendererReference = {
      path: '/workspace/sciforge/reports/report.pdf',
      relativePath: 'reports/report.pdf',
      name: 'report.pdf',
      kind: 'pdf' as const,
      mimeType: 'application/pdf',
      workspaceRoot: '/workspace/sciforge',
      modelRouterObject: true
    }

    await expect(actions.sendSideMessage(id, 'inspect the report', {
      fileReferences: [rendererReference]
    })).resolves.toBe(true)

    expect(provider.sendMock).toHaveBeenCalledWith(
      id,
      'inspect the report',
      expect.objectContaining({
        fileReferences: [{
          path: 'reports/report.pdf',
          relativePath: 'reports/report.pdf',
          name: 'report.pdf',
          kind: 'pdf',
          mimeType: 'application/pdf'
        }]
      })
    )
  })

  it('sends an attachment-only child message with a runtime prompt', async () => {
    const { actions, provider } = buildHarness()
    provider.threadDetail = { blocks: [], latestSeq: 0, threadStatus: 'idle' }
    const id = (await actions.attachSideConversation({
      threadId: 'child-thread',
      parentThreadId: 'thr_main',
      source: 'child_agent'
    }))!

    const sent = await actions.sendSideMessage(id, '', { attachmentIds: ['attachment-1'] })

    expect(sent).toBe(true)
    expect(provider.sendMock).toHaveBeenCalledWith(
      id,
      'common:composerImageOnlyPrompt',
      expect.objectContaining({ attachmentIds: ['attachment-1'] })
    )
  })

  it('automatically sends the next queued child message after turn completion', async () => {
    const { actions, state, provider } = buildHarness()
    provider.capabilities = { ...provider.capabilities, steer: false }
    provider.threadDetail = {
      blocks: [],
      latestSeq: 4,
      threadStatus: 'running',
      latestTurnId: 'turn-child'
    }
    const id = (await actions.attachSideConversation({
      threadId: 'child-thread',
      parentThreadId: 'thr_main',
      source: 'child_agent'
    }))!
    await actions.sendSideMessage(id, 'follow up after completion')
    expect(state.sideConversations[id].queuedMessages).toHaveLength(1)
    const queuedId = state.sideConversations[id].queuedMessages?.[0]?.id
    const subscription = provider.subscribeMock.mock.calls.at(-1) as
      | [string, number, ThreadEventSink, AbortSignal]
      | undefined

    subscription?.[2].onTurnComplete()
    await flushPromises()

    expect(provider.sendMock).toHaveBeenCalledWith(
      id,
      'follow up after completion',
      expect.objectContaining({
        clientDirectiveId: queuedId,
        model: 'deepseek-chat',
        reasoningEffort: 'max'
      })
    )
    expect(state.sideConversations[id].queuedMessages).toEqual([])
    expect(state.sideConversations[id].busy).toBe(true)
    expect(state.sideConversations[id].turnId).toMatch(/^turn_child-thread_/)
  })

  it('removes a queued side message without changing the active turn', async () => {
    const { actions, state, provider } = buildHarness()
    provider.capabilities = { ...provider.capabilities, steer: false }
    provider.threadDetail = {
      blocks: [],
      latestSeq: 4,
      threadStatus: 'running',
      latestTurnId: 'turn-child'
    }
    const id = (await actions.attachSideConversation({
      threadId: 'child-thread',
      parentThreadId: 'thr_main',
      source: 'child_agent'
    }))!
    await actions.sendSideMessage(id, 'remove this follow-up')
    const queuedId = state.sideConversations[id].queuedMessages?.[0]?.id

    actions.removeSideQueuedMessage(id, queuedId!)

    expect(state.sideConversations[id].queuedMessages).toEqual([])
    expect(state.sideConversations[id].busy).toBe(true)
    expect(state.sideConversations[id].turnId).toBe('turn-child')
  })

  it('settles side interrupt when the runtime reports the turn is already stopped', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    await actions.sendSideMessage(id, 'hi from side')
    provider.interruptMock.mockImplementationOnce(() => {
      throw new Error(JSON.stringify({ code: 'turn_not_running', message: 'not running' }))
    })

    await actions.interruptSide(id)

    expect(state.sideConversations[id]).toEqual(expect.objectContaining({
      busy: false,
      turnId: null,
      error: null
    }))
  })

  it('promoteSideConversation clears the relation through the provider and refreshes the thread list', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!

    await actions.promoteSideConversation(id)

    expect(provider.updateRelationMock).toHaveBeenCalledWith(id, 'primary')
    expect(provider.refreshThreadsMock).toHaveBeenCalled()
    expect(state.sideConversations[id]).toBeUndefined()
  })

  it('promoteSideConversation closes the side even when refreshing threads fails', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    provider.refreshThreadsMock.mockRejectedValueOnce(new Error('refresh failed'))

    await actions.promoteSideConversation(id)

    expect(provider.updateRelationMock).toHaveBeenCalledWith(id, 'primary')
    expect(state.sideConversations[id]).toBeUndefined()
    expect(state.error).toBe('refresh failed')
  })

  it('discardSideConversation deletes the underlying thread and tears down the subscription', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    const lastCall = provider.subscribeMock.mock.calls.at(-1) as
      | [string, number, ThreadEventSink, AbortSignal]
      | undefined
    const signal = lastCall?.[3]

    await actions.discardSideConversation(id)
    expect(provider.deleteMock).toHaveBeenCalledWith(id)
    expect(state.sideConversations[id]).toBeUndefined()
    expect(signal?.aborted).toBe(true)
  })

  it('side state survives a main-thread switch: closing/discarding the side does not change activeThreadId', async () => {
    const { actions, state, provider } = buildHarness()
    const id = (await actions.spawnSideConversation())!
    // Simulate the user picking a different main thread mid-side.
    state.activeThreadId = 'thr_other'
    state.busy = false
    await actions.closeSideConversation(id)
    expect(state.activeThreadId).toBe('thr_other')
    expect(state.busy).toBe(false)
  })

  it('rekeys a Session-owned side conversation without losing its running state', async () => {
    const { actions, state, provider } = buildHarness()
    provider.threadDetail = {
      blocks: [{ kind: 'assistant', id: 'answer', text: 'working' }],
      latestSeq: 7,
      threadStatus: 'running',
      latestTurnId: 'turn-old'
    }
    await actions.attachSideConversation({
      threadId: 'session-old',
      parentThreadId: 'session-old',
      source: 'sdd_assistant'
    })
    actions.setSideInput('session-old', 'keep this draft')
    const previousSubscription = provider.subscribeMock.mock.calls.at(-1) as
      | [string, number, ThreadEventSink, AbortSignal]
      | undefined

    actions.rekeySessionSideConversations('session-old', 'session-new')

    expect(previousSubscription?.[3].aborted).toBe(true)
    expect(state.sideConversations['session-old']).toBeUndefined()
    expect(state.sideConversations['session-new']).toMatchObject({
      threadId: 'session-new',
      parentThreadId: 'session-new',
      blocks: [{ kind: 'assistant', id: 'answer', text: 'working' }],
      input: 'keep this draft',
      busy: true,
      turnId: 'turn-old',
      lastSeq: 7
    })
    expect(provider.subscribeMock).toHaveBeenLastCalledWith(
      'session-new',
      7,
      expect.anything(),
      expect.any(AbortSignal)
    )
  })

  it('preserves an existing canonical target side conversation on rekey collision', async () => {
    const { actions, state, provider } = buildHarness()
    await actions.attachSideConversation({
      threadId: 'session-old',
      parentThreadId: 'session-old',
      source: 'sdd_assistant'
    })
    await actions.attachSideConversation({
      threadId: 'session-target',
      parentThreadId: 'session-target',
      source: 'sdd_assistant'
    })
    actions.setSideInput('session-old', 'source')
    actions.setSideInput('session-target', 'canonical target')
    const target = state.sideConversations['session-target']
    const subscriptionCount = provider.subscribeMock.mock.calls.length

    actions.rekeySessionSideConversations('session-old', 'session-target')

    expect(state.sideConversations['session-old']).toBeUndefined()
    expect(state.sideConversations['session-target']).toBe(target)
    expect(state.sideConversations['session-target'].input).toBe('canonical target')
    expect(provider.subscribeMock).toHaveBeenCalledTimes(subscriptionCount)
  })
})
