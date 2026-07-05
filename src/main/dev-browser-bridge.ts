import { EventEmitter } from 'node:events'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AppBridgeSender } from './ipc/register-app-ipc-handlers'
import { isLocalHttpBodyTooLargeError, readIncomingMessageBody } from './local-http-body'

const DEFAULT_DEV_BROWSER_BRIDGE_PORT = 5174
const MAX_INVOKE_BODY_BYTES = 2_000_000
const CLIENT_DESTROY_DELAY_MS = 1_000
export const DEV_BROWSER_BRIDGE_TOKEN_HEADER = 'X-SciForge-Bridge-Token'
export const DEV_BROWSER_BRIDGE_TOKEN_QUERY_PARAM = 'sciforgeBridgeToken'
const DEV_BROWSER_BRIDGE_TOKEN_BYTES = 32
const DEFAULT_DEV_BROWSER_BRIDGE_BOOTSTRAP_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173'
])
const DEV_BROWSER_BRIDGE_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-SciForge-Client',
  DEV_BROWSER_BRIDGE_TOKEN_HEADER
].join(',')

// The bridge is protected by a per-dev-session token and is used to run the
// full app in an external browser during development. Keep unrelated host
// write actions opt-in, but allow the runtime channels the workbench needs.
export const DEFAULT_DEV_BROWSER_BRIDGE_ALLOWED_CHANNELS = [
  'settings:get',
  'settings:set',
  'upstream:models',
  'connectPhone:status',
  'schedule:status',
  'workflow:status',
  'workflow:code:check',
  'discord:status',
  'discord:guilds',
  'discord:channels',
  'zulip:status',
  'zulip:configure',
  'zulip:streams',
  'zulip:topics',
  'zulip:bind-channel',
  'zulip:test-send',
  'zulip:set-guard',
  'skill:list',
  'runtimeConfig:read',
  'git:branches',
  'editor:list',
  'file:resolve-workspace',
  'file:list-workspace-directory',
  'file:read-workspace',
  'file:preview-workspace-html',
  'file:read-workspace-image',
  'file:watch-workspace',
  'file:unwatch-workspace',
  'write:inline-completion',
  'write:retrieve-context',
  'pdfAnnotations:load',
  'computer-use:permissions',
  'computer-use:status',
  'paperRadar:status',
  'paperRadar:profiles:list',
  'paperRadar:search',
  'paperRadar:rank',
  'paperRadar:digest',
  'mcp:sciforge-canvas-config',
  'sciforge-canvas:status',
  'sciforge-canvas:open',
  'sciforge-canvas:save',
  'sciforge-canvas:save-selection',
  'sciforge-canvas:insert-artifact',
  'sciforge-canvas:import-recent-artifacts',
  'sciforge-canvas:export-review-packet',
  'agentRuntime:capabilities',
  'agentRuntime:connect',
  'agentRuntime:listThreads',
  'agentRuntime:startThread',
  'agentRuntime:readThread',
  'agentRuntime:startTurn',
  'agentRuntime:interruptTurn',
  'agentRuntime:steerTurn',
  'agentRuntime:subscribeEvents',
  'agentRuntime:stopEvents',
  'agentRuntime:renameThread',
  'agentRuntime:deleteThread',
  'agentRuntime:compactThread',
  'agentRuntime:forkThread',
  'agentRuntime:resumeSession',
  'agentRuntime:updateThreadRelation',
  'agentRuntime:usage',
  'agentRuntime:auxiliary',
  'agentRuntime:resolveApproval',
  'agentRuntime:resolveUserInput',
  'terminal:create',
  'terminal:write',
  'terminal:resize',
  'terminal:dispose',
  'app:version',
  'gui:update-state',
  'gui:update-check',
  'log:get-path'
] as const

export type DevBrowserBridgeDispatcher = {
  invoke: (channel: string, payload: unknown, sender: AppBridgeSender) => Promise<unknown>
}

export type DevBrowserBridgeServer = {
  server: Server
  url: string
  token: string
  send: (channel: string, ...args: unknown[]) => void
  close: () => Promise<void>
}

type StartDevBrowserBridgeServerOptions = {
  dispatcher: DevBrowserBridgeDispatcher
  host?: string
  port?: number
  token?: string
  allowedChannels?: readonly string[]
  allowAllChannels?: boolean
  bootstrapOrigins?: readonly string[]
}

class DevBrowserBridgeClient extends EventEmitter implements AppBridgeSender {
  readonly id: number
  readonly clientId: string
  private readonly responses = new Set<ServerResponse>()
  private destroyed = false
  private destroyTimer: ReturnType<typeof setTimeout> | null = null

  constructor(id: number, clientId: string) {
    super()
    this.id = id
    this.clientId = clientId
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  send(channel: string, ...args: unknown[]): void {
    if (this.destroyed) return
    const payload = args.length <= 1 ? args[0] : args
    const data = JSON.stringify({ channel, payload })
    for (const response of this.responses) {
      response.write(`event: bridge-message\ndata: ${data}\n\n`)
    }
  }

  attach(response: ServerResponse): void {
    if (this.destroyed) return
    if (this.destroyTimer) {
      clearTimeout(this.destroyTimer)
      this.destroyTimer = null
    }
    this.responses.add(response)
    response.on('close', () => {
      this.responses.delete(response)
      this.scheduleDestroy()
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.destroyTimer) {
      clearTimeout(this.destroyTimer)
      this.destroyTimer = null
    }
    for (const response of this.responses) {
      response.end()
    }
    this.responses.clear()
    this.emit('destroyed')
    this.removeAllListeners()
  }

  private scheduleDestroy(): void {
    if (this.destroyed || this.responses.size > 0 || this.destroyTimer) return
    this.destroyTimer = setTimeout(() => this.destroy(), CLIENT_DESTROY_DELAY_MS)
  }
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
  } catch {
    return false
  }
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function createBootstrapOriginSet(origins: readonly string[] | undefined): ReadonlySet<string> {
  if (!origins) return DEFAULT_DEV_BROWSER_BRIDGE_BOOTSTRAP_ORIGINS
  return new Set(
    origins
      .map((origin) => normalizeOrigin(origin))
      .filter((origin): origin is string => Boolean(origin))
  )
}

function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin
  if (typeof origin === 'string') {
    if (!isAllowedOrigin(origin)) {
      writeJson(response, 403, { ok: false, message: 'Origin is not allowed.' })
      return false
    }
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', DEV_BROWSER_BRIDGE_ALLOWED_HEADERS)
  return true
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

function normalizeClientId(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim() ?? ''
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(trimmed)) return trimmed
  return 'default'
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.trim() ?? ''
}

function normalizeToken(value: string | undefined): string | undefined {
  const token = value?.trim()
  return token || undefined
}

function createBridgeToken(configuredToken: string | undefined): string {
  return normalizeToken(configuredToken) ?? randomBytes(DEV_BROWSER_BRIDGE_TOKEN_BYTES).toString('hex')
}

function timingSafeStringEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (actualBuffer.byteLength !== expectedBuffer.byteLength) return false
  return timingSafeEqual(actualBuffer, expectedBuffer)
}

function parseAuthorizationBearer(value: string): string {
  const match = /^Bearer\s+(.+)$/i.exec(value)
  return match?.[1]?.trim() ?? ''
}

function getBridgeToken(request: IncomingMessage, requestUrl?: URL): string {
  const primary = normalizeHeaderValue(request.headers[DEV_BROWSER_BRIDGE_TOKEN_HEADER.toLowerCase()])
  if (primary) return primary
  const bearer = parseAuthorizationBearer(normalizeHeaderValue(request.headers.authorization))
  if (bearer) return bearer
  return normalizeToken(requestUrl?.searchParams.get(DEV_BROWSER_BRIDGE_TOKEN_QUERY_PARAM) ?? undefined) ?? ''
}

function hasValidBridgeToken(request: IncomingMessage, expectedToken: string, requestUrl?: URL): boolean {
  const providedToken = getBridgeToken(request, requestUrl)
  return Boolean(providedToken) && timingSafeStringEqual(providedToken, expectedToken)
}

function createAllowedChannelSet(channels: readonly string[] | undefined): ReadonlySet<string> {
  return new Set((channels ?? DEFAULT_DEV_BROWSER_BRIDGE_ALLOWED_CHANNELS)
    .map((channel) => channel.trim())
    .filter(Boolean))
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const text = await readIncomingMessageBody(request, MAX_INVOKE_BODY_BYTES)
  if (!text.trim()) return null
  return JSON.parse(text) as unknown
}

function parseInvokeBody(value: unknown): { channel: string; payload: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invoke body must be an object.')
  }
  const body = value as { channel?: unknown; payload?: unknown }
  if (typeof body.channel !== 'string' || !body.channel.trim()) {
    throw new Error('Invoke channel is required.')
  }
  return {
    channel: body.channel.trim(),
    payload: body.payload
  }
}

export async function startDevBrowserBridgeServer(
  options: StartDevBrowserBridgeServerOptions
): Promise<DevBrowserBridgeServer> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? DEFAULT_DEV_BROWSER_BRIDGE_PORT
  const token = createBridgeToken(options.token)
  const allowedChannels = createAllowedChannelSet(options.allowedChannels)
  const bootstrapOrigins = createBootstrapOriginSet(options.bootstrapOrigins)
  const clients = new Map<string, DevBrowserBridgeClient>()
  let nextClientNumericId = 1

  const getClient = (clientId: string): DevBrowserBridgeClient => {
    const existing = clients.get(clientId)
    if (existing && !existing.isDestroyed()) return existing
    const created = new DevBrowserBridgeClient(nextClientNumericId++, clientId)
    created.once('destroyed', () => {
      if (clients.get(clientId) === created) clients.delete(clientId)
    })
    clients.set(clientId, created)
    return created
  }

  const server = createServer((request, response) => {
    if (!applyCors(request, response)) return
    if (request.method === 'OPTIONS') {
      response.statusCode = 204
      response.end()
      return
    }

    const requestUrl = new URL(request.url ?? '/', `http://${host}:${port}`)
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/bootstrap') {
      const requestOrigin = normalizeOrigin(
        typeof request.headers.origin === 'string' ? request.headers.origin : undefined
      )
      if (!requestOrigin || !bootstrapOrigins.has(requestOrigin)) {
        writeJson(response, 403, {
          ok: false,
          message: 'Dev browser bridge bootstrap origin is not allowed.'
        })
        return
      }
      writeJson(response, 200, { ok: true, token })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/events') {
      if (!hasValidBridgeToken(request, token, requestUrl)) {
        writeJson(response, 401, {
          ok: false,
          message: 'Dev browser bridge token is missing or invalid.'
        })
        return
      }
      const clientId = normalizeClientId(requestUrl.searchParams.get('clientId') ?? undefined)
      const client = getClient(clientId)
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive'
      })
      response.write('event: bridge-ready\ndata: {"ok":true}\n\n')
      client.attach(response)
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/invoke') {
      if (!hasValidBridgeToken(request, token)) {
        writeJson(response, 401, {
          ok: false,
          message: 'Dev browser bridge token is missing or invalid.'
        })
        return
      }
      void (async () => {
        try {
          const body = parseInvokeBody(await readJsonBody(request))
          if (!options.allowAllChannels && !allowedChannels.has(body.channel)) {
            writeJson(response, 403, {
              ok: false,
              message: `Dev browser bridge channel is not allowed: ${body.channel}`
            })
            return
          }
          const clientId = normalizeClientId(request.headers['x-sciforge-client'])
          const payload = await options.dispatcher.invoke(body.channel, body.payload, getClient(clientId))
          writeJson(response, 200, { ok: true, payload })
        } catch (error) {
          writeJson(response, isLocalHttpBodyTooLargeError(error) ? 413 : 500, {
            ok: false,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })()
      return
    }

    writeJson(response, 404, { ok: false, message: 'Not found.' })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address() as AddressInfo
  const url = `http://${host}:${address.port}`

  return {
    server,
    url,
    token,
    send: (channel, ...args) => {
      for (const client of clients.values()) {
        client.send(channel, ...args)
      }
    },
    close: async () => {
      for (const client of clients.values()) {
        client.destroy()
      }
      clients.clear()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  }
}
