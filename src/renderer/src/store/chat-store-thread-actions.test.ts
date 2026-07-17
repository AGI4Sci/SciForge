import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentRuntimeFileReference,
  AgentRuntimeWorkspaceReference
} from '@shared/agent-runtime-contract'
import { defaultRemoteChannelSettings } from '@shared/app-settings'
import type { NormalizedThread, ThreadEventSink } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, GuiPlanMessageContext } from './chat-store-types'

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

import { createThreadActions, publishRemoteChannelActiveThreadContext } from './chat-store-thread-actions'
import { clearPendingRemoteChannelMirrors, takePendingRemoteChannelMirror } from './chat-store-runtime'
import { composerReferenceFromWorkspaceReference } from '../lib/workspace-reference-composer'
import { PLAN_REGISTRY_STORAGE_KEY, useGuiPlanStore } from '../plan/plan-store'
import { normalizePersistedQueuedMessages } from './chat-session-persistence'

function thread(id: string): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-09T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/sciforge',
    status: 'running'
  }
}

function buildHarness(): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
} {
  let state: ChatState
  state = {
    activeThreadId: 'thr_existing',
    activeAgentRuntime: 'sciforge',
    blocks: [],
    busy: true,
    activeThreadContextState: null,
    remoteChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    currentTurnId: null,
    currentTurnUserId: null,
    error: 'previous error',
    lastSeq: 0,
    liveAssistant: '',
    liveReasoning: '',
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => true),
    refreshThreads: vi.fn(async () => undefined),
    route: 'chat',
    runtimeConnection: 'ready',
    threads: [thread('thr_existing')],
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {}
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({
    set,
    get,
    sseAbortRef: { current: null }
  })
  state.sendMessage = actions.sendMessage
  state.drainQueuedMessages = actions.drainQueuedMessages
  return { actions, state }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('chat-store-thread-actions queued messages', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
    runtimeClientMock.getSettings.mockReset()
    runtimeClientMock.setSettings.mockReset()
    runtimeClientMock.getSettings.mockResolvedValue({
      codePromptPrefix: '',
      workspaceRoot: '/workspace/sciforge',
      remoteChannel: defaultRemoteChannelSettings()
    })
    runtimeClientMock.setSettings.mockImplementation(async (patch: { workspaceRoot?: string }) => ({
      codePromptPrefix: '',
      workspaceRoot: patch.workspaceRoot ?? '/workspace/sciforge',
      remoteChannel: defaultRemoteChannelSettings()
    }))
    clearPendingRemoteChannelMirrors()
    useGuiPlanStore.getState().clearActivePlan()
    vi.stubGlobal('window', {
      sciforge: {
        logError: vi.fn(async () => undefined)
      },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
  })

  it('does not queue GUI plan messages while another turn is active', async () => {
    const { actions, state } = buildHarness()
    const guiPlan: GuiPlanMessageContext = {
      operation: 'draft',
      workspaceRoot: '/workspace/sciforge',
      relativePath: '.sciforge/plan/feature.md',
      planId: 'plan-1',
      sourceRequest: 'feature'
    }

    await expect(actions.sendMessage('prompt one', 'plan', {
      displayText: 'Generate implementation plan',
      guiPlan
    })).resolves.toBe(false)

    expect(state.queuedMessages).toHaveLength(0)
    expect(state.error).toBeTruthy()
  })

  it('queues running text by default while the active turn is still running', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getCapabilities: vi.fn(() => ({
        interrupt: true,
        stream: true,
        approvals: true,
        attachFiles: true,
        steer: true
      })),
      rememberThreadRuntime: vi.fn(),
      steerUserMessage: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'turn-running'
    state.threads = [{ ...thread('thr_existing'), runtimeId: 'codex' }]

    await expect(actions.sendMessage('use the current output')).resolves.toBe(true)

    expect(provider.rememberThreadRuntime).not.toHaveBeenCalled()
    expect(provider.steerUserMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        threadId: 'thr_existing',
        text: 'use the current output',
        targetThreadId: 'thr_existing'
      })
    ])
    expect(state.error).toBeNull()
  })

  it('steers running text when the user explicitly prefixes it with /steer', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getCapabilities: vi.fn(() => ({
        interrupt: true,
        stream: true,
        approvals: true,
        attachFiles: true,
        steer: true
      })),
      rememberThreadRuntime: vi.fn(),
      steerUserMessage: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'turn-running'
    state.threads = [{ ...thread('thr_existing'), runtimeId: 'codex' }]

    await expect(actions.sendMessage('/steer use the current output')).resolves.toBe(true)

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('thr_existing', 'codex')
    expect(provider.steerUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'turn-running',
      'use the current output',
      { clientDirectiveId: expect.stringMatching(/^[0-9a-f-]{36}$/) }
    )
    expect(state.queuedMessages).toEqual([])
    expect(state.error).toBeNull()
  })

  it('reuses an explicit steer directive id when turn_not_running falls back to the queue', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getCapabilities: vi.fn(() => ({
        interrupt: true,
        stream: true,
        approvals: true,
        attachFiles: true,
        steer: true
      })),
      rememberThreadRuntime: vi.fn(),
      steerUserMessage: vi.fn(async (
        _threadId: string,
        _turnId: string,
        _text: string,
        _options?: { clientDirectiveId?: string }
      ) => {
        throw new Error(JSON.stringify({
          code: 'turn_not_running',
          message: 'The target turn already stopped.'
        }))
      })
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'turn-running'
    state.threads = [{ ...thread('thr_existing'), runtimeId: 'codex' }]

    await expect(actions.sendMessage('/steer preserve this correction')).resolves.toBe(true)

    const steerOptions = provider.steerUserMessage.mock.calls[0]?.[3]
    expect(steerOptions?.clientDirectiveId).toMatch(/^[0-9a-f-]{36}$/)
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        id: steerOptions?.clientDirectiveId,
        text: 'preserve this correction'
      })
    ])
  })

  it('queues running text when the runtime capability says steering is unsupported', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getCapabilities: vi.fn(() => ({
        interrupt: true,
        stream: true,
        approvals: true,
        attachFiles: true,
        steer: false
      })),
      steerUserMessage: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'turn-running'

    await expect(actions.sendMessage('continue after this')).resolves.toBe(true)

    expect(provider.steerUserMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        threadId: 'thr_existing',
        text: 'continue after this',
        targetThreadId: 'thr_existing'
      })
    ])
  })

  it('steers a queued text message when the user clicks the queued item action', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getCapabilities: vi.fn(() => ({
        interrupt: true,
        stream: true,
        approvals: true,
        attachFiles: true,
        steer: true
      })),
      rememberThreadRuntime: vi.fn(),
      steerUserMessage: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'turn-running'
    state.threads = [{ ...thread('thr_existing'), runtimeId: 'codex' }]
    state.queuedMessages = [{
      id: 'q-1',
      threadId: 'thr_existing',
      text: 'steer this queued follow-up'
    }]

    await expect(actions.steerQueuedMessage('q-1')).resolves.toBe(true)

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('thr_existing', 'codex')
    expect(provider.steerUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'turn-running',
      'steer this queued follow-up',
      { clientDirectiveId: 'q-1' }
    )
    expect(state.queuedMessages).toEqual([])
    expect(state.error).toBeNull()
  })

  it('starts a fresh draft instead of creating an empty runtime thread', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      createThread: vi.fn()
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.blocks = []
    state.error = 'previous error'
    state.selectThread = vi.fn(async (id: string) => {
      state.activeThreadId = id
    }) as unknown as ChatState['selectThread']

    await actions.createThread({ workspaceRoot: '/workspace/sciforge', forceNew: true })

    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.selectThread).not.toHaveBeenCalled()
    expect(state.activeThreadId).toBeNull()
    expect(state.blocks).toEqual([])
    expect(state.error).toBeNull()
    expect(state.threads.map((item) => item.id)).toEqual(['thr_existing'])
  })

  it('syncs an explicit project workspace before starting a draft', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      createThread: vi.fn()
    }
    registryMock.getProvider.mockReturnValue(provider)
    runtimeClientMock.getSettings.mockResolvedValueOnce({
      codePromptPrefix: '',
      workspaceRoot: '/workspace/startup',
      remoteChannel: defaultRemoteChannelSettings()
    })
    runtimeClientMock.setSettings.mockResolvedValueOnce({
      codePromptPrefix: '',
      workspaceRoot: '/workspace/project-b',
      remoteChannel: defaultRemoteChannelSettings()
    })
    state.workspaceRoot = '/workspace/startup'
    state.codeWorkspaceRoots = ['/workspace/startup']
    state.busy = false
    state.blocks = []
    state.selectThread = vi.fn(async (id: string) => {
      state.activeThreadId = id
    }) as unknown as ChatState['selectThread']

    await actions.createThread({ workspaceRoot: '/workspace/project-b', forceNew: true })

    expect(runtimeClientMock.setSettings).toHaveBeenCalledWith({ workspaceRoot: '/workspace/project-b' })
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.workspaceRoot).toBe('/workspace/project-b')
    expect(state.codeWorkspaceRoots).toEqual(['/workspace/project-b', '/workspace/startup'])
    expect(state.activeThreadId).toBeNull()
  })

  it('still starts an explicit project draft when workspace settings sync fails', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      createThread: vi.fn()
    }
    registryMock.getProvider.mockReturnValue(provider)
    runtimeClientMock.getSettings.mockResolvedValueOnce({
      codePromptPrefix: '',
      workspaceRoot: '/workspace/startup',
      remoteChannel: defaultRemoteChannelSettings()
    })
    runtimeClientMock.setSettings.mockRejectedValueOnce(new Error('settings unavailable'))
    state.workspaceRoot = '/workspace/startup'
    state.codeWorkspaceRoots = ['/workspace/startup']
    state.busy = false
    state.blocks = []
    state.selectThread = vi.fn(async (id: string) => {
      state.activeThreadId = id
    }) as unknown as ChatState['selectThread']

    await actions.createThread({ workspaceRoot: '/workspace/project-b', forceNew: true })

    expect(window.sciforge.logError).toHaveBeenCalledWith(
      'create-thread',
      'Failed to sync requested workspace before creating thread',
      expect.objectContaining({ workspaceRoot: '/workspace/project-b' })
    )
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.activeThreadId).toBeNull()
    expect(state.workspaceRoot).toBe('/workspace/project-b')
  })

  it('prefers the active thread workspace over current settings for ordinary new chats', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      createThread: vi.fn()
    }
    registryMock.getProvider.mockReturnValue(provider)
    runtimeClientMock.getSettings.mockResolvedValueOnce({
      codePromptPrefix: '',
      workspaceRoot: '/workspace/current',
      remoteChannel: defaultRemoteChannelSettings()
    })
    state.threads = [{
      ...thread('thr_existing'),
      workspace: '/workspace/old-active'
    }]
    state.workspaceRoot = '/workspace/current'
    state.busy = false
    state.blocks = []
    state.selectThread = vi.fn(async (id: string) => {
      state.activeThreadId = id
    }) as unknown as ChatState['selectThread']

    await actions.createThread({ forceNew: true })

    expect(runtimeClientMock.setSettings).toHaveBeenCalledWith({ workspaceRoot: '/workspace/old-active' })
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.workspaceRoot).toBe('/workspace/old-active')
    expect(state.activeThreadId).toBeNull()
  })

  it('defaults ordinary new chats to the first project when no chat is focused', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      createThread: vi.fn()
    }
    registryMock.getProvider.mockReturnValue(provider)
    runtimeClientMock.getSettings.mockResolvedValueOnce({
      codePromptPrefix: '',
      workspaceRoot: '',
      remoteChannel: defaultRemoteChannelSettings()
    })
    state.activeThreadId = null
    state.workspaceRoot = ''
    state.codeWorkspaceRoots = ['/workspace/project-a', '/workspace/project-b']
    state.busy = false
    state.blocks = []
    state.selectThread = vi.fn(async (id: string) => {
      state.activeThreadId = id
    }) as unknown as ChatState['selectThread']

    await actions.createThread({ forceNew: true })

    expect(runtimeClientMock.setSettings).toHaveBeenCalledWith({ workspaceRoot: '/workspace/project-a' })
    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.workspaceRoot).toBe('/workspace/project-a')
    expect(state.activeThreadId).toBeNull()
  })

  it('creates the first runtime message in the current draft workspace instead of stale settings', async () => {
    const { actions, state } = buildHarness()
    const createdThread = {
      ...thread('thr_created_in_draft_workspace'),
      title: 'hello from draft',
      workspace: '/workspace/draft',
      status: 'idle'
    }
    const provider = {
      createThread: vi.fn(async () => createdThread),
      sendUserMessage: vi.fn(async (
        _threadId: string,
        _text: string,
        _options?: Record<string, unknown>
      ) => ({
        threadId: 'thr_created_in_draft_workspace',
        turnId: 'turn-1',
        userMessageItemId: 'runtime-user-1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    runtimeClientMock.getSettings.mockResolvedValueOnce({
      codePromptPrefix: '',
      workspaceRoot: '/workspace/stale-settings',
      remoteChannel: defaultRemoteChannelSettings()
    })
    state.activeThreadId = null
    state.workspaceRoot = '/workspace/draft'
    state.codeWorkspaceRoots = ['/workspace/draft', '/workspace/stale-settings']
    state.busy = false
    state.blocks = []

    await expect(actions.sendMessage('hello from draft')).resolves.toBe(true)

    expect(provider.createThread).toHaveBeenCalledWith({
      workspace: '/workspace/draft',
      title: 'hello from draft',
      mode: 'agent'
    })
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_created_in_draft_workspace',
      'hello from draft',
      expect.objectContaining({
        workspace: '/workspace/draft',
        title: 'hello from draft',
        displayText: 'hello from draft'
      })
    )
    expect(state.activeThreadId).toBe('thr_created_in_draft_workspace')
  })

  it('creates the runtime thread when the first draft message is sent', async () => {
    const { actions, state } = buildHarness()
    const createdThread = {
      ...thread('thr_created_on_send'),
      title: 'hello from a fresh draft',
      workspace: '/workspace/sciforge',
      status: 'idle'
    }
    const provider = {
      createThread: vi.fn(async () => createdThread),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_created_on_send',
        turnId: 'turn-1',
        userMessageItemId: 'runtime-user-1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.activeThreadId = null
    state.busy = false
    state.blocks = []

    await expect(actions.sendMessage('hello from a fresh draft')).resolves.toBe(true)

    expect(provider.createThread).toHaveBeenCalledWith({
      workspace: '/workspace/sciforge',
      title: 'hello from a fresh draft',
      mode: 'agent'
    })
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_created_on_send',
      'hello from a fresh draft',
      expect.objectContaining({
        workspace: '/workspace/sciforge',
        title: 'hello from a fresh draft',
        displayText: 'hello from a fresh draft'
      })
    )
    expect(state.activeThreadId).toBe('thr_created_on_send')
    expect(state.threads[0]?.id).toBe('thr_created_on_send')
  })

  it('renders the final assistant response and clears busy when the runtime completes', async () => {
    const { actions, state } = buildHarness()
    const captured: { sink: ThreadEventSink | null } = { sink: null }
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn-complete',
        userMessageItemId: 'runtime-user-complete'
      })),
      subscribeThreadEvents: vi.fn(async (_threadId: string, _sinceSeq: number, sink: ThreadEventSink) => {
        captured.sink = sink
      }),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null
    state.threads = [{ ...thread('thr_existing'), runtimeId: 'codex' }]

    await expect(actions.sendMessage('finish this turn')).resolves.toBe(true)

    if (!captured.sink) throw new Error('Expected sendMessage to subscribe to runtime events.')
    captured.sink.onDeltas([{ kind: 'agent_message', text: 'done for the user', seq: 1 }])
    captured.sink.onTurnComplete()

    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.error).toBeNull()
    expect(state.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'assistant',
        text: 'done for the user'
      })
    ]))
  })

  it('removes stale queued GUI plan messages before draining normal queued messages', async () => {
    const { actions, state } = buildHarness()
    const sendMessage = vi.fn(async (_text, _mode, overrides) => {
      state.queuedMessages = state.queuedMessages.filter((message) => message.id !== overrides?.queued?.id)
      return true
    })
    state.busy = false
    state.sendMessage = sendMessage as unknown as ChatState['sendMessage']
    state.queuedMessages = [
      {
        id: 'q-plan',
        text: 'internal plan prompt',
        mode: 'plan',
        guiPlan: {
          operation: 'draft',
          workspaceRoot: '/workspace/sciforge',
          relativePath: '.sciforge/plan/one.md',
          planId: 'plan-1'
        }
      },
      {
        id: 'q-user',
        text: 'normal follow-up',
        mode: 'agent'
      }
    ]

    await actions.drainQueuedMessages()

    expect(state.queuedMessages).toEqual([])
    expect(sendMessage).toHaveBeenCalledWith('normal follow-up', 'agent', {
      queued: expect.objectContaining({ id: 'q-user' })
    })
  })

  it('preserves queued messages whose original thread does not match the active thread', async () => {
    const { actions, state } = buildHarness()
    const sendMessage = vi.fn(async (_text, _mode, overrides) => {
      state.queuedMessages = state.queuedMessages.filter((message) => message.id !== overrides?.queued?.id)
      return true
    })
    state.busy = false
    state.activeThreadId = 'thr_other'
    state.sendMessage = sendMessage as unknown as ChatState['sendMessage']
    state.queuedMessages = [{
      id: 'q-stale',
      text: 'send to the old thread',
      mode: 'agent',
      threadId: 'thr_existing',
      runtimeId: 'sciforge'
    }]

    await actions.drainQueuedMessages()

    expect(state.queuedMessages).toEqual([
      expect.objectContaining({ id: 'q-stale', threadId: 'thr_existing' })
    ])
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('edits queued message content without dropping its routing metadata', () => {
    const { actions, state } = buildHarness()
    state.queuedMessages = [{
      id: 'q-edit',
      threadId: 'thr_existing',
      runtimeId: 'sciforge',
      text: 'old payload',
      displayText: 'old display',
      mode: 'agent'
    }]

    expect(actions.updateQueuedMessage('q-edit', '  revised follow-up  ')).toBe(true)
    expect(state.queuedMessages).toEqual([{
      id: 'q-edit',
      threadId: 'thr_existing',
      runtimeId: 'sciforge',
      text: 'revised follow-up',
      displayText: 'revised follow-up',
      mode: 'agent'
    }])
    expect(actions.updateQueuedMessage('q-edit', '   ')).toBe(false)
    expect(actions.updateQueuedMessage('missing', 'text')).toBe(false)
  })

  it('keeps attempted payload identity immutable after delivery becomes uncertain', () => {
    const { actions, state } = buildHarness()
    state.queuedMessages = [{
      id: 'q-uncertain',
      threadId: 'thr_existing',
      text: 'original scientific instruction',
      deliveryAttempt: {
        startedAt: 1_725_000_000_000,
        userBlockId: 'u-original',
        attemptedText: 'original scientific instruction',
        restored: true
      }
    }]

    expect(actions.updateQueuedMessage('q-uncertain', 'different instruction')).toBe(false)
    expect(state.queuedMessages[0]).toEqual(expect.objectContaining({
      text: 'original scientific instruction',
      deliveryAttempt: expect.objectContaining({ attemptedText: 'original scientific instruction' })
    }))
  })

  it('drains a completed background thread without mutating the active thread UI', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [{ kind: 'assistant', id: 'a-running', text: 'still running' }],
        latestSeq: 2,
        threadStatus: 'running'
      })),
      rememberThreadRuntime: vi.fn(),
      sendUserMessage: vi.fn(async () => ({
        turnId: 'turn-a-follow-up',
        threadId: 'thread-a',
        userMessageItemId: 'user-a-follow-up'
      }))
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.activeThreadId = 'thread-b'
    state.activeAgentRuntime = 'sciforge'
    state.blocks = [{ kind: 'assistant', id: 'b-block', text: 'active B content' }]
    state.busy = true
    state.currentTurnId = 'turn-b'
    state.threads = [
      { ...thread('thread-a'), runtimeId: 'sciforge', workspace: '/workspace/a' },
      { ...thread('thread-b'), runtimeId: 'sciforge', workspace: '/workspace/b' }
    ]
    state.queuedMessages = [{
      id: 'q-a',
      threadId: 'thread-a',
      runtimeId: 'sciforge',
      text: 'continue A in the background',
      displayText: 'continue A in the background',
      model: 'deepseek-v4-pro',
      governanceProfile: 'write',
      attachmentIds: ['attachment-a'],
      fileReferences: [{
        path: '/workspace/a/evidence.csv',
        relativePath: 'evidence.csv',
        name: 'evidence.csv'
      }]
    }]

    await expect(actions.drainQueuedMessagesForThread('thread-a')).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thread-a',
      expect.stringContaining('continue A in the background'),
      expect.objectContaining({
        clientDirectiveId: 'q-a',
        workspace: '/workspace/a',
        model: 'deepseek-v4-pro',
        displayText: 'continue A in the background',
        governanceProfile: 'write',
        attachmentIds: ['attachment-a'],
        fileReferences: [expect.objectContaining({ relativePath: 'evidence.csv' })]
      })
    )
    expect(state.activeThreadId).toBe('thread-b')
    expect(state.blocks).toEqual([{ kind: 'assistant', id: 'b-block', text: 'active B content' }])
    expect(state.busy).toBe(true)
    expect(state.currentTurnId).toBe('turn-b')
    expect(state.queuedMessages).toEqual([])
    expect(state.watchTurnCompletion).toMatchObject({ 'thread-a': true })
  })

  it('keeps a background queue when sending would hand the thread to another runtime', async () => {
    const { actions, state } = buildHarness()
    const provider = { sendUserMessage: vi.fn() }
    registryMock.getProvider.mockReturnValue(provider)
    state.activeThreadId = 'thread-b'
    state.activeAgentRuntime = 'codex'
    state.threads = [
      { ...thread('thread-a'), runtimeId: 'sciforge' },
      { ...thread('thread-b'), runtimeId: 'codex' }
    ]
    state.queuedMessages = [{
      id: 'q-a',
      threadId: 'thread-a',
      runtimeId: 'sciforge',
      text: 'do not hand this off'
    }]

    await expect(actions.drainQueuedMessagesForThread('thread-a')).resolves.toBe(false)

    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual([expect.objectContaining({ id: 'q-a' })])
  })

  it('starts a background queued message at most once when completion polls overlap', async () => {
    const { actions, state } = buildHarness()
    const turn = deferred<{ turnId: string; threadId: string }>()
    const provider = {
      getThreadDetail: vi.fn(async () => ({ blocks: [], latestSeq: 1, threadStatus: 'running' })),
      rememberThreadRuntime: vi.fn(),
      sendUserMessage: vi.fn(() => turn.promise)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.activeThreadId = 'thread-b'
    state.activeAgentRuntime = 'sciforge'
    state.threads = [
      { ...thread('thread-a'), runtimeId: 'sciforge' },
      { ...thread('thread-b'), runtimeId: 'sciforge' }
    ]
    state.queuedMessages = [{
      id: 'q-a',
      threadId: 'thread-a',
      runtimeId: 'sciforge',
      text: 'send exactly once'
    }]

    const firstDrain = actions.drainQueuedMessagesForThread('thread-a')
    await Promise.resolve()
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        id: 'q-a',
        deliveryAttempt: expect.objectContaining({ startedAt: expect.any(Number) })
      })
    ])
    await expect(actions.drainQueuedMessagesForThread('thread-a')).resolves.toBe(false)
    expect(provider.sendUserMessage).toHaveBeenCalledTimes(1)

    turn.resolve({ turnId: 'turn-a-next', threadId: 'thread-a' })
    await expect(firstDrain).resolves.toBe(true)
    expect(provider.sendUserMessage).toHaveBeenCalledTimes(1)
    expect(state.queuedMessages).toEqual([])
  })

  it('loads shared context state when selecting a thread', async () => {
    const { actions, state } = buildHarness()
    const contextState = {
      runtimeId: 'codex' as const,
      threadId: 'thr_existing',
      rawHistoryItems: 10,
      effectiveHistoryItems: 4,
      summarySource: 'heuristic' as const,
      updatedAt: '2026-06-20T00:00:00.000Z',
      goalResume: {
        status: 'blocked' as const,
        resumeCount: 1,
        lastFailureReason: 'no progress',
        updatedAt: '2026-06-20T00:00:01.000Z'
      }
    }
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [],
        latestSeq: 2,
        threadStatus: 'idle'
      })),
      getContextState: vi.fn(async () => contextState),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null

    await actions.selectThread('thr_existing')

    expect(provider.getContextState).toHaveBeenCalledWith('thr_existing')
    expect(state.activeThreadContextState).toEqual(contextState)
  })

  it('updates the active thread id before slow thread detail resolves', async () => {
    const { actions, state } = buildHarness()
    let resolveDetail: (value: {
      blocks: [{ kind: 'assistant'; id: string; text: string }]
      latestSeq: number
      threadStatus: string
    }) => void = () => {
      throw new Error('getThreadDetail promise was not created')
    }
    const provider = {
      getThreadDetail: vi.fn(() => new Promise((resolve) => {
        resolveDetail = resolve
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.blocks = [{ kind: 'assistant', id: 'old-block', text: 'old thread' }]
    state.threads = [thread('thr_existing'), thread('thr_slow')]
    state.queuedMessages = [{
      id: 'q-existing',
      text: 'stay with the original thread',
      threadId: 'thr_existing'
    }]
    state.unreadThreadIds = { thr_slow: true }

    const selecting = actions.selectThread('thr_slow')

    expect(state.activeThreadId).toBe('thr_slow')
    expect(state.focusedAgentThreadId).toBe('thr_slow')
    expect(state.agentFocusLineage.map((node) => node.threadId)).toEqual(['thr_slow'])
    expect(state.agentFocusHistory.map((location) => location.threadId)).toEqual(['thr_slow'])
    expect(state.blocks).toEqual([])
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({ id: 'q-existing', threadId: 'thr_existing' })
    ])
    expect(state.unreadThreadIds).toEqual({})
    expect(provider.subscribeThreadEvents).not.toHaveBeenCalled()

    resolveDetail({
      blocks: [{ kind: 'assistant', id: 'slow-block', text: 'loaded thread' }],
      latestSeq: 4,
      threadStatus: 'idle'
    })
    await selecting

    expect(state.activeThreadId).toBe('thr_slow')
    expect(state.blocks).toEqual([{ kind: 'assistant', id: 'slow-block', text: 'loaded thread' }])
    expect(provider.subscribeThreadEvents).toHaveBeenCalledWith(
      'thr_slow',
      4,
      expect.any(Object),
      expect.any(AbortSignal)
    )
  })

  it('ignores an older select thread result when a newer selection wins', async () => {
    const { actions, state } = buildHarness()
    const detailResolvers = new Map<string, (value: {
      blocks: [{ kind: 'assistant'; id: string; text: string }]
      latestSeq: number
      threadStatus: string
    }) => void>()
    const provider = {
      getThreadDetail: vi.fn((threadId: string) => new Promise((resolve) => {
        detailResolvers.set(threadId, resolve)
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.threads = [thread('thr_existing'), thread('thr_first'), thread('thr_second')]

    const firstSelection = actions.selectThread('thr_first')
    expect(state.activeThreadId).toBe('thr_first')

    const secondSelection = actions.selectThread('thr_second')
    expect(state.activeThreadId).toBe('thr_second')

    detailResolvers.get('thr_second')?.({
      blocks: [{ kind: 'assistant', id: 'second-block', text: 'newer thread' }],
      latestSeq: 7,
      threadStatus: 'idle'
    })
    await secondSelection

    detailResolvers.get('thr_first')?.({
      blocks: [{ kind: 'assistant', id: 'first-block', text: 'stale thread' }],
      latestSeq: 3,
      threadStatus: 'idle'
    })
    await firstSelection

    expect(state.activeThreadId).toBe('thr_second')
    expect(state.blocks).toEqual([{ kind: 'assistant', id: 'second-block', text: 'newer thread' }])
    expect(provider.subscribeThreadEvents).toHaveBeenCalledTimes(1)
    expect(provider.subscribeThreadEvents).toHaveBeenCalledWith(
      'thr_second',
      7,
      expect.any(Object),
      expect.any(AbortSignal)
    )
  })

  it('does not activate GUI plan registry from thread metadata during thread selection', async () => {
    const { actions, state } = buildHarness()
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    }
    vi.stubGlobal('window', {
      sciforge: {
        logError: vi.fn(async () => undefined)
      },
      localStorage: storage
    })
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [],
        latestSeq: 2,
        threadStatus: 'idle',
        guiPlan: {
          operation: 'draft' as const,
          workspaceRoot: '/workspace/sciforge',
          relativePath: '.sciforge/plan/thread-owned.md',
          planId: '/workspace/sciforge:.sciforge/plan/thread-owned.md',
          sourceRequest: 'Plan from runtime metadata',
          title: 'Thread-owned plan'
        }
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null

    await actions.selectThread('thr_existing')

    expect(provider.getThreadDetail).toHaveBeenCalledWith('thr_existing')
    expect(useGuiPlanStore.getState().activePlan).toBeNull()
    expect(storage.setItem).not.toHaveBeenCalledWith(
      PLAN_REGISTRY_STORAGE_KEY,
      expect.any(String)
    )
  })

  it('does not let stale turn recovery restore a thread after the user switches away', async () => {
    const { actions, state } = buildHarness()
    let resolveDetail: (value: {
      blocks: []
      latestSeq: number
      threadStatus: string
    }) => void = () => {
      throw new Error('getThreadDetail promise was not created')
    }
    const provider = {
      getThreadDetail: vi.fn(() => new Promise((resolve) => {
        resolveDetail = resolve
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.error = null
    state.threads = [thread('thr_existing'), thread('thr_other')]
    state.drainQueuedMessages = vi.fn(async () => undefined)

    const recovering = actions.recoverActiveTurn()
    await Promise.resolve()
    state.activeThreadId = 'thr_other'
    state.blocks = [{ kind: 'assistant', id: 'other-block', text: 'current thread' }]
    resolveDetail({ blocks: [], latestSeq: 8, threadStatus: 'idle' })

    await expect(recovering).resolves.toBe(false)

    expect(state.activeThreadId).toBe('thr_other')
    expect(state.blocks).toEqual([{ kind: 'assistant', id: 'other-block', text: 'current thread' }])
    expect(provider.subscribeThreadEvents).not.toHaveBeenCalled()
    expect(state.drainQueuedMessages).not.toHaveBeenCalled()
  })

  it('does not keep an empty thread busy just because the runtime reports a running thread status', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [],
        latestSeq: 1,
        threadStatus: 'running'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'stale-turn'
    state.currentTurnUserId = 'stale-user'
    state.error = null

    await expect(actions.recoverActiveTurn()).resolves.toBe(false)

    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.error).toBeNull()
    expect(provider.subscribeThreadEvents).toHaveBeenCalledWith(
      'thr_existing',
      1,
      expect.any(Object),
      expect.any(AbortSignal)
    )
  })

  it('keeps optimistic turn blocks when recovery reads a stale empty snapshot', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [],
        latestSeq: 2,
        threadStatus: 'idle'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.lastSeq = 7
    state.currentTurnId = 'turn-optimistic'
    state.currentTurnUserId = 'u-optimistic'
    state.blocks = [{ kind: 'user', id: 'u-optimistic', text: 'new information' }]
    state.error = null

    await expect(actions.recoverActiveTurn()).resolves.toBe(true)

    expect(state.busy).toBe(true)
    expect(state.currentTurnId).toBe('turn-optimistic')
    expect(state.currentTurnUserId).toBe('u-optimistic')
    expect(state.blocks).toEqual([{ kind: 'user', id: 'u-optimistic', text: 'new information' }])
    expect(provider.subscribeThreadEvents).toHaveBeenCalledWith(
      'thr_existing',
      7,
      expect.any(Object),
      expect.any(AbortSignal)
    )
  })

  it('settles stale pending blocks when recovery finds an idle runtime thread', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [
          {
            kind: 'tool',
            id: 'tool-stale',
            createdAt: '2026-06-09T00:00:00.000Z',
            summary: 'stale tool',
            status: 'running'
          }
        ],
        latestSeq: 12,
        threadStatus: 'idle'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'stale-turn'
    state.queuedMessages = [{
      id: 'q-follow-up',
      text: 'new follow up',
      mode: 'agent',
      threadId: 'thr_existing',
      targetThreadId: 'thr_existing'
    }]
    state.drainQueuedMessages = vi.fn(async () => undefined) as unknown as ChatState['drainQueuedMessages']

    await expect(actions.recoverActiveTurn()).resolves.toBe(false)

    expect(state.busy).toBe(false)
    expect(state.blocks).toEqual([
      expect.objectContaining({
        id: 'tool-stale',
        status: 'success'
      })
    ])
    expect(state.drainQueuedMessages).toHaveBeenCalledTimes(1)
  })

  it('reconciles the optimistic user block with the runtime user message id', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        turnId: 'turn-1',
        userMessageItemId: 'runtime-user-1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null
    state.composerModel = 'gpt-5.4'

    await expect(actions.sendMessage('hello from UI')).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith('thr_existing', 'hello from UI', {
      clientDirectiveId: expect.stringMatching(/^u-/),
      mode: undefined,
      workspace: '/workspace/sciforge',
      title: 'thr_existing',
      model: 'gpt-5.4',
      displayText: 'hello from UI'
    })
    expect(state.blocks).toEqual([
      expect.objectContaining({
        kind: 'user',
        id: 'runtime-user-1',
        text: 'hello from UI',
        modelLabel: 'gpt-5.4'
      })
    ])
    expect(state.currentTurnUserId).toBe('runtime-user-1')
    expect(Object.keys(state.turnStartedAtByUserId)).toEqual(['runtime-user-1'])
  })

  it('rolls back an unaccepted optimistic user block and preserves a manual retry', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      sendUserMessage: vi.fn(async () => {
        throw new Error('tool schema rejected before turn startup')
      })
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null

    await expect(actions.sendMessage('preserve this scientific instruction')).resolves.toBe(false)

    expect(state.blocks).toEqual([])
    expect(state.busy).toBe(false)
    expect(state.currentTurnUserId).toBeNull()
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        threadId: 'thr_existing',
        text: 'preserve this scientific instruction',
        sendFailure: expect.objectContaining({
          userBlockId: expect.stringMatching(/^u-/),
          message: 'tool schema rejected before turn startup'
        })
      })
    ])
    expect(state.error).toContain('tool schema rejected before turn startup')
  })

  it('does not automatically drain a failed-send recovery entry', async () => {
    const { actions, state } = buildHarness()
    const sendMessage = vi.fn(async () => true)
    state.busy = false
    state.sendMessage = sendMessage as unknown as ChatState['sendMessage']
    state.queuedMessages = [{
      id: 'retry-1',
      threadId: 'thr_existing',
      text: 'do not resend automatically',
      sendFailure: { userBlockId: 'u-1', message: 'runtime unavailable' }
    }, {
      id: 'q-later',
      threadId: 'thr_existing',
      text: 'must not overtake the failed send'
    }]

    await actions.drainQueuedMessages()

    expect(sendMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages).toHaveLength(2)
  })

  it('does not automatically drain restored attachments and retries only after confirmation', async () => {
    const { actions, state } = buildHarness()
    const sendMessage = vi.fn(async () => true)
    state.busy = false
    state.sendMessage = sendMessage as unknown as ChatState['sendMessage']
    state.queuedMessages = [{
      id: 'restored-attachment',
      threadId: 'thr_existing',
      text: 'inspect the restored image',
      attachmentIds: ['attachment-1'],
      restoredAttachmentWarning: 'confirm the restored attachment'
    }, {
      id: 'q-later',
      threadId: 'thr_existing',
      text: 'must not overtake the attachment'
    }]

    await actions.drainQueuedMessages()
    expect(sendMessage).not.toHaveBeenCalled()

    await expect(actions.retryQueuedMessage('restored-attachment')).resolves.toBe(true)
    expect(sendMessage).toHaveBeenCalledWith(
      'inspect the restored image',
      undefined,
      { queued: expect.not.objectContaining({ restoredAttachmentWarning: expect.anything() }) }
    )
  })

  it('retries the original text when the failed send was not persisted', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [],
        latestSeq: 4,
        threadStatus: 'idle'
      })),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn-retry',
        userMessageItemId: 'runtime-user-retry'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null
    state.queuedMessages = [{
      id: 'retry-1',
      threadId: 'thr_existing',
      text: 'run the missing analysis',
      sendFailure: { userBlockId: 'u-missing', message: 'startup failed' }
    }]

    await expect(actions.retryQueuedMessage('retry-1')).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'run the missing analysis',
      expect.objectContaining({ displayText: 'run the missing analysis' })
    )
    expect(state.queuedMessages).toEqual([])
  })

  it('continues an orphaned persisted user item instead of duplicating its text', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [{
          kind: 'user' as const,
          id: 'runtime-orphan',
          text: '[runtime prefix] original request',
          meta: { displayText: 'original request' }
        }],
        latestSeq: 8,
        latestUserMessageId: 'runtime-orphan',
        threadStatus: 'idle'
      })),
      sendUserMessage: vi.fn(async (
        _threadId: string,
        _text: string,
        _options?: Record<string, unknown>
      ) => ({
        threadId: 'thr_existing',
        turnId: 'turn-recovery',
        userMessageItemId: 'runtime-user-recovery'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null
    state.queuedMessages = [{
      id: 'retry-orphan',
      threadId: 'thr_existing',
      text: 'original request',
      displayText: 'original request',
      attachmentIds: ['already-persisted'],
      sendFailure: { userBlockId: 'u-optimistic', message: 'startup failed' }
    }]

    await expect(actions.retryQueuedMessage('retry-orphan')).resolves.toBe(true)

    const sentText = provider.sendUserMessage.mock.calls[0]?.[1]
    const sentOptions = provider.sendUserMessage.mock.calls[0]?.[2]
    expect(sentText).toContain('preceding user message')
    expect(sentText).not.toBe('original request')
    expect(sentOptions).not.toHaveProperty('attachmentIds')
    expect(state.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime-orphan', text: '[runtime prefix] original request' }),
      expect.objectContaining({ id: 'runtime-user-recovery' })
    ]))
    expect(state.queuedMessages).toEqual([])
  })

  it('reconciles a restored direct-send journal instead of duplicating an accepted user item', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [{
          kind: 'user' as const,
          id: 'runtime-accepted-queue',
          text: 'run this exactly once'
        }],
        latestSeq: 9,
        latestUserMessageId: 'runtime-accepted-queue',
        threadStatus: 'idle'
      })),
      sendUserMessage: vi.fn(async (
        _threadId: string,
        _text: string,
        _options?: Record<string, unknown>
      ) => ({
        threadId: 'thr_existing',
        turnId: 'turn-continuation',
        userMessageItemId: 'runtime-recovery'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null
    state.queuedMessages = [{
      id: 'q-crash-window',
      threadId: 'thr_existing',
      text: 'run this exactly once',
      deliveryAttempt: {
        startedAt: 1_725_000_000_000,
        userBlockId: 'q-crash-window',
        attemptedText: 'run this exactly once',
        journalOnly: true,
        restored: true
      }
    }]

    await expect(actions.retryQueuedMessage('q-crash-window')).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledTimes(1)
    expect(provider.sendUserMessage.mock.calls[0]?.[1]).toContain('preceding user message')
    expect(provider.sendUserMessage.mock.calls[0]?.[1]).not.toBe('run this exactly once')
    expect(state.queuedMessages).toEqual([])
  })

  it('journals a direct idle send before the provider boundary and resends only when restart reconciliation finds it absent', async () => {
    const first = buildHarness()
    first.state.busy = false
    first.state.error = null
    const firstProvider = {
      sendUserMessage: vi.fn((
        _threadId: string,
        _text: string,
        _options?: { clientDirectiveId?: string }
      ) => new Promise<never>(() => undefined)),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(firstProvider)

    void first.actions.sendMessage('direct crash-window instruction')
    await vi.waitFor(() => expect(firstProvider.sendUserMessage).toHaveBeenCalledTimes(1))

    expect(first.state.queuedMessages).toEqual([expect.objectContaining({
      text: 'direct crash-window instruction',
      deliveryAttempt: expect.objectContaining({
        attemptedText: 'direct crash-window instruction',
        journalOnly: true
      })
    })])
    const originalDirectiveId = first.state.queuedMessages[0]!.id
    expect(firstProvider.sendUserMessage.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ clientDirectiveId: originalDirectiveId })
    )
    const restored = normalizePersistedQueuedMessages(first.state.queuedMessages, true)
    expect(restored[0]?.deliveryAttempt?.restored).toBe(true)

    const second = buildHarness()
    second.state.busy = false
    second.state.error = null
    second.state.queuedMessages = restored
    const secondProvider = {
      getThreadDetail: vi.fn(async () => ({ blocks: [], latestSeq: 0, threadStatus: 'idle' })),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn-after-restart',
        userMessageItemId: 'runtime-direct-after-restart'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(secondProvider)

    await expect(second.actions.retryQueuedMessage(restored[0]!.id)).resolves.toBe(true)
    expect(secondProvider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'direct crash-window instruction',
      expect.objectContaining({
        clientDirectiveId: originalDirectiveId,
        displayText: 'direct crash-window instruction'
      })
    )
    expect(second.state.queuedMessages).toEqual([])
  })

  it('removes a completed restored direct-send journal when an assistant reply follows the user item', async () => {
    const { actions, state } = buildHarness()
    const startedAt = 1_725_000_000_000
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [{
          kind: 'user' as const,
          id: 'runtime-accepted-complete',
          text: 'run this completed task once',
          createdAt: new Date(startedAt + 1_000).toISOString()
        }, {
          kind: 'assistant' as const,
          id: 'runtime-completed-answer',
          text: 'Completed result',
          createdAt: new Date(startedAt + 2_000).toISOString()
        }],
        latestSeq: 11,
        latestUserMessageId: 'runtime-accepted-complete',
        threadStatus: 'idle'
      })),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn-continuation-after-complete',
        userMessageItemId: 'runtime-recovery-after-complete'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null
    state.queuedMessages = [{
      id: 'q-completed-crash-window',
      threadId: 'thr_existing',
      text: 'run this completed task once',
      deliveryAttempt: {
        startedAt,
        userBlockId: 'q-completed-crash-window',
        attemptedText: 'run this completed task once',
        journalOnly: true,
        restored: true
      }
    }]

    await expect(actions.retryQueuedMessage('q-completed-crash-window')).resolves.toBe(true)

    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(state.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime-accepted-complete' }),
      expect.objectContaining({ id: 'runtime-completed-answer' })
    ]))
    expect(state.queuedMessages).toEqual([])
  })

  it('does not create a retry entry when the provider accepted the turn before a refresh failed', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn-accepted',
        userMessageItemId: 'runtime-user-accepted'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null
    state.refreshThreads = vi.fn(async () => {
      throw new Error('sidebar refresh failed')
    })
    state.recoverActiveTurn = vi.fn(async () => true)

    await expect(actions.sendMessage('accepted exactly once')).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledTimes(1)
    expect(state.queuedMessages).toEqual([])
    expect(state.recoverActiveTurn).toHaveBeenCalled()
  })

  it('keeps the GUI conversation stable when switching runtime on the same thread id', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      rememberThreadRuntime: vi.fn(),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn-sciforge',
        userMessageItemId: 'runtime-user-sciforge'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.activeAgentRuntime = 'codex'
    state.lastSeq = 12
    state.threads = [{
      ...thread('thr_existing'),
      runtimeId: 'sciforge'
    }]

    await expect(actions.sendMessage('continue after restart')).resolves.toBe(true)

    expect(state.activeThreadId).toBe('thr_existing')
    expect(state.threads.find((item) => item.id === 'thr_existing')?.runtimeId).toBe('codex')
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'continue after restart',
      expect.objectContaining({
        workspace: '/workspace/sciforge',
        title: 'thr_existing'
      })
    )
    expect(provider.subscribeThreadEvents).toHaveBeenCalledWith(
      'thr_existing',
      0,
      expect.any(Object),
      expect.any(AbortSignal)
    )
    expect(provider.rememberThreadRuntime).toHaveBeenLastCalledWith('thr_existing', 'codex')
  })

  it('keeps the GUI conversation id stable when the runtime returns a different thread id', async () => {
    const { actions, state } = buildHarness()
    const logError = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      sciforge: { logError },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
    const provider = {
      rememberThreadRuntime: vi.fn(),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'runtime-returned-other',
        turnId: 'turn-sciforge',
        userMessageItemId: 'runtime-user-sciforge'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.activeAgentRuntime = 'codex'
    state.lastSeq = 12
    state.threads = [{
      ...thread('thr_existing'),
      runtimeId: 'sciforge'
    }]

    await expect(actions.sendMessage('continue after restart')).resolves.toBe(true)

    expect(state.activeThreadId).toBe('thr_existing')
    expect(state.threads.some((item) => item.id === 'runtime-returned-other')).toBe(false)
    expect(state.threads.find((item) => item.id === 'thr_existing')?.runtimeId).toBe('codex')
    expect(provider.subscribeThreadEvents).toHaveBeenCalledWith(
      'thr_existing',
      0,
      expect.any(Object),
      expect.any(AbortSignal)
    )
    expect(provider.rememberThreadRuntime).toHaveBeenLastCalledWith('thr_existing', 'codex')
    expect(logError).toHaveBeenCalledWith(
      'session-identity',
      'Runtime returned a different thread id for a stable GUI session',
      expect.objectContaining({
        sessionId: 'thr_existing',
        deliveredThreadId: 'runtime-returned-other'
      })
    )
  })

  it('adopts a returned thread id only when the provider marks an explicit handoff', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      rememberThreadRuntime: vi.fn(),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'handoff-target',
        turnId: 'turn-handoff',
        userMessageItemId: 'runtime-user-handoff',
        threadIdChange: 'handoff' as const
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.activeAgentRuntime = 'codex'
    state.lastSeq = 12
    state.threads = [{
      ...thread('thr_existing'),
      runtimeId: 'sciforge'
    }]

    await expect(actions.sendMessage('continue in codex')).resolves.toBe(true)

    expect(state.activeThreadId).toBe('handoff-target')
    expect(state.threads.some((item) => item.id === 'thr_existing')).toBe(false)
    expect(state.threads.find((item) => item.id === 'handoff-target')?.runtimeId).toBe('codex')
    expect(provider.subscribeThreadEvents).toHaveBeenCalledWith(
      'handoff-target',
      0,
      expect.any(Object),
      expect.any(AbortSignal)
    )
    expect(provider.rememberThreadRuntime).toHaveBeenLastCalledWith('handoff-target', 'codex')
  })

  it('does not apply a slow send result to a different active session after the user switches threads', async () => {
    const { actions, state } = buildHarness()
    const sent = deferred<{
      threadId: string
      turnId: string
      userMessageItemId: string
    }>()
    const provider = {
      sendUserMessage: vi.fn(() => sent.promise),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null
    state.currentTurnId = null
    state.currentTurnUserId = null
    state.threads = [
      { ...thread('thr_existing'), runtimeId: 'codex' },
      { ...thread('thr_other'), runtimeId: 'codex' }
    ]

    const sendPromise = actions.sendMessage('long running send')
    await Promise.resolve()

    state.activeThreadId = 'thr_other'
    state.blocks = []
    state.busy = false
    state.currentTurnId = null
    state.currentTurnUserId = null

    sent.resolve({
      threadId: 'thr_existing',
      turnId: 'turn-late',
      userMessageItemId: 'runtime-user-late'
    })

    await expect(sendPromise).resolves.toBe(true)

    expect(state.activeThreadId).toBe('thr_other')
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.blocks).toEqual([])
    expect(state.watchTurnCompletion).toMatchObject({ thr_existing: true })
    expect(provider.subscribeThreadEvents).not.toHaveBeenCalled()
  })

  it('does not apply a slow send failure to a different active session after the user switches threads', async () => {
    const { actions, state } = buildHarness()
    const sent = deferred<{
      threadId: string
      turnId: string
      userMessageItemId: string
    }>()
    const provider = {
      sendUserMessage: vi.fn(() => sent.promise),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null
    state.currentTurnId = null
    state.currentTurnUserId = null
    state.threads = [
      { ...thread('thr_existing'), runtimeId: 'codex' },
      { ...thread('thr_other'), runtimeId: 'codex' }
    ]

    const sendPromise = actions.sendMessage('long running send')
    await Promise.resolve()

    state.activeThreadId = 'thr_other'
    state.blocks = [{ kind: 'assistant', id: 'other-block', text: 'current session' }]
    state.busy = false
    state.currentTurnId = null
    state.currentTurnUserId = null
    state.error = null

    sent.reject(new Error('send failed late'))

    await expect(sendPromise).resolves.toBe(false)

    expect(state.activeThreadId).toBe('thr_other')
    expect(state.blocks).toEqual([{ kind: 'assistant', id: 'other-block', text: 'current session' }])
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.error).toBeNull()
    expect(provider.subscribeThreadEvents).not.toHaveBeenCalled()
  })

  it('sends only workspace-relative file references to the runtime provider', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        turnId: 'turn-files',
        userMessageItemId: 'runtime-user-files'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null
    const previewReferences: AgentRuntimeWorkspaceReference[] = [
      {
        workspaceRoot: '/workspace/sciforge',
        relativePath: 'docs',
        name: 'docs',
        kind: 'directory'
      },
      {
        workspaceRoot: '/workspace/sciforge',
        relativePath: 'docs/guide.md',
        name: 'guide.md',
        kind: 'text',
        mimeType: 'text/plain; charset=utf-8'
      }
    ]
    const composerReferences = previewReferences.map(composerReferenceFromWorkspaceReference)
    const rendererOnlyRootReference: AgentRuntimeFileReference & { workspaceRoot: string } = {
      path: '/workspace/sciforge/data/raw.pdf',
      relativePath: 'data/raw.pdf',
      name: 'raw.pdf',
      mimeType: 'application/pdf',
      modelRouterObject: true,
      workspaceRoot: '/workspace/sciforge'
    }

    await expect(actions.sendMessage('use these files', 'agent', {
      fileReferences: [
        ...composerReferences,
        rendererOnlyRootReference,
        {
          path: 'reports/clean.pdf',
          relativePath: '/workspace/sciforge/reports/clean.pdf',
          name: '',
          modelRouterObject: true
        },
        {
          path: '../escape.txt',
          relativePath: '../escape.txt',
          name: 'escape.txt'
        },
        {
          path: 'deepseek-file://open?path=/tmp/secret.txt',
          relativePath: '',
          name: 'secret.txt'
        }
      ]
    })).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'use these files',
      expect.objectContaining({
        fileReferences: [
          {
            path: 'docs',
            relativePath: 'docs',
            name: 'docs',
            kind: 'directory',
            delivery: 'inline_context'
          },
          {
            path: 'docs/guide.md',
            relativePath: 'docs/guide.md',
            name: 'guide.md',
            kind: 'text',
            mimeType: 'text/plain; charset=utf-8',
            delivery: 'inline_context'
          },
          {
            path: 'data/raw.pdf',
            relativePath: 'data/raw.pdf',
            name: 'raw.pdf',
            mimeType: 'application/pdf',
            modelRouterObject: true,
            delivery: 'model_router_object'
          },
          {
            path: 'reports/clean.pdf',
            relativePath: 'reports/clean.pdf',
            name: 'clean.pdf',
            modelRouterObject: true,
            delivery: 'model_router_object'
          }
        ]
      })
    )
  })

  it('mirrors desktop Code route messages when the active thread is bound to an IM channel', async () => {
    const { actions, state } = buildHarness()
    const mirrorRemoteChannelMessage = vi.fn(async () => ({ ok: true as const }))
    vi.stubGlobal('window', {
      sciforge: {
        logError: vi.fn(async () => undefined),
        mirrorRemoteChannelMessage
      },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        turnId: 'turn-1',
        userMessageItemId: 'runtime-user-1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.route = 'chat'
    state.threads = [{
      ...thread('thr_existing'),
      runtimeId: 'codex' as const,
      title: 'Desktop work'
    }]
    state.remoteChannels = [{
      id: 'channel-1',
      enabled: true,
      provider: 'weixin',
      label: 'WeChat',
      model: 'auto',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'thr_existing' },
      workspaceRoot: '',
      conversations: [],
      agentProfile: {
        name: 'sciforge',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:00:00.000Z'
    }]

    await expect(actions.sendMessage('hello from desktop')).resolves.toBe(true)

    expect(mirrorRemoteChannelMessage).toHaveBeenCalledWith(
      'thr_existing',
      'hello from desktop',
      'user'
    )
    expect(takePendingRemoteChannelMirror('turn-1')).toEqual({
      threadId: 'thr_existing',
      userBlockId: 'runtime-user-1',
      userText: 'hello from desktop'
    })
  })
})

describe('remote-channel active thread context publishing', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      sciforge: {
        updateRemoteChannelActiveThreadContext: vi.fn(async () => undefined)
      }
    })
  })

  it('publishes the active desktop thread context for IM auto-attach', () => {
    const state = {
      activeThreadId: 'desktop-thread',
      workspaceRoot: '/workspace/fallback',
      threads: [{
        ...thread('desktop-thread'),
        runtimeId: 'codex' as const,
        workspace: '/workspace/desktop'
      }],
      remoteChannels: []
    } as unknown as ChatState

    publishRemoteChannelActiveThreadContext(state, 'desktop-thread')

    expect(window.sciforge.updateRemoteChannelActiveThreadContext).toHaveBeenCalledWith({
      threadId: 'desktop-thread',
      runtimeId: 'codex',
      workspaceRoot: '/workspace/desktop'
    })
  })

  it('clears the active context instead of publishing a remote-channel-managed thread', () => {
    const state = {
      activeThreadId: 'claw-thread',
      workspaceRoot: '/workspace/fallback',
      threads: [{
        ...thread('claw-thread'),
        title: '[Remote channel:WeChat] Alice',
        workspace: '/workspace/claw'
      }],
      remoteChannels: [{
        id: 'channel-1',
        enabled: true,
        provider: 'weixin',
        label: 'WeChat',
        threadId: 'claw-thread',
        agentThreadIds: { sciforge: 'claw-thread' },
        conversations: [],
        model: 'auto',
        workspaceRoot: '',
        agentProfile: {
          name: 'sciforge',
          description: '',
          identity: '',
          personality: '',
          userContext: '',
          replyRules: ''
        },
        createdAt: '2026-06-09T00:00:00.000Z',
        updatedAt: '2026-06-09T00:00:00.000Z'
      }]
    } as unknown as ChatState

    publishRemoteChannelActiveThreadContext(state, 'claw-thread')

    expect(window.sciforge.updateRemoteChannelActiveThreadContext).toHaveBeenCalledWith(null)
  })
})
