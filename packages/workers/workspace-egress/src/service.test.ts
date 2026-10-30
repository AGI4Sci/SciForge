import assert from 'node:assert/strict'
import { connect, type Socket } from 'node:net'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import {
  WorkspaceEgressError,
  type WorkspaceEgressSelection
} from './contract.js'
import {
  WorkspaceEgressService,
  type ResolvedWorkspaceEgressRoute,
  type WorkspaceEgressRouteResolver
} from './service.js'

type FakeResolver = WorkspaceEgressRouteResolver & {
  readonly resolutions: Array<{
    workspaceId: string
    selection: Exclude<WorkspaceEgressSelection, { mode: 'none' }>
  }>
  loseLastRoute(): void
  setAvailable(available: boolean): void
  readonly closedRoutes: number
}

function createFakeResolver(): FakeResolver {
  const resolutions: FakeResolver['resolutions'] = []
  const lostListeners: Array<() => void> = []
  let available = true
  let closedRoutes = 0

  return {
    resolutions,
    get closedRoutes() {
      return closedRoutes
    },
    resolve(input): ResolvedWorkspaceEgressRoute {
      resolutions.push({
        workspaceId: input.workspaceId,
        selection: input.selection
      })
      return {
        routeId: `route-${resolutions.length}`,
        openTunnel() {
          if (!available) {
            throw new Error('route unavailable at secret endpoint ssh://user:key@cpu.internal:22')
          }
          return new PassThrough()
        },
        probe() {
          return available
        },
        onLost(listener) {
          lostListeners.push(listener)
          return () => {
            const index = lostListeners.indexOf(listener)
            if (index >= 0) {
              lostListeners.splice(index, 1)
            }
          }
        },
        close() {
          closedRoutes += 1
        }
      }
    },
    loseLastRoute() {
      lostListeners.at(-1)?.()
    },
    setAvailable(nextAvailable) {
      available = nextAvailable
    }
  }
}

function createService(
  resolver: WorkspaceEgressRouteResolver,
  options: {
    now?: () => number
    setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
    clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  } = {}
): WorkspaceEgressService {
  let sequence = 0
  return new WorkspaceEgressService({
    routeResolver: resolver,
    createLeaseId: () => `lease-${++sequence}`,
    createLeaseToken: () => `token-${sequence}-${'x'.repeat(40)}`,
    ...options
  })
}

function modelAllowlist() {
  return {
    rules: [{ host: 'api.model.test', ports: [443] }]
  }
}

test('models an offline GPU workspace using either the local machine or a CPU target as egress', async () => {
  const resolver = createFakeResolver()
  const service = createService(resolver)
  try {
    const localLease = await service.acquireLease({
      workspaceId: 'gpu-offline',
      selection: { mode: 'local', allowlist: modelAllowlist() }
    })
    const cpuLease = await service.acquireLease({
      workspaceId: 'gpu-offline',
      selection: {
        mode: 'remote-target',
        authorizedSessionId: 'cpu-online-session',
        allowlist: modelAllowlist()
      }
    })

    assert.equal(localLease.endpoint.host, '127.0.0.1')
    assert.equal(cpuLease.endpoint.port, localLease.endpoint.port)
    assert.deepEqual(resolver.resolutions, [
      {
        workspaceId: 'gpu-offline',
        selection: { mode: 'local', allowlist: modelAllowlist() }
      },
      {
        workspaceId: 'gpu-offline',
        selection: {
          mode: 'remote-target',
          authorizedSessionId: 'cpu-online-session',
          allowlist: modelAllowlist()
        }
      }
    ])
  } finally {
    await service.close()
  }
})

test('does not resolve a route when egress is explicitly disabled', async () => {
  const resolver = createFakeResolver()
  const service = createService(resolver)
  try {
    await assert.rejects(
      service.acquireLease({
        workspaceId: 'gpu-offline',
        selection: { mode: 'none' }
      }),
      (error: unknown) => isEgressError(error, 'egress_disabled')
    )
    assert.equal(resolver.resolutions.length, 0)
  } finally {
    await service.close()
  }
})

test('lease tokens are workspace-scoped and revocation is fail-closed', async () => {
  const resolver = createFakeResolver()
  const service = createService(resolver)
  try {
    const lease = await service.acquireLease({
      workspaceId: 'workspace-a',
      selection: { mode: 'local', allowlist: modelAllowlist() }
    })

    await assert.rejects(
      service.heartbeat({
        workspaceId: 'workspace-b',
        leaseId: lease.leaseId,
        token: lease.credential.token
      }),
      (error: unknown) => isEgressError(error, 'workspace_scope_denied')
    )
    await assert.rejects(
      service.heartbeat({
        workspaceId: 'workspace-a',
        leaseId: lease.leaseId,
        token: 'wrong-token-that-is-still-long-enough-xxxxxxxx'
      }),
      (error: unknown) => isEgressError(error, 'invalid_lease_token')
    )

    service.revoke({
      workspaceId: 'workspace-a',
      leaseId: lease.leaseId,
      token: lease.credential.token
    })
    await assert.rejects(
      service.heartbeat({
        workspaceId: 'workspace-a',
        leaseId: lease.leaseId,
        token: lease.credential.token
      }),
      (error: unknown) => isEgressError(error, 'lease_revoked')
    )
  } finally {
    await service.close()
  }
})

test('route loss immediately invalidates its lease and closes the opaque route', async () => {
  const resolver = createFakeResolver()
  const service = createService(resolver)
  try {
    const lease = await service.acquireLease({
      workspaceId: 'gpu-offline',
      selection: {
        mode: 'remote-target',
        authorizedSessionId: 'cpu-online-session',
        allowlist: modelAllowlist()
      }
    })
    resolver.loseLastRoute()

    await assert.rejects(
      service.heartbeat({
        workspaceId: lease.workspaceId,
        leaseId: lease.leaseId,
        token: lease.credential.token
      }),
      (error: unknown) => isEgressError(error, 'route_unavailable')
    )
    assert.equal(resolver.closedRoutes, 1)
  } finally {
    await service.close()
  }
})

test('heartbeat detects route probe failure and does not expose resolver endpoints or secrets', async () => {
  const resolver = createFakeResolver()
  const service = createService(resolver)
  try {
    const lease = await service.acquireLease({
      workspaceId: 'gpu-offline',
      selection: {
        mode: 'remote-target',
        authorizedSessionId: 'cpu-online-session',
        allowlist: modelAllowlist()
      }
    })
    resolver.setAvailable(false)

    let message = ''
    await assert.rejects(
      service.heartbeat({
        workspaceId: lease.workspaceId,
        leaseId: lease.leaseId,
        token: lease.credential.token
      }),
      (error: unknown) => {
        message = error instanceof Error ? error.message : String(error)
        return isEgressError(error, 'route_unavailable')
      }
    )
    assert.doesNotMatch(message, /cpu\.internal|user:key|ssh:\/\//)
    assert.doesNotMatch(message, new RegExp(lease.credential.token))
  } finally {
    await service.close()
  }
})

test('lease expiry is enforced with a deterministic sweep', async () => {
  const resolver = createFakeResolver()
  let now = Date.parse('2026-07-30T00:00:00.000Z')
  const service = createService(resolver, {
    now: () => now,
    setTimer: () => ({}) as ReturnType<typeof setTimeout>,
    clearTimer: () => undefined
  })
  try {
    const lease = await service.acquireLease({
      workspaceId: 'gpu-offline',
      selection: { mode: 'local', allowlist: modelAllowlist() },
      ttlMs: 5_000
    })
    now += 5_001
    assert.equal(service.sweepExpired(), 1)
    await assert.rejects(
      service.heartbeat({
        workspaceId: lease.workspaceId,
        leaseId: lease.leaseId,
        token: lease.credential.token
      }),
      (error: unknown) => isEgressError(error, 'lease_expired')
    )
  } finally {
    await service.close()
  }
})

test('the loopback HTTP CONNECT relay requires a valid lease and enforces its allowlist', async () => {
  const resolver = createFakeResolver()
  const service = createService(resolver)
  try {
    const lease = await service.acquireLease({
      workspaceId: 'gpu-offline',
      selection: { mode: 'local', allowlist: modelAllowlist() }
    })

    const allowed = await connectToRelay(
      lease.endpoint.host,
      lease.endpoint.port,
      [
        'CONNECT api.model.test:443 HTTP/1.1',
        'Host: api.model.test:443',
        `Proxy-Authorization: Bearer ${lease.credential.token}`,
        '',
        ''
      ].join('\r\n')
    )
    assert.match(allowed.response, /^HTTP\/1\.1 200 Connection Established/)
    allowed.socket.destroy()

    const basicCredential = Buffer
      .from(`sciforge-lease:${lease.credential.token}`, 'utf8')
      .toString('base64')
    const allowedWithStandardProxyAuth = await connectToRelay(
      lease.endpoint.host,
      lease.endpoint.port,
      [
        'CONNECT api.model.test:443 HTTP/1.1',
        'Host: api.model.test:443',
        `Proxy-Authorization: Basic ${basicCredential}`,
        '',
        ''
      ].join('\r\n')
    )
    assert.match(
      allowedWithStandardProxyAuth.response,
      /^HTTP\/1\.1 200 Connection Established/
    )
    allowedWithStandardProxyAuth.socket.destroy()

    const denied = await connectToRelay(
      lease.endpoint.host,
      lease.endpoint.port,
      [
        'CONNECT metadata.internal:443 HTTP/1.1',
        'Host: metadata.internal:443',
        `Proxy-Authorization: Bearer ${lease.credential.token}`,
        '',
        ''
      ].join('\r\n')
    )
    assert.match(denied.response, /^HTTP\/1\.1 403 Forbidden/)
    denied.socket.destroy()

    const unauthorized = await connectToRelay(
      lease.endpoint.host,
      lease.endpoint.port,
      [
        'CONNECT api.model.test:443 HTTP/1.1',
        'Host: api.model.test:443',
        '',
        ''
      ].join('\r\n')
    )
    assert.match(unauthorized.response, /^HTTP\/1\.1 407 Proxy Authentication Required/)
    unauthorized.socket.destroy()
  } finally {
    await service.close()
  }
})

test('rejects any attempt to expose the CONNECT relay beyond loopback', () => {
  const resolver = createFakeResolver()
  assert.throws(
    () => new WorkspaceEgressService({
      routeResolver: resolver,
      bindHost: '0.0.0.0'
    }),
    /loopback/
  )
  assert.throws(
    () => new WorkspaceEgressService({
      routeResolver: resolver,
      bindHost: '10.20.30.40'
    }),
    /loopback/
  )
})

function isEgressError(error: unknown, code: WorkspaceEgressError['code']): boolean {
  return error instanceof WorkspaceEgressError && error.code === code
}

async function connectToRelay(
  host: string,
  port: number,
  request: string
): Promise<{ socket: Socket; response: string }> {
  return await new Promise((resolve, reject) => {
    const socket = connect(port, host)
    let response = ''
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('Timed out waiting for CONNECT response.'))
    }, 2_000)
    const finish = () => {
      if (!response.includes('\r\n\r\n')) {
        return
      }
      clearTimeout(timeout)
      socket.off('error', reject)
      resolve({ socket, response })
    }
    socket.once('connect', () => socket.write(request))
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8')
      finish()
    })
    socket.once('error', reject)
    socket.once('end', finish)
  })
}
