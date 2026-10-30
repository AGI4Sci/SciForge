import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { it, expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { evidenceDagCanonicalStatusSchema, evidenceDagSealClosureOutputSchema } from '../src/core.js'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { artifactFixture } from './artifact-fixture.js'
import { workerOptions, syntheticReasoner } from './worker-fixture.js'
import { PythonEvidenceWorker } from '@sciforge/domain-evidence-dag/host/python-worker'
import { readCommittedChain, committedStatus, readCommittedSnapshot } from '@sciforge/domain-evidence-dag/host/committed-reader'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
it('seals through the precompiled official DSH tool with a real wheel owner and restores its exact persisted binding', async () => {
  const f = await artifactFixture(), opts = await workerOptions()
  const worker = new PythonEvidenceWorker({ ...opts, reasoner: async (i) => (await syntheticReasoner(i)).replaceAll('t1', 'claim-1') })
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
    ctx.provide('evidenceDagPorts', { ...f.ports, request: async (r: any) => {
      if (r.operation === 'committed.status') {
        if (JSON.stringify(r.scope) !== JSON.stringify(f.scope)) throw new Error('Synthetic scope not authorized')
        return committedStatus(await readCommittedChain(f.ports.storageRoot, opts.executable, f.scope, undefined, opts.wheelPath), f.scope,
          async digest => readCommittedSnapshot(opts, opts.executable, `${f.scope.runtimeId}:${f.scope.threadId}`, digest))
      }
      if (r.operation === 'sidecar.commitSnapshot') return worker.request('commitSnapshot', r.input)
      if (r.operation === 'sidecar.readSnapshot') return worker.request('readSnapshot', r.input)
      if (r.operation === 'sidecar.close') { await worker.close(); return { exited: true } }
      return f.ports.request(r)
    } })
    const entry = await import(pathToFileURL(join(opts.release, 'main.mjs')).href) as typeof import('../src/dsh-adapter.js')
    const fork = await ctx.plugin(entry)
    const execute = (name: string, args: any) => ctx.tools.execute({ name, arguments: args, callId: brandString<ToolCallId>(name + '-1'), signal: new AbortController().signal })
    expect((await execute('evidence_dag_update', f.scope)).isError).toBe(false)
    const head = evidenceDagCanonicalStatusSchema.parse((await execute('evidence_dag_snapshot_status', f.scope)).value).authoritativeHead!.headDigest
    const args = { ...f.scope, idempotencyKey: 'seal-dsh-1', policy: { version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim:1'], expectedHeadDigest: head, barrierWatermark: '7', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] } }
    const sealed = await execute('evidence_dag_seal_closure', args)
    expect(sealed.isError, JSON.stringify(sealed)).toBe(false)
    expect(evidenceDagSealClosureOutputSchema.parse(sealed.value).status).toBe('complete')
    const closure = evidenceDagSealClosureOutputSchema.parse(sealed.value)
    const sidechain = { ...f.scope, recordId: 'review-1', recordType: 'review', closureDigest: closure.closureDigest, idempotencyKey: 'sidechain-review-1', producerIdentity: 'synthetic-reviewer', payload: { result: 'accepted' } }
    const review = await execute('evidence_dag_append_sidechain', { input: sidechain })
    expect(review.isError, JSON.stringify(review)).toBe(false)
    const reviewReplay = await execute('evidence_dag_append_sidechain', { input: sidechain })
    expect(reviewReplay.isError).toBe(false)
    expect((reviewReplay.value as { idempotent: boolean }).idempotent).toBe(true)
    expect((await execute('evidence_dag_poll_artifact_events', f.scope)).isError).toBe(false)
    const committed = evidenceDagCanonicalStatusSchema.parse((await execute('evidence_dag_snapshot_status', f.scope)).value).committed
    await fork.dispose()
    const restart = await ctx.plugin(entry)
    expect(evidenceDagCanonicalStatusSchema.parse((await execute('evidence_dag_snapshot_status', f.scope)).value).committed).toEqual(committed)
    expect((await execute('evidence_dag_seal_closure', args)).value).toEqual(sealed.value)
    await restart.dispose()
  } finally { await ctx.fiber.dispose(); await worker.close() }
})
