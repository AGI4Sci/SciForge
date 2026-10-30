import assert from 'node:assert/strict'
import { createServer, request as createHttpRequest, type Server } from 'node:http'
import { connect } from 'node:net'
import test from 'node:test'

import { WorkspaceEgressError } from './contract.js'
import {
  WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_CONCURRENT_REQUESTS,
  WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_HEADER_BYTES,
  WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_REQUEST_BYTES,
  summarizeWorkspaceModelRouterBridgeLease,
  type WorkspaceModelRouterBridgeProbe
} from './model-router-bridge.js'
import { WorkspaceEgressService } from './service.js'

const STATIC_RUNTIME_KEY = 'desktop-only-static-model-router-runtime-key'

type UpstreamObservation = {
  method?: string
  url?: string
  authorization?: string
  xApiKey?: string
  cookie?: string
  body?: string
}

async function startFakeModelRouter(): Promise<{
  server: Server
  baseUrl: string
  observations: UpstreamObservation[]
}> {
  const observations: UpstreamObservation[] = []
  const server = createServer((request, response) => {
    const observation: UpstreamObservation = {
      method: request.method,
      url: request.url,
      authorization: stringHeader(request.headers.authorization),
      xApiKey: stringHeader(request.headers['x-api-key']),
      cookie: stringHeader(request.headers.cookie)
    }
    observations.push(observation)
    if (request.headers.authorization !== `Bearer ${STATIC_RUNTIME_KEY}`) {
      response.writeHead(401)
      response.end('unauthorized')
      return
    }
    if (request.method === 'GET' && request.url === '/v1/capabilities') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{"ok":true}')
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      observation.body = Buffer.concat(chunks).toString('utf8')
      if (
        request.method === 'POST' &&
        request.url === '/v1/responses?stream=true'
      ) {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Set-Cookie': 'must-not-cross=1',
          'X-Upstream-Trace': 'trace-safe'
        })
        response.write('data: {"type":"response.output_text.delta","delta":"one"}\n\n')
        setTimeout(() => {
          response.write('data: {"type":"response.output_text.delta","delta":"two"}\n\n')
          response.end('data: [DONE]\n\n')
        }, 20)
        return
      }
      response.writeHead(404)
      response.end('not found')
    })
  })
  await listen(server)
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    observations
  }
}

function createBridgeService(options: {
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  modelRouterBridgeProbe?: WorkspaceModelRouterBridgeProbe
} = {}): WorkspaceEgressService {
  let sequence = 0
  return new WorkspaceEgressService({
    routeResolver: {
      resolve() {
        throw new Error('General workspace egress is not used by bridge tests.')
      }
    },
    createLeaseId: () => `model-bridge-lease-${++sequence}`,
    createLeaseToken: () => `model-bridge-token-${sequence}-${'x'.repeat(32)}`,
    ...options
  })
}

test('proxies Responses SSE while replacing remote authorization with the local runtime key', async () => {
  const upstream = await startFakeModelRouter()
  const service = createBridgeService()
  try {
    const lease = await service.acquireModelRouterBridge({
      workspaceId: 'gpu-workspace',
      upstreamBaseUrl: upstream.baseUrl,
      runtimeKey: STATIC_RUNTIME_KEY
    })
    const serializedLease = JSON.stringify(lease)
    assert.doesNotMatch(serializedLease, new RegExp(STATIC_RUNTIME_KEY))
    assert.equal(lease.endpoint.host, '127.0.0.1')
    assert.equal(lease.endpoint.basePath, '/v1')

    const payload = JSON.stringify({
      model: 'sciforge-router',
      input: 'hello',
      stream: true
    })
    const result = await bridgeRequest({
      lease,
      method: 'POST',
      path: '/v1/responses?stream=true',
      headers: {
        Authorization: `Bearer ${lease.authorization.token}`,
        'X-Api-Key': 'remote-must-not-cross',
        Cookie: 'remote-cookie=must-not-cross',
        'Content-Type': 'application/json'
      },
      body: payload
    })

    assert.equal(result.status, 200)
    assert.equal(result.headers['content-type'], 'text/event-stream')
    assert.equal(result.headers['set-cookie'], undefined)
    assert.equal(result.headers['x-upstream-trace'], 'trace-safe')
    assert.ok(result.chunks.length >= 2, 'SSE chunks should stream without response buffering.')
    assert.match(result.body, /"delta":"one"/)
    assert.match(result.body, /"delta":"two"/)
    assert.match(result.body, /\[DONE\]/)

    const proxied = upstream.observations.at(-1)
    assert.deepEqual(proxied, {
      method: 'POST',
      url: '/v1/responses?stream=true',
      authorization: `Bearer ${STATIC_RUNTIME_KEY}`,
      xApiKey: undefined,
      cookie: undefined,
      body: payload
    })
  } finally {
    await service.close()
    await closeServer(upstream.server)
  }
})

test('requires the scoped bearer token and allows only exact Model Router routes', async () => {
  const upstream = await startFakeModelRouter()
  const service = createBridgeService()
  try {
    const lease = await service.acquireModelRouterBridge({
      workspaceId: 'gpu-workspace',
      upstreamBaseUrl: upstream.baseUrl,
      runtimeKey: STATIC_RUNTIME_KEY
    })
    const unauthorized = await simpleRequest(
      lease.endpoint.host,
      lease.endpoint.port,
      'GET',
      '/v1/models'
    )
    assert.equal(unauthorized.status, 401)

    const forbidden = await simpleRequest(
      lease.endpoint.host,
      lease.endpoint.port,
      'GET',
      '/health',
      lease.authorization.token
    )
    assert.equal(forbidden.status, 403)

    const absoluteFormStatus = await rawHttpStatus(
      lease.endpoint.host,
      lease.endpoint.port,
      [
        `POST http://127.0.0.1:${lease.endpoint.port}/v1/responses HTTP/1.1`,
        `Host: 127.0.0.1:${lease.endpoint.port}`,
        `Authorization: Bearer ${lease.authorization.token}`,
        'Content-Length: 0',
        '',
        ''
      ].join('\r\n')
    )
    assert.equal(absoluteFormStatus, 400)
  } finally {
    await service.close()
    await closeServer(upstream.server)
  }
})

test('bounds request bodies before forwarding them to the local router', async () => {
  const upstream = await startFakeModelRouter()
  const service = createBridgeService()
  try {
    const lease = await service.acquireModelRouterBridge({
      workspaceId: 'gpu-workspace',
      upstreamBaseUrl: upstream.baseUrl,
      runtimeKey: STATIC_RUNTIME_KEY
    })
    const status = await rawHttpStatus(
      lease.endpoint.host,
      lease.endpoint.port,
      [
        'POST /v1/responses HTTP/1.1',
        `Host: ${lease.endpoint.host}:${lease.endpoint.port}`,
        `Authorization: Bearer ${lease.authorization.token}`,
        `Content-Length: ${WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_REQUEST_BYTES + 1}`,
        '',
        ''
      ].join('\r\n')
    )
    assert.equal(status, 413)
  } finally {
    await service.close()
    await closeServer(upstream.server)
  }
})

test('bounds request concurrency and HTTP header bytes', async () => {
  let activeUpstreamRequests = 0
  const upstream = createServer((request, response) => {
    if (request.url === '/v1/capabilities') {
      response.writeHead(200)
      response.end('{}')
      return
    }
    activeUpstreamRequests += 1
    request.once('close', () => {
      activeUpstreamRequests = Math.max(0, activeUpstreamRequests - 1)
    })
  })
  await listen(upstream)
  const address = upstream.address()
  assert.ok(address && typeof address !== 'string')
  const service = createBridgeService()
  const sockets: ReturnType<typeof connect>[] = []
  try {
    const lease = await service.acquireModelRouterBridge({
      workspaceId: 'gpu-workspace',
      upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`,
      runtimeKey: STATIC_RUNTIME_KEY
    })
    for (
      let index = 0;
      index < WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_CONCURRENT_REQUESTS;
      index += 1
    ) {
      const socket = connect(lease.endpoint.port, lease.endpoint.host)
      sockets.push(socket)
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => {
          socket.write([
            'POST /v1/responses HTTP/1.1',
            `Host: ${lease.endpoint.host}:${lease.endpoint.port}`,
            `Authorization: Bearer ${lease.authorization.token}`,
            'Content-Length: 0',
            '',
            ''
          ].join('\r\n'))
          resolve()
        })
        socket.once('error', reject)
      })
    }
    await waitFor(() =>
      activeUpstreamRequests === WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_CONCURRENT_REQUESTS
    )
    const overloaded = await rawHttpStatus(
      lease.endpoint.host,
      lease.endpoint.port,
      [
        'POST /v1/responses HTTP/1.1',
        `Host: ${lease.endpoint.host}:${lease.endpoint.port}`,
        `Authorization: Bearer ${lease.authorization.token}`,
        'Content-Length: 0',
        '',
        ''
      ].join('\r\n')
    )
    assert.equal(overloaded, 429)

    const oversizedHeader = `X-Oversized: ${'a'.repeat(
      WORKSPACE_MODEL_ROUTER_BRIDGE_MAX_HEADER_BYTES
    )}`
    const headerStatus = await rawHttpStatus(
      lease.endpoint.host,
      lease.endpoint.port,
      [
        'POST /v1/responses HTTP/1.1',
        `Host: ${lease.endpoint.host}:${lease.endpoint.port}`,
        `Authorization: Bearer ${lease.authorization.token}`,
        oversizedHeader,
        'Content-Length: 0',
        '',
        ''
      ].join('\r\n')
    )
    assert.equal(headerStatus, 400)
  } finally {
    for (const socket of sockets) socket.destroy()
    await service.close()
    await closeServer(upstream)
  }
})

test('scopes heartbeat and revoke to the owning workspace and scoped token', async () => {
  const upstream = await startFakeModelRouter()
  const service = createBridgeService()
  try {
    const lease = await service.acquireModelRouterBridge({
      workspaceId: 'workspace-a',
      upstreamBaseUrl: upstream.baseUrl,
      runtimeKey: STATIC_RUNTIME_KEY
    })
    await assert.rejects(
      service.heartbeatModelRouterBridge({
        workspaceId: 'workspace-b',
        leaseId: lease.leaseId,
        token: lease.authorization.token
      }),
      (error: unknown) => bridgeError(error, 'workspace_scope_denied')
    )
    await assert.rejects(
      service.heartbeatModelRouterBridge({
        workspaceId: 'workspace-a',
        leaseId: lease.leaseId,
        token: `wrong-${'x'.repeat(32)}`
      }),
      (error: unknown) => bridgeError(error, 'invalid_lease_token')
    )
    const renewed = await service.heartbeatModelRouterBridge({
      workspaceId: 'workspace-a',
      leaseId: lease.leaseId,
      token: lease.authorization.token
    })
    assert.equal(renewed.leaseId, lease.leaseId)

    service.revokeModelRouterBridge({
      workspaceId: 'workspace-a',
      leaseId: lease.leaseId,
      token: lease.authorization.token
    })
    await assert.rejects(
      service.heartbeatModelRouterBridge({
        workspaceId: 'workspace-a',
        leaseId: lease.leaseId,
        token: lease.authorization.token
      }),
      (error: unknown) => bridgeError(error, 'lease_revoked')
    )
  } finally {
    await service.close()
    await closeServer(upstream.server)
  }
})

test('revokes on owning route loss and reports an unavailable route without secrets', async () => {
  const upstream = await startFakeModelRouter()
  const service = createBridgeService()
  const route = new AbortController()
  try {
    const lease = await service.acquireModelRouterBridge({
      workspaceId: 'gpu-workspace',
      upstreamBaseUrl: upstream.baseUrl,
      runtimeKey: STATIC_RUNTIME_KEY
    }, {
      routeSignal: route.signal
    })
    route.abort()
    let message = ''
    await assert.rejects(
      service.heartbeatModelRouterBridge({
        workspaceId: lease.workspaceId,
        leaseId: lease.leaseId,
        token: lease.authorization.token
      }),
      (error: unknown) => {
        message = error instanceof Error ? error.message : String(error)
        return bridgeError(error, 'route_unavailable')
      }
    )
    assert.doesNotMatch(message, /runtime-key|127\.0\.0\.1|model-bridge-token/)
  } finally {
    await service.close()
    await closeServer(upstream.server)
  }
})

test('heartbeat revokes the bridge when the local Model Router disappears', async () => {
  const upstream = await startFakeModelRouter()
  const service = createBridgeService()
  try {
    const lease = await service.acquireModelRouterBridge({
      workspaceId: 'gpu-workspace',
      upstreamBaseUrl: upstream.baseUrl,
      runtimeKey: STATIC_RUNTIME_KEY
    })
    await closeServer(upstream.server)
    await assert.rejects(
      service.heartbeatModelRouterBridge({
        workspaceId: lease.workspaceId,
        leaseId: lease.leaseId,
        token: lease.authorization.token
      }),
      (error: unknown) => bridgeError(error, 'route_unavailable')
    )
  } finally {
    await service.close()
  }
})

test('expires bridge leases through the shared WorkspaceEgressService sweep', async () => {
  let now = Date.parse('2026-07-30T00:00:00.000Z')
  const service = createBridgeService({
    now: () => now,
    modelRouterBridgeProbe: () => true,
    setTimer: () => ({}) as ReturnType<typeof setTimeout>,
    clearTimer: () => undefined
  })
  try {
    const lease = await service.acquireModelRouterBridge({
      workspaceId: 'gpu-workspace',
      upstreamBaseUrl: 'http://127.0.0.1:3892/v1',
      runtimeKey: STATIC_RUNTIME_KEY,
      ttlMs: 5_000
    })
    now += 5_001
    assert.equal(service.sweepExpired(), 1)
    await assert.rejects(
      service.heartbeatModelRouterBridge({
        workspaceId: lease.workspaceId,
        leaseId: lease.leaseId,
        token: lease.authorization.token
      }),
      (error: unknown) => bridgeError(error, 'lease_expired')
    )
  } finally {
    await service.close()
  }
})

test('validates a literal-loopback /v1 upstream and redacts bridge diagnostics', async () => {
  const service = createBridgeService({
    now: () => Date.parse('2026-07-30T00:00:00.000Z')
  })
  try {
    await assert.rejects(
      service.acquireModelRouterBridge({
        workspaceId: 'gpu-workspace',
        upstreamBaseUrl: 'https://router.example.test/v1',
        runtimeKey: STATIC_RUNTIME_KEY
      })
    )
    await assert.rejects(
      service.acquireModelRouterBridge({
        workspaceId: 'gpu-workspace',
        upstreamBaseUrl: 'http://localhost:3892/v1',
        runtimeKey: STATIC_RUNTIME_KEY
      })
    )
  } finally {
    await service.close()
  }

  const upstream = await startFakeModelRouter()
  const active = createBridgeService()
  try {
    const lease = await active.acquireModelRouterBridge({
      workspaceId: 'gpu-workspace',
      upstreamBaseUrl: upstream.baseUrl,
      runtimeKey: STATIC_RUNTIME_KEY
    })
    const summary = summarizeWorkspaceModelRouterBridgeLease(lease)
    const serialized = JSON.stringify(summary)
    assert.doesNotMatch(serialized, new RegExp(lease.authorization.token))
    assert.doesNotMatch(serialized, /127\.0\.0\.1/)
    assert.equal(summary.authorization, '[redacted]')
    assert.equal(summary.endpoint, 'http://<redacted-endpoint>')
  } finally {
    await active.close()
    await closeServer(upstream.server)
  }
})

test('WorkspaceEgressService close revokes bridges and closes their listeners', async () => {
  const upstream = await startFakeModelRouter()
  const service = createBridgeService()
  const lease = await service.acquireModelRouterBridge({
    workspaceId: 'gpu-workspace',
    upstreamBaseUrl: upstream.baseUrl,
    runtimeKey: STATIC_RUNTIME_KEY
  })
  await service.close()
  try {
    assert.throws(
      () => service.heartbeatModelRouterBridge({
        workspaceId: lease.workspaceId,
        leaseId: lease.leaseId,
        token: lease.authorization.token
      }),
      (error: unknown) => bridgeError(error, 'relay_closed')
    )
    await assert.rejects(simpleRequest(
      lease.endpoint.host,
      lease.endpoint.port,
      'GET',
      '/v1/models',
      lease.authorization.token
    ))
  } finally {
    await closeServer(upstream.server)
  }
})

async function bridgeRequest(input: {
  lease: Awaited<ReturnType<WorkspaceEgressService['acquireModelRouterBridge']>>
  method: string
  path: string
  headers?: Record<string, string>
  body?: string
}): Promise<{
  status: number
  headers: Record<string, string | string[] | undefined>
  chunks: string[]
  body: string
}> {
  return await new Promise((resolve, reject) => {
    const request = createHttpRequest({
      host: input.lease.endpoint.host,
      port: input.lease.endpoint.port,
      method: input.method,
      path: input.path,
      headers: {
        ...input.headers,
        ...(input.body
          ? { 'Content-Length': String(Buffer.byteLength(input.body, 'utf8')) }
          : {})
      }
    }, (response) => {
      const chunks: string[] = []
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => chunks.push(chunk))
      response.once('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        chunks,
        body: chunks.join('')
      }))
    })
    request.once('error', reject)
    request.end(input.body)
  })
}

async function simpleRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  token?: string
): Promise<{ status: number; body: string }> {
  const result = await bridgeRequest({
    lease: {
      endpoint: {
        protocol: 'http',
        host,
        port,
        basePath: '/v1'
      }
    } as Awaited<ReturnType<WorkspaceEgressService['acquireModelRouterBridge']>>,
    method,
    path,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {})
  })
  return { status: result.status, body: result.body }
}

async function rawHttpStatus(host: string, port: number, request: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const socket = connect(port, host)
    let response = ''
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('Timed out waiting for bridge response.'))
    }, 2_000)
    socket.once('connect', () => socket.write(request))
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8')
      const match = /^HTTP\/1\.1 (\d{3})/.exec(response)
      if (!match?.[1]) return
      clearTimeout(timeout)
      socket.destroy()
      resolve(Number(match[1]))
    })
    socket.once('error', reject)
  })
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

function stringHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function bridgeError(error: unknown, code: WorkspaceEgressError['code']): boolean {
  return error instanceof WorkspaceEgressError && error.code === code
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for bridge test condition.')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
