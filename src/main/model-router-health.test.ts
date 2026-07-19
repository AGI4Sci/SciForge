import { describe, expect, it, vi } from 'vitest'
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
  type AppSettingsV1
} from '../shared/app-settings'
import { checkModelRouterHealth, isModelRouterServiceHealthy } from './model-router-health'

function settings(): AppSettingsV1 {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.runtimeApiKey = 'local-runtime-router-key'
  modelRouter.profiles.default.textReasoner = {
    baseUrl: 'https://models.example/v1',
    apiKey: 'provider-api-key',
    model: 'configured-model'
  }
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    modelRouter,
    activeAgentRuntime: 'sciforge',
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
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

describe('checkModelRouterHealth', () => {
  it('detects an already-running Model Router health service without provider checks', async () => {
    const calls: string[] = []
    const result = await isModelRouterServiceHealthy(settings(), {
      fetchImpl: async (url) => {
        calls.push(String(url))
        return Response.json({ ok: true, service: 'sciforge.model-router' })
      }
    })

    expect(result).toBe(true)
    expect(calls).toEqual(['http://127.0.0.1:3892/health'])
  })

  it('reports healthy when healthz succeeds', async () => {
    const calls: string[] = []
    const result = await checkModelRouterHealth(settings(), {
      fetchImpl: async (url) => {
        calls.push(String(url))
        return Response.json({
          ok: true,
          protocol: 'responses',
          traceCapture: 'ready',
          upstream: { ok: true }
        })
      }
    })

    expect(result).toEqual({
      ok: true,
      status: 'healthy',
      message: 'Model Router is healthy',
      protocol: 'responses',
      traceCaptureReady: true
    })
    expect(calls).toEqual(['http://127.0.0.1:3892/healthz'])
  })

  it('fails closed when runtime API key is missing', async () => {
    const current = settings()
    current.modelRouter = {
      ...defaultModelRouterSettings(),
      ...current.modelRouter,
      runtimeApiKey: ''
    }

    const result = await checkModelRouterHealth(current, {
      fetchImpl: async () => {
        throw new Error('fetch should not be called')
      }
    })

    expect(result).toMatchObject({
      ok: false,
      status: 'not_configured'
    })
  })

  it('reports setup required without probing when the generic API member is incomplete', async () => {
    const current = settings()
    current.modelRouter!.profiles.default.textReasoner = {
      baseUrl: 'https://models.example/v1',
      apiKey: '',
      model: 'configured-model'
    }
    const fetchImpl = vi.fn()

    const result = await checkModelRouterHealth(current, { fetchImpl })

    expect(result).toMatchObject({
      ok: false,
      status: 'not_configured',
      protocol: null,
      traceCaptureReady: false
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps healthz provider auth failures without leaking secrets', async () => {
    const result = await checkModelRouterHealth(settings(), {
      fetchImpl: async () => Response.json({
        ok: false,
        upstream: {
          ok: false,
          issue: 'missing_secret',
          detail: 'Authorization failed for sk-upstream-secret'
        }
      }, { status: 503 })
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('provider_auth_blocked')
    expect(JSON.stringify(result)).not.toMatch(/sk-upstream-secret|Authorization/i)
  })

  it('maps provider http auth failures from healthz bodies', async () => {
    const result = await checkModelRouterHealth(settings(), {
      fetchImpl: async () => Response.json({
        ok: false,
        upstream: {
          ok: false,
          errorSummary: 'provider_http_401'
        }
      }, { status: 503 })
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('provider_auth_blocked')
  })

  it('maps provider network and timeout failures from healthz bodies', async () => {
    const result = await checkModelRouterHealth(settings(), {
      fetchImpl: async () => Response.json({
        ok: false,
        upstream: {
          ok: false,
          category: 'provider-network'
        }
      }, { status: 503 })
    })

    expect(result).toMatchObject({
      ok: false,
      status: 'provider_network',
      message: 'Model Router provider network request failed or timed out'
    })
  })

  it('maps provider bad responses from healthz bodies', async () => {
    const result = await checkModelRouterHealth(settings(), {
      fetchImpl: async () => Response.json({
        ok: false,
        upstream: {
          ok: false,
          category: 'provider-bad-response'
        }
      }, { status: 503 })
    })

    expect(result).toMatchObject({
      ok: false,
      status: 'provider_bad_response',
      message: 'Model Router provider returned an invalid response'
    })
  })

  it('maps generic provider errors from healthz bodies', async () => {
    const result = await checkModelRouterHealth(settings(), {
      fetchImpl: async () => Response.json({
        ok: false,
        upstream: {
          ok: false,
          category: 'provider-error'
        }
      }, { status: 503 })
    })

    expect(result).toMatchObject({
      ok: false,
      status: 'provider_error',
      message: 'Model Router provider returned an error'
    })
  })
})
