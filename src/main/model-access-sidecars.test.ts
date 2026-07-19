import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { AppSettingsV1 } from '../shared/app-settings'

const mocks = vi.hoisted(() => ({
  ensureModelRouterSidecar: vi.fn(),
  stopModelRouterSidecar: vi.fn(),
  ensurePlanGatewaySidecar: vi.fn(),
  stopPlanGatewaySidecar: vi.fn()
}))

vi.mock('./model-router-sidecar', () => ({
  ensureModelRouterSidecar: mocks.ensureModelRouterSidecar,
  stopModelRouterSidecar: mocks.stopModelRouterSidecar
}))
vi.mock('./plan-gateway-sidecar', () => ({
  ensurePlanGatewaySidecar: mocks.ensurePlanGatewaySidecar,
  stopPlanGatewaySidecar: mocks.stopPlanGatewaySidecar
}))

import { synchronizeModelAccessSidecar } from './model-access-sidecars'

function settings(mode: 'api' | 'coding-plan'): AppSettingsV1 {
  return { modelAccess: { mode, planAdapterId: 'codex' } } as AppSettingsV1
}

describe('model access sidecar selection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stops Model Router and starts Plan Gateway in coding-plan mode', async () => {
    await synchronizeModelAccessSidecar(settings('coding-plan'), {
      userDataDir: '/data',
      appRoot: '/app',
      resourcesPath: '/resources',
      execPath: '/app/SciForge',
      isPackaged: true
    })

    expect(mocks.stopModelRouterSidecar).toHaveBeenCalledTimes(1)
    expect(mocks.ensurePlanGatewaySidecar).toHaveBeenCalledWith(
      settings('coding-plan'),
      expect.objectContaining({
        resourcesPath: '/resources',
        execPath: '/app/SciForge',
        isPackaged: true
      })
    )
    expect(mocks.ensureModelRouterSidecar).not.toHaveBeenCalled()
  })

  it('stops Plan Gateway and starts Model Router in API mode', async () => {
    await synchronizeModelAccessSidecar(settings('api'), {
      userDataDir: '/data',
      appRoot: '/app'
    })

    expect(mocks.stopPlanGatewaySidecar).toHaveBeenCalledTimes(1)
    expect(mocks.ensureModelRouterSidecar).toHaveBeenCalledTimes(1)
    expect(mocks.ensurePlanGatewaySidecar).not.toHaveBeenCalled()
  })

  it('fails closed when model access setup is missing', async () => {
    await synchronizeModelAccessSidecar({} as AppSettingsV1, {
      userDataDir: '/data',
      appRoot: '/app'
    })

    expect(mocks.stopPlanGatewaySidecar).toHaveBeenCalledTimes(1)
    expect(mocks.stopModelRouterSidecar).toHaveBeenCalledTimes(1)
    expect(mocks.ensureModelRouterSidecar).not.toHaveBeenCalled()
    expect(mocks.ensurePlanGatewaySidecar).not.toHaveBeenCalled()
  })

  it('keeps startup and settings switches on one packaged-aware main wiring path', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const synchronizerCallCount = source.match(/synchronizeModelAccessSidecar\(/g)?.length ?? 0
    const unifiedCallCount = source.match(/synchronizeSelectedModelAccessSidecar\(/g)?.length ?? 0

    expect(synchronizerCallCount).toBe(1)
    expect(unifiedCallCount).toBe(3)
    expect(source).toContain('resourcesPath: process.resourcesPath')
    expect(source).toContain('execPath: process.execPath')
    expect(source).toContain('isPackaged: app.isPackaged')
  })
})
