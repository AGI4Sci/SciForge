import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { Window } from 'happy-dom'

const html = readFileSync(new URL('../../ui/index.html', import.meta.url), 'utf8')
function source(name: string): string {
  const value = html.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0]
  assert.ok(value, name)
  return value
}
function mount(patch: Record<string, unknown> = {}) {
  const browser = new Window()
  const container = browser.document.createElement('section'); browser.document.body.append(container)
  const payloads: Record<string, unknown>[] = []
  const state = { document: browser.document, currentThread: 'codex:parent', currentSnapshot: { digest: 'sha256:old' }, lastGraph: { nodes: [{ id: 'a', content: '核对处理条件' }, { id: 'b', content: '<script>not executable</script>' }] }, REVIEW_LEVEL_LABEL: { required: '需要核查' }, REVIEW_STATUS_LABEL: { pending: '待处理', approved: '已认可', expired: '已过期' }, api: async (_path: string, input: { body: string }) => { payloads.push(JSON.parse(input.body)); return { ok: true } }, loadGraph: async () => {}, selectNode: (_id: string) => {} }
  const fns = runInNewContext(`const READ_ONLY_GRAPH = false; const Q_DRAFT = false; let graphCanReview = true; const reviewDecisionDrafts = new Map(); let reviewDecisionInFlight = false; ${['esc', 'escAttr', 'compact', 'humanReviewDetailHtml', 'submitHumanReviewDecision', 'bindHumanReviewActions'].map(source).join('\n')}; ({render:humanReviewDetailHtml,submit:submitHumanReviewDecision,bind:bindHumanReviewActions})`, state)
  const review = { level: 'required', status: 'pending', targetIds: ['a', 'b'], reviewPacketId: 'packet:a', blocking: true, score: .9, reasons: [], reviewedBy: '', reviewedAt: '', ...patch }
  const render = () => { container.innerHTML = fns.render(review); fns.bind(container); return container.querySelector('[data-review-packet]')! }
  const group = render()
  const input = group.querySelector('textarea')!
  const confirm = group.querySelector('input')!
  const type = (value: string) => { input.value = value; input.dispatchEvent(new browser.Event('input')) }
  return { browser, container, state, payloads, fns, review, render, group, input, confirm, type }
}

test('decision uses typed rationale and exact snapshot; approval requires whole-scope confirmation', async () => {
  const m = mount()
  try {
    assert.equal(m.container.querySelector('script'), null)
    await m.fns.submit('packet:a', 'approve', m.group)
    assert.equal(m.payloads.length, 0)
    m.type('只检查了一项，需要补原始材料。')
    await m.fns.submit('packet:a', 'approve', m.group)
    assert.equal(m.payloads.length, 0)
    await m.fns.submit('packet:a', 'request_evidence', m.group)
    assert.deepEqual(m.payloads, [{ action: 'request_evidence', expectedSnapshotDigest: 'sha256:old', actor: 'human:evidence-dag-ui', rationale: '只检查了一项，需要补原始材料。' }])
  } finally { m.browser.close() }
})

test('navigation retains drafts only for the same packet and snapshot; stale forms never submit', async () => {
  const m = mount()
  try {
    m.type('保留反例，先不认可。')
    const restored = m.render()
    assert.equal(restored.querySelector('textarea')!.value, '保留反例，先不认可。')
    m.state.currentSnapshot.digest = 'sha256:new'
    await m.fns.submit('packet:a', 'defer', restored)
    assert.equal(m.payloads.length, 0)
    assert.match(restored.textContent!, /版本已变化/)
    assert.equal(m.render().querySelector('textarea')!.value, '')
  } finally { m.browser.close() }
})

test('lost response preserves rationale and identical retry payload; duplicate in-flight clicks are ignored', async () => {
  const m = mount()
  try {
    m.type('已核查所有条件，仅认可当前范围。')
    m.confirm.checked = true
    let reject!: (error: Error) => void
    m.state.api = async (_path, input) => { m.payloads.push(JSON.parse(input.body)); return new Promise((_resolve, fail) => { reject = fail }) }
    const pending = m.fns.submit('packet:a', 'approve', m.group)
    await m.fns.submit('packet:a', 'reject', m.group)
    assert.equal(m.payloads.length, 1)
    reject(new Error('response lost'))
    await pending
    assert.equal(m.input.readOnly, false)
    assert.equal(m.input.value, '已核查所有条件，仅认可当前范围。')
    m.state.api = async (_path, input) => { m.payloads.push(JSON.parse(input.body)); return { ok: true } }
    await m.fns.submit('packet:a', 'approve', m.group)
    assert.deepEqual(m.payloads[0], m.payloads[1])
  } finally { m.browser.close() }
})

test('late errors after a thread switch do not overwrite the new view; historical rationale is escaped', async () => {
  const m = mount()
  try {
    m.type('等待记录')
    let reject!: (error: Error) => void
    m.state.api = async () => new Promise((_resolve, fail) => { reject = fail })
    const pending = m.fns.submit('packet:a', 'defer', m.group)
    m.state.currentThread = 'other'
    reject(new Error('OLD_SCOPE_ERROR'))
    await pending
    assert.doesNotMatch(m.container.textContent!, /OLD_SCOPE_ERROR/)
    const output = m.fns.render({ ...m.review, status: 'approved', reviewRationale: '<img onerror=alert(1)>具体依据', reviewedBy: 'human:a', reviewedAt: 'today' })
    m.container.innerHTML = output
    assert.equal(m.container.querySelector('img'), null)
    assert.match(m.container.textContent!, /具体依据/)
    assert.equal(m.container.querySelector('[data-review-decision]'), null)
  } finally { m.browser.close() }
})

test('node-level risk resolves the complete owning packet instead of approving an empty or partial scope', () => {
  const resolve = runInNewContext(`const READ_ONLY_GRAPH = false; ${['object', 'normalizeReviewSelection', 'reviewReason', 'normalizeHumanReview', 'graphReviewPackets', 'humanReviewForNode'].map(source).join('\n')};humanReviewForNode`, { REVIEW_LEVEL_RANK: { none: 0, optional: 1, recommended: 2, required: 3 } })
  const node = { id: 'one', humanReview: { level: 'required', status: 'pending', score: .9, blocking: true, reviewPacketId: 'packet:all' } }
  const result = resolve(node, { nodes: [node], humanReview: { reviewPackets: [{ ...node.humanReview, targetIds: ['one', 'two'], reviewRationale: 'historical reason' }] } })
  assert.equal(JSON.stringify(result.targetIds), JSON.stringify(['one', 'two']))
  assert.equal(result.reviewRationale, 'historical reason')
})

test('random-audit packet requires an explicit outcome per target and submits typed outcomes', async () => {
  const m = mount({ blocking: false, selection: { mechanism: 'random_audit', frame: 'all_eligible', inclusionProbability: .5, auditRound: 'sha256:round' } })
  try {
    const group = m.group
    assert.match(group.textContent!, /入选概率 50\.0%/)
    assert.equal(group.getAttribute('data-review-audit'), 'true')
    const selects = Array.from(group.querySelectorAll('[data-outcome]')) as unknown as HTMLSelectElement[]
    assert.equal(selects.length, 2)
    const approve = group.querySelector('[data-review-decision="approve"]') as unknown as HTMLButtonElement
    assert.equal(approve.disabled, true)
    m.type('抽样核对两项，其中一项发现来源问题。')
    m.confirm.checked = true; m.confirm.dispatchEvent(new m.browser.Event('change'))
    assert.equal(approve.disabled, true)
    await m.fns.submit('packet:a', 'approve', group)
    assert.equal(m.payloads.length, 0)
    assert.match(group.querySelector('[data-review-feedback]')!.textContent!, /逐项记录全部/)
    selects[0].value = 'none'; selects[0].dispatchEvent(new m.browser.Event('change') as unknown as Event)
    selects[1].value = 'source'; selects[1].dispatchEvent(new m.browser.Event('change') as unknown as Event)
    assert.equal(approve.disabled, false)
    await m.fns.submit('packet:a', 'reject', group)
    assert.equal(m.payloads.length, 1)
    assert.deepEqual((m.payloads[0] as { targetOutcomes: unknown }).targetOutcomes, [
      { targetId: 'a', errorFound: false, errorOrigin: null },
      { targetId: 'b', errorFound: true, errorOrigin: 'source' }
    ])
    await m.fns.submit('packet:a', 'defer', group)
    assert.equal(m.payloads.length, 2)
    assert.equal(Object.hasOwn(m.payloads[1], 'targetOutcomes'), false)
  } finally { m.browser.close() }
})

test('outcome selections survive re-render for the same packet and snapshot', () => {
  const m = mount({ blocking: false, selection: { mechanism: 'random_audit', frame: 'all_eligible', inclusionProbability: .5 } })
  try {
    const selects = Array.from(m.group.querySelectorAll('[data-outcome]')) as unknown as HTMLSelectElement[]
    selects[1].value = 'inherited'; selects[1].dispatchEvent(new m.browser.Event('change') as unknown as Event)
    const out = m.fns.render(m.review)
    assert.match(out, /<option value="inherited" selected>有错误 · 继承自上游/)
  } finally { m.browser.close() }
})
