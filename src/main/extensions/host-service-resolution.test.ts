import { describe, expect, it } from 'vitest'
import type { HostServiceClientFactory, HostServiceProvider, PluginAdapterContract } from '@sciforge/plugin-sdk'
import { createReadGrantedHostServicePorts, mergeHostServiceResolutions, type HostServiceResolution } from './host-service-resolution'

const provider: HostServiceProvider = { authorize: () => undefined, operations: { read: async () => ({}) } }
function resolution(ids: readonly string[], providers: Readonly<Record<string, HostServiceProvider>> | undefined): HostServiceResolution {
  return {
    hostServiceIds: ids,
    resolveHostServiceProviders: () => providers,
    resolveHostServiceClients: () => ids.map(serviceId => ({ serviceId, modulePath: '/host/client.mjs', exportName: 'createHostServiceClient', config: {} }))
  }
}
function contract(packageName = 'ordinary-consumer', packageVersion = '1.0.0'): PluginAdapterContract {
  return { approved: true, hostApiRange: '^1', permissions: [], dshAuthorization: { packageName, packageVersion, dshRuntimeVersion: '0.2.0-rc.2', ports: ['agent-threads.read', 'artifacts.read'] } }
}

describe('generic Host service resolution merge', () => {
  it('merges every provider and client by service id for the same exact identity', () => {
    const calls: unknown[] = []
    const domain = resolution(['artifact-versions'], { 'artifact-versions': provider })
    const threads = {
      serviceIds: ['agentThreads'],
      resolve(...identity: [string, string, number]) { calls.push(identity); return { agentThreads: provider } },
      resolveClients(...identity: [string, string, number]): readonly HostServiceClientFactory[] { calls.push(identity); return [{ serviceId: 'agentThreads', modulePath: '/host/client.mjs', exportName: 'createHostServiceClient', config: {} }] }
    }
    const merged = mergeHostServiceResolutions(resolution([], undefined), domain, threads)
    expect(merged.resolveHostServiceProviders('ordinary-consumer', '1.0.0', 7)).toEqual({ 'artifact-versions': provider, agentThreads: provider })
    expect(merged.resolveHostServiceClients('ordinary-consumer', '1.0.0', 7).map(client => client.serviceId)).toEqual(['artifact-versions', 'agentThreads'])
    expect(merged.hostServiceIds).toEqual(['artifact-versions', 'agentThreads'])
    expect(calls).toEqual([['ordinary-consumer', '1.0.0', 7], ['ordinary-consumer', '1.0.0', 7]])
  })

  it('returns no provider and an empty immutable client collection without grants', () => {
    const merged = mergeHostServiceResolutions(resolution([], undefined))
    expect(merged.resolveHostServiceProviders('ordinary-consumer', '1.0.0', 1)).toBeUndefined()
    expect(merged.resolveHostServiceClients('ordinary-consumer', '1.0.0', 1)).toEqual([])
    expect(Object.isFrozen(merged.hostServiceIds)).toBe(true)
  })

  it('rejects duplicate providers even when they reference the same implementation', () => {
    const input = resolution(['agentThreads'], { agentThreads: provider })
    expect(() => mergeHostServiceResolutions(input, input).resolveHostServiceProviders('ordinary-consumer', '1.0.0', 1)).toThrow('Conflicting Host service provider: agentThreads')
  })

  it('rejects duplicate client ids instead of silently replacing or concatenating them', () => {
    const input = resolution(['agentThreads'], undefined)
    expect(() => mergeHostServiceResolutions(input, input).resolveHostServiceClients('ordinary-consumer', '1.0.0', 1)).toThrow('Conflicting Host service client: agentThreads')
  })

  it('merges reserved-looking ids as own data rather than object prototype properties', () => {
    const input = resolution(['__proto__'], Object.fromEntries([['__proto__', provider]]))
    const providers = mergeHostServiceResolutions(input).resolveHostServiceProviders('ordinary-consumer', '1.0.0', 1)!
    expect(Object.hasOwn(providers, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(providers)).toBeNull()
  })
})

describe('live Host-approved service ports', () => {
  const identity = { packageName: 'ordinary-consumer', version: '1.0.0', generation: 7 }
  it('reads replacement contract views and revocation without caching or a generation counter', () => {
    let contracts: ReadonlyMap<string, PluginAdapterContract> | undefined
    const read = createReadGrantedHostServicePorts(() => contracts)
    expect(read(identity)).toBeUndefined()
    contracts = new Map([['ordinary-consumer@1.0.0', contract()]])
    expect(read(identity)).toEqual(['agent-threads.read', 'artifacts.read'])
    contracts = new Map([['ordinary-consumer@1.0.0', { ...contract(), approved: false }]])
    expect(read(identity)).toBeUndefined()
  })

  it.each([
    contract('foreign-package'), contract('ordinary-consumer', '2.0.0'),
    { ...contract(), approved: false }, { ...contract(), dshAuthorization: undefined }
  ])('rejects mismatched or unapproved declarations', input => {
    const read = createReadGrantedHostServicePorts(() => new Map([['ordinary-consumer@1.0.0', input]]))
    expect(read(identity)).toBeUndefined()
  })

  it('uses exact-version precedence and validates package-key declarations identically', () => {
    const contracts = new Map([['ordinary-consumer', contract()], ['ordinary-consumer@1.0.0', contract('foreign-package')]])
    const read = createReadGrantedHostServicePorts(() => contracts)
    expect(read(identity)).toBeUndefined()
    contracts.delete('ordinary-consumer@1.0.0')
    expect(read(identity)).toEqual(['agent-threads.read', 'artifacts.read'])
    expect(read({ ...identity, version: '2.0.0' })).toBeUndefined()
  })
})
