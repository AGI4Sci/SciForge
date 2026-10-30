import { it, expect } from 'vitest'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { workerOptions, syntheticReasoner } from './worker-fixture.js'
import { artifactFixture } from './artifact-fixture.js'
import { createEvidenceProductionService } from '@sciforge/domain-evidence-dag/host/production-service'
import { DevelopmentExternalPluginService } from '../../../src/main/extensions/development-external-plugins'
import { CapabilityRegistry } from '../../../src/main/capabilities/registry'
import { CapabilityBroker } from '../../../src/main/capabilities/broker'
import { createRuntimeCapabilityBroker } from '../../../src/main/runtime/agent-runtime/runtime-capability-broker'

it('production cancellation does not settle before the real reasoner and worker are quiescent', async () => {
  const opts = await workerOptions()
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(r => { enter = r }), released = new Promise<void>(r => { release = r })
  const scope = { runtimeId: 'r', threadId: 't', workspaceRoot: join(opts.root, 'workspace') }
  const identity = { pluginId: 'p', version: '1', profileId: 'profile' }
  const { createEvidenceProductionService } = await import('@sciforge/domain-evidence-dag/host/production-service')
  const production = createEvidenceProductionService({ identity, storageRoot: join(opts.root, 'state'), clientModule: 'unused',
    worker: { ...opts, closeTimeoutMs: 10, reasoner: async () => { enter(); await released; return '{}' } },
    threads: { read: async () => { throw new Error('unused') }, list: async () => [] }, artifacts: { invoke: async () => { throw new Error('unused') } } })
  const abort = new AbortController()
  const operation = 'sidecar.commitSnapshot'
  let settled = false
  const work = production.providers.evidenceDagPorts.operations[operation]({ requestId: 'request', serviceId: 'evidenceDagPorts', operation,
    input: { protocol: 'sciforge-evidence-ports.v1', identity, operation, scope, input: { threadId: 'r:t', workspaceRoot: scope.workspaceRoot, trace: [{ id: 'm', type: 'message', content: 'Synthetic.' }], targetWatermark: '1', idempotencyKey: 'cancel' } },
    owner: { connectionId: 'connection', pluginId: 'p', packageName: 'p', version: '1', generation: 1, invocationId: 'invocation', authority: { effect: 'workspace-write', caller: { principalId: 'real-test-principal', workspaceId: scope.workspaceRoot }, ordinarySession: scope } },
    assertCurrent() {}, signal: abort.signal })
  const result = Promise.resolve(work).then(() => { settled = true }, () => { settled = true })
  try {
    await entered; abort.abort()
    let closed = false
    const closing = production.close().then(() => { closed = true })
    await new Promise(r => setTimeout(r, 50))
    const settledBeforeReasoner = settled, closedBeforeReasoner = closed
    release(); await result; await closing
    expect(settledBeforeReasoner).toBe(false)
    expect(closedBeforeReasoner).toBe(false)
  } finally { release(); await production.close() }
})

it.each(['threads.read', 'artifacts.commit'] as const)('cancelling invocation-owned %s preserves generation for nonempty update and seal through Broker, real runner, Artifact Versions and formal wheel', async cancelledOperation => {
  const opts = await workerOptions(), f = await artifactFixture()
  const packageName = '@sciforge/plugin-evidence-dag'
  const plugin = join(opts.root, 'plugins', 'evidence-dag')
  await mkdir(plugin, { recursive: true })
  await writeFile(join(plugin, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0', type: 'module', exports: { '.': join(opts.release, 'main.mjs') }, engines: { dsh: '>=0.2.0-rc.2 <0.3.0' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  // Export paths must be package-relative; the generation owns its actual compiled entry.
  await writeFile(join(plugin, 'main.mjs'), `export * from ${JSON.stringify(pathToFileURL(join(opts.release, 'main.mjs')).href)}`)
  const manifest = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8')); manifest.exports['.'] = './main.mjs'
  await writeFile(join(plugin, 'package.json'), JSON.stringify(manifest)); await writeFile(join(plugin, 'cordis.patch.yml'), '')
  const observed: string[] = []
  let watermark = '7'
  let holdCallback = true, enterRead!: () => void, releaseRead!: () => void
  const readEntered = new Promise<void>(resolve => { enterRead = resolve })
  const readReleased = new Promise<void>(resolve => { releaseRead = resolve })
  const production = createEvidenceProductionService({ identity: { ...f.ports.identity, pluginId: packageName }, storageRoot: f.ports.storageRoot,
    clientModule: join(opts.release, 'host-provider.mjs'), worker: { ...opts, reasoner: async (i, signal) => { signal.throwIfAborted(); return (await syntheticReasoner(i)).replaceAll('t1', 'claim-1') } },
    threads: { read: async (scope, context) => { context.assertCurrent(); observed.push('threads.read'); if (holdCallback && cancelledOperation === 'threads.read') { enterRead(); await readReleased; context.assertCurrent() }; return { ...scope, watermark, trace: f.trace } }, list: async (scope, context) => { context.assertCurrent(); return [scope] } },
    artifacts: { invoke: async (operation, scope, input, context) => {
      context.assertCurrent(); observed.push(operation)
      if (holdCallback && operation === cancelledOperation) { enterRead(); await readReleased; context.assertCurrent() }
      // Real canonical artifact service; authority is inherited, never elevated to system.
      const access = context.caller as any
      if (operation === 'artifacts.commit') { const result = await f.service.commit(scope.workspaceRoot, input as any, access); if (result.ok) (f.trace[0].artifact as any).artifactVersionRef = result.value.versions[0].ref; return result }
      if (operation === 'artifacts.read') return f.service.read(scope.workspaceRoot, input as any, access)
      return f.service.listEvents(scope.workspaceRoot, input as any, access)
    } },
  })
  const tools = Object.fromEntries(['update', 'snapshot_status', 'seal_closure', 'append_sidechain', 'export_snapshot_products', 'poll_artifact_events'].map(name => [`evidence_dag_${name}`, { id: `evidence.${name.replaceAll('_', '-')}`, effect: name === 'snapshot_status' ? 'read' as const : 'workspace-write' as const }]))
  const service = new DevelopmentExternalPluginService({ root: join(opts.root, 'plugins'), userDataPath: join(opts.root, 'profile'), hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map([[packageName, { hostApiRange: '^1', approved: true, permissions: [], dshAuthorization: { packageName, packageVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', tools } }]]),
    hostServiceProviders: production.providers, hostServiceClients: new Map([[packageName, production.clients]]) })
  try {
    await service.initialize(); const registry = new CapabilityRegistry(); await service.attachCapabilityRegistry(registry); await service.setEnabled(packageName, true)
    const broker = new CapabilityBroker(registry)
    const caller = { audience: 'agent' as const, callerId: 'evidence-production-component', workspaceId: f.scope.workspaceRoot, approvals: [] }
    const session = { runtimeId: f.scope.runtimeId, threadId: f.scope.threadId }
    const runtime = createRuntimeCapabilityBroker({ broker, managedTools: {} as never, assertOrdinarySessionAccess(boundCaller, boundSession) { expect(boundCaller.workspaceId).toBe(f.scope.workspaceRoot); expect(boundSession).toEqual(session) } })
    let counter = 0
    const invoke = async (name: string, input: any, signal?: AbortSignal) => (await runtime.invoke(caller, { actionId: `evidence.${name}`, invocationId: `invoke-${++counter}`, input }, { signal, context: { ...session, requestId: `public-call-${counter}` } })).output as any
    const cancellation = new AbortController()
    let rejected = false
    const cancelled = invoke('update', f.scope, cancellation.signal).then(() => { throw Error('cancelled update fulfilled') }, error => { rejected = true; return error })
    await Promise.race([readEntered, cancelled.then(error => { throw error })])
    cancellation.abort()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(rejected, 'invocation cancellation must join its held Host callback').toBe(false)
    expect(production.worker.pid).toBeUndefined()
    holdCallback = false; releaseRead()
    expect(await cancelled).toMatchObject({ code: 'invocation_cancelled' })
    const update = await invoke('update', f.scope)
    expect(update.itemCount).toBeGreaterThan(0)
    const head = update.status.authoritativeHead.headDigest
    const claims = update.status.provisional.lastGood.claims
    expect(claims.length).toBeGreaterThan(0)
    const targetClaimIds = claims.map((claim: any) => claim.id)
    const seal = await invoke('seal-closure', { ...f.scope, idempotencyKey: 'production-seal', policy: { version: 'EvidenceClosurePolicyV1', targetClaimIds, expectedHeadDigest: head, barrierWatermark: '7', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] } })
    expect(seal.status).toBe('complete')
    expect(production.worker.pid).toBeGreaterThan(0)
    watermark = '8'
    await invoke('update', f.scope)
    expect(observed).toContain('artifacts.commit'); expect(observed).toContain('artifacts.read')
    const disk = JSON.parse(await readFile(join(f.ports.storageRoot, 'deltas.json'), 'utf8'))
    expect(JSON.stringify(disk)).toContain('production-seal')
    console.info('REAL_CHAIN', JSON.stringify({ itemCount: update.itemCount, sealStatus: seal.status, pythonPid: production.worker.pid, canonicalOperations: [...new Set(observed)], formalWheelSha256: opts.wheelSha256 }))
    // A forged thread does not reach canonical effects.
    const before = observed.length
    await expect(invoke('update', { ...f.scope, threadId: 'forged-thread' })).rejects.toThrow()
    expect(observed.length).toBe(before)
  } finally { releaseRead(); await service.dispose(); await production.close() }
  expect(() => process.kill(production.worker.pid!, 0)).toThrow()
}, 120000)
