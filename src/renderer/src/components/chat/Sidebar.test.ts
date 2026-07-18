import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { RemoteChannelV1 } from '@shared/app-settings'
import { Sidebar, SidebarRemoteChannelSection } from './Sidebar'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN' }
  })
}))

vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    workspaceRoot: '/workspace',
    codeWorkspaceRoots: ['/workspace'],
    hiddenCodeWorkspaceRoots: [],
    chooseWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    busy: false,
    watchTurnCompletion: {},
    unreadThreadIds: {},
    queuedMessages: [],
    remoteChannels: [],
    activeRemoteChannelId: null,
    remoteGuardChannelId: null,
    selectRemoteGuardChannel: vi.fn(),
    addRemoteChannel: vi.fn(),
    deleteRemoteChannel: vi.fn()
  })
}))

type DiscordChannelOverrides = Partial<Omit<RemoteChannelV1, 'provider' | 'platformCredential'>>

function discordChannel(overrides: DiscordChannelOverrides = {}): RemoteChannelV1 {
  const base: RemoteChannelV1 = {
    id: 'discord-channel',
    provider: 'discord',
    label: 'discord bot',
    enabled: true,
    model: 'auto',
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
    conversations: [],
    recentMessages: [],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:02:00.000Z'
  }
  return { ...base, ...overrides }
}

const labels: Record<string, string> = {
  sidebarRemoteChannels: '机器人值守',
  sidebarRemoteChannelGuarding: '值守中',
  sidebarRemoteChannelPaused: '已暂停',
  sidebarRemoteChannelLatest: '最近：{{message}}',
  sidebarRemoteChannelReceived: '最近收到消息',
  sidebarRemoteChannelNoMessages: '等待远端消息'
}

function t(key: string, opts?: Record<string, unknown>): string {
  return (labels[key] ?? key).replace(/\{\{(\w+)}}/g, (_, name: string) => String(opts?.[name] ?? ''))
}

describe('SidebarRemoteChannelSection', () => {
  it('shows Discord guard channels and their latest received message', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarRemoteChannelSection, {
        channels: [
          discordChannel({
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
              }
            ]
          })
        ],
        activeChannelId: 'discord-channel',
        runtimeReady: true,
        onSelectChannel: vi.fn(),
        t
      })
    )

    expect(html).toContain('机器人值守')
    expect(html).toContain('#debug')
    expect(html).toContain('Discord')
    expect(html).toContain('值守中')
    expect(html).toContain('最近：Alice: Q1')
  })

  it('still exposes a watched channel before it has a local conversation thread', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarRemoteChannelSection, {
        channels: [discordChannel()],
        activeChannelId: '',
        runtimeReady: true,
        onSelectChannel: vi.fn(),
        t
      })
    )

    expect(html).toContain('#debug')
    expect(html).toContain('等待远端消息')
  })
})

describe('Sidebar navigation continuity', () => {
  it.each(['schedule'] as const)(
    'keeps core navigation and conversation history visible in the %s view',
    (activeView) => {
      const html = renderToStaticMarkup(
        createElement(Sidebar, {
          threads: [],
          activeThreadId: null,
          activeView,
          connectPhoneSidebarOpen: false,
          pluginsActive: false,
          runtimeReady: true,
          threadSearch: '',
          showArchivedThreads: false,
          onThreadSearchChange: vi.fn(),
          onShowArchivedThreadsChange: vi.fn(),
          onSelectThread: vi.fn(),
          onRenameThread: vi.fn(async () => undefined),
          onArchiveThread: vi.fn(async () => undefined),
          onDeleteThread: vi.fn(async () => undefined),
          onRestoreThread: vi.fn(async () => undefined),
          onNewChat: vi.fn(),
          onNewChatInWorkspace: vi.fn(),
          onOpenSettings: vi.fn(),
          onOpenPlugins: vi.fn(),
          onToggleConnectPhone: vi.fn(),
          onScheduleOpen: vi.fn(),
          onToggleSidebar: vi.fn()
        })
      )

      expect(html).toContain('newAgent')
      expect(html).toContain('plugins')
      expect(html).toContain('schedule')
      expect(html).not.toContain('workflow')
      expect(html).toContain('sidebarProjects')
      expect(html).not.toContain('workflowSidebarHint')
    }
  )
})
