import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'node:net'
import { request } from 'node:http'
import { readFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import { z } from 'zod'
import { CapabilityBroker, CapabilityBrokerError } from './capabilities/broker'
import { registerCapabilityIpc } from './capabilities/ipc'
import { CapabilityRegistry, defineCapability } from './capabilities/registry'
import {
  DEFAULT_DEV_BROWSER_BRIDGE_ALLOWED_CHANNELS,
  startDevBrowserBridgeServer,
  type DevBrowserBridgeDispatcher
} from './dev-browser-bridge'

type TestServer = Awaited<ReturnType<typeof startDevBrowserBridgeServer>>

let server: TestServer | null = null

function extractLiteralInvokeChannels(source: string, callee: 'ipcRenderer.invoke' | 'invoke'): string[] {
  const escaped = callee.replace('.', '\\.')
  const pattern = new RegExp(`${escaped}(?:<[^>]+>)?\\(\\s*['"]([^'"]+)['"]`, 'g')
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
  devInstanceId?: string
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
    if (typeof options !== 'string' && options.devInstanceId) {
      headers['X-SciForge-Dev-Instance'] = options.devInstanceId
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
    expect(allowedChannels.some((channel) => channel.startsWith('paperRadar:'))).toBe(false)
    expect(allowedChannels).toEqual(expect.arrayContaining([
      'capability:bind',
      'capability:cancel',
      'capability:readiness',
      'capability:discover',
      'capability:events',
      'capability:invoke',
      'capability:observe',
      'capability:subscribe',
      'capability:unsubscribe'
    ]))
  })

  it('keeps application bootstrap explicitly instance-gated without an allow-all channel bypass', () => {
    const mainSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

    expect(mainSource).toContain(
      'const devBrowserBridgeInstanceId = process.env.SCIFORGE_DEV_INSTANCE_ID?.trim()'
    )
    expect(mainSource).toContain("process.env.SCIFORGE_DEV_BROWSER_BRIDGE !== '0'")
    expect(mainSource).toContain('!app.isPackaged')
    expect(mainSource).toContain('instanceId: devBrowserBridgeInstanceId')
    expect(mainSource).toContain('resolveCapabilityTags: (actionId) =>')
    expect(mainSource).not.toContain('allowAllChannels')
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

  it('keeps health non-secret and requires the exact configured instance credential', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    server = await startDevBrowserBridgeServer({
      dispatcher: { invoke },
      port: 0,
      instanceId: 'main-instance'
    })

    const health = await readFromResponse('/health')
    expect(JSON.parse(health.body)).toEqual({ ok: true })
    expect(health.body).not.toContain('main-instance')

    const missing = await postJson('/invoke', { channel: 'settings:get' })
    expect(missing.status).toBe(409)

    const stale = await postJson('/invoke', { channel: 'settings:get' }, {
      devInstanceId: 'stale-renderer'
    })
    expect(stale.status).toBe(409)
    expect(JSON.parse(stale.body)).toEqual(expect.objectContaining({ ok: false }))

    const conflicting = await postJson(
      '/invoke?devInstanceId=stale-renderer',
      { channel: 'settings:get' },
      { devInstanceId: 'main-instance' }
    )
    expect(conflicting.status).toBe(409)

    const duplicated = await postJson(
      '/invoke?devInstanceId=main-instance&devInstanceId=main-instance',
      { channel: 'settings:get' }
    )
    expect(duplicated.status).toBe(409)
    expect(invoke).not.toHaveBeenCalled()

    const current = await postJson('/invoke', { channel: 'settings:get' }, {
      devInstanceId: 'main-instance'
    })
    expect(current.status).toBe(200)
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('routes browser capability calls through the same generic broker handlers as Electron', async () => {
    const broker = new CapabilityBroker(new CapabilityRegistry([defineCapability({
      id: 'workspace-preview.list',
      version: '1',
      title: 'List preview providers',
      description: 'Lists preview providers through the generic browser capability transport.',
      audiences: ['ui'],
      scope: 'global',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.array(z.object({ id: z.string() })),
      handler: async () => ({ output: [{ id: 'pdf' }] })
    })]))
    const ipc = {
      removeHandler: vi.fn(),
      handle: vi.fn()
    }
    const capabilityDispatcher = registerCapabilityIpc({
      broker,
      ipc: ipc as never,
      isTrustedIpcSender: () => true
    })

    server = await startDevBrowserBridgeServer({
      dispatcher: capabilityDispatcher,
      resolveCapabilityTags: (actionId) => broker.registry.get(actionId)?.descriptor.tags,
      port: 0
    })

    const response = await postJson('/invoke', {
      channel: 'capability:invoke',
      payload: {
        transportRequestId: '123e4567-e89b-42d3-a456-426614174000',
        request: {
          actionId: 'workspace-preview.list',
          input: {}
        }
      }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      ok: true,
      payload: {
        contractVersion: 1,
        ok: true,
        payload: {
          actionId: 'workspace-preview.list',
          output: [{ id: 'pdf' }],
          changed: false
        }
      }
    })
  })

  it('rejects sensitive-input capabilities on HTTP while canonical capability IPC remains available', async () => {
    const handler = vi.fn(async () => ({ output: { connected: true } }))
    const broker = new CapabilityBroker(new CapabilityRegistry([defineCapability({
      id: 'provider-session.connect',
      version: '1',
      title: 'Connect provider session',
      description: 'Connects a provider session using caller-supplied credentials.',
      audiences: ['ui'],
      scope: 'global',
      effect: 'external-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      tags: ['provider-connection', 'sensitive-input'],
      inputSchema: z.object({ account: z.string(), password: z.string() }).strict(),
      outputSchema: z.object({ connected: z.boolean() }).strict(),
      handler
    })]))
    const capabilityDispatcher = registerCapabilityIpc({
      broker,
      ipc: { removeHandler: vi.fn(), handle: vi.fn() } as never,
      isTrustedIpcSender: () => true
    })
    server = await startDevBrowserBridgeServer({
      dispatcher: capabilityDispatcher,
      port: 0,
      resolveCapabilityTags: (actionId) => broker.registry.get(actionId)?.descriptor.tags
    })
    const requestPayload = {
      transportRequestId: '123e4567-e89b-42d3-a456-426614174111',
      request: {
        actionId: 'provider-session.connect',
        invocationId: 'connect-http-1',
        input: {
          account: 'http-account-canary',
          password: 'http-password-canary'
        }
      }
    }

    const denied = await postJson('/invoke', {
      channel: 'capability:invoke',
      payload: requestPayload
    })

    expect(denied.status).toBe(403)
    expect(JSON.parse(denied.body)).toEqual({
      ok: false,
      message: 'Capabilities tagged sensitive-input require the Electron preload transport.'
    })
    expect(handler).not.toHaveBeenCalled()

    const senderEvents = new EventEmitter()
    const sender = {
      id: 91,
      send: vi.fn(),
      isDestroyed: () => false,
      once: senderEvents.once.bind(senderEvents),
      removeListener: senderEvents.removeListener.bind(senderEvents)
    }
    await expect(capabilityDispatcher.invoke(
      'capability:invoke',
      { ...requestPayload, transportRequestId: '123e4567-e89b-42d3-a456-426614174112' },
      sender
    )).resolves.toMatchObject({
      contractVersion: 1,
      ok: true,
      payload: {
        actionId: 'provider-session.connect',
        output: { connected: true },
        changed: false
      }
    })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('fails closed before dispatch when HTTP capability tags cannot be resolved', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    server = await startDevBrowserBridgeServer({
      dispatcher: { invoke },
      port: 0,
      resolveCapabilityTags: () => undefined
    })

    const response = await postJson('/invoke', {
      channel: 'capability:invoke',
      payload: {
        transportRequestId: '123e4567-e89b-42d3-a456-426614174113',
        request: {
          actionId: 'provider-session.unresolved',
          invocationId: 'connect-http-unresolved-1',
          input: { secret: 'unresolved-http-canary' }
        }
      }
    })

    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      message: 'Dev browser capability transport could not resolve the requested capability.'
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('preserves typed capability errors inside the dev HTTP bridge envelope', async () => {
    const brokerError = new CapabilityBrokerError(
      'outcome_unknown',
      'The mutation outcome is unknown.',
      {
        category: 'failed',
        cause: new Error('provider stack'),
        details: { expected: 'revision-2', path: '/private/provider/cache' }
      }
    )
    const capabilityDispatcher = registerCapabilityIpc({
      broker: { invoke: vi.fn(async () => Promise.reject(brokerError)) } as never,
      ipc: { removeHandler: vi.fn(), handle: vi.fn() } as never,
      isTrustedIpcSender: () => true
    })
    server = await startDevBrowserBridgeServer({
      dispatcher: capabilityDispatcher,
      resolveCapabilityTags: () => [],
      port: 0
    })

    const response = await postJson('/invoke', {
      channel: 'capability:invoke',
      payload: {
        transportRequestId: '123e4567-e89b-42d3-a456-426614174090',
        request: {
          actionId: 'content-space.upload-new',
          invocationId: 'upload-90',
          input: {}
        }
      }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      payload: {
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
    })
    expect(response.body).not.toContain('/private/provider/cache')
    expect(response.body).not.toContain('provider stack')
  })

  it('serves generic broker-managed resource content with HTTP byte ranges', async () => {
    const resource = {
      token: `cap_${'a'.repeat(32)}`,
      semanticRevision: '1',
      expiresAt: '2026-07-16T14:00:00.000Z'
    }
    const describe = vi.fn(async () => ({
      size: 8,
      mimeType: 'application/pdf',
      fileName: 'paper.pdf',
      maxChunkBytes: 4,
      recommendedChunkBytes: 4
    }))
    const readRange = vi.fn(async (payload: unknown) => {
      const range = (payload as { range: { offset: number; length: number } }).range
      return {
        offset: range.offset,
        length: range.length,
        size: 8,
        dataBase64: Buffer.from('PDF-DATA'.slice(range.offset, range.offset + range.length)).toString('base64')
      }
    })
    server = await startDevBrowserBridgeServer({
      dispatcher: { invoke: vi.fn() },
      resourceContent: { describe, readRange },
      port: 0,
      instanceId: 'resource-instance'
    })
    const access = JSON.stringify({ workspaceId: '/workspace', resource })
    const missingCredential = await readFromResponse(
      `/capability/resources/content?${new URLSearchParams({
        clientId: 'browser-resource',
        access
      })}`,
      { origin: null }
    )
    expect(missingCredential.status).toBe(409)
    expect(describe).not.toHaveBeenCalled()

    const query = new URLSearchParams({
      clientId: 'browser-resource',
      devInstanceId: 'resource-instance',
      access
    })

    const response = await readFromResponse(`/capability/resources/content?${query}`, {
      origin: null,
      headers: { Range: 'bytes=4-7' }
    })

    expect(response.status).toBe(206)
    expect(response.body).toBe('DATA')
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.headers['content-range']).toBe('bytes 4-7/8')
    expect(describe).toHaveBeenCalledWith(
      { workspaceId: '/workspace', resource },
      expect.objectContaining({ id: expect.any(Number) })
    )
    expect(readRange).toHaveBeenCalledWith(
      { workspaceId: '/workspace', resource, range: { offset: 4, length: 4 } },
      expect.objectContaining({ id: expect.any(Number) })
    )
  })

  it('does not retain the legacy session-scoped Workspace Preview asset route', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })

    const response = await readFromResponse('/workspace-preview/assets/session-pdf?clientId=browser-1')

    expect(response.status).toBe(404)
    expect(JSON.parse(response.body)).toEqual({ ok: false, message: 'Not found.' })
    expect(invoke).not.toHaveBeenCalled()
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

  it.each([
    '',
    'https://localhost:5173',
    'http://localhost:5172',
    'http://localhost.example.com:5173',
    'http://127.0.0.1.example.com:5173',
    'null'
  ])('rejects an untrusted browser Origin value: %s', async (origin) => {
    const invoke = vi.fn(async () => ({ ok: true }))
    server = await startDevBrowserBridgeServer({
      dispatcher: { invoke },
      port: 0,
      instanceId: 'main-instance'
    })

    const payload = JSON.stringify({ channel: 'settings:get' })
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(new URL('/invoke', server?.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-SciForge-Client': 'browser-1',
          'X-SciForge-Dev-Instance': 'main-instance',
          Origin: origin
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

  it('treats CORS preflight as non-authorizing and still rejects non-local origins', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    server = await startDevBrowserBridgeServer({
      dispatcher: { invoke },
      port: 0,
      instanceId: 'main-instance'
    })
    const preflight = (origin: string): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const req = request(new URL('/invoke', server?.url), {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type,x-sciforge-dev-instance'
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
        req.end()
      })

    await expect(preflight('http://localhost:5173')).resolves.toEqual({ status: 204, body: '' })
    const untrusted = await preflight('https://example.com')
    expect(untrusted.status).toBe(403)
    expect(JSON.parse(untrusted.body)).toEqual({
      ok: false,
      message: 'Origin is not allowed.'
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects origin-less privileged requests when no instance credential is configured', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    server = await startDevBrowserBridgeServer({ dispatcher: { invoke }, port: 0 })

    const response = await readFromResponse('/events?clientId=browser-local', { origin: null })

    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      message: 'A trusted local Origin is required.'
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('opens event streams from local origins without token bootstrap', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })

    const sse = await openSse('/events?clientId=browser-local')

    server.send('agentRuntime:event', { kind: 'heartbeat' })
    await vi.waitFor(() => {
      expect(sse.chunks.join('')).toContain('"channel":"agentRuntime:event"')
      expect(sse.chunks.join('')).toContain('"kind":"heartbeat"')
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
      payload: { modelAccess: { mode: 'coding-plan', planAdapterId: 'example-plan' } }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      payload: { ok: true, payload: { modelAccess: { mode: 'coding-plan', planAdapterId: 'example-plan' } } }
    })
    expect(invoke).toHaveBeenCalledWith(
      'settings:set',
      { modelAccess: { mode: 'coding-plan', planAdapterId: 'example-plan' } },
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

    for (const channel of ['agentRuntime:connect', 'agentRuntime:startTurn'] as const) {
      const response = await postJson('/invoke', {
        channel,
        payload: { runtimeId: 'sciforge' }
      })

      expect(response.status).toBe(200)
      expect(JSON.parse(response.body).ok).toBe(true)
    }
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('allows callers to opt into an additional channel only through an explicit allowlist', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      allowedChannels: ['custom:channel']
    })

    const response = await postJson('/invoke', {
      channel: 'custom:channel',
      payload: { theme: 'dark' }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, payload: { ok: true, payload: { theme: 'dark' } } })
    expect(invoke).toHaveBeenCalledWith(
      'custom:channel',
      { theme: 'dark' },
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
    expect(server.hasClient(1)).toBe(true)

    const response = await postJson('/invoke', {
      channel: 'agentRuntime:subscribeEvents',
      payload: { threadId: 'thread-1', streamId: 'stream-1' }
    }, 'browser-2')

    expect(response.status).toBe(200)
    await vi.waitFor(() => {
      expect(sse.chunks.join('')).toContain('"channel":"agentRuntime:event"')
      expect(sse.chunks.join('')).toContain('"streamId":"stream-1"')
    })
    expect(server.sendTo(1, 'visibleContext:refresh-requested')).toBe(true)
    await vi.waitFor(() => {
      expect(sse.chunks.join('')).toContain('"channel":"visibleContext:refresh-requested"')
    })
    expect(server.sendTo(999, 'visibleContext:refresh-requested')).toBe(false)
    expect(server.hasClient(999)).toBe(false)
    sse.close()
  })

  it('returns revision-bound verified PNG pixels from the matching browser client', async () => {
    server = await startDevBrowserBridgeServer({
      dispatcher: { invoke: vi.fn(async () => ({ ok: true })) },
      port: 0
    })
    const sse = await openSse('/events?clientId=browser-capture')
    const capturePromise = server.captureSurface(1, {
      revision: 7,
      bounds: { x: 10, y: 20, width: 300, height: 400 }
    })

    await vi.waitFor(() => {
      expect(sse.chunks.join('')).toContain(
        '"channel":"devBrowserBridge:surface-capture-requested"'
      )
    })
    const captureMessage = sse.chunks.join('')
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)) as {
        channel?: string
        payload?: { requestId?: string; revision?: number }
      })
      .find((message) => message.channel === 'devBrowserBridge:surface-capture-requested')
    const canvas = createCanvas(600, 800)
    const response = await postJson('/surface-capture', {
      requestId: captureMessage?.payload?.requestId,
      revision: captureMessage?.payload?.revision,
      ok: true,
      viewportWidth: 1_000,
      viewportHeight: 800,
      pngBase64: canvas.toBuffer('image/png').toString('base64')
    }, 'browser-capture')

    expect(response.status).toBe(200)
    await expect(capturePromise).resolves.toMatchObject({
      png: expect.any(Uint8Array),
      width: 600,
      height: 800,
      scaleFactor: 2,
      bounds: { x: 10, y: 20, width: 300, height: 400 }
    })
    sse.close()
  })

  it('rejects browser pixels when their revision does not match the capture challenge', async () => {
    server = await startDevBrowserBridgeServer({
      dispatcher: { invoke: vi.fn(async () => ({ ok: true })) },
      port: 0
    })
    const sse = await openSse('/events?clientId=browser-stale-capture')
    const capturePromise = server.captureSurface(1, { revision: 9 })
    const captureRejection = expect(capturePromise).rejects.toThrow(/revision does not match/u)
    await vi.waitFor(() => {
      expect(sse.chunks.join('')).toContain(
        '"channel":"devBrowserBridge:surface-capture-requested"'
      )
    })
    const captureMessage = sse.chunks.join('')
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)) as {
        channel?: string
        payload?: { requestId?: string }
      })
      .find((message) => message.channel === 'devBrowserBridge:surface-capture-requested')
    const canvas = createCanvas(100, 80)
    const response = await postJson('/surface-capture', {
      requestId: captureMessage?.payload?.requestId,
      revision: 8,
      ok: true,
      viewportWidth: 100,
      viewportHeight: 80,
      pngBase64: canvas.toBuffer('image/png').toString('base64')
    }, 'browser-stale-capture')

    expect(response.status).toBe(400)
    await captureRejection
    sse.close()
  })

  it('broadcasts server-level messages to connected browser clients', async () => {
    const dispatcher: DevBrowserBridgeDispatcher = {
      invoke: vi.fn(async () => ({ ok: true }))
    }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })
    const first = await openSse('/events?clientId=browser-a')
    const second = await openSse('/events?clientId=browser-b')

    server.send('agentRuntime:event', {
      streamId: 'stream-1',
      threadId: 'thread-1',
      runtimeId: 'codex'
    })

    await vi.waitFor(() => {
      expect(first.chunks.join('')).toContain('"channel":"agentRuntime:event"')
      expect(first.chunks.join('')).toContain('"threadId":"thread-1"')
      expect(second.chunks.join('')).toContain('"channel":"agentRuntime:event"')
      expect(second.chunks.join('')).toContain('"threadId":"thread-1"')
    })
    first.close()
    second.close()
  })
})
