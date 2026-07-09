import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('routes Project DAG panel calls through the dev bridge', async () => {
    installWindow(undefined, '?devBrowserBridgeToken=query-token-123')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, payload: { url: 'http://127.0.0.1:3898/' } })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()
    await window.sciforge.getProjectDagView({ view: 'graph' })
    await window.sciforge.runProjectDagCompile({ goalTitle: 'Project alpha' })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        body: JSON.stringify({
          channel: 'projectDag:view',
          payload: { view: 'graph' }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        body: JSON.stringify({
          channel: 'projectDag:compile',
          payload: { goalTitle: 'Project alpha' }
        })
      })
    )
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

  it('forwards workspace native file drag calls through the dev bridge', async () => {
    installWindow()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      payload: { ok: false, message: 'Native file dragging is not available in this environment.' }
    })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')
    const payload = {
      workspaceRoot: '/tmp/work',
      path: 'notes/paper.pdf'
    }

    installDevSciForgeBridge()
    await window.sciforge.startWorkspaceNativeFileDrag(payload)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'file:start-workspace-native-drag',
          payload
        })
      })
    )
  })

  it('forwards workspace preview calls through the dev bridge', async () => {
    installWindow()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { channel?: string } : {}
      if (body.channel === 'workspacePreview:listPlugins') {
        return new Response(JSON.stringify({
          ok: true,
          payload: [{ id: 'molecular', displayName: 'Molecular Structure Viewer' }]
        }))
      }
      return new Response(JSON.stringify({
        ok: true,
        payload: { ok: true }
      }))
    })
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')
    const openInput = {
      path: '/tmp/work/protein.pdb',
      workspaceRoot: '/tmp/work',
      mimeType: 'chemical/x-pdb',
      mode: 'inspect' as const
    }

    installDevSciForgeBridge()
    await window.sciforge.workspacePreview.listPlugins()
    await window.sciforge.workspacePreview.open(openInput)
    await window.sciforge.workspacePreview.observe('session-1')
    await window.sciforge.workspacePreview.describeAsset('session-1')
    await window.sciforge.workspacePreview.readRange('session-1', { offset: 0, length: 4 })
    await window.sciforge.workspacePreview.prepareArtifact('session-1', {
      kind: 'cache-artifact',
      source: 'observation'
    })
    await window.sciforge.workspacePreview.readArtifactRange('session-1', {
      artifactId: 'artifact-1',
      range: { offset: 0, length: 4 }
    })
    await window.sciforge.workspacePreview.applyEdit('session-1', {
      kind: 'molecular.setSelection',
      path: 'protein.pdb',
      selection: { kind: 'molecular', chains: ['A'] }
    })
    await window.sciforge.workspacePreview.export('session-1', {
      kind: 'workspace-file',
      format: 'pdb',
      path: 'exports/protein-copy.pdb'
    })
    await window.sciforge.workspacePreview.releaseSession('session-1')
    await window.sciforge.workspacePreview.watch({ path: 'protein.pdb', workspaceRoot: '/tmp/work' })
    await window.sciforge.workspacePreview.unwatch('watch-1')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'workspacePreview:listPlugins'
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'workspacePreview:prepareArtifact',
          payload: {
            sessionId: 'session-1',
            request: {
              kind: 'cache-artifact',
              source: 'observation'
            }
          }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'workspacePreview:readArtifactRange',
          payload: {
            sessionId: 'session-1',
            request: {
              artifactId: 'artifact-1',
              range: { offset: 0, length: 4 }
            }
          }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'workspacePreview:watch',
          payload: { path: 'protein.pdb', workspaceRoot: '/tmp/work' }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'workspacePreview:unwatch',
          payload: 'watch-1'
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'workspacePreview:open',
          payload: openInput
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'workspacePreview:observe',
          payload: { sessionId: 'session-1' }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'workspacePreview:describeAsset',
          payload: { sessionId: 'session-1' }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'workspacePreview:readRange',
          payload: { sessionId: 'session-1', range: { offset: 0, length: 4 } }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'workspacePreview:applyEdit',
          payload: {
            sessionId: 'session-1',
            operation: {
              kind: 'molecular.setSelection',
              path: 'protein.pdb',
              selection: { kind: 'molecular', chains: ['A'] }
            }
          }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'workspacePreview:export',
          payload: {
            sessionId: 'session-1',
            target: {
              kind: 'workspace-file',
              format: 'pdb',
              path: 'exports/protein-copy.pdb'
            }
          }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'workspacePreview:releaseSession',
          payload: { sessionId: 'session-1' }
        })
      })
    )
  })

  it('forwards terminal calls and events through the dev bridge', async () => {
    installWindow()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { channel?: string; payload?: unknown } : {}
      if (body.channel === 'terminal:create') {
        return new Response(JSON.stringify({
          ok: true,
          payload: { ok: true, sessionId: 'terminal:test:main', ownerToken: 'owner-token' }
        }))
      }
      return new Response(JSON.stringify({ ok: true, payload: true }))
    })
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()
    const dataHandler = vi.fn()
    const unsubscribe = window.sciforge.onTerminalData(dataHandler)
    const created = await window.sciforge.createTerminal({ sessionId: 'terminal:test:main' })
    await window.sciforge.writeToTerminal({ sessionId: 'terminal:test:main', data: 'pwd\n' })
    await window.sciforge.resizeTerminal({ sessionId: 'terminal:test:main', cols: 100, rows: 30 })
    await window.sciforge.disposeTerminal('terminal:test:main')

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })
    MockEventSource.instances[0].emit('bridge-message', {
      channel: 'terminal:data',
      payload: { sessionId: 'terminal:test:main', data: 'hello' }
    })
    unsubscribe()

    expect(created).toEqual({ ok: true, sessionId: 'terminal:test:main', ownerToken: 'owner-token' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'terminal:create',
          payload: { sessionId: 'terminal:test:main' }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'terminal:write',
          payload: { sessionId: 'terminal:test:main', data: 'pwd\n' }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'terminal:resize',
          payload: { sessionId: 'terminal:test:main', cols: 100, rows: 30 }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'terminal:dispose',
          payload: 'terminal:test:main'
        })
      })
    )
    expect(dataHandler).toHaveBeenCalledWith({ sessionId: 'terminal:test:main', data: 'hello' })
  })

  it('forwards connect-phone and remote-channel APIs through canonical bridge channels', async () => {
    installWindow()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      payload: { ok: true }
    })))
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true })
    const { installDevSciForgeBridge } = await import('./dev-sciforge-bridge')

    installDevSciForgeBridge()
    expect(`mirrorRemoteChannelMessageTo${'Feishu'}` in window.sciforge).toBe(false)
    await window.sciforge.startConnectPhoneInstallQr('feishu', { isLark: true })
    await window.sciforge.mirrorRemoteChannelMessage('thread-1', 'hello', 'user')
    await window.sciforge.createRemoteChannelTaskFromText('schedule this', {
      channelId: 'channel-1',
      modelHint: 'auto',
      mode: 'agent'
    })
    const handler = vi.fn()
    const unsubscribe = window.sciforge.onRemoteChannelActivity(handler)

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })
    MockEventSource.instances[0].emit('bridge-message', {
      channel: 'remoteChannel:activity',
      payload: { channelId: 'channel-1', threadId: 'thread-1' }
    })
    unsubscribe()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'connectPhone:install:qrcode',
          payload: { provider: 'feishu', isLark: true }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'remoteChannel:message:mirror',
          payload: {
            threadId: 'thread-1',
            text: 'hello',
            direction: 'user'
          }
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/__sciforge-dev-bridge/invoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'remoteChannel:task:create-from-text',
          payload: {
            text: 'schedule this',
            channelId: 'channel-1',
            modelHint: 'auto',
            mode: 'agent'
          }
        })
      })
    )
    expect(handler).toHaveBeenCalledWith({ channelId: 'channel-1', threadId: 'thread-1' })
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
      onDevPreviewNavigate: vi.fn()
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
