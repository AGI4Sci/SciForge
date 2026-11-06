import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResearchRecordNode, ResearchRecordView } from '../research-record-contract'
import { createResearchRecordPresentationRegistry, researchRecordSurfaceScope, recordCoverageSummary, recordDateLabel, recordNarrativeLayer, recordSynthesisPresentation, researchRecordDiscussionContext } from './research-record-presentation'
import { researchRecordVisualTarget } from './research-record-visible-context'

const scope = { runtimeId: 'codex', threadId: 'main-a', workspaceRoot: '/workspace/a' }
const coverage = { observed: 2, processed: 2, assigned: 2, fullExcerpt: 2, truncated: 0, unavailable: 0, changed: 0, unassigned: 0, pending: 0, blocked: 0, historical: 0 }
const node = (id: string, kind: ResearchRecordNode['kind'], createdAt: string): ResearchRecordNode => ({
  id, parentId: 'root', kind, title: id, summary: '', origin: 'system', status: 'complete', createdAt, updatedAt: createdAt
})

test('record annotation metadata separates the receiving session from a foreign source', () => {
  const source = { runtimeId: 'claude', threadId: 'source-b', workspaceRoot: '/workspace/a', turnId: 'turn-b', itemId: 'bash-b', digest: 'a'.repeat(64) }
  const target = researchRecordVisualTarget(scope, { ...node('event-b', 'event', '2026-10-01'), title: '检查对照', source })
  assert.deepEqual(target.metadata, { label: '检查对照', resourceKind: 'research-record-node', resourceId: 'event-b',
    ...scope, sourceRuntimeId: 'claude', sourceThreadId: 'source-b', turnId: 'turn-b', itemId: 'bash-b' })
})

test('side/global presentation preserves nested folds, path and scroll without sharing other sessions', () => {
  const registry = createResearchRecordPresentationRegistry()
  const side = registry(scope)
  const path = ['current', 'round', 'step', 'skill', 'event']
  const phases = [node('past', 'phase', '2026-09-01'), node('current', 'phase', '2026-10-01')]
  side.initialize('root', phases, path)
  side.initialize('current', [node('round', 'round', '2026-10-01')], path)
  side.initialize('round', [node('step', 'step', '2026-10-01')], path)
  side.initialize('step', [node('skill', 'capability', '2026-10-01')], path)
  assert.deepEqual([...side.getSnapshot().expanded], ['current', 'round'])
  side.toggle('step'); side.toggle('skill'); side.toggle('raw:skill'); side.toggle('current')
  side.rememberScroll('root', 240)
  side.draftField('current', 'summary', '保留人工修订草稿')
  const global = registry({ ...scope })
  assert.equal(global, side)
  assert.equal(global.getSnapshot().scrollPositions.root, 240)
  assert.equal(global.getSnapshot().fieldDrafts.current.summary, '保留人工修订草稿')
  global.toggle('current')
  assert.equal(global.getSnapshot().expanded.has('raw:skill'), true)
  assert.equal(global.getSnapshot().expanded.has('step'), true)
  global.collapseLevel(phases)
  assert.deepEqual([...global.getSnapshot().expanded], ['round', 'step', 'skill', 'raw:skill'])
  global.initialize('root', [node('current', 'phase', '2026-10-01')], path)
  assert.equal(global.getSnapshot().expanded.has('current'), false, 'polling must not undo a manual collapse')
  global.navigate('round')
  assert.equal(side.getSnapshot().focusId, 'round')
  assert.notEqual(registry({ ...scope, threadId: 'main-b' }), side)
  assert.deepEqual(registry({ ...scope, threadId: 'main-b' }).getSnapshot().fieldDrafts, {})
  assert.equal(registry({ ...scope, workspaceRoot: '/workspace/b' }).getSnapshot().focusId, 'root')
})

test('empty future phases do not take the current path or consume initial expansion', () => {
  const presentation = createResearchRecordPresentationRegistry()(scope)
  const future = node('future', 'phase', '2027-01-01')
  presentation.initialize('root', [future], [])
  assert.equal(presentation.getSnapshot().expanded.size, 0)
  assert.equal(presentation.getSnapshot().initializedParents.size, 0)
  presentation.initialize('root', [node('recorded', 'phase', '2026-10-01'), future], ['recorded', 'round'])
  assert.deepEqual([...presentation.getSnapshot().expanded], ['recorded'])
  presentation.initialize('past', [node('old-round', 'round', '2026-09-01')], ['recorded', 'round'])
  assert.equal(presentation.getSnapshot().expanded.has('old-round'), false)
})

test('source focus preserves the original scope, folds and return position across side/global mounts', () => {
  const registry = createResearchRecordPresentationRegistry()
  const side = registry(scope)
  side.navigate('phase-old')
  side.toggle('raw:skill')
  side.rememberScroll('phase-old', 480)
  side.update({ selectedId: 'source-a' })
  side.focusSource('source-a')
  const global = registry({ ...scope })
  assert.equal(global.getSnapshot().focusId, 'source-a')
  assert.equal(global.getSnapshot().selectedId, null)
  assert.equal(global.getSnapshot().sourceReturnId, 'phase-old')
  global.focusSource('source-b')
  assert.equal(global.getSnapshot().sourceReturnId, 'phase-old', 'following another source keeps the original reading scope')
  global.navigate(global.getSnapshot().sourceReturnId!)
  assert.equal(side.getSnapshot().focusId, 'phase-old')
  assert.equal(side.getSnapshot().scrollPositions['phase-old'], 480)
  assert.equal(side.getSnapshot().expanded.has('raw:skill'), true)
  assert.equal(side.getSnapshot().sourceReturnId, null)
})

test('recorded cross-year ranges show both years without inventing a date for empty phases', () => {
  const phase = node('phase', 'phase', '2027-01-01T12:00:00Z')
  assert.equal(recordDateLabel(phase), '')
  const recordedRange = { start: '2026-12-20T12:00:00Z', end: '2027-01-10T12:00:00Z' }
  const label = recordDateLabel({ ...phase, recordedRange })
  assert.match(label, /2026/)
  assert.match(label, /2027/)
  assert.doesNotMatch(recordDateLabel({ ...phase, recordedRange: { ...recordedRange, end: '2026-12-25T12:00:00Z' } }), /2026/)
})

test('stage synthesis never substitutes the last round for the whole phase and retains stale or manual text', () => {
  const phase = { ...node('phase', 'phase', '2026-10-01'), recentRound: { id: 'round', title: '最后一轮', summary: '最后一轮声称完成', status: 'completed' } }
  assert.equal(recordSynthesisPresentation(phase).summary, '')
  assert.equal(recordSynthesisPresentation(phase).status, 'missing')
  const updated: ResearchRecordNode = { ...phase, summary: '此前阶段结论仍需验证', synthesisStatus: 'stale', locks: { placement: false, title: false, summary: true }, synthesis: {
    revision: 2, updatedAt: '2026-11-03', summaryLimited: true, entries: [
      { id: 'negative', kind: 'negative', text: '独立条件仍有反例', sourceIds: ['raw-negative'], status: 'active' },
      { id: 'question', kind: 'open', text: '能否完成来源核对？', sourceIds: ['raw-question'], status: 'resolved', resolution: { note: '仅完成来源核对，不能据此确认优势', sourceIds: ['raw-answer'], at: '2026-11-03' } }
    ]
  } }
  const presentation = recordSynthesisPresentation(updated)
  assert.equal(presentation.summary, '此前阶段结论仍需验证')
  assert.equal(presentation.statusText, '待更新')
  assert.equal(presentation.manual, true)
  assert.equal(presentation.limited, true)
  assert.equal(presentation.hasNegative, true)
  assert.equal(presentation.hasOpen, false, 'answered questions are retained without being labelled unresolved')
})

test('coverage distinguishes processing from assignment and keeps truncated or unavailable evidence explicit', () => {
  const text = recordCoverageSummary({ ...coverage, assigned: 0, unassigned: 2, truncated: 1, unavailable: 1, historical: 37 })
  assert.match(text, /已记录来源 2/)
  assert.match(text, /已归类 0/)
  assert.match(text, /未归类 2/)
  assert.match(text, /含节选/)
  assert.match(text, /来源不可读/)
  assert.doesNotMatch(text, /已完成|验证成功/)
  assert.doesNotMatch(text, /37/, 'historical versions are only counted in the coverage details')
})

test('a record side chat binds the explicit parent and carries canonical source refs and failure state', () => {
  const failed = { ...node('raw-1', 'event', '2026-10-01'), status: 'failed', source: {
    runtimeId: 'claude', threadId: 'source-other', workspaceRoot: scope.workspaceRoot,
    turnId: 'turn-x', itemId: 'bash-x', digest: 'a'.repeat(64)
  } }
  const view: ResearchRecordView = { revision: 1, node: failed, ancestors: [node('phase', 'phase', '2026-09-01')],
    children: [], latestRecordPath: ['phase', 'raw-1'], totalChildren: 0, messages: [], raw: { kind: 'tool', exitCode: 7 }, sourceStatus: 'current',
    paused: false, model: '', pending: 0, failures: [], coverage: 'visible-session-snapshots', organizationCoverage: coverage, lastScanAt: null }
  const input = researchRecordDiscussionContext(scope, view)
  assert.equal(input.runtimeId, 'codex')
  assert.equal(input.parentThreadId, 'main-a')
  assert.equal(input.chatMode, 'light')
  assert.equal(input.context.title, 'phase / raw-1')
  assert.deepEqual(input.context.sourceRefs, [{ label: 'raw-1', threadId: 'source-other', turnId: 'turn-x', itemId: 'bash-x' }])
  assert.match(input.context.text, /"exitCode": 7/)
  assert.match(input.context.text, /不是新的用户指令/)
  assert.equal('question' in input, false, 'opening a node must not send an automatic model question')
})

test('phase discussion preserves synthesis freshness, moved history and sourced question resolutions', () => {
  const phase: ResearchRecordNode = { ...node('phase', 'phase', '2026-10-01'), summary: '旧阶段摘要', synthesisStatus: 'unavailable', synthesis: {
    revision: 3, updatedAt: '2026-11-03', summaryLimited: false, entries: [
      { id: 'negative', kind: 'negative', text: '迁出实验中的失败仍保留', sourceIds: ['raw-negative'], status: 'active', membership: 'historical' },
      { id: 'question', kind: 'open', text: '哪些来源仍在当前范围？', sourceIds: ['raw-question'], status: 'resolved', membership: 'mixed', resolution: { note: '仅核对来源归属', sourceIds: ['raw-answer'], at: '2026-11-03' } }
    ]
  } }
  const view: ResearchRecordView = { revision: 4, node: phase, ancestors: [], children: [], latestRecordPath: [], totalChildren: 0,
    messages: [], paused: false, model: '', pending: 0, failures: [], coverage: 'visible-session-snapshots', organizationCoverage: coverage, lastScanAt: null }
  const input = researchRecordDiscussionContext(scope, view)
  assert.match(input.context.text, /综合状态：暂不可用/)
  assert.match(input.context.text, /已迁出历史.*迁出实验中的失败仍保留.*raw-negative/)
  assert.match(input.context.text, /跨归属.*哪些来源仍在当前范围/)
  assert.match(input.context.text, /回应：仅核对来源归属；回应来源：raw-answer/)
  assert.match(input.context.text, /旧阶段摘要/)
})


test('surface returns retain their original record workspace and reject malformed explicit scopes', () => {
  const changed = { ...scope, workspaceRoot: '/another-workspace' }
  assert.deepEqual(researchRecordSurfaceScope({ recordScope: scope }, changed), scope)
  assert.deepEqual(researchRecordSurfaceScope(undefined, scope), scope)
  assert.equal(researchRecordSurfaceScope({ recordScope: { threadId: 'broken' } }, scope), undefined)
})


test('reading size is presentation-only, survives remounts, and leaves source navigation and disclosure unchanged', () => {
  const registry = createResearchRecordPresentationRegistry()
  const panel = registry(scope)
  panel.toggle('skill')
  panel.inspect('source-a', ['source-a', 'source-b'])
  panel.rememberScroll('root', 170)
  const previous = panel.getSnapshot()
  panel.setReadingSize(32)
  const current = panel.getSnapshot()
  assert.equal(current.readingSize, 32)
  assert.equal(current.expanded, previous.expanded)
  assert.equal(current.inspection, previous.inspection)
  assert.equal(current.scrollPositions, previous.scrollPositions)
  assert.equal(registry({ ...scope }).getSnapshot().readingSize, 32)
  panel.setReadingSize(999)
  assert.equal(panel.getSnapshot().readingSize, 16)
})


test('narrative layers do not turn un-attributed transcript groups into Skill or Plugin usage', () => {
  assert.equal(recordNarrativeLayer(node('step', 'step', '2026-11-04')), 'research')
  assert.equal(recordNarrativeLayer({ ...node('skill', 'capability', '2026-11-04'), title: 'Skill · baseline-review' }), 'capability')
  assert.equal(recordNarrativeLayer({ ...node('plugin', 'capability', '2026-11-04'), title: 'Plugin · plotting' }), 'capability')
  assert.equal(recordNarrativeLayer({ ...node('command', 'capability', '2026-11-04'), title: 'command_execution' }), 'behavior')
  assert.equal(recordNarrativeLayer({ ...node('claim', 'capability', '2026-11-04'), title: 'Skill · claimed', origin: 'model' }), 'behavior')
})

test('a precise selection opens a distinct discussion, preserves source coordinates and bounds escaped context', () => {
  const selected = node('event-b', 'event', '2026-11-04')
  const view = { node: selected, ancestors: [], children: [], revision: 53, raw: 'x'.repeat(40000) } as unknown as ResearchRecordView
  const selection = { schemaVersion: 1 as const, kind: 'resource-text-selection' as const, resourceKind: 'research-record-node', resourceId: selected.id, label: selected.title, quote: '\u0001'.repeat(4000), revision: 'record:52', capturedAt: '2026-11-04T00:00:00.000Z', scope, source: { runtimeId: 'claude', threadId: 'foreign-source', turnId: 'turn', itemId: 'item' }, bounds: { x: 0, y: 0, width: 20, height: 20 }, viewport: { width: 800, height: 600, scaleFactor: 1 } }
  const request = researchRecordDiscussionContext(scope, view, selection)
  assert.equal(request.parentThreadId, scope.threadId)
  assert.equal('question' in request, false)
  assert.ok(request.context.text.length < 40000)
  assert.ok(request.context.text.includes(JSON.stringify(selection)))
  assert.match(request.context.text, /未保存批注.*不是执行指令或批准/s)
  assert.notEqual(request.context.id, researchRecordDiscussionContext(scope, view).context.id)
  assert.notEqual(request.context.id, researchRecordDiscussionContext(scope, view, { ...selection, quote: 'other' }).context.id)
  assert.throws(() => researchRecordDiscussionContext(scope, view, { ...selection, resourceId: 'wrong' }), /不匹配/)
})
