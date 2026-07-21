import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import {
  codingPlanCredentialState,
  codingPlanCredentialStateForAdapter,
  getModelAccessStatus
} from './model-access-status'
import { checkModelRouterHealth } from './model-router-health'

function settings(modelAccess?: AppSettingsV1['modelAccess']): AppSettingsV1 {
  return { modelAccess } as AppSettingsV1
}

describe('getModelAccessStatus', () => {
  it('fails closed without a valid access-mode selection', async () => {
    const checkModelRouterHealthImpl = vi.fn()
    const checkPlanGatewayHealthImpl = vi.fn()

    await expect(getModelAccessStatus(settings(), {
      checkModelRouterHealthImpl,
      checkPlanGatewayHealthImpl
    })).resolves.toEqual({
      setupRequired: true,
      mode: null,
      service: null,
      health: 'not_configured',
      adapterId: null,
      credentialState: 'missing',
      protocol: null,
      protocolState: 'not-applicable',
      traceCaptureReady: false,
      action: 'Choose API access or Coding Plan access and save the model setup.'
    })
    expect(checkModelRouterHealthImpl).not.toHaveBeenCalled()
    expect(checkPlanGatewayHealthImpl).not.toHaveBeenCalled()
  })

  it('reports API health through Model Router without exposing configuration', async () => {
    const status = await getModelAccessStatus(
      settings({ mode: 'api', planAdapterId: '' }),
      {
        checkModelRouterHealthImpl: async () => ({
          ok: false,
          status: 'provider_auth_blocked',
          message: 'private upstream detail',
          protocol: null,
          traceCaptureReady: true
        })
      }
    )

    expect(status).toEqual({
      setupRequired: false,
      mode: 'api',
      service: 'model-router',
      health: 'error',
      adapterId: null,
      credentialState: 'rejected',
      protocol: null,
      protocolState: 'pending-first-request',
      traceCaptureReady: true,
      action: 'Check the configured API key and try a real model request again.'
    })
    expect(JSON.stringify(status)).not.toContain('private upstream detail')
  })

  it('reports an explicitly configured upstream protocol before the first request', async () => {
    const current = settings({ mode: 'api', planAdapterId: '' })
    current.modelRouter = {
      profiles: {
        default: {
          textReasoner: {
            baseUrl: 'https://models.example/v1',
            apiKey: 'secret',
            model: 'configured-model',
            protocol: 'chat-completions'
          }
        }
      }
    } as AppSettingsV1['modelRouter']
    const status = await getModelAccessStatus(current, {
      checkModelRouterHealthImpl: async () => ({
        ok: true,
        status: 'healthy',
        message: 'healthy',
        protocol: null,
        traceCaptureReady: true
      })
    })

    expect(status.protocol).toBe('chat-completions')
    expect(status.protocolState).toBe('selected')
  })

  it('keeps incomplete API fields setup-required without probing a stale Router', async () => {
    const current = settings({ mode: 'api', planAdapterId: '' })
    const fetchImpl = vi.fn()

    const status = await getModelAccessStatus(current, {
      checkModelRouterHealthImpl: (value) => checkModelRouterHealth(value, { fetchImpl })
    })

    expect(status).toMatchObject({
      setupRequired: true,
      health: 'not_configured',
      credentialState: 'missing',
      protocol: null,
      traceCaptureReady: false
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports Coding Plan gateway health and the selected adapter', async () => {
    const status = await getModelAccessStatus(
      settings({ mode: 'coding-plan', planAdapterId: 'codex' }),
      {
        checkPlanGatewayHealthImpl: async () => ({
          ok: true,
          status: 'healthy',
          message: 'Plan Gateway is healthy',
          baseUrl: 'http://127.0.0.1:3893/v1',
          adapterId: 'codex',
          protocol: 'responses',
          traceCaptureReady: true
        }),
        getCodingPlanCredentialStateImpl: async () => 'authenticated'
      }
    )

    expect(status).toEqual({
      setupRequired: false,
      mode: 'coding-plan',
      service: 'plan-gateway',
      health: 'healthy',
      adapterId: 'codex',
      credentialState: 'authenticated',
      protocol: 'responses',
      protocolState: 'selected',
      traceCaptureReady: true,
      action: 'Coding Plan access and trace capture are ready.'
    })
    expect(JSON.stringify(status)).not.toContain('127.0.0.1')
  })

  it('reports that API protocol negotiation waits for the first real request', async () => {
    const status = await getModelAccessStatus(
      settings({ mode: 'api', planAdapterId: '' }),
      {
        checkModelRouterHealthImpl: async () => ({
          ok: true,
          status: 'healthy',
          message: 'local service only',
          protocol: null,
          traceCaptureReady: true
        })
      }
    )

    expect(status).toMatchObject({
      health: 'healthy',
      credentialState: 'configured',
      protocol: null,
      protocolState: 'pending-first-request',
      traceCaptureReady: true
    })
    expect(status.action).toContain('first real request')
    expect(status.action).not.toMatch(/upstream.*connected|connection.*verified/i)
  })

  it('normalizes generic Coding Plan account results without adapter branches', () => {
    expect(codingPlanCredentialState({ ok: true, authenticated: true })).toBe('authenticated')
    expect(codingPlanCredentialState({ ok: true, authenticated: false })).toBe('unauthenticated')
    expect(codingPlanCredentialState({ ok: true, account: { type: 'apiKey' } })).toBe('unknown')
    expect(codingPlanCredentialState({ ok: true, account: { type: 'amazonBedrock' } })).toBe('unknown')
    expect(codingPlanCredentialState({ ok: false, message: 'offline' })).toBe('unknown')
  })

  it('resolves plan authentication from the selected adapter instead of a stale active runtime', async () => {
    const current = settings({ mode: 'coding-plan', planAdapterId: 'codex' })
    current.activeAgentRuntime = 'sciforge'
    const auxiliary = vi.fn(async () => ({ ok: true, authenticated: true }))

    const status = await getModelAccessStatus(current, {
      checkPlanGatewayHealthImpl: async () => ({
        ok: true,
        status: 'healthy',
        message: 'healthy',
        baseUrl: 'http://127.0.0.1:3893/v1',
        adapterId: 'codex',
        protocol: 'responses',
        traceCaptureReady: true
      }),
      getCodingPlanCredentialStateImpl: async (_settings, adapterId) =>
        codingPlanCredentialStateForAdapter(adapterId, auxiliary)
    })

    expect(status.credentialState).toBe('authenticated')
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'getCodingPlanAccount',
      payload: { refreshToken: true }
    })
  })
})
