import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sciforgeReproSpecSchema } from '@sciforge/domain-sdk/reproducibility'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { EvidenceDagServiceClient } from './client'
import { EvidenceDagRuntime } from './runtime'
import { EvidenceDagDeltaStore } from './evidence-delta'
import { createEvidenceDagCapabilityFactory, type EvidenceDagCapabilityOptions } from '../main'
import { EVIDENCE_DAG_CAPABILITY_IDS, evidenceDagRerunCompareOutputSchema, evidenceDagClosurePolicyV1Schema } from '../contract'

const digest = 'sha256:' + 'a'.repeat(64), candidateDigest = 'sha256:' + 'b'.repeat(64)
const input = { runtimeId: 'codex', threadId: 'thread / ?&', snapshotDigest: digest, conclusionId: 'claim / ?&', workspaceRoot: '/workspace' }
test('actual Python owner comparison fits the bounded bridge schema', () => {
  const script = fileURLToPath(new URL('../../tests/emit_shared_spec.py', import.meta.url))
  const python = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-B', '-c', `
import contextlib, io, json, runpy, sys
out = io.StringIO()
with contextlib.redirect_stdout(out):
    runpy.run_path(sys.argv[1], run_name="__main__")
spec = json.loads(out.getvalue())
from evidence_dag.rerun import compare_rerun_specs
print(json.dumps({"baseline": spec, "candidate": spec, "comparison": compare_rerun_specs(spec, spec)}))
`, script], { encoding: 'utf8', windowsHide: true })
  assert.equal(python.status, 0, python.stderr)
  const value = evidenceDagRerunCompareOutputSchema.parse(JSON.parse(python.stdout))
  assert.equal(value.baseline.source.snapshotDigest, value.candidate.source.snapshotDigest)
})
function spec(snapshotDigest = digest, conclusionId = input.conclusionId) {
  return sciforgeReproSpecSchema.parse({ schemaVersion: 'sciforge.rerun.v1', specId: 'fixture', specDigest: snapshotDigest,
    source: { snapshotDigest, threadId: `codex:${input.threadId}`, conclusionId }, target: { kind: 'conclusion', id: conclusionId },
    executionReady: true, reproducibility: 'controlled', activities: [{ id: 'analysis', type: 'analysis_run', name: 'fixture',
      executor: { kind: 'create-loop', workflow: { id: 'fixture' }, workflowDigest: digest, target: { kind: 'workflow', id: 'fixture' } },
      inputs: [], code: [], environments: [], parameterSets: [], tools: [], approvals: [], outputs: [], stochastic: false,
      inputFingerprint: digest, specFingerprint: digest }], dependencies: [], secretSlots: [], breakpoints: [], createdAt: '2026-11-05T00:00:00Z' })
}
function comparison() {
  return { baseline: spec(), candidate: spec(candidateDigest, 'candidate'), comparison: {
    schemaVersion: 'sciforge.rerun-comparison.v1', baselineSpecDigest: digest, candidateSpecDigest: candidateDigest,
    sameInput: true, sameSpec: true, sameExecutionContext: true, resultMatch: false, comparisonVerifiable: false,
    classification: 'unverifiable', replicationStatus: 'inconclusive', replicationRelation: null, differences: [], reasonCodes: [] } }
}
test('rerun GET bridges encode every exact owner parameter and use authenticated client request', async () => {
  const calls: URL[] = []
  const client = new EvidenceDagServiceClient({ endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'fixture-only' }), fetchImpl: async (url, init) => {
    assert.equal(init?.method, 'GET'); assert.equal(init?.cache, 'no-store')
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer fixture-only')
    const parsed = new URL(String(url)); calls.push(parsed)
    assert.match(parsed.pathname, /thread%20%2F%20%3F%26/)
    return Response.json({ ok: true, data: parsed.pathname.endsWith('rerun-spec') ? spec() : comparison() })
  } })
  await client.rerunSpec(input)
  assert.equal(calls[0].searchParams.get('snapshotDigest'), digest)
  assert.equal(calls[0].searchParams.get('conclusionId'), input.conclusionId)
  await client.rerunCompare({ runtimeId: input.runtimeId, threadId: input.threadId, baselineDigest: digest, baselineConclusionId: input.conclusionId, candidateDigest, candidateConclusionId: 'candidate' })
  assert.deepEqual([...calls[1].searchParams], [['baselineDigest', digest], ['baselineConclusionId', input.conclusionId], ['candidateDigest', candidateDigest], ['candidateConclusionId', 'candidate']])
})
test('owner spec/compare identity mismatches and malformed/unbounded comparisons fail closed', async () => {
  for (const patch of [ { source: { ...spec().source, threadId: 'other' } }, { source: { ...spec().source, snapshotDigest: candidateDigest } }, { source: { ...spec().source, conclusionId: 'other' }, target: { kind: 'conclusion', id: 'other' } } ]) {
    const client = new EvidenceDagServiceClient({ endpoint: () => ({ baseUrl: 'http://fixture', apiKey: '' }), fetchImpl: async () => Response.json({ ok: true, data: { ...spec(), ...patch } }) })
    await assert.rejects(client.rerunSpec(input), /identity mismatch/)
  }
  const wrong = comparison(); wrong.candidate = spec(candidateDigest, 'wrong')
  const client = new EvidenceDagServiceClient({ endpoint: () => ({ baseUrl: 'http://fixture', apiKey: '' }), fetchImpl: async () => Response.json({ ok: true, data: wrong }) })
  await assert.rejects(client.rerunCompare({ runtimeId: input.runtimeId, threadId: input.threadId, baselineDigest: digest, baselineConclusionId: input.conclusionId, candidateDigest, candidateConclusionId: 'candidate' }), /identity mismatch/)
  assert.equal(evidenceDagRerunCompareOutputSchema.safeParse({ ...comparison(), extra: true }).success, false)
  assert.equal(evidenceDagRerunCompareOutputSchema.safeParse({ ...comparison(), comparison: { ...comparison().comparison, reasonCodes: Array(257).fill('x') } }).success, false)
})
test('rerun runtime authorizes real thread workspace before HTTP and refuses disabled/denied scopes', async () => {
  let enabled = true, denied = false, captured: string | undefined = '/workspace', http = 0
  const dir = await mkdtemp(join(tmpdir(), 'rerun-read-fixture-'))
  const deltaStore = new EvidenceDagDeltaStore(join(dir, 'fixture-deltas.json'))
  let lastUrl = ''
  const runtime = new EvidenceDagRuntime({ userDataDir: dir, deltaStore, sidecar: { configure() {}, endpoint: () => ({ baseUrl: 'http://fixture', apiKey: '' }), ensureReady: async () => {}, stop: async () => {} }, fetchImpl: async url => { http++; lastUrl = String(url); return Response.json({ ok: true, data: spec() }) } })
  const context: DomainMainRuntimeLifecycleContext = {
    owner: { moduleId: 'sciforge.evidence-dag', moduleVersion: 'fixture' }, signal: new AbortController().signal, userDataDir: dir, appRoot: dir, environment: {},
    agentThreads: { list: async () => [], read: async key => { if (denied) throw new Error('permission denied'); assert.equal(key.threadId, input.threadId); return { id: key.threadId, runtimeId: key.runtimeId, watermark: '1', turns: [], artifacts: [], workspaceRoot: captured } }, subscribeMessages: async function* () {}, hasActiveTurns: () => false },
    capabilities: { invoke: async () => { throw new Error('unused') }, createApprovedBatch: () => { throw new Error('unused') } },
    modelAccess: { textReasoner: async () => { throw new Error('no models') } }, executionEvents: { publish: async () => { throw new Error('no executions') } }, workflowExecutionReceipts: [],
    enablement: { isEnabled: async () => enabled, subscribe: () => () => {} }, log() {}
  }
  await runtime.activate(context)
  try {
    await assert.rejects(runtime.rerunSpec({ ...input, workspaceRoot: '/other' }), /does not match/); assert.equal(http, 0)
    captured = undefined; await assert.rejects(runtime.rerunSpec(input), /captured thread workspace/); assert.equal(http, 0)
    captured = '/workspace'; denied = true; await assert.rejects(runtime.rerunSpec(input), /permission denied/); assert.equal(http, 0)
    denied = false; enabled = false; await assert.rejects(runtime.rerunSpec(input), /disabled/); assert.equal(http, 0)
    enabled = true; await runtime.rerunSpec(input); assert.equal(http, 1)
    const closureRequest = { runtimeId: input.runtimeId, threadId: input.threadId, workspaceRoot: input.workspaceRoot, closureDigest: candidateDigest, conclusionId: input.conclusionId }
    await assert.rejects(runtime.rerunSpec(closureRequest), /no retained committed Snapshot binding/); assert.equal(http, 1)
    const threadId = `codex:${input.threadId}`
    const seed = async (watermark: string, snapshotDigest: string) => {
      const appended = await deltaStore.append({ scope: { runtimeId: input.runtimeId, threadId, workspaceRoot: input.workspaceRoot, operationId: `fixture-${watermark}`, kind: 'turn' }, requestedWatermark: watermark, committedWatermark: watermark,
        schemaVersion: 'evidence.delta.v1', extractorVersion: 'fixture', verifierVersion: 'fixture', idempotencyKey: `fixture-${watermark}`, sourceRefs: [], artifactRefs: [], runRefs: [], payload: { claims: [{ id: input.conclusionId, text: 'fixture' }] }, createdAt: '2026-11-05T00:00:00Z' })
      const closure = await deltaStore.seal(threadId, evidenceDagClosurePolicyV1Schema.parse({ version: 'EvidenceClosurePolicyV1', targetClaimIds: [input.conclusionId], expectedHeadDigest: appended.delta.deltaDigest, barrierWatermark: watermark, edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] }))
      await deltaStore.recordCommittedSnapshot(threadId, { threadId, digest: snapshotDigest, version: Number(watermark), inputWatermark: watermark, schemaVersion: 'evidence.v3', extractorVersion: 'fixture', verifierVersion: 'fixture', artifactDigests: [], createdAt: '2026-11-05T00:00:00Z' }, closure.closureDigest)
      return closure
    }
    const old = await seed('1', digest)
    await seed('2', candidateDigest)
    await runtime.rerunSpec({ ...closureRequest, closureDigest: old.closureDigest })
    assert.equal(new URL(lastUrl).searchParams.get('snapshotDigest'), digest, 'historical binding survives a newer committed snapshot')
    assert.equal((await deltaStore.committedSnapshot(threadId))?.digest, candidateDigest, 'read does not move current')
  } finally { await runtime.close() }
})
test('capability definitions are read-only and replace user workspace with caller authority', async () => {
  let seen: unknown
  const definitions = createEvidenceDagCapabilityFactory<EvidenceDagCapabilityOptions>({ defineCapability: value => value, getRuntime: () => ({ rerunSpec: async (value: unknown) => { seen = value; return spec() } }) as unknown as EvidenceDagRuntime }).createDefinitions()
  const definition = definitions.find(value => value.id === EVIDENCE_DAG_CAPABILITY_IDS.rerunSpec)!
  assert.equal(definition.effect, 'read'); assert.equal(definition.approval, 'none')
  await assert.rejects(definition.handler(input), /workspace-scoped caller/)
  await definition.handler({ ...input, workspaceRoot: '/untrusted' }, { caller: { workspaceId: '/workspace' } })
  assert.deepEqual(seen, input)
})
