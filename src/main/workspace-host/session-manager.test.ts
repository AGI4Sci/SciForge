import { describe, expect, it, vi } from 'vitest'
import { DOMAIN_PACKAGE_CONTRACT_VERSION } from '@sciforge/domain-sdk'
import {
  MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND,
  WORKSPACE_HOST_OPERATIONS,
  WORKSPACE_HOST_PROTOCOL_VERSION,
  type WorkspaceHostClient,
  type WorkspaceHostEvent,
  type WorkspaceHostEventListener,
  type WorkspaceHostProvider,
  type WorkspaceHostSession
} from '@sciforge/domain-sdk/workspace-host'

import { DomainModuleCatalog } from '../modules/catalog'
import { WorkspaceHostProviderRegistry } from '../modules/workspace-host-contributions'
import {
  WorkspaceHostSessionManager,
  WorkspaceHostSessionManagerError,
  type WorkspaceHostSessionManagerOptions
} from './session-manager'

const PROVIDER_ID = 'fixture.remote-workspace.provider'
const SESSION_ID = 'workspace-session-1'

function session(input: Readonly<{
  eventSequence?: number
  earliestSequence?: number
  latestSequence?: number
}> = {}): WorkspaceHostSession {
  const eventSequence = input.eventSequence ?? 0
  return {
    protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
    serverVersion: '1.0.0',
    serverInstanceId: 'server-instance-1',
    sessionId: SESSION_ID,
    lifecycleMode: 'persistent-daemon',
    locator: {
      contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      hostSessionId: SESSION_ID,
      path: '/cluster/project'
    },
    platform: { os: 'linux', architecture: 'x64' },
    capabilities: [],
    contributions: [],
    eventSequence,
    replay: {
      earliestSequence: input.earliestSequence ?? eventSequence,
      latestSequence: input.latestSequence ?? eventSequence
    },
    egress: { mode: 'none', status: 'disabled' }
  }
}

function harness(
  initialSession = session(),
  managerOptions: WorkspaceHostSessionManagerOptions = {}
) {
  let eventListener: WorkspaceHostEventListener | undefined
  const client: WorkspaceHostClient = {
    getSession: vi.fn(() => initialSession),
    request: vi.fn(async (_operation, payload) => payload),
    subscribe: vi.fn((listener) => {
      eventListener = listener
      return vi.fn()
    }),
    acknowledge: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => initialSession),
    close: vi.fn(async () => undefined)
  }
  const provider: WorkspaceHostProvider = {
    attach: vi.fn(async () => client)
  }
  const catalog = new DomainModuleCatalog()
  catalog.registerModule({
    definition: {
      contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
      kind: 'trusted-compile-time',
      packageName: '@fixture/remote-workspace',
      module: {
        id: 'fixture.remote-workspace',
        displayName: 'Remote Workspace',
        version: '1.0.0',
        hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
        priority: 1
      },
      entrypoints: [{
        process: 'main',
        export: './main',
        contributions: [{
          id: PROVIDER_ID,
          kind: MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND,
          priority: 1
        }]
      }]
    },
    contributions: [{
      id: PROVIDER_ID,
      kind: MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND,
      value: provider
    }]
  })
  const manager = new WorkspaceHostSessionManager(
    new WorkspaceHostProviderRegistry(catalog),
    {
      wait: vi.fn(async () => undefined),
      ...managerOptions
    }
  )
  return {
    client,
    provider,
    manager,
    emit: async (event: WorkspaceHostEvent) => {
      if (!eventListener) throw new Error('client has no subscriber')
      await eventListener(event)
      await Promise.resolve()
    }
  }
}

function event(sequence: number): WorkspaceHostEvent {
  return {
    protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
    sessionId: SESSION_ID,
    eventId: `event-${sequence}`,
    sequence,
    kind: 'workspace.fs.changed',
    occurredAt: '2026-07-30T00:00:00.000Z',
    payload: { path: 'README.md' }
  }
}

describe('WorkspaceHostSessionManager', () => {
  it('attaches through an owner-aware provider without exposing authorization in snapshots', async () => {
    const { manager, provider } = harness()

    const snapshot = await manager.attach({
      providerId: PROVIDER_ID,
      authorizedSessionId: 'authorized-session-secret',
    })

    expect(provider.attach).toHaveBeenCalledWith({
      authorizedSessionId: 'authorized-session-secret',
    }, expect.objectContaining({
      owner: {
        moduleId: 'fixture.remote-workspace',
        moduleVersion: '1.0.0'
      },
      signal: expect.any(AbortSignal),
      workspaceModelAccess: expect.objectContaining({
        acquire: expect.any(Function),
        heartbeat: expect.any(Function),
        revoke: expect.any(Function)
      })
    }))
    expect(snapshot).toMatchObject({
      providerId: PROVIDER_ID,
      ownerId: 'fixture.remote-workspace',
      phase: 'connected',
      locator: { hostSessionId: SESSION_ID, path: '/cluster/project' }
    })
    expect(snapshot).not.toHaveProperty('authorizedSessionId')
    await expect(manager.resolvePlacement(snapshot.locator)).resolves.toEqual({
      locator: snapshot.locator,
      session: snapshot.session
    })

    const context = vi.mocked(provider.attach).mock.calls[0]?.[1]
    await expect(context?.workspaceModelAccess.acquire({
      workspaceId: 'ssh_whs_workspace_1'
    })).resolves.toBeNull()
  })

  it('scopes model access to the attached session and validates lease traffic', async () => {
    let observedSignal: AbortSignal | undefined
    const workspaceModelAccess = {
      acquire: vi.fn(async (input) => {
        observedSignal = input.signal
        return {
          leaseId: 'lease-1',
          workspaceId: input.workspaceId,
          endpoint: {
            protocol: 'http' as const,
            host: '127.0.0.1' as const,
            port: 41_001,
            basePath: '/v1' as const
          },
          authorization: {
            scheme: 'bearer' as const,
            token: 'sciforge-workspace-model-token-0123456789'
          },
          issuedAt: '2026-07-30T00:00:00.000Z',
          expiresAt: '2026-07-30T00:01:00.000Z'
        }
      }),
      heartbeat: vi.fn(async (input) => ({
        workspaceId: input.workspaceId,
        leaseId: input.leaseId,
        expiresAt: '2026-07-30T00:02:00.000Z'
      })),
      revoke: vi.fn()
    }
    const { manager, provider } = harness(session(), { workspaceModelAccess })
    await manager.attach({
      providerId: PROVIDER_ID,
      authorizedSessionId: 'authorized-session-1'
    })
    const context = vi.mocked(provider.attach).mock.calls[0]?.[1]
    if (!context) throw new Error('provider was not attached')

    await expect(context.workspaceModelAccess.acquire({
      workspaceId: 'ssh_whs_workspace_1',
      ttlMs: 30_000
    })).resolves.toMatchObject({
      leaseId: 'lease-1',
      workspaceId: 'ssh_whs_workspace_1'
    })
    expect(workspaceModelAccess.acquire).toHaveBeenCalledWith({
      workspaceId: 'ssh_whs_workspace_1',
      ttlMs: 30_000,
      signal: expect.any(AbortSignal)
    })
    expect(observedSignal?.aborted).toBe(false)

    await manager.close(SESSION_ID)
    expect(observedSignal?.aborted).toBe(true)
  })

  it('dispatches sequenced events in order and acknowledges only after listeners finish', async () => {
    const { manager, client, emit } = harness()
    const snapshot = await manager.attach({
      providerId: PROVIDER_ID,
      authorizedSessionId: 'authorized-session-1',
    })
    const observed: number[] = []
    const port = manager.portFor(snapshot.locator)
    port.subscribe(async (input) => {
      observed.push(input.sequence)
    })
    expect(port).not.toHaveProperty('acknowledge')
    expect(port).not.toHaveProperty('reconnect')
    expect(port).not.toHaveProperty('close')

    await emit(event(1))
    await emit(event(2))
    await vi.waitFor(() => {
      expect(client.acknowledge).toHaveBeenCalledTimes(2)
    })

    expect(observed).toEqual([1, 2])
    expect(client.acknowledge).toHaveBeenNthCalledWith(1, 1)
    expect(client.acknowledge).toHaveBeenNthCalledWith(2, 2)
    expect(manager.get(snapshot.locator)).toMatchObject({
      phase: 'connected',
      lastAcknowledgedSequence: 2
    })
  })

  it('enters replay-required on a sequence gap and reconnects from the last ack', async () => {
    const { manager, client, emit } = harness()
    const snapshot = await manager.attach({
      providerId: PROVIDER_ID,
      authorizedSessionId: 'authorized-session-1',
    })

    await emit(event(2))
    await vi.waitFor(() => {
      expect(manager.get(snapshot.locator)).toMatchObject({
        phase: 'replay-required',
        lastAcknowledgedSequence: 0,
        failure: { code: 'replay-gap' }
      })
    })
    vi.mocked(client.reconnect).mockResolvedValueOnce(session())
    await expect(manager.reconnect(snapshot.locator)).resolves.toMatchObject({
      phase: 'connected',
      lastAcknowledgedSequence: 0
    })
    expect(client.reconnect).toHaveBeenCalledWith({
      lastAcknowledgedSequence: 0,
      signal: expect.any(AbortSignal)
    })
  })

  it('preserves the resume acknowledgement watermark during initial attachment', async () => {
    const resumedSession = session({
      eventSequence: 7,
      earliestSequence: 3,
      latestSequence: 7
    })
    const { manager, emit } = harness(resumedSession)
    const snapshot = await manager.attach({
      providerId: PROVIDER_ID,
      authorizedSessionId: 'authorized-session-1',
      resume: {
        sessionId: SESSION_ID,
        lastAcknowledgedSequence: 5
      }
    })

    expect(snapshot.lastAcknowledgedSequence).toBe(5)
    await emit(event(6))
    await vi.waitFor(() => {
      expect(manager.get(snapshot.locator)?.lastAcknowledgedSequence).toBe(6)
    })
  })

  it('fails closed for requests while a session needs replay', async () => {
    const { manager, emit } = harness()
    const snapshot = await manager.attach({
      providerId: PROVIDER_ID,
      authorizedSessionId: 'authorized-session-1',
    })
    await emit(event(3))
    await vi.waitFor(() => {
      expect(manager.get(snapshot.locator)?.phase).toBe('replay-required')
    })

    expect(() => manager.request(
      snapshot.locator,
      'workspace.fs.read',
      { path: 'README.md' }
    )).toThrow(WorkspaceHostSessionManagerError)
  })

  it('detects idle transport loss, publishes reconnecting, and restores health centrally', async () => {
    const healthChecks: Array<() => void> = []
    let resolveReconnect!: (value: WorkspaceHostSession) => void
    const reconnectResult = new Promise<WorkspaceHostSession>((resolve) => {
      resolveReconnect = resolve
    })
    const { manager, client } = harness(session(), {
      scheduleHealthCheck: (listener) => {
        healthChecks.push(listener)
        return () => undefined
      }
    })
    const snapshot = await manager.attach({
      providerId: PROVIDER_ID,
      authorizedSessionId: 'authorized-session-1'
    })
    vi.mocked(client.request).mockRejectedValueOnce(Object.assign(
      new Error('SSH transport closed.'),
      { code: 'workspace_server_connection_lost', retryable: true }
    ))
    vi.mocked(client.reconnect).mockReturnValueOnce(reconnectResult)

    healthChecks.shift()?.()
    await vi.waitFor(() => {
      expect(manager.get(snapshot.locator)).toMatchObject({
        phase: 'reconnecting',
        lastAcknowledgedSequence: 0
      })
    })
    expect(client.reconnect).toHaveBeenCalledWith({
      lastAcknowledgedSequence: 0,
      signal: expect.any(AbortSignal)
    })

    resolveReconnect(session())
    await vi.waitFor(() => {
      expect(manager.get(snapshot.locator)?.phase).toBe('connected')
    })
    expect(manager.get(snapshot.locator)).not.toHaveProperty('failure')
    expect(healthChecks).toHaveLength(1)
  })

  it('moves idle recovery to replay-required when the server cannot replay the ack window', async () => {
    const healthChecks: Array<() => void> = []
    const { manager, client } = harness(session(), {
      scheduleHealthCheck: (listener) => {
        healthChecks.push(listener)
        return () => undefined
      }
    })
    const snapshot = await manager.attach({
      providerId: PROVIDER_ID,
      authorizedSessionId: 'authorized-session-1'
    })
    vi.mocked(client.request).mockRejectedValueOnce(Object.assign(
      new Error('SSH transport closed.'),
      { code: 'workspace_server_connection_lost', retryable: true }
    ))
    vi.mocked(client.reconnect).mockRejectedValueOnce({
      code: 'replay-gap',
      message: 'The replay window no longer contains sequence 0.',
      retryable: false
    })

    healthChecks.shift()?.()
    await vi.waitFor(() => {
      expect(manager.get(snapshot.locator)).toMatchObject({
        phase: 'replay-required',
        failure: {
          code: 'replay-gap',
          retryable: false
        }
      })
    })
  })

  it('marks retryable request transport failures and starts one bounded reconnect', async () => {
    const { manager, client } = harness()
    const snapshot = await manager.attach({
      providerId: PROVIDER_ID,
      authorizedSessionId: 'authorized-session-1'
    })
    const transportError = Object.assign(new Error('Transport unavailable.'), {
      code: 'disconnected',
      retryable: true
    })
    vi.mocked(client.request).mockRejectedValueOnce(transportError)

    await expect(manager.request(
      snapshot.locator,
      WORKSPACE_HOST_OPERATIONS.fileRead,
      { path: 'README.md' }
    )).rejects.toBe(transportError)
    await vi.waitFor(() => {
      expect(client.reconnect).toHaveBeenCalledTimes(1)
    })
  })
})
