import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { researchAuditEvidenceAuditQueryOutputSchema, type ArtifactVersionRefV1 } from '@sciforge/domain-sdk/research-audit'
import { sciforgeReproSpecSchema } from '@sciforge/domain-sdk/reproducibility'
import { EvidenceRerunReview, EvidenceReviewCoverage } from './EvidenceRerunReview'
import { ResearchSourceRetention } from './ResearchSourceRetention'
import { researchRecordViewOutputSchema } from '../research-record-contract'

const browser = new Window()
before(() => {
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent'] as const) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? browser : browser[name] })
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
})
after(() => browser.close())
const digest = 'sha256:' + 'a'.repeat(64), candidateDigest = 'sha256:' + 'b'.repeat(64)
const reference: ArtifactVersionRefV1 = { artifactId: 'artifact:fixture', versionId: 'artifact-version:current', contentDigest: 'a'.repeat(64), byteLength: 3, availability: 'available', retention: 'reference', accessPolicy: { visibility: 'workspace', principals: [], allowExport: false } }
const result = researchAuditEvidenceAuditQueryOutputSchema.parse({ subject: { artifactVersionRef: reference }, records: [{ recordDigest: digest, threadId: 'codex:thread /&', sequence: 1, recordId: 'review', recordType: 'review', closureDigest: digest, idempotencyKey: 'fixture-key', payload: {}, producerIdentity: 'fixture', reviewerIdentity: null, createdAt: '2026-11-05T00:00:00Z' }], completeness: { complete: false, gapCodes: [] }, freshness: 'stale', source: 'evidence-dag', scientificReview: {
  coverage: 'recorded-links-only', bounded: true, coverageDetails: { indexRevision: 8, indexedChains: 2, indexedDeltas: 99, scannedDeltas: 12, totalRelevantDeltas: 45, queryNodes: 123, extractionNodes: 456, omittedRecords: 2, reasons: ['bounded-fixture'] },
  impacts: [{ recordDigest: digest, closureDigest: digest, status: 'requires-review', affectedIds: ['claim'], affected: [{ id: 'claim', title: 'Affected conclusion' }], changes: [{ digest, sourceId: 'input', reason: 'changed input' }] }], conditions: ['independence', 'controls', 'negative-results', 'reproduction', 'scope'].map(axis => ({ axis, status: 'unknown', observations: [] })) } })
function spec(snapshotDigest = digest, conclusionId = 'claim') {
  return sciforgeReproSpecSchema.parse({ schemaVersion: 'sciforge.rerun.v1', specId: 'fixture', specDigest: snapshotDigest, source: { snapshotDigest, threadId: 'codex:thread /&', conclusionId }, target: { kind: 'conclusion', id: conclusionId }, executionReady: true, reproducibility: 'controlled',
    activities: [{ id: 'analysis', type: 'analysis_run', name: 'Analysis', executor: { kind: 'create-loop', workflow: { id: 'fixture' }, workflowDigest: digest, target: { kind: 'workflow', id: 'fixture' } }, inputs: [{ id: 'input', role: 'input', kind: 'file', required: true, version: snapshotDigest === digest ? 'input-v1' : 'input-v2' }], code: [{ id: 'code', role: 'code', kind: 'file', required: true, version: 'code-v1' }], environments: [{ id: 'env', runtimeVersions: { python: '3.12-fixture' }, lockDigests: [] }], parameterSets: [{ id: 'params', values: { temperature: snapshotDigest === digest ? 300 : 310 }, digest }], tools: [], approvals: [], outputs: [], stochastic: false, inputFingerprint: digest, specFingerprint: digest }], dependencies: [], secretSlots: [], breakpoints: [], createdAt: '2026-11-05T00:00:00Z' })
}
async function mount(element: React.ReactNode) {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  await act(async () => root.render(element))
  const click = async (text: string) => { const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(text)); assert.ok(button, text); await act(async () => button.click()) }
  return { root, container, click, close: async () => { await act(async () => root.unmount()); container.remove() } }
}
test('production invoker interaction previews without executing, explicitly governs execution, compares pinned refs, returns current exact review', async () => {
  const calls: { action: string; input: unknown; options: unknown }[] = []
  let reviewed = 0
  const invoker = { invoke: async (contract: { actionId: string }, input: unknown, options: unknown) => {
    calls.push({ action: contract.actionId, input, options })
    if (contract.actionId === 'evidence-dag.rerun-spec') return spec()
    if (contract.actionId === 'create-loop.run') return { ok: false, message: 'fixture permission refusal' }
    return { baseline: spec(), candidate: spec(candidateDigest, 'candidate'), comparison: { schemaVersion: 'sciforge.rerun-comparison.v1', baselineSpecDigest: digest, candidateSpecDigest: candidateDigest, sameInput: false, sameSpec: false, sameExecutionContext: true, resultMatch: false, comparisonVerifiable: false, classification: 'input_changed', replicationStatus: 'inconclusive', replicationRelation: null, differences: [{ component: 'input', baselineDigest: digest, candidateDigest, reasonCode: 'input_fingerprint_changed' }], reasonCodes: ['execution_spec_changed'] } }
  } } as unknown as DomainRendererCapabilityInvoker
  const m = await mount(<><EvidenceReviewCoverage review={result.scientificReview} /><EvidenceRerunReview result={result} reference={reference} workspaceRoot="/workspace" invoker={invoker} onReview={() => reviewed++} /></>)
  try {
    assert.equal(calls.length, 0); assert.match(m.container.textContent!, /12 \/ .*45/); assert.match(m.container.textContent!, /查询节点 123 \/ 10000/); assert.match(m.container.textContent!, /提取节点 456.*未返回记录 2/)
    const select = m.container.querySelector('select')!; await act(async () => { select.value = select.options[1].value; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await m.click('读取最小')
    assert.deepEqual(calls[0].input, { runtimeId: 'codex', threadId: 'thread /&', closureDigest: digest, conclusionId: 'claim' })
    assert.equal(calls.length, 1); assert.match(m.container.textContent!, /input-v1/); assert.match(m.container.textContent!, /code-v1/); assert.match(m.container.textContent!, /3.12-fixture/)
    await m.click('明确启动')
    assert.equal(calls[1].action, 'create-loop.run'); assert.deepEqual(calls[1].options, { workspaceId: '/workspace', approval: { mode: 'confirmation' } }); assert.deepEqual(calls[1].input, { rerunSpec: spec() })
    assert.match(m.container.textContent!, /refused \/ failed/)
    const inputs = m.container.querySelectorAll('input')
    // React's controlled value tracker requires the native setter in this DOM fixture.
    await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(inputs[0], candidateDigest); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(inputs[1], 'candidate'); inputs[1].dispatchEvent(new Event('input', { bubbles: true })) })
    // change events are used by the browser's native input adapter.
    await act(async () => { inputs[0].dispatchEvent(new Event('change', { bubbles: true })); inputs[1].dispatchEvent(new Event('change', { bubbles: true })) })
    await m.click('比较精确')
    assert.deepEqual(calls[2].input, { runtimeId: 'codex', threadId: 'thread /&', baselineDigest: digest, baselineConclusionId: 'claim', candidateDigest, candidateConclusionId: 'candidate' })
    assert.match(m.container.textContent!, /input-v2/); assert.match(m.container.textContent!, /310/); assert.match(m.container.textContent!, /inconclusive/)
    await m.click('重新审阅当前'); assert.equal(reviewed, 1)
  } finally { await m.close() }
})
test('execution failure and uncertain transport are honestly visible; hidden spec responses cannot enable execution', async () => {
  for (const output of [{ ok: true, runId: 'fixture-run', status: 'error', message: 'executor failed' }, new Error('connection interrupted')]) {
    const invoker = { invoke: async (contract: { actionId: string }) => { if (contract.actionId === 'evidence-dag.rerun-spec') return spec(); if (output instanceof Error) throw output; return output } } as unknown as DomainRendererCapabilityInvoker
    const m = await mount(<EvidenceRerunReview result={result} reference={reference} workspaceRoot="/workspace" invoker={invoker} onReview={() => {}} />)
    try {
      const select = m.container.querySelector('select')!; await act(async () => { select.value = select.options[1].value; select.dispatchEvent(new Event('change', { bubbles: true })) }); await m.click('读取最小'); await m.click('明确启动')
      assert.match(m.container.textContent!, output instanceof Error ? /unknown/ : /failed.*fixture-run/)
    } finally { await m.close() }
  }
  let finish!: (value: unknown) => void
  const invoker = { invoke: async () => new Promise(done => { finish = done }) } as unknown as DomainRendererCapabilityInvoker
  const m = await mount(<EvidenceRerunReview result={result} reference={reference} workspaceRoot="/workspace" invoker={invoker} onReview={() => {}} />)
  try {
    const select = m.container.querySelector('select')!; await act(async () => { select.value = select.options[1].value; select.dispatchEvent(new Event('change', { bubbles: true })) }); await m.click('读取最小')
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => finish(spec())); assert.doesNotMatch(m.container.textContent!, /executionReady=/)
  } finally { await m.close(); Reflect.deleteProperty(document, 'hidden') }
})
test('multiple recorded activities require explicit selection; pending execution remains running until its own receipt', async () => {
  const multi = spec(); multi.activities.push({ ...multi.activities[0], id: 'analysis-2', name: 'second' })
  let finish!: (value: unknown) => void, executed: unknown
  const invoker = { invoke: async (contract: { actionId: string }, input: unknown) => { if (contract.actionId === 'evidence-dag.rerun-spec') return multi; executed = input; return new Promise(done => { finish = done }) } } as unknown as DomainRendererCapabilityInvoker
  const m = await mount(<EvidenceRerunReview result={result} reference={reference} workspaceRoot="/workspace" invoker={invoker} onReview={() => {}} />)
  try {
    const target = m.container.querySelector('select')!; await act(async () => { target.value = target.options[1].value; target.dispatchEvent(new Event('change', { bubbles: true })) }); await m.click('读取最小')
    const start = [...m.container.querySelectorAll('button')].find(button => button.textContent?.includes('明确启动'))!
    assert.equal(start.disabled, true); assert.equal(executed, undefined)
    const activity = m.container.querySelector('[aria-label="执行活动"]') as HTMLSelectElement
    await act(async () => { activity.value = 'analysis-2'; activity.dispatchEvent(new Event('change', { bubbles: true })) }); await m.click('明确启动')
    assert.deepEqual(executed, { rerunSpec: multi, activityId: 'analysis-2' }); assert.match(m.container.textContent!, /running \/ 正在请求/)
    await act(async () => finish({ ok: true, runId: 'fixture-run', status: 'running', message: 'fixture queued' }))
    assert.match(m.container.textContent!, /running.*fixture-run/)
  } finally { await m.close() }
})

const scope = { runtimeId: 'codex', threadId: 'thread', workspaceRoot: '/workspace' }
const source = { ...scope, turnId: 'turn', itemId: 'item', digest: 'a'.repeat(64) }
const view = researchRecordViewOutputSchema.parse({ revision: 1, node: { id: 'node', parentId: 'root', kind: 'event', title: 'fixture', summary: '', origin: 'system', status: 'completed', createdAt: '', updatedAt: '', source }, ancestors: [], children: [], latestRecordPath: [], totalChildren: 0, messages: [], paused: true, model: '', pending: 0, failures: [], coverage: 'visible-session-snapshots', lastScanAt: null, organizationCoverage: { observed: 1, historical: 0, processed: 1, assigned: 1, fullExcerpt: 1, truncated: 0, unavailable: 0, changed: 0, unassigned: 0, pending: 0, blocked: 0 }, sourceRetention: { usageKnown: false, maxBytes: 100, usedBytes: 0, maxEntries: 5, retainedEntries: 0, referencedEntries: 8, inspectedEntries: 3, missingEntries: 1, corruptEntries: 2, rejectedEntries: 3, complete: false, reasons: ['bounded-verification'], policy: 'retain-referenced-no-auto-delete', exportRequired: true } })
const exportValue = { version: 'research-source-export-v1', complete: true, ref: source, raw: { id: 'item', text: 'retained' }, reasons: [], strategy: 'page-authorized-record-nodes; export-one-retained-source-per-view; preserve-ref-and-digest; never-delete-originals' }
test('retention unknown/known and bounded verification stay explicit; complete authorized single source alone enables download', async () => {
  for (const patch of [{}, { sourceRetention: { ...view.sourceRetention!, usageKnown: true, usedBytes: 40 } }]) {
    const invoker = { invoke: async (_contract: unknown, input: unknown) => { assert.deepEqual(input, { ...scope, nodeId: 'node', offset: 0, includeSourceExport: true }); return { ...view, sourceExport: exportValue } } } as unknown as DomainRendererCapabilityInvoker
    const m = await mount(<ResearchSourceRetention view={{ ...view, ...patch }} scope={scope} invoker={invoker} active />)
    try { assert.match(m.container.textContent!, patch.sourceRetention ? /40 \/ 100/ : /UNKNOWN/); assert.match(m.container.textContent!, /引用 8.*已检查 3/); assert.match(m.container.textContent!, /missing 1.*corrupt 2.*rejected 3/); await m.click('请求授权'); assert.match(m.container.textContent!, /下载单项来源/) } finally { await m.close() }
  }
})
test('explicit single-source download preserves exact raw/ref/digest JSON and labels one retained representation', async () => {
  let blob: Blob | undefined, fileName = ''
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL
  const originalClick = browser.HTMLAnchorElement.prototype.click
  URL.createObjectURL = value => { blob = value as Blob; return 'blob:fixture' }
  URL.revokeObjectURL = () => {}
  browser.HTMLAnchorElement.prototype.click = function () { fileName = this.download }
  const invoker = { invoke: async () => ({ ...view, sourceExport: exportValue }) } as unknown as DomainRendererCapabilityInvoker
  const m = await mount(<ResearchSourceRetention view={view} scope={scope} invoker={invoker} active />)
  try {
    await m.click('请求授权'); assert.equal(blob, undefined)
    await m.click('下载单项来源')
    assert.equal(fileName, 'research-retained-source.json')
    assert.deepEqual(JSON.parse(await blob!.text()), exportValue)
    assert.match(m.container.textContent!, /不代表全档案/)
  } finally { await m.close(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; browser.HTMLAnchorElement.prototype.click = originalClick }
})
test('denied/incomplete/raw-missing and mismatched source exports fail closed; late hidden/node/scope exports never download', async () => {
  for (const patch of [{ complete: false, reasons: ['denied'] }, { raw: undefined }, { ref: null, reasons: ['missing'] }, { ref: { ...source, digest: 'b'.repeat(64) } }]) {
    const invoker = { invoke: async () => ({ ...view, sourceExport: { ...exportValue, ...patch } }) } as unknown as DomainRendererCapabilityInvoker
    const m = await mount(<ResearchSourceRetention view={view} scope={scope} invoker={invoker} active />)
    try { await m.click('请求授权'); assert.doesNotMatch(m.container.textContent!, /下载单项来源/); assert.ok(m.container.querySelector('[role=alert]')) } finally { await m.close() }
  }
  for (const change of ['hidden', 'node', 'scope', 'inactive']) {
    let finish!: (value: unknown) => void
    const invoker = { invoke: async () => new Promise(done => { finish = done }) } as unknown as DomainRendererCapabilityInvoker
    const m = await mount(<ResearchSourceRetention view={view} scope={scope} invoker={invoker} active />)
    try {
      await m.click('请求授权')
      if (change === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); await act(async () => document.dispatchEvent(new Event('visibilitychange'))) }
      else await act(async () => m.root.render(<ResearchSourceRetention view={change === 'node' ? { ...view, node: { ...view.node!, id: 'other' } } : view} scope={change === 'scope' ? { ...scope, workspaceRoot: '/other' } : scope} invoker={invoker} active={change !== 'inactive'} />))
      await act(async () => finish({ ...view, sourceExport: exportValue })); assert.doesNotMatch(m.container.textContent!, /下载单项来源/)
    } finally { await m.close(); Reflect.deleteProperty(document, 'hidden') }
  }
})
