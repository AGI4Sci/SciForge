import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1,
  type RemoteChannelV1
} from '../shared/app-settings'
import { createDiscordBotRuntime } from './discord-bot-runtime'

afterEach(() => {
  vi.unstubAllGlobals()
})

function settings(channel: RemoteChannelV1): AppSettingsV1 {
  return {
    version: 1,
    installationId: 'dsgui-local',
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    modelRouter: defaultModelRouterSettings(),
    activeAgentRuntime: 'sciforge',
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 2 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: {
      ...defaultRemoteChannelSettings(),
      enabled: true,
      im: {
        ...defaultRemoteChannelSettings().im,
        enabled: true,
        provider: 'discord'
      },
      channels: [channel]
    },
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function discordChannel(): RemoteChannelV1 {
  return {
    id: 'discord-bot-1-guild-1-channel-1',
    provider: 'discord',
    label: '#support',
    enabled: true,
    model: 'auto',
    runtimeId: 'sciforge',
    agentThreadIds: {},
    workspaceRoot: '/tmp/support',
    agentProfile: {
      name: 'Support bot',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    platformCredential: {
      kind: 'discord',
      applicationId: 'client-1',
      botId: 'bot-1',
      botUsername: 'DeepSeek',
      guildId: 'guild-1',
      guildName: 'Support server',
      channelId: 'channel-1',
      channelName: 'support',
      installationId: 'dsgui-other',
      guardOwnerInstallationId: 'dsgui-other',
      guardOwnerUpdatedAt: '2026-06-13T00:00:00.000Z',
      createdAt: '2026-06-13T00:00:00.000Z'
    },
    conversations: [],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z'
  }
}

type TestDiscordSocket = {
  readyState: number
  onmessage: ((event: { data?: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: (() => void) | null
  onopen: (() => void) | null
  send: (data: string) => void
  close: () => void
}

async function waitForCondition(condition: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for test condition.')
}

function writeDiscordBotSecret(userDataPath: string): void {
  writeFileSync(join(userDataPath, 'discord-bot.json'), JSON.stringify({
    botToken: 'token-1',
    clientId: 'client-1',
    bot: {
      applicationId: 'client-1',
      botId: 'bot-1',
      botUsername: 'DeepSeek',
      inviteUrl: 'https://discord.com/oauth2/authorize?client_id=client-1'
    },
    updatedAt: '2026-06-13T00:00:00.000Z'
  }))
}

function localDiscordChannel(): RemoteChannelV1 {
  const channel = discordChannel()
  channel.platformCredential = {
    ...channel.platformCredential as Extract<RemoteChannelV1['platformCredential'], { kind: 'discord' }>,
    installationId: 'dsgui-local',
    guardOwnerInstallationId: 'dsgui-local'
  }
  return channel
}

type DiscordGatewayStub = TestDiscordSocket[] & {
  createWebSocket: (url: string) => TestDiscordSocket
}

function stubDiscordGateway(): DiscordGatewayStub {
  const sockets = [] as unknown as DiscordGatewayStub
  sockets.createWebSocket = (_url: string): TestDiscordSocket => {
    const socket: TestDiscordSocket = {
      readyState: 1,
      onmessage: null,
      onerror: null,
      onclose: null,
      onopen: null,
      send: vi.fn(),
      close: vi.fn()
    }
    sockets.push(socket)
    return socket
  }
  return sockets
}

type DiscordStatusProbe = {
  status: () => Promise<{ connected: boolean }>
}

async function openDiscordGateway(
  sockets: TestDiscordSocket[],
  runtime?: DiscordStatusProbe
): Promise<TestDiscordSocket> {
  await waitForCondition(() => Boolean(sockets[0]?.onmessage))
  expect(sockets[0]).toBeDefined()
  const socket = sockets[0]
  expect(socket.onmessage).toEqual(expect.any(Function))
  socket.onmessage?.({
    data: JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } })
  })
  socket.onmessage?.({
    data: JSON.stringify({
      op: 0,
      s: 1,
      t: 'READY',
      d: { session_id: 'session-1', user: { id: 'bot-1' }, guilds: [{ id: 'guild-1' }] }
    })
  })
  if (runtime) {
    await waitForCondition(async () => (await runtime.status()).connected)
  }
  return socket
}

describe('DiscordBotRuntime guard ownership', () => {
  it('uses app workspace for internal remote-channel requests and preserves legacy Claw roots', async () => {
    const userDataPath = join(tmpdir(), `sciforge-discord-workspace-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'discord-bot.json'), JSON.stringify({
      botToken: 'token-1',
      clientId: 'client-1',
      bot: {
        applicationId: 'client-1',
        botId: 'bot-1',
        botUsername: 'DeepSeek',
        inviteUrl: 'https://discord.com/oauth2/authorize?client_id=client-1'
      },
      updatedAt: '2026-06-13T00:00:00.000Z'
    }))

    try {
      let current: AppSettingsV1 = {
        ...settings(discordChannel()),
        workspaceRoot: '/repo/current',
        remoteChannel: {
          ...settings(discordChannel()).remoteChannel,
          channels: []
        }
      }
      const store = {
        load: vi.fn(async () => current),
        patch: vi.fn(async (patch: Partial<AppSettingsV1>) => {
          current = {
            ...current,
            ...patch,
            remoteChannel: {
              ...current.remoteChannel,
              ...patch.remoteChannel,
              im: {
                ...current.remoteChannel.im,
                ...(patch.remoteChannel?.im ?? {})
              },
              channels: (patch.remoteChannel?.channels as RemoteChannelV1[] | undefined) ?? current.remoteChannel.channels
            }
          }
          return current
        })
      }
      const runtime = createDiscordBotRuntime({
        store: store as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn()
      })

      await expect(runtime.bindChannel({
        guildId: 'guild-1',
        guildName: 'Support server',
        channelId: 'channel-1',
        channelName: 'support',
        enabled: false
      })).resolves.toMatchObject({ ok: true })
      expect(current.remoteChannel.channels[0].workspaceRoot).toBe('/repo/current')
      expect(current.remoteChannel.channels[0].guardMode).toBe('all_messages')

      await expect(runtime.bindChannel({
        guildId: 'guild-1',
        guildName: 'Support server',
        channelId: 'channel-1',
        channelName: 'support',
        workspaceRoot: '/Users/zxy/.sciforge/remote-channel/discord/server/channel'
      })).resolves.toMatchObject({ ok: true })
      expect(current.remoteChannel.channels[0].workspaceRoot).toBe('/repo/current')

      const legacyClawWorkspaceRoot = '/Users/zxy/.sciforge/claw/discord/server/channel'
      await expect(runtime.bindChannel({
        guildId: 'guild-1',
        guildName: 'Support server',
        channelId: 'channel-1',
        channelName: 'support',
        workspaceRoot: legacyClawWorkspaceRoot
      })).resolves.toMatchObject({ ok: true })
      expect(current.remoteChannel.channels[0].workspaceRoot).toBe(legacyClawWorkspaceRoot)
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('reports another installation guarding the same bot/channel and supports force takeover', async () => {
    const userDataPath = join(tmpdir(), `sciforge-discord-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'discord-bot.json'), JSON.stringify({
      botToken: 'token-1',
      clientId: 'client-1',
      bot: {
        applicationId: 'client-1',
        botId: 'bot-1',
        botUsername: 'DeepSeek',
        inviteUrl: 'https://discord.com/oauth2/authorize?client_id=client-1'
      },
      updatedAt: '2026-06-13T00:00:00.000Z'
    }))

    try {
      let current = settings(discordChannel())
      const store = {
        load: vi.fn(async () => current),
        patch: vi.fn(async (patch: Partial<AppSettingsV1>) => {
          current = {
            ...current,
            ...patch,
            remoteChannel: {
              ...current.remoteChannel,
              ...patch.remoteChannel,
              im: {
                ...current.remoteChannel.im,
                ...(patch.remoteChannel?.im ?? {})
              },
              channels: (patch.remoteChannel?.channels as RemoteChannelV1[] | undefined) ?? current.remoteChannel.channels
            }
          }
          return current
        })
      }
      const runtime = createDiscordBotRuntime({
        store: store as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn()
      })

      const initial = await runtime.status()
      expect(initial.conflict).toMatchObject({
        channelConfigId: 'discord-bot-1-guild-1-channel-1',
        ownerInstallationId: 'dsgui-other',
        currentInstallationId: 'dsgui-local'
      })

      await expect(
        runtime.setGuard(true, { channelConfigId: 'discord-bot-1-guild-1-channel-1' })
      ).resolves.toMatchObject({
        ok: false,
        conflict: {
          ownerInstallationId: 'dsgui-other'
        }
      })

      await expect(
        runtime.setGuard(true, {
          channelConfigId: 'discord-bot-1-guild-1-channel-1',
          forceTakeover: true
        })
      ).resolves.toMatchObject({ ok: true })
      expect(current.remoteChannel.channels[0].platformCredential).toMatchObject({
        guardOwnerInstallationId: 'dsgui-local'
      })
      expect(current.remoteChannel.channels[0].guardMode).toBe('all_messages')
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('keeps project and thread bindings when toggling guard mode', async () => {
    const userDataPath = join(tmpdir(), `sciforge-discord-guard-bindings-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeDiscordBotSecret(userDataPath)

    try {
      const channel = localDiscordChannel()
      channel.runtimeId = 'codex'
      channel.agentThreadIds = { codex: 'attached-desktop-thread' }
      channel.workspaceRoot = '/repo/attached'
      channel.guardMode = 'all_messages'
      channel.conversations = [{
        id: 'discord-bot-1-guild-1-channel-1::channel-1',
        chatId: 'channel-1',
        remoteThreadId: '',
        latestMessageId: 'discord-message-1',
        senderId: 'user-1',
        senderName: 'Alice',
        runtimeId: 'codex',
        agentThreadIds: { codex: 'attached-desktop-thread' },
        workspaceRoot: '/repo/attached',
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z'
      }]
      let current = settings(channel)
      const store = {
        load: vi.fn(async () => current),
        patch: vi.fn(async (patch: Partial<AppSettingsV1>) => {
          current = {
            ...current,
            ...patch,
            remoteChannel: {
              ...current.remoteChannel,
              ...patch.remoteChannel,
              im: {
                ...current.remoteChannel.im,
                ...(patch.remoteChannel?.im ?? {})
              },
              channels: (patch.remoteChannel?.channels as RemoteChannelV1[] | undefined) ?? current.remoteChannel.channels
            }
          }
          return current
        })
      }
      const runtime = createDiscordBotRuntime({
        store: store as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn()
      })

      await expect(
        runtime.setGuard(false, { channelConfigId: 'discord-bot-1-guild-1-channel-1' })
      ).resolves.toMatchObject({ ok: true })
      expect(current.remoteChannel.channels[0]).toMatchObject({
        enabled: false,
        runtimeId: 'codex',
        agentThreadIds: { codex: 'attached-desktop-thread' },
        workspaceRoot: '/repo/attached',
        conversations: [expect.objectContaining({
          chatId: 'channel-1',
          runtimeId: 'codex',
          agentThreadIds: { codex: 'attached-desktop-thread' },
          workspaceRoot: '/repo/attached'
        })]
      })
      expect(current.remoteChannel.channels[0]).not.toHaveProperty('threadId')
      expect(current.remoteChannel.channels[0].conversations[0]).not.toHaveProperty('localThreadId')

      await expect(
        runtime.setGuard(true, { channelConfigId: 'discord-bot-1-guild-1-channel-1' })
      ).resolves.toMatchObject({ ok: true })
      expect(current.remoteChannel.channels[0]).toMatchObject({
        enabled: true,
        guardMode: 'all_messages',
        runtimeId: 'codex',
        agentThreadIds: { codex: 'attached-desktop-thread' },
        workspaceRoot: '/repo/attached',
        conversations: [expect.objectContaining({
          chatId: 'channel-1',
          runtimeId: 'codex',
          agentThreadIds: { codex: 'attached-desktop-thread' },
          workspaceRoot: '/repo/attached'
        })]
      })
      expect(current.remoteChannel.channels[0]).not.toHaveProperty('threadId')
      expect(current.remoteChannel.channels[0].conversations[0]).not.toHaveProperty('localThreadId')
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('reports an access error when the connected bot cannot see the bound channel', async () => {
    const userDataPath = join(tmpdir(), `sciforge-discord-access-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'discord-bot.json'), JSON.stringify({
      botToken: 'token-1',
      clientId: 'client-1',
      bot: {
        applicationId: 'client-1',
        botId: 'bot-1',
        botUsername: 'DeepSeek',
        inviteUrl: 'https://discord.com/oauth2/authorize?client_id=client-1'
      },
      updatedAt: '2026-06-13T00:00:00.000Z'
    }))
    const sockets = stubDiscordGateway()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/channels/channel-1')) {
        return new Response(JSON.stringify({ message: 'Unknown Channel', code: 10003 }), {
          status: 404,
          statusText: 'Not Found'
        })
      }
      return new Response(JSON.stringify({ id: 'channel-1', name: 'support', type: 0 }))
    }))
    let runtime: ReturnType<typeof createDiscordBotRuntime> | null = null

    try {
      const channel = discordChannel()
      channel.platformCredential = {
        ...channel.platformCredential as Extract<RemoteChannelV1['platformCredential'], { kind: 'discord' }>,
        installationId: 'dsgui-local',
        guardOwnerInstallationId: 'dsgui-local'
      }
      const current = settings(channel)
      runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => current), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn(),
        createWebSocket: sockets.createWebSocket
      })

      runtime.sync(current)
      await openDiscordGateway(sockets, runtime)
      const activeRuntime = runtime
      await waitForCondition(async () => {
        const status = await activeRuntime.status()
        return Boolean(
          status.connected &&
            !status.enabled &&
            status.channels?.[0]?.accessError?.includes('cannot see this Discord channel')
        )
      })

      await expect(activeRuntime.status()).resolves.toMatchObject({
        connected: true,
        enabled: false,
        channels: [
          {
            connected: false,
            accessError: expect.stringContaining('cannot see this Discord channel')
          }
        ]
      })
    } finally {
      runtime?.stop()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('handles Discord slash /new interactions through the shared IM command path', async () => {
    const userDataPath = join(tmpdir(), `sciforge-discord-interaction-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'discord-bot.json'), JSON.stringify({
      botToken: 'token-1',
      clientId: 'client-1',
      bot: {
        applicationId: 'client-1',
        botId: 'bot-1',
        botUsername: 'DeepSeek',
        inviteUrl: 'https://discord.com/oauth2/authorize?client_id=client-1'
      },
      updatedAt: '2026-06-13T00:00:00.000Z'
    }))
    const sockets = stubDiscordGateway()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }))
    )
    vi.stubGlobal('fetch', fetchMock)

    try {
      const channel = discordChannel()
      channel.platformCredential = {
        ...channel.platformCredential as Extract<RemoteChannelV1['platformCredential'], { kind: 'discord' }>,
        installationId: 'dsgui-local',
        guardOwnerInstallationId: 'dsgui-local'
      }
      const current = settings(channel)
      const handleIncomingMessage = vi.fn(async () => ({
        ok: true as const,
        reply: 'Started a new topic. The next message will create a fresh local conversation.',
        message: 'Started a new topic.'
      }))
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => current), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage,
        logError: vi.fn(),
        createWebSocket: sockets.createWebSocket
      })

      runtime.sync(current)
      const socket = await openDiscordGateway(sockets, runtime)
      socket.onmessage?.({
        data: JSON.stringify({
          op: 0,
          s: 2,
          t: 'INTERACTION_CREATE',
          d: {
            id: 'interaction-1',
            token: 'interaction-token',
            application_id: 'client-1',
            type: 2,
            guild_id: 'guild-1',
            channel_id: 'channel-1',
            data: { name: 'new', type: 1 },
            member: {
              user: { id: 'user-1', username: 'Alice', global_name: 'Alice' }
            }
          }
        })
      })

      await waitForCondition(() =>
        handleIncomingMessage.mock.calls.length > 0 &&
          fetchMock.mock.calls.some(([url]) =>
            String(url).includes('/interactions/interaction-1/interaction-token/callback')
          )
      )

      expect(handleIncomingMessage).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'discord',
        channelId: 'discord-bot-1-guild-1-channel-1',
        text: '/new',
        sender: 'Alice',
        remoteSession: expect.objectContaining({
          chatId: 'channel-1',
          messageId: 'interaction-1',
          senderId: 'user-1',
          senderName: 'Alice'
        })
      }))
      const interactionReplyCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/interactions/interaction-1/interaction-token/callback')
      )
      expect(interactionReplyCall).toBeDefined()
      const [, init] = interactionReplyCall ?? []
      expect(JSON.parse(String(init?.body))).toMatchObject({
        type: 4,
        data: {
          content: expect.stringContaining('Started a new topic'),
          allowed_mentions: { parse: [] }
        }
      })
      runtime.stop()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})

describe('DiscordBotRuntime remote failure replies', () => {
  it('sends a generic Discord message failure when runtime diagnostics contain secrets and paths', async () => {
    const userDataPath = join(tmpdir(), `sciforge-discord-message-failure-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeDiscordBotSecret(userDataPath)
    const sockets = stubDiscordGateway()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/typing')) return new Response(null, { status: 204 })
      return new Response(JSON.stringify({ id: 'reply-1' }))
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const current = settings(localDiscordChannel())
      const sensitiveMessage = 'Provider token=sk-proj-secret failed in /Users/alice/.sciforge/remote-channel/runtime.json'
      const handleIncomingMessage = vi.fn(async () => ({
        ok: false as const,
        message: sensitiveMessage,
        details: {
          provider: 'openai',
          token: 'sk-proj-secret',
          path: '/Users/alice/.sciforge/remote-channel/runtime.json'
        }
      }))
      const logError = vi.fn()
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => current), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage,
        logError,
        createWebSocket: sockets.createWebSocket
      })

      runtime.sync(current)
      const socket = await openDiscordGateway(sockets, runtime)
      socket.onmessage?.({
        data: JSON.stringify({
          op: 0,
          s: 2,
          t: 'MESSAGE_CREATE',
          d: {
            id: 'message-1',
            channel_id: 'channel-1',
            guild_id: 'guild-1',
            content: 'help me',
            author: { id: 'user-1', username: 'Alice', global_name: 'Alice' },
            mentions: []
          }
        })
      })

      await waitForCondition(() =>
        fetchMock.mock.calls.some(([url]) => String(url).includes('/channels/channel-1/messages'))
      )

      const replyCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/channels/channel-1/messages')
      )
      expect(replyCall).toBeDefined()
      const body = JSON.parse(String(replyCall?.[1]?.body))
      expect(body.content).toBe('Sorry, I could not process that message.')
      expect(JSON.stringify(body)).not.toContain('sk-proj-secret')
      expect(JSON.stringify(body)).not.toContain('/Users/alice')
      expect(logError).toHaveBeenCalledWith(
        'remote-channel-discord',
        'Remote-channel runtime returned a failure for Discord message.',
        expect.objectContaining({
          message: 'Provider token=<redacted> failed in /Users/alice/.sciforge/remote-channel/runtime.json',
          result: expect.objectContaining({
            message: 'Provider token=<redacted> failed in /Users/alice/.sciforge/remote-channel/runtime.json',
            details: expect.objectContaining({
              token: '<redacted>',
              path: '/Users/alice/.sciforge/remote-channel/runtime.json'
            })
          })
        })
      )
      runtime.stop()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('sends the local-thread-deleted rebind guidance instead of a generic Discord failure', async () => {
    const userDataPath = join(tmpdir(), `sciforge-discord-local-thread-deleted-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeDiscordBotSecret(userDataPath)
    const sockets = stubDiscordGateway()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/typing')) return new Response(null, { status: 204 })
      return new Response(JSON.stringify({ id: 'reply-1' }))
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const current = settings(localDiscordChannel())
      const handleIncomingMessage = vi.fn(async () => ({
        ok: false as const,
        failureKind: 'local_thread_deleted',
        failureTitle: 'Local thread deleted',
        recoverable: true,
        message: 'The local thread bound to this remote conversation was deleted or is unreadable. Send `/new <title>` to create one, or send `/threads` and then `/use thread <number>` to select another thread.'
      }))
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => current), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage,
        logError: vi.fn(),
        createWebSocket: sockets.createWebSocket
      })

      runtime.sync(current)
      const socket = await openDiscordGateway(sockets, runtime)
      socket.onmessage?.({
        data: JSON.stringify({
          op: 0,
          s: 2,
          t: 'MESSAGE_CREATE',
          d: {
            id: 'message-1',
            channel_id: 'channel-1',
            guild_id: 'guild-1',
            content: 'continue',
            author: { id: 'user-1', username: 'Alice', global_name: 'Alice' },
            mentions: []
          }
        })
      })

      await waitForCondition(() =>
        fetchMock.mock.calls.some(([url]) => String(url).includes('/channels/channel-1/messages'))
      )

      const replyCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/channels/channel-1/messages')
      )
      expect(replyCall).toBeDefined()
      const body = JSON.parse(String(replyCall?.[1]?.body))
      expect(body.content).toContain('deleted or is unreadable')
      expect(body.content).toContain('/new <title>')
      expect(body.content).toContain('/use thread <number>')
      runtime.stop()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('sends a generic Discord slash failure when runtime diagnostics contain secrets and paths', async () => {
    const userDataPath = join(tmpdir(), `sciforge-discord-slash-failure-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeDiscordBotSecret(userDataPath)
    const sockets = stubDiscordGateway()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }))
    )
    vi.stubGlobal('fetch', fetchMock)

    try {
      const current = settings(localDiscordChannel())
      const sensitiveMessage = 'Provider token=sk-proj-secret failed in /Users/alice/.sciforge/remote-channel/runtime.json'
      const handleIncomingMessage = vi.fn(async () => ({
        ok: false as const,
        message: sensitiveMessage,
        details: {
          provider: 'openai',
          token: 'sk-proj-secret',
          path: '/Users/alice/.sciforge/remote-channel/runtime.json'
        }
      }))
      const logError = vi.fn()
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => current), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage,
        logError,
        createWebSocket: sockets.createWebSocket
      })

      runtime.sync(current)
      const socket = await openDiscordGateway(sockets, runtime)
      socket.onmessage?.({
        data: JSON.stringify({
          op: 0,
          s: 2,
          t: 'INTERACTION_CREATE',
          d: {
            id: 'interaction-1',
            token: 'interaction-token',
            application_id: 'client-1',
            type: 2,
            guild_id: 'guild-1',
            channel_id: 'channel-1',
            data: { name: 'status', type: 1 },
            member: {
              user: { id: 'user-1', username: 'Alice', global_name: 'Alice' }
            }
          }
        })
      })

      await waitForCondition(() =>
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/interactions/interaction-1/interaction-token/callback')
        )
      )

      const replyCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/interactions/interaction-1/interaction-token/callback')
      )
      expect(replyCall).toBeDefined()
      const body = JSON.parse(String(replyCall?.[1]?.body))
      expect(body.data.content).toBe('Sorry, I could not process that command.')
      expect(JSON.stringify(body)).not.toContain('sk-proj-secret')
      expect(JSON.stringify(body)).not.toContain('/Users/alice')
      expect(logError).toHaveBeenCalledWith(
        'remote-channel-discord',
        'Remote-channel runtime returned a failure for Discord interaction.',
        expect.objectContaining({
          message: 'Provider token=<redacted> failed in /Users/alice/.sciforge/remote-channel/runtime.json',
          result: expect.objectContaining({
            message: 'Provider token=<redacted> failed in /Users/alice/.sciforge/remote-channel/runtime.json',
            details: expect.objectContaining({
              token: '<redacted>',
              path: '/Users/alice/.sciforge/remote-channel/runtime.json'
            })
          })
        })
      )
      runtime.stop()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})

describe('DiscordBotRuntime token setup errors', () => {
  it('saves a Discord-only HTTP proxy URL in status', async () => {
    const userDataPath = join(tmpdir(), `sciforge-discord-proxy-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })

    try {
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => settings(discordChannel())), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn()
      })

      await expect(runtime.configureProxy(' http://127.0.0.1:7890 ')).resolves.toMatchObject({
        ok: true,
        status: {
          proxyUrl: 'http://127.0.0.1:7890/'
        }
      })
      await expect(runtime.status()).resolves.toMatchObject({
        proxyUrl: 'http://127.0.0.1:7890/'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('uses the configured proxy for Discord token setup requests', async () => {
    const userDataPath = join(tmpdir(), `sciforge-discord-proxy-fetch-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'discord-bot.json'), JSON.stringify({
      clientId: 'client-1',
      proxyUrl: 'http://127.0.0.1:7890/',
      updatedAt: '2026-06-13T00:00:00.000Z'
    }))
    const proxyFetch = vi.fn(async (url: string, _proxyUrl: string, _init?: RequestInit) => {
      if (url.endsWith('/users/@me')) {
        return new Response(JSON.stringify({
          id: 'bot-1',
          username: 'DeepSeek',
          bot: true
        }))
      }
      if (url.endsWith('/oauth2/applications/@me')) {
        return new Response(JSON.stringify({ id: 'client-1' }))
      }
      return new Response(JSON.stringify({ message: 'not found' }), {
        status: 404,
        statusText: 'Not Found'
      })
    })

    try {
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => settings(discordChannel())), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn(),
        proxyFetch
      })

      await expect(runtime.configureToken('token-1', 'client-1')).resolves.toMatchObject({
        ok: true,
        status: {
          tokenConfigured: true,
          proxyUrl: 'http://127.0.0.1:7890/'
        }
      })
      expect(proxyFetch).toHaveBeenCalledTimes(2)
      expect(proxyFetch.mock.calls.map((call) => call[1])).toEqual([
        'http://127.0.0.1:7890/',
        'http://127.0.0.1:7890/'
      ])
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('returns an actionable network message when Discord API cannot be reached', async () => {
    const userDataPath = join(tmpdir(), `sciforge-discord-network-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    }))

    try {
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => settings(discordChannel())), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn()
      })

      await expect(runtime.configureToken('token-1', 'client-1')).resolves.toMatchObject({
        ok: false,
        message: expect.stringContaining('Timed out connecting to Discord API')
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('explains rejected tokens instead of surfacing raw Discord REST errors', async () => {
    const userDataPath = join(tmpdir(), `sciforge-discord-token-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ message: '401: Unauthorized', code: 0 }), {
        status: 401,
        statusText: 'Unauthorized'
      })
    ))

    try {
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => settings(discordChannel())), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn()
      })

      await expect(runtime.configureToken('token-1', 'client-1')).resolves.toMatchObject({
        ok: false,
        message: expect.stringContaining('Discord rejected this Bot Token')
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
