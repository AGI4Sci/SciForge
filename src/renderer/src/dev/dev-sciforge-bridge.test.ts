import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisibleContextPublishInput } from '@shared/visible-context'

const html2canvas = vi.hoisted(() => vi.fn())

vi.mock('html2canvas-pro', () => ({ default: html2canvas }))

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

function visibleContextSnapshot(revision: number): VisibleContextPublishInput {
  return {
    schemaVersion: 3,
    revision,
    publishedAt: '2026-07-31T00:00:00.000Z',
    freshness: {
      stale: false,
      ageMs: 0,
      staleAfterMs: 5_000
    },
    activeThreadId: 'thread-1',
    route: '/',
    components: []
  }
}

function installWindow(existingSciForge?: unknown, search = '', userAgent = 'Mozilla/5.0 Chrome/127 Safari/537.36'): void {
  const windowValue = {
    sciforge: existingSciForge,
    location: {
      origin: 'http://localhost:5173',
      hostname: 'localhost',
      search
    },
    sessionStorage: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key))
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
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform: 'MacIntel', userAgent },
    configurable: true
  })
}

describe('dev sciforge browser bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    storage.clear()
    html2canvas.mockReset()
    MockEventSource.instances = []
    Object.defineProperty(globalThis, 'EventSource', {
      value: MockEventSource,
      configurable: true
    })
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => 'client-1' },
      configurable: true
    })
    Object.defineProperty(globalThis, '__SCIFORGE_DEV_INSTANCE_ID__', {
      value: '',
      configurable: true
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('installs window.sciforge in a plain dev browser without token bootstrap', async () => {
    storage.set('sciforge.dev-browser-bridge.token', 'stale-token')
    installWindow(undefined, '?devBrowserBridgeToken=query-token-123')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).endsWith('/bootstrap')) {
        throw new Error('unexpected bootstrap request')
      }
      return new Response(JSON.stringify({
        ok: true,
        payload: [{ id: 'thread-1', runtimeId: 'codex', title: 'Thread', updatedAt: '2026-06-12T00:00:00.000Z' }]
      }))
    })
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()

    const result = await window.sciforge.agentRuntime.listThreads({ runtimeId: 'codex' })
    expect(result).toEqual([
      { id: 'thread-1', runtimeId: 'codex', title: 'Thread', updatedAt: '2026-06-12T00:00:00.000Z' }
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-SciForge-Client': 'client-1'
        }),
        body: JSON.stringify({
          channel: 'agentRuntime:listThreads',
          payload: { runtimeId: 'codex' }
        })
      })
    )
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/bootstrap'))).toBe(false)
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('X-SciForge-Bridge-Token')
    const unsubscribe = window.sciforge.agentRuntime.onEvent(vi.fn())
    await vi.waitFor(() => {
      expect(MockEventSource.instances[0]?.url).toBe(
        'http://localhost:5173/__sciforge-dev-bridge/events?clientId=client-1'
      )
    })
    unsubscribe()
  })

  it('adds the configured dev instance credential to browser bridge transports', async () => {
    Object.defineProperty(globalThis, '__SCIFORGE_DEV_INSTANCE_ID__', {
      value: 'main-instance',
      configurable: true
    })
    installWindow()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      payload: { activeAgentRuntime: 'codex' }
    })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()
    await window.sciforge.getSettings()
    const unsubscribe = window.sciforge.onSettingsChanged(vi.fn())
    const resourceUrl = window.sciforge.capabilities.resourceContentUrl({
      workspaceId: '/tmp/work',
      resource: {
        token: 'cap_abcdefghijklmnopqrstuvwxyz',
        semanticRevision: 'revision-1',
        expiresAt: '2026-07-16T14:00:00.000Z'
      }
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-SciForge-Dev-Instance': 'main-instance'
        })
      })
    )
    expect(new URL(MockEventSource.instances[0].url).searchParams.get('devInstanceId'))
      .toBe('main-instance')
    expect(new URL(resourceUrl!).searchParams.get('devInstanceId')).toBe('main-instance')
    unsubscribe()
  })

  it('dispatches bridge SSE messages through preload-shaped event subscriptions', async () => {
    installWindow()
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(async () => new Response(JSON.stringify({ ok: true, payload: null }))),
      configurable: true
    })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()
    const handler = vi.fn()
    const unsubscribe = window.sciforge.agentRuntime.onEvent(handler)

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
      expect(MockEventSource.instances[0].url).toBe('http://localhost:5173/__sciforge-dev-bridge/events?clientId=client-1')
    })
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

  it('creates a new browser client identity when the renderer page reloads', async () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce('page-incarnation-1')
      .mockReturnValueOnce('page-incarnation-2')
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID },
      configurable: true
    })
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(async () => new Response(JSON.stringify({ ok: true, payload: null }))),
      configurable: true
    })

    installWindow()
    const firstModule = await import('./dev-sciforge-bridge')
    firstModule.installDevSciForgeBridge()
    await vi.waitFor(() => {
      expect(MockEventSource.instances[0]?.url).toContain('clientId=page-incarnation-1')
    })

    vi.resetModules()
    installWindow()
    const reloadedModule = await import('./dev-sciforge-bridge')
    reloadedModule.installDevSciForgeBridge()

    await vi.waitFor(() => {
      expect(MockEventSource.instances[1]?.url).toContain('clientId=page-incarnation-2')
    })
    expect(randomUUID).toHaveBeenCalledTimes(2)
  })

  it('ignores a client identity cloned through session storage by a duplicated tab', async () => {
    storage.set('sciforge.dev-browser-bridge.client-id', 'cloned-page-incarnation')
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => 'duplicate-tab-incarnation' },
      configurable: true
    })
    installWindow()
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(async () => new Response(JSON.stringify({ ok: true, payload: null }))),
      configurable: true
    })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()

    await vi.waitFor(() => {
      expect(MockEventSource.instances[0]?.url).toContain('clientId=duplicate-tab-incarnation')
    })
    expect(MockEventSource.instances[0]?.url).not.toContain('cloned-page-incarnation')
    expect(storage.get('sciforge.dev-browser-bridge.client-id')).toBe('cloned-page-incarnation')
  })

  it('rasterizes CSS color() pseudo-element styles into revision-bound browser pixels', async () => {
    Object.defineProperty(globalThis, '__SCIFORGE_DEV_INSTANCE_ID__', {
      value: 'main-instance',
      configurable: true
    })
    installWindow()
    Object.assign(window, {
      innerWidth: 800,
      innerHeight: 600,
      devicePixelRatio: 2,
      scrollX: 0,
      scrollY: 0
    })
    const documentElement = {
      pseudoElementStyles: {
        before: {
          backgroundImage: 'linear-gradient(color(srgb 0.1 0.2 0.3 / 0.4), transparent)'
        },
        after: {
          boxShadow: '0 0 0 1px color(srgb 0.5 0.6 0.7 / 0.8)'
        }
      }
    }
    Object.defineProperty(globalThis, 'document', {
      value: { documentElement },
      configurable: true
    })
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      value: (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      },
      configurable: true
    })
    const pngBase64 = 'cG5nLXBpeGVscw=='
    html2canvas.mockImplementation(async (element) => {
      expect(element).toBe(documentElement)
      expect(documentElement.pseudoElementStyles).toEqual({
        before: {
          backgroundImage: 'linear-gradient(color(srgb 0.1 0.2 0.3 / 0.4), transparent)'
        },
        after: {
          boxShadow: '0 0 0 1px color(srgb 0.5 0.6 0.7 / 0.8)'
        }
      })
      return {
        toDataURL: () => `data:image/png;base64,${pngBase64}`
      }
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/invoke')) {
        const body = JSON.parse(String(init?.body)) as {
          channel: string
          payload: VisibleContextPublishInput
        }
        if (body.channel === 'visibleContext:publish') {
          return new Response(JSON.stringify({
            ok: true,
            payload: { ...body.payload, windowId: 'browser:1' }
          }))
        }
      }
      return new Response(JSON.stringify({ ok: true }))
    })
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()
    await window.sciforge.visibleContext.publish(visibleContextSnapshot(12))
    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })
    MockEventSource.instances[0].emit('bridge-message', {
      channel: 'devBrowserBridge:surface-capture-requested',
      payload: {
        requestId: '12345678-1234-1234-1234-123456789abc',
        revision: 12,
        bounds: { x: 10, y: 20, width: 300, height: 400 }
      }
    })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:5173/__sciforge-dev-bridge/surface-capture',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-SciForge-Client': 'client-1',
            'X-SciForge-Dev-Instance': 'main-instance'
          })
        })
      )
    })
    expect(html2canvas).toHaveBeenCalledWith(
      document.documentElement,
      expect.objectContaining({
        width: 300,
        height: 400,
        x: 10,
        y: 20,
        scale: 2,
        useCORS: true,
        allowTaint: false
      })
    )
    const captureRequest = fetchMock.mock.calls.find(([input]) => (
      String(input).endsWith('/surface-capture')
    ))
    const captureRequestInit = captureRequest?.[1] as RequestInit | undefined
    const upload = JSON.parse(String(captureRequestInit?.body)) as Record<string, unknown>
    expect(upload).toMatchObject({
      requestId: '12345678-1234-1234-1234-123456789abc',
      revision: 12,
      ok: true,
      viewportWidth: 800,
      viewportHeight: 600,
      pngBase64
    })
  })

  it('rejects a surface capture before rasterization when the published revision does not match', async () => {
    const { captureDevBrowserSurface } = await import('./dev-browser-surface-capture')

    const response = await captureDevBrowserSurface({
      requestId: 'capture-before-mismatch',
      revision: 12
    }, () => 11)

    expect(response).toEqual({
      requestId: 'capture-before-mismatch',
      revision: 12,
      ok: false,
      error: 'Browser visible-context revision changed before capture: requested 12, current 11.'
    })
    expect(html2canvas).not.toHaveBeenCalled()
  })

  it('rejects rasterized pixels when the published revision changes during capture', async () => {
    installWindow()
    Object.assign(window, {
      innerWidth: 800,
      innerHeight: 600,
      devicePixelRatio: 1,
      scrollX: 0,
      scrollY: 0
    })
    Object.defineProperty(globalThis, 'document', {
      value: { documentElement: {} },
      configurable: true
    })
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      value: (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      },
      configurable: true
    })
    let currentRevision = 12
    html2canvas.mockImplementation(async () => {
      currentRevision = 13
      return {
        toDataURL: () => 'data:image/png;base64,cG5nLXBpeGVscw=='
      }
    })
    const { captureDevBrowserSurface } = await import('./dev-browser-surface-capture')

    const response = await captureDevBrowserSurface({
      requestId: 'capture-during-mismatch',
      revision: 12
    }, () => currentRevision)

    expect(response).toEqual({
      requestId: 'capture-during-mismatch',
      revision: 12,
      ok: false,
      error: 'Browser visible-context revision changed during capture: requested 12, current 13.'
    })
    expect(html2canvas).toHaveBeenCalledTimes(1)
  })

  it('does not expose legacy PDF annotation sidecar calls through the dev bridge', async () => {
    installWindow()
    const fetchMock = vi.fn()
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()

    expect('pdfAnnotations' in window.sciforge).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not expose legacy workspace HTML preview calls through the dev bridge', async () => {
    installWindow()
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()
    expect('previewWorkspaceHtml' in window.sciforge).toBe(false)
  })

  it('does not expose a Paper Radar domain-specific dev bridge', async () => {
    installWindow()
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()
    expect('paperRadar' in window.sciforge).toBe(false)
    expect(window.sciforge.capabilities.bind).toBeTypeOf('function')
    expect(window.sciforge.capabilities.invoke).toBeTypeOf('function')
    expect(window.sciforge.capabilities.cancel).toBeTypeOf('function')
  })

  it('forwards workspace entry import calls through the dev bridge', async () => {
    installWindow()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      payload: { ok: true, imported: [], importedAt: '2026-07-08T00:00:00.000Z' }
    })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')
    const payload = {
      sourcePaths: ['/tmp/source.csv'],
      targetWorkspaceRoot: '/tmp/work',
      targetDirectory: 'incoming',
      conflictPolicy: { strategy: 'rename' as const }
    }

    installDevSciForgeBridge()
    await window.sciforge.importWorkspaceEntries(payload)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'file:import-workspace-entries',
          payload
        })
      })
    )
  })

  it('forwards workspace clipboard paste calls through the dev bridge', async () => {
    installWindow()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      payload: {
        ok: true,
        kind: 'text',
        path: '/tmp/work/notes/pasted-text.txt',
        name: 'pasted-text.txt',
        pastedAt: '2026-07-08T00:00:00.000Z'
      }
    })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')
    const payload = {
      workspaceRoot: '/tmp/work',
      targetDirectory: 'notes',
      conflictPolicy: { strategy: 'skip' as const }
    }

    installDevSciForgeBridge()
    await window.sciforge.pasteWorkspaceClipboard(payload)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'clipboard:paste-workspace',
          payload
        })
      })
    )
  })

  it('forwards generic capability and file calls without domain facades', async () => {
    installWindow()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { channel?: string } : {}
      if (body.channel === 'file:watch-workspace') {
        return new Response(JSON.stringify({ ok: true, payload: { watchId: 'watch-1' } }))
      }
      if (body.channel === 'file:unwatch-workspace') {
        return new Response(JSON.stringify({ ok: true, payload: true }))
      }
      if (body.channel === 'capability:discover') {
        return new Response(JSON.stringify({
          ok: true,
          payload: [{ id: 'workspace-preview.list', tags: [] }]
        }))
      }
      if (body.channel === 'capability:observe' || body.channel === 'capability:invoke') {
        return new Response(JSON.stringify({
          ok: true,
          payload: { contractVersion: 1, ok: true, payload: { ok: true } }
        }))
      }
      return new Response(JSON.stringify({
        ok: true,
        payload: { ok: true }
      }))
    })
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()
    const capabilityRequest = {
      request: { actionId: 'workspace-preview.list', input: {} }
    }
    const capabilityObserveRequest = {
      request: {
        resource: {
          token: 'cap_abcdefghijklmnopqrstuvwxyz',
          semanticRevision: 'revision-1',
          expiresAt: '2026-07-16T14:00:00.000Z'
        }
      }
    }
    await window.sciforge.capabilities.observe(capabilityObserveRequest)
    await window.sciforge.capabilities.invoke(capabilityRequest)
    await window.sciforge.capabilities.cancel('123e4567-e89b-42d3-a456-426614174000')
    await window.sciforge.fileTransfers.pickUploadSource({
      ownerId: 'sciforge.content-space',
      request: { title: 'Upload', maxBytes: 1_024 },
      transportRequestId: '223e4567-e89b-42d3-a456-426614174000'
    })
    await window.sciforge.fileTransfers.cancel('223e4567-e89b-42d3-a456-426614174000')
    await window.sciforge.fileTransfers.settle('223e4567-e89b-42d3-a456-426614174000')
    const assetSourceUrl = window.sciforge.capabilities.resourceContentUrl({
      workspaceId: '/tmp/work',
      resource: {
        token: 'cap_abcdefghijklmnopqrstuvwxyz',
        semanticRevision: 'revision-1',
        expiresAt: '2026-07-16T14:00:00.000Z'
      }
    })
    await window.sciforge.watchWorkspaceFile({ path: 'protein.pdb', workspaceRoot: '/tmp/work' })
    await window.sciforge.unwatchWorkspaceFile('watch-1')
    expect('workspacePreview' in window.sciforge).toBe(false)
    expect('biologyRoom' in window.sciforge).toBe(false)
    expect(assetSourceUrl).toContain('/__sciforge-dev-bridge/capability/resources/content?')
    expect(new URL(assetSourceUrl!).searchParams.get('clientId')).toBeTruthy()
    expect(JSON.parse(new URL(assetSourceUrl!).searchParams.get('access') ?? '{}')).toMatchObject({
      workspaceId: '/tmp/work',
      resource: { token: expect.stringMatching(/^cap_/) }
    })
    const bridgeRequests = fetchMock.mock.calls.map(([, init]) => (
      JSON.parse(String(init?.body)) as {
        channel: string
        payload?: unknown
      }
    ))
    expect(bridgeRequests.map((request) => request.channel)).toEqual(expect.arrayContaining([
      'capability:invoke',
      'capability:observe',
      'capability:cancel',
      'fileTransfer:pick-upload-source',
      'fileTransfer:cancel',
      'fileTransfer:settle',
      'file:watch-workspace',
      'file:unwatch-workspace'
    ]))
    expect(bridgeRequests).toContainEqual({
      channel: 'capability:observe',
      payload: {
        ...capabilityObserveRequest,
        transportRequestId: expect.any(String)
      }
    })
    expect(bridgeRequests).toContainEqual({
      channel: 'capability:discover',
      payload: {
        query: { capabilityId: 'workspace-preview.list' }
      }
    })
    expect(bridgeRequests).toContainEqual({
      channel: 'capability:invoke',
      payload: {
        ...capabilityRequest,
        transportRequestId: expect.any(String)
      }
    })
    expect(bridgeRequests).toContainEqual({
      channel: 'capability:cancel',
      payload: { transportRequestId: '123e4567-e89b-42d3-a456-426614174000' }
    })
    expect(bridgeRequests).toContainEqual({
      channel: 'fileTransfer:pick-upload-source',
      payload: {
        ownerId: 'sciforge.content-space',
        request: { title: 'Upload', maxBytes: 1_024 },
        transportRequestId: '223e4567-e89b-42d3-a456-426614174000'
      }
    })
    expect(bridgeRequests).toContainEqual({
      channel: 'fileTransfer:cancel',
      payload: { transportRequestId: '223e4567-e89b-42d3-a456-426614174000' }
    })
    expect(bridgeRequests).toContainEqual({
      channel: 'fileTransfer:settle',
      payload: { transportRequestId: '223e4567-e89b-42d3-a456-426614174000' }
    })
    expect(bridgeRequests).toContainEqual({
      channel: 'file:watch-workspace',
      payload: { path: 'protein.pdb', workspaceRoot: '/tmp/work' }
    })
    expect(bridgeRequests).toContainEqual({ channel: 'file:unwatch-workspace', payload: 'watch-1' })
  })

  it('rejects sensitive-input capabilities before credentials enter the browser HTTP proxy', async () => {
    installWindow()
    const account = 'browser-account-canary'
    const password = 'browser-password-canary'
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { channel?: string }
      if (body.channel === 'capability:discover') {
        return new Response(JSON.stringify({
          ok: true,
          payload: [{
            id: 'provider-session.connect',
            tags: ['provider-connection', 'sensitive-input']
          }]
        }))
      }
      return new Response(JSON.stringify({
        ok: true,
        payload: {
          contractVersion: 1,
          ok: true,
          payload: { actionId: 'provider-session.connect', output: { connected: true } }
        }
      }))
    })
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()

    await expect(window.sciforge.capabilities.invoke({
      request: {
        actionId: 'provider-session.connect',
        invocationId: 'connect-browser-1',
        input: { account, password }
      }
    })).rejects.toThrow('sensitive-input')

    const serializedRequests = fetchMock.mock.calls.map(([, init]) => String(init?.body))
    expect(serializedRequests).toHaveLength(1)
    expect(JSON.parse(serializedRequests[0])).toEqual({
      channel: 'capability:discover',
      payload: {
        query: { capabilityId: 'provider-session.connect' }
      }
    })
    expect(serializedRequests.join('\n')).not.toContain(account)
    expect(serializedRequests.join('\n')).not.toContain(password)
  })

  it('fails closed before serializing input when browser transport cannot resolve one descriptor', async () => {
    installWindow()
    const secret = 'unresolved-input-canary'
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        ok: true,
        payload: []
      })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()

    await expect(window.sciforge.capabilities.invoke({
      request: {
        actionId: 'provider-session.unresolved',
        invocationId: 'connect-browser-unresolved-1',
        input: { secret }
      }
    })).rejects.toThrow('could not resolve exactly one capability descriptor')

    const serializedRequests = fetchMock.mock.calls.map(([, init]) => String(init?.body))
    expect(serializedRequests).toHaveLength(1)
    expect(serializedRequests.join('\n')).not.toContain(secret)
  })

  it('unwraps dev HTTP capability errors into preload-shaped typed Errors', async () => {
    installWindow()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { channel?: string }
      return new Response(JSON.stringify({
        ok: true,
        payload: body.channel === 'capability:discover'
          ? [{ id: 'content-space.upload-new', tags: [] }]
          : {
              contractVersion: 1,
              ok: false,
              error: {
                code: 'outcome_unknown',
                message: 'The mutation outcome is unknown.',
                category: 'failed',
                retryable: false,
                details: { expected: 'revision-2' }
              }
            }
      }))
    })
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()

    await expect(window.sciforge.capabilities.invoke({
      request: {
        actionId: 'content-space.upload-new',
        invocationId: 'upload-1',
        input: {}
      }
    })).rejects.toMatchObject({
      name: 'CapabilityTransportError',
      message: 'The mutation outcome is unknown.',
      code: 'outcome_unknown',
      category: 'failed',
      retryable: false,
      details: { expected: 'revision-2' }
    })
    await expect(window.sciforge.capabilities.observe({
      request: {
        resource: {
          token: 'cap_abcdefghijklmnopqrst',
          semanticRevision: '1',
          expiresAt: '2026-08-17T00:00:00.000Z'
        }
      }
    })).rejects.toMatchObject({ code: 'outcome_unknown', retryable: false })
  })

  it('replaces a stale browser bridge in a plain dev browser', async () => {
    const existing = {
      platform: 'browser',
      getSettings: vi.fn(() => new Promise(() => undefined))
    }
    installWindow(existing)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      payload: { activeAgentRuntime: 'codex' }
    })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()
    await window.sciforge.getSettings()

    expect(window.sciforge).not.toBe(existing)
    expect(existing.getSettings).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        body: JSON.stringify({
          channel: 'settings:get'
        })
      })
    )
  })

  it('does not replace the real Electron preload bridge', async () => {
    const existing = {
      platform: 'darwin',
      getAppVersion: vi.fn()
    }
    installWindow(existing, '', 'Mozilla/5.0 Electron/38.0 Safari/537.36')
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()

    expect(window.sciforge).toBe(existing)
    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('replaces Electron-looking non-preload host bridges in the browser dev surface', async () => {
    const existing = {
      platform: 'electron',
      getSettings: vi.fn(() => new Promise(() => undefined))
    }
    installWindow(existing, '', 'Mozilla/5.0 Electron/38.0 Safari/537.36')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      payload: { activeAgentRuntime: 'codex' }
    })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()
    await window.sciforge.getSettings()

    expect(window.sciforge).not.toBe(existing)
    expect(existing.getSettings).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        body: JSON.stringify({
          channel: 'settings:get'
        })
      })
    )
  })
})
