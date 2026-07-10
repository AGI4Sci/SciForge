import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import { request } from 'node:http'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_DEV_BROWSER_BRIDGE_ALLOWED_CHANNELS,
  startDevBrowserBridgeServer,
  type DevBrowserBridgeDispatcher
} from './dev-browser-bridge'

type TestServer = Awaited<ReturnType<typeof startDevBrowserBridgeServer>>

let server: TestServer | null = null

function extractLiteralInvokeChannels(source: string, callee: 'ipcRenderer.invoke' | 'invoke'): string[] {
  const escaped = callee.replace('.', '\\.')
  const pattern = new RegExp(`${escaped}\\(\\s*['"]([^'"]+)['"]`, 'g')
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]).filter(Boolean))].sort()
}

async function closeServer(): Promise<void> {
  if (!server) return
  await server.close()
  server = null
}

function readFromResponse(
  path: string,
  options: { origin?: string | null; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, server?.url)
    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    const origin = 'origin' in options ? options.origin : 'http://localhost:5173'
    if (origin) headers.Origin = origin
    const req = request(url, {
      method: 'GET',
      headers
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body,
        headers: res.headers
      }))
    })
    req.on('error', reject)
    req.end()
  })
}

type PostJsonOptions = {
  clientId?: string
}

function postJson(path: string, body: unknown, options: PostJsonOptions | string = {}): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const url = new URL(path, server?.url)
    const clientId = typeof options === 'string' ? options : options.clientId ?? 'browser-1'
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'X-SciForge-Client': clientId,
      Origin: 'http://localhost:5173'
    }
    const req = request(url, {
      method: 'POST',
      headers
    }, (res) => {
      let response = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        response += chunk
      })
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: response,
        headers: res.headers
      }))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function openSse(path: string): Promise<{ close: () => void; chunks: string[] }> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    const url = new URL(path, server?.url)
    const req = request(url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Origin: 'http://localhost:5173'
      }
    }, (res) => {
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        chunks.push(chunk)
      })
      resolve({
        close: () => req.destroy(),
        chunks
      })
    })
    req.on('error', reject)
    req.end()
  })
}

describe('dev browser bridge server', () => {
  afterEach(async () => {
    await closeServer()
  })

  it('keeps the default browser bridge allowlist in parity with the preload API', () => {
    const preloadSource = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8')
    const devBridgeSource = readFileSync(
      new URL('../renderer/src/dev/dev-sciforge-bridge.ts', import.meta.url),
      'utf8'
    )
    const preloadChannels = extractLiteralInvokeChannels(preloadSource, 'ipcRenderer.invoke')
    const devBridgeChannels = extractLiteralInvokeChannels(devBridgeSource, 'invoke')
    const allowedChannels = [...DEFAULT_DEV_BROWSER_BRIDGE_ALLOWED_CHANNELS].sort()

    expect(devBridgeChannels).toEqual(preloadChannels)
    expect(allowedChannels).toEqual(preloadChannels)
  })

  it('serves health and forwards local read requests to the dispatcher', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })

    const address = server.server.address() as AddressInfo
    expect(server.url).toBe(`http://127.0.0.1:${address.port}`)

    const health = await readFromResponse('/health')
    expect(health.status).toBe(200)
    expect(JSON.parse(health.body)).toEqual({ ok: true })
    expect(health.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(health.headers['access-control-allow-private-network']).toBe('true')

    const response = await postJson('/invoke', {
      channel: 'settings:get',
      payload: { scope: 'all' }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, payload: { ok: true, payload: { scope: 'all' } } })
    expect(invoke).toHaveBeenCalledWith(
      'settings:get',
      { scope: 'all' },
      expect.objectContaining({ id: expect.any(Number), send: expect.any(Function) })
    )
  })

  it('serves workspace preview assets through session-scoped byte range transport', async () => {
    const bytes = Buffer.from('%PDF')
    const invoke = vi.fn(async (channel, payload) => {
      if (channel === 'workspacePreview:describeAsset') {
        return {
          ok: true,
          descriptor: {
            schemaVersion: 1,
            sessionId: 'session-pdf',
            assetId: 'asset:session-pdf',
            pluginId: 'pdf',
            modality: 'document',
            file: {
              name: 'paper.pdf',
              relativePath: 'paper.pdf',
              mimeType: 'application/pdf',
              size: bytes.length
            },
            primary: 'byte-range',
            eagerRead: {
              allowed: false,
              reason: 'lazy asset transport'
            },
            range: {
              available: true,
              maxChunkBytes: 4,
              recommendedChunkBytes: 4,
              size: bytes.length
            },
            strategies: [{
              kind: 'byte-range',
              status: 'available',
              reason: 'bounded reads',
              maxChunkBytes: 4
            }]
          }
        }
      }
      if (channel === 'workspacePreview:readRange') {
        const request = payload as { range: { offset: number; length: number } }
        const chunk = bytes.subarray(request.range.offset, request.range.offset + request.range.length)
        return {
          ok: true,
          sessionId: 'session-pdf',
          assetId: 'asset:session-pdf',
          offset: request.range.offset,
          length: chunk.length,
          size: bytes.length,
          dataBase64: chunk.toString('base64'),
          mimeType: 'application/pdf'
        }
      }
      return { ok: false, message: `Unexpected channel ${channel}` }
    })
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })

    const response = await readFromResponse('/workspace-preview/assets/session-pdf?clientId=browser-1', {
      headers: { Range: 'bytes=1-3' }
    })

    expect(response.status).toBe(206)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.headers['accept-ranges']).toBe('bytes')
    expect(response.headers['content-range']).toBe(`bytes 1-3/${bytes.length}`)
    expect(response.body).toBe('PDF')
    expect(invoke).toHaveBeenCalledWith(
      'workspacePreview:describeAsset',
      { sessionId: 'session-pdf' },
      expect.objectContaining({ id: expect.any(Number), send: expect.any(Function) })
    )
    expect(invoke).toHaveBeenCalledWith(
      'workspacePreview:readRange',
      {
        sessionId: 'session-pdf',
        range: { offset: 1, length: 3 }
      },
      expect.objectContaining({ id: expect.any(Number), send: expect.any(Function) })
    )
  })

  it('rejects invoke requests from non-local origins', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })

    const payload = JSON.stringify({ channel: 'settings:get' })
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(new URL('/invoke', server?.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-SciForge-Client': 'browser-1',
          Origin: 'https://example.com'
        }
      }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      })
      req.on('error', reject)
      req.write(payload)
      req.end()
    })

    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      message: 'Origin is not allowed.'
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('opens event streams from local origins without token bootstrap', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })

    const sse = await openSse('/events?clientId=browser-local')

    server.send('runtime:status', { state: 'ready' })
    await vi.waitFor(() => {
      expect(sse.chunks.join('')).toContain('"channel":"runtime:status"')
      expect(sse.chunks.join('')).toContain('"state":"ready"')
    })
    sse.close()
  })

  it('allows desktop parity channels by default in browser dev mode', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0
    })

    const response = await postJson('/invoke', {
      channel: 'desktop:command',
      payload: { command: 'open-settings' }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body).ok).toBe(true)
    expect(invoke).toHaveBeenCalledWith(
      'desktop:command',
      { command: 'open-settings' },
      expect.objectContaining({ id: expect.any(Number), send: expect.any(Function) })
    )
  })

  it('allows settings writes in browser dev mode', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0
    })

    const response = await postJson('/invoke', {
      channel: 'settings:set',
      payload: { provider: { apiKey: 'provider-key' } }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      payload: { ok: true, payload: { provider: { apiKey: 'provider-key' } } }
    })
    expect(invoke).toHaveBeenCalledWith(
      'settings:set',
      { provider: { apiKey: 'provider-key' } },
      expect.objectContaining({ id: expect.any(Number), send: expect.any(Function) })
    )
  })

  it('allows agent runtime actions in browser dev mode', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0
    })

    for (const channel of ['agentRuntime:connect', 'agentRuntime:startTurn', 'sciforge-canvas:open'] as const) {
      const response = await postJson('/invoke', {
        channel,
        payload: channel === 'sciforge-canvas:open'
          ? { workspaceRoot: '/tmp/workspace', canvasId: 'thread-test' }
          : { runtimeId: 'sciforge' }
      })

      expect(response.status).toBe(200)
      expect(JSON.parse(response.body).ok).toBe(true)
    }
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('allows Evidence DAG view and update channels in browser dev mode', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0
    })

    for (const channel of ['evidenceDag:view', 'evidenceDag:update'] as const) {
      const response = await postJson('/invoke', {
        channel,
        payload: { runtimeId: 'codex', threadId: 'thread-1' }
      })

      expect(response.status).toBe(200)
      expect(JSON.parse(response.body).ok).toBe(true)
    }
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('allows callers to explicitly opt into mutating channels', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      allowedChannels: ['settings:set']
    })

    const response = await postJson('/invoke', {
      channel: 'settings:set',
      payload: { theme: 'dark' }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, payload: { ok: true, payload: { theme: 'dark' } } })
    expect(invoke).toHaveBeenCalledWith(
      'settings:set',
      { theme: 'dark' },
      expect.objectContaining({ id: expect.any(Number), send: expect.any(Function) })
    )
  })

  it('allows all app bridge channels when explicitly enabled for local dev parity', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      allowAllChannels: true
    })

    const response = await postJson('/invoke', {
      channel: 'custom:channel',
      payload: { threadId: 'thread-1', text: 'hello' }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      payload: { ok: true, payload: { threadId: 'thread-1', text: 'hello' } }
    })
    expect(invoke).toHaveBeenCalledWith(
      'custom:channel',
      { threadId: 'thread-1', text: 'hello' },
      expect.objectContaining({ id: expect.any(Number), send: expect.any(Function) })
    )
  })

  it('rejects invoke requests for channels outside the default allowlist', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0
    })

    const response = await postJson('/invoke', {
      channel: 'desktop:not-a-real-channel',
      payload: 'quit'
    })

    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      message: 'Dev browser bridge channel is not allowed: desktop:not-a-real-channel'
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects oversized invoke request bodies before dispatching', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      maxInvokeBodyBytes: 128
    })

    const response = await postJson('/invoke', {
      channel: 'settings:get',
      payload: 'x'.repeat(256)
    })

    expect(response.status).toBe(413)
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      message: 'Request body is too large.'
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('streams sender.send payloads to the matching browser client over SSE', async () => {
    const dispatcher: DevBrowserBridgeDispatcher = {
      invoke: vi.fn(async (_channel, _payload, sender) => {
        sender.send('agentRuntime:event', {
          streamId: 'stream-1',
          event: { kind: 'heartbeat', threadId: 'thread-1' }
        })
        return { streamId: 'stream-1' }
      })
    }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })
    const sse = await openSse('/events?clientId=browser-2')

    const response = await postJson('/invoke', {
      channel: 'agentRuntime:subscribeEvents',
      payload: { threadId: 'thread-1', streamId: 'stream-1' }
    }, 'browser-2')

    expect(response.status).toBe(200)
    await vi.waitFor(() => {
      expect(sse.chunks.join('')).toContain('"channel":"agentRuntime:event"')
      expect(sse.chunks.join('')).toContain('"streamId":"stream-1"')
    })
    sse.close()
  })

  it('broadcasts server-level messages to connected browser clients', async () => {
    const dispatcher: DevBrowserBridgeDispatcher = {
      invoke: vi.fn(async () => ({ ok: true }))
    }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })
    const first = await openSse('/events?clientId=browser-a')
    const second = await openSse('/events?clientId=browser-b')

    server.send('remoteChannel:activity', {
      channelId: 'channel-1',
      threadId: 'thread-1',
      runtimeId: 'codex'
    })

    await vi.waitFor(() => {
      expect(first.chunks.join('')).toContain('"channel":"remoteChannel:activity"')
      expect(first.chunks.join('')).toContain('"threadId":"thread-1"')
      expect(second.chunks.join('')).toContain('"channel":"remoteChannel:activity"')
      expect(second.chunks.join('')).toContain('"threadId":"thread-1"')
    })
    first.close()
    second.close()
  })
})
