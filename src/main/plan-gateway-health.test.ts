import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import { checkPlanGatewayHealth, isManagedPlanGatewayInstance } from './plan-gateway-health'

function settings(mode: 'api' | 'coding-plan' = 'coding-plan'): AppSettingsV1 {
  return {
    modelAccess: { mode, planAdapterId: 'codex' }
  } as AppSettingsV1
}

describe('Plan Gateway health', () => {
  it('does not probe the service outside coding-plan mode', async () => {
    const fetchImpl = vi.fn()
    const result = await checkPlanGatewayHealth(settings('api'), { fetchImpl })

    expect(result).toMatchObject({ ok: false, status: 'not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('validates the worker, adapter, and managed instance', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      status: 'ok',
      workerId: 'sciforge.plan-gateway',
      adapterId: 'codex',
      protocol: 'responses',
      traceCapture: 'ready',
      instanceId: 'instance-1'
    }))

    const result = await checkPlanGatewayHealth(settings(), {
      fetchImpl,
      expectedInstanceId: 'instance-1'
    })

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:3893/healthz', expect.objectContaining({
      method: 'GET'
    }))
    expect(result).toEqual({
      ok: true,
      status: 'healthy',
      message: 'Plan Gateway is healthy',
      baseUrl: 'http://127.0.0.1:3893/v1',
      adapterId: 'codex',
      protocol: 'responses',
      traceCaptureReady: true
    })
  })

  it('rejects a healthy gateway running another adapter', async () => {
    const result = await checkPlanGatewayHealth(settings(), {
      fetchImpl: async () => Response.json({
        status: 'ok',
        workerId: 'sciforge.plan-gateway',
        adapterId: 'another-plan'
      })
    })

    expect(result).toMatchObject({ ok: false, status: 'wrong_adapter' })
  })

  it('recognizes an app-managed stale instance independently of its adapter', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      status: 'ok',
      workerId: 'sciforge.plan-gateway',
      adapterId: 'old-adapter',
      instanceId: 'stale-instance'
    }))

    await expect(isManagedPlanGatewayInstance(
      'http://127.0.0.1:3893/v1',
      'stale-instance',
      { fetchImpl }
    )).resolves.toBe(true)
  })
})
