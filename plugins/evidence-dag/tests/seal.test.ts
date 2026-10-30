import { it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { evidenceDagSealClosureInputSchema } from '../src/core.js'
import { EvidenceRuntime } from '../src/runtime.js'
import { PythonEvidenceWorker } from '@sciforge/domain-evidence-dag/host/python-worker'
import { artifactFixture } from './artifact-fixture.js'
import { workerOptions, syntheticReasoner } from './worker-fixture.js'
it('materializes an exact sealed closure through the real Python owner and replays from its persisted binding', async () => {
  const f = await artifactFixture()
  const opts = await workerOptions()
  const worker = new PythonEvidenceWorker({ ...opts, reasoner: async (input: any) => (await syntheticReasoner(input)).replaceAll('t1', 'claim-1') })
  const ports = { ...f.ports, request: async (r: any) => {
    if (r.operation === 'sidecar.extract') return worker.request('extract', r.input)
    if (r.operation === 'sidecar.commitSnapshot') return worker.request('commitSnapshot', r.input)
    if (r.operation === 'sidecar.readSnapshot') return worker.request('readSnapshot', r.input)
    if (r.operation === 'sidecar.close') { await worker.close(); return { exited: true } }
    return f.ports.request(r)
  } }
  const runtime = new EvidenceRuntime(ports)
  try {
    await runtime.start(); await runtime.update(f.scope)
    const status = await runtime.snapshotStatus(f.scope)
    expect(typeof runtime.sealClosure, 'sealing must exist on the real Evidence adapter').toBe('function')
    const request = evidenceDagSealClosureInputSchema.parse({ ...f.scope, idempotencyKey: 'seal-real-1', policy: { version: 'EvidenceClosurePolicyV1', targetClaimIds: (status.provisional!.lastGood as { claims: Array<{ id: string }> }).claims.map(claim => claim.id), expectedHeadDigest: status.authoritativeHead!.headDigest, barrierWatermark: '7', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] } })
    const closure = await runtime.sealClosure(request)
    expect(closure.status).toBe('complete')
    const committed = (await runtime.snapshotStatus(f.scope)).committed
    expect(committed!.threadId).toBe('codex:thread-1')
    expect(committed!.inputWatermark).toBe('7')
    const before = await readFile(join(f.ports.storageRoot, 'deltas.json'), 'utf8')
    expect(await runtime.sealClosure(request)).toEqual(closure)
    expect(await readFile(join(f.ports.storageRoot, 'deltas.json'), 'utf8')).toBe(before)
    await expect(runtime.sealClosure({ ...request, policy: { ...request.policy, maxDepth: 1 } })).rejects.toThrow(/idempotency|replay/i)
  } finally { await runtime.close(); await worker.close() }
})
