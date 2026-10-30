import { it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HostServiceClientFactory, PluginAdapterContract } from '@sciforge/plugin-sdk'
import { CapabilityRegistry } from '../capabilities/registry'
import { CapabilityBroker } from '../capabilities/broker'
import { DevelopmentExternalPluginService } from './development-external-plugins'

async function fixture(initial = true, effect: 'read' | 'workspace-write' = 'read', authorize?: () => Promise<void>, name = 'neutral-read-consumer') {
  const root = await mkdtemp(join(tmpdir(), 'dynamic-host-clients-'))
  const plugin = join(root, 'plugins', 'consumer')
  await mkdir(plugin, { recursive: true })
  await writeFile(join(plugin, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: { '.': './main.mjs' }, dsh: { bundle: { patch: './patch.yml' } } }))
  await writeFile(join(plugin, 'patch.yml'), '[]')
  const clientPath = join(root, 'client.mjs')
  await writeFile(clientPath, `export function create(client) { return { read: () => client.request('inspect', 'read', {}).result } }`)
  await writeFile(join(plugin, 'main.mjs'), `
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
  for (const name of ['status', 'read']) ctx.tools.register(defineTool({ name, description: name, parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] }, execute: () => ctx.inspect.read() }))
}`)
  const contract: PluginAdapterContract = { hostApiRange: '^1', permissions: [], approved: true, dshAuthorization: { packageName: name, packageVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', tools: { status: { id: 'neutral.status', effect }, read: { id: 'neutral.read', effect } } } }
  const contracts = new Map([[`${name}@1.0.0`, contract]])
  let clients: readonly HostServiceClientFactory[] = initial ? [{ serviceId: 'inspect', modulePath: clientPath, exportName: 'create', config: {} }] : []
  const resolutions: string[] = []
  const deliveries: any[] = []
  const service = new DevelopmentExternalPluginService({ root: join(root, 'plugins'), userDataPath: join(root, 'profile'), hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts,
    resolveHostServiceClients: (packageName, version) => { resolutions.push(`${packageName}@${version}`); return packageName === name && version === '1.0.0' ? clients : [] },
    hostServiceProviders: { inspect: { authorize: async request => { request.assertCurrent?.(); await authorize?.() }, operations: { read: request => { deliveries.push(request); return request.owner.authority } } } } })
  const registry = new CapabilityRegistry()
  const broker = new CapabilityBroker(registry)
  const caller = { audience: 'agent' as const, callerId: 'canonical-caller', workspaceId: root, approvals: [] }
  const session = { runtimeId: 'canonical-runtime', threadId: 'canonical-thread' }
  const original = { ...session, callId: 'canonical-call', marker: { value: 'original' } }

  let sequence = 0
  const invoke = async (signal?: AbortSignal) => {
    const resource = effect === 'read' ? (await broker.invokeOrdinarySession(caller, { actionId: `${name}.dsh-session.open`, input: {} }, session)).output as { token: string; semanticRevision: string; expiresAt: string } : undefined
    return broker.invokeOrdinarySession(caller, { actionId: 'neutral.read', invocationId: `read-${++sequence}`, input: {}, ...(effect === 'read' ? { resource } : {}) }, session, { context: original, ...(signal ? { signal } : {}) })
  }
  return { service, registry, broker, contracts, contract, deliveries, resolutions, caller, session, original, invoke, setClients: (value: readonly HostServiceClientFactory[]) => { clients = value }, start: async () => { await service.initialize(); await service.attachCapabilityRegistry(registry); await service.setEnabled(name, true) }, close: async () => { await service.dispose(); await rm(root, { recursive: true, force: true }) } }
}

it.each(['@neutral/read-consumer', '@neutral-read/consumer', 'neutral--consumer', '@scope/' + 'x'.repeat(200), 'x'.repeat(200), 'package-deadbeef'])('opens a caller-bound resource for package %s without weakening grants', async name => {
  const f = await fixture(true, 'read', undefined, name)
  try {
    await f.start()
    const definitions = f.registry.list().filter(definition => definition.tags?.includes('dsh-session-opener'))
    expect(definitions).toHaveLength(1)
    const opened = await f.broker.invokeOrdinarySession(f.caller, { actionId: definitions[0]!.id, input: {} }, f.session)
    const resource = opened.output as { token: string; semanticRevision: string; expiresAt: string }
    await expect(f.broker.invokeOrdinarySession(f.caller, { actionId: 'neutral.read', input: {}, resource }, f.session)).resolves.toHaveProperty('output')
    const before = f.deliveries.length
    f.contracts.set(`${name}@1.0.0`, { ...f.contract, approved: false })
    await expect(f.broker.invokeOrdinarySession(f.caller, { actionId: definitions[0]!.id, input: {} }, f.session)).rejects.toThrow()
    expect(f.deliveries).toHaveLength(before)
  } finally { await f.close() }
})

it('opens a formally broker-issued dsh-session resource before invoking a read tool', async () => {
  const f = await fixture(true, 'read')
  try {
    await f.start()
    const open = f.registry.get('neutral-read-consumer.dsh-session.open')
    expect(open).toBeDefined()
    const opened = await f.broker.invokeOrdinarySession(f.caller, { actionId: 'neutral-read-consumer.dsh-session.open', input: {} }, f.session, { context: f.original })
    const resource = (opened.output as { token: string; semanticRevision: string; expiresAt: string })
    await expect(f.broker.invokeOrdinarySession(f.caller, { actionId: 'neutral.read', input: {}, resource }, f.session, { context: f.original })).resolves.toMatchObject({ output: { caller: expect.anything() } })
  } finally { await f.close() }
})

it.each(['read', 'workspace-write'] as const)('registers and invokes resolver-only %s tools through a real Cordis child with original Host authority', async effect => {
  const f = await fixture(true, effect)
  try {
    await f.start()
    expect(f.registry.get('neutral.status')).toBeDefined()
    expect(f.registry.get('neutral.read')).toBeDefined()
    const before = f.resolutions.length
    expect((await f.invoke()).output).toEqual({ caller: { ...f.caller, principalContextVersion: 0 }, capabilityId: 'neutral.read', effect, invocationId: 'read-1', ordinarySession: f.session, originalContext: f.original })
    // The opener checks composition once; the actual child invocation resolves
    // its current clients once independently (rather than per tool descriptor).
    expect(f.resolutions.length - before).toBe(effect === 'read' ? 2 : 1)
    expect(new Set(f.resolutions)).toEqual(new Set(['neutral-read-consumer@1.0.0']))
    expect(f.deliveries).toHaveLength(1)
    expect(typeof f.deliveries[0].assertCurrent).toBe('function')
    expect(Object.isFrozen(f.deliveries[0].owner.authority.originalContext.marker)).toBe(true)
    f.setClients([])
    await expect(f.invoke()).rejects.toMatchObject({ code: 'handler_failed' })
    expect(f.deliveries).toHaveLength(1)
  } finally { await f.close() }
})

it.each(['read', 'workspace-write'] as const)('does not treat a resolver function returning no clients as a %s grant', async effect => {
  const f = await fixture(false, effect)
  try {
    await f.start()
    expect(f.registry.get('neutral.read')).toBeUndefined()
    await expect(f.invoke()).rejects.toThrow()
    expect(f.deliveries).toHaveLength(0)
  } finally { await f.close() }
})

it.each(['read', 'workspace-write'] as const)('rejects malformed current client descriptors for %s without reaching the provider', async effect => {
  const f = await fixture(true, effect)
  try {
    await f.start()
    f.setClients([{ serviceId: 'inspect', modulePath: 'relative.mjs', exportName: 'create', config: {} }])
    await expect(f.invoke()).rejects.toMatchObject({ code: 'handler_failed' })
    expect(f.deliveries).toHaveLength(0)
  } finally { await f.close() }
})

it.each(['approved', 'packageName', 'packageVersion', 'dshRuntimeVersion'] as const)('rechecks current %s authorization before invoking a resolver-only tool', async field => {
  const f = await fixture()
  try {
    await f.start()
    f.contracts.set('neutral-read-consumer@1.0.0', field === 'approved'
      ? { ...f.contract, approved: false }
      : { ...f.contract, dshAuthorization: { ...f.contract.dshAuthorization!, [field]: 'revoked' } })
    await expect(f.invoke()).rejects.toThrow()
    expect(f.deliveries).toHaveLength(0)
  } finally { await f.close() }
})

it.each(['read', 'workspace-write'] as const)('retains cancellation fencing during asynchronous Host authorization for %s', async effect => {
  let entered!: () => void
  let release!: () => void
  const admitted = new Promise<void>(resolve => { entered = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  const f = await fixture(true, effect, async () => { entered(); await held })
  try {
    await f.start()
    const controller = new AbortController()
    const result = f.invoke(controller.signal).then(value => ({ value }), error => ({ error }))
    await admitted
    controller.abort()
    release()
    expect(await result).toHaveProperty('error')
    expect(f.deliveries).toHaveLength(0)
  } finally { release(); await f.close() }
})


it.each(['approved', 'packageName', 'packageVersion', 'dshRuntimeVersion', 'clients', 'tools'] as const)('rejects opening and observing after %s revocation without provider effects', async field => {
  const f = await fixture(true, 'read')
  try {
    await f.start()
    const request = { actionId: 'neutral-read-consumer.dsh-session.open', input: {} }
    const opened = await f.broker.invokeOrdinarySession(f.caller, request, f.session)
    const resource = opened.output as { token: string; semanticRevision: string; expiresAt: string }
    if (field === 'clients') f.setClients([])
    else f.contracts.set('neutral-read-consumer@1.0.0', field === 'approved'
      ? { ...f.contract, approved: false }
      : { ...f.contract, dshAuthorization: { ...f.contract.dshAuthorization!, [field]: field === 'tools' ? {} : 'revoked' } })
    await expect(f.broker.observe(f.caller, { resource })).rejects.toThrow()
    await expect(f.broker.invokeOrdinarySession(f.caller, request, { ...f.session, threadId: 'fresh' })).rejects.toThrow()
    await expect(f.broker.invokeOrdinarySession(f.caller, { actionId: 'neutral.read', input: {}, resource }, f.session)).rejects.toThrow()
    expect(f.deliveries).toHaveLength(0)
  } finally { await f.close() }
})

it.each(['session', 'runtime', 'workspace', 'caller', 'surface', 'forged', 'generation'] as const)('rejects %s resource reuse without provider effects', async field => {
  const f = await fixture(true, 'read')
  try {
    await f.start()
    const opened = await f.broker.invokeOrdinarySession(f.caller, { actionId: 'neutral-read-consumer.dsh-session.open', input: {} }, f.session)
    const resource = opened.output as { token: string; semanticRevision: string; expiresAt: string }
    const request = { actionId: 'neutral.read', input: {}, resource: field === 'forged' ? { ...resource, token: resource.token + 'forged' } : resource }
    if (field === 'generation') {
      await f.service.setEnabled('neutral-read-consumer', false)
      await f.service.setEnabled('neutral-read-consumer', true)
    }
    const caller = field === 'workspace' ? { ...f.caller, workspaceId: f.caller.workspaceId + '-other' } : field === 'caller' ? { ...f.caller, callerId: 'other' } : f.caller
    await expect(field === 'surface' ? f.broker.invoke(caller, request) : f.broker.invokeOrdinarySession(caller, request, field === 'session' ? { ...f.session, threadId: 'other' } : field === 'runtime' ? { ...f.session, runtimeId: 'other' } : f.session)).rejects.toThrow()
    expect(f.deliveries).toHaveLength(0)
    if (field === 'caller' || field === 'generation') await expect(f.broker.observe(caller, { resource })).rejects.toThrow()
    if (field === 'generation') {
      const fresh = await f.broker.invokeOrdinarySession(f.caller, { actionId: 'neutral-read-consumer.dsh-session.open', input: {} }, f.session)
      await expect(f.broker.invokeOrdinarySession(f.caller, { actionId: 'neutral.read', input: {}, resource: fresh.output as typeof resource }, f.session)).resolves.toMatchObject({ output: { effect: 'read' } })
      expect(f.deliveries).toHaveLength(1)
    }
  } finally { await f.close() }
})


it('advertises only currently approved registered read tools and permits repeated formal opens', async () => {
  const f = await fixture()
  try {
    await f.start()
    const request = { actionId: 'neutral-read-consumer.dsh-session.open', input: {} }
    await f.broker.invokeOrdinarySession(f.caller, request, f.session)
    const opened = await f.broker.invokeOrdinarySession(f.caller, request, f.session)
    const resource = opened.output as { token: string; semanticRevision: string; expiresAt: string }
    f.contracts.set('neutral-read-consumer@1.0.0', { ...f.contract, dshAuthorization: { ...f.contract.dshAuthorization!, tools: { read: { id: 'neutral.read', effect: 'read' }, unregistered: { id: 'not.registered', effect: 'read' } } } })
    const observation = await f.broker.observe(f.caller, { resource })
    expect(observation.operations.map(operation => operation.id)).toEqual(['neutral.read'])
    await expect(f.broker.invokeOrdinarySession(f.caller, { actionId: 'neutral.status', input: {}, resource }, f.session)).rejects.toThrow()
    expect(f.deliveries).toHaveLength(0)
    await expect(f.broker.invokeOrdinarySession(f.caller, { actionId: 'neutral.read', input: {}, resource }, f.session)).resolves.toMatchObject({ output: { effect: 'read' } })
    expect(f.deliveries).toHaveLength(1)
  } finally { await f.close() }
})

it('requires the authenticated ordinary session and workspace for the formal opener', async () => {
  const f = await fixture()
  try {
    await f.start()
    const request = { actionId: 'neutral-read-consumer.dsh-session.open', input: {} }
    await expect(f.broker.invoke(f.caller, request)).rejects.toThrow()
    await expect(f.broker.invokeOrdinarySession({ ...f.caller, workspaceId: undefined }, request, f.session)).rejects.toThrow()
    expect(f.deliveries).toHaveLength(0)
  } finally { await f.close() }
})
