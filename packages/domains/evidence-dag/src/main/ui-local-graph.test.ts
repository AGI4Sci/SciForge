import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { Window } from 'happy-dom'

const html = readFileSync(new URL('../../ui/index.html', import.meta.url), 'utf8')
function source(name: string) {
  const value = html.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0]
  assert.ok(value, name)
  return value
}

test('local graph includes both directions and adverse relations; full mode preserves unrelated material', () => {
  const browser = new Window()
  browser.document.body.innerHTML = '<div id="stage"></div><svg id="edgeLayer"></svg><button id="graphScopeToggle"></button><p id="sumHint"></p>'
  const nodes = ['source', 'claim', 'counterexample', 'output', 'other'].map(id => ({ id }))
  const edges = [{ id: 'supports', src: 'source', dst: 'claim', rel: 'supports' }, { id: 'opposes', src: 'counterexample', dst: 'claim', rel: 'contradicts' }, { id: 'downstream', src: 'claim', dst: 'output', rel: 'used' }]
  const painted: { nodes: typeof nodes; edges: typeof edges }[] = []
  const state = { stageModel: { nodes, edges, incoming: { claim: edges.slice(0, 2) }, outgoing: { claim: edges.slice(2) }, width: 800, height: 500 }, selectedNodeId: 'claim', showAllRelations: false,
    $: (id: string) => browser.document.getElementById(id), buildGraphModel: (graph: unknown) => ({ ...(graph as object), width: 400, height: 300 }), renderLanes: () => {}, renderEdges: () => {}, renderNodes: (graph: typeof painted[number]) => painted.push(graph) }
  try {
    const paint = runInNewContext(`${source('paintGraphViewport')}; paintGraphViewport`, state)
    paint()
    assert.deepEqual(painted[0].nodes.map(node => node.id), ['source', 'claim', 'counterexample', 'output'])
    assert.deepEqual(painted[0].edges, edges)
    assert.equal(state.stageModel.nodes.length, 5)
    state.showAllRelations = true
    paint()
    assert.equal(painted[1].nodes.length, 5)
    assert.equal(state.selectedNodeId, 'claim')
    assert.equal(browser.document.getElementById('graphScopeToggle')!.getAttribute('aria-pressed'), 'true')
  } finally { browser.close() }
})

test('late conclusion details cannot write into a replacement inspector with the same node identity', async () => {
  const browser = new Window()
  browser.document.body.innerHTML = '<div id="detailLineage"></div><div id="detailRerunStatus"></div>'
  let release!: (value: unknown) => void
  const deferred = new Promise(resolve => { release = resolve })
  const state = { selectedNodeId: 'claim', $: (id: string) => browser.document.getElementById(id), conclusionQuery: () => ({ base: '/thread', query: 'snapshotDigest=old', cacheKey: 'old' }), api: async () => deferred,
    lineageCoverageHtml: () => 'STALE', rerunStatusHtml: () => 'STALE', rerunSpecCache: new Map() }
  try {
    const load = runInNewContext(`${source('loadConclusionDetails')};loadConclusionDetails`, state)
    const pending = load({ id: 'claim' })
    browser.document.body.innerHTML = '<div id="detailLineage">CURRENT</div><div id="detailRerunStatus">CURRENT</div>'
    release({ ok: true, data: {} })
    await pending
    assert.equal(browser.document.getElementById('detailLineage')!.textContent, 'CURRENT')
    assert.equal(state.rerunSpecCache.size, 0)
  } finally { browser.close() }
})

 test('invalidated and failed nodes keep their adverse state visible alongside any heuristic badges', () => {
  const badges = runInNewContext(`${source('nodeBadges')};nodeBadges`, { humanReviewBadge: () => '', prMap: {}, fragMap: {}, weakMap: {}, lbMap: {}, esc: (value: unknown) => String(value), escAttr: (value: unknown) => String(value) })
  assert.match(badges({ id: 'a', type: 'claim', status: 'invalidated' }), /已失效/)
  assert.match(badges({ id: 'b', type: 'analysis_run', status: 'failed' }), /执行未完成/)
})
