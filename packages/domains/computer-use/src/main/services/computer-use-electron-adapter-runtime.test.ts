import { afterEach, describe, expect, it, vi } from 'vitest'
import { startElectronComputerUseAdapterRuntime } from './computer-use-electron-adapter-runtime'

describe('Electron Computer Use adapter runtime', () => {
  afterEach(() => { vi.useRealTimers() })

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

  it('refreshes registration so a restarted sidecar learns the live adapter again', async () => {
    vi.useFakeTimers()
    const bodies: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 })
    }) as typeof fetch
    const runtime = await startElectronComputerUseAdapterRuntime({
      listWebContents: () => [],
      serviceUrl: 'http://127.0.0.1:3900',
      serviceToken: 'sidecar-secret',
      fetchImpl,
      retryIntervalMs: 1_000
    })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(bodies.filter((body) => body.adapterUrl === runtime.adapter.url)).toHaveLength(3)
    await runtime.close()
  })

  it('attempts compare-and-set cleanup even when registration acknowledgement was lost', async () => {
    const bodies: Array<Record<string, unknown>> = []
    let first = true
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (first) {
        first = false
        throw new TypeError('registration response was lost')
      }
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 })
    }) as typeof fetch
    const runtime = await startElectronComputerUseAdapterRuntime({
      listWebContents: () => [],
      serviceUrl: 'http://127.0.0.1:3900',
      serviceToken: 'sidecar-secret',
      fetchImpl,
      retryIntervalMs: 60_000
    })
    await runtime.close()
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual({
      adapterUrl: '', adapterToken: '', expectedAdapterUrl: runtime.adapter.url
    })
  })

  it('bounds a hung refresh so close still performs CAS cleanup and stops the adapter', async () => {
    vi.useFakeTimers()
    const bodies: Array<Record<string, unknown>> = []
    let callCount = 0
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      callCount += 1
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (callCount === 2) return await new Promise<Response>(() => undefined)
      return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 })
    }) as typeof fetch
    const runtime = await startElectronComputerUseAdapterRuntime({
      listWebContents: () => [],
      serviceUrl: 'http://127.0.0.1:3900',
      serviceToken: 'sidecar-secret',
      fetchImpl,
      retryIntervalMs: 1_000,
      requestTimeoutMs: 25
    })
    await vi.advanceTimersByTimeAsync(1_000)
    const close = runtime.close()
    await vi.advanceTimersByTimeAsync(25)
    await close

    expect(bodies).toHaveLength(3)
    expect(bodies[2]).toEqual({
      adapterUrl: '', adapterToken: '', expectedAdapterUrl: runtime.adapter.url
    })
    await expect(fetch(runtime.adapter.url)).rejects.toThrow()
  })

  it('rejects non-loopback sidecar registration', async () => {
    await expect(startElectronComputerUseAdapterRuntime({
      listWebContents: () => [],
      serviceUrl: 'https://example.test',
      serviceToken: 'sidecar-secret'
    })).rejects.toThrow('loopback')
  })
})
