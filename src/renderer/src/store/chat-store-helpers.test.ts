import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteChannelV1 } from '@shared/app-settings'
import { REMOTE_CHANNEL_MANAGED_INSTRUCTIONS_HEADING } from '@shared/app-settings'
import {
  MAX_TURN_MODEL_LABELS,
  MAX_CODE_WORKSPACE_ROOTS,
  remoteChannelThreadBindingsFromChannels,
  remoteChannelThreadIdsFromChannels,
  remoteChannelThreadTitleLooksManaged,
  compactCodeWorkspaceRoots,
  deriveRemoteChannelThreadStatusKind,
  hydrateBlockModelLabels,
  isRemoteChannelThread,
  mergeComposerPickList,
  newRemoteChannel,
  normalizeTurnModelMap,
  rememberTurnModel,
  watchedRemoteChannelThreadIdsFromChannels
} from './chat-store-helpers'

const TURN_MODEL_STORAGE_KEY = 'sciforge.turnModelLabel'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    }
  }
}

function clawChannel(): RemoteChannelV1 {
  const now = '2026-06-01T00:00:00.000Z'
  return {
    id: 'channel-1',
    provider: 'feishu',
    label: 'Feishu Agent',
    enabled: true,
    model: 'auto',
    agentThreadIds: { sciforge: 'sciforge-channel' },
    workspaceRoot: '/Users/zxy/project',
    agentProfile: {
      name: '',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [
      {
        id: 'conversation-1',
        chatId: 'chat-1',
        remoteThreadId: 'remote-1',
        latestMessageId: 'message-1',
        senderId: 'sender-1',
        senderName: 'Alex',
        agentThreadIds: { sciforge: 'sciforge-conversation' },
        workspaceRoot: '/Users/zxy/project',
        createdAt: now,
        updatedAt: now
      }
    ],
    createdAt: now,
    updatedAt: now
  }
}

describe('chat-store remote-channel helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses only the public models returned by the upstream model catalog', () => {
    expect(mergeComposerPickList(false, ['sciforge-router'])).toEqual([])
    expect(mergeComposerPickList(true, [' sciforge-router ', 'sciforge-router', ''])).toEqual([
      'sciforge-router'
    ])
  })

  it('compacts code workspace roots while excluding write, temporary, and remote-channel roots', () => {
    expect(
      compactCodeWorkspaceRoots([
        '/Users/zxy/project-a',
        '/Users/zxy/project-a/',
        '/tmp/transient',
        '/Users/zxy/.sciforge/remote-channel/agent/conversations/chat',
        '/Users/zxy/.sciforge/claw/agent/conversations/chat',
        '/Users/zxy/.sciforge/default_workspace',
        '~/.sciforge/write_workspace',
        '',
        '/Users/zxy/project-b'
      ])
    ).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/.sciforge/claw/agent/conversations/chat',
      '/Users/zxy/.sciforge/default_workspace',
      '/Users/zxy/project-b'
    ])
  })

  it('deduplicates default workspace aliases', () => {
    expect(
      compactCodeWorkspaceRoots([
        '~/.sciforge/default_workspace',
        'C:\\Users\\zxy\\.sciforge\\default_workspace',
        'C:\\Users\\zxy\\.sciforge\\default_workspace\\'
      ])
    ).toEqual(['~/.sciforge/default_workspace'])
  })

  it('caps code workspace roots while keeping the newest unique roots first', () => {
    const roots = Array.from({ length: MAX_CODE_WORKSPACE_ROOTS + 4 }, (_, index) =>
      `/Users/zxy/project-${index}`
    )

    const compacted = compactCodeWorkspaceRoots([
      roots[0],
      roots[0].toUpperCase(),
      ...roots
    ])

    expect(compacted).toHaveLength(MAX_CODE_WORKSPACE_ROOTS)
    expect(compacted[0]).toBe('/Users/zxy/project-0')
    expect(compacted.at(-1)).toBe(`/Users/zxy/project-${MAX_CODE_WORKSPACE_ROOTS - 1}`)
    expect(compacted).not.toContain(`/Users/zxy/project-${MAX_CODE_WORKSPACE_ROOTS}`)
  })

  it('collects channel and conversation thread ids for remote-channel sessions', () => {
    const ids = remoteChannelThreadIdsFromChannels([clawChannel()])

    expect(ids.has('sciforge-channel')).toBe(true)
    expect(ids.has('sciforge-conversation')).toBe(true)
  })

  it('collects watched thread ids only from enabled IM channels', () => {
    const enabled = clawChannel()
    const disabled = {
      ...clawChannel(),
      id: 'channel-disabled',
      enabled: false,
      threadId: 'disabled-channel',
      conversations: [{
        ...clawChannel().conversations[0],
        id: 'conversation-disabled',
        localThreadId: 'disabled-conversation'
      }]
    }

    const ids = watchedRemoteChannelThreadIdsFromChannels([enabled, disabled])

    expect(ids.has('sciforge-channel')).toBe(true)
    expect(ids.has('sciforge-conversation')).toBe(true)
    expect(ids.has('disabled-channel')).toBe(false)
    expect(ids.has('disabled-conversation')).toBe(false)
  })

  it('indexes remote bindings for channel and conversation thread ids', () => {
    const base = clawChannel()
    const channel: RemoteChannelV1 = {
      ...base,
      provider: 'weixin',
      label: 'WeChat',
      guardMode: 'all_messages',
      agentThreadIds: { codex: 'codex-channel' },
      conversations: [
        {
          ...base.conversations[0],
          runtimeId: 'codex',
          agentThreadIds: { codex: 'codex-conversation' },
          lastFailure: {
            provider: 'weixin',
            message: 'Runtime offline',
            failureKind: 'runtime_offline',
            channelId: 'channel_1',
            chatId: 'chat_1',
            threadId: 'codex-conversation',
            runtimeId: 'codex',
            occurredAt: '2026-06-02T00:01:00.000Z'
          },
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      ]
    }

    const bindings = remoteChannelThreadBindingsFromChannels([channel])

    expect(bindings.get('codex-channel')).toMatchObject({
      providerLabel: 'WeChat',
      scope: 'channel',
      channelLabel: 'WeChat',
      guardMode: 'all_messages'
    })
    expect(bindings.get('codex-conversation')).toMatchObject({
      providerLabel: 'WeChat',
      scope: 'conversation',
      senderName: 'Alex',
      runtimeId: 'codex',
      guardMode: 'all_messages',
      lastFailure: expect.objectContaining({ message: 'Runtime offline' })
    })
  })

  it('uses readable remote channel labels for Discord bindings', () => {
    const channel: RemoteChannelV1 = {
      ...clawChannel(),
      provider: 'discord',
      label: 'discord bot',
      platformCredential: {
        kind: 'discord',
        applicationId: 'app-1',
        botId: 'bot-1',
        botUsername: 'deepseek-bot',
        guildId: 'guild-1',
        guildName: 'SciForge',
        channelId: 'channel-1',
        channelName: 'debug',
        createdAt: '2026-06-01T00:00:00.000Z'
      }
    }

    const binding = remoteChannelThreadBindingsFromChannels([channel]).get('sciforge-channel')

    expect(binding).toMatchObject({
      providerLabel: 'Discord',
      channelLabel: '#debug',
      guardMode: 'only_mention'
    })
  })

  it('derives remote status precedence from thread state', () => {
    const binding = remoteChannelThreadBindingsFromChannels([clawChannel()]).get('sciforge-channel')

    expect(deriveRemoteChannelThreadStatusKind({ binding })).toBe('watched')
    expect(deriveRemoteChannelThreadStatusKind({ binding, queued: true })).toBe('queued')
    expect(deriveRemoteChannelThreadStatusKind({ binding, running: true })).toBe('running')
    expect(deriveRemoteChannelThreadStatusKind({ binding, status: 'failed' })).toBe('error')
    expect(deriveRemoteChannelThreadStatusKind({
      binding: {
        ...binding!,
        lastFailure: {
          provider: 'feishu',
          message: 'Runtime offline',
          occurredAt: '2026-06-02T00:01:00.000Z'
        }
      }
    })).toBe('error')
  })

  it('uses product default agent names for new phone connections', () => {
    const feishu = newRemoteChannel('feishu')
    const weixin = newRemoteChannel('weixin')

    expect(feishu.label).toBe('feishu agent')
    expect(feishu.agentProfile.name).toBe('feishu agent')
    expect(feishu.runtimeId).toBe('codex')
    expect(weixin.label).toBe('weixin agent')
    expect(weixin.agentProfile.name).toBe('weixin agent')
    expect(weixin.runtimeId).toBe('codex')
  })

  it('recognizes current remote-channel summaries but not legacy Claw titles as managed sessions', () => {
    expect(
      remoteChannelThreadTitleLooksManaged(`${REMOTE_CHANNEL_MANAGED_INSTRUCTIONS_HEADING} SciForge scheduled-task tools`)
    ).toBe(true)
    expect(isRemoteChannelThread({ id: 'remote-channel', title: '[Remote channel:Feishu Agent]' })).toBe(true)
    expect(isRemoteChannelThread({ id: 'kun-leaked', title: '[Claw:Feishu Agent]' })).toBe(false)
    expect(isRemoteChannelThread({ id: 'kun-im-leaked', title: '[Claw IM:Feishu Agent]' })).toBe(false)
  })

  it('does not treat a normal desktop session as remote-channel-managed just because IM is bound to it', () => {
    expect(
      isRemoteChannelThread(
        { id: 'sciforge-conversation', title: 'hi' },
        [clawChannel()]
      )
    ).toBe(false)
  })

  it('normalizes and caps persisted turn model labels', () => {
    const raw: Record<string, unknown> = {
      'bad-key': 'bad-model',
      'thread-empty|item-empty': '',
      'thread-number|item-number': 42
    }
    for (let index = 0; index < MAX_TURN_MODEL_LABELS + 5; index += 1) {
      raw[`thread-${index}|item-${index}`] = ` model-${index} `
    }

    const normalized = normalizeTurnModelMap(raw)

    expect(Object.keys(normalized)).toHaveLength(MAX_TURN_MODEL_LABELS)
    expect(normalized['thread-0|item-0']).toBeUndefined()
    expect(normalized['thread-5|item-5']).toBe('model-5')
    expect(normalized['thread-empty|item-empty']).toBeUndefined()
    expect(normalized['thread-number|item-number']).toBeUndefined()
    expect(normalized['bad-key']).toBeUndefined()
  })

  it('persists turn model labels with trimming, pruning, and hydration support', () => {
    const raw: Record<string, string> = {}
    for (let index = 0; index < MAX_TURN_MODEL_LABELS; index += 1) {
      raw[`thread-${index}|item-${index}`] = `model-${index}`
    }
    localStorage.setItem(TURN_MODEL_STORAGE_KEY, JSON.stringify(raw))

    rememberTurnModel(' thread-new ', ' item-new ', ' deepseek-chat ')

    const stored = JSON.parse(localStorage.getItem(TURN_MODEL_STORAGE_KEY) ?? '{}') as Record<string, string>
    expect(Object.keys(stored)).toHaveLength(MAX_TURN_MODEL_LABELS)
    expect(stored['thread-0|item-0']).toBeUndefined()
    expect(stored['thread-new|item-new']).toBe('deepseek-chat')
    expect(
      hydrateBlockModelLabels('thread-new', [
        { kind: 'user', id: 'item-new', text: 'hello' },
        { kind: 'assistant', id: 'assistant-1', text: 'hi' }
      ])
    ).toEqual([
      { kind: 'user', id: 'item-new', text: 'hello', modelLabel: 'deepseek-chat' },
      { kind: 'assistant', id: 'assistant-1', text: 'hi' }
    ])
  })
})
