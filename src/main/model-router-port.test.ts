import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import { relocateModelRouterIfPortIsOccupied } from './model-router-port'

function settings(baseUrl: string, autoStart = true): AppSettingsV1 {
  return { modelRouter: { baseUrl, autoStart } } as AppSettingsV1
}

describe('relocateModelRouterIfPortIsOccupied', () => {
  it('chooses a free loopback port when the configured port is occupied', async () => {
    await expect(relocateModelRouterIfPortIsOccupied(settings('http://127.0.0.1:3892/v1'), {
      isPortAvailableImpl: async () => false,
      findAvailablePortImpl: async () => 53488
    })).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:53488/v1',
      configuredPort: 3892,
      activePort: 53488
    })
  })

  it('keeps an available configured port', async () => {
    await expect(relocateModelRouterIfPortIsOccupied(settings('http://127.0.0.1:3892/v1'), {
      isPortAvailableImpl: async () => true
    })).resolves.toBeNull()
  })

  it('keeps an occupied loopback endpoint when the router is externally managed', async () => {
    const findAvailablePortImpl = vi.fn(async () => 53488)

    await expect(relocateModelRouterIfPortIsOccupied(
      settings('http://127.0.0.1:3892/v1', false),
      {
        isPortAvailableImpl: async () => false,
        findAvailablePortImpl
      }
    )).resolves.toBeNull()
    expect(findAvailablePortImpl).not.toHaveBeenCalled()
  })
})
