import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { loadImage } from '@napi-rs/canvas'
import type { AppBridgeSender } from './ipc/register-app-ipc-handlers'
import type { VisibleContextBounds } from '../shared/visible-context'
import {
  capabilityResourceContentDescriptorSchema,
  capabilityResourceContentRangeSchema
} from '../shared/capability-broker'
import { parseCapabilityResourceContentAccess } from '../shared/workspace-preview-asset-url'
import { isLocalHttpBodyTooLargeError, readIncomingMessageBody } from './local-http-body'
import { mainPerformanceMonitor } from './performance-monitor'

const DEFAULT_DEV_BROWSER_BRIDGE_PORT = 5174
const DEFAULT_DEV_BROWSER_RENDERER_PORT = '5173'
const DEFAULT_MAX_INVOKE_BODY_BYTES = 24 * 1024 * 1024
const DEFAULT_MAX_SURFACE_CAPTURE_BODY_BYTES = 48 * 1024 * 1024
const MAX_SURFACE_CAPTURE_PNG_BYTES = 32 * 1024 * 1024
const DEFAULT_SURFACE_CAPTURE_TIMEOUT_MS = 5_000
const CLIENT_DESTROY_DELAY_MS = 1_000
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
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
  'agentRuntime:readThreadStatus',
  'agentRuntime:readThreadPage',
  'agentRuntime:readToolArtifact',
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
  'app:version',
  'capability:bind',
  'capability:cancel',
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
  'desktop:command',
  'editor:list',
  'editor:open-path',
  'extensions:install',
  'extensions:list',
  'extensions:rollback',
  'extensions:set-enabled',
  'extensions:uninstall',
  'file:copy-workspace-entry',
  'file:create-workspace',
  'file:create-workspace-directory',
  'file:delete-workspace-entry',
  'file:import-workspace-entries',
  'file:list-workspace-directory',
  'file:move-workspace-entry',
  'file:read-workspace',
  'file:read-workspace-image',
  'file:read-workspace-range',
  'file:rename-workspace-entry',
  'file:resolve-workspace',
  'file:save-workspace-clipboard-image',
  'file:search-workspace-text',
  'file:suggest-workspace-pdf-name',
  'file:unwatch-workspace',
  'file:watch-workspace',
  'file:write-workspace',
  'fileTransfer:cancel',
  'fileTransfer:pick-download-destination',
  'fileTransfer:pick-upload-source',
  'fileTransfer:settle',
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
  'mcp:scientific-skills-config',
  'mcp:scientific-skills-status',
  'modelAccess:status',
  'notification:turn-complete',
  'performance:snapshot',
  'remoteWorkspace:attach',
  'remoteWorkspace:close',
  'remoteWorkspace:get',
  'remoteWorkspace:list',
  'remoteWorkspace:reconnect',
  'remoteWorkspace:select',
  'researchCards:archive',
  'researchCards:create',
  'researchCards:list',
  'researchCards:update',
  'schedule:status',
  'schedule:task:create-from-text',
  'schedule:task:run',
  'scientific-skills:install',
  'settings:get',
  'settings:set',
  'shell:open-external',
  'skill:list',
  'skill:open-root',
  'skill:save-file',
  'speech:transcribe',
  'traces:clear',
  'traces:export',
  'traces:read',
  'traces:summaries',
  'upstream:models',
  'visibleContext:capture:preview',
  'visibleContext:get',
  'visibleContext:publish',
  'visibleContext:target-ref',
  'workspace:pick-directory',
  'workspace:pick-file',
  'write:export',
  'write:inline-completion',
  'write:inline-completion-debug:clear',
  'write:inline-completion-debug:list',
  'write:retrieve-context'
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
  captureSurface: (
    clientNumericId: number,
    request: DevBrowserSurfaceCaptureRequest
  ) => Promise<DevBrowserSurfaceCapture>
  close: () => Promise<void>
}

export type DevBrowserSurfaceCaptureRequest = Readonly<{
  revision: number
  bounds?: VisibleContextBounds
}>

export type DevBrowserSurfaceCapture = Readonly<{
  png: Uint8Array
  width: number
  height: number
  scaleFactor: number
  bounds?: VisibleContextBounds
}>

export type DevBrowserBridgeResourceContent = {
  describe: (payload: unknown, sender: AppBridgeSender) => Promise<unknown>
  readRange: (payload: unknown, sender: AppBridgeSender) => Promise<unknown>
}

type StartDevBrowserBridgeServerOptions = {
  dispatcher: DevBrowserBridgeDispatcher
  /**
   * Resolves authoritative registry tags for HTTP transport policy. When it is
   * absent, capability invocations fail closed while non-capability channels
   * remain available to focused transport tests and tooling.
   */
  resolveCapabilityTags?: (actionId: string) => readonly string[] | undefined
  resourceContent?: DevBrowserBridgeResourceContent
  host?: string
  port?: number
  maxInvokeBodyBytes?: number
  maxSurfaceCaptureBodyBytes?: number
  surfaceCaptureTimeoutMs?: number
  allowedChannels?: readonly string[]
  instanceId?: string
}

type ParsedHttpByteRange =
  | { ok: true; start: number; end: number }
  | { ok: false; message: string }

type PendingSurfaceCapture = {
  clientNumericId: number
  revision: number
  bounds?: VisibleContextBounds
  resolve: (capture: DevBrowserSurfaceCapture) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type SurfaceCaptureUpload = {
  requestId: string
  revision: number
} & (
  | {
      ok: true
      viewportWidth: number
      viewportHeight: number
      pngBase64: string
    }
  | {
      ok: false
      error: string
    }
)

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

  send(channel: string, ...args: unknown[]): boolean {
    if (this.destroyed || this.responses.size === 0) return false
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
    return true
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
  if (origin === undefined) return true
  if (!origin) return false
  try {
    const url = new URL(origin)
    return url.origin === origin &&
      url.protocol === 'http:' &&
      !url.username &&
      !url.password &&
      url.port === DEFAULT_DEV_BROWSER_RENDERER_PORT &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]')
  } catch {
    return false
  }
}

function hasExactDevInstanceCredential(
  request: IncomingMessage,
  requestUrl: URL,
  expectedInstanceId: string
): boolean {
  const headerValue = request.headers['x-sciforge-dev-instance']
  if (Array.isArray(headerValue)) return false
  const queryValues = requestUrl.searchParams.getAll('devInstanceId')
  if (queryValues.length > 1) return false
  const queryValue = queryValues[0]
  if (headerValue !== undefined && queryValue !== undefined) {
    return headerValue === expectedInstanceId && queryValue === expectedInstanceId
  }
  return (headerValue ?? queryValue) === expectedInstanceId
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

function capabilityInvocationActionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const request = (payload as { request?: unknown }).request
  if (!request || typeof request !== 'object' || Array.isArray(request)) return undefined
  const actionId = (request as { actionId?: unknown }).actionId
  return typeof actionId === 'string' && actionId.trim() ? actionId.trim() : undefined
}

function parseSurfaceCaptureUpload(value: unknown): SurfaceCaptureUpload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Surface capture response must be an object.')
  }
  const body = value as Record<string, unknown>
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : ''
  if (!/^[0-9a-f-]{36}$/u.test(requestId)) {
    throw new Error('Surface capture request ID is invalid.')
  }
  const revision = positiveSafeInteger(body.revision, 'Surface capture revision')
  if (body.ok === false) {
    const error = typeof body.error === 'string' ? body.error.trim() : ''
    if (!error || error.length > 1_000) {
      throw new Error('Surface capture failure message is invalid.')
    }
    return { requestId, revision, ok: false, error }
  }
  if (body.ok !== true) {
    throw new Error('Surface capture response status is invalid.')
  }
  const viewportWidth = positiveFiniteNumber(body.viewportWidth, 'Surface capture viewport width')
  const viewportHeight = positiveFiniteNumber(body.viewportHeight, 'Surface capture viewport height')
  const pngBase64 = typeof body.pngBase64 === 'string' ? body.pngBase64 : ''
  if (!pngBase64 || pngBase64.length > Math.ceil(MAX_SURFACE_CAPTURE_PNG_BYTES / 3) * 4 + 4) {
    throw new Error('Surface capture PNG payload is invalid.')
  }
  return { requestId, revision, ok: true, viewportWidth, viewportHeight, pngBase64 }
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} is invalid.`)
  }
  return value as number
}

function positiveFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100_000) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

async function decodeSurfaceCapture(
  upload: SurfaceCaptureUpload,
  pending: PendingSurfaceCapture
): Promise<DevBrowserSurfaceCapture> {
  if (upload.revision !== pending.revision) {
    throw new Error('Surface capture revision does not match the requested visible layout.')
  }
  if (!upload.ok) {
    throw new Error(`Browser pixel capture failed: ${upload.error}`)
  }
  const canonicalBase64 = upload.pngBase64.replace(/\s/gu, '')
  const png = Buffer.from(canonicalBase64, 'base64')
  if (
    png.byteLength === 0 ||
    png.byteLength > MAX_SURFACE_CAPTURE_PNG_BYTES ||
    png.toString('base64') !== canonicalBase64 ||
    png.byteLength < 24 ||
    !png.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE) ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('Surface capture response is not a valid PNG image.')
  }
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (width < 1 || height < 1) {
    throw new Error('Surface capture PNG dimensions are invalid.')
  }
  const decoded = await loadImage(png).catch(() => null)
  if (!decoded || decoded.width !== width || decoded.height !== height) {
    throw new Error('Surface capture response could not be decoded as the declared PNG image.')
  }
  const bounds = pending.bounds
    ? clipSurfaceCaptureBounds(pending.bounds, upload.viewportWidth, upload.viewportHeight)
    : undefined
  const cssWidth = bounds?.width ?? upload.viewportWidth
  const cssHeight = bounds?.height ?? upload.viewportHeight
  const scaleFactor = width / cssWidth
  const verticalScaleFactor = height / cssHeight
  if (
    !Number.isFinite(scaleFactor) ||
    scaleFactor <= 0 ||
    Math.abs(scaleFactor - verticalScaleFactor) > Math.max(0.05, scaleFactor * 0.02)
  ) {
    throw new Error('Surface capture pixel dimensions do not match the requested viewport.')
  }
  return {
    png,
    width,
    height,
    scaleFactor,
    ...(bounds ? { bounds } : {})
  }
}

function clipSurfaceCaptureBounds(
  bounds: VisibleContextBounds,
  viewportWidth: number,
  viewportHeight: number
): VisibleContextBounds {
  for (const [field, value] of Object.entries(bounds)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Surface capture bound ${field} is invalid.`)
    }
  }
  const x = Math.max(0, Math.floor(bounds.x))
  const y = Math.max(0, Math.floor(bounds.y))
  const right = Math.min(viewportWidth, Math.ceil(bounds.x + bounds.width))
  const bottom = Math.min(viewportHeight, Math.ceil(bounds.y + bounds.height))
  if (right <= x || bottom <= y) {
    throw new Error('Surface capture target is outside the browser viewport.')
  }
  return { x, y, width: right - x, height: bottom - y }
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
  const maxSurfaceCaptureBodyBytes = options.maxSurfaceCaptureBodyBytes
    ?? DEFAULT_MAX_SURFACE_CAPTURE_BODY_BYTES
  const surfaceCaptureTimeoutMs = options.surfaceCaptureTimeoutMs
    ?? DEFAULT_SURFACE_CAPTURE_TIMEOUT_MS
  const allowedChannels = createAllowedChannelSet(options.allowedChannels)
  const instanceId = options.instanceId?.trim() || ''
  const clients = new Map<string, DevBrowserBridgeClient>()
  const clientsByNumericId = new Map<number, DevBrowserBridgeClient>()
  const pendingSurfaceCaptures = new Map<string, PendingSurfaceCapture>()
  let nextClientNumericId = 1

  const rejectPendingSurfaceCaptures = (clientNumericId: number, message: string): void => {
    for (const [requestId, pending] of pendingSurfaceCaptures) {
      if (pending.clientNumericId !== clientNumericId) continue
      clearTimeout(pending.timer)
      pendingSurfaceCaptures.delete(requestId)
      pending.reject(new Error(message))
    }
  }

  const getClient = (clientId: string): DevBrowserBridgeClient => {
    const existing = clients.get(clientId)
    if (existing && !existing.isDestroyed()) return existing
    const created = new DevBrowserBridgeClient(nextClientNumericId++, clientId)
    created.once('destroyed', () => {
      if (clients.get(clientId) === created) clients.delete(clientId)
      clientsByNumericId.delete(created.id)
      rejectPendingSurfaceCaptures(
        created.id,
        `Browser surface browser:${created.id} disconnected during pixel capture.`
      )
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
      writeJson(response, 200, { ok: true })
      return
    }

    if (instanceId) {
      if (!hasExactDevInstanceCredential(request, requestUrl, instanceId)) {
        writeJson(response, 409, {
          ok: false,
          message: 'The renderer and Electron main belong to different development instances. Reload the current dev endpoint.'
        })
        return
      }
    } else if (!request.headers.origin) {
      // Vite-proxied resource elements can omit Origin, but production dev
      // startup always supplies an instance credential for those requests.
      // An origin-less privileged request without that credential is denied.
      writeJson(response, 403, { ok: false, message: 'A trusted local Origin is required.' })
      return
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

    if (request.method === 'POST' && requestUrl.pathname === '/surface-capture') {
      void (async () => {
        let upload: SurfaceCaptureUpload | null = null
        let pending: PendingSurfaceCapture | undefined
        try {
          const clientId = normalizeClientId(request.headers['x-sciforge-client'])
          const client = clients.get(clientId)
          if (!client || client.isDestroyed()) {
            writeJson(response, 409, {
              ok: false,
              message: 'The browser capture client is no longer connected.'
            })
            return
          }
          upload = parseSurfaceCaptureUpload(
            await readJsonBody(request, maxSurfaceCaptureBodyBytes)
          )
          pending = pendingSurfaceCaptures.get(upload.requestId)
          if (!pending || pending.clientNumericId !== client.id) {
            writeJson(response, 409, {
              ok: false,
              message: 'The browser capture request is unknown or belongs to another client.'
            })
            return
          }
          const captured = await decodeSurfaceCapture(upload, pending)
          clearTimeout(pending.timer)
          pendingSurfaceCaptures.delete(upload.requestId)
          pending.resolve(captured)
          writeJson(response, 200, { ok: true })
        } catch (error) {
          if (upload && pending) {
            clearTimeout(pending.timer)
            pendingSurfaceCaptures.delete(upload.requestId)
            pending.reject(error instanceof Error ? error : new Error(String(error)))
          }
          writeJson(response, isLocalHttpBodyTooLargeError(error) ? 413 : 400, {
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
          if (!allowedChannels.has(body.channel)) {
            writeJson(response, 403, {
              ok: false,
              message: `Dev browser bridge channel is not allowed: ${body.channel}`
            })
            return
          }
          if (body.channel === 'capability:invoke') {
            const actionId = capabilityInvocationActionId(body.payload)
            const tags = actionId ? options.resolveCapabilityTags?.(actionId) : undefined
            if (!tags) {
              writeJson(response, 403, {
                ok: false,
                message: 'Dev browser capability transport could not resolve the requested capability.'
              })
              return
            }
            if (tags.includes('sensitive-input')) {
              writeJson(response, 403, {
                ok: false,
                message: 'Capabilities tagged sensitive-input require the Electron preload transport.'
              })
              return
            }
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
    captureSurface: (clientNumericId, request) => {
      const client = clientsByNumericId.get(clientNumericId)
      if (!client || client.isDestroyed()) {
        return Promise.reject(new Error(
          `Browser surface browser:${clientNumericId} is no longer connected.`
        ))
      }
      const requestId = randomUUID()
      return new Promise<DevBrowserSurfaceCapture>((resolve, reject) => {
        const pending: PendingSurfaceCapture = {
          clientNumericId,
          revision: positiveSafeInteger(request.revision, 'Surface capture revision'),
          ...(request.bounds ? { bounds: { ...request.bounds } } : {}),
          resolve,
          reject,
          timer: setTimeout(() => {
            pendingSurfaceCaptures.delete(requestId)
            reject(new Error(
              `Browser surface browser:${clientNumericId} did not return pixel capture before the timeout.`
            ))
          }, surfaceCaptureTimeoutMs)
        }
        pending.timer.unref?.()
        pendingSurfaceCaptures.set(requestId, pending)
        const delivered = client.send('devBrowserBridge:surface-capture-requested', {
          requestId,
          revision: pending.revision,
          ...(pending.bounds ? { bounds: pending.bounds } : {})
        })
        if (delivered) return
        clearTimeout(pending.timer)
        pendingSurfaceCaptures.delete(requestId)
        reject(new Error(
          `Browser surface browser:${clientNumericId} has no active pixel-capture channel.`
        ))
      })
    },
    close: async () => {
      for (const [requestId, pending] of pendingSurfaceCaptures) {
        clearTimeout(pending.timer)
        pendingSurfaceCaptures.delete(requestId)
        pending.reject(new Error('The development browser bridge closed during pixel capture.'))
      }
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
