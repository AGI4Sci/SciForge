import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { Window, type HTMLElement } from 'happy-dom'

const html = readFileSync(new URL('../../ui/index.html', import.meta.url), 'utf8')
function source(name: string): string {
  const value = html.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0]
  assert.ok(value, name)
  return value
}
const labels = html.slice(html.indexOf('const REVIEW_LEVEL_RANK'), html.indexOf('function reviewReason'))
function node(id: string, status = 'pending', blocking = true, level = 'required', score = 0.5) {
  return { id, content: `核对材料 ${id}`, humanReview: { reviewPacketId: `packet:${id}`, level, status, blocking, score, reasons: [{ code: 'failed_check', message: `原始材料缺失 ${id}` }] } }
}
function mount(nodes = [node('a'), node('b'), node('c'), node('d'), node('e')]) {
  const browser = new Window()
  browser.document.body.innerHTML = '<section id="reviewQueue"></section>'
  const selected: string[] = []
  const writes: unknown[] = []
  const state = {
    currentThread: 'thread:a', currentSnapshot: { digest: 'snapshot:a' },
    lastGraph: { nodes, edges: [] }, stageModel: { nodeById: Object.fromEntries(nodes.map(n => [n.id, n])) },
    selectedNodeId: null, previewFeedback: null, blastState: null,
    $: (id: string) => browser.document.getElementById(id),
    paintGraphViewport: () => {}, applyGraphState: () => {}, showNodeDetail: (id: string) => selected.push(id), centerNode: () => {},
    api: (...args: unknown[]) => { writes.push(args); throw new Error('Unexpected network write') }
  }
  const fns = runInNewContext(`const READ_ONLY_GRAPH = false; ${labels}
    let reviewQueueDisclosure = { scope:null, open:new Set() };
    ${['object', 'normalizeReviewSelection', 'esc', 'escAttr', 'compact', 'reviewReason', 'normalizeHumanReview', 'graphReviewPackets', 'humanReviewForNode', 'reviewQueueModel', 'setPanelVisible', 'renderReviewQueue', 'selectNode'].map(source).join('\n')}
    ({render:renderReviewQueue,model:reviewQueueModel})`, state)
  const container = browser.document.querySelector('#reviewQueue') as HTMLElement
  const render = (graph: unknown = state.lastGraph) => fns.render(graph)
  render()
  return { browser, state, selected, writes, container, render, fns }
}

test('production queue defaults to three, exposes all remaining items in original order and counts hidden blockers', () => {
  const m = mount([node('e'), node('d'), node('c'), node('b'), node('a')])
  try {
    assert.equal(m.container.querySelectorAll(':scope > .review-queue-item').length, 3)
    const more = m.container.querySelector('details.review-queue-more')!
    assert.equal(more.hasAttribute('open'), false)
    assert.match(m.container.querySelector('h2 + p')!.textContent!, /共 5 项待处理，其中 5 项阻塞/)
    assert.match(more.querySelector('summary')!.textContent!, /其余 2 项待处理（其中 2 项阻塞/)
    more.querySelector('summary')!.click()
    assert.equal(more.hasAttribute('open'), true)
    assert.deepEqual([...m.container.querySelectorAll('[data-node-id]')].map(n => n.getAttribute('data-node-id')), ['a', 'b', 'c', 'd', 'e'])
    assert.match(m.container.textContent!, /打开材料仅定位核查目标/)
  } finally { m.browser.close() }
})

test('unchanged ordering favors blocking then level then score, excludes only original resolved statuses', () => {
  const m = mount([node('optional', 'pending', true, 'optional'), node('high', 'pending', false, 'required', .9), node('low', 'pending', false, 'required', .1), node('defer', 'deferred'), node('expired', 'expired'), node('approved', 'approved'), node('rejected', 'rejected'), node('none', 'not_needed')])
  try {
    assert.deepEqual([...m.container.querySelectorAll('[data-node-id]')].map(n => n.getAttribute('data-node-id')), ['defer', 'expired', 'optional', 'high', 'low'])
    assert.match(m.container.textContent!, /已暂缓/)
    assert.match(m.container.textContent!, /需复核/)
    assert.match(m.container.textContent!, /原始材料缺失 expired/)
    assert.match(m.container.querySelector('h2 + p')!.textContent!, /共 5 项待处理，其中 3 项阻塞/)
    assert.match(m.container.querySelector('.review-queue-more > summary')!.textContent!, /其中 0 项阻塞/)
    assert.equal(m.container.querySelector('[data-review-decision]'), null)
    assert.doesNotMatch(m.container.textContent!, /0\.90|packet:|规则分数/)
  } finally { m.browser.close() }
})

test('repeated packet remains one queue item with complete scope; malicious text is escaped', () => {
  const a = node('a'), b = node('b')
  b.humanReview.reviewPacketId = a.humanReview.reviewPacketId
  const m = mount([a, b])
  try {
    const graph = { nodes: [a, b], reviewPackets: [{ ...a.humanReview, question: '<img src=x onerror=alert(1)>核对条件', reasons: [{ code: 'bad', message: '<script>bad()</script>失败' }], targetIds: ['a', 'b'] }] }
    m.render(graph)
    assert.equal(m.container.querySelectorAll('[data-node-id]').length, 1)
    assert.equal(m.container.querySelectorAll('script,img').length, 0)
    assert.match(m.container.textContent!, /<img src=x onerror=alert\(1\)>核对条件/)
    assert.match(m.container.textContent!, /范围 2 项材料/)
    assert.equal(m.container.querySelector('.review-queue-more'), null)
    assert.match(m.container.textContent!, /<script>bad\(\)<\/script>失败/)
  } finally { m.browser.close() }
})

test('same thread and snapshot retain disclosure, other scopes and detached toggle events cannot transfer it', () => {
  const m = mount()
  try {
    const oldMore = m.container.querySelector('details.review-queue-more')!
    oldMore.querySelector('summary')!.click()
    ;(m.container.querySelector('.review-queue-item summary') as HTMLElement).click()
    m.render()
    assert.equal(m.container.querySelector('details.review-queue-more')!.hasAttribute('open'), true)
    assert.equal(m.container.querySelector('.review-queue-item details')!.hasAttribute('open'), true)
    m.state.currentSnapshot.digest = 'snapshot:b'
    m.render()
    oldMore.dispatchEvent(new m.browser.Event('toggle'))
    m.render()
    assert.equal(m.container.querySelectorAll('details[open]').length, 0)
    ;(m.container.querySelector('.review-queue-more > summary') as HTMLElement).click()
    m.state.currentThread = 'thread:b'
    m.render()
    assert.equal(m.container.querySelectorAll('details[open]').length, 0)
    m.state.currentThread = 'thread:a'
    m.render()
    assert.equal(m.container.querySelectorAll('details[open]').length, 0)
  } finally { m.browser.close() }
})

test('mouse and keyboard select the original target through production selectNode without any decision write', () => {
  const m = mount()
  try {
    const button = m.container.querySelector('button')!
    button.click()
    for (const key of ['Enter', ' ']) {
      const event = new m.browser.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      button.dispatchEvent(event)
      assert.equal(event.defaultPrevented, true)
    }
    button.dispatchEvent(new m.browser.KeyboardEvent('keydown', { key: 'Escape' }))
    assert.deepEqual(m.selected, ['a', 'a', 'a'])
    assert.equal(m.state.selectedNodeId, 'a')
    assert.deepEqual(m.writes, [])
  } finally { m.browser.close() }
})

test('empty queue does not imply approval or scientific validity and up to three items need no empty disclosure', () => {
  const m = mount([node('a'), node('b'), node('c')])
  try {
    assert.equal(m.container.querySelector('.review-queue-more'), null)
    assert.equal(m.container.querySelectorAll('[data-node-id]').length, 3)
    m.render({ nodes: [node('approved', 'approved')] })
    assert.equal(m.container.style.display, 'none')
    assert.doesNotMatch(m.container.textContent!, /已认可|有效|无风险/)
  } finally { m.browser.close() }
})

test('late old-thread graph responses cannot replace the new scope or snapshot', async () => {
  let finish!: (value: unknown) => void
  const rendered: unknown[] = []
  const state = {
    URLSearchParams, Q_SNAPSHOT: null, Q_ARTIFACT: null, Q_DRAFT: false,
    currentThread: 'a', currentSnapshot: { digest: 'new' }, selectedNodeId: null, blastState: null,
    api: async (path: string) => path.includes('/graph?') ? new Promise(resolve => { finish = resolve }) : { ok: true, data: {} },
    setStatus: () => {}, renderEmptyGraph: (message: string) => { throw new Error(message) },
    showMetrics: () => {}, buildAnalysisMaps: () => {}, showAnalysis: () => {}, renderGraph: (value: unknown) => rendered.push(value), showAuditRun: () => {}, markUpdated: () => {}
  }
  const load = runInNewContext(`const READ_ONLY_GRAPH = false; let graphLoadInFlight=false, graphReloadPending=false; ${source('loadGraph')}; loadGraph`, state)
  const pending = load()
  state.currentThread = 'b'
  finish({ ok: true, data: { graph: { nodes: [], edges: [] }, snapshot: { digest: 'old' } } })
  await pending
  assert.deepEqual(rendered, [])
  assert.equal(state.currentSnapshot.digest, 'new')
})
