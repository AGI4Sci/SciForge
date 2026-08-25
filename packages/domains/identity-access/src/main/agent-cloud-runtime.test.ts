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

  it('synchronously fences future work and aborts an in-flight Agent HTTP request', async () => {
    const vault = memoryVault()
    await seedAuthority(vault)
    const requestStarted = deferred<AbortSignal>()
    const fetchImpl = vi.fn((_url: URL, init?: RequestInit) => {
      const signal = init?.signal
      if (!signal) throw new Error('The Agent request must carry a cancellation signal.')
      requestStarted.resolve(signal)
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const service = createIdentityAgentCloudRuntime({
      getRuntime: () => runtimeDouble() as never,
      vault,
      fetchImpl: fetchImpl as typeof fetch
    })

    const inFlight = service.execute({
      agentId: agentNodeFixture.agentId,
      request: heartbeatRequest('req_000000000000000000000011')
    })
    const signal = await requestStarted.promise
    const fencing = service.fenceAgent(agentNodeFixture.agentId)

    expect(signal.aborted).toBe(true)
    await expect(service.execute({
      agentId: agentNodeFixture.agentId,
      request: heartbeatRequest('req_000000000000000000000012')
    })).rejects.toMatchObject({ code: 'agent_required' })
    expect(fetchImpl).toHaveBeenCalledOnce()
    await expect(fencing).resolves.toBeUndefined()
    await expect(inFlight).rejects.toBeDefined()
  })

  it('lifts a local fence only after a new Agent authority is securely committed', async () => {
    const vault = memoryVault()
    await seedAuthority(vault)
    const replacementAuthority = `agent.${'B'.repeat(32)}`
    const rotatedAgent = {
      ...agentNodeFixture,
      revision: agentNodeFixture.revision + 1,
      credentialVersion: agentNodeFixture.credentialVersion + 1
    }
    const rotatedEnvelope = {
      ...agentRegisteredResponseFixture.sealedCredential,
      credentialGeneration: rotatedAgent.credentialVersion
    }
    const executeAuthenticatedCloud = vi.fn(async (input: Readonly<{ payload: RestRequest }>) => ({
      contractVersion: 1 as const,
      status: 200,
      body: {
        protocolVersion: '1.0' as const,
        type: 'agent.credential_rotated' as const,
        requestId: input.payload.requestId,
        agent: rotatedAgent,
        sealedCredential: rotatedEnvelope
      }
    }))
    const service = createIdentityAgentCloudRuntime({
      getRuntime: () => runtimeDouble(executeAuthenticatedCloud) as never,
      vault,
      createBootstrap: () => ({
        publicKey: rotatedEnvelope.ephemeralPublicKey,
        open: vi.fn(() => replacementAuthority)
      })
    })
    await service.fenceAgent(agentNodeFixture.agentId)
    await expect(service.authorityStatus(agentNodeFixture.agentId)).resolves.toMatchObject({
      state: 'agent_required'
    })

    await expect(service.rotateAgent({
      agentId: agentNodeFixture.agentId,
      expectedRevision: agentNodeFixture.revision,
      idempotencyKey: 'idem_agent-rotate_123456789012'
    })).resolves.toEqual(rotatedAgent)

    await expect(service.authorityStatus(agentNodeFixture.agentId)).resolves.toMatchObject({
      state: 'ready',
      generation: rotatedAgent.credentialVersion
    })
    expect(vault.value({
      kind: 'agent-credential',
      agentId: agentNodeFixture.agentId
    })).toContain(replacementAuthority)
  })

  it('never resurrects replacement authority when a fence wins during vault commit', async () => {
    const backingVault = memoryVault()
    await seedAuthority(backingVault)
    const writeStarted = deferred<void>()
    const writeRelease = deferred<void>()
    let delayReplacementWrite = false
    const vault: IdentityPrivateVault & Readonly<{
      value(ref: IdentityPrivateSecretRef): string | null
    }> = {
      ...backingVault,
      write: async (ref, value) => {
        if (delayReplacementWrite && ref.kind === 'agent-credential') {
          writeStarted.resolve()
          await writeRelease.promise
        }
        await backingVault.write(ref, value)
      }
    }
    const rotatedAgent = {
      ...agentNodeFixture,
      revision: agentNodeFixture.revision + 1,
      credentialVersion: agentNodeFixture.credentialVersion + 1
    }
    const rotatedEnvelope = {
      ...agentRegisteredResponseFixture.sealedCredential,
      credentialGeneration: rotatedAgent.credentialVersion
    }
    const service = createIdentityAgentCloudRuntime({
      getRuntime: () => runtimeDouble(vi.fn(async (input: Readonly<{ payload: RestRequest }>) => ({
        contractVersion: 1 as const,
        status: 200,
        body: {
          protocolVersion: '1.0' as const,
          type: 'agent.credential_rotated' as const,
          requestId: input.payload.requestId,
          agent: rotatedAgent,
          sealedCredential: rotatedEnvelope
        }
      }))) as never,
      vault,
      createBootstrap: () => ({
        publicKey: rotatedEnvelope.ephemeralPublicKey,
        open: vi.fn(() => `agent.${'C'.repeat(32)}`)
      })
    })
    await service.fenceAgent(agentNodeFixture.agentId)
    delayReplacementWrite = true
    const rotating = service.rotateAgent({
      agentId: agentNodeFixture.agentId,
      expectedRevision: agentNodeFixture.revision,
      idempotencyKey: 'idem_agent-rotate_123456789013'
    })
    const outcome = rotating.then(
      () => ({ resolved: true as const }),
      (error: unknown) => ({ resolved: false as const, error })
    )
    await writeStarted.promise

    const fencing = service.fenceAgent(agentNodeFixture.agentId)
    writeRelease.resolve()

    expect(await outcome).toMatchObject({
      resolved: false,
      error: { code: 'agent_required' }
    })
    await fencing
    expect(vault.value({
      kind: 'agent-credential',
      agentId: agentNodeFixture.agentId
    })).toBeNull()
    await expect(service.authorityStatus(agentNodeFixture.agentId)).resolves.toMatchObject({
      state: 'agent_required'
    })
  })

  it('rechecks the authority epoch before committing an HTTP response', async () => {
    const vault = memoryVault()
    await seedAuthority(vault)
    const bodyReadStarted = deferred<void>()
    const bodyBytes = deferred<ArrayBuffer>()
    const response = new Response(null, {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
    vi.spyOn(response, 'arrayBuffer').mockImplementation(() => {
      bodyReadStarted.resolve()
      return bodyBytes.promise
    })
    const fetchImpl = vi.fn(async () => response)
    const service = createIdentityAgentCloudRuntime({
      getRuntime: () => runtimeDouble() as never,
      vault,
      fetchImpl: fetchImpl as typeof fetch
    })
    const request = heartbeatRequest('req_000000000000000000000013')
    const inFlight = service.execute({
      agentId: agentNodeFixture.agentId,
      request
    })
    const outcome = inFlight.then(
      () => ({ resolved: true as const }),
      (error: unknown) => ({ resolved: false as const, error })
    )
    await bodyReadStarted.promise

    const fencing = service.fenceAgent(agentNodeFixture.agentId)
    bodyBytes.resolve(encodedArrayBuffer(JSON.stringify({
      protocolVersion: '1.0',
      type: 'rest.entity',
      requestId: request.requestId,
      entity: agentNodeFixture
    })))

    expect(await outcome).toMatchObject({
      resolved: false,
      error: { code: 'agent_required' }
    })
    await fencing
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

  it('synchronously fences HTTP and websocket work before a Cloud revocation settles', async () => {
    const vault = memoryVault()
    await seedAuthority(vault)
    const requestStarted = deferred<AbortSignal>()
    const fetchImpl = vi.fn((_url: URL, init?: RequestInit) => {
      const signal = init?.signal
      if (!signal) throw new Error('The Agent request must carry a cancellation signal.')
      requestStarted.resolve(signal)
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const socket = new FakeWebSocket()
    const socketCreated = deferred<void>()
    const revokeRelease = deferred<void>()
    const executeAuthenticatedCloud = vi.fn(async (input: Readonly<{ payload: RestRequest }>) => {
      await revokeRelease.promise
      return {
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
      }
    })
    const service = createIdentityAgentCloudRuntime({
      getRuntime: () => runtimeDouble(executeAuthenticatedCloud) as never,
      vault,
      fetchImpl: fetchImpl as typeof fetch,
      webSocketFactory: () => {
        socketCreated.resolve()
        return socket as never
      }
    })
    const http = service.execute({
      agentId: agentNodeFixture.agentId,
      request: heartbeatRequest('req_000000000000000000000021')
    })
    const outerAbort = new AbortController()
    const webSocket = service.observeAgentInbox(
      agentNodeFixture.agentId,
      outerAbort.signal
    )[Symbol.asyncIterator]().next()
    const httpOutcome = http.then(
      () => ({ resolved: true as const }),
      (error: unknown) => ({ resolved: false as const, error })
    )
    const webSocketOutcome = webSocket.then(
      () => ({ resolved: true as const }),
      (error: unknown) => ({ resolved: false as const, error })
    )
    const signal = await requestStarted.promise
    await socketCreated.promise

    const revoking = service.revokeAgent({
      agentId: agentNodeFixture.agentId,
      expectedRevision: agentNodeFixture.revision,
      idempotencyKey: 'idem_agent-revoke_123456789013'
    })

    expect(signal.aborted).toBe(true)
    expect(socket.close).toHaveBeenCalledWith(1008, 'agent authority fenced')
    await expect(service.authorityStatus(agentNodeFixture.agentId)).resolves.toMatchObject({
      state: 'agent_required'
    })
    expect(await httpOutcome).toMatchObject({ resolved: false })
    expect(await webSocketOutcome).toMatchObject({
      resolved: false,
      error: { code: 'agent_required' }
    })
    revokeRelease.resolve()
    await expect(revoking).resolves.toMatchObject({ lifecycleStatus: 'revoked' })
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

  it('synchronously closes an in-flight Agent websocket and rejects future observation', async () => {
    const vault = memoryVault()
    await seedAuthority(vault)
    const socket = new FakeWebSocket()
    const socketCreated = deferred<void>()
    const webSocketFactory = vi.fn(() => {
      socketCreated.resolve()
      return socket as never
    })
    const service = createIdentityAgentCloudRuntime({
      getRuntime: () => runtimeDouble() as never,
      vault,
      webSocketFactory
    })
    const outerAbort = new AbortController()
    const iterator = service.observeAgentInbox(
      agentNodeFixture.agentId,
      outerAbort.signal
    )[Symbol.asyncIterator]()
    const inFlight = iterator.next()
    await socketCreated.promise

    const fencing = service.fenceAgent(agentNodeFixture.agentId)

    expect(socket.close).toHaveBeenCalledWith(1008, 'agent authority fenced')
    await expect(inFlight).rejects.toMatchObject({ code: 'agent_required' })
    await expect(service.observeAgentInbox(
      agentNodeFixture.agentId,
      outerAbort.signal
    )[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'agent_required' })
    expect(webSocketFactory).toHaveBeenCalledOnce()
    await expect(fencing).resolves.toBeUndefined()
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

async function seedAuthority(vault: IdentityPrivateVault): Promise<void> {
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
}

function heartbeatRequest(requestId: `req_${string}`): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId,
    type: 'agent.heartbeat',
    idempotencyKey: `idem_agent-heartbeat_${requestId.slice(4)}`,
    agentId: agentNodeFixture.agentId,
    expectedRevision: 1,
    connectionStatus: 'online',
    capabilities: agentNodeFixture.capabilities
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

function encodedArrayBuffer(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
