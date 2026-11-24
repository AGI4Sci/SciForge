import { describe, expect, it, vi } from 'vitest'
import type { HostServiceRequest } from '@sciforge/plugin-sdk'
import { TEST_IDS } from '@sciforge/collaboration-contracts/testing'
import { createDomainHostServiceResolver } from './host-services.js'
import { AUTHENTICATED_CLOUD_HOST_SERVICE_ID as serviceId, authenticatedCloudCommandEffect, cloudHostRequestSchema } from './cloud-host-contract.js'
import { createCloudHostCapabilityDefinitions } from './main/cloud-host-capabilities.js'
import type { AuthenticatedCloudTransport } from './authenticated-cloud-transport.js'

const ready = { state: 'ready' as const, baseUrl: 'https://cloud.example.test', userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId, deviceRevision: 1, sessionGeneration: 'runtime:1' }
const { state: _state, ...expectedBinding } = ready
const input = { contractVersion: 1, operationId: 'sciforge.cloud.command', payload: {
  protocolVersion: '1.0', requestId: TEST_IDS.requestId, type: 'project.list', limit: 50
}, expectedBinding }
const response = { contractVersion: 1, status: 403, body: { protocolVersion: '1.0', requestId: TEST_IDS.requestId,
  type: 'rest.error', error: { protocolVersion: '1.0', type: 'error', code: 'permission_denied', category: 'authorization',
    httpStatus: 403, retryable: false, message: 'Denied.' } } }
function request(overrides: Partial<HostServiceRequest> = {}): HostServiceRequest {
  return { serviceId, requestId: 'r', operation: 'status', input: {}, signal: new AbortController().signal,
    assertCurrent: vi.fn(), owner: { connectionId: 'c', pluginId: 'p', packageName: 'plugin', version: '1.0.0', generation: 1,
      invocationId: 'i', authority: { effect: 'read', ordinarySession: { sessionId: 'session' },
        caller: { audience: 'agent', callerId: 'caller', principal: { secretHostFact: true } } } }, ...overrides }
}

describe('Identity Cloud Host service', () => {
  it('provides an approved generic client factory only with an absolute client module', () => {
    const options = { capabilities: { invoke: vi.fn() }, authorizeHostService: () => true }
    for (const hostServiceClientModule of [undefined, '', 'relative/client.mjs']) {
      expect(createDomainHostServiceResolver({ ...options, hostServiceClientModule }).resolveClients('plugin', '1.0.0', 1)).toEqual([])
    }
    const resolver = createDomainHostServiceResolver({ ...options, hostServiceClientModule: '/host/client.mjs' })
    expect(resolver.resolveClients('plugin', '1.0.0', 1)).toEqual([{
      serviceId, modulePath: '/host/client.mjs', exportName: 'createHostServiceClient', config: { serviceId }
    }])
    expect(createDomainHostServiceResolver({ ...options, hostServiceClientModule: '/host/client.mjs', authorizeHostService: () => false })
      .resolveClients('plugin', '1.0.0', 1)).toEqual([])
  })
  it('exposes only the strict admitted command union and requires a preflight binding', () => {
    expect(cloudHostRequestSchema.safeParse(input).success).toBe(true)
    const { expectedBinding: _expected, ...unbound } = input
    expect(cloudHostRequestSchema.safeParse(unbound).success).toBe(false)
    expect(cloudHostRequestSchema.safeParse({ ...input, payload: { ...input.payload, type: 'user.get', userId: ready.userId } }).success).toBe(false)
    expect(cloudHostRequestSchema.safeParse({ ...input, payload: { ...input.payload, credential: 'unexpected' } }).success).toBe(false)
    expect(cloudHostRequestSchema.safeParse({ ...input, expectedBinding: { ...expectedBinding, accessToken: 'unexpected' } }).success).toBe(false)
  })
  it('admits exact package/version only and projects public caller with session and lease', async () => {
    const invoke = vi.fn(async (_request: unknown, _context: Record<string, any>) => ready)
    const resolver = createDomainHostServiceResolver({ capabilities: { invoke }, authorizeHostService: ({ packageName, version }: { packageName: string; version: string }) => packageName === 'plugin' && version === '1.0.0' })
    expect(resolver.resolve('plugin', '2.0.0', 1)).toBeUndefined()
    expect(createDomainHostServiceResolver({ capabilities: { invoke } }).resolve('plugin', '1.0.0', 1)).toBeUndefined()
    const provider = resolver.resolve('plugin', '1.0.0', 1)![serviceId]!
    await expect(provider.operations.status!(request())).resolves.toEqual(ready)
    expect(invoke.mock.calls[0]![1]).toMatchObject({ caller: { audience: 'agent', callerId: 'caller', approvals: [] }, ordinarySession: { sessionId: 'session' } })
    expect(invoke.mock.calls[0]![1].caller).not.toHaveProperty('principal')
    expect(() => provider.authorize(request({ assertCurrent: undefined }))).toThrow(/lease/)
    expect(() => provider.authorize(request({ owner: { ...request().owner, version: '2.0.0' } }))).toThrow(/mismatch/)
    const aborted = new AbortController(); aborted.abort()
    expect(() => provider.authorize(request({ signal: aborted.signal }))).toThrow()
  })

  it('routes reads and fails closed unknown commands or insufficient effects', async () => {
    const invoke = vi.fn(async (_request: unknown, _context: unknown) => ({ contractVersion: 1, status: 200, body: {} }))
    const provider = createDomainHostServiceResolver({ capabilities: { invoke }, authorizeHostService: () => true }).resolve('plugin', '1.0.0', 1)![serviceId]!
    await expect(provider.operations.execute!(request({ operation: 'execute', input }))).rejects.toThrow()
    expect(invoke.mock.calls[0]![0]).toMatchObject({ actionId: 'identity.cloud.host.read' })
    for (const suffix of ['publish', 'append', 'fork', 'set_status']) expect(authenticatedCloudCommandEffect(`project.code_conversation.${suffix}`)).toBe('external-write')
    expect(authenticatedCloudCommandEffect('project.code_conversation.pull')).toBe('read')
    expect(() => authenticatedCloudCommandEffect('user.update')).toThrow(/not allowed/)
    expect(() => provider.authorize(request({ owner: { ...request().owner, authority: { ...request().owner.authority, effect: 'compute' } } }))).toThrow(/authority/)
  })

  it('gates writes separately and gives each attempt a fresh broker identity while preserving the command key', async () => {
    const invoke = vi.fn(async (_request: unknown, _context: unknown) => response)
    const provider = createDomainHostServiceResolver({ capabilities: { invoke }, authorizeHostService: () => true }).resolve('plugin', '1.0.0', 1)![serviceId]!
    const writeInput = { ...input, payload: { protocolVersion: '1.0', requestId: TEST_IDS.requestId,
      type: 'project.code_conversation.set_status', projectId: TEST_IDS.projectId,
      conversationId: 'conversation-1', idempotencyKey: 'idem_conversation_status_0001',
      status: 'resolved', expectedRevision: 1, observedMessageId: 'message-1' } }
    expect(() => provider.authorize(request({ operation: 'execute', input: writeInput }))).toThrow(/external-write/)
    const writeRequest = request({ operation: 'execute', input: writeInput,
      owner: { ...request().owner, authority: { ...request().owner.authority, effect: 'external-write' } } })
    await expect(provider.operations.execute!(writeRequest)).resolves.toEqual(response)
    await provider.operations.execute!(writeRequest)
    expect(invoke.mock.calls[0]![0]).toMatchObject({ actionId: 'identity.cloud.host.execute', invocationId: expect.stringMatching(/^identity-cloud:[a-f0-9-]{36}$/), input: writeInput })
    expect(invoke.mock.calls[1]![0]).toMatchObject({ actionId: 'identity.cloud.host.execute', input: writeInput })
    expect(invoke.mock.calls[0]![0]).not.toEqual(invoke.mock.calls[1]![0])
    const definitions = createCloudHostCapabilityDefinitions({ defineCapability: (value) => value, transport: {} as AuthenticatedCloudTransport, status: () => ready })
    expect(definitions.find((value) => value.id === 'identity.cloud.host.execute')).toMatchObject({ effect: 'external-write', approval: 'confirmation', concurrency: { idempotency: 'required' } })
  })

  it('admits only status reads under workspace-write and retains external-write mutation enforcement', async () => {
    const invoke = vi.fn(async () => ready)
    const provider = createDomainHostServiceResolver({ capabilities: { invoke }, authorizeHostService: () => true }).resolve('plugin', '1.0.0', 1)![serviceId]!
    const workspaceRequest = request({ owner: { ...request().owner, authority: { ...request().owner.authority, effect: 'workspace-write' } } })
    await expect(provider.operations.status!(workspaceRequest)).resolves.toEqual(ready)
    expect(() => provider.authorize({ ...workspaceRequest, operation: 'execute', input })).toThrow(/read authority/)
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('rejects principal/device mismatch before transport and account changes after await', async () => {
    let status = { ...ready, userId: String(ready.userId), sessionGeneration: 'runtime:1' }
    const execute = vi.fn(async () => { status = { ...ready, deviceRevision: 2 }; return response })
    const transport = { status: () => status, execute } as unknown as AuthenticatedCloudTransport
    const definitions = createCloudHostCapabilityDefinitions({ defineCapability: (value) => value, transport, status: () => status })
    const read = definitions.find((value) => value.id.endsWith('.read'))!
    const context = { signal: new AbortController().signal, assertPrincipalCurrent: vi.fn(), caller: { principal: {
      authority: 'sciforge-cloud', assurance: 'cloud-authenticated', subject: ready.userId, deviceId: 'wrong-device', identityVersion: 1
    } } }
    await expect(read.handler(input, context)).rejects.toThrow(/principal/)
    expect(execute).not.toHaveBeenCalled()
    context.caller.principal.deviceId = ready.deviceId
    execute.mockImplementation(async () => {
      status = { ...ready, userId: 'usr_Other0000001' }
      return response
    })
    await expect(read.handler(input, context)).rejects.toThrow(/principal/)
    expect(execute).toHaveBeenCalledOnce()
    status = ready
    execute.mockImplementation(async () => { status = { ...ready, deviceRevision: 2 }; return response })
    await expect(read.handler(input, context)).rejects.toThrow(/binding changed/)
    status = ready
    execute.mockImplementation(async () => response)
    await expect(read.handler(input, context)).resolves.toEqual({ output: response })
    execute.mockClear()
    status = { ...ready, userId: 'usr_Other0000001' }
    context.caller.principal.subject = status.userId as typeof ready.userId
    await expect(read.handler(input, context)).rejects.toThrow(/expected identity binding/)
    expect(execute).not.toHaveBeenCalled()
    status = { ...ready, sessionGeneration: 'runtime:2' }
    context.caller.principal.subject = ready.userId
    await expect(read.handler(input, context)).rejects.toThrow(/expected identity binding/)
    expect(execute).not.toHaveBeenCalled()
  })
})
