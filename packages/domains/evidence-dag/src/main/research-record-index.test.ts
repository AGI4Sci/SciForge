import assert from 'node:assert/strict'
import test from 'node:test'
import { buildResearchRecordIndex } from './research-record-index.js'
import type { ResearchRecordNode } from '../research-record-contract.js'

function node(id: string, parentId: string, kind: ResearchRecordNode['kind'], extra: Partial<ResearchRecordNode> = {}): ResearchRecordNode {
  return { id, parentId, kind, title: id, summary: '', origin: 'system', status: 'unknown', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra }
}
const source = { runtimeId: 'codex', threadId: 'thread', workspaceRoot: '/research', turnId: 'turn', itemId: 'tool', digest: 'a'.repeat(64) }

test('one revision index preserves nested source ranges, unique events and failure counts without changing observations', () => {
  const nodes = Object.fromEntries([
    node('history', 'root', 'phase', { createdAt: '2099-01-01T00:00:00Z' }),
    node('child', 'history', 'phase'), node('r1', 'child', 'round', { status: 'failed', summary: 'retain negative result' }),
    node('step', 'r1', 'step'), node('tool-v1', 'step', 'event', { source, createdAt: '2026-01-02T10:00:00+08:00' }),
    node('tool-v2', 'step', 'event', { source: { ...source, digest: 'b'.repeat(64) }, createdAt: '2026-01-02T03:00:00Z' }),
    node('active', 'root', 'phase'), node('r2', 'active', 'round', { status: 'completed' }),
    node('result', 'r2', 'event', { source: { ...source, turnId: 'later', itemId: 'result' }, createdAt: '2026-01-03T00:00:00Z' }),
    node('planned', 'root', 'phase', { createdAt: '2100-01-01T00:00:00Z' })
  ].map(value => [value.id, value]))
  const before = structuredClone(nodes)
  const index = buildResearchRecordIndex(nodes)
  const chapter = index.project(nodes.history)
  assert.deepEqual(chapter.counts, { rounds: 1, failedRounds: 1, events: 1 })
  assert.deepEqual(chapter.recordedRange, { start: '2026-01-02T10:00:00+08:00', end: '2026-01-02T03:00:00Z' })
  assert.equal(chapter.recentRound?.summary, 'retain negative result')
  assert.deepEqual(index.latestRecordPath(), ['active', 'r2', 'result'])
  assert.deepEqual(index.project(nodes.planned).counts, { rounds: 0, failedRounds: 0, events: 0 })
  assert.equal(index.project(nodes.planned).recordedRange, undefined)
  assert.deepEqual(index.children('root').map(value => value.id), ['history', 'active', 'planned'])
  assert.deepEqual(index.ancestors('tool-v1').map(value => value.id), ['history', 'child', 'r1', 'step', 'tool-v1'])
  assert.deepEqual(index.descendants('child').map(value => value.id), ['child', 'r1', 'step', 'tool-v1', 'tool-v2'])
  assert.deepEqual(nodes, before)
})

test('rebuilding after a phase move drops stale projections and preserves source identity', () => {
  const nodes = { a: node('a', 'root', 'phase'), b: node('b', 'root', 'phase'), r: node('r', 'a', 'round'), e: node('e', 'r', 'event', { source }) }
  const first = buildResearchRecordIndex(nodes)
  assert.equal(first.project(nodes.a).counts?.rounds, 1)
  nodes.r.parentId = 'b'
  Object.assign(nodes.a, first.project(nodes.a))
  const next = buildResearchRecordIndex(nodes)
  assert.equal(next.project(nodes.a).counts?.rounds, 0)
  assert.equal(next.project(nodes.a).recentRound, undefined)
  assert.equal(next.project(nodes.a).recordedRange, undefined)
  assert.equal(next.project(nodes.b).counts?.events, 1)
  assert.deepEqual(next.latestRecordPath(), ['b', 'r', 'e'])
  assert.deepEqual(nodes.e.source, source)
})

test('malformed forests are explicit and unknown nodes are not treated as empty chapters', () => {
  assert.throws(() => buildResearchRecordIndex({ a: node('a', 'missing', 'phase') }), /父级不存在/)
  assert.throws(() => buildResearchRecordIndex({ a: node('a', 'b', 'phase'), b: node('b', 'a', 'phase') }), /循环/)
  assert.throws(() => buildResearchRecordIndex({ wrong: node('a', 'root', 'phase') }), /标识/)
  const index = buildResearchRecordIndex({})
  assert.deepEqual(index.descendants('root'), [])
  assert.throws(() => index.children('missing'), /不存在/)
})


test('completed rounds retain failed and cancelled behavior counts at every collapsed ancestor without mutating facts', () => {
  const nodes = Object.fromEntries([
    node('phase', 'root', 'phase'), node('round', 'phase', 'round', { status: 'completed' }),
    node('step', 'round', 'step'), node('skill', 'step', 'capability', { title: 'Skill · test' }),
    node('failure', 'skill', 'event', { source, status: 'failed' }),
    node('cancelled', 'skill', 'event', { source: { ...source, itemId: 'cancel' }, status: 'interrupted' }),
    node('success', 'skill', 'event', { source: { ...source, itemId: 'success' }, status: 'success' })
  ].map(value => [value.id, value]))
  const before = structuredClone(nodes)
  const index = buildResearchRecordIndex(nodes)
  for (const id of ['phase', 'round', 'step', 'skill']) assert.deepEqual(index.project(nodes[id]).behaviorCounts, { total: 3, failed: 1, cancelled: 1 })
  assert.equal(index.project(nodes.phase).counts?.failedRounds, 0, 'successful round is not relabelled as failed')
  assert.deepEqual(nodes, before)
  const { failure: _removed, ...withoutFailure } = nodes
  Object.assign(withoutFailure.skill, index.project(nodes.skill))
  assert.deepEqual(buildResearchRecordIndex(withoutFailure).project(withoutFailure.skill).behaviorCounts, { total: 2, failed: 0, cancelled: 1 })
})
