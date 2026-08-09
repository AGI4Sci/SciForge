import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeId, RemoteChannelV1, RemoteChannelConversationV1 } from '@shared/app-settings'
import { REMOTE_CHANNEL_MANAGED_INSTRUCTIONS_HEADING } from '@shared/app-settings'
import type { NormalizedThread } from '../agent/types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  channelWithRemoteThreadMapping,
  remoteChannelThreadIdForProvider,
  createRemoteChannelActions,
  findRecoverableRemoteChannelThread,
  resolveRemoteChannelThreadId
} from './chat-store-remote-channel-actions'

type TestConversationOverrides = Partial<RemoteChannelConversationV1> & { localThreadId?: string }
type TestChannelOverrides = Partial<Omit<RemoteChannelV1, 'conversations'>> & {
  threadId?: string
  conversations?: TestConversationOverrides[]
}

function conversation(overrides: TestConversationOverrides = {}): RemoteChannelConversationV1 {
  const now = '2026-06-01T00:00:00.000Z'
  const {
    localThreadId = 'thr-codewhale-conversation',
    agentThreadIds,
    ...canonicalOverrides
  } = overrides
  return {
    id: 'conversation-1',
    chatId: 'chat-1',
    remoteThreadId: '',
    latestMessageId: 'message-1',
    senderId: 'sender-1',
    senderName: 'Alex',
    workspaceRoot: '/Users/zxy/.sciforge/remote-channel/feishu/feishu/channel-1/conversations/chat-1',
    createdAt: now,
    updatedAt: now,
    ...canonicalOverrides,
    agentThreadIds: agentThreadIds ?? (
      localThreadId.trim() ? { sciforge: localThreadId.trim() } : {}
    )
  }
}

function channel(overrides: TestChannelOverrides = {}): RemoteChannelV1 {
  const now = '2026-06-01T00:00:00.000Z'
  const {
    threadId = 'thr-codewhale-channel',
    conversations,
    agentThreadIds,
    ...canonicalOverrides
  } = overrides
  return {
    id: 'channel-1',
    provider: 'feishu',
    label: 'Feishu Agent01',
    enabled: true,
    model: 'auto',
    workspaceRoot: '/Users/zxy/.sciforge/remote-channel/feishu/feishu/channel-1',
    agentProfile: {
      name: '',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: conversations?.map((item) => conversation(item)) ?? [conversation()],
    createdAt: now,
    updatedAt: now,
    ...canonicalOverrides,
    agentThreadIds: agentThreadIds ?? (
      threadId.trim() ? { sciforge: threadId.trim() } : {}
    )
  }
}

function thread(id: string, title: string, updatedAt = '2026-06-01T00:00:00.000Z'): NormalizedThread {
  return {
    id,
    title,
    updatedAt,
    model: 'reasonix',
    mode: 'agent',
    workspace: '/Users/zxy/.sciforge/default_workspace'
  }
}

type TestSettings = {
  workspaceRoot: string
  activeAgentRuntime?: AgentRuntimeId
  remoteChannel: {
    enabled: boolean
    im: {
      enabled: boolean
      provider: 'feishu'
      workspaceRoot: string
    }
    channels: RemoteChannelV1[]
  }
}

type TestRemoteChannelProvider = {
  id: AgentRuntimeId
  rememberThreadRuntime: ReturnType<typeof vi.fn<(threadId: string, runtimeId?: AgentRuntimeId) => void>>
  createThread: ReturnType<typeof vi.fn<(input: { workspace: string; title: string; mode: 'agent' | 'plan' }) => Promise<NormalizedThread>>>
  getThreadStatus: ReturnType<typeof vi.fn<(threadId: string) => Promise<unknown>>>
  deleteThread: ReturnType<typeof vi.fn<(threadId: string) => Promise<void>>>
}

function settingsWithChannels(
  channels: RemoteChannelV1[],
  activeAgentRuntime: AgentRuntimeId = 'codex'
): TestSettings {
  return {
    workspaceRoot: '/Users/zxy/project',
    activeAgentRuntime,
    remoteChannel: {
      enabled: true,
      im: {
        enabled: true,
        provider: 'feishu',
        workspaceRoot: '/Users/zxy/project'
      },
      channels
    }
  }
}

function createRemoteChannelActionHarness(options: {
  settings: TestSettings
  provider?: Partial<TestRemoteChannelProvider>
  newRemoteChannel?: () => RemoteChannelV1
  state?: Record<string, unknown>
}) {
  let settings = options.settings
  const sciforge = {
    getSettings: vi.fn(async () => settings),
    setSettings: vi.fn(async (patch: { remoteChannel?: { channels?: RemoteChannelV1[] } }) => {
      settings = {
        ...settings,
        remoteChannel: {
          ...settings.remoteChannel,
          ...(patch.remoteChannel ?? {}),
          channels: patch.remoteChannel?.channels ?? settings.remoteChannel.channels
        }
      }
      return settings
    })
  }
  vi.stubGlobal('window', { sciforge })

  const provider: TestRemoteChannelProvider = {
    id: 'codex' as AgentRuntimeId,
    rememberThreadRuntime: vi.fn<(threadId: string, runtimeId?: AgentRuntimeId) => void>(),
    createThread: vi.fn<(input: { workspace: string; title: string; mode: 'agent' | 'plan' }) => Promise<NormalizedThread>>(
      async () => thread('created-thread', '[Remote channel:Feishu Agent01]')
    ),
    getThreadStatus: vi.fn<(threadId: string) => Promise<unknown>>(async () => ({})),
    deleteThread: vi.fn<(threadId: string) => Promise<void>>(async () => undefined),
    ...(options.provider ?? {})
  }

  let state: Record<string, unknown> = {}
  const selectThread = vi.fn(async (threadId: string) => {
    state = { ...state, activeThreadId: threadId }
  })
  const refreshThreads = vi.fn(async () => undefined)
  const selectRemoteChannel = vi.fn(async () => undefined)
  state = {
    runtimeConnection: 'ready',
    route: 'chat',
    connectPhonePanelOpen: false,
    remoteChannels: settings.remoteChannel.channels,
    activeRemoteChannelId: '',
    remoteGuardChannelId: null,
    threads: [],
    activeThreadId: '',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    busy: false,
    lastSeq: 0,
    currentTurnId: null,
    currentTurnUserId: null,
    inspectorSelectedId: null,
    composerModel: 'auto',
    error: null,
    selectThread,
    refreshThreads,
    selectRemoteChannel,
    ...(options.state ?? {})
  }
  const set = vi.fn((partial: Record<string, unknown> | ((current: typeof state) => Record<string, unknown>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...patch }
  })
  const actions = createRemoteChannelActions({
    set: set as never,
    get: (() => state) as never,
    i18n: { t: (key: string) => key },
    getProvider: () => provider,
    newRemoteChannel: (options.newRemoteChannel ?? vi.fn()) as never,
    normalizeRemoteChannelComposerModel: (raw: string) => raw as never,
    activeRemoteChannel: vi.fn() as never,
    normalizeWorkspaceRoot: (workspaceRoot?: string | null) => workspaceRoot?.trim() ?? '',
    formatRuntimeError: (error: unknown) => error instanceof Error ? error.message : String(error),
    shouldOpenSettingsForError: () => false,
    clearedThreadSelection: () => ({
      activeThreadId: null,
      blocks: [],
      liveReasoning: '',
      liveReasoningMeta: null,
      liveAssistant: '',
      busy: false,
      lastSeq: 0,
      currentTurnId: null,
      currentTurnUserId: null,
      inspectorSelectedId: null
    }),
    sseAbortRef: { current: null },
    clearBusyWatchdog: vi.fn()
  })

  return {
    actions,
    sciforge,
    provider,
    selectThread,
    refreshThreads,
    selectRemoteChannel,
    getSettings: () => settings,
    getState: () => state
  }
}

describe('chat-store remote channel actions helpers', () => {
  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('uses channel mappings only when the latest conversation has none', () => {
    const item = channel({ agentThreadIds: {} })
    const latestConversation = { ...item.conversations[0], agentThreadIds: {} }
    expect(remoteChannelThreadIdForProvider(item, latestConversation, 'sciforge')).toBe('')
    expect(remoteChannelThreadIdForProvider({
      ...item,
      agentThreadIds: { sciforge: 'sciforge-channel-thread' }
    }, latestConversation, 'sciforge')).toBe('sciforge-channel-thread')
  })

  it('uses Codex thread mappings without falling back to legacy local runtime fields', () => {
    const item = channel({
      threadId: 'kun-channel-thread',
      agentThreadIds: {
        sciforge: 'kun-channel-thread',
        codex: 'codex-channel-thread'
      },
      conversations: [{
        ...channel().conversations[0],
        localThreadId: 'kun-conversation-thread',
        agentThreadIds: {
          sciforge: 'kun-conversation-thread',
          codex: 'codex-conversation-thread'
        }
      }]
    })

    expect(remoteChannelThreadIdForProvider(item, item.conversations[0], 'codex')).toBe('codex-conversation-thread')
    expect(remoteChannelThreadIdForProvider({ ...item, agentThreadIds: {} }, item.conversations[0], 'codex'))
      .toBe('codex-conversation-thread')
    expect(remoteChannelThreadIdForProvider({ ...item, agentThreadIds: {} }, {
      ...item.conversations[0],
      agentThreadIds: {}
    }, 'codex')).toBe('')
  })

  it('recovers an unmapped current remote-channel session before creating a new empty one', () => {
    const item = channel()
    const recovered = findRecoverableRemoteChannelThread(
      [
        thread('empty-claw-thread', '[Remote channel:Feishu Agent01]', '2026-06-01T00:02:00.000Z'),
        thread('old-content-thread', `${REMOTE_CHANNEL_MANAGED_INSTRUCTIONS_HEADING} SciForge scheduled-task tools`, '2026-06-01T00:01:00.000Z')
      ],
      [item],
      item,
      'sciforge'
    )

    expect(recovered?.id).toBe('old-content-thread')
  })

  it('does not recover unmapped sessions from legacy Claw titles', () => {
    const item = channel()
    const recovered = findRecoverableRemoteChannelThread(
      [
        thread('legacy-claw-thread', '[Claw:Feishu Agent01]', '2026-06-01T00:03:00.000Z'),
        thread('legacy-claw-im-thread', '[Claw IM:Feishu Agent01]', '2026-06-01T00:02:00.000Z')
      ],
      [item],
      item,
      'sciforge'
    )

    expect(recovered).toBeNull()
  })

  it('normalizes removed runtime writes to the Codex mapping', () => {
    const now = '2026-06-01T00:03:00.000Z'
    const next = channelWithRemoteThreadMapping(channel({
      threadId: '',
      agentThreadIds: {},
      conversations: [{ localThreadId: '', agentThreadIds: {} }]
    }), 'codex-thread', now, 'conversation-1', 'sciforge')

    expect(next).not.toHaveProperty('threadId')
    expect(next.runtimeId).toBe('codex')
    expect(next.conversations[0]).not.toHaveProperty('localThreadId')
    expect(next.agentThreadIds).toEqual({ codex: 'codex-thread' })
    expect(next.conversations[0]?.agentThreadIds).toEqual({ codex: 'codex-thread' })
  })

  it('writes Codex thread mappings without overwriting local runtime mappings', () => {
    const now = '2026-06-01T00:03:00.000Z'
    const next = channelWithRemoteThreadMapping(
      channel({
        threadId: 'kun-channel-thread',
        agentThreadIds: { sciforge: 'kun-channel-thread' },
        conversations: [{
          ...channel().conversations[0],
          localThreadId: 'kun-conversation-thread',
          agentThreadIds: { sciforge: 'kun-conversation-thread' }
        }]
      }),
      'codex-thread',
      now,
      'conversation-1',
      'codex'
    )

    expect(next).not.toHaveProperty('threadId')
    expect(next.agentThreadIds).toEqual({ sciforge: 'kun-channel-thread', codex: 'codex-thread' })
    expect(next.conversations[0]).not.toHaveProperty('localThreadId')
    expect(next.conversations[0]?.agentThreadIds).toEqual({
      sciforge: 'kun-conversation-thread',
      codex: 'codex-thread'
    })
  })

  it('uses Codex and the current project workspace for a new channel with legacy settings', async () => {
    const baseChannel = channel({ workspaceRoot: '', threadId: '', conversations: [] })
    const { actions, sciforge, getSettings, getState } = createRemoteChannelActionHarness({
      settings: settingsWithChannels([], 'sciforge'),
      newRemoteChannel: () => baseChannel
    })

    await actions.addRemoteChannel('feishu')

    expect(getSettings().remoteChannel.channels[0]).toMatchObject({
      id: 'channel-1',
      runtimeId: 'codex',
      workspaceRoot: '/Users/zxy/project'
    })
    expect(getState().route).toBe('chat')
    expect(getState().connectPhonePanelOpen).toBe(true)
    expect(sciforge.setSettings).toHaveBeenCalledWith(expect.objectContaining({
      remoteChannel: expect.objectContaining({
        channels: [expect.objectContaining({ workspaceRoot: '/Users/zxy/project' })]
      })
    }))
  })

  it('selects a channel using the channel runtime mapping when the active runtime differs', async () => {
    const item = channel({
      runtimeId: 'codex',
      threadId: 'kun-channel-thread',
      agentThreadIds: {
        sciforge: 'kun-channel-thread',
        codex: 'codex-channel-thread'
      },
      conversations: [{
        ...channel().conversations[0],
        localThreadId: 'kun-conversation-thread',
        agentThreadIds: {
          sciforge: 'kun-conversation-thread',
          codex: 'codex-conversation-thread'
        }
      }]
    })
    const { actions, provider, getState } = createRemoteChannelActionHarness({
      settings: settingsWithChannels([item], 'sciforge'),
      provider: { id: 'sciforge' }
    })

    await actions.selectRemoteChannel('channel-1')

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('codex-conversation-thread', 'codex')
    expect(provider.getThreadStatus).toHaveBeenCalledWith('codex-conversation-thread')
    expect(getState().activeThreadId).toBe('codex-conversation-thread')
    expect((getState().threads as NormalizedThread[])[0]?.runtimeId).toBe('codex')
  })

  it('does not recover a local runtime managed thread for a Codex channel selection', async () => {
    const item = channel({
      runtimeId: 'codex',
      threadId: 'kun-channel-thread',
      agentThreadIds: { sciforge: 'kun-channel-thread' },
      conversations: [{
        ...channel().conversations[0],
        runtimeId: 'codex',
        localThreadId: 'kun-conversation-thread',
        agentThreadIds: { sciforge: 'kun-conversation-thread' }
      }]
    })
    const createdThread = {
      ...thread('created-codex-thread', '[Remote channel:Feishu Agent01]'),
      runtimeId: 'codex' as const
    }
    const { actions, provider, sciforge, getState } = createRemoteChannelActionHarness({
      settings: settingsWithChannels([item], 'codex'),
      provider: {
        id: 'codex',
        createThread: vi.fn(async () => createdThread)
      },
      state: {
        threads: [{
          ...thread('recoverable-kun-thread', '[Remote channel:Feishu Agent01]', '2026-06-01T00:02:00.000Z'),
          runtimeId: 'sciforge' as const
        }]
      }
    })

    await actions.selectRemoteChannel('channel-1')

    const savedChannels = sciforge.setSettings.mock.calls.at(-1)?.[0].remoteChannel?.channels ?? []
    expect(provider.createThread).toHaveBeenCalledTimes(1)
    expect(getState().activeThreadId).toBe('created-codex-thread')
    expect(savedChannels[0]?.agentThreadIds).toEqual({
      sciforge: 'kun-channel-thread',
      codex: 'created-codex-thread'
    })
    expect(savedChannels[0]?.conversations[0]?.agentThreadIds).toEqual({
      sciforge: 'kun-conversation-thread',
      codex: 'created-codex-thread'
    })
  })

  it('selects a conversation using the conversation runtime mapping when the active runtime differs', async () => {
    const item = channel({
      runtimeId: 'sciforge',
      threadId: 'kun-channel-thread',
      agentThreadIds: {
        sciforge: 'kun-channel-thread'
      },
      conversations: [{
        ...channel().conversations[0],
        runtimeId: 'codex',
        localThreadId: 'kun-conversation-thread',
        agentThreadIds: {
          sciforge: 'kun-conversation-thread',
          codex: 'codex-conversation-thread'
        }
      }]
    })
    const { actions, provider, selectRemoteChannel, getState } = createRemoteChannelActionHarness({
      settings: settingsWithChannels([item], 'sciforge'),
      provider: { id: 'sciforge' }
    })

    await actions.selectRemoteChannelConversation('channel-1', 'codex-conversation-thread')

    expect(selectRemoteChannel).not.toHaveBeenCalled()
    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('codex-conversation-thread', 'codex')
    expect(provider.getThreadStatus).toHaveBeenCalledWith('codex-conversation-thread')
    expect(getState().activeThreadId).toBe('codex-conversation-thread')
    expect((getState().threads as NormalizedThread[])[0]?.runtimeId).toBe('codex')
  })

  it('deletes a channel using the channel runtime mapping when the active runtime differs', async () => {
    const item = channel({
      runtimeId: 'codex',
      threadId: 'kun-channel-thread',
      agentThreadIds: {
        sciforge: 'kun-channel-thread',
        codex: 'codex-channel-thread'
      },
      conversations: []
    })
    const { actions, provider } = createRemoteChannelActionHarness({
      settings: settingsWithChannels([item], 'sciforge'),
      provider: { id: 'sciforge' }
    })

    await actions.deleteRemoteChannel('channel-1')

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('codex-channel-thread', 'codex')
    expect(provider.deleteThread).toHaveBeenCalledWith('codex-channel-thread')
  })

  it('resets a channel using the channel runtime mapping when the active runtime differs', async () => {
    const item = channel({
      runtimeId: 'codex',
      threadId: 'kun-channel-thread',
      agentThreadIds: {
        sciforge: 'kun-channel-thread',
        codex: 'old-codex-channel-thread'
      },
      conversations: [{
        ...channel().conversations[0],
        runtimeId: 'codex',
        localThreadId: 'kun-conversation-thread',
        agentThreadIds: {
          sciforge: 'kun-conversation-thread',
          codex: 'old-codex-conversation-thread'
        }
      }]
    })
    const createdThread = {
      ...thread('new-codex-thread', '[Remote channel:Feishu Agent01]'),
      runtimeId: 'codex' as const
    }
    const { actions, provider, sciforge } = createRemoteChannelActionHarness({
      settings: settingsWithChannels([item], 'sciforge'),
      provider: {
        id: 'sciforge',
        createThread: vi.fn(async () => createdThread)
      }
    })

    await actions.resetRemoteChannelSession('channel-1')

    const savedChannels = sciforge.setSettings.mock.calls.at(-1)?.[0].remoteChannel?.channels ?? []
    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('old-codex-channel-thread', 'codex')
    expect(provider.deleteThread).toHaveBeenCalledWith('old-codex-channel-thread')
    expect(savedChannels[0]).toEqual(expect.objectContaining({
      runtimeId: 'codex',
      agentThreadIds: {
        sciforge: 'kun-channel-thread',
        codex: 'new-codex-thread'
      }
    }))
    expect(savedChannels[0]).not.toHaveProperty('threadId')
    expect(savedChannels[0]?.conversations[0]).toEqual(expect.objectContaining({
      runtimeId: 'codex',
      agentThreadIds: {
        sciforge: 'kun-conversation-thread',
        codex: 'new-codex-thread'
      }
    }))
    expect(savedChannels[0]?.conversations[0]).not.toHaveProperty('localThreadId')
  })

  it('drops stale configured thread ids and falls back to a recovered thread', () => {
    expect(
      resolveRemoteChannelThreadId({
        configuredThreadId: 'thr_missing',
        recoveredThreadId: 'thr_recovered',
        configuredThreadExists: false,
        configuredThreadHasUserMessages: false
      })
    ).toBe('thr_recovered')
  })

  it('keeps the configured thread when it exists and already has conversation history', () => {
    expect(
      resolveRemoteChannelThreadId({
        configuredThreadId: 'thr_live',
        recoveredThreadId: 'thr_recovered',
        configuredThreadExists: true,
        configuredThreadHasUserMessages: true
      })
    ).toBe('thr_live')
  })

  it('keeps an empty IM channel on the project route instead of selecting a stale missing thread', async () => {
    rendererRuntimeClient.invalidateSettings()
    let settings = {
      workspaceRoot: '/Users/zxy/project',
      remoteChannel: {
        enabled: true,
        im: {
          enabled: true,
          provider: 'feishu',
          workspaceRoot: '/Users/zxy/project'
        },
        channels: [channel({ agentThreadIds: {}, conversations: [] })]
      }
    }
    const sciforge = {
      getSettings: vi.fn(async () => settings),
      setSettings: vi.fn(async (patch: { remoteChannel?: { channels?: RemoteChannelV1[] } }) => {
        settings = {
          ...settings,
          remoteChannel: {
            ...settings.remoteChannel,
            ...(patch.remoteChannel ?? {}),
            channels: patch.remoteChannel?.channels ?? settings.remoteChannel.channels
          }
        }
        return settings
      })
    }
    vi.stubGlobal('window', { sciforge })

    const provider = {
      createThread: vi.fn(),
      getThreadStatus: vi.fn(async () => {
        throw new Error('thread not found: thr_missing')
      }),
      deleteThread: vi.fn()
    }
    let state: Record<string, unknown> = {
      runtimeConnection: 'ready',
      route: 'chat',
      connectPhonePanelOpen: false,
      remoteChannels: settings.remoteChannel.channels,
      activeRemoteChannelId: '',
      remoteGuardChannelId: null,
      threads: [],
      activeThreadId: 'thr_previous',
      blocks: [{ kind: 'user', id: 'u1', text: 'hello' }],
      liveReasoning: '',
      liveAssistant: '',
      busy: false,
      lastSeq: 0,
      currentTurnId: null,
      currentTurnUserId: null,
      inspectorSelectedId: null,
      composerModel: 'auto',
      error: 'previous error'
    }
    const set = vi.fn((partial: Record<string, unknown> | ((current: typeof state) => Record<string, unknown>)) => {
      const patch = typeof partial === 'function' ? partial(state) : partial
      state = { ...state, ...patch }
    })
    const actions = createRemoteChannelActions({
      set: set as never,
      get: (() => state) as never,
      i18n: { t: (key: string) => key },
      getProvider: () => provider,
      newRemoteChannel: vi.fn() as never,
      normalizeRemoteChannelComposerModel: (raw: string) => raw as never,
      activeRemoteChannel: vi.fn() as never,
      normalizeWorkspaceRoot: (workspaceRoot?: string | null) => workspaceRoot?.trim() ?? '',
      formatRuntimeError: (error: unknown) => error instanceof Error ? error.message : String(error),
      shouldOpenSettingsForError: () => false,
      clearedThreadSelection: () => ({
        activeThreadId: null,
        blocks: [],
        liveReasoning: '',
        liveReasoningMeta: null,
        liveAssistant: '',
        busy: false,
        lastSeq: 0,
        currentTurnId: null,
        currentTurnUserId: null,
        inspectorSelectedId: null
      }),
      sseAbortRef: { current: null },
      clearBusyWatchdog: vi.fn()
    })

    await actions.selectRemoteChannel('channel-1')

    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.route).toBe('chat')
    expect(state.activeRemoteChannelId).toBe('channel-1')
    expect(state.activeThreadId).toBe('thr_previous')
    expect(state.blocks).toEqual([{ kind: 'user', id: 'u1', text: 'hello' }])
    expect(state.error).toBeNull()
    expect(sciforge.setSettings).not.toHaveBeenCalled()
  })
})
