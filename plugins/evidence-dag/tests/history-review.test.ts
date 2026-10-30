import { it, expect } from 'vitest'
import { EvidenceRuntime } from '../src/runtime.js'
import { artifactFixture } from './artifact-fixture.js'
import { evidenceDagSealClosureInputSchema } from '../src/core.js'
it('returns an old closure mapping without materialization or moving current, including restart', async () => {
  const f = await artifactFixture()
  let watermark = '7'
  const calls: string[] = []
  const ports = { ...f.ports, request: async (r: any): Promise<any> => {
    calls.push(r.operation)
    if (r.operation === 'threads.read') return { ...f.scope, watermark, trace: [{ id: 'c', claimId: 'claim:1', content: 'Synthetic' }] }
    if (r.operation === 'sidecar.commitSnapshot') return { snapshot: { threadId: 'codex:thread-1', version: r.input.targetWatermark === '7' ? 1 : 2,
      digest: 'sha256:' + (r.input.targetWatermark === '7' ? 'a' : 'b').repeat(64), inputWatermark: r.input.targetWatermark,
      schemaVersion: 'evidence.v3', extractorVersion: 'extractor.v3', verifierVersion: 'verifier.v3', artifactDigests: [], createdAt: '2026-07-26T00:00:00Z' } }
    if (r.operation === 'sidecar.readSnapshot') return { snapshot: { digest: r.input.snapshotDigest } }
    return f.ports.request(r)
  } }
  let runtime = new EvidenceRuntime(ports)
  const request = async (key: string) => evidenceDagSealClosureInputSchema.parse({ ...f.scope, idempotencyKey: key, policy: {
    version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim:1'], expectedHeadDigest: (await runtime.snapshotStatus(f.scope)).authoritativeHead!.headDigest,
    barrierWatermark: watermark, edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false,
    expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] } })
  try {
    await runtime.start(); await runtime.update(f.scope)
    const a = await request('old-seal-one'); const receipt = await runtime.sealClosure(a)
    watermark = '8'; await runtime.update(f.scope); await runtime.sealClosure(await request('old-seal-two'))
    const current = (await runtime.snapshotStatus(f.scope)).committed
    for (const restart of [false, true]) {
      if (restart) { await runtime.close(); runtime = new EvidenceRuntime(ports); await runtime.start() }
      calls.length = 0
      expect(await runtime.sealClosure(a)).toEqual(receipt)
      expect(calls).toEqual(['threads.read'])
      expect((await runtime.snapshotStatus(f.scope)).committed).toEqual(current)
      await expect(runtime.sealClosure({ ...a, policy: { ...a.policy, maxDepth: 1 } })).rejects.toThrow(/idempotency|replay/i)
    }
  } finally { await runtime.close() }
})
