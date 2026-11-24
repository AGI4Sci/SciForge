import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const html = readFileSync(new URL('../../ui/index.html', import.meta.url), 'utf8')
function source(name: string): string {
  const value = html.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) {[\\s\\S]*?\\n}`))?.[0]
  assert.ok(value, name)
  return value
}
function mount(pinned = '', draft = false, missing = false) {
  const calls: string[] = [], rendered: unknown[] = []
  const state = { currentThread: 'thread', Q_SNAPSHOT: pinned || null, Q_ARTIFACT: null, Q_DRAFT: draft,
    READ_ONLY_GRAPH: Boolean(pinned || draft), graphCanReview: false, currentSnapshot: null, selectedNodeId: null, blastState: null,
    graphLoadInFlight: false, graphReloadPending: false, URLSearchParams, encodeURIComponent,
    api: async (path: string) => { calls.push(path); return missing ? { ok: false } : { ok: true, data: { graph: { nodes: [{ id: 'published' }], edges: [] }, snapshot: { digest: pinned || 'current' } } } },
    setStatus: () => {}, renderEmptyGraph: (message: string) => rendered.push(message), renderGraph: (graph: unknown) => rendered.push(graph),
    showMetrics: (value: unknown) => { if (pinned || draft) assert.equal(value, null) }, buildAnalysisMaps: () => {}, showAnalysis: () => {}, showAuditRun: () => {}, markUpdated: () => {}
  }
  const fns = runInNewContext(['loadGraph', 'pollChanges', 'runAuditNow', 'whatIf', 'submitHumanReviewDecision'].map(source).join('\n') + '\n({loadGraph,pollChanges,runAuditNow,whatIf,submitHumanReviewDecision})', state)
  return { state, calls, rendered, fns }
}

test('published graph is default and staging is an explicit read-only choice', async () => {
  const current = mount()
  await current.fns.loadGraph()
  assert.equal(current.calls.some(path => path.includes('/staging')), false)
  const draft = mount('', true)
  await draft.fns.loadGraph()
  assert.deepEqual(draft.calls, ['/threads/thread/staging'])
  assert.equal(draft.state.currentSnapshot, null)
  await draft.fns.runAuditNow()
  await draft.fns.submitHumanReviewDecision()
  assert.equal(draft.calls.length, 1)
})

test('pinned load and refresh keep exact digest without current auxiliary data or writes', async () => {
  const m = mount('sha256:fixed')
  await m.fns.loadGraph()
  await m.fns.pollChanges()
  await m.fns.runAuditNow()
  await m.fns.whatIf('node')
  await m.fns.submitHumanReviewDecision()
  await m.fns.loadGraph()
  assert.deepEqual(m.calls, ['/threads/thread/graph?snapshotDigest=sha256%3Afixed', '/threads/thread/graph?snapshotDigest=sha256%3Afixed'])
  const absent = mount('sha256:absent', false, true)
  await absent.fns.loadGraph()
  assert.equal(absent.calls.length, 1)
  assert.match(String(absent.rendered[0]), /不会切换/)
})
