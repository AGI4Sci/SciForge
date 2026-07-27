import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { RemoteChannelV1 } from '@shared/app-settings'
import {
  RemoteGuardDetailView,
  latestRemoteGuardMessages,
  remoteGuardChannelTitle,
  remoteGuardTargetThread
} from './RemoteGuardDetailView'

function discordChannel(overrides: Partial<RemoteChannelV1> = {}): RemoteChannelV1 {
  const base: RemoteChannelV1 = {
    id: 'discord-channel',
    provider: 'discord',
    label: 'discord bot',
    enabled: true,
    model: 'auto',
    runtimeId: 'codex',
    agentThreadIds: {
      sciforge: 'kun-thread',
      codex: 'codex-thread'
    },
    workspaceRoot: '/Users/zxy/SciForge',
    agentProfile: {
      name: 'discord bot',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    platformCredential: {
      kind: 'discord',
      applicationId: 'app-1',
      botId: 'bot-1',
      botUsername: 'deepseek-bot',
      guildId: 'guild-1',
      guildName: 'gzy server',
      channelId: 'channel-1',
      channelName: 'debug',
      createdAt: '2026-06-13T00:00:00.000Z'
    },
    remoteSession: {
      chatId: 'channel-1',
      messageId: 'message-2',
      threadId: 'channel-1',
      senderId: 'user-1',
      senderName: 'Alice',
      updatedAt: '2026-06-13T00:02:00.000Z'
    },
    conversations: [],
    recentMessages: [
      {
        provider: 'discord',
        channelId: 'discord-channel',
        chatId: 'channel-1',
        remoteThreadId: '',
        messageId: 'message-1',
        senderName: 'Alice',
        text: 'Q1',
        receivedAt: '2026-06-13T00:01:00.000Z'
      },
      {
        provider: 'discord',
        channelId: 'discord-channel',
        chatId: 'channel-1',
        remoteThreadId: '',
        messageId: 'message-2',
        senderName: 'Alice',
        text: 'Q2',
        receivedAt: '2026-06-13T00:02:00.000Z'
      }
    ],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:02:00.000Z'
  }
  return { ...base, ...overrides }
}

const labels: Record<string, string> = {
  remoteGuardStatusActive: 'Guarding',
  remoteGuardStatusPaused: 'Paused',
  remoteGuardSubtitle: 'Remote entry for supervised work.',
  remoteGuardManage: 'Manage',
  remoteGuardWorkspace: 'Workspace',
  remoteGuardDefaultWorkspace: 'App workspace',
  remoteGuardCurrentThread: 'Work thread',
  remoteGuardNoThread: 'No thread',
  remoteGuardRemoteUser: 'Remote user',
  remoteGuardNoRemoteUser: 'No user',
  remoteGuardLastFailure: 'Last remote failure',
  remoteGuardFailureKind: 'Failure kind {{kind}}',
  remoteGuardOpenThread: 'Open work thread',
  remoteGuardNewHint: 'Send /new remotely to start a fresh topic.',
  remoteGuardRecentMessages: 'Recent remote messages',
  remoteGuardNoMessages: 'No messages yet',
  remoteGuardCommands: 'Remote commands',
  remoteGuardCommandWhere: 'Show current project and work thread.',
  remoteGuardCommandNew: 'Start a fresh local topic for this entry.',
  remoteGuardCommandSummary: 'Ask for a short summary of current work.',
  remoteGuardCommandAttach: 'Attach this entry to the current desktop thread.'
}

function t(key: string, opts?: Record<string, unknown>): string {
  const template = labels[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''))
}

describe('RemoteGuardDetailView', () => {
  it('renders the remote endpoint as a guard entry rather than a chat transcript', () => {
    const channel = discordChannel()
    const html = renderToStaticMarkup(
      createElement(RemoteGuardDetailView, {
        channel,
        onOpenThread: vi.fn(),
        onOpenSettings: vi.fn(),
        t
      })
    )

    expect(html).toContain('#debug')
    expect(html).toContain('Discord')
    expect(html).toContain('Guarding')
    expect(html).toContain('SciForge')
    expect(html).toContain('codex:codex-...read')
    expect(html).toContain('Alice: Q2')
    expect(html).toContain('/new')
    expect(html).toContain('Open work thread')
  })

  it('resolves the preferred runtime thread mapping for the guard entry', () => {
    const channel = discordChannel()

    expect(remoteGuardChannelTitle(channel)).toBe('#debug')
    expect(remoteGuardTargetThread(channel)).toEqual({
      threadId: 'codex-thread',
      runtimeId: 'codex'
    })
    expect(latestRemoteGuardMessages(channel).map((message) => message.messageId)).toEqual([
      'message-2',
      'message-1'
    ])
  })

  it('keeps paused guard entries visible without inventing a mapped thread', () => {
    const channel = discordChannel({
      enabled: false,
      agentThreadIds: {},
      remoteSession: undefined,
      recentMessages: []
    })
    const html = renderToStaticMarkup(
      createElement(RemoteGuardDetailView, {
        channel,
        onOpenThread: vi.fn(),
        onOpenSettings: vi.fn(),
        t
      })
    )

    expect(html).toContain('Paused')
    expect(html).toContain('No thread')
    expect(html).toContain('No user')
    expect(html).toContain('No messages yet')
    expect(remoteGuardTargetThread(channel)).toBeNull()
  })

  it('keeps legacy SciForge thread mappings visible but not openable', () => {
    const channel = discordChannel({
      runtimeId: 'sciforge',
      agentThreadIds: { sciforge: 'legacy-thread' }
    })
    const onOpenThread = vi.fn()
    const html = renderToStaticMarkup(
      createElement(RemoteGuardDetailView, {
        channel,
        onOpenThread,
        onOpenSettings: vi.fn(),
        t
      })
    )

    expect(remoteGuardTargetThread(channel)).toEqual({
      threadId: 'legacy-thread',
      runtimeId: 'sciforge'
    })
    expect(html).toContain('sciforge:legacy...read')
    expect(html).toContain('title="legacy-thread"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Open work thread<\/button>/)
    expect(onOpenThread).not.toHaveBeenCalled()
  })

  it('shows the latest remote failure reason on the desktop guard page', () => {
    const channel = discordChannel({
      lastFailure: {
        provider: 'discord',
        message: 'Runtime offline',
        failureKind: 'runtime_offline',
        channelId: 'discord-channel',
        chatId: 'channel-1',
        threadId: 'codex-thread',
        runtimeId: 'codex',
        occurredAt: '2026-06-13T00:03:00.000Z'
      }
    })
    const html = renderToStaticMarkup(
      createElement(RemoteGuardDetailView, {
        channel,
        onOpenThread: vi.fn(),
        onOpenSettings: vi.fn(),
        t
      })
    )

    expect(html).toContain('Last remote failure')
    expect(html).toContain('Runtime offline')
    expect(html).toContain('Failure kind runtime_offline')
  })
})
