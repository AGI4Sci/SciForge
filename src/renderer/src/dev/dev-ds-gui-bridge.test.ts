import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockEvent = {
  data: string
}

class MockEventSource {
  static instances: MockEventSource[] = []
  readonly url: string
  readonly listeners = new Map<string, Set<(event: MockEvent) => void>>()
  close = vi.fn()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, handler: (event: MockEvent) => void): void {
    const handlers = this.listeners.get(type) ?? new Set()
    handlers.add(handler)
    this.listeners.set(type, handlers)
  }

  emit(type: string, payload: unknown): void {
    const data = JSON.stringify(payload)
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ data })
    }
  }
}

const storage = new Map<string, string>()

function installWindow(existingDsGui?: unknown): void {
  const windowValue = {
    dsGui: existingDsGui,
    location: { search: '' },
    sessionStorage: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value))
    }
  }
  Object.defineProperty(globalThis, 'window', {
    value: windowValue,
    configurable: true
  })
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: windowValue.sessionStorage,
    configurable: true
  })
}

describe('dev dsGui browser bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    storage.clear()
    MockEventSource.instances = []
    Object.defineProperty(globalThis, 'EventSource', {
      value: MockEventSource,
      configurable: true
    })
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => 'client-1' },
      configurable: true
    })
  })

  it('installs window.dsGui in a plain dev browser and forwards calls to the bridge server', async () => {
    installWindow()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      payload: [{ id: 'thread-1', runtimeId: 'codex', title: 'Thread', updatedAt: '2026-06-12T00:00:00.000Z' }]
    })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevDsGuiBridge } = await import('./dev-ds-gui-bridge')

    installDevDsGuiBridge()

    const result = await window.dsGui.agentRuntime.listThreads({ runtimeId: 'codex' })
    expect(result).toEqual([
      { id: 'thread-1', runtimeId: 'codex', title: 'Thread', updatedAt: '2026-06-12T00:00:00.000Z' }
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5174/invoke',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-DeepSeek-Gui-Client': 'client-1' }),
        body: JSON.stringify({
          channel: 'agentRuntime:listThreads',
          payload: { runtimeId: 'codex' }
        })
      })
    )
    expect(MockEventSource.instances[0]?.url).toBe('http://127.0.0.1:5174/events?clientId=client-1')
  })

  it('dispatches bridge SSE messages through preload-shaped event subscriptions', async () => {
    installWindow()
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(async () => new Response(JSON.stringify({ ok: true, payload: null }))),
      configurable: true
    })
    const { installDevDsGuiBridge } = await import('./dev-ds-gui-bridge')

    installDevDsGuiBridge()
    const handler = vi.fn()
    const unsubscribe = window.dsGui.agentRuntime.onEvent(handler)

    MockEventSource.instances[0].emit('bridge-message', {
      channel: 'agentRuntime:event',
      payload: { streamId: 'stream-1', event: { kind: 'heartbeat', threadId: 'thread-1' } }
    })
    unsubscribe()
    MockEventSource.instances[0].emit('bridge-message', {
      channel: 'agentRuntime:event',
      payload: { streamId: 'stream-2', event: { kind: 'heartbeat', threadId: 'thread-2' } }
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({
      streamId: 'stream-1',
      event: { kind: 'heartbeat', threadId: 'thread-1' }
    })
  })

  it('forwards figure style review calls through the dev bridge server', async () => {
    installWindow()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      payload: { ok: true, status: 'pass', score: { overall: 0.9 } }
    })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevDsGuiBridge } = await import('./dev-ds-gui-bridge')

    installDevDsGuiBridge()
    await window.dsGui.reviewFigureStyle({
      workspaceRoot: '/tmp/workspace',
      referencePath: 'figures/reference.png',
      outputPath: 'figures/output.png'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5174/invoke',
      expect.objectContaining({
        body: JSON.stringify({
          channel: 'figure-style:review',
          payload: {
            workspaceRoot: '/tmp/workspace',
            referencePath: 'figures/reference.png',
            outputPath: 'figures/output.png'
          }
        })
      })
    )
  })

  it('forwards scientific plotting MCP config calls through the dev bridge server', async () => {
    installWindow()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      payload: { ok: true, config: { servers: { scientific_plotting: {} } } }
    })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevDsGuiBridge } = await import('./dev-ds-gui-bridge')

    installDevDsGuiBridge()
    await window.dsGui.buildScientificPlottingMcpConfig('/tmp/workspace')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5174/invoke',
      expect.objectContaining({
        body: JSON.stringify({
          channel: 'mcp:scientific-plotting-config',
          payload: {
            workspaceRoot: '/tmp/workspace'
          }
        })
      })
    )
  })

  it('forwards scientific plotting reference preparation through the dev bridge server', async () => {
    installWindow()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      payload: {
        ok: true,
        status: 'prepared',
        croppedImagePath: '/tmp/workspace/.sciforge/figure-references/fig-2a.png'
      }
    })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevDsGuiBridge } = await import('./dev-ds-gui-bridge')

    installDevDsGuiBridge()
    await window.dsGui.prepareScientificPlottingReference({
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'paper.pdf',
      sourceType: 'pdf',
      page: 2,
      cropBox: {
        unit: 'ratio',
        x: 0.1,
        y: 0.2,
        width: 0.7,
        height: 0.5
      }
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5174/invoke',
      expect.objectContaining({
        body: JSON.stringify({
          channel: 'scientific-plotting:prepare-reference',
          payload: {
            workspaceRoot: '/tmp/workspace',
            sourcePath: 'paper.pdf',
            sourceType: 'pdf',
            page: 2,
            cropBox: {
              unit: 'ratio',
              x: 0.1,
              y: 0.2,
              width: 0.7,
              height: 0.5
            }
          }
        })
      })
    )
  })

  it('does not replace the real Electron preload bridge', async () => {
    const existing = { platform: 'electron' }
    installWindow(existing)
    const { installDevDsGuiBridge } = await import('./dev-ds-gui-bridge')

    installDevDsGuiBridge()

    expect(window.dsGui).toBe(existing)
    expect(MockEventSource.instances).toHaveLength(0)
  })
})
