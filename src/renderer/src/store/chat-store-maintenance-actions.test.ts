import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentProviderCapabilities,
  ChatBlock,
  NormalizedThread,
  ThreadGoal,
  ThreadGoalStatus
} from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, SendMessageOverrides } from './chat-store-types'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))
const lifecycleMock = vi.hoisted(() => ({
  disposeSessionRightPanelWorkspace: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))
vi.mock('../lib/session-right-panel-lifecycle', () => lifecycleMock)

import { createMaintenanceActions } from './chat-store-maintenance-actions'

type GoalPatch = {
  objective?: string
  status?: ThreadGoalStatus
  tokenBudget?: number | null
}

type Harness = {
  actions: ReturnType<typeof createMaintenanceActions>
  createThread: ReturnType<typeof vi.fn>
  drainQueuedMessages: ReturnType<typeof vi.fn>
  get: ChatStoreGet
  provider: {
    archiveThread: ReturnType<typeof vi.fn>
    compactThread: ReturnType<typeof vi.fn>
    forkThread: ReturnType<typeof vi.fn>
    getContextState: ReturnType<typeof vi.fn>
    getCapabilities: ReturnType<typeof vi.fn>
    rememberThreadRuntime: ReturnType<typeof vi.fn>
    resumeSession: ReturnType<typeof vi.fn>
    submitUserInputResponse: ReturnType<typeof vi.fn>
    cancelUserInput: ReturnType<typeof vi.fn>
    setThreadGoal: ReturnType<typeof vi.fn>
    clearThreadGoal: ReturnType<typeof vi.fn>
    interruptTurn: ReturnType<typeof vi.fn>
    deleteThread: ReturnType<typeof vi.fn>
  }
  refreshActiveThreadContextState: ReturnType<typeof vi.fn>
  refreshThreads: ReturnType<typeof vi.fn>
  selectThread: ReturnType<typeof vi.fn>
  sendMessage: ReturnType<typeof vi.fn>
  sseAbortRef: { current: AbortController | null }
  state: ChatState
}

function thread(
  id: string,
  goal: ThreadGoal | null = null,
  runtimeId: NormalizedThread['runtimeId'] = 'sciforge'
): NormalizedThread {
  return {
    id,
    runtimeId,
    title: id,
    updatedAt: '2026-06-04T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/sciforge',
    status: 'idle',
    goal
  }
}

function goal(
  threadId: string,
  objective = 'ship goal mode',
  status: ThreadGoalStatus = 'active'
): ThreadGoal {
  return {
    threadId,
    objective,
    status,
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:01:00.000Z'
  }
}

function buildHarness(options: {
  activeThreadId?: string | null
  capabilities?: Partial<AgentProviderCapabilities>
  createThreadSucceeds?: boolean
  initialGoal?: ThreadGoal | null
} = {}): Harness {
  const activeThreadId = options.activeThreadId === undefined ? 'thr_existing' : options.activeThreadId
  const createThreadSucceeds = options.createThreadSucceeds ?? true
  const initialGoal = options.initialGoal ?? null
  const capabilities = {
    interrupt: true,
    stream: true,
    approvals: true,
    attachFiles: false,
    review: true,
    compact: true,
    fork: true,
    goals: true,
    skills: true,
    sideConversations: true,
    ...options.capabilities
  }
  let state: ChatState

  const provider = {
    archiveThread: vi.fn(async () => undefined),
    compactThread: vi.fn(async () => undefined),
    forkThread: vi.fn(async () => thread('thr_fork')),
    getContextState: vi.fn(async (threadId: string) => ({
      runtimeId: 'codex' as const,
      threadId,
      rawHistoryItems: 42,
      effectiveHistoryItems: 12,
      summarySource: 'runtime' as const,
      updatedAt: '2026-06-20T00:00:00.000Z'
    })),
    getCapabilities: vi.fn(() => capabilities),
    rememberThreadRuntime: vi.fn(),
    resumeSession: vi.fn(async (sessionId: string) => ({
      sessionId,
      threadId: 'thr_resumed',
      runtimeId: 'codex' as const
    })),
    submitUserInputResponse: vi.fn(async () => undefined),
    cancelUserInput: vi.fn(async () => undefined),
    setThreadGoal: vi.fn(async (threadId: string, patch: GoalPatch) =>
      goal(
        threadId,
        patch.objective ?? state.activeThreadGoal?.objective ?? initialGoal?.objective ?? 'ship goal mode',
        patch.status ?? state.activeThreadGoal?.status ?? initialGoal?.status ?? 'active'
      )
    ),
    clearThreadGoal: vi.fn(async () => true),
    interruptTurn: vi.fn(async () => undefined),
    deleteThread: vi.fn(async () => undefined)
  }
  registryMock.getProvider.mockReturnValue(provider)

  const createThread = vi.fn(async () => {
    if (!createThreadSucceeds) return
    const created = thread('thr_created')
    state.activeThreadId = created.id
    state.threads = [created, ...state.threads]
  })
  const refreshThreads = vi.fn(async () => undefined)
  const selectThread = vi.fn(async (threadId: string) => {
    state.activeThreadId = threadId
  })
  const refreshActiveThreadContextState = vi.fn(async (threadId?: string) => {
    const targetThreadId = threadId?.trim() || state.activeThreadId
    if (!targetThreadId) {
      state.activeThreadContextState = null
      return
    }
    const contextState = await provider.getContextState(targetThreadId)
    if (state.activeThreadId === targetThreadId) {
      state.activeThreadContextState = contextState
    }
  })
  const drainQueuedMessages = vi.fn(async () => undefined)
  const sendMessage = vi.fn(async (
    _text: string,
    _mode?: string,
    _overrides?: SendMessageOverrides
  ) => true)

  state = {
    activeThreadGoal: initialGoal,
    activeThreadContextState: null,
    activeThreadId,
    createThread,
    error: null,
    drainQueuedMessages,
    refreshActiveThreadContextState,
    refreshThreads,
    runtimeConnection: 'ready',
    selectThread,
    sendMessage,
    settingsSection: 'general',
    threads: activeThreadId ? [thread(activeThreadId, initialGoal)] : []
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const sseAbortRef: { current: AbortController | null } = { current: null }
  const actions = createMaintenanceActions({
    set,
    get,
    sseAbortRef
  })

  return {
    actions,
    createThread,
    drainQueuedMessages,
    get,
    provider,
    refreshActiveThreadContextState,
    refreshThreads,
    selectThread,
    sendMessage,
    sseAbortRef,
    state
  }
}

describe('chat-store-maintenance-actions goal actions', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
    lifecycleMock.disposeSessionRightPanelWorkspace.mockReset()
  })

  it('disposes a session workspace only when archiving, not when restoring', async () => {
    const { actions, provider, state } = buildHarness()

    await actions.archiveThread('thr_existing', true)

    expect(provider.archiveThread).toHaveBeenCalledWith('thr_existing', true)
    expect(lifecycleMock.disposeSessionRightPanelWorkspace).toHaveBeenCalledWith('thr_existing')

    lifecycleMock.disposeSessionRightPanelWorkspace.mockClear()
    state.activeThreadId = null
    await actions.archiveThread('thr_existing', false)

    expect(provider.archiveThread).toHaveBeenCalledWith('thr_existing', false)
    expect(lifecycleMock.disposeSessionRightPanelWorkspace).not.toHaveBeenCalled()
  })

  it('disposes a session workspace after its thread is deleted successfully', async () => {
    const { actions, provider } = buildHarness()

    await actions.deleteThread('thr_existing')

    expect(provider.deleteThread).toHaveBeenCalledWith('thr_existing')
    expect(lifecycleMock.disposeSessionRightPanelWorkspace).toHaveBeenCalledWith('thr_existing')
  })

  it('sets a goal on the active thread, syncs snapshots, and starts the goal turn', async () => {
    const { actions, provider, refreshThreads, sendMessage, state } = buildHarness()

    const result = await actions.setActiveThreadGoal('  ship goal mode  ')

    expect(result).toBe(true)
    expect(provider.setThreadGoal).toHaveBeenCalledWith('thr_existing', {
      objective: 'ship goal mode',
      status: 'active'
    })
    expect(state.activeThreadGoal).toMatchObject({
      threadId: 'thr_existing',
      objective: 'ship goal mode',
      status: 'active'
    })
    expect(state.threads[0]?.goal).toMatchObject({
      threadId: 'thr_existing',
      objective: 'ship goal mode',
      status: 'active'
    })
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      'ship goal mode',
      'agent',
      expect.objectContaining({
        displayText: expect.stringContaining('ship goal mode')
      })
    )
  })

  it('creates a thread before setting the first goal when no thread is active', async () => {
    const { actions, createThread, provider, sendMessage, state } = buildHarness({
      activeThreadId: null
    })

    const result = await actions.setActiveThreadGoal('ship goal mode')

    expect(result).toBe(true)
    expect(createThread).toHaveBeenCalledTimes(1)
    expect(provider.setThreadGoal).toHaveBeenCalledWith('thr_created', {
      objective: 'ship goal mode',
      status: 'active'
    })
    expect(createThread.mock.invocationCallOrder[0]).toBeLessThan(
      provider.setThreadGoal.mock.invocationCallOrder[0]
    )
    expect(state.activeThreadId).toBe('thr_created')
    expect(state.activeThreadGoal?.threadId).toBe('thr_created')
    expect(state.threads[0]?.goal?.objective).toBe('ship goal mode')
    expect(sendMessage).toHaveBeenCalledWith(
      'ship goal mode',
      'agent',
      expect.objectContaining({
        displayText: expect.stringContaining('ship goal mode')
      })
    )
  })

  it('does not call goal APIs when a new thread cannot be created', async () => {
    const { actions, createThread, provider, sendMessage, state } = buildHarness({
      activeThreadId: null,
      createThreadSucceeds: false
    })

    const result = await actions.setActiveThreadGoal('ship goal mode')

    expect(result).toBe(false)
    expect(createThread).toHaveBeenCalledTimes(1)
    expect(provider.setThreadGoal).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(state.activeThreadGoal).toBeNull()
  })

  it('does not call goal APIs when the active runtime does not support goals', async () => {
    const { actions, provider, sendMessage, state } = buildHarness({
      capabilities: { goals: false }
    })

    const result = await actions.setActiveThreadGoal('ship goal mode')

    expect(result).toBe(false)
    expect(provider.setThreadGoal).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(state.error).toBeTruthy()
  })

  it('does not execute compact or fork actions that are unavailable for the active runtime', async () => {
    const { actions, provider, state } = buildHarness({
      capabilities: { compact: false, fork: false }
    })

    await actions.compactActiveThread('manual compaction')
    const compactError = state.error
    await actions.forkActiveThread()

    expect(provider.compactThread).not.toHaveBeenCalled()
    expect(provider.forkThread).not.toHaveBeenCalled()
    expect(compactError).toBeTruthy()
    expect(state.error).toBeTruthy()
  })

  it('compacts the active thread and reselects it after refreshing thread snapshots', async () => {
    const { actions, provider, refreshThreads, selectThread, state } = buildHarness()

    await actions.compactActiveThread('manual compaction')

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('thr_existing', 'sciforge')
    expect(provider.compactThread).toHaveBeenCalledWith('thr_existing', 'manual compaction')
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(selectThread).toHaveBeenCalledWith('thr_existing')
    expect(provider.compactThread.mock.invocationCallOrder[0]).toBeLessThan(
      refreshThreads.mock.invocationCallOrder[0]
    )
    expect(refreshThreads.mock.invocationCallOrder[0]).toBeLessThan(
      selectThread.mock.invocationCallOrder[0]
    )
    expect(state.error).toBeNull()
  })

  it('refreshes provider context state when goal session resume fails', async () => {
    const { actions, provider, refreshActiveThreadContextState, refreshThreads, selectThread, state } = buildHarness()
    const contextState = {
      runtimeId: 'codex' as const,
      threadId: 'thr_existing',
      rawHistoryItems: 28,
      effectiveHistoryItems: 9,
      summarySource: 'runtime' as const,
      updatedAt: '2026-06-20T00:00:00.000Z',
      goalResume: {
        objective: 'ship goal mode',
        status: 'blocked' as const,
        resumeCount: 3,
        lastFailureReason: 'resume budget was exhausted',
        updatedAt: '2026-06-20T00:00:01.000Z'
      }
    }
    provider.resumeSession.mockRejectedValueOnce(new Error('resume budget was exhausted'))
    provider.getContextState.mockResolvedValueOnce(contextState)

    const result = await actions.resumeSessionIntoThread(' session-123 ', {
      model: 'gpt-5',
      mode: 'agent',
      maxResumeCount: 3
    })

    expect(result).toBeNull()
    expect(provider.resumeSession).toHaveBeenCalledWith('session-123', {
      model: 'gpt-5',
      mode: 'agent',
      maxResumeCount: 3
    })
    expect(refreshActiveThreadContextState).toHaveBeenCalledWith('thr_existing')
    expect(provider.getContextState).toHaveBeenCalledWith('thr_existing')
    expect(state.activeThreadContextState).toEqual(contextState)
    expect(state.activeThreadContextState?.goalResume?.lastFailureReason).toBe('resume budget was exhausted')
    expect(state.error).toContain('resume budget was exhausted')
    expect(refreshThreads).not.toHaveBeenCalled()
    expect(selectThread).not.toHaveBeenCalled()
  })

  it('updates active goal status and keeps the thread snapshot in sync', async () => {
    const initialGoal = goal('thr_existing', 'finish testing', 'active')
    const { actions, provider, refreshThreads, state } = buildHarness({ initialGoal })

    const result = await actions.setActiveThreadGoalStatus('paused')

    expect(result).toBe(true)
    expect(provider.setThreadGoal).toHaveBeenCalledWith('thr_existing', { status: 'paused' })
    expect(state.activeThreadGoal).toMatchObject({
      threadId: 'thr_existing',
      objective: 'finish testing',
      status: 'paused'
    })
    expect(state.threads[0]?.goal).toMatchObject({
      threadId: 'thr_existing',
      objective: 'finish testing',
      status: 'paused'
    })
    expect(refreshThreads).toHaveBeenCalledTimes(1)
  })

  it('clears the active goal and removes it from the thread snapshot', async () => {
    const initialGoal = goal('thr_existing', 'finish testing', 'active')
    const { actions, provider, refreshThreads, state } = buildHarness({ initialGoal })

    const result = await actions.clearActiveThreadGoal()

    expect(result).toBe(true)
    expect(provider.clearThreadGoal).toHaveBeenCalledWith('thr_existing')
    expect(state.activeThreadGoal).toBeNull()
    expect(state.threads[0]?.goal).toBeNull()
    expect(refreshThreads).toHaveBeenCalledTimes(1)
  })

  it('submits pending user input through the provider and marks the block submitted', async () => {
    const { actions, provider, state } = buildHarness()
    const answers = [{ id: 'choice', label: 'Use neutral path', value: 'Use neutral path' }]
    Object.assign(state, {
      blocks: [{
        kind: 'user_input',
        id: 'input-block',
        requestId: 'request-1',
        questions: [{
          id: 'choice',
          header: 'Choice',
          question: 'How should this resolve?',
          options: [{ label: 'Use neutral path', description: 'Submit directly to runtime.' }]
        }],
        status: 'pending'
      }],
      busy: false,
      error: null
    })

    await actions.resolveUserInput('input-block', { kind: 'submit', answers })

    expect(provider.submitUserInputResponse).toHaveBeenCalledWith('request-1', answers)
    expect(provider.interruptTurn).not.toHaveBeenCalled()
    expect(state.blocks[0]).toMatchObject({
      kind: 'user_input',
      status: 'submitted',
      answers
    })
    expect(state.error).toBeNull()
  })

  it('fails unsupported user input submit without queueing or interrupting', async () => {
    const { actions, drainQueuedMessages, provider, refreshThreads, state } = buildHarness()
    vi.stubGlobal('window', {
      sciforge: {
        logError: vi.fn(async () => undefined)
      }
    })
    provider.submitUserInputResponse.mockRejectedValueOnce(new Error(JSON.stringify({
      code: 'runtime_request_user_input_unsupported',
      message: 'Runtime cannot submit request_user_input responses.'
    })))
    const queuedMessages = [{ id: 'q-existing', text: 'keep me queued' }]
    const answers = [{ id: 'choice', label: 'Use neutral path', value: 'Use neutral path' }]
    Object.assign(state, {
      blocks: [{
        kind: 'user_input',
        id: 'input-block',
        requestId: 'request-1',
        questions: [{
          id: 'choice',
          header: 'Choice',
          question: 'How should this resolve?',
          options: [{ label: 'Use neutral path', description: 'Submit directly to runtime.' }]
        }],
        status: 'pending'
      }],
      busy: true,
      currentTurnId: 'turn-1',
      currentTurnUserId: 'user-1',
      queuedMessages,
      error: null
    })

    await actions.resolveUserInput('input-block', { kind: 'submit', answers })

    expect(provider.submitUserInputResponse).toHaveBeenCalledWith('request-1', answers)
    expect(provider.interruptTurn).not.toHaveBeenCalled()
    expect(drainQueuedMessages).not.toHaveBeenCalled()
    expect(refreshThreads).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual(queuedMessages)
    expect(state.currentTurnId).toBe('turn-1')
    expect(state.busy).toBe(true)
    expect(state.error).toBeTruthy()
    expect(state.blocks[0]).toMatchObject({
      kind: 'user_input',
      status: 'error',
      errorMessage: state.error
    })
  })

  it('settles local runtime work after interrupt succeeds', async () => {
    const { actions, drainQueuedMessages, provider, refreshThreads, state } = buildHarness()
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', text: 'run command' },
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'Running command',
        status: 'running',
        toolKind: 'command_execution'
      },
      {
        kind: 'approval',
        id: 'approval-1',
        approvalId: 'approval-1',
        summary: 'Approve command',
        status: 'pending'
      },
      {
        kind: 'user_input',
        id: 'input-1',
        requestId: 'input-1',
        questions: [],
        status: 'pending'
      }
    ]
    Object.assign(state, {
      blocks,
      busy: true,
      currentTurnId: 'turn-1',
      currentTurnUserId: 'user-1',
      liveAssistant: 'partial answer',
      liveReasoning: '',
      queuedMessages: [{ id: 'q-1', text: 'queued follow up' }],
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })

    await actions.interrupt()

    expect(provider.interruptTurn).toHaveBeenCalledWith('thr_existing', 'turn-1', undefined)
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.liveAssistant).toBe('')
    expect(state.blocks.map((block) => ('status' in block ? block.status : block.kind))).toEqual([
      'user',
      'error',
      'error',
      'cancelled',
      'assistant'
    ])
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(drainQueuedMessages).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual([{ id: 'q-1', text: 'queued follow up' }])
  })

  it('clears local running UI immediately when interrupt is clicked before the runtime settles', async () => {
    const { actions, provider, sseAbortRef, state } = buildHarness()
    const controller = new AbortController()
    sseAbortRef.current = controller
    provider.interruptTurn.mockImplementationOnce(() => new Promise(() => undefined))
    Object.assign(state, {
      blocks: [
        { kind: 'user', id: 'user-1', text: 'run command' },
        {
          kind: 'tool',
          id: 'tool-1',
          summary: 'Running command',
          status: 'running',
          toolKind: 'command_execution'
        }
      ],
      busy: true,
      currentTurnId: 'turn-1',
      currentTurnUserId: 'user-1',
      liveAssistant: '',
      liveReasoning: '',
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })

    void actions.interrupt()

    expect(provider.interruptTurn).toHaveBeenCalledWith('thr_existing', 'turn-1', undefined)
    expect(controller.signal.aborted).toBe(true)
    expect(sseAbortRef.current).toBeNull()
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.blocks.map((block) => ('status' in block ? block.status : block.kind))).toEqual([
      'user',
      'error'
    ])
  })

  it('clears stale busy state when interrupt is clicked without a current turn id', async () => {
    const { actions, drainQueuedMessages, provider, refreshThreads, state } = buildHarness()
    Object.assign(state, {
      blocks: [{ kind: 'user', id: 'user-1', text: 'hello' }],
      busy: true,
      currentTurnId: null,
      currentTurnUserId: 'user-1',
      liveAssistant: '',
      liveReasoning: '',
      queuedMessages: [{ id: 'q-1', text: 'follow up' }],
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })

    await actions.interrupt()

    expect(provider.interruptTurn).not.toHaveBeenCalled()
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(drainQueuedMessages).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual([{ id: 'q-1', text: 'follow up' }])
  })

  it('clears stale busy state when the runtime reports no active turn during interrupt', async () => {
    const { actions, drainQueuedMessages, provider, refreshThreads, state } = buildHarness()
    vi.stubGlobal('window', {
      sciforge: {
        logError: vi.fn(async () => undefined)
      }
    })
    provider.interruptTurn.mockRejectedValueOnce(new Error(JSON.stringify({
      code: 'turn_not_running',
      message: 'No active turn is running for thread thr_existing.'
    })))
    Object.assign(state, {
      blocks: [{ kind: 'user', id: 'user-1', text: 'hello' }],
      busy: true,
      currentTurnId: 'turn-stale',
      currentTurnUserId: 'user-1',
      liveAssistant: '',
      liveReasoning: '',
      queuedMessages: [],
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })

    await actions.interrupt()

    expect(provider.interruptTurn).toHaveBeenCalledWith('thr_existing', 'turn-stale', undefined)
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.error).toBeNull()
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(drainQueuedMessages).not.toHaveBeenCalled()
  })

  it('does not treat plain active-turn error text as lifecycle state during interrupt', async () => {
    const { actions, provider, refreshThreads, state } = buildHarness()
    provider.interruptTurn.mockRejectedValueOnce(
      new Error('No active Codex turn is running for thread thr_existing.')
    )
    Object.assign(state, {
      blocks: [{ kind: 'user', id: 'user-1', text: 'hello' }],
      busy: true,
      currentTurnId: 'turn-stale',
      currentTurnUserId: 'user-1',
      liveAssistant: '',
      liveReasoning: '',
      queuedMessages: [],
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    })

    await actions.interrupt()

    expect(provider.interruptTurn).toHaveBeenCalledWith('thr_existing', 'turn-stale', undefined)
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.error).toBeTruthy()
    expect(refreshThreads).not.toHaveBeenCalled()
  })
})
