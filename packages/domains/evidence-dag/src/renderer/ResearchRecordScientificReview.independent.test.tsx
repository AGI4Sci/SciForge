import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { ResearchRecordScientificReview } from './ResearchRecordScientificReview'
import { researchAuditEvidenceAuditQueryOutputSchema, type ArtifactVersionRefV1 } from '@sciforge/domain-sdk/research-audit'
import type { ResearchRecordView } from '../research-record-contract'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
const browser = new Window()
before(() => {
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent'] as const) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? browser : browser[name] })
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
})
after(() => browser.close())
const scope = { runtimeId: 'codex', threadId: 'first', workspaceRoot: '/isolated' }
const ref = (id: number): ArtifactVersionRefV1 => ({ artifactId: `artifact:${id}`, versionId: `artifact-version:${id}`, contentDigest: 'a'.repeat(64), byteLength: 9, availability: 'available', retention: 'reference', accessPolicy: { visibility: 'workspace', principals: [], allowExport: false } })
const response = (reference: ArtifactVersionRefV1, marker: string) => researchAuditEvidenceAuditQueryOutputSchema.parse({ subject: { artifactVersionRef: reference }, records: [], completeness: { complete: false, gapCodes: [] }, freshness: 'fresh', source: 'evidence-dag', scientificReview: { coverage: 'recorded-links-only', bounded: false, impacts: [], conditions: ['independence', 'controls', 'negative-results', 'reproduction', 'scope'].map(axis => ({ axis, status: axis === 'controls' ? 'recorded' : 'unknown', observations: axis === 'controls' ? [{ digest: 'sha256:' + 'b'.repeat(64), field: 'controls', text: marker, targetId: 'claim:one', recordDigest: 'sha256:' + 'c'.repeat(64), closureDigest: 'sha256:' + 'd'.repeat(64) }] : [] })) } })
async function mount(invoke: (reference: ArtifactVersionRefV1) => Promise<unknown>, count = 2) {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const refs = Array.from({ length: count }, (_, id) => ref(id))
  const invoker = { invoke: async (_contract: unknown, input: { subject: { artifactVersionRef: ArtifactVersionRefV1 } }) => invoke(input.subject.artifactVersionRef) } as unknown as DomainRendererCapabilityInvoker
  const render = async (overrides: Record<string, unknown> = {}) => { await act(async () => root.render(<ResearchRecordScientificReview view={{ revision: 1, node: { id: 'selected' }, auditReferences: { refs, limited: false } } as unknown as ResearchRecordView} scope={scope} invoker={invoker} {...overrides} />)) }
  await render()
  return { container, render, refs, close: async () => { await act(async () => root.unmount()); container.remove() } }
}
test('mixed success/denial preserves successful reviews and retries only the failed exact ref', async () => {
  const calls = [0, 0]
  const m = await mount(async r => { const id = Number(r.artifactId.split(':')[1]); calls[id]++; if (id === 1 && calls[id] === 1) throw new Error('access-restricted'); return response(r, `SUCCESS_${id}`) })
  try {
    assert.match(m.container.textContent!, /SUCCESS_0/)
    assert.match(m.container.textContent!, /access-restricted/)
    await act(async () => (m.container.querySelector('[data-exact-material="artifact-version:1"] button') as HTMLButtonElement).click())
    assert.deepEqual(calls, [1, 2]); assert.match(m.container.textContent!, /SUCCESS_0/); assert.match(m.container.textContent!, /SUCCESS_1/)
  } finally { await m.close() }
})
test('every canonical identity field fails closed even when version ID and digest match', async () => {
  for (const patch of [{ byteLength: 10 }, { mediaType: 'text/plain' }, { retention: 'snapshot' }, { availability: 'missing' }, { accessPolicy: { visibility: 'public', principals: [], allowExport: false } }, { accessPolicy: { visibility: 'workspace', principals: ['different-principal'], allowExport: false } }, { accessPolicy: { visibility: 'workspace', principals: [], allowExport: true } }]) {
    const m = await mount(async r => response({ ...r, ...patch } as ArtifactVersionRefV1, 'MISMATCH_SECRET'), 1)
    try { assert.doesNotMatch(m.container.textContent!, /MISMATCH_SECRET/); assert.ok(m.container.querySelector('[role=alert]')) } finally { await m.close() }
  }
})
test('concurrency is bounded at three and queued/unsettled responses cannot leak after hiding', async () => {
  let running = 0, peak = 0, calls = 0
  const resolve: (() => void)[] = []
  const m = await mount(async r => { calls++; peak = Math.max(peak, ++running); await new Promise<void>(done => resolve.push(done)); running--; return response(r, 'LATE_SECRET') }, 8)
  try {
    assert.equal(calls, 3); assert.equal(peak, 3)
    await m.render({ active: false })
    await act(async () => { resolve.forEach(done => done()) })
    assert.equal(calls, 3); assert.doesNotMatch(m.container.textContent!, /LATE_SECRET/)
  } finally { await m.close() }
})
test('document visibility cancels pending results and starts fresh exact reads on return', async () => {
  let finish!: (value: unknown) => void; let calls = 0
  const m = await mount(async r => ++calls === 1 ? new Promise(done => { finish = done }) : response(r, 'VISIBLE_RESULT'), 1)
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); finish(response(ref(0), 'HIDDEN_SECRET')) })
    assert.doesNotMatch(m.container.textContent!, /HIDDEN_SECRET/)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    assert.equal(calls, 2); assert.match(m.container.textContent!, /VISIBLE_RESULT/)
  } finally { await m.close(); Reflect.deleteProperty(document, 'hidden') }
})


test('an invoker replacement invalidates pending and successful results before accepting new authority', async () => {
  let finish!: (value: unknown) => void
  const m = await mount(async () => new Promise(done => { finish = done }), 1)
  const nextInvoker = { invoke: async () => response(ref(0), 'NEW_AUTHORITY') } as unknown as DomainRendererCapabilityInvoker
  try {
    await m.render({ invoker: nextInvoker })
    assert.match(m.container.textContent!, /NEW_AUTHORITY/)
    await act(async () => finish(response(ref(0), 'REVOKED_AUTHORITY')))
    assert.doesNotMatch(m.container.textContent!, /REVOKED_AUTHORITY/)
  } finally { await m.close() }
})

test('unsettled old scopes never starve new workspace/runtime/thread/node/revision/invoker or visibility lifecycles', async () => {
  let calls = 0
  const m = await mount(async () => { calls++; return new Promise(() => {}) }, 4)
  try {
    assert.equal(calls, 3)
    for (const next of [
      { scope: { ...scope, workspaceRoot: '/new' } },
      { scope: { ...scope, runtimeId: 'other' } },
      { scope: { ...scope, threadId: 'other' } },
      { view: { revision: 2, node: { id: 'other' }, auditReferences: { refs: m.refs, limited: false } } },
      { view: { revision: 3, node: { id: 'other' }, auditReferences: { refs: m.refs, limited: false } } }
    ]) {
      const before: number = calls
      await m.render(next)
      assert.equal(calls - before, 3)
    }
    await m.render({ active: false })
    const before: number = calls
    await m.render()
    assert.equal(calls - before, 3)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    assert.equal(calls - before, 6)
  } finally { await m.close(); Reflect.deleteProperty(document, 'hidden') }
})
