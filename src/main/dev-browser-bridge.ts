import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AppBridgeSender } from './ipc/register-app-ipc-handlers'
import {
  capabilityResourceContentDescriptorSchema,
  capabilityResourceContentRangeSchema
} from '../shared/capability-broker'
import { parseCapabilityResourceContentAccess } from '../shared/workspace-preview-asset-url'
import { isLocalHttpBodyTooLargeError, readIncomingMessageBody } from './local-http-body'
import { mainPerformanceMonitor } from './performance-monitor'

const DEFAULT_DEV_BROWSER_BRIDGE_PORT = 5174
const DEFAULT_MAX_INVOKE_BODY_BYTES = 24 * 1024 * 1024
const CLIENT_DESTROY_DELAY_MS = 1_000
const DEV_BROWSER_BRIDGE_ALLOWED_HEADERS = [
  'Content-Type',
  'X-SciForge-Client',
  'X-SciForge-Dev-Instance'
].join(',')

// The bridge is gated to localhost renderer origins and is only started for
// development builds. The browser dev surface is intentionally expected to
// match the Electron preload API so product work can be debugged in a normal
// browser without a second feature matrix.
// Keep this list in lockstep with src/preload/index.ts and
// src/renderer/src/dev/dev-sciforge-bridge.ts; tests enforce that cleanup
// refactors do not silently remove web parity again.
export const DEFAULT_DEV_BROWSER_BRIDGE_ALLOWED_CHANNELS = [
  'agentRuntime:auxiliary',
  'agentRuntime:capabilities',
  'agentRuntime:compactThread',
  'agentRuntime:connect',
  'agentRuntime:deleteThread',
  'agentRuntime:forkThread',
  'agentRuntime:interruptTurn',
  'agentRuntime:listThreads',
  'agentRuntime:readThread',
  'agentRuntime:readThreadSidebarProbe',
  'agentRuntime:renameThread',
  'agentRuntime:resolveApproval',
  'agentRuntime:resolveUserInput',
  'agentRuntime:resumeSession',
  'agentRuntime:startThread',
  'agentRuntime:startTurn',
  'agentRuntime:steerTurn',
  'agentRuntime:stopEvents',
  'agentRuntime:subscribeEvents',
  'agentRuntime:updateThreadRelation',
  'agentRuntime:usage',
  'anchoredComments:asset:read',
  'anchoredComments:capture',
  'anchoredComments:delete',
  'anchoredComments:feedback:status',
  'anchoredComments:feedback:submit',
  'anchoredComments:get',
  'anchoredComments:list',
  'anchoredComments:upsert',
  'app:version',
  'capability:readiness',
  'capability:discover',
  'capability:events',
  'capability:invoke',
  'capability:observe',
  'capability:subscribe',
  'capability:unsubscribe',
  'clipboard:paste-workspace',
  'clipboard:read-image',
  'computer-use:permissions',
  'computer-use:request-permission',
  'computer-use:status',
  'connectPhone:install:poll',
  'connectPhone:install:qrcode',
  'connectPhone:status',
  'desktop:command',
  'discord:bind-channel',
  'discord:channels',
  'discord:configure-client',
  'discord:configure-proxy',
  'discord:configure-token',
  'discord:guilds',
  'discord:set-guard',
  'discord:status',
  'discord:test-send',
  'editor:list',
  'editor:open-path',
  'evidenceDag:resolve-evidence-preview',
  'evidenceDag:update',
  'evidenceDag:priority',
  'evidenceDag:view',
  'visual-style:extract-profile',
  'visual-style:save-profile',
  'file:copy-workspace-entry',
  'file:create-workspace',
  'file:create-workspace-directory',
  'file:delete-workspace-entry',
  'file:import-workspace-entries',
  'file:list-workspace-directory',
  'file:move-workspace-entry',
  'file:read-workspace',
  'file:read-workspace-image',
  'file:rename-workspace-entry',
  'file:suggest-workspace-pdf-name',
  'file:resolve-workspace',
  'file:save-workspace-clipboard-image',
  'file:start-workspace-native-drag',
  'file:unwatch-workspace',
  'file:watch-workspace',
  'file:write-workspace',
  'git:branches',
  'git:create-and-switch-branch',
  'git:switch-branch',
  'gui:update-check',
  'gui:update-download',
  'gui:update-install',
  'gui:update-state',
  'log:error',
  'log:get-path',
  'log:open-dir',
  'mcp:bgc-discovery-config',
  'mcp:image-generation-config',
  'mcp:ppt-master-config',
  'mcp:scientific-plotting-config',
  'mcp:scientific-skills-config',
  'mcp:scientific-skills-status',
  'modelAccess:status',
  'notification:turn-complete',
  'performance:snapshot',
  'projectDag:resolve-evidence-preview',
  'projectDag:save-goal',
  'projectDag:update',
  'projectDag:view',
  'remoteChannel:active-thread-context',
  'remoteChannel:message:mirror',
  'remoteChannel:task:create-from-text',
  'researchCards:archive',
  'researchCards:create',
  'researchCards:list',
  'researchCards:update',
  'schedule:status',
  'schedule:task:create-from-text',
  'schedule:task:run',
  'scientific-plotting:prepare-reference',
  'scientific-plotting:status',
  'scientific-skills:install',
  'visual-document:accept-candidate',
  'visual-document:create-candidate',
  'visual-document:export-review-packet',
  'visual-document:insert-artifact',
  'visual-document:open',
  'visual-document:reject-candidate',
  'visual-document:save-annotations',
  'visual-document:status',
  'visual-document:update-context',
  'settings:get',
  'settings:set',
  'shell:open-external',
  'skill:list',
  'skill:open-root',
  'skill:save-file',
  'speech:transcribe',
  'terminal:create',
  'terminal:dispose',
  'terminal:resize',
  'terminal:write',
  'traces:clear',
  'traces:export',
  'traces:read',
  'traces:summaries',
  'upstream:models',
  'visibleContext:capture:preview',
  'visibleContext:get',
  'visibleContext:publish',
  'workflow:approval:resolve',
  'workflow:code:check',
  'workflow:node:run',
  'workflow:node:test',
  'workflow:run',
  'workflow:status',
  'workflow:stop',
  'workspace:pick-directory',
  'workspace:pick-file',
  'write:copy-rich-text',
  'write:export',
  'write:inline-completion',
  'write:inline-completion-debug:clear',
  'write:inline-completion-debug:list',
  'write:retrieve-context',
  'zulip:bind-channel',
  'zulip:configure',
  'zulip:set-guard',
  'zulip:status',
  'zulip:streams',
  'zulip:test-send',
  'zulip:topics'
] as const

export type DevBrowserBridgeDispatcher = {
  invoke: (channel: string, payload: unknown, sender: AppBridgeSender) => Promise<unknown>
}

export type DevBrowserBridgeServer = {
  server: Server
  url: string
  send: (channel: string, ...args: unknown[]) => void
  sendTo: (clientNumericId: number, channel: string, ...args: unknown[]) => boolean
  hasClient: (clientNumericId: number) => boolean
  close: () => Promise<void>
}

export type DevBrowserBridgeResourceContent = {
  describe: (payload: unknown, sender: AppBridgeSender) => Promise<unknown>
  readRange: (payload: unknown, sender: AppBridgeSender) => Promise<unknown>
}

type StartDevBrowserBridgeServerOptions = {
  dispatcher: DevBrowserBridgeDispatcher
  resourceContent?: DevBrowserBridgeResourceContent
  host?: string
  port?: number
  maxInvokeBodyBytes?: number
  allowedChannels?: readonly string[]
  allowAllChannels?: boolean
  instanceId?: string
}

type ParsedHttpByteRange =
  | { ok: true; start: number; end: number }
  | { ok: false; message: string }

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
    const startedAt = mainPerformanceMonitor.now()
    mainPerformanceMonitor.count('main.devBridge.send')
    mainPerformanceMonitor.count(`main.devBridge.send.${channel}`)
    try {
      const payload = args.length <= 1 ? args[0] : args
      const data = JSON.stringify({ channel, payload })
      for (const response of this.responses) {
        response.write(`event: bridge-message\ndata: ${data}\n\n`)
      }
    } finally {
      mainPerformanceMonitor.sample('main.devBridge.send.duration', mainPerformanceMonitor.now() - startedAt, {
        channel,
        responses: this.responses.size
      })
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
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]')
  } catch {
    return false
  }
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
  response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', DEV_BROWSER_BRIDGE_ALLOWED_HEADERS)
  response.setHeader('Access-Control-Allow-Private-Network', 'true')
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

function createAllowedChannelSet(channels: readonly string[] | undefined): ReadonlySet<string> {
  return new Set((channels ?? DEFAULT_DEV_BROWSER_BRIDGE_ALLOWED_CHANNELS)
    .map((channel) => channel.trim())
    .filter(Boolean))
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const text = await readIncomingMessageBody(request, maxBytes)
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

function parseHttpByteRange(value: string | undefined, size: number): ParsedHttpByteRange | null {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim())
  if (!match) return { ok: false, message: 'Only a single bytes range is supported.' }
  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return { ok: false, message: 'Byte range is empty.' }
  if (size <= 0) return { ok: false, message: 'Byte range is not satisfiable.' }
  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { ok: false, message: 'Byte range suffix is invalid.' }
    }
    return { ok: true, start: Math.max(0, size - suffixLength), end: size - 1 }
  }
  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return { ok: false, message: 'Byte range is not satisfiable.' }
  }
  return { ok: true, start, end: Math.min(end, size - 1) }
}

export async function startDevBrowserBridgeServer(
  options: StartDevBrowserBridgeServerOptions
): Promise<DevBrowserBridgeServer> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? DEFAULT_DEV_BROWSER_BRIDGE_PORT
  const maxInvokeBodyBytes = options.maxInvokeBodyBytes ?? DEFAULT_MAX_INVOKE_BODY_BYTES
  const allowedChannels = createAllowedChannelSet(options.allowedChannels)
  const instanceId = options.instanceId?.trim() || ''
  const clients = new Map<string, DevBrowserBridgeClient>()
  const clientsByNumericId = new Map<number, DevBrowserBridgeClient>()
  let nextClientNumericId = 1

  const getClient = (clientId: string): DevBrowserBridgeClient => {
    const existing = clients.get(clientId)
    if (existing && !existing.isDestroyed()) return existing
    const created = new DevBrowserBridgeClient(nextClientNumericId++, clientId)
    created.once('destroyed', () => {
      if (clients.get(clientId) === created) clients.delete(clientId)
      clientsByNumericId.delete(created.id)
    })
    clients.set(clientId, created)
    clientsByNumericId.set(created.id, created)
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
      writeJson(response, 200, instanceId ? { ok: true, instanceId } : { ok: true })
      return
    }

    if (instanceId) {
      const suppliedInstanceId = request.headers['x-sciforge-dev-instance']
        ?? requestUrl.searchParams.get('devInstanceId')
      if (suppliedInstanceId !== instanceId) {
        writeJson(response, 409, {
          ok: false,
          message: 'The renderer and Electron main belong to different development instances. Reload the current dev endpoint.'
        })
        return
      }
    }

    if (request.method === 'GET' && requestUrl.pathname === '/events') {
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

    if ((request.method === 'GET' || request.method === 'HEAD')
      && requestUrl.pathname === '/capability/resources/content') {
      void (async () => {
        try {
          if (!options.resourceContent) {
            writeJson(response, 404, { ok: false, message: 'Capability resource content is unavailable.' })
            return
          }
          const serializedAccess = requestUrl.searchParams.get('access')
          if (!serializedAccess) {
            writeJson(response, 400, { ok: false, message: 'Capability resource access is required.' })
            return
          }
          const payload = parseCapabilityResourceContentAccess(serializedAccess)
          if (!payload) {
            writeJson(response, 400, { ok: false, message: 'Capability resource access is invalid.' })
            return
          }
          const clientId = normalizeClientId(requestUrl.searchParams.get('clientId') ?? undefined)
          const sender = getClient(clientId)
          const descriptor = capabilityResourceContentDescriptorSchema.parse(
            await options.resourceContent.describe(payload, sender)
          )
          const range = parseHttpByteRange(request.headers.range, descriptor.size)
          if (range && !range.ok) {
            response.setHeader('Content-Range', `bytes */${descriptor.size}`)
            writeJson(response, 416, { ok: false, message: range.message })
            return
          }
          const start = range?.start ?? 0
          const end = range?.end ?? descriptor.size - 1
          const contentLength = descriptor.size === 0 ? 0 : Math.max(0, end - start + 1)
          response.statusCode = range ? 206 : 200
          response.setHeader('Accept-Ranges', 'bytes')
          response.setHeader('Cache-Control', 'no-store')
          response.setHeader('Content-Type', descriptor.mimeType)
          response.setHeader('Content-Length', String(contentLength))
          response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
          if (range) response.setHeader('Content-Range', `bytes ${start}-${end}/${descriptor.size}`)
          if (request.method === 'HEAD' || contentLength === 0) {
            response.end()
            return
          }
          const chunkBytes = Math.max(1, Math.min(
            descriptor.recommendedChunkBytes,
            descriptor.maxChunkBytes
          ))
          let offset = start
          while (offset <= end) {
            const length = Math.min(chunkBytes, end - offset + 1)
            const result = capabilityResourceContentRangeSchema.parse(
              await options.resourceContent.readRange({ ...payload, range: { offset, length } }, sender)
            )
            const bytes = Buffer.from(result.dataBase64, 'base64')
            if (bytes.length === 0) throw new Error('Capability resource ended before the requested byte range.')
            const bounded = bytes.length > length ? bytes.subarray(0, length) : bytes
            response.write(bounded)
            offset += bounded.length
          }
          response.end()
        } catch (error) {
          if (response.headersSent) {
            response.destroy(error instanceof Error ? error : new Error(String(error)))
            return
          }
          writeJson(response, 404, {
            ok: false,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })()
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/invoke') {
      void (async () => {
        const startedAt = mainPerformanceMonitor.now()
        let channel = ''
        try {
          const body = parseInvokeBody(await readJsonBody(request, maxInvokeBodyBytes))
          channel = body.channel
          mainPerformanceMonitor.count('main.devBridge.http.invoke')
          mainPerformanceMonitor.count(`main.devBridge.http.invoke.${body.channel}`)
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
        } finally {
          mainPerformanceMonitor.sample('main.devBridge.http.invoke.duration', mainPerformanceMonitor.now() - startedAt, {
            channel
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
    send: (channel, ...args) => {
      for (const client of clients.values()) {
        client.send(channel, ...args)
      }
    },
    sendTo: (clientNumericId, channel, ...args) => {
      const client = clientsByNumericId.get(clientNumericId)
      if (!client || client.isDestroyed()) return false
      client.send(channel, ...args)
      return true
    },
    hasClient: (clientNumericId) => {
      const client = clientsByNumericId.get(clientNumericId)
      return Boolean(client && !client.isDestroyed())
    },
    close: async () => {
      for (const client of clients.values()) {
        client.destroy()
      }
      clients.clear()
      clientsByNumericId.clear()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  }
}
