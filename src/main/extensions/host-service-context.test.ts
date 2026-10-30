import { it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapabilityRegistry } from '../capabilities/registry'
import { CapabilityBroker } from '../capabilities/broker'
import { DevelopmentExternalPluginService } from './development-external-plugins'

it('carries canonical ordinary Session and original Broker context to a real runner Host service', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canonical-service-'))
  const packageName = 'neutral-context-consumer'
  const plugin = join(root, 'plugins', packageName)
  await mkdir(plugin, { recursive: true })
  await writeFile(join(plugin, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0', type: 'module', exports: { '.': './main.mjs' }, engines: { dsh: '>=0.2.0-rc.2 <0.3.0' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(join(plugin, 'cordis.patch.yml'), '')
  const descriptor = { contractVersion: 3, id: 'neutral.context', version: '1', title: 'Context', description: 'Canonical context.', audiences: ['agent'], scope: 'workspace', resourceKinds: [], effect: 'read', approval: 'none', concurrency: { revision: 'none', idempotency: 'none' }, inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, tags: [] }
  await writeFile(join(plugin, 'main.mjs'), `export function getCapabilityDefinitions() { return [{descriptor: ${JSON.stringify(descriptor)}, handler: async () => ({output: await globalThis.__sciforgeHostServices.request('inspect', 'read', {}).result})}] }`)
  let delivered: any
  const service = new DevelopmentExternalPluginService({ root: join(root, 'plugins'), userDataPath: join(root, 'profile'), hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: new Map([[packageName, { hostApiRange: '^1', permissions: [], approved: true }]]),
    hostServiceProviders: { inspect: { authorize: () => {}, operations: { read: request => { delivered = request; request.assertCurrent?.(); return request.owner.authority } } } } })
  try {
    await service.initialize()
    const registry = new CapabilityRegistry()
    await service.attachCapabilityRegistry(registry)
    await service.setEnabled(packageName, true)
    const broker = new CapabilityBroker(registry)
    const caller = { audience: 'agent' as const, callerId: 'canonical-caller', workspaceId: root, approvals: [] }
    const session = { runtimeId: 'canonical-runtime', threadId: 'canonical-thread' }
    const original = { ...session, callId: 'canonical-call', marker: { value: 'original' } }
    const result = await broker.invokeOrdinarySession(caller, { actionId: 'neutral.context', invocationId: 'canonical-invocation', input: {} }, session, { context: original })
    expect(result.output).toEqual({ caller: { ...caller, principalContextVersion: 0 }, capabilityId: 'neutral.context', effect: 'read', invocationId: 'canonical-invocation', ordinarySession: session, originalContext: original })
    expect(typeof delivered.assertCurrent).toBe('function')
    expect(Object.isFrozen(delivered.owner.authority.originalContext.marker)).toBe(true)
    expect(delivered.owner.authority.ordinarySession).not.toHaveProperty('sessionId')
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }) }
})
