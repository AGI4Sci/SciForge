import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecordWindow } from './RecordWindow'
import { RecordLongText } from './RecordLongText'
import { RecordUnderstanding } from './ResearchRecordSummary'
import { RecordSynthesis } from './ResearchRecordSummary'
import { createResearchRecordPresentation } from './research-record-presentation'
import type { ResearchRecordNode } from '../research-record-contract'

test('large windows replace rather than accumulate mounted members and preserve original IDs', () => {
  const presentation = createResearchRecordPresentation()
  const items = Array.from({ length: 100000 }, (_, i) => `original-${i}`)
  const render = () => renderToStaticMarkup(createElement(RecordWindow<string>, {
    items, id: 'large', label: '成员', presentation,
    render: id => createElement('article', { key: id, 'data-member': id }, id)
  }))
  assert.equal((render().match(/data-member=/g) ?? []).length, 20)
  presentation.offset('window:large', 99980)
  const last = render()
  assert.equal((last.match(/data-member=/g) ?? []).length, 20)
  assert.ok(last.includes('original-99999'))
  assert.ok(!last.includes('data-member="original-0"'))
  presentation.offset('window:large', 0)
  assert.ok(render().includes('data-member="original-0"'))
})

test('overview uses sourced entries and preserves stale, historical negative and unknown failure interpretation', () => {
  const node: ResearchRecordNode = { id: 'phase', parentId: 'root', kind: 'phase', title: 'scope', summary: '', status: 'complete', origin: 'system', createdAt: '2026-11-04', updatedAt: '2026-11-04',
    synthesisStatus: 'stale', behaviorCounts: { total: 8, failed: 2, cancelled: 1 }, synthesis: {
      revision: 2, updatedAt: '2026-11-04', summaryLimited: true, entries: [
        { id: 'p', kind: 'progress', text: '仅支持条件 A', status: 'active', sourceIds: ['source-a'] },
        { id: 'n', kind: 'negative', text: '条件 B 失败', status: 'active', sourceIds: ['source-b'] },
        { id: 'old', kind: 'negative', text: '旧失败', status: 'resolved', membership: 'historical', sourceIds: ['source-old'] }
      ]
    }
  }
  const inspected: string[] = []
  const html = renderToStaticMarkup(createElement(RecordUnderstanding, { node, onInspect: id => inspected.push(id) }))
  for (const text of ['仅支持条件 A', '条件 B 失败', '待更新', '节选', '解释状态未知', '历史负例']) assert.ok(html.includes(text), text)
  assert.deepEqual(inspected, [], 'reading never opens or approves a source automatically')
})

test('group collapse is reversible and navigation retains window, draft and per-view reading state', () => {
  const p = createResearchRecordPresentation()
  const node = { id: 'phase-a' } as ResearchRecordNode
  p.toggle(node.id); p.toggle('synthesis:phase-a')
  p.collapseLevel([node])
  assert.equal(p.getSnapshot().expanded.has(node.id), false)
  assert.equal(p.getSnapshot().expanded.has('synthesis:phase-a'), true)
  p.restoreLevel()
  assert.equal(p.getSnapshot().expanded.has(node.id), true)
  p.rememberScroll('root:overview', 300)
  p.draftField(node.id, 'summary', 'unsaved')
  p.offset('window:root', 20)
  p.navigate(node.id); p.back()
  assert.equal(p.getSnapshot().focusId, 'root')
  assert.equal(p.getSnapshot().scrollPositions['root:overview'], 300)
  assert.equal(p.getSnapshot().offsets['window:root'], 20)
  assert.equal(p.getSnapshot().fieldDrafts[node.id].summary, 'unsaved')
})

test('closed long review text has no hidden payload and each mounted segment stays bounded', () => {
  const p = createResearchRecordPresentation()
  const text = 'A'.repeat(15000) + 'ORIGINAL_TAIL'
  const render = () => renderToStaticMarkup(createElement(RecordLongText, { id: 'audit', label: '当次输入', text, presentation: p }))
  assert.ok(!render().includes('AAAA'), 'closed contents are unmounted')
  p.toggle('text:audit')
  assert.ok(!render().includes('ORIGINAL_TAIL'))
  assert.equal((render().match(/A/g) ?? []).length, 6000)
  p.offset('text:audit', 2)
  assert.ok(render().includes('ORIGINAL_TAIL'))
  p.toggle('text:audit')
  assert.ok(!render().includes('ORIGINAL_TAIL'))
})

test('a partial summary page preserves full negative/open counts and exposes old membership mappings without mounting hidden rows', () => {
  const p = createResearchRecordPresentation()
  const node: ResearchRecordNode = { id: 'phase', parentId: 'root', kind: 'phase', title: 'scope', summary: '', status: 'completed', origin: 'system', createdAt: '', updatedAt: '',
    summaryProjection: { version: 'research-record-summary-v1', throughRevision: 7, synthesisRevision: 3, totalEntries: 125, negative: 3, open: 2, totalCoverageMembers: 125, offset: 96, nextOffset: null, limited: true, sourceCoverage: 'gaps' },
    synthesis: { revision: 3, updatedAt: '', summaryLimited: true, entries: [], coveredChildRevisions: Object.fromEntries(Array.from({ length: 29 }, (_, i) => [`old-round-${i}`, i])) } }
  p.toggle('synthesis:phase')
  const html = renderToStaticMarkup(createElement(RecordSynthesis, { node, presentation: p, onInspect: () => undefined, onOffset: () => undefined }))
  assert.match(html, /含负例 3/)
  assert.match(html, /有未决问题 2/)
  assert.match(html, /覆盖映射 125/)
  assert.equal((html.match(/data-coverage-member=/g) ?? []).length, 12)
  assert.ok(!html.includes('data-coverage-member="old-round-28"'))
})
