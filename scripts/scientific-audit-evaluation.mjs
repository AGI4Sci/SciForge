import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { setI18n } from 'react-i18next'
import { EvidenceDagDeltaStore, EvidenceDeltaChain } from '@sciforge/domain-evidence-dag/main'
import { EvidenceDagRuntime } from '@sciforge/domain-evidence-dag/main'
import { ResearchRecordRuntime } from '@sciforge/domain-evidence-dag/main'
import { auditClient } from './scientific-audit-query-client.mjs'
import { researchDossierMessages } from '@sciforge/domain-research-dossier/renderer'
import { ResearchDossierEvidenceReview } from '@sciforge/domain-research-dossier/renderer'

const at = '2026-11-05T00:00:00.000Z'
const workspace = await realpath(await mkdtemp(join(tmpdir(), 'scientific-audit-eval-')))
const store = new EvidenceDagDeltaStore(join(workspace, 'deltas.json'))
const ref = { artifactId: 'artifact:input', versionId: 'artifact-version:old', contentDigest: 'a'.repeat(64), byteLength: 4, availability: 'available', retention: 'reference', accessPolicy: { visibility: 'workspace', principals: [], allowExport: false } }
const detail = { runtimeId: 'codex', id: 'fixture', workspaceRoot: workspace, watermark: '1', artifacts: [], turns: [{ id: 'turn:old', status: 'completed', messages: [], artifacts: [{ id: 'input:old', kind: 'user_message', text: 'EXACT_OLD_INPUT' }] }] }
const context = { userDataDir: workspace, signal: new AbortController().signal,
  agentThreads: { list: async () => [], read: async () => structuredClone(detail) },
  enablement: { isEnabled: async () => true, subscribe: () => () => {} }, log: () => {},
  capabilities: { invoke: async () => { throw new Error('Unexpected external capability') } } }
const runtime = new EvidenceDagRuntime({ userDataDir: workspace, deltaStore: store,
  sidecar: { configure: () => {}, endpoint: () => ({ baseUrl: 'http://127.0.0.1:1', apiKey: '' }), ensureReady: async () => {}, stop: async () => {} },
  fetchImpl: async () => { throw new Error('No model or external service allowed') } })
const python = spawnSync('python', ['scripts/scientific-audit-fixture.py'], { encoding: 'utf8' })
assert.equal(python.status, 0, python.stderr)
const structural = JSON.parse(python.stdout)
assert.ok(structural.audit.findings.some(value => value.finding_type === 'non_independent_support'))
assert.ok(structural.impact.invalidated.length > 0)
const browser = new Window()
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? browser : browser[key] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.React = React
setI18n({ isInitialized: true, language: 'en', languages: ['en'], options: { react: { useSuspense: false, bindI18n: '', bindI18nStore: '' } }, getFixedT: () => key => researchDossierMessages.zh[key] ?? key, hasLoadedNamespace: () => true })
const results = []
let sequence = 0
async function append(threadId, payload) {
  return store.append({ scope: { runtimeId: 'codex', threadId, operationId: `fixture:${++sequence}`, kind: 'manual', workspaceRoot: workspace }, requestedWatermark: String(sequence), schemaVersion: 'evidence.delta.v1', extractorVersion: 'fixture', verifierVersion: 'fixture', idempotencyKey: `fixture-delta:${sequence}`, payload, createdAt: at })
}
async function scenario(id, payload, changed, expected, match, targetId = 'claim:benefit') {
  const threadId = `codex:${id}`
  const base = await append(threadId, { claims: [{ id: 'claim:benefit', text: 'Benefit is conditional on the original input' }], ref, ...payload })
  const closure = await store.seal(threadId, { version: 'EvidenceClosurePolicyV1', targetClaimIds: [targetId], expectedHeadDigest: base.delta.deltaDigest, barrierWatermark: String(sequence), edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] }, `fixture-seal:${id}`)
  const original = await store.appendSidechain({ threadId, closureDigest: closure.closureDigest, recordId: `review:${id}`, recordType: 'review', idempotencyKey: `fixture-review:${id}`, producerIdentity: 'human:fixture-reviewer', reviewerIdentity: 'human:fixture-reviewer', createdAt: at, payload: { ref: structuredClone(ref), verdict: 'original-material-only', ...(id === 'common-origin' ? { ...structural.audit, findings: [...structural.audit.findings, { target_id: 'claim:unrelated-decoy', finding_type: 'failed_replication', rationale: 'DECOY_MUST_NOT_APPEAR' }] } : {}) } })
  if (changed) await append(threadId, changed)
  const client = auditClient(runtime)
  const start = performance.now()
  const value = await client.queryEvidenceAudit(workspace, ref)
  const impact = value.scientificReview.impacts.find(v => v.recordDigest === original.record.recordDigest)
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  let closureOpened = false
  try {
    await act(async () => root.render(React.createElement(ResearchDossierEvidenceReview, { client, reference: ref, workspaceRoot: workspace, sessionId: 'fixture', workbench: { canOpenResource: () => true, openResource: input => { closureOpened = input.resource.resourceId === closure.closureDigest; return true } } })))
    await act(async () => container.querySelector('button').click())
    const text = container.textContent
    assert.equal(impact.status, expected)
    if (id === 'exact-identity') for (const mismatch of [{ ...ref, artifactId: 'artifact:other' }, { ...ref, contentDigest: 'f'.repeat(64) }, { ...ref, versionId: 'artifact-version:other' }]) {
      const denied = await client.queryEvidenceAudit(workspace, mismatch)
      assert.ok(!denied.records.some(record => record.recordDigest === original.record.recordDigest), 'a supplied mismatching full reference must never bind a bare version index')
    }
    assert.match(text, match)
    if (!['controls-and-scope', 'bounded-coverage'].includes(id)) assert.equal(value.scientificReview.conditions.find(c => c.axis === 'controls').status, 'unknown', 'successful processing must not infer matched controls')
    if (id === 'common-origin') { const findings = value.scientificReview.conditions.flatMap(c => c.observations); assert.ok(findings.some(f => f.field === 'non_independent_support' && f.targetId === structural.claimId)); assert.ok(!findings.some(f => f.text.includes('DECOY_MUST_NOT_APPEAR'))) }
    if (id === 'bounded-coverage') { assert.equal(value.scientificReview.bounded, true); assert.match(text, /覆盖不完整/) }
    if (id === 'negative-failed-reproduction') { assert.match(text, /did not reproduce/); assert.equal(value.scientificReview.conditions.find(c => c.axis === 'reproduction').status, 'recorded') }
    const recordButtons = [...container.querySelectorAll('ol li button')]
    const index = value.records.findIndex(r => r.recordDigest === original.record.recordDigest)
    // Each independent scenario uses its own exact version identity below.
    if (recordButtons[index]) await act(async () => recordButtons[index].click())
    assert.equal(value.records.find(r => r.recordDigest === original.record.recordDigest).reviewerIdentity, 'human:fixture-reviewer')
    assert.ok(closureOpened)
    results.push({ id, detected: true, miss: false, falsePositive: false, latencyMs: +(performance.now() - start).toFixed(3), status: impact.status })
  } catch (error) { results.push({ id, detected: false, miss: id !== 'unrelated-branch', falsePositive: impact?.status === 'requires-review' && expected !== 'requires-review', latencyMs: +(performance.now() - start).toFixed(3), error: String(error) }) }
  finally { await act(async () => root.unmount()); container.remove() }
  // Pin each subsequent scenario to a different exact identity.
  ref.versionId += ':next'; ref.contentDigest = (sequence % 10).toString().repeat(64)
}
try {
  const historical = JSON.parse(await readFile(new URL('../tests/fixtures/scientific-audit-old-closure.json', import.meta.url), 'utf8'))
  const historicalStart = performance.now()
  try {
    const restored = new EvidenceDeltaChain('codex:historical', historical.records, historical)
    assert.deepEqual(restored.closures(), historical.closures)
    assert.deepEqual(restored.sidechainRecords(), historical.sidechains)
    assert.equal(restored.committedSnapshotClosure, historical.committedSnapshotClosureDigest)
    results.push({ id: 'legacy-gap-policy-and-formal-approval-restart', detected: true, miss: false, falsePositive: false, latencyMs: +(performance.now() - historicalStart).toFixed(3) })
  } catch (error) { results.push({ id: 'legacy-gap-policy-and-formal-approval-restart', detected: false, miss: true, falsePositive: false, latencyMs: +(performance.now() - historicalStart).toFixed(3), error: String(error) }) }
  await runtime.activate(context)
  await scenario('exact-identity', {}, null, 'unknown', /影响未知/)
  await scenario('same-chain-other-branch', {}, { claims: [{ id: 'claim:unrelated', controls: { matched: true }, limitations: ['UNRELATED_LIMITATION'] }] }, 'unknown', /影响未知/)
  await scenario('tool-schema', { trace: [{ schema: { properties: { controls: { type: 'string', description: 'Not scientific controls' } } } }] }, null, 'unknown', /影响未知/)
  await scenario('old-input', { edges: [{ source: 'input:old', target: 'claim:benefit', family: 'supports' }] }, { correction: { targetRecordId: 'input:old', relation: 'supersedes', reason: 'Old input replaced' } }, 'requires-review', /材料已变化/)
  await scenario('parameters-material', { edges: [{ source: 'parameter:old', target: 'claim:benefit', family: 'provenance' }] }, { correction: { targetRecordId: 'parameter:old', relation: 'corrects', reason: 'Temperature changed from 300 K to 310 K' } }, 'requires-review', /Temperature changed/)
  await scenario('lifecycle-material', { edges: [{ source: ref.versionId, target: 'claim:benefit', family: 'provenance' }] }, { lifecycleEvents: [{ schemaVersion: 1, eventId: 'lifecycle:fixture', sequence: 1, type: 'current-changed', artifactId: ref.artifactId, versionId: 'artifact-version:new', previousVersionId: ref.versionId, createdAt: at, detail: { previousContentDigest: ref.contentDigest } }] }, 'requires-review', /current-changed/)
  await scenario('lifecycle-missing-old-digest', { edges: [{ source: ref.versionId, target: 'claim:benefit', family: 'provenance' }] }, { lifecycleEvents: [{ schemaVersion: 1, eventId: 'lifecycle:unknown-old-content', sequence: 1, type: 'current-changed', artifactId: ref.artifactId, versionId: 'artifact-version:new', previousVersionId: ref.versionId, createdAt: at, detail: {} }] }, 'unknown', /影响未知/)
  const reconcileTarget = structural.impact.invalidated.find(value => value.type === 'conclusion').id
  await scenario('formal-reconcile', { claims: [{ id: reconcileTarget, content: 'Original shared-origin conclusion' }] }, { reconcile: structural.impact }, 'requires-review', /Formal reconcile/, reconcileTarget)
  await scenario('common-origin', { claims: [{ id: structural.claimId, text: 'Two supports sharing one experimental origin' }] }, null, 'unknown', /non_independent_support/, structural.claimId)
  await scenario('negative-failed-reproduction', { claims: [{ id: 'claim:benefit', negativeResults: ['No improvement against the baseline'], reproduction: { outcome: 'failed', reason: 'Observed effect did not reproduce' } }] }, null, 'unknown', /No improvement against the baseline/)
  await scenario('controls-and-scope', { claims: [{ id: 'claim:benefit', controls: { comparison: 'unmatched sample counts', matched: false }, limitations: ['Synthetic comparison only; transfer remains unknown'], unresolvedGaps: ['No physical replication'] }] }, null, 'unknown', /unmatched sample counts/)
  await scenario('unrelated-branch', { edges: [{ source: 'input:a', target: 'claim:benefit', family: 'supports' }, { source: 'input:b', target: 'claim:other', family: 'supports' }] }, { correction: { targetRecordId: 'input:b', relation: 'supersedes', reason: 'Other branch changed' } }, 'no-recorded-impact', /未发现影响/)
  await scenario('bounded-coverage', { claims: [{ id: 'claim:benefit', controls: Array.from({ length: 11000 }, (_, index) => index) }] }, null, 'unknown', /覆盖不完整/)
  await scenario('unknown-mapping', { claims: [{ id: 'claim:benefit', text: 'Known claim without recorded source edges' }] }, { correction: { targetRecordId: 'unmapped', relation: 'supersedes', reason: 'No recorded dependency mapping' } }, 'unknown', /影响未知/)
  // Canonical observation -> persisted record -> restart read, with no model.
  await runtime.records.close()
  const records = new ResearchRecordRuntime({ userDataDir: workspace, pollMs: 600000 })
  context.agentThreads.list = async () => [{ ...detail }]
  records.start(context, true); await records.scan()
  const round = (await records.view({ runtimeId: 'codex', threadId: 'fixture', workspaceRoot: workspace })).children[0]
  const pending = [round]; let source
  while (pending.length) { const node = pending.shift(); if (node.source) { source = node; break }; pending.push(...(await records.view({ runtimeId: 'codex', threadId: 'fixture', workspaceRoot: workspace, nodeId: node.id })).children) }
  await records.close(); detail.turns = []
  const restarted = new ResearchRecordRuntime({ userDataDir: workspace, pollMs: 600000 }); restarted.start(context, true)
  const start = performance.now()
  try { const old = await restarted.view({ runtimeId: 'codex', threadId: 'fixture', workspaceRoot: workspace, nodeId: source.id }); assert.equal(old.retainedSource, 'retained'); assert.equal(old.sourceStatus, 'unavailable'); assert.equal(old.raw.text, 'EXACT_OLD_INPUT'); results.push({ id: 'exact-historic-restore', detected: true, miss: false, falsePositive: false, latencyMs: +(performance.now() - start).toFixed(3) }) }
  finally { await restarted.close() }
} finally { await runtime.close(); browser.close() }
const report = { schemaVersion: 1, fixture: 'fixed fault seeds, isolated owners and DOM', scope: 'Machine detection and rendering only. Not human audit quality, scientific validity, real model execution, Linux, Electron or packaged validation.', pythonStructuralLatencyMs: structural.latencyMs, results, failures: results.filter(r => !r.detected).length }
const output = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : join(workspace, 'scientific-audit-evaluation.json')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (report.failures) process.exitCode = 1
