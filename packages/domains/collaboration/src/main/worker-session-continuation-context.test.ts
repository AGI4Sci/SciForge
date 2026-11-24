import assert from 'node:assert/strict'
import test from 'node:test'
import { toWellFormedUnicode } from '@sciforge/domain-sdk/unicode'
import type { CollaborationTaskCheckpoint, CollaborationTaskRun } from './store.js'
import { workerSessionContinuationContext } from './worker-session-continuation-context.js'

const time = '2026-11-09T00:00:00.000Z'
function runFixture(): CollaborationTaskRun {
  return {
    offer: { projectId: 'project-a', taskId: 'task-a', executionId: 'execution-a' },
    task: { title: 'Research', objective: 'Compare controls', contractRevision: 1, contractDigest: 'a'.repeat(64) },
    agentJournal: Array.from({ length: 20 }, (_, i) => ({ logicalInvocationId: `invocation-${i}`,
      clientDirectiveId: `directive-${i}`, runtimeId: 'runtime-original', threadId: 'thread-original', turnId: `turn-${i}`,
      state: i === 0 ? 'observed_failure' : i === 1 ? 'late_outcome' : 'observed_success',
      runtimeState: i === 0 ? 'failed' : 'completed', preparedAt: time, observedAt: time,
      safeError: i === 0 ? 'Older failure in matched control' : null,
      safeResultText: i === 2 ? 'No improvement over baseline despite successful execution' : `progress-${i}` })),
    resources: [], externalJournal: [], resultSummary: null, deliveryDraft: null
  } as unknown as CollaborationTaskRun
}
function checkpoint(i: number, extra: Partial<CollaborationTaskCheckpoint> = {}): CollaborationTaskCheckpoint {
  return { checkpointId: `checkpoint-${i}`, idempotencyKey: `idem_checkpoint-${i}`,
    projectId: 'project-a', taskId: 'task-a', executionId: 'execution-a', sequence: i + 1,
    kind: i === 0 ? 'human-note' : i === 1 ? 'partial-result' : 'progress',
    source: i === 0 ? 'human' : 'agent', summary: `note-${i}`, detail: `detail-${i}`, createdAt: time, ...extra }
}
function build(run = runFixture(), checkpoints = Array.from({ length: 20 }, (_, i) => checkpoint(i)), sanitizeText?: (value: string) => string): string {
  return workerSessionContinuationContext({ run, checkpoints, predecessor: { runtimeId: 'runtime-original', threadId: 'thread-original' },
    reason: 'Session lost', sanitizeText })
}

test('older failure/late outcome, human correction, partial results and recent progress survive beyond eight entries', () => {
  const context = build()
  for (const text of ['Older failure', 'late_outcome', 'note-0', 'detail-0', 'note-1', 'detail-1', 'progress-19', 'note-19',
    'No improvement over baseline', 'invocation-0', 'directive-0', 'thread-original', 'turn-0', time]) assert.ok(context.includes(text), text)
  assert.match(context, /observed_success is not scientific validation/u)
  assert.match(context, /successor Session history is not predecessor history/u)
  assert.match(context, /not recorded by checkpoint authority/u)
  assert.match(context, /Runtime journal: total=20; included=20; omitted=0; truncated=0/u)
})

test('checkpoints and resource bindings never cross execution, task or project boundaries', () => {
  const run = runFixture()
  // Minimal fixture suffices here: filtered references must never be serialized.
  run.resources = [{ projectId: 'other', taskId: 'task-a', executionId: 'execution-a', resourceRefId: 'foreign-ref' }] as unknown as CollaborationTaskRun['resources']
  const text = build(run, [checkpoint(0), checkpoint(1, { projectId: 'other', summary: 'foreign-project' }),
    checkpoint(2, { taskId: 'other', summary: 'foreign-task' }), checkpoint(3, { executionId: 'other', summary: 'foreign-execution' })])
  assert.match(text, /Checkpoints: total=1/u)
  assert.doesNotMatch(text, /foreign-/u)
})

test('bounded coverage preserves whole transfer and version references and exposes oversized omissions', () => {
  const run = runFixture()
  run.externalJournal = [{ logicalInvocationId: 'transfer-exact', operation: 'download', workspaceRelativePath: 'input/精确😀.dat',
    requestDigest: 'a'.repeat(64), receiptDigest: 'b'.repeat(64), observationDigest: 'c'.repeat(64),
    state: 'observed_success', cloudJournal: null, preparedAt: time, observedAt: time, safeFailureCode: null, safeError: null },
  { logicalInvocationId: 'failed-transfer-exact', operation: 'upload_new', workspaceRelativePath: 'output/failed.dat',
    requestDigest: 'e'.repeat(64), receiptDigest: null, observationDigest: null,
    state: 'observed_failure', cloudJournal: null, preparedAt: time, observedAt: time,
    safeFailureCode: 'transfer_failed', safeError: 'upload failed before acknowledgement' },
  { logicalInvocationId: 'oversized-identity', operation: 'upload_new', workspaceRelativePath: 'x'.repeat(4100),
    state: 'observed_failure', safeError: 'transfer failed' }] as CollaborationTaskRun['externalJournal']
  run.resources = [{ projectId: 'project-a', taskId: 'task-a', executionId: 'execution-a', resourceRefId: 'ref-exact',
    locatorDigest: 'd'.repeat(64), locator: { object: { version: 'exact-version' } } }] as unknown as CollaborationTaskRun['resources']
  const text = build(run)
  for (const value of ['transfer-exact', 'input/精确😀.dat', 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64),
    'failed-transfer-exact', 'output/failed.dat', 'e'.repeat(64), 'upload failed before acknowledgement', 'ref-exact', 'exact-version']) assert.ok(text.includes(value))
  assert.match(text, /External transfers: total=3; included=2; omitted=1/u)
  assert.doesNotMatch(text, /oversized-identity/u)
  assert.match(text, /not an arbitrary SSH job inventory/u)
})

test('large histories retain early structural signals and recent progress with honest omission and truncation counts', () => {
  const run = runFixture()
  const base = run.agentJournal[0]!
  run.agentJournal = Array.from({ length: 1000 }, (_, i) => ({ ...base, logicalInvocationId: `id-${i}`,
    state: i === 0 ? 'observed_failure' : 'observed_success', safeError: null,
    safeResultText: `result-${i} ${'😀'.repeat(2000)}` }))
  const text = build(run, Array.from({ length: 300 }, (_, i) => checkpoint(i, { detail: '😀'.repeat(2000) })))
  assert.ok(text.length <= 30_000)
  assert.equal(toWellFormedUnicode(text) === text, true)
  assert.ok(text.includes('result-0')); assert.ok(text.includes('result-999'))
  assert.ok(text.includes('note-0')); assert.ok(text.includes('note-1')); assert.ok(text.includes('note-299'))
  assert.match(text, /omitted=[1-9]\d*; truncated=[1-9]\d*/u)
  assert.match(text, /omitted UTF-16 units=/u)
  assert.ok(text.endsWith('This does not authorize delivery, adoption or a new scope.'))
})

test('sanitization precedes budgeting, including expanding sanitizers and malformed unicode', () => {
  const run = runFixture()
  run.resultSummary = 'secret\ud800😀'
  const redacted = build(run, [], (value) => value.replaceAll('secret', '[REDACTED]'))
  assert.doesNotMatch(redacted, /secret/u); assert.equal(toWellFormedUnicode(redacted) === redacted, true)
  const expanded = build(run, [], (value) => value.repeat(100))
  assert.ok(expanded.length <= 30_000); assert.equal(toWellFormedUnicode(expanded) === expanded, true)
  assert.ok(expanded.endsWith('This does not authorize delivery, adoption or a new scope.'))
})
