import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { HostServiceProviderRegistry, type HostServiceRequest } from '@sciforge/plugin-sdk'
import { TEST_IDS } from '@sciforge/collaboration-contracts/testing'
import { createCollaborationError } from '@sciforge/collaboration-contracts'
import { createDomainHostServiceResolver } from '@sciforge/domain-identity-access/host-services'
import { createCloudHostCapabilityDefinitions } from '../../../packages/domains/identity-access/src/main/cloud-host-capabilities'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { createAnchoredCommentsCapabilityFactory } from '../../../plugins/anchored-comments/src/core/main/index'
import { SharedConversationService } from '../../../plugins/anchored-comments/src/core/main/shared-conversation-service'
import { SharedConversationStore } from '../../../plugins/anchored-comments/src/core/main/shared-conversation-store'
import { ANCHORED_COMMENT_CAPABILITY_IDS } from '../../../plugins/anchored-comments/src/core/contract'
import { CapabilityBroker } from '../capabilities/broker'
import { createInstalledDomainHostServiceResolution } from '../modules/installed-domain-main'
import { createDomainHostCapabilityInvoker } from './domain-host-capability-invoker'
import { CapabilityRegistry, defineCapability } from '../capabilities/registry'
import { z } from 'zod'

const serviceId = 'identity-access.authenticated-cloud'
const ready = { state: 'ready' as const, baseUrl: 'https://cloud.example.test', userId: TEST_IDS.userId,
  deviceId: TEST_IDS.deviceId, deviceRevision: 1, sessionGeneration: 'runtime:1' }
const { state: _state, ...expectedBinding } = ready
const command = { protocolVersion: '1.0' as const, type: 'project.code_conversation.append' as const, requestId: TEST_IDS.requestId,
  idempotencyKey: 'idem_host_retry_0001', projectId: TEST_IDS.projectId, conversationId: 'root',
  message: { messageId: 'm1', kind: 'user' as const, body: 'Hello' } }
const input = { contractVersion: 1, operationId: 'sciforge.cloud.command', payload: command, expectedBinding }
const response = (status: number): Awaited<ReturnType<AuthenticatedCloudTransport['execute']>> => ({ contractVersion: 1, status, body: {
  protocolVersion: '1.0', requestId: TEST_IDS.requestId, type: 'rest.error',
  error: createCollaborationError(status === 429 ? 'rate_limited' : 'provider_unavailable', 'Transient failure.')
} })
const recovered: Awaited<ReturnType<AuthenticatedCloudTransport['execute']>> = { contractVersion: 1, status: 200, body: { protocolVersion: '1.0', requestId: TEST_IDS.requestId,
  type: 'rest.code_conversation.changed', event: { projectId: command.projectId, conversationId: command.conversationId,
    sequence: 1, revision: 2, actorUserId: ready.userId, occurredAt: '2026-11-12T00:00:00.000Z',
    change: { kind: 'message', message: { ...command.message, publishedByUserId: ready.userId, publishedAt: '2026-11-12T00:00:00.000Z' } } } } }

function fixture(execute = vi.fn<AuthenticatedCloudTransport['execute']>(async () => recovered)) {
  const outerActionId = 'plugin.shared.retry'
  const outerInvocationId = 'confirmed-outer-invocation'
  const outer = defineCapability({ id: outerActionId, version: '1', title: 'Retry shared command',
    description: 'Confirmed outer operation.', audiences: ['ui', 'agent'], scope: 'global', effect: 'external-write',
    approval: 'confirmation', concurrency: { revision: 'none', idempotency: 'required' },
    inputSchema: z.object({}).strict(), outputSchema: z.object({}).strict(), handler: async () => ({ output: {} }) })
  const broker = new CapabilityBroker(new CapabilityRegistry([outer, ...createCloudHostCapabilityDefinitions({
    defineCapability, transport: { execute } as unknown as AuthenticatedCloudTransport, status: () => ready
  })]), { resolveCurrentPrincipal: () => ({ authority: 'sciforge-cloud', assurance: 'cloud-authenticated',
    subject: ready.userId, deviceId: ready.deviceId, identityVersion: 1 }) })
  const invoke = vi.fn(createDomainHostCapabilityInvoker(() => broker).invoke)
  const providers = createDomainHostServiceResolver({ capabilities: { invoke }, authorizeHostService: () => true })
    .resolve('plugin', '1.0.0', 1)!
  const registry = new HostServiceProviderRegistry(providers)
  const request = (operation: string, requestInput: unknown, effect: 'read' | 'workspace-write' | 'external-write'): HostServiceRequest => ({
    serviceId, requestId: 'host-request', operation, input: requestInput, signal: new AbortController().signal,
    assertCurrent: vi.fn(), owner: { connectionId: 'connection', pluginId: 'plugin', packageName: 'plugin', version: '1.0.0',
      generation: 1, invocationId: 'runner-invocation', authority: { effect, capabilityId: outerActionId,
        invocationId: outerInvocationId, caller: { audience: 'ui', callerId: 'window:1', approvals: [{
          actionId: outerActionId, invocationId: outerInvocationId, mode: 'confirmation'
        }] } } }
  })
  return { broker, execute, invoke, registry, request }
}

describe('Identity Cloud Host through CapabilityBroker', () => {
  it('includes the approved Identity client factory in actual generated domain composition', () => {
    let approved = true
    const composition = createInstalledDomainHostServiceResolution({
      capabilities: { invoke: vi.fn() }, hostServiceClientModule: '/host/host-service-client.mjs',
      authorizeHostService: (owner: { packageName: string; version: string; serviceId: string }) => approved &&
        owner.packageName === 'plugin' && owner.version === '1.0.0' && owner.serviceId === serviceId
    })
    expect(composition.resolveHostServiceProviders('plugin', '1.0.0', 1)).toHaveProperty(serviceId)
    expect(composition.resolveHostServiceClients('plugin', '1.0.0', 1)).toContainEqual({
      serviceId, modulePath: '/host/host-service-client.mjs', exportName: 'createHostServiceClient', config: { serviceId }
    })
    expect(composition.resolveHostServiceClients('plugin', '2.0.0', 1)).toEqual([])
    expect(composition.resolveHostServiceClients('other', '1.0.0', 1)).toEqual([])
    approved = false
    expect(composition.resolveHostServiceClients('plugin', '1.0.0', 1)).toEqual([])
    expect(composition.resolveHostServiceProviders('plugin', '1.0.0', 1)).toBeUndefined()
  })

  it.each(['offline', '429', '503'])('redispatches unchanged Cloud identity after %s and after a settled response', async failure => {
    const f = fixture()
    f.execute.mockImplementationOnce(async () => {
      if (failure === 'offline') throw new Error('offline')
      return response(Number(failure))
    })
    const request = f.request('execute', input, 'external-write')
    if (failure === 'offline') await expect(f.registry.dispatch(request)).rejects.toMatchObject({ code: 'handler_failed' })
    else await expect(f.registry.dispatch(request)).resolves.toMatchObject({ status: Number(failure) })
    await expect(f.registry.dispatch(request)).resolves.toEqual(recovered)
    await expect(f.registry.dispatch(request)).resolves.toEqual(recovered)
    expect(f.execute).toHaveBeenCalledTimes(3)
    for (const [sent] of f.execute.mock.calls) expect(sent.payload).toEqual(command)
    expect(new Set(f.invoke.mock.calls.map(([sent]) => sent.invocationId)).size).toBe(3)
    expect(f.broker.listAuditRecords().some(record => record.status === 'replayed')).toBe(false)
  })

  it.each(['missing', 'wrong invocation', 'wrong action'])('denies nested writes with %s outer confirmation', async kind => {
    const f = fixture()
    const request = f.request('execute', input, 'external-write')
    const caller = request.owner.authority.caller as Record<string, unknown>
    const approvals = kind === 'missing' ? [] : [{ actionId: kind === 'wrong action' ? 'other.write' : 'plugin.shared.retry',
      invocationId: kind === 'wrong invocation' ? 'other-invocation' : 'confirmed-outer-invocation', mode: 'confirmation' }]
    await expect(f.registry.dispatch({ ...request, owner: { ...request.owner,
      authority: { ...request.owner.authority, caller: { ...caller, approvals } } } })).rejects.toMatchObject({ code: 'approval_denied' })
    expect(f.execute).not.toHaveBeenCalled()
  })

  it('rejects a revoked outer lease immediately before nested dispatch', async () => {
    const f = fixture()
    let checks = 0
    const request = f.request('execute', input, 'external-write')
    await expect(f.registry.dispatch({ ...request, assertCurrent: () => {
      if (++checks >= 5) throw new Error('Outer approval revoked')
    } })).rejects.toThrow(/revoked/)
    expect(f.execute).not.toHaveBeenCalled()
  })

  it('preserves ordinary Session provenance while delegating the confirmed outer write', async () => {
    const f = fixture()
    const request = f.request('execute', input, 'external-write')
    const caller = request.owner.authority.caller as Record<string, unknown>
    await expect(f.registry.dispatch({ ...request, owner: { ...request.owner, authority: {
      ...request.owner.authority, caller: { ...caller, audience: 'agent' },
      ordinarySession: { runtimeId: 'codex', threadId: 'thread-1' },
      originalContext: { runtimeId: 'codex', threadId: 'thread-1' }
    } } })).resolves.toEqual(recovered)
    expect(f.execute).toHaveBeenCalledOnce()
  })

  it('routes UI status and confirmed writes with a synthetic runner Session through UI authority', async () => {
    const f = fixture()
    const dispatch = (operation: string, requestInput: unknown, effect: 'read' | 'external-write') => {
      const request = f.request(operation, requestInput, effect)
      return f.registry.dispatch({ ...request, owner: { ...request.owner, authority: {
        ...request.owner.authority,
        ordinarySession: { runtimeId: 'codex', threadId: 'synthetic-ui-session' },
        originalContext: { runtimeId: 'codex', threadId: 'synthetic-ui-session' }
      } } })
    }
    await expect(dispatch('status', {}, 'read')).resolves.toEqual(ready)
    await expect(dispatch('execute', input, 'external-write')).resolves.toEqual(recovered)
    expect(f.execute).toHaveBeenCalledOnce()
    expect(f.execute.mock.calls[0][0].payload).toEqual(command)
  })

  it('rejects an outer capability registration revoked before delegation', async () => {
    const f = fixture()
    f.broker.registry.unregister('plugin.shared.retry')
    await expect(f.registry.dispatch(f.request('execute', input, 'external-write'))).rejects.toThrow()
    expect(f.execute).not.toHaveBeenCalled()
  })

  it('rechecks exact package approval before dispatch', async () => {
    const f = fixture()
    let approved = true
    const providers = createDomainHostServiceResolver({ capabilities: { invoke: f.invoke }, authorizeHostService: () => approved })
      .resolve('plugin', '1.0.0', 1)!
    approved = false
    await expect(new HostServiceProviderRegistry(providers).dispatch(f.request('execute', input, 'external-write'))).rejects.toThrow(/mismatch/)
    expect(f.execute).not.toHaveBeenCalled()
  })

  it('runs the actual shared discard effect through Host status without admitting Cloud mutations', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'identity-host-discard-')))
    try {
      const f = fixture()
      const store = new SharedConversationStore(root)
      const binding = { baseUrl: ready.baseUrl, userId: ready.userId, projectId: command.projectId }
      await store.enqueue(binding, command)
      await store.reject(binding, { idempotencyKey: command.idempotencyKey, conversationId: command.conversationId,
        status: 403, code: 'permission_denied', message: 'Membership revoked.' })
      let effect: 'read' | 'workspace-write' | 'external-write' = 'read'
      const shared = new SharedConversationService(store, {
        status: async () => await f.registry.dispatch(f.request('status', {}, effect)) as typeof ready,
        execute: async () => { throw new Error('Discard must not dispatch a Cloud command.') }
      })
      const definitions = createAnchoredCommentsCapabilityFactory({ defineCapability: value => value,
        getComments: () => { throw new Error('Unexpected local comment access.') },
        getFeedback: () => { throw new Error('Unexpected feedback access.') }, getShared: () => shared }).createDefinitions()
      const discard = definitions.find(value => value.id === ANCHORED_COMMENT_CAPABILITY_IDS.sharedDiscard)!
      expect(discard.effect).toBe('workspace-write')
      effect = discard.effect
      await discard.handler({ projectId: command.projectId, idempotencyKey: command.idempotencyKey })
      expect((await store.read(binding)).outbox).toEqual([])
      expect((await store.read(binding)).rejectedCommands).toEqual([])
      expect(f.invoke).toHaveBeenCalledTimes(2)
      expect(f.execute).not.toHaveBeenCalled()
      await expect(f.registry.dispatch(f.request('execute', input, effect))).rejects.toThrow(/external-write/)
      expect(f.execute).not.toHaveBeenCalled()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
