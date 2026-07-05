import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultCodexRuntimeSettings,
  defaultConnectPhoneSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultRemoteChannelSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1,
  type RemoteChannelV1
} from '../shared/app-settings'
import { createZulipBotRuntime } from './zulip-bot-runtime'

afterEach(() => {
  vi.restoreAllMocks()
})

function settings(): AppSettingsV1 {
  return {
    version: 1,
    installationId: 'sciforge-local',
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
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
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

describe('ZulipBotRuntime', () => {
  it('configures a self-hosted bot, binds a stream topic, and sends a test message', async () => {
    const userDataPath = join(tmpdir(), `sciforge-zulip-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    let current = settings()
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
    const sentBodies: URLSearchParams[] = []
    const fetchStub = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      if (url.pathname === '/api/v1/users/me') {
        expect(init?.headers).toBeDefined()
        return jsonResponse({
          user_id: 42,
          email: 'sciforge-bot@chat.sciforge.cn',
          full_name: 'SciForge Bot',
          is_bot: true
        })
      }
      if (url.pathname === '/api/v1/users/me/subscriptions') {
        return jsonResponse({
          subscriptions: [
            { stream_id: 12, name: 'science' }
          ]
        })
      }
      if (url.pathname === '/api/v1/messages') {
        const body = init?.body
        expect(body).toBeInstanceOf(URLSearchParams)
        sentBodies.push(body as URLSearchParams)
        return jsonResponse({ id: 99 })
      }
      throw new Error(`Unexpected Zulip URL ${url.pathname}`)
    })
    const runtime = createZulipBotRuntime({
      store: store as never,
      userDataPath,
      handleIncomingMessage: vi.fn(),
      logError: vi.fn(),
      fetch: fetchStub
    })

    try {
      await expect(runtime.configure({
        realmUrl: 'https://chat.sciforge.cn/',
        botEmail: 'sciforge-bot@chat.sciforge.cn',
        apiKey: 'zulip-api-key'
      })).resolves.toMatchObject({
        ok: true,
        status: {
          configured: true,
          bot: {
            realmUrl: 'https://chat.sciforge.cn',
            botEmail: 'sciforge-bot@chat.sciforge.cn',
            botUserId: '42',
            botFullName: 'SciForge Bot'
          }
        }
      })

      const bind = await runtime.bindChannel({
        streamId: '12',
        streamName: 'science',
        topicName: 'agent',
        enabled: false,
        workspaceRoot: '/tmp/science',
        agentProfile: { name: 'zulip bot' }
      })
      expect(bind).toMatchObject({ ok: true })
      expect(current.remoteChannel.im).toMatchObject({ enabled: true, provider: 'zulip' })
      expect(current.remoteChannel.channels[0]).toMatchObject({
        provider: 'zulip',
        label: 'science · #agent',
        enabled: false,
        guardMode: 'all_messages',
        workspaceRoot: '/tmp/science',
        platformCredential: {
          kind: 'zulip',
          realmUrl: 'https://chat.sciforge.cn',
          botEmail: 'sciforge-bot@chat.sciforge.cn',
          streamId: '12',
          streamName: 'science',
          topicName: 'agent'
        }
      })

      await expect(runtime.testSend('12', 'hello from test', {
        channelConfigId: bind.ok ? bind.channelConfigId : undefined,
        topicName: 'agent'
      })).resolves.toEqual({
        ok: true,
        messageId: '99'
      })
      expect(sentBodies.at(-1)?.get('type')).toBe('stream')
      expect(sentBodies.at(-1)?.get('to')).toBe('12')
      expect(sentBodies.at(-1)?.get('topic')).toBe('agent')
      expect(sentBodies.at(-1)?.get('content')).toBe('hello from test')
    } finally {
      runtime.stop()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
