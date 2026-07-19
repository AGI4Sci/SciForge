import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1, RemoteChannelV1 } from '@shared/app-settings'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createAppActions } from './chat-store-app-actions'

afterEach(() => {
  vi.unstubAllGlobals()
})

function channel(id: string): RemoteChannelV1 {
  return {
    id,
    provider: 'discord',
    label: 'discord bot',
    enabled: true,
    model: 'auto',
    runtimeId: 'codex',
    agentThreadIds: {
      codex: 'codex-thread'
    },
    workspaceRoot: '/workspace/sciforge',
    agentProfile: {
      name: 'discord bot',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [{
      id: 'discord-channel::support-room',
      chatId: 'support-room',
      remoteThreadId: '',
      latestMessageId: 'discord-message-1',
      senderId: 'user-1',
      senderName: 'Alice',
      runtimeId: 'codex',
      agentThreadIds: {
        codex: 'codex-thread'
      },
      workspaceRoot: '/workspace/sciforge',
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z'
    }],
    recentMessages: [],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z'
  }
}

function buildHarness(initialState: Partial<ChatState> = {}): {
  actions: ReturnType<typeof createAppActions>
  state: ChatState
} {
  const state = {
    route: 'chat',
    connectPhonePanelOpen: false,
    activeThreadId: 'desktop-thread',
    activeRemoteChannelId: '',
    remoteGuardChannelId: null,
    remoteChannels: [channel('discord-channel')],
    refreshRemoteChannels: vi.fn(async () => undefined),
    refreshThreads: vi.fn(async () => undefined),
    loadComposerModels: vi.fn(async () => undefined),
    applyI18nFromSettings: vi.fn(async () => undefined),
    composerModel: '',
    composerPickList: [],
    composerModelGroups: []
  } as unknown as ChatState
  Object.assign(state, initialState)
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createAppActions({
    set,
    get,
    i18n: { changeLanguage: vi.fn(async () => undefined) } as never,
    persistComposerModel: vi.fn(),
    readStoredComposerModel: vi.fn(() => ''),
    mergeComposerPickList: vi.fn(() => []),
    getComposerModelLoadPromise: vi.fn(() => null),
    setComposerModelLoadPromise: vi.fn(),
    applyTheme: vi.fn(),
    applyUiFontScale: vi.fn(),
    applyDocumentLocale: vi.fn(),
    workspaceLabelFromPath: vi.fn((workspaceRoot: string) => workspaceRoot),
    normalizeWorkspaceRoot: vi.fn((workspaceRoot?: string | null) => workspaceRoot?.trim() ?? '')
  })
  return { actions, state }
}

describe('chat-store app actions', () => {
  it('optimistically shows the selected runtime while settings save', async () => {
    const deferred: { resolve: (settings: AppSettingsV1) => void } = {
      resolve: () => undefined
    }
    const setSettings = vi.fn(() => new Promise<AppSettingsV1>((resolve) => {
      deferred.resolve = resolve
    }))
    vi.stubGlobal('window', {
      sciforge: {
        setSettings
      }
    })
    const probeRuntime = vi.fn(async () => undefined)
    const { actions, state } = buildHarness({
      activeAgentRuntime: 'codex',
      runtimeConnection: 'ready',
      runtimeErrorDetail: 'old error',
      error: 'old error',
      probeRuntime
    })

    const task = actions.setActiveAgentRuntime('sciforge')

    expect(state.activeAgentRuntime).toBe('sciforge')
    expect(state.runtimeConnection).toBe('checking')
    expect(state.error).toBeNull()
    expect(state.runtimeErrorDetail).toBeNull()
    expect(setSettings).toHaveBeenCalledWith({ activeAgentRuntime: 'sciforge' })

    deferred.resolve({ activeAgentRuntime: 'sciforge' } as AppSettingsV1)
    await task

    expect(probeRuntime).toHaveBeenCalledWith('user')
  })

  it('rolls runtime selection back when settings save fails', async () => {
    vi.stubGlobal('window', {
      sciforge: {
        setSettings: vi.fn(async () => {
          throw new Error('save failed')
        })
      }
    })
    const probeRuntime = vi.fn(async () => undefined)
    const { actions, state } = buildHarness({
      activeAgentRuntime: 'codex',
      runtimeConnection: 'ready',
      probeRuntime
    })

    await actions.setActiveAgentRuntime('sciforge')

    expect(state.activeAgentRuntime).toBe('codex')
    expect(state.runtimeConnection).toBe('offline')
    expect(state.error).toBe('save failed')
    expect(probeRuntime).not.toHaveBeenCalled()
  })

  it('rejects switching away from Codex while Codex Plan is active', async () => {
    const setSettings = vi.fn()
    vi.stubGlobal('window', { sciforge: { setSettings } })
    const { actions, state } = buildHarness({
      activeAgentRuntime: 'codex',
      modelAccessMode: 'coding-plan',
      error: null
    })

    await actions.setActiveAgentRuntime('sciforge')

    expect(state.activeAgentRuntime).toBe('codex')
    expect(state.error).toBe('Codex Plan requires the Codex runtime.')
    expect(setSettings).not.toHaveBeenCalled()
  })

  it('opens a remote guard entry without selecting its mapped local thread', () => {
    const { actions, state } = buildHarness()

    actions.selectRemoteGuardChannel('discord-channel')

    expect(state.route).toBe('chat')
    expect(state.remoteGuardChannelId).toBe('discord-channel')
    expect(state.activeRemoteChannelId).toBe('discord-channel')
    expect(state.activeThreadId).toBe('desktop-thread')
  })

  it('ignores missing remote guard entries without clearing the current detail', () => {
    const { actions, state } = buildHarness({
      remoteGuardChannelId: 'discord-channel',
      activeRemoteChannelId: 'discord-channel',
      activeThreadId: 'desktop-thread'
    })

    actions.selectRemoteGuardChannel('missing-channel')

    expect(state.route).toBe('chat')
    expect(state.remoteGuardChannelId).toBe('discord-channel')
    expect(state.activeRemoteChannelId).toBe('discord-channel')
    expect(state.activeThreadId).toBe('desktop-thread')
  })

  it('clears the remote guard detail when leaving chat', () => {
    const { actions, state } = buildHarness({
      remoteGuardChannelId: 'discord-channel'
    })

    actions.openSchedule()

    expect(state.route).toBe('schedule')
    expect(state.remoteGuardChannelId).toBeNull()
  })

  it('keeps remote bindings stable across refresh and app section navigation', async () => {
    const { actions, state } = buildHarness({
      remoteGuardChannelId: 'discord-channel',
      activeRemoteChannelId: 'discord-channel',
      activeThreadId: 'codex-thread',
      runtimeConnection: 'ready'
    })
    const bindingBefore = JSON.parse(JSON.stringify(state.remoteChannels))
    vi.stubGlobal('window', {
      sciforge: {
        getSettings: vi.fn(async () => ({
          workspaceRoot: '/workspace/sciforge',
          theme: 'system',
          uiFontScale: 'small',
          locale: 'en',
          remoteChannel: { channels: bindingBefore }
        }) as AppSettingsV1),
        fetchUpstreamModels: vi.fn(async () => ({ ok: true, modelIds: [], modelGroups: [] }))
      }
    })
    state.refreshRemoteChannels = vi.fn(async () => {
      state.remoteChannels = JSON.parse(JSON.stringify(bindingBefore))
    })

    await actions.reloadUiSettings()
    actions.openSettings('general')
    actions.openConnectPhone()
    actions.selectRemoteGuardChannel('discord-channel')
    actions.setRoute('chat')

    expect(state.remoteChannels).toEqual(bindingBefore)
    expect(state.remoteChannels[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: { codex: 'codex-thread' },
      workspaceRoot: '/workspace/sciforge',
      conversations: [expect.objectContaining({
        chatId: 'support-room',
        runtimeId: 'codex',
        agentThreadIds: { codex: 'codex-thread' },
        workspaceRoot: '/workspace/sciforge'
      })]
    })
    expect(state.remoteChannels[0]).not.toHaveProperty('threadId')
    expect(state.remoteChannels[0]?.conversations[0]).not.toHaveProperty('localThreadId')
    expect(state.activeThreadId).toBe('codex-thread')
    expect(state.refreshRemoteChannels).toHaveBeenCalledTimes(1)
  })

  it('opens Connect phone as a chat route panel', () => {
    const { actions, state } = buildHarness({
      route: 'schedule',
      remoteGuardChannelId: 'discord-channel',
      connectPhonePanelOpen: false
    })

    actions.openConnectPhone()

    expect(state.route).toBe('chat')
    expect(state.remoteGuardChannelId).toBeNull()
    expect(state.connectPhonePanelOpen).toBe(true)
    expect(state.refreshRemoteChannels).toHaveBeenCalledTimes(1)
  })
})
