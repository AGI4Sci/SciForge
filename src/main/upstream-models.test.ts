import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { fetchUpstreamModelIds } from './upstream-models'

function settings(): AppSettingsV1 {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.profiles.default.textReasoner.model = 'private-text-model'
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    modelRouter: {
      ...modelRouter,
      baseUrl: 'http://127.0.0.1:49876/v1',
      publicModelAlias: 'sciforge-router',
      runtimeApiKey: 'local-runtime-router-key'
    },
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
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

describe('upstream model picker list', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes only the public alias returned by Model Router', async () => {
    const calls: Array<{ url: string; method: string | undefined; headers: HeadersInit | undefined }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        method: init.method,
        headers: init.headers
      })
      return new Response(JSON.stringify({
        object: 'list',
        data: [
          { id: 'private-text-model', object: 'model' },
          { id: 'sciforge-router', object: 'model' },
          { id: 'unknown-model', object: 'model' },
          { id: 'sciforge-router', object: 'model' }
        ]
      }), { status: 200 })
    })

    const result = await fetchUpstreamModelIds(settings())

    expect(calls).toEqual([
      expect.objectContaining({
        url: 'http://127.0.0.1:49876/v1/models',
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer local-runtime-router-key'
        })
      })
    ])
    expect(result).toEqual({
      ok: true,
      modelIds: ['sciforge-router'],
      modelGroups: [{
        providerId: 'model-router',
        label: 'Model Router',
        modelIds: ['sciforge-router']
      }]
    })
    expect(JSON.stringify(result)).not.toContain('private-text-model')
    expect(JSON.stringify(result)).not.toContain('unknown-model')
  })

  it('fails closed when Model Router does not return its public alias', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      object: 'list',
      data: [{ id: 'private-text-model', object: 'model' }]
    }), { status: 200 }))

    await expect(fetchUpstreamModelIds(settings())).resolves.toEqual({
      ok: false,
      message: 'Model Router returned no supported public model aliases.'
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

    const result = await fetchUpstreamModelIds(appSettings)

    expect(result).toEqual({
      ok: false,
      message: 'Missing Model Router runtime API key; cannot query local /v1/models.'
    })
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

    const result = await fetchUpstreamModelIds(appSettings)

    expect(result).toEqual({
      ok: false,
      message: 'Missing Model Router base URL; cannot query local /v1/models.'
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
