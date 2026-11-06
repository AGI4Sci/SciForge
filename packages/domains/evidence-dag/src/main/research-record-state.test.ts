import assert from 'node:assert/strict'
import test from 'node:test'
import { researchRecordClassificationSchema, researchRecordPhaseSynthesisSchema, type ResearchRecordNode } from '../research-record-contract.js'
import { applyStatePatch, projectSynthesisSummary, readResearchRecordState, synthesisContext } from './research-record-state.js'

const node = (id = 'round', kind: ResearchRecordNode['kind'] = 'round'): ResearchRecordNode => ({
  id, parentId: 'root', kind, title: id, summary: '', origin: 'model', status: 'completed', createdAt: '2026-01-01', updatedAt: '2026-01-01'
})

test('v1 migration separates move locks from human fields and preserves every legacy receipt and revision', () => {
  const legacy = { version: 1, workspaceRoot: '/workspace', revision: 4, paused: true, model: '', lastScanAt: null,
    nodes: { round: { ...node(), locked: true, summary: '旧负例未解决' },
      moved: { ...node('moved', 'phase'), locked: true },
      human: { ...node('human', 'phase'), origin: 'human', locked: true, summary: '人工判断' },
      empty: { ...node('empty', 'phase'), origin: 'human', locked: true },
      step: { ...node('step', 'step'), parentId: 'round' }, event: { ...node('event', 'event'), parentId: 'step' } },
    jobs: { round: { fingerprint: 'old', sourceIds: ['event'], classifiedIds: ['event'], done: true, attempts: 0, nextAt: 0 } },
    messages: { root: [] }, receipts: { keep: { digest: 'old', output: { revision: 4 } } }, handoffs: { keep: { bytes: 'unchanged' } },
    history: [{ at: 'old', nodeId: 'round', kind: 'human-edit', value: { summary: 'historical' } }], failures: [] }
  const before = structuredClone(legacy)
  const { state, migrated } = readResearchRecordState(legacy)
  assert.equal(migrated, true)
  assert.deepEqual(state.nodes.round.locks, { placement: true, title: false, summary: false })
  assert.deepEqual(state.nodes.moved.locks, { placement: true, title: false, summary: false })
  assert.deepEqual(state.nodes.human.locks, { placement: true, title: true, summary: true })
  assert.deepEqual(state.nodes.empty.locks, { placement: true, title: true, summary: false })
  assert.equal(state.nodes.round.synthesis?.legacySummary, '旧负例未解决')
  assert.deepEqual(state.jobs.round.semanticPendingIds, ['event'])
  assert.deepEqual(state.jobs.round.fullExcerptIds, [])
  assert.deepEqual(state.handoffs, legacy.handoffs)
  assert.deepEqual(state.receipts, legacy.receipts)
  assert.deepEqual(state.history[0], legacy.history[0])
  assert.equal(state.history.at(-1)?.kind, 'schema-migration-v1-v2')
  assert.equal(readResearchRecordState(state).migrated, false)
  assert.deepEqual(legacy, before)
})

test('patches retain negative evidence and resolve only supplied open entries with new references', () => {
  const target = node()
  applyStatePatch(target, [{ op: 'add', kind: 'negative', text: '基线失败', sourceIds: ['a'] },
    { op: 'add', kind: 'open', text: '原因未明', sourceIds: ['a'] }], new Set(['a']), new Set(), text => text)
  const negative = structuredClone(target.synthesis!.entries[0])
  const open = target.synthesis!.entries[1]
  applyStatePatch(target, [{ op: 'add', kind: 'progress', text: '发现原因', sourceIds: ['b'] },
    { op: 'resolve', entryId: open.id, note: '已定位输入错误', sourceIds: ['b'] }], new Set(['b']), new Set([open.id]), text => text)
  assert.deepEqual(target.synthesis!.entries[0], negative)
  assert.equal(target.synthesis!.entries[1].text, '原因未明')
  assert.equal(target.synthesis!.entries[1].status, 'resolved')
  assert.deepEqual(target.synthesis!.entries[1].resolution?.sourceIds, ['b'])
  const before = structuredClone(target)
  for (const patch of [
    [{ op: 'resolve' as const, entryId: negative.id, note: '删除负例', sourceIds: ['b'] }],
    [{ op: 'resolve' as const, entryId: 'invented', note: '未知项', sourceIds: ['b'] }],
    [{ op: 'add' as const, kind: 'progress' as const, text: '编造来源', sourceIds: ['outside'] }]
  ]) assert.throws(() => applyStatePatch(target, patch, new Set(['b']), new Set([negative.id]), text => text))
  assert.deepEqual(target, before)
})

test('long summaries keep recent progress, unresolved questions and negative evidence without deleting stored entries', () => {
  const target = node()
  target.synthesis = { revision: 1, updatedAt: 'now', summaryLimited: false, legacySummary: 'OLD'.repeat(2500), entries: [] }
  for (let index = 0; index < 100; index++) applyStatePatch(target, [{ op: 'add', kind: 'progress', text: `PROGRESS_${index} ${'x'.repeat(400)}`, sourceIds: ['source'] }], new Set(['source']), new Set(), text => text)
  applyStatePatch(target, [{ op: 'add', kind: 'negative', text: 'NEGATIVE_RETAINED', sourceIds: ['source'] },
    { op: 'add', kind: 'open', text: 'OPEN_RETAINED', sourceIds: ['source'] }], new Set(['source']), new Set(), text => text)
  assert.ok(target.summary.startsWith('进展：PROGRESS_99'))
  assert.match(target.summary, /NEGATIVE_RETAINED/)
  assert.match(target.summary, /OPEN_RETAINED/)
  assert.equal(target.synthesis.entries.length, 102)
  assert.equal(target.synthesis.summaryLimited, true)
  assert.ok(JSON.stringify(synthesisContext(target)).length < 13000)
  const locked = { ...target, summary: '人工固定', locks: { placement: false, title: false, summary: true } }
  projectSynthesisSummary(locked)
  assert.equal(locked.summary, '人工固定')
})

test('a maximum-size resolved runtime entry remains available to bounded phase synthesis', () => {
  const target = node()
  const sources = Array.from({ length: 48 }, (_, index) => `record:${index.toString(16).padStart(32, '0')}`)
  const resolutions = Array.from({ length: 48 }, (_, index) => `record:${(index + 48).toString(16).padStart(32, '0')}`)
  applyStatePatch(target, [{ op: 'add', kind: 'open', text: 'x'.repeat(2000), sourceIds: sources }], new Set(sources), new Set(), text => text)
  const entryId = target.synthesis!.entries[0].id
  applyStatePatch(target, [{ op: 'resolve', entryId, note: 'y'.repeat(2000), sourceIds: resolutions }], new Set(resolutions), new Set([entryId]), text => text)
  const context = synthesisContext(target)
  assert.equal(context.entries.length, 1)
  assert.equal(context.limited, false)
  assert.deepEqual(context.entries[0].resolution?.sourceIds, resolutions)
  assert.ok(JSON.stringify(context).length < 12000)
})

test('empty semantic patches cannot silently finish source backfill or phase synthesis', () => {
  assert.equal(researchRecordClassificationSchema.safeParse({ phasePath: [], title: 'empty', steps: [], statePatch: [] }).success, false)
  assert.equal(researchRecordPhaseSynthesisSchema.safeParse({ statePatch: [] }).success, false)
})
