import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  createServer,
  request as createHttpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'

import {
  workspaceHostEgressAuthorizationSchema
} from '@sciforge/domain-sdk/workspace-host'
import { z } from 'zod'

import {
  DEFAULT_WORKSPACE_EGRESS_LEASE_TTL_MS,
  MAX_WORKSPACE_EGRESS_LEASE_TTL_MS,
  MIN_WORKSPACE_EGRESS_LEASE_TTL_MS,
  WorkspaceEgressError,
  workspaceEgressLeaseIdSchema,
  workspaceEgressWorkspaceIdSchema
} from './contract.js'
import {
  REDACTED_WORKSPACE_EGRESS_SECRET,
  isLoopbackEgressHost,
  normalizeLoopbackEgressHost,
  redactEndpoint
} from './policy.js'

export const WORKSPACE_MODEL_ROUTER_BRIDGE_PROTOCOL =
  'sciforge.workspace-model-router-bridge.v1' as const
export const WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_REQUEST_BYTES = 40 * 1024 * 1024
export const WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_HEADER_BYTES = 32 * 1024
export const WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_CONCURRENT_REQUESTS = 16
export const WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_TOTAL_CONCURRENT_REQUESTS = 64

const runtimeKeySchema = z.string()
  .trim()
  .min(1)
  .max(4_096)
  .refine(
    (value) => [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 31 && codePoint !== 127
    }),
    'Model Router runtime key cannot contain control characters.'
  )

const upstreamLoopbackUrlSchema = z.string()
  .trim()
  .min(1)
  .max(2_048)
  .url()
  .superRefine((value, context) => {
    const parsed = new URL(value)
    const path = normalizeBasePath(parsed.pathname)
    if (
      parsed.protocol === 'http:' &&
      isLoopbackEgressHost(parsed.hostname) &&
      parsed.port !== '' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      path === '/v1'
    ) {
      return
    }
    context.addIssue({
      code: 'custom',
      message: 'Model Router upstream must be an explicit HTTP literal-loopback /v1 URL.'
    })
  })

export const workspaceModelRouterBridgeAcquireInputSchema = z.object({
  workspaceId: workspaceEgressWorkspaceIdSchema,
  upstreamBaseUrl: upstreamLoopbackUrlSchema,
  runtimeKey: runtimeKeySchema,
  ttlMs: z.number()
    .int()
    .min(MIN_WORKSPACE_EGRESS_LEASE_TTL_MS)
    .max(MAX_WORKSPACE_EGRESS_LEASE_TTL_MS)
    .optional()
}).strict()

export const workspaceModelRouterBridgeEndpointSchema = z.object({
  protocol: z.literal('http'),
  host: z.string().min(1).max(64),
  port: z.number().int().min(1).max(65_535),
  basePath: z.literal('/v1')
}).strict()

export const workspaceModelRouterBridgeLeaseSchema = z.object({
  protocol: z.literal(WORKSPACE_MODEL_ROUTER_BRIDGE_PROTOCOL),
  leaseId: workspaceEgressLeaseIdSchema,
  workspaceId: workspaceEgressWorkspaceIdSchema,
  endpoint: workspaceModelRouterBridgeEndpointSchema,
  authorization: workspaceHostEgressAuthorizationSchema,
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
}).strict()

export const workspaceModelRouterBridgeHeartbeatInputSchema = z.object({
  workspaceId: workspaceEgressWorkspaceIdSchema,
  leaseId: workspaceEgressLeaseIdSchema,
  token: workspaceHostEgressAuthorizationSchema.shape.token,
  ttlMs: z.number()
    .int()
    .min(MIN_WORKSPACE_EGRESS_LEASE_TTL_MS)
    .max(MAX_WORKSPACE_EGRESS_LEASE_TTL_MS)
    .optional()
}).strict()

export const workspaceModelRouterBridgeRevokeInputSchema = z.object({
  workspaceId: workspaceEgressWorkspaceIdSchema,
  leaseId: workspaceEgressLeaseIdSchema,
  token: workspaceHostEgressAuthorizationSchema.shape.token
}).strict()

export type WorkspaceModelRouterBridgeAcquireInput = z.input<
  typeof workspaceModelRouterBridgeAcquireInputSchema
>
export type WorkspaceModelRouterBridgeEndpoint = z.infer<
  typeof workspaceModelRouterBridgeEndpointSchema
>
export type WorkspaceModelRouterBridgeLease = z.infer<
  typeof workspaceModelRouterBridgeLeaseSchema
>
export type WorkspaceModelRouterBridgeHeartbeatInput = z.input<
  typeof workspaceModelRouterBridgeHeartbeatInputSchema
>
export type WorkspaceModelRouterBridgeRevokeInput = z.input<
  typeof workspaceModelRouterBridgeRevokeInputSchema
>
export type WorkspaceModelRouterBridgeLeaseState = Readonly<{
  leaseId: string
  workspaceId: string
  expiresAt: string
}>

export type WorkspaceModelRouterBridgeAcquireOptions = Readonly<{
  /**
   * Ties the bridge to an owning transport, such as an SSH reverse forward.
   * Aborting it immediately revokes the scoped bridge lease.
   */
  routeSignal?: AbortSignal
}>

export type WorkspaceModelRouterBridgeProbe = (
  input: Readonly<{
    upstreamBaseUrl: string
    runtimeKey: string
    signal: AbortSignal
  }>
) => boolean | Promise<boolean>

export type WorkspaceModelRouterBridgeLeaseProvider = Readonly<{
  acquireModelRouterBridge(
    input: WorkspaceModelRouterBridgeAcquireInput,
    options?: WorkspaceModelRouterBridgeAcquireOptions
  ): Promise<WorkspaceModelRouterBridgeLease>
  heartbeatModelRouterBridge(
    input: WorkspaceModelRouterBridgeHeartbeatInput
  ): Promise<WorkspaceModelRouterBridgeLeaseState>
  revokeModelRouterBridge(input: WorkspaceModelRouterBridgeRevokeInput): void
}>

export type WorkspaceModelRouterBridgeManagerOptions = Readonly<{
  bindHost: string
  bindPort: number
  now: () => number
  createLeaseId: () => string
  createLeaseToken: () => string
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void
  probe?: WorkspaceModelRouterBridgeProbe
}>

type ActiveBridgeLease = {
  leaseId: string
  workspaceId: string
  upstreamBaseUrl: string
  upstreamOrigin: string
  runtimeKey: string
  tokenDigest: Buffer
  issuedAtMs: number
  expiresAtMs: number
  ttlMs: number
  expiryTimer?: ReturnType<typeof setTimeout>
  routeSignal?: AbortSignal
  routeAbortListener?: () => void
  connections: Set<{ destroy(): unknown }>
  activeRequests: number
}

type EndedBridgeLease = Readonly<{
  workspaceId: string
  tokenDigest: Buffer
  code: 'lease_expired' | 'lease_revoked' | 'route_unavailable'
}>

const ALLOWED_MODEL_ROUTER_REQUESTS = new Set([
  'GET /v1/models',
  'GET /v1/capabilities',
  'POST /v1/responses',
  'POST /v1/chat/completions',
  'POST /v1/images/generations',
  'POST /v1/images/edits',
  'POST /v1/messages',
  'POST /api/cc/v1/messages',
  'POST /v1/messages/count_tokens',
  'POST /api/cc/v1/messages/count_tokens'
])

const REQUEST_HEADERS_BLOCKLIST = new Set([
  'authorization',
  'connection',
  'cookie',
  'forwarded',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-api-key',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto'
])

const RESPONSE_HEADERS_BLOCKLIST = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

/**
 * Internal lease manager owned by WorkspaceEgressService. It is intentionally
 * not a second route-selection service: each bridge has one explicit local
 * Model Router upstream and no target/allowlist selection.
 */
/** @internal Owned by WorkspaceEgressService; not part of the package export map. */
export class WorkspaceModelRouterBridgeManager {
  readonly #bindHost: string
  readonly #bindPort: number
  readonly #now: () => number
  readonly #createLeaseId: () => string
  readonly #createLeaseToken: () => string
  readonly #setTimer: WorkspaceModelRouterBridgeManagerOptions['setTimer']
  readonly #clearTimer: WorkspaceModelRouterBridgeManagerOptions['clearTimer']
  readonly #probe: WorkspaceModelRouterBridgeProbe
  readonly #leasesById = new Map<string, ActiveBridgeLease>()
  readonly #leaseIdByTokenDigest = new Map<string, string>()
  readonly #usedTokenDigests = new Set<string>()
  readonly #endedLeases = new Map<string, EndedBridgeLease>()
  #server?: Server
  #endpoint?: Omit<WorkspaceModelRouterBridgeEndpoint, 'basePath'>
  #startPromise?: Promise<Omit<WorkspaceModelRouterBridgeEndpoint, 'basePath'>>
  #activeRequests = 0
  #closed = false

  constructor(options: WorkspaceModelRouterBridgeManagerOptions) {
    this.#bindHost = normalizeLoopbackEgressHost(options.bindHost)
    this.#bindPort = normalizePort(options.bindPort)
    this.#now = options.now
    this.#createLeaseId = options.createLeaseId
    this.#createLeaseToken = options.createLeaseToken
    this.#setTimer = options.setTimer
    this.#clearTimer = options.clearTimer
    this.#probe = options.probe ?? probeLocalModelRouter
  }

  async acquire(
    input: WorkspaceModelRouterBridgeAcquireInput,
    options: WorkspaceModelRouterBridgeAcquireOptions = {}
  ): Promise<WorkspaceModelRouterBridgeLease> {
    this.#assertOpen()
    const parsed = workspaceModelRouterBridgeAcquireInputSchema.parse(input)
    if (options.routeSignal?.aborted) {
      throw bridgeRouteUnavailable()
    }

    const probeAbort = new AbortController()
    const abortProbe = () => probeAbort.abort()
    options.routeSignal?.addEventListener('abort', abortProbe, { once: true })
    let available: boolean
    try {
      available = await this.#probe({
        upstreamBaseUrl: parsed.upstreamBaseUrl,
        runtimeKey: parsed.runtimeKey,
        signal: probeAbort.signal
      })
    } catch {
      available = false
    } finally {
      options.routeSignal?.removeEventListener('abort', abortProbe)
    }
    if (!available || options.routeSignal?.aborted) {
      throw bridgeRouteUnavailable()
    }

    const listener = await this.#ensureStarted()
    const issuedAtMs = this.#now()
    const ttlMs = parsed.ttlMs ?? DEFAULT_WORKSPACE_EGRESS_LEASE_TTL_MS
    const token = this.#uniqueToken()
    const tokenDigest = digestSecret(token)
    const leaseId = this.#uniqueLeaseId()
    const upstream = new URL(parsed.upstreamBaseUrl)
    const record: ActiveBridgeLease = {
      leaseId,
      workspaceId: parsed.workspaceId,
      upstreamBaseUrl: normalizedBaseUrl(upstream),
      upstreamOrigin: upstream.origin,
      runtimeKey: parsed.runtimeKey,
      tokenDigest,
      issuedAtMs,
      expiresAtMs: issuedAtMs + ttlMs,
      ttlMs,
      ...(options.routeSignal ? { routeSignal: options.routeSignal } : {}),
      connections: new Set(),
      activeRequests: 0
    }
    this.#leasesById.set(leaseId, record)
    this.#leaseIdByTokenDigest.set(tokenDigest.toString('hex'), leaseId)
    this.#usedTokenDigests.add(tokenDigest.toString('hex'))
    if (options.routeSignal) {
      const onRouteLost = () => this.#terminate(record, 'route_unavailable')
      record.routeAbortListener = onRouteLost
      options.routeSignal.addEventListener('abort', onRouteLost, { once: true })
      if (options.routeSignal.aborted) {
        this.#terminate(record, 'route_unavailable')
        throw bridgeRouteUnavailable()
      }
    }
    this.#scheduleExpiry(record)
    return {
      protocol: WORKSPACE_MODEL_ROUTER_BRIDGE_PROTOCOL,
      leaseId,
      workspaceId: record.workspaceId,
      endpoint: {
        ...listener,
        basePath: '/v1'
      },
      authorization: {
        scheme: 'bearer',
        token
      },
      issuedAt: new Date(record.issuedAtMs).toISOString(),
      expiresAt: new Date(record.expiresAtMs).toISOString()
    }
  }

  async heartbeat(
    input: WorkspaceModelRouterBridgeHeartbeatInput
  ): Promise<WorkspaceModelRouterBridgeLeaseState> {
    this.#assertOpen()
    const parsed = workspaceModelRouterBridgeHeartbeatInputSchema.parse(input)
    const record = this.#requireActive(parsed)
    const probeAbort = new AbortController()
    const abortProbe = () => probeAbort.abort()
    record.routeSignal?.addEventListener('abort', abortProbe, { once: true })
    let available = false
    try {
      available = await this.#probe({
        upstreamBaseUrl: record.upstreamBaseUrl,
        runtimeKey: record.runtimeKey,
        signal: probeAbort.signal
      })
    } catch {
      available = false
    } finally {
      record.routeSignal?.removeEventListener('abort', abortProbe)
    }
    if (!available || record.routeSignal?.aborted) {
      this.#terminate(record, 'route_unavailable')
      throw bridgeRouteUnavailable()
    }
    record.ttlMs = parsed.ttlMs ?? record.ttlMs
    record.expiresAtMs = this.#now() + record.ttlMs
    this.#scheduleExpiry(record)
    return stateForBridge(record)
  }

  revoke(input: WorkspaceModelRouterBridgeRevokeInput): void {
    const parsed = workspaceModelRouterBridgeRevokeInputSchema.parse(input)
    const record = this.#requireActive(parsed)
    this.#terminate(record, 'lease_revoked')
  }

  sweepExpired(): number {
    const now = this.#now()
    let expired = 0
    for (const record of this.#leasesById.values()) {
      if (record.expiresAtMs <= now) {
        this.#terminate(record, 'lease_expired')
        expired += 1
      }
    }
    return expired
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    for (const record of [...this.#leasesById.values()]) {
      this.#terminate(record, 'lease_revoked')
    }
    const server = this.#server
    this.#server = undefined
    this.#endpoint = undefined
    if (!server) return
    const closed = new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    server.closeAllConnections()
    await closed
  }

  async #ensureStarted(): Promise<Omit<WorkspaceModelRouterBridgeEndpoint, 'basePath'>> {
    if (this.#endpoint) return this.#endpoint
    if (this.#startPromise) return this.#startPromise
    this.#startPromise = this.#start()
    try {
      return await this.#startPromise
    } finally {
      this.#startPromise = undefined
    }
  }

  async #start(): Promise<Omit<WorkspaceModelRouterBridgeEndpoint, 'basePath'>> {
    const server = createServer({
      maxHeaderSize: WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_HEADER_BYTES
    }, (request, response) => {
      void this.#handleRequest(request, response)
    })
    server.maxHeadersCount = 100
    server.on('connect', (_request, socket) => socket.destroy())
    server.on('upgrade', (_request, socket) => socket.destroy())
    server.on('clientError', (_error, socket) => {
      if (socket.writable) {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      }
    })
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.#bindPort, this.#bindHost)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new WorkspaceEgressError({
        code: 'internal_error',
        message: 'Model Router bridge did not expose a TCP address.'
      })
    }
    this.#server = server
    this.#endpoint = {
      protocol: 'http',
      host: this.#bindHost,
      port: address.port
    }
    return this.#endpoint
  }

  async #handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const token = bearerToken(request.headers.authorization)
    const record = token ? this.#findByToken(token) : undefined
    if (!record) {
      sendBridgeFailure(response, 401, 'Unauthorized', {
        'WWW-Authenticate': 'Bearer realm="sciforge-model-router-bridge"'
      })
      return
    }
    if (record.expiresAtMs <= this.#now()) {
      this.#terminate(record, 'lease_expired')
      sendBridgeFailure(response, 401, 'Unauthorized')
      return
    }

    const requestTarget = request.url ?? ''
    if (!isOriginFormRequestTarget(requestTarget)) {
      sendBridgeFailure(response, 400, 'Bad Request')
      return
    }
    let target: URL
    try {
      target = new URL(requestTarget, record.upstreamOrigin)
    } catch {
      sendBridgeFailure(response, 400, 'Bad Request')
      return
    }
    const method = (request.method ?? '').toUpperCase()
    if (!ALLOWED_MODEL_ROUTER_REQUESTS.has(`${method} ${target.pathname}`)) {
      sendBridgeFailure(response, 403, 'Forbidden')
      return
    }
    if (
      record.activeRequests >= WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_CONCURRENT_REQUESTS ||
      this.#activeRequests >= WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_TOTAL_CONCURRENT_REQUESTS
    ) {
      sendBridgeFailure(response, 429, 'Too Many Requests')
      return
    }
    const contentLength = Number(request.headers['content-length'])
    if (
      Number.isFinite(contentLength) &&
      contentLength > WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_REQUEST_BYTES
    ) {
      sendBridgeFailure(response, 413, 'Payload Too Large')
      return
    }

    const upstreamHeaders = sanitizedRequestHeaders(request.headers)
    upstreamHeaders.authorization = `Bearer ${record.runtimeKey}`
    const upstream = createHttpRequest(target, {
      method,
      headers: upstreamHeaders
    })
    record.connections.add(request.socket)
    record.connections.add(upstream)
    record.activeRequests += 1
    this.#activeRequests += 1
    let requestBytes = 0
    let requestTooLarge = false
    let activeUpstreamResponse: IncomingMessage | undefined
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      record.connections.delete(request.socket)
      record.connections.delete(upstream)
      activeUpstreamResponse?.destroy()
      record.activeRequests = Math.max(0, record.activeRequests - 1)
      this.#activeRequests = Math.max(0, this.#activeRequests - 1)
    }
    response.once('close', cleanup)
    upstream.once('response', (upstreamResponse) => {
      if (!this.#leasesById.has(record.leaseId)) {
        upstreamResponse.destroy()
        return
      }
      activeUpstreamResponse = upstreamResponse
      record.connections.add(upstreamResponse)
      upstreamResponse.once('close', () => record.connections.delete(upstreamResponse))
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        sanitizedResponseHeaders(upstreamResponse.headers)
      )
      upstreamResponse.pipe(response)
    })
    upstream.once('error', (error: NodeJS.ErrnoException) => {
      cleanup()
      if (!response.headersSent) {
        sendBridgeFailure(response, 502, 'Bad Gateway')
      } else {
        response.destroy()
      }
      if (isRouteLossError(error)) {
        this.#terminate(record, 'route_unavailable')
      }
    })
    request.on('data', (chunk: Buffer) => {
      if (requestTooLarge) return
      requestBytes += chunk.byteLength
      if (requestBytes <= WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_REQUEST_BYTES) return
      requestTooLarge = true
      request.unpipe(upstream)
      upstream.destroy()
      request.resume()
      if (!response.headersSent) sendBridgeFailure(response, 413, 'Payload Too Large')
    })
    request.once('aborted', () => upstream.destroy())
    request.pipe(upstream)
  }

  #requireActive(input: {
    workspaceId: string
    leaseId: string
    token: string
  }): ActiveBridgeLease {
    const record = this.#leasesById.get(input.leaseId)
    if (!record) {
      const ended = this.#endedLeases.get(input.leaseId)
      if (ended) {
        assertBridgeScopeAndToken(ended, input)
        throw bridgeEndedError(ended.code)
      }
      throw new WorkspaceEgressError({
        code: 'lease_not_found',
        message: 'Model Router bridge lease was not found.'
      })
    }
    assertBridgeScopeAndToken(record, input)
    if (record.expiresAtMs <= this.#now()) {
      this.#terminate(record, 'lease_expired')
      throw bridgeEndedError('lease_expired')
    }
    return record
  }

  #findByToken(token: string): ActiveBridgeLease | undefined {
    const digest = digestSecret(token)
    const leaseId = this.#leaseIdByTokenDigest.get(digest.toString('hex'))
    if (!leaseId) return undefined
    const record = this.#leasesById.get(leaseId)
    return record && timingSafeEqual(record.tokenDigest, digest) ? record : undefined
  }

  #uniqueLeaseId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const leaseId = this.#createLeaseId().trim()
      if (leaseId && !this.#leasesById.has(leaseId) && !this.#endedLeases.has(leaseId)) {
        return leaseId
      }
    }
    throw new WorkspaceEgressError({
      code: 'internal_error',
      message: 'Could not allocate a Model Router bridge lease identifier.'
    })
  }

  #uniqueToken(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const token = this.#createLeaseToken()
      if (!workspaceHostEgressAuthorizationSchema.safeParse({
        scheme: 'bearer',
        token
      }).success) {
        continue
      }
      if (!this.#usedTokenDigests.has(digestSecret(token).toString('hex'))) {
        return token
      }
    }
    throw new WorkspaceEgressError({
      code: 'internal_error',
      message: 'Could not allocate a Model Router bridge token.'
    })
  }

  #scheduleExpiry(record: ActiveBridgeLease): void {
    if (record.expiryTimer) this.#clearTimer(record.expiryTimer)
    record.expiryTimer = this.#setTimer(() => {
      if (record.expiresAtMs <= this.#now()) {
        this.#terminate(record, 'lease_expired')
      } else {
        this.#scheduleExpiry(record)
      }
    }, Math.max(0, record.expiresAtMs - this.#now()))
  }

  #terminate(record: ActiveBridgeLease, code: EndedBridgeLease['code']): void {
    if (!this.#leasesById.delete(record.leaseId)) return
    this.#leaseIdByTokenDigest.delete(record.tokenDigest.toString('hex'))
    if (record.expiryTimer) {
      this.#clearTimer(record.expiryTimer)
      record.expiryTimer = undefined
    }
    if (record.routeSignal && record.routeAbortListener) {
      record.routeSignal.removeEventListener('abort', record.routeAbortListener)
    }
    for (const connection of record.connections) connection.destroy()
    record.connections.clear()
    record.runtimeKey = ''
    this.#endedLeases.set(record.leaseId, {
      workspaceId: record.workspaceId,
      tokenDigest: record.tokenDigest,
      code
    })
    while (this.#endedLeases.size > 1_024) {
      const oldest = this.#endedLeases.keys().next().value as string | undefined
      if (!oldest) break
      this.#endedLeases.delete(oldest)
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new WorkspaceEgressError({
        code: 'relay_closed',
        message: 'Model Router bridge is closed.'
      })
    }
  }
}

export function summarizeWorkspaceModelRouterBridgeLease(
  lease: WorkspaceModelRouterBridgeLease
): Omit<WorkspaceModelRouterBridgeLease, 'endpoint' | 'authorization'> & {
  endpoint: string
  authorization: typeof REDACTED_WORKSPACE_EGRESS_SECRET
} {
  return {
    ...lease,
    endpoint: redactEndpoint(
      `${lease.endpoint.protocol}://${formatHost(lease.endpoint.host)}:${lease.endpoint.port}${lease.endpoint.basePath}`
    ),
    authorization: REDACTED_WORKSPACE_EGRESS_SECRET
  }
}

async function probeLocalModelRouter(
  input: Parameters<WorkspaceModelRouterBridgeProbe>[0]
): Promise<boolean> {
  const upstream = new URL(input.upstreamBaseUrl)
  const target = new URL('/v1/capabilities', upstream.origin)
  return await new Promise<boolean>((resolve) => {
    const request = createHttpRequest(target, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.runtimeKey}`
      },
      signal: input.signal
    })
    request.once('response', (response) => {
      response.resume()
      resolve(response.statusCode === 200)
    })
    request.once('error', () => resolve(false))
    request.setTimeout(2_000, () => request.destroy())
    request.end()
  })
}

function bearerToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined
  const match = /^Bearer ([A-Za-z0-9._~-]{24,4096})$/.exec(header.trim())
  return match?.[1]
}

function sanitizedRequestHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const sanitized: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (REQUEST_HEADERS_BLOCKLIST.has(name.toLowerCase()) || value === undefined) continue
    sanitized[name] = value
  }
  return sanitized
}

function sanitizedResponseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const sanitized: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (RESPONSE_HEADERS_BLOCKLIST.has(name.toLowerCase()) || value === undefined) continue
    sanitized[name] = value
  }
  return sanitized
}

function assertBridgeScopeAndToken(
  record: Pick<ActiveBridgeLease, 'workspaceId' | 'tokenDigest'>,
  input: { workspaceId: string; token: string }
): void {
  if (record.workspaceId !== input.workspaceId) {
    throw new WorkspaceEgressError({
      code: 'workspace_scope_denied',
      message: 'Model Router bridge leases cannot be used by another workspace.'
    })
  }
  const digest = digestSecret(input.token)
  if (
    record.tokenDigest.byteLength !== digest.byteLength ||
    !timingSafeEqual(record.tokenDigest, digest)
  ) {
    throw new WorkspaceEgressError({
      code: 'invalid_lease_token',
      message: 'Model Router bridge token is invalid.'
    })
  }
}

function stateForBridge(
  record: ActiveBridgeLease
): WorkspaceModelRouterBridgeLeaseState {
  return {
    leaseId: record.leaseId,
    workspaceId: record.workspaceId,
    expiresAt: new Date(record.expiresAtMs).toISOString()
  }
}

function bridgeRouteUnavailable(): WorkspaceEgressError {
  return new WorkspaceEgressError({
    code: 'route_unavailable',
    message: 'Local Model Router bridge upstream is unavailable.',
    retryable: true
  })
}

function bridgeEndedError(code: EndedBridgeLease['code']): WorkspaceEgressError {
  if (code === 'route_unavailable') return bridgeRouteUnavailable()
  if (code === 'lease_expired') {
    return new WorkspaceEgressError({
      code,
      message: 'Model Router bridge lease has expired.',
      retryable: true
    })
  }
  return new WorkspaceEgressError({
    code,
    message: 'Model Router bridge lease has been revoked.'
  })
}

function sendBridgeFailure(
  response: ServerResponse,
  status: number,
  reason: string,
  headers: Readonly<Record<string, string>> = {}
): void {
  if (response.destroyed) return
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  })
  response.end(JSON.stringify({
    error: {
      code: bridgeFailureCode(status),
      message: reason
    }
  }))
}

function bridgeFailureCode(status: number): string {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'route_not_allowed'
  if (status === 413) return 'request_too_large'
  if (status === 429) return 'too_many_requests'
  if (status === 502) return 'model_router_unavailable'
  return 'invalid_request'
}

function isRouteLossError(error: NodeJS.ErrnoException): boolean {
  return error.code === 'ECONNREFUSED' ||
    error.code === 'EHOSTUNREACH' ||
    error.code === 'ENETUNREACH' ||
    error.code === 'ETIMEDOUT'
}

function digestSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

function normalizedBaseUrl(url: URL): string {
  return `${url.origin}/v1`
}

function isOriginFormRequestTarget(value: string): boolean {
  return value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('#') &&
    [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 31 && codePoint !== 127
    })
}

function normalizeBasePath(pathname: string): string {
  const withoutTrailingSlash = pathname.replace(/\/+$/, '')
  return withoutTrailingSlash || '/'
}

function normalizePort(port: number): number {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Model Router bridge bind port must be an integer from 0 to 65535.')
  }
  return port
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host
}

export function createDefaultWorkspaceModelRouterBridgeManagerOptions(input: {
  bindHost?: string
  bindPort?: number
  now?: () => number
  createLeaseId?: () => string
  createLeaseToken?: () => string
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  probe?: WorkspaceModelRouterBridgeProbe
} = {}): WorkspaceModelRouterBridgeManagerOptions {
  return {
    bindHost: normalizeLoopbackEgressHost(input.bindHost ?? '127.0.0.1'),
    bindPort: normalizePort(input.bindPort ?? 0),
    now: input.now ?? Date.now,
    createLeaseId: input.createLeaseId ?? (() => `model-router-bridge-${randomUUID()}`),
    createLeaseToken: input.createLeaseToken ?? (() => randomBytes(32).toString('base64url')),
    setTimer: input.setTimer ?? ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      timer.unref()
      return timer
    }),
    clearTimer: input.clearTimer ?? clearTimeout,
    ...(input.probe ? { probe: input.probe } : {})
  }
}
