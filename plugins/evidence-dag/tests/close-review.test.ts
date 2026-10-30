import { it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EvidenceRuntime } from '../src/runtime.js'
import { artifactFixture } from './artifact-fixture.js'
import { evidenceDagSealClosureInputSchema } from '../src/core.js'
it.each(['seal', 'export', 'poll'] as const)('close fences %s after suspended authorization before effects', async operation => {
  const f = await artifactFixture()
  let block = false, enter!: () => void, release!: () => void
  const entered = new Promise<void>(r => { enter = r }), barrier = new Promise<void>(r => { release = r })
  const runtime = new EvidenceRuntime({ ...f.ports, request: async (r: any) => {
    if (r.operation === 'threads.read' && block) { enter(); await barrier }
    return f.ports.request(r)
  } })
  await runtime.start(); await runtime.update(f.scope)
  const head = (await runtime.snapshotStatus(f.scope)).authoritativeHead!.headDigest
  const before = await readFile(join(f.ports.storageRoot, 'deltas.json'), 'utf8')
  block = true; f.calls.length = 0
  const request = evidenceDagSealClosureInputSchema.parse({ ...f.scope, idempotencyKey: 'close-fence-one', policy: {
    version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim:1'], expectedHeadDigest: head, barrierWatermark: '7',
    edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false,
    expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] } })
  const work = operation === 'seal' ? runtime.sealClosure(request) : operation === 'poll' ? runtime.pollArtifactEvents(f.scope)
    : runtime.exportSnapshotProducts({ ...f.scope, snapshotDigest: 'sha256:' + 'a'.repeat(64), idempotencyKey: 'export-close-one', datacite: { doi: '10.12345/close', title: 'Synthetic', creators: [{ name: 'Ada' }], publisher: 'Lab', publicationYear: 2026, projectId: 'project:synthetic' } } as any)
  const result = work.then(() => null, e => e)
  await entered
  let closed = false; const closing = runtime.close().then(() => { closed = true })
  await Promise.resolve(); expect(closed).toBe(false)
  release()
  expect((await result)?.message).toMatch(/closing|closed/i)
  await closing
  expect(await readFile(join(f.ports.storageRoot, 'deltas.json'), 'utf8')).toBe(before)
  // Producer stop is now intentionally driven before suspended authorization settles.
  expect(f.calls.map(r => r.operation).sort()).toEqual(['sidecar.close', 'threads.read'])
})
