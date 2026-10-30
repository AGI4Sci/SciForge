import { it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, chmod, stat, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { execFileSync } from 'node:child_process'
import { readCommittedSnapshot } from '@sciforge/domain-evidence-dag/host/committed-reader'
import { EvidenceDagDeltaStore, evidenceDagDeltaInputFromTrace } from '../src/core.js'
import { createEvidenceProductionService } from '@sciforge/domain-evidence-dag/host/production-service'
import { workerOptions } from './worker-fixture.js'


it('cold production status reads exact committed closure without ordinary Session or storage mutation (controlled reasoner component)', async () => {
  const opts = await workerOptions()
  const root = await mkdtemp(join(tmpdir(), 'committed-consumer-'))
  await mkdir(join(root, 'state'))
  const storageRoot = join(root, 'state'), file = join(storageRoot, 'deltas.json')
  const scope = { runtimeId: 'r', threadId: 't', workspaceRoot: join(root, 'workspace') }
  const identity = { pluginId: 'p', version: '1', profileId: 'profile' }
  const options = { identity, storageRoot, storageInterpreter: opts.executable, clientModule: 'unused', worker: opts,
    threads: { read: async (requested: typeof scope, context: any) => { expect(context.ordinarySession).toBeUndefined(); context.assertCurrent(); if (JSON.stringify(requested) !== JSON.stringify(scope)) throw new Error('unauthorized thread'); return { ...scope, watermark: '1', trace: [] } }, list: async () => [] },
    artifacts: { invoke: async () => { throw new Error('no artifact effect permitted') } } }
  // Real formal-wheel producer, controlled reasoning; not model/UI acceptance.
  const producer = createEvidenceProductionService(options)
  const store = new EvidenceDagDeltaStore(file)
  const delta = evidenceDagDeltaInputFromTrace({ ...scope, threadId: 'r:t', operationId: 'one', idempotencyKey: 'committed-one', kind: 'manual', requestedWatermark: '1', trace: [] })
  const appended = await store.append({ ...delta, payload: { ...delta.payload, claims: [{ id: 'claim-1', text: 'Synthetic.' }] } })
  const closure = await store.seal('r:t', { version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim-1'], expectedHeadDigest: appended.delta.deltaDigest, barrierWatermark: '1', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] })
  expect(closure.status).toBe('complete')
  const result = await producer.worker.request('commitSnapshot', { threadId: 'r:t', workspaceRoot: scope.workspaceRoot, trace: [], targetWatermark: '1', idempotencyKey: 'committed-one' })
  const { evidenceDagCommittedSnapshotSchema } = await import('../src/core.js')
  const snapshot = evidenceDagCommittedSnapshotSchema.parse(Object.fromEntries(Object.keys(evidenceDagCommittedSnapshotSchema.shape).map(k => [k, result.snapshot[k]])))
  await store.recordCommittedSnapshot('r:t', snapshot, closure.closureDigest)
  await producer.close()
  const cold = createEvidenceProductionService(options)
  const operation = 'committed.status'
  const request = { requestId: 'read', serviceId: 'evidenceDagPorts', operation, input: { protocol: 'sciforge-evidence-ports.v1', identity, operation, scope, input: {} },
    owner: { connectionId: 'c', pluginId: 'p', packageName: 'p', version: '1', generation: 1, invocationId: 'read', authority: { effect: 'read', caller: { workspaceId: scope.workspaceRoot } } }, assertCurrent() {}, signal: new AbortController().signal }
  try {
    await chmod(storageRoot, 0o750); await chmod(file, 0o640)
    await chmod(opts.storageRoot, 0o750)
    const pythonBefore = await stat(opts.storageRoot)
    const bytes = await readFile(file), before = await stat(file), rootBefore = await stat(storageRoot)
    // Provider component only; the Project/Broker/packaged Cordis path is in committed-broker.test.ts.
    const read = await cold.providers.evidenceDagPorts.operations[operation](request as any) as any
    const after = await stat(file), rootAfter = await stat(storageRoot)
    expect(read.committed).toEqual(snapshot)
    expect(read.provisional).toBeNull()
    expect((await stat(opts.storageRoot)).mode).toBe(pythonBefore.mode)
    expect(cold.worker.pid).toBeUndefined()
    expect([after.mode, after.ino, after.size, after.mtimeMs, after.ctimeMs]).toEqual([before.mode, before.ino, before.size, before.mtimeMs, before.ctimeMs])
    expect([rootAfter.mode, rootAfter.ino, rootAfter.mtimeMs, rootAfter.ctimeMs]).toEqual([rootBefore.mode, rootBefore.ino, rootBefore.mtimeMs, rootBefore.ctimeMs])
    expect(await readFile(file)).toEqual(bytes)
    // Post-fix controls, not original RED: exact metadata, denial and immutable history.
    const data = JSON.parse(bytes.toString())
    data.chains[0].committedSnapshot.createdAt = '2000-01-01T00:00:00Z'
    await writeFile(file, JSON.stringify(data))
    await expect(cold.providers.evidenceDagPorts.operations[operation](request as any)).rejects.toThrow()
    await writeFile(file, bytes)
    const aborted = new AbortController(); aborted.abort()
    await expect(cold.providers.evidenceDagPorts.operations[operation]({ ...request, signal: aborted.signal } as any)).rejects.toThrow()
    const latest = (await readdir(join(opts.storageRoot, 'snapshots')))[0] + '.prov.json'
    await writeFile(join(opts.storageRoot, latest), 'invalid mutable latest')
    expect((await cold.providers.evidenceDagPorts.operations[operation](request as any) as any).committed).toEqual(snapshot)

    await expect(cold.providers.evidenceDagPorts.operations[operation]({ ...request, input: { ...request.input, scope: { ...scope, workspaceRoot: '/foreign' } } } as any)).rejects.toThrow()
  } finally { await cold.close(); await rm(root, { recursive: true, force: true }); await rm(opts.root, { recursive: true, force: true }) }
}, 120000)

it('formal-wheel readonly helper rejects private artifacts under public scope without returning hidden data (post-fix control)', async () => {
  const opts = await workerOptions()
  try {
    const script = `import sys,os,json
sys.path.insert(0,sys.argv[1])
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import Artifact
from evidence_dag.snapshot import EvidenceSnapshot,compute_snapshot_digest,snapshot_storage_key
from evidence_dag.snapshot_storage import write_snapshot
from evidence_dag import provjson
root=sys.argv[2]
graph=ThreadGraph('r:hidden')
graph.meta['scope']={'workspaceRoot':'/workspace','accessPolicy':{'visibility':'public'}}
graph.artifacts['artifact:hidden']=Artifact('artifact:hidden','file','2026-01-01T00:00:00Z','version:hidden',{'visibility':'private'})
digest=compute_snapshot_digest(graph,input_watermark='1')
snapshot=EvidenceSnapshot('r:hidden',1,digest,'1','evidence.v3','extractor.v3','verifier.v3',(),'2026-01-01T00:00:00Z')
graph.meta['snapshot']=snapshot.to_dict()
path=os.path.join(root,'snapshots',snapshot_storage_key('r:hidden'),'1-'+digest[7:]+'.prov.json')
write_snapshot(path,provjson.dumps(graph),storage_dir=root)
print(json.dumps({'digest':digest}))
`
    const { digest } = JSON.parse(execFileSync(opts.executable, ['-I', '-B', '-c', script, opts.wheelPath, opts.storageRoot], { encoding: 'utf8' }))
    await expect(readCommittedSnapshot(opts, opts.executable, 'r:hidden', digest)).rejects.toThrow('trusted committed snapshot read failed')
  } finally { await rm(opts.root, { recursive: true, force: true }) }
}, 120000)
