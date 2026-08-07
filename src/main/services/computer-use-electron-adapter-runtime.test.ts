import { describe, expect, it, vi } from 'vitest'
import { startElectronComputerUseAdapterRuntime } from './computer-use-electron-adapter-runtime'

describe('Electron Computer Use adapter runtime', () => {
  it('registers over authenticated loopback and clears only its own adapter on close', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer sidecar-secret' })
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 })
    }) as typeof fetch
    const runtime = await startElectronComputerUseAdapterRuntime({
      listWebContents: () => [],
      serviceUrl: 'http://127.0.0.1:3900',
      serviceToken: 'sidecar-secret',
      fetchImpl,
      retryIntervalMs: 60_000
    })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      adapterUrl: runtime.adapter.url,
      adapterToken: runtime.adapter.token
    })

    await runtime.close()
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual({
      adapterUrl: '', adapterToken: '', expectedAdapterUrl: runtime.adapter.url
    })
  })

  it('rejects non-loopback sidecar registration', async () => {
    await expect(startElectronComputerUseAdapterRuntime({
      listWebContents: () => [],
      serviceUrl: 'https://example.test',
      serviceToken: 'sidecar-secret'
    })).rejects.toThrow('loopback')
  })
})
