import { it, expect, vi } from 'vitest'
import { syncBuiltinESMExports } from 'node:module'
import childProcess, { type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CapabilityRegistry } from '../../../src/main/capabilities/registry'
import { CapabilityBroker } from '../../../src/main/capabilities/broker'
import { DevelopmentExternalPluginService } from '../../../src/main/extensions/development-external-plugins'
import { createEvidenceProductionService } from '@sciforge/domain-evidence-dag/host/production-service'
import { EvidenceDagDeltaStore, evidenceDagDeltaInputFromTrace, evidenceDagCommittedSnapshotSchema } from '../src/core'
import { workerOptions } from './worker-fixture'
const posixTest = process.platform === 'win32' ? it.skip : it

async function until(check: () => boolean, message: string) {
  const end = Date.now() + 5000
  while (!check()) {
    if (Date.now() > end) throw Error(message)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

// Component inputs, not Electron/model acceptance. Real Broker admission, issued
// resource, public DevelopmentExternalPluginService, ProcessExtensionHost/Cordis
// child, production provider, descriptor reader and packaged Python snapshot code.
// A Python audit hook stops the real reader at its actual open boundary. Only the
// owned child's kill is held by the harness, making the pending-before-exit
// assertion deterministic. No reader/provider output or exit event is fabricated.
posixTest.each(['chain', 'snapshot'] as const)('Broker cancellation joins live production committed %s reader PID', async stage => {
  const opts = await workerOptions()
  const root = await mkdtemp(join(tmpdir(), 'committed-broker-cancel-'))
  const name = 'neutral-cancel-reader', version = '1.0.0'
  const plugin = join(root, 'plugins', name), state = join(root, 'state')
  await mkdir(plugin, { recursive: true }); await mkdir(state)
  await writeFile(join(plugin, 'package.json'), JSON.stringify({ name, version, type: 'module', exports: { '.': './main.mjs' }, dsh: { bundle: { patch: './patch.yml' } } }))
  await writeFile(join(plugin, 'patch.yml'), '[]')
  await writeFile(join(plugin, 'main.mjs'), `export * from ${JSON.stringify(pathToFileURL(join(opts.release, 'main.mjs')).href)}`)
  const scope = { runtimeId: 'r', threadId: 't', workspaceRoot: root }
  const store = new EvidenceDagDeltaStore(join(state, 'deltas.json'))
  const delta = evidenceDagDeltaInputFromTrace({ ...scope, threadId: 'r:t', operationId: 'one', idempotencyKey: 'cancel-one', kind: 'manual', requestedWatermark: '1', trace: [] })
  const appended = await store.append({ ...delta, payload: { ...delta.payload, claims: [{ id: 'claim-1', text: 'Controlled component input.' }] } })
  const closure = await store.seal('r:t', { version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim-1'], expectedHeadDigest: appended.delta.deltaDigest, barrierWatermark: '1', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] })
  const producer = createEvidenceProductionService({ identity: { pluginId: name, version, profileId: root }, storageRoot: state, worker: opts, clientModule: 'unused', threads: {} as any, artifacts: {} as any })
  try {
    const produced = await producer.worker.request('commitSnapshot', { threadId: 'r:t', workspaceRoot: root, trace: [], targetWatermark: '1', idempotencyKey: 'cancel-one' })
    const snapshot = evidenceDagCommittedSnapshotSchema.parse(Object.fromEntries(Object.keys(evidenceDagCommittedSnapshotSchema.shape).map(k => [k, produced.snapshot[k]])))
    await store.recordCommittedSnapshot('r:t', snapshot, closure.closureDigest)
  } finally { await producer.close() }

  const executable = join(root, 'audited-python'), marker = join(root, 'reader.json'), hold = join(root, 'hold')
  await writeFile(executable, `#!${opts.executable}
import os,sys,json,signal
args=sys.argv[1:]
assert args[:3]==['-I','-B','-c']
def audit(event, values):
 if event=='open' and isinstance(values[0],str) and os.path.exists(${JSON.stringify(hold)}):
  path=values[0]
  if (${JSON.stringify(stage)}=='chain' and path=='deltas.json') or (${JSON.stringify(stage)}=='snapshot' and path.endswith('.prov.json')):
   with open(${JSON.stringify(marker)},'w') as out: json.dump({'pid':os.getpid(),'path':path},out)
   os.kill(os.getpid(),signal.SIGSTOP)
sys.addaudithook(audit)
sys.argv=['-c']+args[4:]
exec(compile(args[3],'<production-committed-reader>','exec'))
`)
  await chmod(executable, 0o700)
  const production = createEvidenceProductionService({ identity: { pluginId: name, version, profileId: root }, storageRoot: state, storageInterpreter: executable, worker: opts, clientModule: join(opts.release, 'host-provider.mjs'),
    threads: { read: async requested => ({ ...requested, watermark: '0', trace: [] }), list: async () => [] }, artifacts: { invoke: async () => { throw Error('no effects') } } })
  const base = production.providers.evidenceDagPorts
  const events: string[] = []
  let admitted: any, deliveries = 0
  const contracts = new Map([[`${name}@${version}`, { hostApiRange: '^1', permissions: [], approved: true, dshAuthorization: { packageName: name, packageVersion: version, dshRuntimeVersion: '0.2.0-rc.2', tools: {
    evidence_dag_snapshot_status: { id: 'neutral.status', effect: 'read', readResource: 'workspace' },
    evidence_dag_update: { id: 'neutral.update', effect: 'workspace-write' }, evidence_dag_seal_closure: { id: 'neutral.seal', effect: 'workspace-write' },
    evidence_dag_append_sidechain: { id: 'neutral.append', effect: 'workspace-write' }, evidence_dag_export_snapshot_products: { id: 'neutral.export', effect: 'workspace-write' }, evidence_dag_poll_artifact_events: { id: 'neutral.poll', effect: 'workspace-write' },
  } } }]])
  const registry = new CapabilityRegistry(), broker = new CapabilityBroker(registry)
  const service = new DevelopmentExternalPluginService({ root: join(root, 'plugins'), userDataPath: join(root, 'profile'), hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts as any,
    hostServiceClients: new Map([[name, production.clients]]), hostServiceProviders: { evidenceDagPorts: { ...base, authorize: r => base.authorize(r), operations: { ...base.operations, 'committed.status': async request => {
      deliveries++; admitted = request
      try { return await base.operations['committed.status'](request) }
      finally { events.push('provider-settled') }
    } } } } })
  const spawn = childProcess.spawn
  let reader: ChildProcess | undefined, releaseKill: (() => void) | undefined, killRequested = false
  const spy = vi.spyOn(childProcess, 'spawn').mockImplementation(((...args: Parameters<typeof spawn>) => {
    const child = spawn(...args)
    const script = Array.isArray(args[1]) ? args[1][3] : undefined
    const target = stage === 'chain' ? script?.includes("os.open('deltas.json'") : script?.includes('from evidence_dag.committed_reader import main')
    if (args[0] === executable && existsSync(hold) && target) {
      const kill = child.kill.bind(child)
      child.kill = signal => {
        killRequested = true
        releaseKill = () => { kill(signal) }
        return true
      }
      child.once('close', () => events.push('reader-close'))
      reader = child
    }
    return child
  }) as typeof spawn)
  syncBuiltinESMExports()
  let pending: Promise<unknown> | undefined
  try {
    await service.initialize(); await service.attachCapabilityRegistry(registry); await service.setEnabled(name, true)
    const caller = { callerId: 'cancel-component', workspaceId: root }
    const opened = await broker.invokeHostSystem(caller, { actionId: 'neutral.status.open', input: {} })
    const resource = opened.output as any
    await expect(broker.invokeHostSystem(caller, { actionId: 'neutral.status', input: scope, resource })).resolves.toMatchObject({ output: { committed: { threadId: 'r:t' } } })
    expect(production.worker.pid).toBeUndefined()
    events.length = 0
    await writeFile(hold, 'hold at real production open')
    const control = new AbortController()
    let settled = false
    pending = broker.invokeHostSystem(caller, { actionId: 'neutral.status', input: scope, resource }, { signal: control.signal })
    void pending.then(() => { settled = true; events.push('broker-resolved') }, () => { settled = true; events.push('broker-rejected') })
    await until(() => existsSync(marker), 'real production reader did not reach open')
    const observed = JSON.parse(await readFile(marker, 'utf8'))
    expect(reader?.pid).toBe(observed.pid)
    expect(observed.path).toMatch(stage === 'chain' ? /^deltas\.json$/ : /\.prov\.json$/)
    process.kill(observed.pid, 0)
    expect(admitted.owner).toMatchObject({ packageName: name, version, authority: { effect: 'read', resource: { resourceKind: 'dsh-workspace' } } })
    expect(admitted.owner.invocationId).toBeTruthy()
    control.abort()
    await until(() => killRequested, 'cancellation did not reach owned production reader kill')
    expect(admitted.signal.aborted).toBe(true)
    expect(() => admitted.signal.throwIfAborted()).toThrow()
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(settled, 'Broker must stay pending while actual reader PID remains alive').toBe(false)
    process.kill(observed.pid, 0)
    expect(events).toEqual([])
    releaseKill!()
    await expect(pending).rejects.toMatchObject({ code: 'invocation_cancelled' })
    expect(() => process.kill(observed.pid, 0)).toThrow()
    expect(events).toEqual(['reader-close', 'provider-settled', 'broker-rejected'])
    // Preserve fail-closed authority after the timing repair.
    const delivered = deliveries
    await expect(broker.invokeHostSystem({ ...caller, callerId: 'foreign' }, { actionId: 'neutral.status', input: scope, resource })).rejects.toThrow()
    await expect(broker.invokeHostSystem(caller, { actionId: 'neutral.status', input: scope })).rejects.toMatchObject({ code: 'resource_required' })
    contracts.get(`${name}@${version}`)!.approved = false
    await expect(broker.invokeHostSystem(caller, { actionId: 'neutral.status', input: scope, resource })).rejects.toThrow()
    expect(deliveries).toBe(delivered)
    console.log(JSON.stringify({ stage, readerPid: observed.pid, openedPath: observed.path, events, deliveries, componentFixture: true, electron: false }))
  } finally {
    releaseKill?.()
    if (reader?.pid) { try { process.kill(reader.pid, 'SIGKILL') } catch { /* child may have exited */ } }
    if (pending) await Promise.allSettled([pending])
    spy.mockRestore()
    syncBuiltinESMExports()
    await service.dispose(); await production.close()
    await rm(root, { recursive: true, force: true }); await rm(opts.root, { recursive: true, force: true })
  }
}, 120000)
