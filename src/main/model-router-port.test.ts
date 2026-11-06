import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import { relocateModelRouterIfPortIsOccupied } from './model-router-port'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function settings(baseUrl: string, autoStart = true): AppSettingsV1 {
  return { modelRouter: { baseUrl, autoStart } } as AppSettingsV1
}

describe('relocateModelRouterIfPortIsOccupied', () => {
  it('avoids a foreign HTTP listener even when the local TCP bind probe reports free (forwarded localhost)', async () => {
    await expect(relocateModelRouterIfPortIsOccupied(settings('http://127.0.0.1:3892/v1'), {
      isPortAvailableImpl: async () => true,
      findAvailablePortImpl: async () => 53488,
      fetchImpl: async () => Response.json({ ok: true, service: 'sciforge.model-router', instanceId: 'foreign' })
    })).resolves.toMatchObject({ activePort: 53488 })
  })
  it('chooses a free loopback port when the configured port is occupied', async () => {
    await expect(relocateModelRouterIfPortIsOccupied(settings('http://127.0.0.1:3892/v1'), {
      isPortAvailableImpl: async () => false,
      fetchImpl: async () => { throw new Error('no HTTP listener') },
      findAvailablePortImpl: async () => 53488
    })).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:53488/v1',
      configuredPort: 3892,
      activePort: 53488
    })
  })

  it('keeps an available configured port', async () => {
    await expect(relocateModelRouterIfPortIsOccupied(settings('http://127.0.0.1:3892/v1'), {
      isPortAvailableImpl: async () => true,
      fetchImpl: async () => { throw new Error('no HTTP listener') }
    })).resolves.toBeNull()
  })

  it('retains only the verified own listener and relocates a different profile without stopping it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'router-port-owner-'))
    const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ service: 'sciforge.model-router', instanceId: 'own' })) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const baseUrl = `http://127.0.0.1:${address.port}/v1`
    try {
      await mkdir(join(dir, 'model-access-gateway'))
      await writeFile(join(dir, 'model-access-gateway/sidecar-state.json'), JSON.stringify({ mode: 'model-router', instanceId: 'own', healthUrl: baseUrl.replace('/v1', '/health') }))
      await expect(relocateModelRouterIfPortIsOccupied(settings(baseUrl), { userDataDir: dir })).resolves.toBeNull()
      const relocated = await relocateModelRouterIfPortIsOccupied(settings(baseUrl))
      expect(relocated?.activePort).not.toBe(address.port)
      expect((await fetch(baseUrl)).status).toBe(200)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
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
