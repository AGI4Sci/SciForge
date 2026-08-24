import { EventEmitter } from 'node:events'

import WebSocket from 'ws'
import { describe, expect, it, vi } from 'vitest'

import {
  agentNodeFixture,
  agentRegisteredResponseFixture,
  webSocketMessageFixture
} from '@sciforge/collaboration-contracts/testing'
import type { RestRequest } from '@sciforge/collaboration-contracts'

import { createIdentityAgentCloudRuntime } from './agent-cloud-runtime.js'
import type { IdentityPrivateVault, IdentityPrivateSecretRef } from './private-vault.js'

const AUTHORITY = `agent.${'A'.repeat(32)}`

describe('Identity Agent Cloud runtime', () => {
  it('generates bootstrap authority internally and commits only to the Identity vault', async () => {
    const vault = memoryVault()
    const open = vi.fn(() => AUTHORITY)
    const executeAuthenticatedCloud = vi.fn(async (input: Readonly<{ payload: any }>) => ({
      contractVersion: 1 as const,
      status: 200,
      body: {
        ...agentRegisteredResponseFixture,
        requestId: input.payload.requestId
      }
    }))
    const service = createIdentityAgentCloudRuntime({
      getRuntime: () => runtimeDouble(executeAuthenticatedCloud) as never,
      vault,
      createBootstrap: () => ({
        publicKey: agentRegisteredResponseFixture.sealedCredential.ephemeralPublicKey,
        open
      })
    })

    const agent = await service.registerAgent({
      displayName: 'Packaged Worker',
      nodeType: 'desktop',
      capabilities: ['task.execute'],
      idempotencyKey: 'idem_agent-register_123456789012'
    })

    expect(agent).toEqual(agentNodeFixture)
    expect(open).toHaveBeenCalledOnce()
    expect(executeAuthenticatedCloud.mock.calls[0]?.[0].payload).toMatchObject({
      type: 'agent.register',
      deviceId: agentNodeFixture.deviceId,
      credentialBootstrapPublicKey: agentRegisteredResponseFixture.sealedCredential.ephemeralPublicKey
    })
    const stored = vault.value({ kind: 'agent-credential', agentId: agent.agentId })
    expect(stored).toContain(AUTHORITY)
    expect(JSON.stringify(agent)).not.toContain(AUTHORITY)
  })

  it('injects Agent authority only inside the private HTTP request', async () => {
    const vault = memoryVault()
    await vault.write(
      { kind: 'agent-credential', agentId: agentNodeFixture.agentId },
      JSON.stringify({
        version: 1,
        agentId: agentNodeFixture.agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId,
        generation: 1,
        authority: AUTHORITY
      })
    )
    const fetchImpl = vi.fn(async (_url: URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RestRequest
      return new Response(JSON.stringify({
        protocolVersion: '1.0',
        type: 'rest.entity',
        requestId: request.requestId,
        entity: agentNodeFixture
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const service = createIdentityAgentCloudRuntime({
      getRuntime: () => runtimeDouble() as never,
      vault,
      fetchImpl: fetchImpl as typeof fetch
    })
    const response = await service.execute({
      agentId: agentNodeFixture.agentId,
      request: {
        protocolVersion: '1.0',
        requestId: 'req_000000000000000000000001',
        type: 'agent.heartbeat',
        idempotencyKey: 'idem_agent-heartbeat_1234567890',
        agentId: agentNodeFixture.agentId,
        expectedRevision: 1,
        connectionStatus: 'online',
        capabilities: agentNodeFixture.capabilities
      }
    })
    expect(response.type).toBe('rest.entity')
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('authorization'))
      .toBe(`Bearer ${AUTHORITY}`)
    expect(JSON.stringify(fetchImpl.mock.calls[0]?.[1]?.body)).not.toContain(AUTHORITY)
  })

  it('fails closed when stored authority belongs to another Device', async () => {
    const vault = memoryVault()
    await vault.write(
      { kind: 'agent-credential', agentId: agentNodeFixture.agentId },
      JSON.stringify({
        version: 1,
        agentId: agentNodeFixture.agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: 'dev_AnotherDevice0001',
        generation: 1,
        authority: AUTHORITY
      })
    )
    const fetchImpl = vi.fn()
    const service = createIdentityAgentCloudRuntime({
      getRuntime: () => runtimeDouble() as never,
      vault,
      fetchImpl: fetchImpl as typeof fetch
    })
    await expect(service.execute({
      agentId: agentNodeFixture.agentId,
      request: {
        protocolVersion: '1.0',
        requestId: 'req_000000000000000000000002',
        type: 'agent.heartbeat',
        idempotencyKey: 'idem_agent-heartbeat_1234567891',
        agentId: agentNodeFixture.agentId,
        expectedRevision: 1,
        connectionStatus: 'online',
        capabilities: agentNodeFixture.capabilities
      }
    })).rejects.toMatchObject({ code: 'agent_authority_invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('revokes through current User authority before deleting the exact Agent binding', async () => {
    const vault = memoryVault()
    await vault.write(
      { kind: 'agent-credential', agentId: agentNodeFixture.agentId },
      JSON.stringify({
        version: 1,
        agentId: agentNodeFixture.agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId,
        generation: 1,
        authority: AUTHORITY
      })
    )
    const executeAuthenticatedCloud = vi.fn(async (input: Readonly<{ payload: RestRequest }>) => ({
      contractVersion: 1 as const,
      status: 200,
      body: {
        protocolVersion: '1.0' as const,
        type: 'rest.entity' as const,
        requestId: input.payload.requestId,
        entity: {
          ...agentNodeFixture,
          revision: agentNodeFixture.revision + 1,
          lifecycleStatus: 'revoked' as const,
          connectionStatus: 'offline' as const,
          revokedAt: '2026-08-24T12:00:00.000Z'
        }
      }
    }))
    const service = createIdentityAgentCloudRuntime({
      getRuntime: () => runtimeDouble(executeAuthenticatedCloud) as never,
      vault
    })

    await expect(service.revokeAgent({
      agentId: agentNodeFixture.agentId,
      expectedRevision: agentNodeFixture.revision,
      idempotencyKey: 'idem_agent-revoke_123456789012'
    })).resolves.toMatchObject({ lifecycleStatus: 'revoked' })
    expect(executeAuthenticatedCloud.mock.calls[0]?.[0].payload).toMatchObject({
      type: 'agent.revoke',
      agentId: agentNodeFixture.agentId,
      expectedRevision: agentNodeFixture.revision
    })
    expect(vault.value({ kind: 'agent-credential', agentId: agentNodeFixture.agentId }))
      .toBeNull()
  })

  it('injects authority inside one bounded WSS handshake and returns only strict events', async () => {
    const vault = memoryVault()
    await vault.write(
      { kind: 'agent-credential', agentId: agentNodeFixture.agentId },
      JSON.stringify({
        version: 1,
        agentId: agentNodeFixture.agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId,
        generation: 1,
        authority: AUTHORITY
      })
    )
    const socket = new FakeWebSocket()
    let handshake: Readonly<{ url: string; headers: Readonly<Record<string, string>> }> | undefined
    const service = createIdentityAgentCloudRuntime({
      getRuntime: () => runtimeDouble() as never,
      vault,
      webSocketFactory: (url, headers) => {
        handshake = { url, headers }
        queueMicrotask(() => {
          socket.readyState = WebSocket.OPEN
          socket.emit('open')
          socket.emit('message', Buffer.from(JSON.stringify(webSocketMessageFixture)))
        })
        return socket as never
      }
    })
    const abort = new AbortController()
    const iterator = service.observeAgentInbox(
      agentNodeFixture.agentId,
      abort.signal
    )[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: webSocketMessageFixture
    })
    expect(handshake).toEqual({
      url: 'wss://cloud.example.test/v1/events',
      headers: { authorization: `Bearer ${AUTHORITY}` }
    })
    expect(JSON.stringify(webSocketMessageFixture)).not.toContain(AUTHORITY)
    abort.abort()
    await iterator.return?.()
    expect(socket.close).toHaveBeenCalledWith(1000, 'client shutdown')
  })
})

class FakeWebSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING
  readonly close = vi.fn((code?: number) => {
    this.readyState = WebSocket.CLOSED
    this.emit('close', code)
  })
}

function runtimeDouble(executeAuthenticatedCloud = vi.fn()) {
  return {
    authenticatedCloudTransportStatus: () => ({
      state: 'ready' as const,
      baseUrl: 'https://cloud.example.test',
      userId: agentNodeFixture.ownerUserId,
      deviceId: agentNodeFixture.deviceId
    }),
    executeAuthenticatedCloud
  }
}

function memoryVault(): IdentityPrivateVault & Readonly<{
  value(ref: IdentityPrivateSecretRef): string | null
}> {
  const values = new Map<string, string>()
  const key = (ref: IdentityPrivateSecretRef) =>
    `${ref.kind}:${ref.kind === 'agent-credential' ? ref.agentId : ''}`
  return {
    read: async (ref) => values.get(key(ref)) ?? null,
    write: async (ref, value) => { values.set(key(ref), value) },
    has: async (ref) => values.has(key(ref)),
    remove: async (ref) => { values.delete(key(ref)) },
    value: (ref) => values.get(key(ref)) ?? null
  }
}
