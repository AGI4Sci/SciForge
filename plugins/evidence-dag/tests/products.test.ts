import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { it, expect } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EvidenceRuntime } from '../src/runtime.js'
import { evidenceDagSealClosureInputSchema, evidenceDagExportSnapshotProductsInputSchema } from '../src/core.js'
import { artifactFixture } from './artifact-fixture.js'
import { workerOptions, syntheticReasoner } from './worker-fixture.js'
import { PythonEvidenceWorker } from '@sciforge/domain-evidence-dag/host/python-worker'
it('exports all five products from a real pinned wheel Snapshot through the authoritative Artifact Versions transaction', async () => {
  const f = await artifactFixture(), opts = await workerOptions()
  // Export requires a real source anchor, not a claim-only artifact locator.
  Object.assign(f.trace[0], { type: 'tool_result', output: 'Synthetic source.' })
  f.trace[0].artifact.locator = 'workspace:result.txt' // canonical readable reference scheme
  let worker = new PythonEvidenceWorker({ ...opts, reasoner: async (i: any) => {
    const prompt = i.messages.find((m: any) => m.role === 'user')?.content ?? ''
    const traceId = /^\[([^\]]+)\]/m.exec(prompt)?.[1] ?? 'claim-1'
    return (await syntheticReasoner(i)).replaceAll('t1', traceId)
  } })
  const ports = { ...f.ports, request: async (r: any) => {
    if (r.operation === 'sidecar.commitSnapshot') return worker.request('commitSnapshot', r.input)
    if (r.operation === 'sidecar.readSnapshot') return worker.request('readSnapshot', r.input)
    if (r.operation === 'sidecar.snapshotProducts') return worker.request('snapshotProducts', r.input)
    if (r.operation === 'sidecar.close') { await worker.close(); return { exited: true } }
    return f.ports.request(r)
  } }
  const runtime = new EvidenceRuntime(ports)
  try {
    await runtime.start(); await runtime.update(f.scope)
    const head = (await runtime.snapshotStatus(f.scope)).authoritativeHead!.headDigest
    await runtime.sealClosure(evidenceDagSealClosureInputSchema.parse({ ...f.scope, idempotencyKey: 'products-seal-1', policy: { version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim:1'], expectedHeadDigest: head, barrierWatermark: '7', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] } }))
    const digest = (await runtime.snapshotStatus(f.scope)).committed!.digest
    expect(typeof runtime.exportSnapshotProducts, 'canonical product exporter must be available').toBe('function')
    const input = evidenceDagExportSnapshotProductsInputSchema.parse({ ...f.scope, snapshotDigest: digest, idempotencyKey: 'products-export-1', datacite: { doi: '10.12345/sciforge.snapshot', title: 'Synthetic pinned Snapshot', creators: [{ name: 'Researcher, Ada', nameType: 'Personal' }], publisher: 'Synthetic Laboratory', publicationYear: 2026, projectId: 'project:synthetic' } })
    const exported = await runtime.exportSnapshotProducts(input)
    expect(exported.products).toHaveLength(5)
    expect(exported.sourceArtifactVersionRefs).toHaveLength(1)
    for (const product of exported.products) expect((await f.service.read(f.scope.workspaceRoot, { versionId: product.ref.versionId, maxBytes: Math.max(1, product.ref.byteLength) }, f.access)).ok).toBe(true)
    const replay = await runtime.exportSnapshotProducts(input)
    expect(replay.transactionId).toBe(exported.transactionId); expect(replay.idempotentReplay).toBe(true)
    await expect(runtime.exportSnapshotProducts({ ...input, snapshotDigest: 'sha256:' + '0'.repeat(64) })).rejects.toThrow(/bound|closure/i)
    await runtime.close()
    worker = new PythonEvidenceWorker({ ...opts, reasoner: async () => { throw new Error('Recovery must not recompile') } })
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
      ctx.provide('evidenceDagPorts', ports)
      await ctx.plugin(await import(pathToFileURL(join(opts.release, 'main.mjs')).href))
      const result = await ctx.tools.execute({ name: 'evidence_dag_export_snapshot_products', arguments: { input }, callId: brandString<ToolCallId>('products-dsh-1'), signal: new AbortController().signal })
      expect(result.isError, JSON.stringify(result)).toBe(false)
      expect(result.value).toEqual(replay)
    } finally { await ctx.fiber.dispose() }

  } finally { await runtime.close(); await worker.close() }
})
