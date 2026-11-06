import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve, join } from 'node:path'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { researchRecordViewInputSchema, researchRecordReviewInputSchema, researchRecordViewOutputSchema } from '../research-record-contract.js'
import type { ResearchRecordNode } from '../research-record-contract.js'
import { recordHash, type ResearchRecordState } from './research-record-state.js'
import { researchRecordQueryIndex } from './research-record-query.js'
import { reviewResearchRecord } from './research-record-review.js'
import { ResearchRecordStore } from './research-record-store.js'
import { ResearchRecordRuntime } from './research-record.js'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'

const scope = { runtimeId: 'synthetic', threadId: 'thread', workspaceRoot: resolve('synthetic-research') }
function node(id: string, parentId: string, kind: ResearchRecordNode['kind']): ResearchRecordNode {
  return { id, parentId, kind, title: id, summary: '', origin: 'system', status: 'completed', createdAt: '2026-01-01', updatedAt: '2026-01-01' }
}
function fixture() {
  const state: ResearchRecordState = { version: 2, workspaceRoot: scope.workspaceRoot, revision: 7, paused: true, model: '',
    nodes: {}, messages: {}, receipts: {}, handoffs: {}, jobs: {}, phaseJobs: {}, history: [], failures: [], lastScanAt: null }
  for (const id of ['a', 'b']) state.nodes[id] = node(id, 'root', 'phase')
  state.nodes.r = node('r', 'a', 'round')
  state.jobs.r = { fingerprint: '', sourceIds: [], processedIds: [], assignedIds: [], fullExcerptIds: [], truncatedIds: [], unavailableIds: [], changedIds: [], semanticPendingIds: [], attempts: 0, nextAt: 0 }
  for (let i = 0; i < 120; i++) {
    const id = `event-${i}`, n = state.nodes[id] = node(id, 'r', 'event')
    n.source = { ...scope, turnId: 't', itemId: id, digest: 'a'.repeat(64) }
    if (i === 1) n.status = 'failed'
    state.jobs.r.sourceIds.push(id)
    state.jobs.r.processedIds.push(id)
    state.jobs.r.assignedIds.push(id)
    state.history.push({ at: n.createdAt, nodeId: id, kind: 'source-test', value: { after: { summary: 'Needle source change' } } })
  }
  state.jobs.r.unavailableIds.push('event-2')
  state.jobs.r.changedIds.push('event-3')
  state.nodes.r.synthesis = { revision: 3, updatedAt: '2026-01-01', summaryLimited: true,
    entries: Array.from({ length: 120 }, (_, i) => ({ id: `entry-${i}`, kind: i % 2 ? 'negative' : 'open', text: `finding ${i}`, sourceIds: [`event-${i}`], status: 'active' })) }
  state.nodes.a.synthesis = { revision: 1, updatedAt: '', entries: [], summaryLimited: false, coveredChildRevisions: { r: 3 } }
  return { state }
}
function runtimeFixture(t: { after: (fn: () => Promise<void>) => void }, prepare?: (state: ResearchRecordState) => void) {
  const { state } = fixture()
  const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'research-query-')))
  const localScope = { ...scope, workspaceRoot }
  state.workspaceRoot = workspaceRoot
  for (const node of Object.values(state.nodes)) if (node.source) node.source.workspaceRoot = workspaceRoot
  const store = new ResearchRecordStore(join(workspaceRoot, 'evidence-dag', `research-record-${recordHash(workspaceRoot)}.json`), workspaceRoot)
  prepare?.(state)
  store.commit(state)
  const runtime = new ResearchRecordRuntime({ userDataDir: workspaceRoot, pollMs: 60000 })
  const host = { log: () => undefined, agentThreads: {
    list: async () => [], read: async () => ({ id: localScope.threadId, runtimeId: localScope.runtimeId, workspaceRoot, turns: [] })
  } }
  runtime.start(host as unknown as DomainMainRuntimeLifecycleContext, true)
  t.after(() => runtime.close())
  return { state, runtime, host, readStored: () => new ResearchRecordStore(join(workspaceRoot, 'evidence-dag', `research-record-${recordHash(workspaceRoot)}.json`), workspaceRoot).load(), scope: localScope }
}

test('canonical view searches only its subtree, locates stable IDs and binds repeatable cursors to revision and scope', async t => {
  const { state, runtime, readStored, scope } = runtimeFixture(t), before = recordHash(readStored())
  const first = await runtime.view({ ...scope, nodeId: 'a', query: { text: 'event' }, limit: 10 })
  researchRecordViewOutputSchema.parse(first)
  assert.equal(first.totalChildren, 120)
  assert.deepEqual(first.locations![0], { nodeId: 'event-0', ancestorIds: ['a', 'r'] })
  assert.equal(first.page!.indexBuildNodes, 123)
  const input = { ...scope, nodeId: 'a', query: { text: 'event' }, limit: 10, cursor: first.page!.nextCursor! }
  const second = await runtime.view(input), repeat = await runtime.view(input)
  assert.deepEqual(second, repeat)
  assert.equal(second.page!.scanned, 0)
  assert.equal(second.page!.indexBuildNodes, 0)
  assert.equal(second.children[0].id, 'event-10')
  await assert.rejects(runtime.view({ ...input, nodeId: 'b' }), /范围或修订/)
  await assert.rejects(runtime.view({ ...input, threadId: 'another' }), /不匹配/)
  await assert.rejects(runtime.view({ ...input, query: { text: 'different' } }), /范围或修订/)
  await assert.rejects(runtime.view({ ...input, cursor: 'null' }), /游标无效/)
  assert.equal((await runtime.view({ ...scope, nodeId: 'b', query: { text: 'event' } })).totalChildren, 0)
  assert.equal(recordHash(readStored()), before)
  await runtime.edit({ ...scope, requestId: 'new-revision', expectedRevision: state.revision, change: { kind: 'fields', nodeId: 'a', title: 'Changed revision' } })
  await assert.rejects(runtime.view(input), /范围或修订/)
})

test('bounded summary pages and collapsed concerns retain all sources and distinguish gaps from complete audit', async t => {
  const { state, runtime, readStored, scope } = runtimeFixture(t), before = recordHash(readStored())
  const first = await runtime.view({ ...scope, nodeId: 'r' })
  assert.equal(first.node!.synthesis!.entries.length, 48)
  assert.equal(first.node!.synthesis!.entries.at(-1)!.id, 'entry-119')
  assert.equal(first.node!.summaryProjection!.totalEntries, 120)
  assert.deepEqual(first.node!.concernCounts, { negative: 60, open: 60 })
  assert.equal(first.node!.summaryProjection!.sourceCoverage, 'gaps')
  const ids = [...first.node!.synthesis!.entries]
  for (const synthesisOffset of [48, 96]) ids.push(...(await runtime.view({ ...scope, nodeId: 'r', synthesisOffset })).node!.synthesis!.entries)
  assert.equal(new Set(ids.map(entry => entry.id)).size, 120)
  assert.equal(first.auditCoverage!.completeness, 'unknown')
  assert.equal((await runtime.view({ ...scope, nodeId: 'a' })).node!.synthesisStatus, 'unavailable')
  assert.equal(recordHash(readStored()), before)
  assert.equal((await runtime.view({ ...scope, query: { sourceStatus: 'unavailable' } })).children[0].id, 'event-2')
  assert.equal((await runtime.view({ ...scope, query: { sourceStatus: 'changed' } })).children[0].id, 'event-3')
  assert.equal((await runtime.view({ ...scope, query: { concern: 'failed' } })).children.at(-1)!.id, 'event-1')
})

test('review pagination caches one selection, rejects stale or crossed scopes and preserves departed paths', () => {
  const { state } = fixture()
  const input = researchRecordReviewInputSchema.parse({ ...scope, nodeId: 'a', mode: 'history', limit: 9, query: { text: 'needle' } })
  const first = reviewResearchRecord(state, input, 'paused')
  assert.equal(first.total, 120)
  const next = { ...input, cursor: first.page!.nextCursor! }
  const second = reviewResearchRecord(state, next, 'paused')
  assert.equal(second.items[0].sequence, 111)
  assert.equal(second.page!.scanned, 0)
  assert.deepEqual(second, reviewResearchRecord(state, next, 'paused'))
  assert.throws(() => reviewResearchRecord(state, { ...next, nodeId: 'b' }, 'paused'), /范围或修订/)
  state.history.push({ at: '', nodeId: 'event-0', kind: 'human-move', value: { pathBefore: ['b'], pathAfter: ['a', 'r'] } }); state.revision++
  assert.throws(() => reviewResearchRecord(state, next, 'paused'), /范围或修订/)
  const departed = reviewResearchRecord(state, researchRecordReviewInputSchema.parse({ ...scope, nodeId: 'b', mode: 'history' }), 'paused')
  assert.equal(departed.items[0].historical, true)
  assert.equal(departed.items[0].nodeId, 'event-0')
})

test('revision cache refreshes coverage and concern projections without changing durable history', () => {
  const { state } = fixture(), first = researchRecordQueryIndex(state)
  assert.equal(researchRecordQueryIndex(state).built, 0)
  state.jobs.r.unavailableIds = []; state.jobs.r.changedIds = []
  state.nodes.r.synthesis!.entries[0].status = 'resolved'; state.revision++
  const next = researchRecordQueryIndex(state)
  assert.notEqual(next.query, first.query)
  assert.equal(next.query.project(state.nodes.r).concernCounts!.open, 59)
  assert.equal(next.query.project(state.nodes.a).synthesisStatus, 'ready')
  assert.equal(state.history.length, 120)
  assert.equal(researchRecordViewInputSchema.parse(scope).offset, 0)
})


test('messages and summary membership maps page without discarding old versions or large coverage sets', async t => {
  const { state } = fixture()
  state.nodes.a.synthesis!.coveredChildRevisions = Object.fromEntries(Array.from({ length: 125 }, (_, i) => [`round-${i}`, i]))
  const query = researchRecordQueryIndex(state).query
  const first = query.project(state.nodes.a)
  assert.equal(Object.keys(first.synthesis!.coveredChildRevisions!).length, 48)
  assert.equal(first.summaryProjection!.totalCoverageMembers, 125)
  assert.equal(first.summaryProjection!.limited, true)
  const last = query.project(state.nodes.a, 96)
  assert.equal(Object.keys(last.synthesis!.coveredChildRevisions!).length, 29)
  assert.equal(last.summaryProjection!.nextOffset, null)
  const { runtime, scope, readStored } = runtimeFixture(t, state => {
    state.messages.root = Array.from({ length: 45 }, (_, i) => ({ id: `message-${i}`, role: 'assistant', text: 'historical discussion', sourceIds: [], createdAt: '', status: 'complete', requestId: `request-${i}`, scopeDigest: 'legacy', limited: true }))
  })
  const latest = await runtime.view(scope)
  const older = await runtime.view({ ...scope, messageOffset: latest.messageNextOffset! })
  const oldest = await runtime.view({ ...scope, messageOffset: older.messageNextOffset! })
  assert.deepEqual([latest.messages.length, older.messages.length, oldest.messages.length], [20, 20, 5])
  assert.equal(oldest.messageNextOffset, null)
  assert.equal(oldest.messages[0].id, 'message-0')
  assert.equal(readStored()!.messages.root.length, 45)
  assert.equal((await runtime.view({ ...scope, synthesisOffset: 96, nodeId: 'r' })).node!.synthesis!.entries.length, 24)
})

test('history search sees full source-backed text while returning an explicitly limited excerpt', () => {
  const { state } = fixture()
  state.history[0].value = { after: { summary: 'x'.repeat(900) + ' hidden-tail-needle' } }
  const result = reviewResearchRecord(state, researchRecordReviewInputSchema.parse({ ...scope, mode: 'history', query: { text: 'hidden-tail-needle' } }), 'paused')
  assert.equal(result.total, 1)
  assert.equal(result.items[0].limited, true)
  assert.equal(result.items[0].text.length, 700)
})


test('workspace history keeps legacy rows whose node is unavailable and other subtree searches exclude them', () => {
  const { state } = fixture()
  state.history.push({ at: '', nodeId: 'legacy-absent-node', kind: 'legacy', value: {} })
  const all = reviewResearchRecord(state, researchRecordReviewInputSchema.parse({ ...scope, mode: 'history' }), 'paused')
  assert.equal(all.total, 121)
  assert.equal(all.items[0].nodeId, 'legacy-absent-node')
  const subtree = reviewResearchRecord(state, researchRecordReviewInputSchema.parse({ ...scope, nodeId: 'b', mode: 'history' }), 'paused')
  assert.equal(subtree.total, 0)
})

test('review source filtering follows exact cited source IDs and compact counts stay within the selected subtree', () => {
  const { state } = fixture()
  state.history.push({ at: '', nodeId: 'r', kind: 'model-organization', value: { sourceIds: ['event-3'], result: { statePatch: [{ op: 'add', kind: 'negative', text: 'specific changed source', sourceIds: ['event-3'] }] } } })
  state.history.push({ at: '', nodeId: 'r', kind: 'context-boundary', value: {} })
  const result = reviewResearchRecord(state, researchRecordReviewInputSchema.parse({ ...scope, mode: 'history', query: { sourceStatus: 'changed' } }), 'paused')
  assert.equal(result.total, 2)
  assert.deepEqual(result.items.map(item => item.nodeId), ['r', 'event-3'])
  const query = researchRecordQueryIndex(state).query
  assert.equal(query.boundaryCount('a'), 1)
  assert.equal(query.boundaryCount('b'), 0)
})


test('native source await cannot mix a previous page with a newer revision', async t => {
  const { runtime, scope, host, state } = runtimeFixture(t)
  const original = host.agentThreads.read
  let calls = 0, release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const waiting = new Promise<void>(resolve => { entered = resolve })
  host.agentThreads.read = async () => {
    if (++calls === 2) { entered(); await gate }
    return original()
  }
  const pending = runtime.view({ ...scope, nodeId: 'event-0' })
  await waiting
  await runtime.edit({ ...scope, requestId: 'during-source', expectedRevision: state.revision, change: { kind: 'fields', nodeId: 'a', title: 'newer revision' } })
  release()
  await assert.rejects(pending, /记录已更新/)
})
