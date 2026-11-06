import { realpath } from 'node:fs/promises'
import { HostServiceProviderRegistry, type HostServiceOwner, type PluginAdapterContract } from '@sciforge/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeHost } from '../runtime/agent-runtime/host'
import { approvesHostService, composeNativeExecutionHostServices } from './native-execution-composition'

async function fixture() {
  const root = await realpath(process.cwd())
  const contracts = new Map<string, PluginAdapterContract>([['@test/native@1.0.0', {
    hostApiRange: '*', permissions: [], approved: true,
    dshAuthorization: { packageName: '@test/native', packageVersion: '1.0.0', dshRuntimeVersion: '1.0.0', hostServices: ['nativeExecution'] }
  }]])
  const host = {
    readThreadSnapshot: vi.fn(async () => ({ workspace: root })),
    resolveCapabilitySandboxMode: vi.fn(async () => 'read-only'),
    requestCapabilityApproval: vi.fn(async () => 'allowed')
  }
  const domains = { hostServiceIds: ['domain'], resolveHostServiceProviders: () => ({ domain: { authorize() {}, operations: { read: () => 'domain-result' } } }), resolveHostServiceClients: () => [] }
  const options = {
    domains, contracts, clientModulePath: '/trusted/native-execution-client.mjs',
    authorizeWorkspace: vi.fn(async () => true), runtimeHost: () => host as unknown as AgentRuntimeHost
  }
  const resolution = composeNativeExecutionHostServices(options)
  const registry = new HostServiceProviderRegistry(resolution.resolveHostServiceProviders('@test/native', '1.0.0', 1)!)
  const owner: HostServiceOwner = {
    connectionId: 'connection', pluginId: 'plugin', packageName: '@test/native', version: '1.0.0', generation: 1, invocationId: 'invoke',
    authority: {
      caller: { callerId: 'agent', workspaceId: root }, ordinarySession: { runtimeId: 'dsh', threadId: 'thread' },
      capabilityId: 'test.run', effect: 'workspace-write', sessionId: 'child',
      originalContext: { requestId: 'request', runtimeId: 'dsh', threadId: 'thread', turnId: 'turn', callId: 'call' }
    }
  }
  const dispatch = (operation: string, input: unknown = {}, who = owner) => registry.dispatch({ requestId: 'request', serviceId: 'nativeExecution', operation, input, owner: who, signal: new AbortController().signal })
  return { root, contracts, host, options, resolution, registry, owner, dispatch }
}

describe('native execution production composition', () => {
  it('requires explicit approved exact-version service declarations and groups trusted clients', async () => {
    const f = await fixture()
    const query = { packageName: '@test/native', version: '1.0.0', serviceId: 'nativeExecution' }
    expect(approvesHostService(f.contracts, query)).toBe(true)
    expect(approvesHostService(f.contracts, { ...query, version: '2.0.0' })).toBe(false)
    expect(f.resolution.resolveHostServiceClients('@test/native', '1.0.0', 1)[0]).toMatchObject({
      modulePath: '/trusted/native-execution-client.mjs', exportName: 'createNativeExecutionClients',
      provides: ['workingDirectory', 'sandboxPolicy', 'sandbox', 'subprocess', 'approval', 'commands']
    })
    for (const contract of [
      { ...f.contracts.get('@test/native@1.0.0')!, approved: false },
      { ...f.contracts.get('@test/native@1.0.0')!, dshAuthorization: { packageName: '@test/native', packageVersion: '1.0.0', dshRuntimeVersion: '1.0.0', hostServices: 'none' as const } },
      { ...f.contracts.get('@test/native@1.0.0')!, dshAuthorization: { packageName: '@test/native', packageVersion: '1.0.0', dshRuntimeVersion: '1.0.0' } }
    ]) {
      f.contracts.set('@test/native@1.0.0', contract)
      expect(f.resolution.resolveHostServiceClients('@test/native', '1.0.0', 1)).toEqual([])
    }
  })

  it('resolves newly installed approval from live authority and rejects revoked approval without startup fallback', async () => {
    const f = await fixture()
    const startupContracts = f.contracts
    const liveContracts = new Map<string, PluginAdapterContract>()
    let active = false
    const resolution = composeNativeExecutionHostServices({
      ...f.options,
      contracts: { get: key => active ? liveContracts.get(key) : startupContracts.get(key) }
    })
    active = true
    expect(resolution.resolveHostServiceClients('@test/native', '1.0.0', 1)).toEqual([])
    liveContracts.set('@test/native@1.0.0', startupContracts.get('@test/native@1.0.0')!)
    expect(resolution.resolveHostServiceClients('@test/native', '1.0.0', 2)).toHaveLength(1)
    const registry = new HostServiceProviderRegistry(resolution.resolveHostServiceProviders('@test/native', '1.0.0', 2)!)
    const dispatch = () => registry.dispatch({ requestId: 'request', serviceId: 'nativeExecution', operation: 'context.resolve', input: {}, owner: f.owner, signal: new AbortController().signal })
    expect(await dispatch()).toMatchObject({ policy: { mode: 'read-only' } })
    liveContracts.delete('@test/native@1.0.0')
    expect(resolution.resolveHostServiceClients('@test/native', '1.0.0', 3)).toEqual([])
    await expect(dispatch()).rejects.toThrow('not approved')
  })

  it('projects live host policy and child session while validating workspace and session provenance', async () => {
    const f = await fixture()
    expect(await f.dispatch('context.resolve')).toEqual({ workspaceRoot: f.root, policy: { mode: 'read-only', workspaceRoot: f.root, sessionId: 'child' } })
    expect(f.host.resolveCapabilitySandboxMode).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: 'dsh', threadId: 'thread', turnId: 'turn' }))
    await expect(f.dispatch('context.resolve', {}, { ...f.owner, authority: { ...f.owner.authority, originalContext: { runtimeId: 'dsh', threadId: 'spoofed' } } })).rejects.toThrow('provenance')
    f.options.authorizeWorkspace.mockResolvedValue(false)
    await expect(f.dispatch('context.resolve')).rejects.toThrow('not trusted')
  })

  it('forces human approval with canonical correlation and denies UI requests without agent context', async () => {
    const f = await fixture()
    expect(await f.dispatch('approval.request', { reason: 'Run worker', callId: 'untrusted-call', toolName: 'label' })).toBe('allowed-once')
    expect(f.host.requestCapabilityApproval).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'test.run', context: expect.objectContaining({ callId: 'call' }) }), expect.objectContaining({ forceHuman: true }))
    expect(await f.dispatch('approval.request', { reason: 'UI' }, { ...f.owner, authority: { ...f.owner.authority, originalContext: undefined } })).toBe('unavailable')
    expect(f.host.requestCapabilityApproval).toHaveBeenCalledTimes(1)
  })

  it('resolves trusted UI workspace policy without inventing an agent thread or human approval', async () => {
    const f = await fixture()
    const ui: HostServiceOwner = { ...f.owner, authority: {
      ...f.owner.authority,
      caller: { callerId: 'host-window', audience: 'ui', workspaceId: f.root },
      ordinarySession: { runtimeId: 'sciforge-ui', threadId: 'host-window' },
      originalContext: undefined,
      sessionId: undefined
    } }
    expect(await f.dispatch('context.resolve', {}, ui)).toEqual({ workspaceRoot: f.root, policy: { mode: 'workspace-write', workspaceRoot: f.root } })
    expect(f.host.readThreadSnapshot).not.toHaveBeenCalled()
    expect(f.host.resolveCapabilitySandboxMode).not.toHaveBeenCalled()
    expect(await f.dispatch('approval.request', { reason: 'Run' }, ui)).toBe('unavailable')
    expect(f.host.requestCapabilityApproval).not.toHaveBeenCalled()
    await expect(f.dispatch('context.resolve', {}, { ...ui, authority: { ...ui.authority, caller: { callerId: 'fake-agent', audience: 'agent', workspaceId: f.root } } })).rejects.toThrow('UI authority')
    f.options.authorizeWorkspace.mockResolvedValue(false)
    await expect(f.dispatch('context.resolve', {}, ui)).rejects.toThrow('not trusted')
  })

  it('preserves domain providers and rejects conflicting native provider composition', async () => {
    const f = await fixture()
    expect(await f.registry.dispatch({ requestId: 'request', serviceId: 'domain', operation: 'read', input: {}, owner: f.owner, signal: new AbortController().signal })).toBe('domain-result')
    const conflict = composeNativeExecutionHostServices({ ...f.options, domains: { ...f.options.domains, resolveHostServiceProviders: () => ({ nativeExecution: { authorize() {}, operations: {} } }) } })
    expect(() => conflict.resolveHostServiceProviders('@test/native', '1.0.0', 1)).toThrow('Conflicting')
  })
})
