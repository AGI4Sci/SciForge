import { beforeEach, describe, expect, it, vi } from 'vitest'

const admissionMock = vi.hoisted(() => ({
  completeInputRecovery: vi.fn(async () => undefined), acceptQueuedInput: vi.fn(), abandonQueuedInput: vi.fn(), readQueuedInputs: vi.fn(), trySessionDecision: vi.fn(), auxiliary: vi.fn()
}))
vi.mock('../agent/agent-runtime-client', () => ({ agentRuntimeClient: admissionMock }))
import type {
  AgentRuntimeFileReference,
  AgentRuntimeWorkspaceReference
} from '@shared/agent-runtime-contract'
import { defaultCodexRuntimeSettings, defaultSkillsSettings } from '@shared/app-settings'
import type { ChatBlock, NormalizedThread, ThreadEventSink } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, GuiPlanMessageContext } from './chat-store-types'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))
const runtimeClientMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn()
}))
const rightPanelLifecycleMock = vi.hoisted(() => ({
  rekeySessionRightPanelWorkspace: vi.fn()
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
vi.mock('../lib/session-right-panel-lifecycle', () => ({
  rekeySessionRightPanelWorkspace: rightPanelLifecycleMock.rekeySessionRightPanelWorkspace
}))

import { createThreadActions } from './chat-store-thread-actions'
import i18n from '../i18n'
import { composerReferenceFromWorkspaceReference } from '../lib/workspace-reference-composer'
import { composerReasoningDiscoveryKey } from '../lib/composer-reasoning-discovery'
import { guiPlanSession, useGuiPlanStore } from '../plan/plan-store'

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
  sseAbortRef: { current: AbortController | null }
} {
  let state: ChatState
  state = {
    activeThreadId: 'thr_existing',
    activeAgentRuntime: 'codex',
    blocks: [],
    busy: true,
    activeThreadContextState: null,
    codeWorkspaceRoots: [],
    composerModel: '',
    currentTurnId: null,
    currentTurnUserId: null,
    error: 'previous error',
    lastSeq: 0,
    liveAssistant: '',
    liveReasoning: '',
    queuedMessages: [],
    rekeySessionSideConversations: vi.fn(),
    recoverActiveTurn: vi.fn(async () => true),
    refreshThreads: vi.fn(async () => undefined),
    refreshComposerReasoningDiscovery: vi.fn(async () => undefined),
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
  const sseAbortRef: { current: AbortController | null } = { current: null }
  const actions = createThreadActions({
    set,
    get,
    sseAbortRef
  })
  state.sendMessage = actions.sendMessage
  state.drainQueuedMessages = actions.drainQueuedMessages
  return { actions, state, sseAbortRef }
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

function mockHistoricalInput(receipt: Record<string, unknown>, payload: Record<string, unknown>): void {
  const { clientDirectiveId, delivery, turnId, ...admission } = receipt
  admissionMock.auxiliary.mockResolvedValue({ runtimeId: 'codex', threadId: 'thr_existing',
    directives: [{ id: clientDirectiveId, text: payload.text, acceptedAt: '2026-10-20T01:00:00.000Z',
      delivery, ...(turnId ? { turnId } : {}), admission, queuePayload: payload }] })
}

describe('chat-store-thread-actions queued messages', () => {
  it('keeps an explicit API level through canonical queue admission when the runtime lists the alias', async () => {
    const { actions, state } = buildHarness()
    registryMock.getProvider.mockReturnValue({ sendUserMessage: vi.fn(), createThread: vi.fn() })
    state.modelAccessMode = 'api'
    state.composerModel = 'sciforge-router'
    state.composerReasoningEffort = 'high'
    state.composerModelCatalog = {
      available: true, complete: true, defaultModelId: 'sciforge-router',
      models: [{ id: 'sciforge-router', displayName: 'Router', isDefault: true,
        inputModalities: ['text'], reasoningEfforts: [], serviceTiers: [] }]
    }
    state.conversationSettingsByThread = {
      thr_existing: { model: 'sciforge-router', reasoningEffort: 'high', serviceTier: '' }
    }
    await expect(actions.sendMessage('keep the explicit provider level')).resolves.toBe(true)
    expect(state.queuedMessages[0]?.reasoningEffort).toBe('high')
  })

  beforeEach(() => {
    const inputs = new Map<string, { receipt: Record<string, unknown>; payload: Record<string, unknown> }>()
    admissionMock.acceptQueuedInput.mockReset().mockImplementation(async (input) => {
      const receipt = { clientDirectiveId: input.clientDirectiveId, revision: (input.expectedRevision ?? 0) + 1,
        payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'accepted', execution: 'not_started' }
      inputs.set(input.clientDirectiveId, { receipt, payload: input.payload })
      return receipt
    })
    admissionMock.abandonQueuedInput.mockReset().mockImplementation(async (input) => { inputs.delete(input.clientDirectiveId) })
    admissionMock.readQueuedInputs.mockReset().mockImplementation(async () => [...inputs.values()])
    admissionMock.trySessionDecision.mockReset().mockResolvedValue({ handled: false })
    admissionMock.auxiliary.mockReset().mockResolvedValue(null)

    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
    runtimeClientMock.getSettings.mockReset()
    runtimeClientMock.setSettings.mockReset()
    rightPanelLifecycleMock.rekeySessionRightPanelWorkspace.mockReset()
    runtimeClientMock.getSettings.mockResolvedValue({
      codePromptPrefix: '',
      workspaceRoot: '/workspace/sciforge',
      skills: defaultSkillsSettings()
    })
    runtimeClientMock.setSettings.mockImplementation(async (patch: { workspaceRoot?: string }) => ({
      codePromptPrefix: '',
      workspaceRoot: patch.workspaceRoot ?? '/workspace/sciforge',
      skills: defaultSkillsSettings()
    }))
    useGuiPlanStore.getState().clearAllSessions()
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

  it('acknowledges queued input only after durable Host acceptance', async () => {
    const { actions, state } = buildHarness()
    const pending = deferred<unknown>()
    admissionMock.acceptQueuedInput.mockReturnValueOnce(pending.promise)
    const send = actions.sendMessage('must persist first')
    await vi.waitFor(() => expect(admissionMock.acceptQueuedInput).toHaveBeenCalled())
    expect(state.queuedMessages).toEqual([])
    pending.reject(new Error('submission_locked'))
    expect(await send).toBe(false)
    expect(state.queuedMessages).toEqual([])
    expect(state.error).toContain('submission_locked')
  })

  it('retains ordering when new input arrives behind an unresolved failed receipt', async () => {
    const { actions, state } = buildHarness()
    state.busy = false
    state.queuedMessages = [{ id: 'failed', text: 'earlier', threadId: 'thr_existing',
      sendFailure: { userBlockId: 'failed', message: 'unknown' } }]
    const provider = { sendUserMessage: vi.fn() }
    registryMock.getProvider.mockReturnValue(provider)
    expect(await actions.sendMessage('later')).toBe(true)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages.map((message) => message.text)).toEqual(['earlier', 'later'])
  })

  it('consumes a trusted Session decision without enqueueing or dispatching it', async () => {
    const { actions, state } = buildHarness()
    const provider = { sendUserMessage: vi.fn() }
    registryMock.getProvider.mockReturnValue(provider)
    admissionMock.trySessionDecision.mockResolvedValue({ handled: true, actionId: 'human-action' })
    expect(await actions.sendMessage('confirm this exact candidate')).toBe(true)
    expect(state.queuedMessages).toEqual([])
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(admissionMock.acceptQueuedInput).not.toHaveBeenCalled()
  })

  it('never falls through to Agent input when a Session decision has an unknown outcome', async () => {
    const { actions, state } = buildHarness()
    admissionMock.trySessionDecision.mockRejectedValue(new Error('decision outcome unknown'))
    expect(await actions.sendMessage('confirm')).toBe(false)
    expect(admissionMock.acceptQueuedInput).not.toHaveBeenCalled()
    expect(state.error).toContain('unknown')
  })

  it('retains queued input when Host rejects abandonment of an active receipt', async () => {
    const { actions, state } = buildHarness()
    await actions.sendMessage('important input')
    admissionMock.abandonQueuedInput.mockRejectedValue(new Error('input_immutable'))
    await actions.removeQueuedMessage(state.queuedMessages[0].id)
    expect(state.queuedMessages).toHaveLength(1)
    expect(state.error).toContain('input_immutable')
  })

  it('clears every queued message with force abandonment and reports the summary', async () => {
    const { actions, state } = buildHarness()
    await actions.sendMessage('first input')
    await actions.sendMessage('second input')
    expect(state.queuedMessages).toHaveLength(2)
    const summary = await actions.clearQueuedMessages()
    expect(summary).toEqual({ cleared: 2, failed: 0 })
    expect(state.queuedMessages).toEqual([])
    expect(state.error).toBeNull()
    expect(admissionMock.abandonQueuedInput).toHaveBeenCalledTimes(2)
    for (const call of admissionMock.abandonQueuedInput.mock.calls) {
      expect(call[0]).toMatchObject({ force: true })
    }
  })

  it('keeps entries that fail to clear and still removes the rest', async () => {
    const { actions, state } = buildHarness()
    await actions.sendMessage('removable input')
    await actions.sendMessage('stuck input')
    const stuckId = state.queuedMessages[1].id
    admissionMock.abandonQueuedInput.mockImplementation(async (input) => {
      if (input.clientDirectiveId === stuckId) throw new Error('input_immutable')
    })
    const summary = await actions.clearQueuedMessages()
    expect(summary).toEqual({ cleared: 1, failed: 1 })
    expect(state.queuedMessages.map((message) => message.id)).toEqual([stuckId])
    expect(state.error).toContain('Cleared 1')
    expect(state.error).toContain('1 could not be removed')
  })

  it('prepends the previous server history page without rereading the full thread', async () => {
    const { actions, state } = buildHarness()
    const getThreadPage = vi.fn(async () => ({
      blocks: [
        { kind: 'user', id: 'user-old', text: 'older question' },
        { kind: 'assistant', id: 'assistant-current', text: 'duplicate current answer' }
      ] as ChatBlock[],
      latestSeq: 12,
      nextCursor: 'cursor-before-old'
    }))
    const provider = {
      getThreadPage,
      getRecentThreadView: vi.fn(async () => {
        throw new Error('pagination must not read a full thread snapshot')
      }),
      rememberThreadRuntime: vi.fn()
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.activeThreadId = 'thr_existing'
    state.threads = [{ ...thread('thr_existing'), runtimeId: 'codex' }]
    state.blocks = [
      { kind: 'assistant', id: 'assistant-current', text: 'current answer' }
    ]
    state.threadHistoryCursor = 'cursor-before-current'
    state.threadHistoryLoading = false

    await actions.loadEarlierThreadHistory()

    expect(getThreadPage).toHaveBeenCalledWith('thr_existing', 'cursor-before-current')
    expect(provider.getRecentThreadView).not.toHaveBeenCalled()
    expect(state.blocks).toEqual([
      { kind: 'user', id: 'user-old', text: 'older question' },
      { kind: 'assistant', id: 'assistant-current', text: 'current answer' }
    ])
    expect(state.threadHistoryCursor).toBe('cursor-before-old')
    expect(state.threadHistoryLoading).toBe(false)
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

  it('preserves directory and ordinary-file references while a running turn queues them', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn-references',
        userMessageItemId: 'runtime-user-references'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.activeAgentRuntime = 'codex'
    state.busy = true
    state.currentTurnId = 'turn-running'
    state.threads = [{ ...thread('thr_existing'), runtimeId: 'codex' }]
    const rendererReferences = [
      {
        path: '/workspace/sciforge/docs',
        relativePath: 'docs',
        name: 'docs',
        kind: 'directory' as const,
        workspaceRoot: '/workspace/sciforge'
      },
      {
        path: '/workspace/sciforge/docs/guide.md',
        relativePath: 'docs/guide.md',
        name: 'guide.md',
        kind: 'text' as const,
        mimeType: 'text/markdown',
        workspaceRoot: '/workspace/sciforge'
      }
    ]

    await expect(actions.sendMessage('Use the queued references.', 'agent', {
      fileReferences: rendererReferences
    })).resolves.toBe(true)

    const expectedReferences = [
      {
        path: 'docs',
        relativePath: 'docs',
        name: 'docs',
        kind: 'directory'
      },
      {
        path: 'docs/guide.md',
        relativePath: 'docs/guide.md',
        name: 'guide.md',
        kind: 'text',
        mimeType: 'text/markdown'
      }
    ]
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        text: 'Use the queued references.',
        fileReferences: expectedReferences
      })
    ])

    state.busy = false
    state.currentTurnId = null
    await actions.drainQueuedMessages()

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'Use the queued references.',
      expect.objectContaining({ fileReferences: expectedReferences })
    )
    expect(state.queuedMessages).toEqual([])
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
    expect(state.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'user', text: 'use the current output', turnId: 'turn-running' })
    ]))
    expect(state.error).toBeNull()
  })

  it('reports a rejected explicit steer without queue fallback', async () => {
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

    await expect(actions.sendMessage('/steer continue safely')).resolves.toBe(false)
    expect(state.queuedMessages).toEqual([])
    expect(admissionMock.acceptQueuedInput).not.toHaveBeenCalled()
    expect(state.error).toBeTruthy()
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

    state.queuedMessages[0].admissionReceipt = { clientDirectiveId: 'q-1', revision: 2, payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'accepted', execution: 'not_started' }
    await expect(actions.steerQueuedMessage('q-1')).resolves.toBe(true)

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('thr_existing', 'codex')
    expect(provider.steerUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'turn-running',
      'steer this queued follow-up',
      { clientDirectiveId: 'q-1', inputRevision: 2 }
    )
    expect(state.queuedMessages).toEqual([])
    expect(state.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'user', id: 'q-1', text: 'steer this queued follow-up', turnId: 'turn-running' })
    ]))
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

  it('freezes runtime-discovered Codex defaults when a new draft is created', async () => {
    const { actions, state } = buildHarness()
    registryMock.getProvider.mockReturnValue({ createThread: vi.fn() })
    runtimeClientMock.getSettings.mockResolvedValueOnce({
      activeAgentRuntime: 'codex',
      agents: {
        codex: {
          ...defaultCodexRuntimeSettings(),
          model: 'runtime-default-model',
          reasoningEffort: 'ultra',
          serviceTier: 'priority'
        }
      },
      codePromptPrefix: '',
      workspaceRoot: '/workspace/sciforge',
      skills: defaultSkillsSettings()
    })
    state.activeAgentRuntime = 'codex'
    state.busy = false
    state.blocks = []

    await actions.createThread({ workspaceRoot: '/workspace/sciforge', forceNew: true })

    expect(state.activeThreadId).toBeNull()
    expect(state.composerModel).toBe('runtime-default-model')
    expect(state.composerReasoningEffort).toBe('ultra')
    expect(state.composerServiceTier).toBe('priority')
    expect(state.draftConversationSettings).toEqual({
      model: 'runtime-default-model',
      reasoningEffort: 'ultra',
      serviceTier: 'priority'
    })
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
      skills: defaultSkillsSettings()
    })
    runtimeClientMock.setSettings.mockResolvedValueOnce({
      codePromptPrefix: '',
      workspaceRoot: '/workspace/project-b',
      skills: defaultSkillsSettings()
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
      skills: defaultSkillsSettings()
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
      skills: defaultSkillsSettings()
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
      skills: defaultSkillsSettings()
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

  it('restores frozen conversation settings when selecting a thread', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getRecentThreadView: vi.fn(async () => ({
        blocks: [], latestSeq: 0, threadStatus: 'idle', nextCursor: null
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      rememberThreadRuntime: vi.fn()
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.threads = [thread('thr_existing'), thread('thr_other')]
    state.conversationSettingsByThread = {
      thr_other: { model: '', reasoningEffort: 'ultra', serviceTier: 'priority' }
    }
    state.composerModel = 'changed-global-model'
    state.composerReasoningEffort = 'low'
    state.composerServiceTier = 'default'

    await actions.selectThread('thr_other')

    expect(state.composerModel).toBe('')
    expect(state.composerReasoningEffort).toBe('ultra')
    expect(state.composerServiceTier).toBe('priority')
  })

  it('resets a saved effort the current model does not declare once, then sends without an effort', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getRecentThreadView: vi.fn(async () => ({
        blocks: [], latestSeq: 0, threadStatus: 'idle', nextCursor: null
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      rememberThreadRuntime: vi.fn(),
      sendUserMessage: vi.fn(),
      createThread: vi.fn()
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.threads = [thread('thr_existing'), thread('thr_other')]
    const entry = {
      id: 'sciforge-router', upstreamModel: 'deepseek-v4-flash-0731', displayName: 'DeepSeek',
      protocol: 'chat-completions', endpoint: 'https://provider.invalid',
      reasoning: { levels: [], defaultLevel: null }
    }
    state.modelAccessMode = 'api'
    state.composerModelGroups = [{
      providerId: 'model-router', label: 'Model Router', modelIds: [entry.id], models: [entry]
    }]
    state.composerReasoningDiscovery = {
      key: composerReasoningDiscoveryKey(entry), status: 'ready', message: null,
      outcome: {
        state: 'known', levels: ['high', 'max'], completeness: 'complete', defaultLevel: null,
        source: 'vocabulary', verifiedAt: null, checkedAt: '2026-10-27T12:00:00Z', attachEffort: true
      }
    }
    state.composerModelCatalog = {
      available: true, complete: true, defaultModelId: 'published-model',
      models: [{ id: 'published-model', displayName: 'Published model', isDefault: true,
        inputModalities: ['text'], reasoningEfforts: [], serviceTiers: [] }]
    }
    state.conversationSettingsByThread = {
      thr_other: { model: '', reasoningEffort: 'medium', serviceTier: '' }
    }

    await actions.selectThread('thr_other')

    expect(state.composerReasoningEffort).toBe('')
    expect(state.conversationSettingsByThread.thr_other).toEqual({
      model: '', reasoningEffort: '', serviceTier: ''
    })
    expect(state.composerReasoningEffortReset).toEqual({ from: 'medium', to: '' })
    expect(state.error).toBeNull()

    await actions.selectThread('thr_existing')
    await actions.selectThread('thr_other')
    expect(state.composerReasoningEffortReset).toBeNull()

    state.busy = true
    await expect(actions.sendMessage('send after reset')).resolves.toBe(true)
    expect(state.error).toBeNull()
    expect(state.queuedMessages).toHaveLength(1)
    expect(state.queuedMessages[0]?.reasoningEffort).toBeUndefined()
  })

  it('persists a reset of the Codex default effort when a new draft is created', async () => {
    const { actions, state } = buildHarness()
    registryMock.getProvider.mockReturnValue({ createThread: vi.fn() })
    runtimeClientMock.setSettings.mockReset().mockResolvedValue({})
    runtimeClientMock.getSettings.mockResolvedValueOnce({
      activeAgentRuntime: 'codex',
      agents: { codex: { ...defaultCodexRuntimeSettings(), model: '', reasoningEffort: 'medium' } },
      codePromptPrefix: '',
      workspaceRoot: '/workspace/sciforge',
      skills: defaultSkillsSettings()
    })
    state.busy = false
    state.composerModelCatalog = {
      available: true, complete: true, defaultModelId: 'published-model',
      models: [{ id: 'published-model', displayName: 'Published model', isDefault: true,
        inputModalities: ['text'], reasoningEfforts: [], serviceTiers: [] }]
    }

    await actions.createThread({ workspaceRoot: '/workspace/sciforge', forceNew: true })

    expect(state.composerReasoningEffort).toBe('')
    expect(state.draftConversationSettings).toEqual({ model: '', reasoningEffort: '', serviceTier: '' })
    expect(state.composerReasoningEffortReset).toEqual({ from: 'medium', to: '' })
    expect(runtimeClientMock.setSettings).toHaveBeenCalledWith({
      agents: { codex: { reasoningEffort: '' } }
    })
  })

  it('freezes an existing untracked thread without replacing an empty runtime model', async () => {
    const { actions, state } = buildHarness()
    registryMock.getProvider.mockReturnValue({
      getRecentThreadView: vi.fn(async () => ({
        blocks: [], latestSeq: 0, threadStatus: 'idle', nextCursor: null
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      rememberThreadRuntime: vi.fn()
    })
    state.busy = false
    state.threads = [{ ...thread('thr_profile_fallback'), model: '' }]
    state.conversationSettingsByThread = {}
    state.composerModel = 'stale-other-thread-model'
    state.composerReasoningEffort = 'balanced'
    state.composerServiceTier = 'default'

    await actions.selectThread('thr_profile_fallback')

    expect(state.conversationSettingsByThread.thr_profile_fallback).toEqual({
      model: '', reasoningEffort: 'balanced', serviceTier: 'default'
    })
    expect(state.composerModel).toBe('')
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
      skills: defaultSkillsSettings()
    })
    state.activeThreadId = null
    state.workspaceRoot = '/workspace/draft'
    state.codeWorkspaceRoots = ['/workspace/draft', '/workspace/stale-settings']
    state.busy = false
    state.blocks = []
    state.composerModel = ''
    state.composerReasoningEffort = 'ultra'
    state.composerServiceTier = 'priority'
    state.composerModelCatalog = {
      available: true,
      complete: true,
      defaultModelId: 'runtime-default',
      models: [{
        id: 'runtime-default',
        displayName: 'Runtime Default',
        isDefault: true,
        inputModalities: ['text'],
        reasoningEfforts: [{ id: 'ultra', isDefault: true }],
        serviceTiers: [{ id: 'priority', displayName: 'Fast', isDefault: false }]
      }]
    }
    state.draftConversationSettings = {
      model: '', reasoningEffort: 'ultra', serviceTier: 'priority'
    }
    state.conversationSettingsByThread = {}

    await expect(actions.sendMessage('hello from draft')).resolves.toBe(true)

    expect(provider.createThread).toHaveBeenCalledWith({
      workspace: '/workspace/draft',
      title: 'hello from draft',
      mode: 'agent',
      reasoningEffort: 'ultra',
      serviceTier: 'priority'
    })
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_created_in_draft_workspace',
      'hello from draft',
      expect.objectContaining({
        workspace: '/workspace/draft',
        title: 'hello from draft',
        displayText: 'hello from draft',
        reasoningEffort: 'ultra',
        serviceTier: 'priority'
      })
    )
    expect(state.activeThreadId).toBe('thr_created_in_draft_workspace')
    expect(state.conversationSettingsByThread.thr_created_in_draft_workspace).toEqual({
      model: '', reasoningEffort: 'ultra', serviceTier: 'priority'
    })
    expect(state.draftConversationSettings).toBeNull()
    expect(rightPanelLifecycleMock.rekeySessionRightPanelWorkspace).toHaveBeenCalledWith(
      'right-panel-draft:%2Fworkspace%2Fdraft',
      'thr_created_in_draft_workspace'
    )
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

  it('uses the attached workspace locator for remote thread creation and turn delivery', async () => {
    const { actions, state } = buildHarness()
    const workspaceLocator = {
      contractVersion: 1 as const,
      hostSessionId: 'workspace-session-1',
      path: '/shared/remote-project'
    }
    const createdThread = {
      ...thread('thr_remote'),
      title: 'inspect remote data',
      workspace: workspaceLocator.path,
      workspaceLocator,
      status: 'idle'
    }
    const provider = {
      createThread: vi.fn(async () => createdThread),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_remote',
        turnId: 'turn-remote',
        userMessageItemId: 'runtime-user-remote'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.activeThreadId = null
    state.workspaceLocator = workspaceLocator
    state.workspaceRoot = '/workspace/local-project'
    state.busy = false
    state.blocks = []

    await expect(actions.sendMessage('inspect remote data', 'agent', {
      workspaceLocator
    })).resolves.toBe(true)

    expect(provider.createThread).toHaveBeenCalledWith({
      workspace: workspaceLocator.path,
      workspaceLocator,
      title: 'inspect remote data',
      mode: 'agent'
    })
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_remote',
      'inspect remote data',
      expect.objectContaining({
        workspace: workspaceLocator.path,
        workspaceLocator,
        displayText: 'inspect remote data'
      })
    )
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

  it('preserves legacy queued GUI plans for explicit disposition', async () => {
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

    expect(state.queuedMessages).toHaveLength(2)
    expect(sendMessage).not.toHaveBeenCalled()
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
      runtimeId: 'codex'
    }]

    await actions.drainQueuedMessages()

    expect(state.queuedMessages).toEqual([
      expect.objectContaining({ id: 'q-stale', threadId: 'thr_existing' })
    ])
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('edits queued message content without dropping its routing metadata', async () => {
    const { actions, state } = buildHarness()
    state.queuedMessages = [{
      id: 'q-edit',
      threadId: 'thr_existing',
      runtimeId: 'codex',
      text: 'old payload',
      displayText: 'old display',
      mode: 'agent'
    }]

    state.queuedMessages[0].admissionReceipt = { clientDirectiveId: 'q-edit', revision: 1, payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'accepted', execution: 'not_started' }
    expect(await actions.updateQueuedMessage('q-edit', '  revised follow-up  ')).toBe(true)
    expect(state.queuedMessages).toEqual([{
      id: 'q-edit',
      threadId: 'thr_existing',
      runtimeId: 'codex',
      admissionReceipt: expect.objectContaining({ revision: 2 }),
      text: 'revised follow-up',
      displayText: 'revised follow-up',
      mode: 'agent'
    }])
    expect(await actions.updateQueuedMessage('q-edit', '   ')).toBe(false)
    expect(await actions.updateQueuedMessage('missing', 'text')).toBe(false)
  })

  it('keeps attempted payload identity immutable after delivery becomes uncertain', async () => {
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

    expect(await actions.updateQueuedMessage('q-uncertain', 'different instruction')).toBe(false)
    expect(state.queuedMessages[0]).toEqual(expect.objectContaining({
      text: 'original scientific instruction',
      deliveryAttempt: expect.objectContaining({ attemptedText: 'original scientific instruction' })
    }))
  })

  it('drains a completed background thread without mutating the active thread UI', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getRecentThreadView: vi.fn(async () => ({
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
    state.activeAgentRuntime = 'codex'
    state.blocks = [{ kind: 'assistant', id: 'b-block', text: 'active B content' }]
    state.busy = true
    state.currentTurnId = 'turn-b'
    state.threads = [
      { ...thread('thread-a'), runtimeId: 'codex', workspace: '/workspace/a' },
      { ...thread('thread-b'), runtimeId: 'codex', workspace: '/workspace/b' }
    ]
    state.queuedMessages = [{
      id: 'q-a',
      threadId: 'thread-a',
      runtimeId: 'codex',
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

    admissionMock.readQueuedInputs.mockResolvedValue(state.queuedMessages.map((message) => ({ payload: message,
      receipt: { clientDirectiveId: message.id, revision: 1, payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'accepted', execution: 'not_started' } })))
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
      { ...thread('thread-a'), runtimeId: 'dsh' },
      { ...thread('thread-b'), runtimeId: 'codex' }
    ]
    state.queuedMessages = [{
      id: 'q-a',
      threadId: 'thread-a',
      runtimeId: 'dsh',
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
      getRecentThreadView: vi.fn(async () => ({ blocks: [], latestSeq: 1, threadStatus: 'running' })),
      rememberThreadRuntime: vi.fn(),
      sendUserMessage: vi.fn(() => turn.promise)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.activeThreadId = 'thread-b'
    state.activeAgentRuntime = 'codex'
    state.threads = [
      { ...thread('thread-a'), runtimeId: 'codex' },
      { ...thread('thread-b'), runtimeId: 'codex' }
    ]
    state.queuedMessages = [{
      id: 'q-a',
      threadId: 'thread-a',
      runtimeId: 'codex',
      text: 'send exactly once'
    }]

    admissionMock.readQueuedInputs.mockResolvedValue(state.queuedMessages.map((message) => ({ payload: message,
      receipt: { clientDirectiveId: message.id, revision: 1, payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'accepted', execution: 'not_started' } })))
    const firstDrain = actions.drainQueuedMessagesForThread('thread-a')
    await vi.waitFor(() => expect(provider.sendUserMessage).toHaveBeenCalledTimes(1))
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
      getRecentThreadView: vi.fn(async () => ({
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
      throw new Error('getRecentThreadView promise was not created')
    }
    const provider = {
      getRecentThreadView: vi.fn(() => new Promise((resolve) => {
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
      getRecentThreadView: vi.fn((threadId: string) => new Promise((resolve) => {
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

  it('does not activate owner plan state from thread metadata during thread selection', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getRecentThreadView: vi.fn(async () => ({
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

    expect(provider.getRecentThreadView).toHaveBeenCalledWith('thr_existing')
    expect(guiPlanSession(useGuiPlanStore.getState(), 'thr_existing').activePlan).toBeNull()
  })

  it('does not let stale turn recovery restore a thread after the user switches away', async () => {
    const { actions, state } = buildHarness()
    let resolveDetail: (value: {
      blocks: []
      latestSeq: number
      threadStatus: string
    }) => void = () => {
      throw new Error('getRecentThreadView promise was not created')
    }
    const provider = {
      getRecentThreadView: vi.fn(() => new Promise((resolve) => {
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
      getRecentThreadView: vi.fn(async () => ({
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
      getRecentThreadView: vi.fn(async () => ({
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
      getRecentThreadView: vi.fn(async () => ({
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

  it('does not resend legacy failed input merely because the transcript is empty', async () => {
    const { actions, state } = buildHarness()
    state.busy = false
    state.queuedMessages = [{ id: 'old', text: 'run once', threadId: 'thr_existing',
      sendFailure: { userBlockId: 'old', message: 'unknown' } }]
    const provider = { getRecentThreadView: vi.fn(async () => ({ blocks: [] })), sendUserMessage: vi.fn() }
    registryMock.getProvider.mockReturnValue(provider)
    expect(await actions.retryQueuedMessage('old')).toBe(false)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(provider.getRecentThreadView).not.toHaveBeenCalled()
    expect(state.queuedMessages).toHaveLength(1)
  })

  it('blocks uncertain receipt replay regardless of later transcript content', async () => {
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn()
    admissionMock.readQueuedInputs.mockResolvedValue([{ payload: { id: 'unknown', text: 'run once' }, receipt: {
      clientDirectiveId: 'unknown', revision: 3, payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'uncertain', execution: 'not_started'
    } }])
    expect(await actions.retryQueuedMessage('unknown')).toBe(false)
    expect(state.sendMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages[0].sendFailure).toBeDefined()
  })

  it('uses the durable original payload and revision when explicitly retrying known-unsent input', async () => {
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn(async () => true)
    admissionMock.readQueuedInputs.mockResolvedValue([{ payload: { id: 'known', text: 'durable text', attachmentIds: ['file-1'] }, receipt: {
      clientDirectiveId: 'known', revision: 4, payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'accepted', execution: 'not_started'
    } }])
    expect(await actions.retryQueuedMessage('known')).toBe(true)
    expect(state.sendMessage).toHaveBeenCalledWith('durable text', undefined, { queued: expect.objectContaining({
      attachmentIds: ['file-1'], admissionReceipt: expect.objectContaining({ revision: 4 })
    }) })
  })

  it('explicitly retries a rejected queue item with the exact stored body and revision', async () => {
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn(async () => true)
    const payload = { id: 'rejected', text: 'retry original', attachmentIds: ['precise-file'], model: 'frozen-model' }
    admissionMock.readQueuedInputs.mockResolvedValue([{ payload, receipt: {
      clientDirectiveId: 'rejected', revision: 8, payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'rejected', execution: 'failed'
    } }])
    expect(await actions.retryQueuedMessage('rejected')).toBe(true)
    expect(admissionMock.acceptQueuedInput).toHaveBeenCalledWith(expect.objectContaining({
      clientDirectiveId: 'rejected', expectedRevision: 8, payload
    }))
    expect(state.sendMessage).toHaveBeenCalledWith('retry original', undefined, { queued: expect.objectContaining({
      admissionReceipt: expect.objectContaining({ revision: 9 }), attachmentIds: ['precise-file']
    }) })
  })

  it('reexecutes a failed input absent from the queue using exact Host history without changing its original receipt', async () => {
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn(async () => true)
    const directive = {
      id: 'history-only-failed', text: '原始完整分析要求', acceptedAt: '2026-10-20T01:00:00.000Z',
      delivery: 'delivered', turnId: 'failed-turn',
      admission: { revision: 8, payloadDigest: 'a'.repeat(64), mode: 'queue', execution: 'failed' },
      queuePayload: { id: 'history-only-failed', text: '原始完整分析要求', displayText: '分析上传的数据', mode: 'agent',
        attachmentIds: ['original-file'], attachments: [{ id: 'original-file', name: 'samples.csv' }],
        fileReferences: [{ relativePath: 'data/samples.csv', workspaceRoot: '/workspace/sciforge' }],
        model: 'frozen-model', permissionLevel: 'full-access' }
    }
    const original = structuredClone(directive)
    admissionMock.readQueuedInputs.mockResolvedValue([])
    admissionMock.auxiliary.mockResolvedValue({ runtimeId: 'codex', threadId: 'thr_existing', directives: [directive] })
    expect(await actions.reexecuteFailedInput({ runtimeId: 'codex', threadId: 'thr_existing', clientDirectiveId: directive.id })).toBe(true)
    expect(admissionMock.auxiliary).toHaveBeenCalledWith({ runtimeId: 'codex', operation: 'getRuntimeContextLedger', payload: { threadId: 'thr_existing' } })
    const accepted = admissionMock.acceptQueuedInput.mock.calls[0]![0]
    expect(accepted.clientDirectiveId).not.toBe(directive.id)
    expect(accepted.expectedRevision).toBeUndefined()
    expect(accepted.text).toBe('分析上传的数据')
    expect(accepted.payload).toMatchObject({ ...original.queuePayload, id: accepted.clientDirectiveId })
    expect(state.sendMessage).toHaveBeenCalledWith('原始完整分析要求', 'agent', { queued: expect.objectContaining({
      id: accepted.clientDirectiveId, attachmentIds: ['original-file'], attachments: original.queuePayload.attachments,
      fileReferences: original.queuePayload.fileReferences,
      admissionReceipt: expect.objectContaining({ execution: 'not_started', delivery: 'accepted' })
    }) })
    expect(admissionMock.abandonQueuedInput).not.toHaveBeenCalled()
    expect(directive).toEqual(original)
  })

  it('localizes reexecution errors at action time for generic conversations', async () => {
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn(async () => false)
    const input = { runtimeId: 'codex' as const, threadId: 'thr_existing', clientDirectiveId: 'failed-source' }
    const messages = {
      en: [
        'Open the original conversation in its runtime before running this input again.',
        'Only a delivered input whose turn failed can be run again. Refresh the conversation to check its status.',
        'The new input was saved but has not been sent. Open the original conversation to continue.',
        'The input could not be run again. Refresh the conversation and try again; the original execution receipt will not be replayed.'
      ],
      zh: [
        '请先在原运行时打开原会话，再重新执行。',
        '只有已送达且本轮执行失败的输入可以重新执行，请刷新会话后查看。',
        '新输入已保存但尚未发送，请回到原会话查看并处理。',
        '重新执行未能完成，请刷新会话后重试；原始执行回执不会被重放。'
      ]
    }
    try {
      for (const language of ['en', 'zh'] as const) {
        await i18n.changeLanguage(language)
        state.activeAgentRuntime = 'claude'
        expect(await actions.reexecuteFailedInput(input)).toBe(false)
        expect(state.error).toBe(messages[language][0])
        state.activeAgentRuntime = 'codex'
        admissionMock.auxiliary.mockResolvedValue(null)
        expect(await actions.reexecuteFailedInput(input)).toBe(false)
        expect(state.error).toBe(messages[language][1])
        mockHistoricalInput({ clientDirectiveId: input.clientDirectiveId, revision: 3,
          payloadDigest: 'a'.repeat(64), mode: 'direct', delivery: 'delivered', execution: 'failed', turnId: 'old-turn' }, { text: 'original input' })
        expect(await actions.reexecuteFailedInput(input)).toBe(false)
        expect(state.error).toBe(messages[language][2])
        admissionMock.auxiliary.mockRejectedValueOnce(new Error('receipt unavailable'))
        expect(await actions.reexecuteFailedInput(input)).toBe(false)
        expect(state.error).toBe(messages[language][3])
      }
    } finally { await i18n.changeLanguage('en') }
    expect(admissionMock.abandonQueuedInput).not.toHaveBeenCalled()
  })

  it('reexecutes a delivered failed input as a fresh accepted directive through sendMessage', async () => {
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn(async () => true)
    const receipt = { clientDirectiveId: 'executed-failed', revision: 8, payloadDigest: 'a'.repeat(64),
      mode: 'direct', delivery: 'delivered', execution: 'failed', turnId: 'failed-turn' }
    mockHistoricalInput(receipt,
      { id: receipt.clientDirectiveId, text: '原始分析要求', attachmentIds: ['original-file'] })
    expect(await actions.reexecuteFailedInput({ runtimeId: 'codex', threadId: 'thr_existing', clientDirectiveId: receipt.clientDirectiveId })).toBe(true)
    const accepted = admissionMock.acceptQueuedInput.mock.calls[0]![0]
    expect(accepted.clientDirectiveId).not.toBe(receipt.clientDirectiveId)
    expect(accepted.expectedRevision).toBeUndefined()
    expect(accepted.text).toBe('原始分析要求')
    expect(admissionMock.abandonQueuedInput).not.toHaveBeenCalled()
    expect(state.sendMessage).toHaveBeenCalledWith('原始分析要求', undefined, { queued: expect.objectContaining({
      id: accepted.clientDirectiveId, attachmentIds: ['original-file'],
      admissionReceipt: expect.objectContaining({ execution: 'not_started', delivery: 'accepted' })
    }) })
  })

  it('reexecution reaches the existing provider send path with a new id and one new turn', async () => {
    const { actions, state } = buildHarness()
    state.busy = false
    const provider = { sendUserMessage: vi.fn(async (_threadId: string, _text: string, _options: Record<string, unknown>) => ({ threadId: 'thr_existing', turnId: 'fresh-turn', userMessageItemId: 'fresh-user' })),
      subscribeThreadEvents: vi.fn(async () => undefined), renameThread: vi.fn(async () => undefined) }
    registryMock.getProvider.mockReturnValue(provider)
    mockHistoricalInput({ clientDirectiveId: 'failed-source', revision: 3,
      payloadDigest: 'a'.repeat(64), mode: 'direct', delivery: 'delivered', execution: 'failed', turnId: 'old-turn' },
      { text: '原始输入' })
    expect(await actions.reexecuteFailedInput({ runtimeId: 'codex', threadId: 'thr_existing', clientDirectiveId: 'failed-source' })).toBe(true)
    expect(provider.sendUserMessage).toHaveBeenCalledTimes(1)
    const options = provider.sendUserMessage.mock.calls[0]![2]
    expect(options.clientDirectiveId).not.toBe('failed-source')
    expect(provider.sendUserMessage).toHaveBeenCalledWith('thr_existing', '原始输入', expect.objectContaining({
      clientDirectiveId: admissionMock.acceptQueuedInput.mock.calls[0]![0].clientDirectiveId, inputRevision: 1
    }))
    expect(state.currentTurnId).toBe('fresh-turn')
  })

  it('keeps original replay blocked and deduplicates concurrent reexecution clicks', async () => {
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn(async () => true)
    mockHistoricalInput({ clientDirectiveId: 'old', revision: 3,
      payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'delivered', execution: 'failed', turnId: 'old-turn' }, { text: '原文' })
    expect(await actions.retryQueuedMessage('old')).toBe(false)
    expect(state.sendMessage).not.toHaveBeenCalled()
    expect(state.error).toBeTruthy()
    expect(state.error).not.toBe('')
    const pending = deferred<import('@sciforge/domain-sdk/agent-execution').SessionInputReceipt>()
    admissionMock.acceptQueuedInput.mockReturnValueOnce(pending.promise)
    const input = { runtimeId: 'codex', threadId: 'thr_existing', clientDirectiveId: 'old' }
    const first = actions.reexecuteFailedInput(input)
    await vi.waitFor(() => expect(admissionMock.acceptQueuedInput).toHaveBeenCalledTimes(1))
    expect(await actions.reexecuteFailedInput(input)).toBe(false)
    pending.resolve({ clientDirectiveId: admissionMock.acceptQueuedInput.mock.calls[0]![0].clientDirectiveId,
      revision: 1, payloadDigest: 'b'.repeat(64), mode: 'queue', delivery: 'accepted', execution: 'not_started' })
    expect(await first).toBe(true)
    expect(state.sendMessage).toHaveBeenCalledTimes(1)
  })

  it.each(['uncertain', 'output_pending', 'active', 'completed', 'cancelled'])('does not reexecute an unresolved or nonfailed receipt (%s)', async (stateName) => {
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn()
    mockHistoricalInput({ clientDirectiveId: 'unsafe', revision: 8,
      payloadDigest: 'a'.repeat(64), mode: 'direct', delivery: stateName === 'uncertain' ? 'uncertain' : 'delivered',
      execution: stateName === 'uncertain' ? 'failed' : stateName }, { text: '原文' })
    expect(await actions.reexecuteFailedInput({ runtimeId: 'codex', threadId: 'thr_existing', clientDirectiveId: 'unsafe' })).toBe(false)
    expect(state.sendMessage).not.toHaveBeenCalled()
    expect(admissionMock.acceptQueuedInput).not.toHaveBeenCalled()
    expect(admissionMock.abandonQueuedInput).not.toHaveBeenCalled()
    expect(state.error).toBe(i18n.t('common:sessionInputReexecutionRequiresFailure'))
  })

  it('fails closed when durable receipt recovery is unavailable', async () => {
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn()
    admissionMock.readQueuedInputs.mockRejectedValue(new Error('ledger unavailable'))
    await actions.drainQueuedMessages()
    expect(state.sendMessage).not.toHaveBeenCalled()
    expect(state.error).toContain('ledger unavailable')
  })

  it('rehydrates a terminal output-pending input until the Host completed snapshot removes it from the queue', async () => {
    vi.useFakeTimers()
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn()
    admissionMock.readQueuedInputs.mockResolvedValueOnce([{ receipt: { clientDirectiveId: 'fresh-reexecution', revision: 1,
      payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'delivered', execution: 'output_pending', turnId: 'completed-turn' },
      payload: { text: '原文新输入' } }]).mockResolvedValue([])
    try {
      await actions.drainQueuedMessages()
      await vi.advanceTimersByTimeAsync(1000)
      expect(state.queuedMessages).toEqual([])
      expect(admissionMock.readQueuedInputs).toHaveBeenCalledTimes(2)
      expect(state.sendMessage).not.toHaveBeenCalled()
      expect(admissionMock.acceptQueuedInput).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('does not let an older output-pending hydration overwrite a newer empty Host queue snapshot', async () => {
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn()
    const older = deferred<unknown>()
    admissionMock.readQueuedInputs.mockReturnValueOnce(older.promise).mockResolvedValue([])
    const drain = actions.drainQueuedMessages()
    await vi.waitFor(() => expect(admissionMock.readQueuedInputs).toHaveBeenCalledTimes(1))
    expect(await actions.retryQueuedMessage('absent')).toBe(false)
    expect(admissionMock.readQueuedInputs).toHaveBeenCalledTimes(2)
    older.resolve([{ receipt: { clientDirectiveId: 'already-completed', revision: 1, payloadDigest: 'a'.repeat(64),
      mode: 'queue', delivery: 'delivered', execution: 'output_pending', turnId: 'completed-turn' }, payload: { text: '原文新输入' } }])
    await drain
    expect(state.queuedMessages).toEqual([])
    expect(state.sendMessage).not.toHaveBeenCalled()
  })

  it('eventually clears a slow Host output validation beyond the initial settlement backoff', async () => {
    vi.useFakeTimers()
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn()
    const pending = [{ receipt: { clientDirectiveId: 'slow-validation', revision: 1, payloadDigest: 'a'.repeat(64),
      mode: 'queue', delivery: 'delivered', execution: 'output_pending', turnId: 'completed-turn' }, payload: { text: '原文' } }]
    admissionMock.readQueuedInputs.mockResolvedValue(pending)
    try {
      await actions.drainQueuedMessages()
      await vi.advanceTimersByTimeAsync(2500)
      expect(state.queuedMessages.map((message) => message.id)).toEqual(['slow-validation'])
      expect(state.queuedMessages[0]?.sendFailure).toBeUndefined()
      admissionMock.readQueuedInputs.mockResolvedValue([])
      await vi.advanceTimersByTimeAsync(1000)
      expect(state.queuedMessages).toEqual([])
      const reads = admissionMock.readQueuedInputs.mock.calls.length
      await vi.advanceTimersByTimeAsync(5000)
      expect(admissionMock.readQueuedInputs).toHaveBeenCalledTimes(reads)
      expect(state.sendMessage).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it.each(['leave', 'busy', 'disconnect'])('stops output validation polling when the exact idle Session lifecycle ends (%s)', async (change) => {
    vi.useFakeTimers()
    const { actions, state } = buildHarness()
    state.busy = false
    state.sendMessage = vi.fn()
    admissionMock.readQueuedInputs.mockResolvedValue([{ receipt: { clientDirectiveId: 'pending', revision: 1,
      payloadDigest: 'a'.repeat(64), mode: 'queue', delivery: 'delivered', execution: 'output_pending', turnId: 'turn' },
      payload: { text: '原文' } }])
    try {
      await actions.drainQueuedMessages()
      if (change === 'leave') state.activeThreadId = 'another-thread'
      if (change === 'busy') state.busy = true
      if (change === 'disconnect') state.runtimeConnection = 'offline'
      await vi.advanceTimersByTimeAsync(5000)
      expect(admissionMock.readQueuedInputs).toHaveBeenCalledTimes(1)
      expect(state.sendMessage).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
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
        turnId: 'turn-switched',
        userMessageItemId: 'runtime-user-switched'
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
      runtimeId: 'dsh'
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
    expect(rightPanelLifecycleMock.rekeySessionRightPanelWorkspace).not.toHaveBeenCalled()
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
        turnId: 'turn-switched',
        userMessageItemId: 'runtime-user-switched'
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
      runtimeId: 'dsh'
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
    expect(rightPanelLifecycleMock.rekeySessionRightPanelWorkspace).not.toHaveBeenCalled()
  })

  it.each(['handoff', 'promote'] as const)(
    'adopts and rekeys a returned thread id when the provider marks an explicit %s',
    async (threadIdChange) => {
      const { actions, state } = buildHarness()
      const deliveredThreadId = `${threadIdChange}-target`
      const provider = {
        rememberThreadRuntime: vi.fn(),
        sendUserMessage: vi.fn(async () => ({
          threadId: deliveredThreadId,
          turnId: `turn-${threadIdChange}`,
          userMessageItemId: `runtime-user-${threadIdChange}`,
          threadIdChange
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
        runtimeId: 'dsh'
      }]

      await expect(actions.sendMessage('continue in codex')).resolves.toBe(true)

      expect(state.activeThreadId).toBe(deliveredThreadId)
      expect(state.threads.some((item) => item.id === 'thr_existing')).toBe(false)
      expect(state.threads.find((item) => item.id === deliveredThreadId)?.runtimeId).toBe('codex')
      expect(provider.subscribeThreadEvents).toHaveBeenCalledWith(
        deliveredThreadId,
        0,
        expect.any(Object),
        expect.any(AbortSignal)
      )
      expect(provider.rememberThreadRuntime).toHaveBeenLastCalledWith(deliveredThreadId, 'codex')
      expect(rightPanelLifecycleMock.rekeySessionRightPanelWorkspace).toHaveBeenCalledOnce()
      expect(rightPanelLifecycleMock.rekeySessionRightPanelWorkspace).toHaveBeenCalledWith(
        'thr_existing',
        deliveredThreadId
      )
      expect(state.rekeySessionSideConversations).toHaveBeenCalledWith(
        'thr_existing',
        deliveredThreadId
      )
    }
  )

  it('ignores a late handoff after its source Session was removed', async () => {
    const { actions, state } = buildHarness()
    const sent = deferred<{
      threadId: string
      turnId: string
      userMessageItemId: string
      threadIdChange: 'handoff'
    }>()
    const provider = {
      rememberThreadRuntime: vi.fn(),
      sendUserMessage: vi.fn(() => sent.promise),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.activeAgentRuntime = 'codex'
    state.threads = [{ ...thread('thr_existing'), runtimeId: 'dsh' }]

    const sendPromise = actions.sendMessage('handoff after deletion')
    await Promise.resolve()
    state.activeThreadId = null
    state.threads = []
    sent.resolve({
      threadId: 'late-target',
      turnId: 'turn-late',
      userMessageItemId: 'user-late',
      threadIdChange: 'handoff'
    })

    await expect(sendPromise).resolves.toBe(true)
    expect(state.activeThreadId).toBeNull()
    expect(state.threads).toEqual([])
    expect(state.rekeySessionSideConversations).not.toHaveBeenCalled()
    expect(rightPanelLifecycleMock.rekeySessionRightPanelWorkspace).not.toHaveBeenCalled()
  })

  it('does not hand off when the source Session was already absent at send capture', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      rememberThreadRuntime: vi.fn(),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'orphan-target',
        turnId: 'turn-orphan',
        userMessageItemId: 'user-orphan',
        threadIdChange: 'handoff' as const
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.threads = []

    await expect(actions.sendMessage('orphan handoff')).resolves.toBe(true)

    expect(state.activeThreadId).toBe('thr_existing')
    expect(state.rekeySessionSideConversations).not.toHaveBeenCalled()
    expect(rightPanelLifecycleMock.rekeySessionRightPanelWorkspace).not.toHaveBeenCalled()
  })

  it('keeps an existing handoff target canonical instead of projecting source blocks onto it', async () => {
    const { actions, state } = buildHarness()
    const targetBlocks: ChatBlock[] = [{
      kind: 'assistant',
      id: 'target-history',
      text: 'canonical target history'
    }]
    const provider = {
      rememberThreadRuntime: vi.fn(),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_target',
        turnId: 'turn-target',
        userMessageItemId: 'user-target',
        threadIdChange: 'handoff' as const
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.activeAgentRuntime = 'codex'
    state.blocks = [{ kind: 'assistant', id: 'source-history', text: 'source history' }]
    state.threadBlocksById = { thr_target: targetBlocks }
    state.threads = [
      { ...thread('thr_existing'), runtimeId: 'dsh' },
      { ...thread('thr_target'), runtimeId: 'codex' }
    ]

    await expect(actions.sendMessage('continue in target')).resolves.toBe(true)

    expect(state.activeThreadId).toBe('thr_target')
    expect(state.blocks).toEqual(targetBlocks)
    expect(state.threads.map((item) => item.id)).toEqual(['thr_target'])
    expect(state.rekeySessionSideConversations).toHaveBeenCalledWith(
      'thr_existing',
      'thr_target'
    )
    expect(rightPanelLifecycleMock.rekeySessionRightPanelWorkspace).toHaveBeenCalledWith(
      'thr_existing',
      'thr_target'
    )
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

  it('delivers an explicitly targeted background send without touching the active turn or SSE', async () => {
    const { actions, state, sseAbortRef } = buildHarness()
    const activeAbort = new AbortController()
    sseAbortRef.current = activeAbort
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_background',
        turnId: 'turn-background',
        userMessageItemId: 'runtime-user-background'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.activeThreadId = 'thr_existing'
    state.threads = [
      { ...thread('thr_existing'), runtimeId: 'codex' },
      { ...thread('thr_background'), runtimeId: 'codex' }
    ]
    state.blocks = [{ kind: 'assistant', id: 'active-block', text: 'active session output' }]
    state.busy = true
    state.currentTurnId = 'active-turn'
    state.currentTurnUserId = 'active-user'
    state.error = null

    await expect(actions.sendMessage('background instruction', 'agent', {
      targetThreadId: 'thr_background'
    })).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_background',
      'background instruction',
      expect.objectContaining({ clientDirectiveId: expect.stringMatching(/^u-/) })
    )
    expect(provider.subscribeThreadEvents).not.toHaveBeenCalled()
    expect(activeAbort.signal.aborted).toBe(false)
    expect(sseAbortRef.current).toBe(activeAbort)
    expect(state.activeThreadId).toBe('thr_existing')
    expect(state.blocks).toEqual([
      { kind: 'assistant', id: 'active-block', text: 'active session output' }
    ])
    expect(state.busy).toBe(true)
    expect(state.currentTurnId).toBe('active-turn')
    expect(state.currentTurnUserId).toBe('active-user')
    expect(state.watchTurnCompletion).toMatchObject({ thr_background: true })
    expect(state.queuedMessages).toEqual([])
  })

  it('keeps a background delivery detached even if its owner becomes active before acceptance', async () => {
    const { actions, state, sseAbortRef } = buildHarness()
    const activeAbort = new AbortController()
    sseAbortRef.current = activeAbort
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
    state.threads = [
      { ...thread('thr_existing'), runtimeId: 'codex' },
      { ...thread('thr_background'), runtimeId: 'codex' }
    ]

    const sendPromise = actions.sendMessage('background instruction', 'agent', {
      targetThreadId: 'thr_background'
    })
    await vi.waitFor(() => expect(provider.sendUserMessage).toHaveBeenCalledTimes(1))

    state.activeThreadId = 'thr_background'
    state.blocks = [{ kind: 'assistant', id: 'selected-block', text: 'selected snapshot' }]
    state.busy = false
    state.currentTurnId = null
    state.currentTurnUserId = null
    sent.resolve({
      threadId: 'thr_background',
      turnId: 'turn-background',
      userMessageItemId: 'runtime-user-background'
    })

    await expect(sendPromise).resolves.toBe(true)

    expect(activeAbort.signal.aborted).toBe(false)
    expect(sseAbortRef.current).toBe(activeAbort)
    expect(state.blocks).toEqual([
      { kind: 'assistant', id: 'selected-block', text: 'selected snapshot' }
    ])
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(provider.subscribeThreadEvents).not.toHaveBeenCalled()
    expect(state.watchTurnCompletion).toMatchObject({ thr_background: true })
  })

  it('keeps a targeted background failure retryable without replacing the active error or timeline', async () => {
    const { actions, state, sseAbortRef } = buildHarness()
    const activeAbort = new AbortController()
    sseAbortRef.current = activeAbort
    const provider = {
      sendUserMessage: vi.fn(async () => {
        throw new Error('background send failed')
      }),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.activeThreadId = 'thr_existing'
    state.threads = [
      { ...thread('thr_existing'), runtimeId: 'codex' },
      { ...thread('thr_background'), runtimeId: 'codex' }
    ]
    state.blocks = [{ kind: 'assistant', id: 'active-block', text: 'active session output' }]
    state.busy = false
    state.currentTurnId = null
    state.currentTurnUserId = null
    state.error = 'active session error'

    await expect(actions.sendMessage('background instruction', 'agent', {
      targetThreadId: 'thr_background'
    })).resolves.toBe(false)

    expect(activeAbort.signal.aborted).toBe(false)
    expect(sseAbortRef.current).toBe(activeAbort)
    expect(state.blocks).toEqual([
      { kind: 'assistant', id: 'active-block', text: 'active session output' }
    ])
    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.error).toBe('active session error')
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        threadId: 'thr_background',
        targetThreadId: 'thr_background',
        text: 'background instruction',
        sendFailure: expect.objectContaining({ message: 'background send failed' })
      })
    ])
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
    const rendererOnlyRootReference: AgentRuntimeFileReference & {
      workspaceRoot: string
      modelRouterObject: boolean
    } = {
      path: '/workspace/sciforge/data/raw.pdf',
      relativePath: 'data/raw.pdf',
      name: 'raw.pdf',
      mimeType: 'application/pdf',
      modelRouterObject: true,
      workspaceRoot: '/workspace/sciforge'
    }
    const rendererOnlyDeliveryReference = {
      path: 'reports/clean.pdf',
      relativePath: '/workspace/sciforge/reports/clean.pdf',
      name: '',
      modelRouterObject: true
    }

    await expect(actions.sendMessage('use these files', 'agent', {
      fileReferences: [
        ...composerReferences,
        rendererOnlyRootReference,
        rendererOnlyDeliveryReference,
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
            kind: 'directory'
          },
          {
            path: 'docs/guide.md',
            relativePath: 'docs/guide.md',
            name: 'guide.md',
            kind: 'text',
            mimeType: 'text/plain; charset=utf-8'
          },
          {
            path: 'data/raw.pdf',
            relativePath: 'data/raw.pdf',
            name: 'raw.pdf',
            mimeType: 'application/pdf'
          },
          {
            path: 'reports/clean.pdf',
            relativePath: 'reports/clean.pdf',
            name: 'clean.pdf'
          }
        ]
      })
    )
  })

})
