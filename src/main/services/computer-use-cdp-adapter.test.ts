import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CdpAdapterDriverError,
  captureTargetScreenshot,
  createPlaywrightCdpDriver,
  insertedTextVerification,
  stableTargetId,
  startComputerUseCdpAdapter,
  type CdpAdapterDriver,
  type CdpAdapterTarget,
  type ComputerUseCdpAdapter
} from './computer-use-cdp-adapter'

const adapters: ComputerUseCdpAdapter[] = []

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.close()))
})

function target(id: string): CdpAdapterTarget {
  return {
    targetId: id,
    kind: 'browser-page',
    ownership: 'attached',
    generation: 'test-generation',
    locator: { cdpEndpoint: 'http://127.0.0.1:9222', cdpTargetId: `cdp-${id}` },
    metadata: { title: id, url: `https://${id}.example.test/` }
  }
}

function fakeDriver(): CdpAdapterDriver & { events: string[] } {
  const events: string[] = []
  const handles = new Map<string, string>()
  const requestHandles = new Map<string, { handleId: string; targetId: string; generation: string }>()
  let sequence = 0
  return {
    events,
    async available() {
      return {
        available: true,
        adapterInstanceId: 'test-adapter',
        generation: 'test-generation',
        activeHandleCount: handles.size
      }
    },
    async targets() { return [target('page-a'), target('page-b'), target('page-c')] },
    async open(value, requestId) {
      const existing = requestHandles.get(requestId)
      if (existing) return existing
      const handleId = `handle-${value.targetId}`
      handles.set(handleId, value.targetId)
      events.push(`open:${value.targetId}:${requestId}`)
      const result = { handleId, targetId: value.targetId, generation: value.generation }
      requestHandles.set(requestId, result)
      return result
    },
    async observe(handleId) {
      const targetId = handles.get(handleId)
      if (!targetId) throw new Error('missing handle')
      sequence += 1
      return {
        targetId,
        generation: 'test-generation',
        revision: `cdp:${sequence}`,
        imageBase64: Buffer.from('fake-png').toString('base64'),
        metadata: { targetId }
      }
    },
    async action(handleId, input) {
      const targetId = handles.get(handleId)
      if (!targetId) throw new Error('missing handle')
      await Promise.resolve()
      events.push(`action:${targetId}:${String((input.action as Record<string, unknown>).text)}`)
      return {
        targetId,
        generation: 'test-generation',
        committed: true,
        mayHaveTakenEffect: true,
        verification: { status: 'verified', revisionAfter: `cdp:${sequence + 1}`, details: { targetId } }
      }
    },
    async cancel(handleId) { events.push(`cancel:${handles.get(handleId)}`) },
    async close(handleId) {
      events.push(`close:${handles.get(handleId)}`)
      handles.delete(handleId)
    },
    async shutdown() { handles.clear(); requestHandles.clear() }
  }
}

async function start(driver = fakeDriver()): Promise<{
  adapter: ComputerUseCdpAdapter
  driver: ReturnType<typeof fakeDriver>
}> {
  const adapter = await startComputerUseCdpAdapter({ driver, token: 'adapter-secret' })
  adapters.push(adapter)
  return { adapter, driver }
}

async function call(
  adapter: ComputerUseCdpAdapter,
  path: string,
  body?: Record<string, unknown>,
  token = 'adapter-secret'
): Promise<Response> {
  return fetch(`${adapter.url}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
}

describe('computer-use CDP adapter', () => {
  it('verifies type only when non-empty text changes the active element readback', () => {
    expect(insertedTextVerification('', 'alpha', 'alpha')).toMatchObject({ status: 'verified' })
    expect(insertedTextVerification('alpha', 'alpha', 'alpha')).toMatchObject({
      status: 'failed',
      details: { reason: 'typed-text-change-not-confirmed-in-active-element' }
    })
    expect(insertedTextVerification('alpha', 'alpha', '')).toMatchObject({ status: 'failed' })
  })

  it('makes the required target activation explicit before capture', async () => {
    const send = vi.fn(async () => ({ data: 'target-png' }))
    const detach = vi.fn(async () => undefined)
    const bringToFront = vi.fn(async () => undefined)
    const page = {
      once: vi.fn(),
      off: vi.fn(),
      isClosed: vi.fn(() => false),
      bringToFront,
      context: vi.fn(() => ({
        newCDPSession: vi.fn(async () => ({ send, detach }))
      }))
    }
    await expect(captureTargetScreenshot(page as never)).resolves.toBe('target-png')
    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false
    })
    expect(detach).toHaveBeenCalled()
    expect(bringToFront).toHaveBeenCalledOnce()
  })

  it('rejects non-loopback browser debugging endpoints before connecting', () => {
    expect(() => createPlaywrightCdpDriver(['http://192.0.2.10:9222'])).toThrow(
      'CDP endpoint must be loopback-only.'
    )
  })

  it('derives stable public target ids without embedding the endpoint', () => {
    const endpoint = 'http://127.0.0.1:9222/private-token'
    const first = stableTargetId(endpoint, 'target-abc')
    expect(first).toBe(stableTargetId(endpoint, 'target-abc'))
    expect(first).not.toContain('127.0.0.1')
    expect(first).not.toContain(Buffer.from(endpoint).toString('base64url').slice(0, 16))
    expect(first).toMatch(/^cdp:[a-f0-9]{24}:target-abc$/u)
  })

  it('requires bearer authentication and never exposes targets without it', async () => {
    const { adapter } = await start()
    const denied = await call(adapter, '/v1/targets', undefined, 'wrong')
    expect(denied.status).toBe(401)
    const payload = await denied.json() as { error: { code: string } }
    expect(payload.error.code).toBe('UNAUTHORIZED')
  })

  it('redacts endpoints and bearer values from public adapter errors', async () => {
    const base = fakeDriver()
    const driver: CdpAdapterDriver = {
      ...base,
      async available() {
        throw new Error('failed at http://127.0.0.1:9222/private Bearer secret-value')
      }
    }
    const adapter = await startComputerUseCdpAdapter({ driver, token: 'adapter-secret' })
    adapters.push(adapter)
    const response = await call(adapter, '/v1/capabilities')
    const payload = await response.json() as { error: { message: string } }
    expect(payload.error.message).toContain('<redacted-url>')
    expect(payload.error.message).toContain('Bearer <redacted>')
    expect(payload.error.message).not.toContain('9222')
    expect(payload.error.message).not.toContain('secret-value')
  })

  it('exposes capabilities and attached target descriptors', async () => {
    const { adapter } = await start()
    await expect((await call(adapter, '/v1/capabilities')).json()).resolves.toMatchObject({
      ok: true,
      data: { available: true }
    })
    const targetsPayload = await (await call(adapter, '/v1/targets')).json() as {
      ok: boolean
      data: { targets: CdpAdapterTarget[] }
    }
    expect(targetsPayload.ok).toBe(true)
    expect(targetsPayload.data.targets).toHaveLength(3)
    expect(targetsPayload.data.targets[0]).toMatchObject({
      targetId: 'page-a', ownership: 'attached'
    })
  })

  it('requires request identity and returns a generation-bound open result', async () => {
    const { adapter, driver } = await start()
    const missingRequest = await call(adapter, '/v1/handles/open', { target: target('page-a') })
    expect(missingRequest.status).toBe(400)
    const opened = await call(adapter, '/v1/handles/open', {
      requestId: 'request-page-a', target: target('page-a')
    })
    await expect(opened.json()).resolves.toMatchObject({
      ok: true,
      data: { handleId: 'handle-page-a', targetId: 'page-a', generation: 'test-generation' }
    })
    const repeated = await call(adapter, '/v1/handles/open', {
      requestId: 'request-page-a', target: target('page-a')
    })
    await expect(repeated.json()).resolves.toMatchObject({
      data: { handleId: 'handle-page-a', generation: 'test-generation' }
    })
    expect(driver.events.filter((event) => event.startsWith('open:'))).toHaveLength(1)
  })

  it('preserves an explicit safe pre-open rejection across HTTP', async () => {
    const base = fakeDriver()
    const driver: CdpAdapterDriver = {
      ...base,
      async open() {
        throw new CdpAdapterDriverError(
          'BACKEND_UNAVAILABLE', 'debugger is already attached', true
        )
      }
    }
    const adapter = await startComputerUseCdpAdapter({ driver, token: 'adapter-secret' })
    adapters.push(adapter)
    const response = await call(adapter, '/v1/handles/open', {
      requestId: 'request-safe-rejection', target: target('page-a')
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'BACKEND_UNAVAILABLE',
        safeToRetry: true
      }
    })
  })

  it('keeps three handles target-bound under forced concurrent actions', async () => {
    const { adapter, driver } = await start()
    const targets = ['page-a', 'page-b', 'page-c']
    const handles = await Promise.all(targets.map(async (targetId) => {
      const response = await call(adapter, '/v1/handles/open', {
        requestId: `request-${targetId}`,
        target: target(targetId)
      })
      return (await response.json() as { data: { handleId: string } }).data.handleId
    }))

    const outputs = await Promise.all(handles.map(async (handleId, index) => {
      const response = await call(adapter, '/v1/action', {
        handleId,
        expectedRevision: 'cdp:1',
        action: { action: 'type', text: `value-${index}` }
      })
      return (await response.json() as { data: { targetId: string } }).data.targetId
    }))

    expect(outputs).toEqual(targets)
    expect(driver.events.filter((event) => event.startsWith('action:')).sort()).toEqual([
      'action:page-a:value-0',
      'action:page-b:value-1',
      'action:page-c:value-2'
    ])

    await Promise.all(handles.map((handleId) => call(adapter, '/v1/handles/close', { handleId })))
    expect(driver.events.filter((event) => event.startsWith('close:')).sort()).toEqual([
      'close:page-a', 'close:page-b', 'close:page-c'
    ])
  })

  it('rejects managed targets because this adapter does not own them', async () => {
    const { adapter } = await start()
    const response = await call(adapter, '/v1/handles/open', {
      target: { ...target('page-a'), ownership: 'managed' }
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'ADAPTER_ERROR' }
    })
  })

  it('rejects an invalid electron webContents locator before it reaches the driver', async () => {
    const { adapter } = await start()
    const response = await call(adapter, '/v1/handles/open', {
      requestId: 'request-electron',
      target: {
        targetId: 'electron-1', kind: 'electron-webcontents', ownership: 'attached',
        generation: 'test-generation', locator: { webContentsId: 0 }
      }
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false, error: { code: 'ADAPTER_ERROR' }
    })
  })

  it('classifies a closed Playwright target as TARGET_LOST', async () => {
    const base = fakeDriver()
    const driver: CdpAdapterDriver = {
      ...base,
      async observe() {
        throw new Error('page.screenshot: Target page, context or browser has been closed')
      }
    }
    const adapter = await startComputerUseCdpAdapter({ driver, token: 'adapter-secret' })
    adapters.push(adapter)
    const opened = await call(adapter, '/v1/handles/open', {
      requestId: 'request-page-a',
      target: target('page-a')
    })
    const handleId = (await opened.json() as { data: { handleId: string } }).data.handleId
    const response = await call(adapter, '/v1/observe', { handleId })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'TARGET_LOST' }
    })
  })

  it('classifies a bounded capture timeout as BACKEND_UNAVAILABLE', async () => {
    const base = fakeDriver()
    const driver: CdpAdapterDriver = {
      ...base,
      async observe() {
        throw new Error('BACKEND_UNAVAILABLE: CDP target capture timed out.')
      }
    }
    const adapter = await startComputerUseCdpAdapter({ driver, token: 'adapter-secret' })
    adapters.push(adapter)
    const opened = await call(adapter, '/v1/handles/open', {
      requestId: 'request-page-a-timeout',
      target: target('page-a')
    })
    const handleId = (await opened.json() as { data: { handleId: string } }).data.handleId
    const response = await call(adapter, '/v1/observe', { handleId })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'BACKEND_UNAVAILABLE' }
    })
  })
})
