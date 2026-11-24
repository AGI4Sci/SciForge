import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import React, { act } from 'react'
let createRoot: typeof import('react-dom/client')['createRoot']
import { Window } from 'happy-dom'
import { ResearchRecordScientificReview } from './ResearchRecordScientificReview'
import { researchAuditEvidenceAuditQueryOutputSchema, type ArtifactVersionRefV1 } from '@sciforge/domain-sdk/research-audit'
import type { ResearchRecordView } from '../research-record-contract'
import type { DomainRendererCapabilityInvoker, DomainWorkbenchOpenSideConversationInput } from '@sciforge/domain-sdk/host'
const browser = new Window()
before(async () => {
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent'] as const) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? browser : browser[name] })
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  ;({ createRoot } = await import('react-dom/client'))
})
after(() => browser.close())

test('material cards offer only viewing and direct discussion, without an inline correction form or dispatch', async () => {
  const requests: DomainWorkbenchOpenSideConversationInput[] = []
  const resources: unknown[] = []
  let reads = 0
  const m = await mount(async r => { reads++; return response(r, '反例尚未处理') }, 1)
  try {
    const button = (text: string) => [...m.container.querySelectorAll('button')].find(item => item.textContent === text)!
    assert.equal(button('讨论').disabled, true)
    await m.render({ workbench: {
      openResource: async (request: unknown) => { resources.push(request); return true },
      openSideConversation: async (request: DomainWorkbenchOpenSideConversationInput) => { requests.push(request); return 'side' }
    } })
    const article = m.container.querySelector('article')!
    const actions = [...article.children].find(element => element.querySelector('button'))!
    assert.deepEqual([...actions.querySelectorAll('button')].map(item => item.textContent), ['查看材料', '讨论'])
    assert.equal(article.querySelector('textarea'), null)
    assert.doesNotMatch(article.textContent!, /提出修正|发送到材料讨论/)
    assert.equal(article.querySelector('details')!.open, false)
    await act(async () => button('查看材料').click())
    assert.deepEqual(resources, [{ sessionId: scope.threadId, resource: { resourceKind: 'artifact-version', resourceId: ref(0).versionId, integrity: { algorithm: 'sha256', expectedDigest: `sha256:${ref(0).contentDigest}` } } }])
    assert.equal(requests.length, 0)
    const before = reads
    await act(async () => button('讨论').click())
    assert.equal(requests.length, 1)
    assert.equal(reads, before)
    assert.equal(resources.length, 1)
    assert.equal(article.querySelector('textarea'), null)
    const request = requests[0]
    assert.equal(Object.hasOwn(request, 'question'), false)
    assert.equal(request.runtimeId, scope.runtimeId)
    assert.equal(request.parentThreadId, scope.threadId)
    assert.equal(request.workspaceRoot, scope.workspaceRoot)
    assert.match(request.context!.text, /反例尚未处理/)
    assert.equal(request.context!.sourceRefs![0].uri, JSON.stringify(ref(0)))
    assert.equal(request.context!.sourceRefs![0].threadId, scope.threadId)
  } finally { await m.close() }
})
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
    try {
      let discussions = 0
      await m.render({ workbench: { openSideConversation: async () => { discussions++; return 'side' } } })
      assert.doesNotMatch(m.container.textContent!, /MISMATCH_SECRET/)
      assert.ok(m.container.querySelector('[role=alert]'))
      assert.equal([...m.container.querySelectorAll('button')].some(button => button.textContent === '讨论'), false)
      assert.equal(discussions, 0)
    } finally { await m.close() }
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

test('focused material discussion opens one exact-parent draft with the previewed context and no automatic question', async () => {
  const calls: unknown[] = []
  const m = await mount(async r => response(r, 'MATCHED_CONTROL'), 1)
  try {
    const workbench = { openSideConversation: async (input: unknown) => { calls.push(input); return true } }
    await m.render({ workbench })
    assert.equal(calls.length, 0)
    const buttons = [...m.container.querySelectorAll('button')]
    const discuss = buttons.find(button => button.textContent === '讨论')!
    assert.ok(discuss)
    const preview = m.container.querySelector('pre')!.textContent
    await act(async () => discuss.click())
    assert.equal(calls.length, 1)
    const input = calls[0] as { parentThreadId: string; runtimeId: string; question?: string; context: { text: string } }
    assert.equal(input.parentThreadId, scope.threadId)
    assert.equal(input.runtimeId, scope.runtimeId)
    assert.equal(input.question, undefined)
    assert.equal(Object.hasOwn(input, 'question'), false)
    assert.equal(input.context.text, preview)
    assert.match(input.context.text, /MATCHED_CONTROL/)
    assert.match(input.context.text, /artifact-version:0/)
  } finally { await m.close() }
})

test('a pending material discussion cannot report an old failure in a new session or open twice', async () => {
  const m = await mount(async r => response(r, 'CONTEXT'), 1)
  let reject!: (error: Error) => void
  let calls = 0
  const workbench = { openSideConversation: async () => { calls++; return new Promise<boolean>((_resolve, fail) => { reject = fail }) } }
  try {
    await m.render({ workbench })
    const discuss = [...m.container.querySelectorAll('button')].find(button => button.textContent === '讨论')!
    await act(async () => { discuss.click(); discuss.click() })
    assert.equal(calls, 1)
    await m.render({ workbench, scope: { ...scope, threadId: 'new-parent' } })
    await act(async () => reject(new Error('OLD_DISCUSSION_FAILURE')))
    assert.doesNotMatch(m.container.textContent!, /OLD_DISCUSSION_FAILURE/)
  } finally { await m.close() }
})

test('unavailable and failed discussion openings stay visible and retry through the same draft entry', async () => {
  const requests: DomainWorkbenchOpenSideConversationInput[] = []
  const m = await mount(async r => response(r, 'UNRESOLVED_COUNTEREXAMPLE'), 1)
  const workbench = { openSideConversation: async (input: DomainWorkbenchOpenSideConversationInput) => {
    requests.push(input)
    if (requests.length === 1) return null
    if (requests.length === 2) throw new Error('DISCUSSION_OPEN_FAILED')
    return 'side'
  } }
  try {
    await m.render({ workbench })
    const discuss = () => [...m.container.querySelectorAll('button')].find(button => button.textContent === '讨论')!
    await act(async () => discuss().click())
    assert.equal(requests.length, 1)
    assert.match(m.container.querySelector('[role=alert]')!.textContent!, /侧聊暂不可用，请重试/)
    assert.equal(discuss().disabled, false)
    await act(async () => discuss().click())
    assert.equal(requests.length, 2)
    assert.match(m.container.querySelector('[role=alert]')!.textContent!, /DISCUSSION_OPEN_FAILED/)
    assert.equal(discuss().disabled, false)
    await act(async () => discuss().click())
    assert.equal(requests.length, 3)
    assert.equal(m.container.querySelector('[role=alert]'), null)
    assert.deepEqual(requests, [requests[0], requests[0], requests[0]])
    assert.equal(Object.hasOwn(requests[0], 'question'), false)
    assert.match(requests[0].context!.text, /UNRESOLVED_COUNTEREXAMPLE/)
  } finally { await m.close() }
})

test('hidden discussion entries cannot open or surface a late failure after visibility returns', async () => {
  const m = await mount(async r => response(r, 'VISIBLE_CONTEXT'), 1)
  let reject!: (error: Error) => void
  let calls = 0
  const workbench = { openSideConversation: async () => {
    if (++calls === 1) return new Promise<string>((_resolve, fail) => { reject = fail })
    return 'side'
  } }
  try {
    await m.render({ workbench })
    const discuss = [...m.container.querySelectorAll('button')].find(button => button.textContent === '讨论')!
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await act(async () => discuss.click())
    assert.equal(calls, 0)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    await act(async () => discuss.click())
    assert.equal(calls, 1)
    assert.equal(discuss.disabled, true)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    assert.equal(m.container.querySelector('article'), null)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => reject(new Error('HIDDEN_DISCUSSION_FAILURE')))
    assert.doesNotMatch(m.container.textContent!, /HIDDEN_DISCUSSION_FAILURE/)
    assert.equal(calls, 1)
    const current = [...m.container.querySelectorAll('button')].find(button => button.textContent === '讨论')!
    assert.equal(current.disabled, false)
    await act(async () => current.click())
    assert.equal(calls, 2)
  } finally { await m.close(); Reflect.deleteProperty(document, 'hidden') }
})
