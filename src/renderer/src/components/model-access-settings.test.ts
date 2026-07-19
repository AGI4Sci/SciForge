import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '@shared/app-settings'
import type { ModelAccessStatus } from '@shared/sciforge-api'
import {
  buildModelAccessSelectionPatch,
  checkGenericApiAccess,
  modelAccessStatusMatchesSelection,
  ModelAccessSettings,
  normalizeCodingPlanAccount,
  runCodingPlanLoginSequence,
  sameGenericApiMember,
  validateGenericApiMember,
  validateModelAccessSetup
} from './model-access-settings'

const labels: Record<string, string> = {
  modelAccessMode: 'Model access mode',
  modelAccessApi: 'Model API',
  modelAccessApiDesc: 'Use three fields.',
  modelAccessCodingPlan: 'Coding Plan',
  modelAccessCodingPlanDesc: 'Use official sign-in.',
  modelAccessChooseMode: 'Choose a mode.',
  modelAccessStatusUnconfigured: 'Not configured.',
  modelAccessCheck: 'Check setup',
  modelAccessApiStatusIdle: 'Automatic connection details.',
  modelAccessPlan: 'Coding Plan selection',
  modelAccessPlanCodex: 'Codex Plan',
  modelAccessPlanCodexDesc: 'Official account sign-in.',
  modelAccessPlanLoginBrowser: 'Sign in with ChatGPT',
  modelAccessPlanLoginDevice: 'Use device code',
  modelAccessRefreshStatus: 'Refresh status',
  modelAccessPlanStatusIdle: 'Local plan path only.',
  modelAccessUnifiedStatus: 'Model access status',
  modelAccessCorrectiveAction: 'Next step:',
  modelRouterRoleBaseUrl: 'Base URL',
  modelRouterRoleApiKey: 'API key',
  modelRouterRoleModel: 'Model name',
  modelRouterTextReasonerBaseUrlPlaceholder: 'https://api.example.com/v1',
  modelRouterTextReasonerModelPlaceholder: 'model-name',
  showSecret: 'Show',
  hideSecret: 'Hide'
}

function apiStatus(
  health: ModelAccessStatus['health'] = 'healthy',
  action = 'Local diagnostics'
): ModelAccessStatus {
  return {
    setupRequired: false,
    mode: 'api',
    service: 'model-router',
    health,
    adapterId: null,
    credentialState: health === 'error' ? 'rejected' : 'configured',
    protocol: null,
    protocolState: 'pending-first-request',
    traceCaptureReady: health === 'healthy',
    action
  }
}

function t(key: string): string {
  return labels[key] ?? key
}

function settings(mode?: 'api' | 'coding-plan'): AppSettingsV1 {
  return normalizeAppSettings({
    ...(mode ? { modelAccess: { mode, planAdapterId: mode === 'coding-plan' ? 'codex' : '' } } : {}),
    modelRouter: {
      profiles: {
        default: {
          textReasoner: {
            baseUrl: 'https://models.example.test/v1',
            apiKey: 'secret',
            model: 'reasoner'
          }
        }
      }
    }
  } as AppSettingsV1)
}

describe('ModelAccessSettings', () => {
  it('shows exactly three primary inputs in API mode without technical selectors', () => {
    const html = renderToStaticMarkup(createElement(ModelAccessSettings, {
      form: settings('api'),
      update: vi.fn(),
      t
    }))

    expect(html.match(/<input/g)).toHaveLength(3)
    expect(html).toContain('Base URL')
    expect(html).toContain('API key')
    expect(html).toContain('Model name')
    expect(html).not.toContain('<select')
    expect(html).toContain('Model access status')
    expect(html).not.toContain('Provider')
    expect(html).not.toContain('Protocol')
  })

  it('shows official plan sign-in without rendering API fields', () => {
    const html = renderToStaticMarkup(createElement(ModelAccessSettings, {
      form: settings('coding-plan'),
      update: vi.fn(),
      t
    }))

    expect(html).toContain('Codex Plan')
    expect(html).toContain('Sign in with ChatGPT')
    expect(html).toContain('Use device code')
    expect(html).toContain('Model access status')
    expect(html.match(/data-unified-model-access-status/g)).toHaveLength(1)
    expect(html).not.toContain('Base URL')
    expect(html).not.toContain('API key')
    expect(html).not.toContain('Model name')
  })

  it('keeps missing access settings unselected', () => {
    const html = renderToStaticMarkup(createElement(ModelAccessSettings, {
      form: settings(),
      update: vi.fn(),
      t
    }))

    expect(html).toContain('Choose a mode.')
    expect(html).not.toContain('data-api-access-form')
    expect(html).not.toContain('data-coding-plan-access')
  })
})

describe('model access normalization', () => {
  it('rejects persisted service health for a different unsaved selection', () => {
    const priorApiStatus = apiStatus()
    expect(modelAccessStatusMatchesSelection(priorApiStatus, 'api', null)).toBe(true)
    expect(modelAccessStatusMatchesSelection(priorApiStatus, 'coding-plan', 'codex')).toBe(false)
    expect(modelAccessStatusMatchesSelection({
      ...priorApiStatus,
      mode: 'coding-plan',
      service: 'plan-gateway',
      adapterId: 'other'
    }, 'coding-plan', 'codex')).toBe(false)
  })

  it('routes a Coding Plan to its declared runtime without changing runtime in API mode', () => {
    expect(buildModelAccessSelectionPatch({
      mode: 'coding-plan',
      planAdapterId: 'codex',
      planRuntimeId: 'codex'
    })).toEqual({
      modelAccess: { mode: 'coding-plan', planAdapterId: 'codex' },
      activeAgentRuntime: 'codex'
    })
    expect(buildModelAccessSelectionPatch({
      mode: 'api',
      planAdapterId: 'codex',
      planRuntimeId: 'codex'
    })).toEqual({
      modelAccess: { mode: 'api', planAdapterId: 'codex' }
    })
  })

  it('validates only the three generic API fields', () => {
    expect(validateGenericApiMember({ baseUrl: '', apiKey: 'key', model: 'model' })).toBe('missing')
    expect(validateGenericApiMember({ baseUrl: 'file:///tmp/model', apiKey: 'key', model: 'model' })).toBe('invalid-url')
    expect(validateGenericApiMember({ baseUrl: 'https://models.test/v1', apiKey: 'key', model: 'model' })).toBe('ready')
  })

  it('does not probe the Model Router before the current API form is saved', async () => {
    const readStatus = vi.fn(async () => apiStatus('healthy', 'connected'))

    await expect(checkGenericApiAccess({
      member: { baseUrl: 'https://models.test/v1', apiKey: 'key', model: 'model' },
      serviceProbeEnabled: false,
      readStatus
    })).resolves.toEqual({ kind: 'pending-save' })
    expect(readStatus).not.toHaveBeenCalled()
  })

  it.each([
    ['healthy', 'connected'],
    ['error', '401 unauthorized'],
    ['unavailable', 'network unavailable']
  ] as const)('returns the saved Model Router %s status', async (health, action) => {
    const readStatus = vi.fn(async () => apiStatus(health, action))

    await expect(checkGenericApiAccess({
      member: { baseUrl: 'https://models.test/v1', apiKey: 'key', model: 'model' },
      serviceProbeEnabled: true,
      readStatus
    })).resolves.toEqual({
      kind: 'service',
      status: expect.objectContaining({ health, action })
    })
    expect(readStatus).toHaveBeenCalledOnce()
  })

  it('treats any API field change as a different status target', () => {
    const checked = { baseUrl: 'https://models.test/v1', apiKey: 'key', model: 'model' }
    expect(sameGenericApiMember(checked, { ...checked })).toBe(true)
    expect(sameGenericApiMember(checked, { ...checked, model: 'new-model' })).toBe(false)
    expect(sameGenericApiMember(checked, { ...checked, apiKey: 'new-key' })).toBe(false)
  })

  it('keeps onboarding blocked until the selected access path is complete', () => {
    expect(validateModelAccessSetup(settings(), false)).toBe('missing-mode')
    expect(validateModelAccessSetup(settings('api'), false)).toBe('ready')

    const invalidApi = settings('api')
    invalidApi.modelRouter!.profiles.default.textReasoner.apiKey = ''
    expect(validateModelAccessSetup(invalidApi, false)).toBe('invalid-api')

    const missingPlan = settings('coding-plan')
    missingPlan.modelAccess = { mode: 'coding-plan', planAdapterId: '' }
    expect(validateModelAccessSetup(missingPlan, false)).toBe('missing-plan')
    expect(validateModelAccessSetup(settings('coding-plan'), false)).toBe('plan-login-required')
    expect(validateModelAccessSetup(settings('coding-plan'), true)).toBe('ready')
  })

  it('accepts direct and wrapped official account results', () => {
    expect(normalizeCodingPlanAccount({
      ok: true,
      value: { type: 'chatgpt', email: 'user@example.test', planType: 'plus' }
    })).toEqual({
      authenticated: true,
      email: 'user@example.test',
      planType: 'plus'
    })
    expect(normalizeCodingPlanAccount({ authenticated: false })).toEqual({ authenticated: false })
  })

  it('runs official device login, completion, and account refresh in order', async () => {
    const operations: Array<{ operation: string; payload?: Record<string, unknown> }> = []
    const opened: string[] = []
    const result = await runCodingPlanLoginSequence({
      adapterId: 'codex',
      method: 'device',
      invoke: async (operation, payload) => {
        operations.push({ operation, payload })
        if (operation === 'startCodingPlanLogin') {
          return {
            ok: true,
            value: {
              loginId: 'login-1',
              verificationUrl: 'https://auth.example.test/device',
              userCode: 'ABCD-EFGH'
            }
          }
        }
        if (operation === 'waitForCodingPlanLogin') return { ok: true, value: { success: true } }
        return {
          ok: true,
          account: { type: 'chatgpt', email: 'user@example.test', planType: 'plus' }
        }
      },
      openUrl: async (url) => { opened.push(url) }
    })

    expect(operations).toEqual([
      { operation: 'startCodingPlanLogin', payload: { method: 'device' } },
      { operation: 'waitForCodingPlanLogin', payload: { loginId: 'login-1' } },
      { operation: 'getCodingPlanAccount', payload: { refreshToken: true } }
    ])
    expect(opened).toEqual(['https://auth.example.test/device'])
    expect(result.account).toEqual({
      authenticated: true,
      email: 'user@example.test',
      planType: 'plus'
    })
  })

  it('stops the official login sequence on a failed completion', async () => {
    const operations: string[] = []
    await expect(runCodingPlanLoginSequence({
      adapterId: 'codex',
      method: 'browser',
      invoke: async (operation) => {
        operations.push(operation)
        if (operation === 'startCodingPlanLogin') {
          return { ok: true, value: { loginId: 'login-2', authUrl: 'https://auth.example.test' } }
        }
        return { ok: true, value: { success: false, error: 'cancelled' } }
      },
      openUrl: async () => undefined
    })).rejects.toThrow('cancelled')
    expect(operations).toEqual(['startCodingPlanLogin', 'waitForCodingPlanLogin'])
  })
})
