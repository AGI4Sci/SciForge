import { describe, expect, it, vi } from 'vitest'
import { ComputerUseRuntimeClient } from './computer-use-runtime-client'

const backend = {
  backend: 'windows-uia',
  available: true,
  targetKinds: ['windows-uia'],
  actions: ['observe', 'write'],
  effectiveIsolation: 'host-app-scoped',
  backgroundInput: 'semantic',
  requiresHostFocus: false,
  affectsUserInput: false,
  usesHostClipboard: false,
  supportsReadback: ['value'],
  leaseScope: 'target',
  maxConcurrency: 3,
  reason: null
} as const

function status(instance = 'instance-1', generation = 4) {
  return {
    ok: true,
    data: {
      serverInstanceId: instance,
      updatedAt: '2026-08-06T08:00:00.000Z',
      protocolVersion: 2,
      approvalProof: 'invocation-proof-v1',
      backendsConnected: true,
      backends: [backend],
      activeChannels: 1,
      active: [{
        sessionId: 'session-1',
        requestId: 'request-1',
        targetId: 'target-1',
        leaseId: 'lease-1',
        runtimeId: 'codex',
        threadId: 'thread-1',
        turnId: 'turn-1',
        backend: 'windows-uia',
        leaseScope: 'target',
        requestedIsolation: 'agent-isolated',
        effectiveIsolation: 'host-app-scoped',
        degraded: true,
        degradedReason: 'REQUESTED_AGENT_ISOLATED_UNAVAILABLE',
        verification: 'unverified',
        state: 'running',
        updatedAt: '2026-08-06T08:00:00.000Z'
      }],
      lifecycleState: 'running',
      cleanupPending: [],
      recentRejections: [],
      reaper: {
        running: true,
        intervalSeconds: 5,
        leaseTtlSeconds: 120,
        lastError: null
      },
      registry: {
        counts: {
          sessions: 1,
          requests: 1,
          activeLeases: 1,
          tombstones: 0,
          releasedLeaseTombstones: 0
        },
        closed: false,
        generation,
        sessions: [],
        requests: [],
        leases: []
      }
    }
  }
}

function capabilities() {
  return {
    ok: true,
    data: {
      protocolVersion: 2,
      approvalProof: 'invocation-proof-v1',
      backends: [backend]
    }
  }
}

function response(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })
}

describe('ComputerUseRuntimeClient', () => {
  it('validates and caches live status without collapsing backend safety fields', async () => {
    const writes: unknown[] = []
    const fetchImpl = vi.fn(async (url: string) =>
      response(url.endsWith('/computer-use/status') ? status() : capabilities()))
    const client = new ComputerUseRuntimeClient({
      baseUrl: 'http://127.0.0.1:3900',
      token: 'token',
      cachePath: 'C:/safe/status.json',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date('2026-08-06T08:00:01.000Z'),
      writeCache: async (_path, value) => { writes.push(value) }
    })

    const view = await client.refresh()

    expect(view).toMatchObject({
      connection: 'online',
      stale: false,
      serverInstanceId: 'instance-1',
      generation: 4,
      approvalProof: 'invocation-proof-v1'
    })
    expect(view.backends).toEqual([backend])
    expect(view.active[0]).toMatchObject({ degraded: true, verification: 'unverified' })
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { Authorization: 'Bearer token' }
    }))
    expect(writes).toHaveLength(1)
  })

  it('rejects a generation regression and never exposes stale active resources', async () => {
    let generation = 5
    const fetchImpl = vi.fn(async (url: string) => response(
      url.endsWith('/computer-use/status') ? status('instance-1', generation) : capabilities()
    ))
    const client = new ComputerUseRuntimeClient({
      baseUrl: 'http://localhost:3900',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    expect((await client.refresh()).connection).toBe('online')
    generation = 4

    const regressed = await client.refresh()

    expect(regressed.connection).toBe('stale')
    expect(regressed.lastStatusError).toContain('generation regressed')
    expect(regressed.active).toEqual([])
    expect(regressed.cleanupPending).toEqual([])
    expect(regressed.backends[0]?.available).toBe(false)
  })

  it('accepts a lower generation after a sidecar instance restart', async () => {
    let current = status('instance-1', 8)
    const fetchImpl = vi.fn(async (url: string) => response(
      url.endsWith('/computer-use/status') ? current : capabilities()
    ))
    const client = new ComputerUseRuntimeClient({
      baseUrl: 'http://127.0.0.1:3900',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    await client.refresh()
    current = status('instance-2', 1)

    const restarted = await client.refresh()

    expect(restarted).toMatchObject({ connection: 'online', serverInstanceId: 'instance-2', generation: 1 })
  })

  it('fails conservatively when the sidecar is unreachable or schema-invalid', async () => {
    const fetchImpl = vi.fn(async () => response({ ok: true, data: { protocolVersion: 2 } }))
    const client = new ComputerUseRuntimeClient({
      baseUrl: 'http://127.0.0.1:3900',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    const view = await client.refresh()

    expect(view.connection).toBe('offline')
    expect(view.approvalProof).toBe('unavailable')
    expect(view.active).toEqual([])
  })

  it('rejects non-loopback and non-http status endpoints', () => {
    expect(() => new ComputerUseRuntimeClient({ baseUrl: 'https://example.com' })).toThrow(/loopback/)
    expect(() => new ComputerUseRuntimeClient({ baseUrl: 'https://127.0.0.1:3900' })).toThrow(/loopback/)
  })
})
