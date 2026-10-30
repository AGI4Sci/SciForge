import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import type {
  WorkspaceNetworkEgressAllowlistRule
} from '@sciforge/domain-sdk/workspace-host'

import {
  DEFAULT_WORKSPACE_EGRESS_LEASE_TTL_MS,
  WORKSPACE_EGRESS_PROTOCOL,
  WorkspaceEgressError,
  workspaceEgressAcquireLeaseInputSchema,
  workspaceEgressHeartbeatInputSchema,
  workspaceEgressLeaseCredentialSchema,
  workspaceEgressRevokeInputSchema,
  type WorkspaceEgressAcquireLeaseInput,
  type WorkspaceEgressDestination,
  type WorkspaceEgressHeartbeatInput,
  type WorkspaceEgressLease,
  type WorkspaceEgressLeaseState,
  type WorkspaceEgressRelayEndpoint,
  type WorkspaceEgressRevokeInput,
  type WorkspaceEgressSelection
} from './contract.js'
import {
  isDestinationAllowed,
  normalizeDestinationHost,
  normalizeLoopbackEgressHost
} from './policy.js'
import {
  WorkspaceModelRouterBridgeManager,
  createDefaultWorkspaceModelRouterBridgeManagerOptions,
  type WorkspaceModelRouterBridgeAcquireInput,
  type WorkspaceModelRouterBridgeAcquireOptions,
  type WorkspaceModelRouterBridgeHeartbeatInput,
  type WorkspaceModelRouterBridgeLease,
  type WorkspaceModelRouterBridgeLeaseState,
  type WorkspaceModelRouterBridgeProbe,
  type WorkspaceModelRouterBridgeRevokeInput
} from './model-router-bridge.js'

type MaybePromise<T> = T | Promise<T>

export type WorkspaceEgressOpenTunnelInput = Readonly<{
  workspaceId: string
  destination: WorkspaceEgressDestination
  signal: AbortSignal
}>

/**
 * A route is an opaque transport furnished by the host integration. It may
 * use a local reverse tunnel, another remote workspace, or a future transport.
 * SSH targets, endpoints, and credentials intentionally do not cross this
 * package boundary.
 */
export type ResolvedWorkspaceEgressRoute = Readonly<{
  routeId: string
  openTunnel(input: WorkspaceEgressOpenTunnelInput): MaybePromise<Duplex>
  probe?(): MaybePromise<boolean>
  onLost?(listener: () => void): void | (() => void)
  close?(): MaybePromise<void>
}>

export type WorkspaceEgressRouteResolver = Readonly<{
  resolve(input: Readonly<{
    workspaceId: string
    selection: Exclude<WorkspaceEgressSelection, { mode: 'none' }>
    signal: AbortSignal
  }>): MaybePromise<ResolvedWorkspaceEgressRoute>
}>

export type WorkspaceEgressServiceOptions = Readonly<{
  routeResolver: WorkspaceEgressRouteResolver
  bindHost?: string
  bindPort?: number
  modelRouterBridgeBindPort?: number
  modelRouterBridgeProbe?: WorkspaceModelRouterBridgeProbe
  now?: () => number
  createLeaseId?: () => string
  createLeaseToken?: () => string
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}>

type ActiveLease = {
  leaseId: string
  workspaceId: string
  selection: Exclude<WorkspaceEgressSelection, { mode: 'none' }>
  allowlist: WorkspaceNetworkEgressAllowlistRule[]
  tokenDigest: Buffer
  route: ResolvedWorkspaceEgressRoute
  routeAbort: AbortController
  issuedAtMs: number
  expiresAtMs: number
  ttlMs: number
  expiryTimer?: ReturnType<typeof setTimeout>
  unsubscribeLost?: () => void
  connections: Set<Duplex>
}

type EndedLease = Readonly<{
  workspaceId: string
  tokenDigest: Buffer
  code: 'lease_expired' | 'lease_revoked' | 'route_unavailable'
}>

export class WorkspaceEgressService {
  private readonly routeResolver: WorkspaceEgressRouteResolver
  private readonly bindHost: string
  private readonly bindPort: number
  private readonly now: () => number
  private readonly createLeaseId: () => string
  private readonly createLeaseToken: () => string
  private readonly setTimer: NonNullable<WorkspaceEgressServiceOptions['setTimer']>
  private readonly clearTimer: NonNullable<WorkspaceEgressServiceOptions['clearTimer']>
  private readonly leasesById = new Map<string, ActiveLease>()
  private readonly leaseIdByTokenDigest = new Map<string, string>()
  private readonly usedTokenDigests = new Set<string>()
  private readonly endedLeases = new Map<string, EndedLease>()
  private readonly modelRouterBridge: WorkspaceModelRouterBridgeManager
  private server?: Server
  private endpoint?: WorkspaceEgressRelayEndpoint
  private startPromise?: Promise<WorkspaceEgressRelayEndpoint>
  private closed = false

  constructor(options: WorkspaceEgressServiceOptions) {
    this.routeResolver = options.routeResolver
    this.bindHost = normalizeLoopbackEgressHost(options.bindHost ?? '127.0.0.1')
    this.bindPort = normalizePort(options.bindPort ?? 0)
    this.now = options.now ?? Date.now
    this.createLeaseId = options.createLeaseId ?? (() => `egress-${randomUUID()}`)
    this.createLeaseToken = options.createLeaseToken ?? (() => randomBytes(32).toString('base64url'))
    this.setTimer = options.setTimer ?? ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      timer.unref()
      return timer
    })
    this.clearTimer = options.clearTimer ?? clearTimeout
    this.modelRouterBridge = new WorkspaceModelRouterBridgeManager(
      createDefaultWorkspaceModelRouterBridgeManagerOptions({
        bindHost: this.bindHost,
        bindPort: options.modelRouterBridgeBindPort ?? 0,
        now: this.now,
        createLeaseId: this.createLeaseId,
        createLeaseToken: this.createLeaseToken,
        setTimer: this.setTimer,
        clearTimer: this.clearTimer,
        ...(options.modelRouterBridgeProbe
          ? { probe: options.modelRouterBridgeProbe }
          : {})
      })
    )
  }

  async acquireLease(input: WorkspaceEgressAcquireLeaseInput): Promise<WorkspaceEgressLease> {
    this.assertOpen()
    const parsed = workspaceEgressAcquireLeaseInputSchema.parse(input)
    if (parsed.selection.mode === 'none') {
      throw new WorkspaceEgressError({
        code: 'egress_disabled',
        message: 'Network egress is disabled for this workspace.'
      })
    }

    const routeAbort = new AbortController()
    let route: ResolvedWorkspaceEgressRoute
    try {
      route = await this.routeResolver.resolve({
        workspaceId: parsed.workspaceId,
        selection: parsed.selection,
        signal: routeAbort.signal
      })
      assertResolvedRoute(route)
    } catch (error) {
      routeAbort.abort()
      throw routeUnavailable(error)
    }

    let endpoint: WorkspaceEgressRelayEndpoint
    try {
      endpoint = await this.ensureRelayStarted()
    } catch (error) {
      routeAbort.abort()
      await closeRoute(route)
      throw error
    }

    const issuedAtMs = this.now()
    const ttlMs = parsed.ttlMs ?? DEFAULT_WORKSPACE_EGRESS_LEASE_TTL_MS
    const leaseId = this.createUniqueLeaseId()
    const token = this.createUniqueLeaseToken()
    const tokenDigest = digestToken(token)
    const record: ActiveLease = {
      leaseId,
      workspaceId: parsed.workspaceId,
      selection: parsed.selection,
      allowlist: parsed.selection.allowlist.rules,
      tokenDigest,
      route,
      routeAbort,
      issuedAtMs,
      expiresAtMs: issuedAtMs + ttlMs,
      ttlMs,
      connections: new Set()
    }

    this.leasesById.set(leaseId, record)
    this.leaseIdByTokenDigest.set(tokenDigest.toString('hex'), leaseId)
    this.usedTokenDigests.add(tokenDigest.toString('hex'))
    const unsubscribe = route.onLost?.(() => {
      this.terminateLease(record, 'route_unavailable')
    })
    if (typeof unsubscribe === 'function') {
      record.unsubscribeLost = unsubscribe
    }
    if (!this.leasesById.has(leaseId)) {
      throw new WorkspaceEgressError({
        code: 'route_unavailable',
        message: 'The selected network egress route is unavailable.',
        retryable: true
      })
    }
    this.scheduleExpiry(record)

    return {
      protocol: WORKSPACE_EGRESS_PROTOCOL,
      leaseId,
      workspaceId: record.workspaceId,
      selection: record.selection,
      endpoint,
      credential: {
        scheme: 'bearer',
        token
      },
      issuedAt: new Date(record.issuedAtMs).toISOString(),
      expiresAt: new Date(record.expiresAtMs).toISOString()
    }
  }

  async heartbeat(input: WorkspaceEgressHeartbeatInput): Promise<WorkspaceEgressLeaseState> {
    this.assertOpen()
    const parsed = workspaceEgressHeartbeatInputSchema.parse(input)
    const record = this.requireActiveLease(parsed)

    if (record.route.probe) {
      try {
        if (!await record.route.probe()) {
          this.terminateLease(record, 'route_unavailable')
          throw new WorkspaceEgressError({
            code: 'route_unavailable',
            message: 'The selected network egress route is unavailable.',
            retryable: true
          })
        }
      } catch (error) {
        if (error instanceof WorkspaceEgressError) {
          throw error
        }
        this.terminateLease(record, 'route_unavailable')
        throw routeUnavailable(error)
      }
    }

    record.ttlMs = parsed.ttlMs ?? record.ttlMs
    record.expiresAtMs = this.now() + record.ttlMs
    this.scheduleExpiry(record)
    return stateFor(record)
  }

  revoke(input: WorkspaceEgressRevokeInput): void {
    const parsed = workspaceEgressRevokeInputSchema.parse(input)
    const record = this.requireActiveLease(parsed)
    this.terminateLease(record, 'lease_revoked')
  }

  acquireModelRouterBridge(
    input: WorkspaceModelRouterBridgeAcquireInput,
    options?: WorkspaceModelRouterBridgeAcquireOptions
  ): Promise<WorkspaceModelRouterBridgeLease> {
    this.assertOpen()
    return this.modelRouterBridge.acquire(input, options)
  }

  heartbeatModelRouterBridge(
    input: WorkspaceModelRouterBridgeHeartbeatInput
  ): Promise<WorkspaceModelRouterBridgeLeaseState> {
    this.assertOpen()
    return this.modelRouterBridge.heartbeat(input)
  }

  revokeModelRouterBridge(input: WorkspaceModelRouterBridgeRevokeInput): void {
    this.assertOpen()
    this.modelRouterBridge.revoke(input)
  }

  sweepExpired(): number {
    const now = this.now()
    let expired = 0
    for (const record of this.leasesById.values()) {
      if (record.expiresAtMs <= now) {
        this.terminateLease(record, 'lease_expired')
        expired += 1
      }
    }
    return expired + this.modelRouterBridge.sweepExpired()
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true
    for (const record of [...this.leasesById.values()]) {
      this.terminateLease(record, 'lease_revoked')
    }
    const server = this.server
    this.server = undefined
    this.endpoint = undefined
    const closes: Promise<void>[] = [this.modelRouterBridge.close()]
    if (server) {
      closes.push(new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      }))
    }
    await Promise.all(closes)
  }

  private async ensureRelayStarted(): Promise<WorkspaceEgressRelayEndpoint> {
    if (this.endpoint) {
      return this.endpoint
    }
    if (this.startPromise) {
      return this.startPromise
    }
    this.startPromise = this.startRelay()
    try {
      return await this.startPromise
    } finally {
      this.startPromise = undefined
    }
  }

  private async startRelay(): Promise<WorkspaceEgressRelayEndpoint> {
    const server = createServer((_request, response) => {
      response.writeHead(405, {
        Allow: 'CONNECT',
        'Content-Type': 'text/plain; charset=utf-8'
      })
      response.end('HTTP CONNECT is required.\n')
    })
    server.on('connect', (request, socket, head) => {
      void this.handleConnect(request, socket, head)
    })
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
      server.listen(this.bindPort, this.bindHost)
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new WorkspaceEgressError({
        code: 'internal_error',
        message: 'Workspace egress relay did not expose a TCP address.'
      })
    }
    this.server = server
    this.endpoint = {
      protocol: 'http-connect',
      host: this.bindHost,
      port: address.port
    }
    return this.endpoint
  }

  private async handleConnect(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    let destination: WorkspaceEgressDestination
    try {
      destination = parseConnectAuthority(request.url)
    } catch {
      writeConnectFailure(socket, 400, 'Bad Request')
      return
    }

    let token: string
    try {
      token = parseProxyLeaseToken(request.headers['proxy-authorization'])
    } catch {
      writeConnectFailure(socket, 407, 'Proxy Authentication Required', {
        'Proxy-Authenticate': 'Bearer realm="sciforge-workspace-egress"'
      })
      return
    }

    const record = this.findLeaseByToken(token)
    if (!record) {
      writeConnectFailure(socket, 407, 'Proxy Authentication Required', {
        'Proxy-Authenticate': 'Bearer realm="sciforge-workspace-egress"'
      })
      return
    }
    if (record.expiresAtMs <= this.now()) {
      this.terminateLease(record, 'lease_expired')
      writeConnectFailure(socket, 407, 'Proxy Authentication Required', {
        'Proxy-Authenticate': 'Bearer realm="sciforge-workspace-egress"'
      })
      return
    }
    if (!isDestinationAllowed(destination, record.allowlist)) {
      writeConnectFailure(socket, 403, 'Forbidden')
      return
    }

    let upstream: Duplex
    try {
      upstream = await record.route.openTunnel({
        workspaceId: record.workspaceId,
        destination,
        signal: record.routeAbort.signal
      })
      if (!isDuplex(upstream)) {
        throw new Error('Route connector returned an invalid duplex stream.')
      }
    } catch {
      writeConnectFailure(socket, 503, 'Service Unavailable')
      return
    }

    if (!this.leasesById.has(record.leaseId)) {
      upstream.destroy()
      writeConnectFailure(socket, 503, 'Service Unavailable')
      return
    }

    record.connections.add(socket)
    record.connections.add(upstream)
    const cleanup = () => {
      record.connections.delete(socket)
      record.connections.delete(upstream)
    }
    socket.once('close', cleanup)
    upstream.once('close', cleanup)
    socket.once('error', () => upstream.destroy())
    upstream.once('error', () => socket.destroy())
    socket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: SciForge\r\n\r\n')
    if (head.byteLength > 0) {
      upstream.write(head)
    }
    socket.pipe(upstream)
    upstream.pipe(socket)
  }

  private requireActiveLease(input: {
    workspaceId: string
    leaseId: string
    token: string
  }): ActiveLease {
    const record = this.leasesById.get(input.leaseId)
    if (!record) {
      const ended = this.endedLeases.get(input.leaseId)
      if (ended) {
        this.assertLeaseScopeAndToken(ended, input)
        throw endedLeaseError(ended.code)
      }
      throw new WorkspaceEgressError({
        code: 'lease_not_found',
        message: 'Workspace egress lease was not found.'
      })
    }
    this.assertLeaseScopeAndToken(record, input)
    if (record.expiresAtMs <= this.now()) {
      this.terminateLease(record, 'lease_expired')
      throw endedLeaseError('lease_expired')
    }
    return record
  }

  private assertLeaseScopeAndToken(
    record: Pick<ActiveLease, 'workspaceId' | 'tokenDigest'>,
    input: { workspaceId: string; token: string }
  ): void {
    if (record.workspaceId !== input.workspaceId) {
      throw new WorkspaceEgressError({
        code: 'workspace_scope_denied',
        message: 'Workspace egress leases cannot be used by another workspace.'
      })
    }
    if (!tokensEqual(record.tokenDigest, input.token)) {
      throw new WorkspaceEgressError({
        code: 'invalid_lease_token',
        message: 'Workspace egress lease token is invalid.'
      })
    }
  }

  private findLeaseByToken(token: string): ActiveLease | undefined {
    const tokenDigest = digestToken(token)
    const leaseId = this.leaseIdByTokenDigest.get(tokenDigest.toString('hex'))
    if (!leaseId) {
      return undefined
    }
    const record = this.leasesById.get(leaseId)
    return record && timingSafeEqual(record.tokenDigest, tokenDigest) ? record : undefined
  }

  private createUniqueLeaseId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const leaseId = this.createLeaseId().trim()
      if (leaseId && !this.leasesById.has(leaseId) && !this.endedLeases.has(leaseId)) {
        return leaseId
      }
    }
    throw new WorkspaceEgressError({
      code: 'internal_error',
      message: 'Could not allocate a unique workspace egress lease identifier.'
    })
  }

  private createUniqueLeaseToken(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const token = this.createLeaseToken()
      if (!workspaceEgressLeaseCredentialSchema.safeParse({
        scheme: 'bearer',
        token
      }).success) {
        continue
      }
      if (!this.usedTokenDigests.has(digestToken(token).toString('hex'))) {
        return token
      }
    }
    throw new WorkspaceEgressError({
      code: 'internal_error',
      message: 'Could not allocate a valid workspace egress lease token.'
    })
  }

  private scheduleExpiry(record: ActiveLease): void {
    if (record.expiryTimer) {
      this.clearTimer(record.expiryTimer)
    }
    const delayMs = Math.max(0, record.expiresAtMs - this.now())
    record.expiryTimer = this.setTimer(() => {
      if (record.expiresAtMs <= this.now()) {
        this.terminateLease(record, 'lease_expired')
      } else {
        this.scheduleExpiry(record)
      }
    }, delayMs)
  }

  private terminateLease(
    record: ActiveLease,
    code: EndedLease['code']
  ): void {
    if (!this.leasesById.delete(record.leaseId)) {
      return
    }
    this.leaseIdByTokenDigest.delete(record.tokenDigest.toString('hex'))
    if (record.expiryTimer) {
      this.clearTimer(record.expiryTimer)
      record.expiryTimer = undefined
    }
    record.unsubscribeLost?.()
    record.routeAbort.abort()
    for (const connection of record.connections) {
      connection.destroy()
    }
    record.connections.clear()
    this.endedLeases.set(record.leaseId, {
      workspaceId: record.workspaceId,
      tokenDigest: record.tokenDigest,
      code
    })
    while (this.endedLeases.size > 1_024) {
      const oldestLeaseId = this.endedLeases.keys().next().value as string | undefined
      if (!oldestLeaseId) {
        break
      }
      this.endedLeases.delete(oldestLeaseId)
    }
    void closeRoute(record.route)
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new WorkspaceEgressError({
        code: 'relay_closed',
        message: 'Workspace egress relay is closed.'
      })
    }
  }
}

function parseConnectAuthority(authority: string | undefined): WorkspaceEgressDestination {
  if (!authority || authority.includes('/') || authority.includes('@')) {
    throw new Error('CONNECT requires a host:port authority.')
  }

  let hostname: string
  let portText: string
  if (authority.startsWith('[')) {
    const match = /^\[([^\]]+)\]:(\d+)$/.exec(authority)
    if (!match) {
      throw new Error('Invalid bracketed CONNECT authority.')
    }
    hostname = match[1] ?? ''
    portText = match[2] ?? ''
  } else {
    const separator = authority.lastIndexOf(':')
    if (separator <= 0 || authority.indexOf(':') !== separator) {
      throw new Error('CONNECT requires an explicit port and bracketed IPv6.')
    }
    hostname = authority.slice(0, separator)
    portText = authority.slice(separator + 1)
  }

  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid CONNECT destination port.')
  }
  return {
    hostname: normalizeDestinationHost(hostname),
    port
  }
}

function parseProxyLeaseToken(header: string | string[] | undefined): string {
  if (typeof header !== 'string') {
    throw new Error('Proxy authorization is required.')
  }
  const normalized = header.trim()
  const bearerMatch = /^Bearer ([A-Za-z0-9._~-]{24,4096})$/.exec(normalized)
  if (bearerMatch?.[1]) {
    return bearerMatch[1]
  }

  const basicMatch = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(normalized)
  if (!basicMatch?.[1]) {
    throw new Error('Proxy authorization must use a supported lease credential.')
  }
  const decoded = Buffer.from(basicMatch[1], 'base64').toString('utf8')
  const separator = decoded.indexOf(':')
  if (separator < 0 || decoded.slice(0, separator) !== 'sciforge-lease') {
    throw new Error('Proxy authorization contains an invalid lease user.')
  }
  const token = decoded.slice(separator + 1)
  if (!/^[A-Za-z0-9._~-]{24,4096}$/.test(token)) {
    throw new Error('Proxy authorization contains an invalid lease token.')
  }
  return token
}

function writeConnectFailure(
  socket: Duplex,
  status: number,
  reason: string,
  headers: Readonly<Record<string, string>> = {}
): void {
  if (!socket.writable) {
    socket.destroy()
    return
  }
  const lines = [
    `HTTP/1.1 ${status} ${reason}`,
    'Connection: close',
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    '',
    ''
  ]
  socket.end(lines.join('\r\n'))
}

function assertResolvedRoute(route: ResolvedWorkspaceEgressRoute): void {
  if (
    !route ||
    typeof route.routeId !== 'string' ||
    !route.routeId.trim() ||
    typeof route.openTunnel !== 'function'
  ) {
    throw new Error('Route resolver returned an invalid route.')
  }
}

function isDuplex(value: unknown): value is Duplex {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<Duplex>
  return typeof candidate.pipe === 'function' &&
    typeof candidate.write === 'function' &&
    typeof candidate.destroy === 'function'
}

function stateFor(record: ActiveLease): WorkspaceEgressLeaseState {
  return {
    leaseId: record.leaseId,
    workspaceId: record.workspaceId,
    selection: record.selection,
    expiresAt: new Date(record.expiresAtMs).toISOString()
  }
}

function digestToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

function tokensEqual(expectedDigest: Buffer, token: string): boolean {
  const actualDigest = digestToken(token)
  return expectedDigest.byteLength === actualDigest.byteLength &&
    timingSafeEqual(expectedDigest, actualDigest)
}

function normalizePort(port: number): number {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Workspace egress bind port must be an integer from 0 to 65535.')
  }
  return port
}

async function closeRoute(route: ResolvedWorkspaceEgressRoute): Promise<void> {
  try {
    await route.close?.()
  } catch {
    // Route teardown is best effort; no resolver detail may leak into callers.
  }
}

function routeUnavailable(error: unknown): WorkspaceEgressError {
  void error
  return new WorkspaceEgressError({
    code: 'route_unavailable',
    message: 'The selected network egress route is unavailable.',
    retryable: true
  })
}

function endedLeaseError(code: EndedLease['code']): WorkspaceEgressError {
  if (code === 'route_unavailable') {
    return new WorkspaceEgressError({
      code,
      message: 'The selected network egress route is unavailable.',
      retryable: true
    })
  }
  if (code === 'lease_expired') {
    return new WorkspaceEgressError({
      code,
      message: 'Workspace egress lease has expired.',
      retryable: true
    })
  }
  return new WorkspaceEgressError({
    code,
    message: 'Workspace egress lease has been revoked.'
  })
}
