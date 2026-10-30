import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { detectScheduledTaskRequest } from './scheduled-task-detector'

function settings(): AppSettingsV1 {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.baseUrl = 'http://127.0.0.1:49876/v1'
  modelRouter.publicModelAlias = 'sciforge-router'
  modelRouter.runtimeApiKey = 'local-runtime-router-key'
  modelRouter.profiles.default.textReasoner = {
    baseUrl: 'https://text-provider.example/v1',
    apiKey: 'text-secret',
    model: 'text-model'
  }
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    modelRouter,
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    skills: defaultSkillsSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('detectScheduledTaskRequest Model Router calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts reminder extraction to the local Model Router Responses API', async () => {
    const calls: Array<{ url: string; headers: HeadersInit | undefined; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init.headers,
        body: JSON.parse(String(init.body ?? '{}'))
      })
      return new Response(JSON.stringify({
        output_text: '{"shouldCreateTask":false}'
      }), { status: 200 })
    })

    await detectScheduledTaskRequest(
      settings(),
      'remind me tomorrow to stretch',
      new Date('2026-06-09T12:00:00+08:00')
    )

    expect(calls[0]).toMatchObject({
      url: 'http://127.0.0.1:49876/v1/responses',
      headers: {
        Authorization: 'Bearer local-runtime-router-key'
      },
      body: {
        model: 'sciforge-router',
        input: 'remind me tomorrow to stretch',
        max_output_tokens: 300,
        text: { format: { type: 'json_object' } }
      }
    })
  })

  it('fails closed without a Model Router runtime key', async () => {
    const appSettings = settings()
    appSettings.modelRouter = {
      ...appSettings.modelRouter!,
      runtimeApiKey: ''
    }
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await detectScheduledTaskRequest(
      appSettings,
      'remind me tomorrow to stretch',
      new Date('2026-06-09T12:00:00+08:00')
    )

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed without a Model Router base URL', async () => {
    const appSettings = settings()
    appSettings.modelRouter = {
      ...appSettings.modelRouter!,
      baseUrl: ''
    }
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await detectScheduledTaskRequest(
      appSettings,
      'remind me tomorrow to stretch',
      new Date('2026-06-09T12:00:00+08:00')
    )

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not fall back to a direct remote provider endpoint', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push(String(url))
      return new Response(JSON.stringify({
        output_text: '{"shouldCreateTask":false}'
      }), { status: 200 })
    })

    await detectScheduledTaskRequest(
      settings(),
      'remind me tomorrow to stretch',
      new Date('2026-06-09T12:00:00+08:00')
    )

    expect(calls).toEqual(['http://127.0.0.1:49876/v1/responses'])
  })
})
