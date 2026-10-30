import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { appendWorkTurnDiagnostic, FileWorkRecordStore, InMemoryWorkRecordStore, WorkRecord, WORK_TURN_DIAGNOSTIC_LIMIT } from './work-record.js'

const base = (overrides: Record<string, unknown> = {}) => WorkRecord.parse({
  workId: 'work-1', runtimeId: 'codex', threadId: 'thread-1', objective: 'finish the deliverable',
  createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z', ...overrides
})

test('continuations are idempotent, serialized, and bounded at three attempts', async () => {
  const store = new InMemoryWorkRecordStore()
  await store.upsert(base())
  const first = await store.enqueueContinuation({ workId: 'work-1', idempotencyKey: 'turn-1', reason: 'provider completed' })
  assert.equal(first?.created, true)
  const duplicate = await store.enqueueContinuation({ workId: 'work-1', idempotencyKey: 'turn-1' })
  assert.equal(duplicate?.created, false)
  assert.equal(duplicate?.continuation.idempotencyKey, 'turn-1')
  assert.equal((await store.markContinuationRunning('work-1', 'turn-1', { turnId: 'continuation-1' }))?.deliveryState, 'verifying')
  assert.equal((await store.settleContinuation('work-1', 'turn-1', { status: 'completed', deliveryState: 'needs_continuation' }))?.deliveryState, 'needs_continuation')
  for (let attempt = 2; attempt <= 3; attempt += 1) {
    const next = await store.enqueueContinuation({ workId: 'work-1', idempotencyKey: `turn-${attempt}` })
    assert.equal(next?.created, true)
    await store.settleContinuation('work-1', `turn-${attempt}`, { status: 'completed', deliveryState: attempt === 3 ? 'needs_attention' : 'needs_continuation' })
  }
  assert.equal(await store.enqueueContinuation({ workId: 'work-1', idempotencyKey: 'turn-4' }), null)
  assert.equal((await store.get('work-1'))?.continuationAttempts, 3)
})

test('restart recovery requeues interrupted running continuation without changing work identity', async () => {
  const store = new InMemoryWorkRecordStore()
  await store.upsert(base({ deliveryState: 'verifying', continuationAttempts: 1, continuations: [{
    idempotencyKey: 'turn-1', attempt: 1, status: 'running', turnId: 'turn-1',
    createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:01.000Z'
  }] }))
  const recovered = await store.recoverIncomplete({ now: '2026-09-25T00:00:05.000Z' })
  assert.equal(recovered[0]?.workId, 'work-1')
  assert.equal(recovered[0]?.continuations[0]?.status, 'queued')
  assert.equal(recovered[0]?.continuations[0]?.turnId, 'turn-1')
})

test('restart recovery requeues a continuation even if its terminal event raced into needs_attention', async () => {
  const store = new InMemoryWorkRecordStore()
  await store.upsert(base({ deliveryState: 'needs_attention', continuationAttempts: 1, continuations: [{
    idempotencyKey: 'turn-1', attempt: 1, status: 'running', turnId: 'turn-1',
    createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:01.000Z'
  }] }))
  const recovered = await store.recoverIncomplete({ now: '2026-09-25T00:00:05.000Z' })
  assert.equal(recovered[0]?.workId, 'work-1')
  assert.equal(recovered[0]?.continuations[0]?.status, 'queued')
})

test('file store persists records and recovers after constructing a new store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-work-record-'))
  try {
    const writer = new FileWorkRecordStore(root)
    await writer.upsert(base({
      turnDiagnostics: [{
        turnId: 'provider-turn-1', terminalState: 'completed', recordedAt: '2026-09-25T00:00:01.000Z',
        provider: { source: 'codex_app_server', finishReason: 'max_output_tokens' }
      }]
    }))
    assert.equal((await writer.enqueueContinuation({ workId: 'work-1', idempotencyKey: 'turn-1' }))?.created, true)
    const reader = new FileWorkRecordStore(root)
    assert.equal((await reader.get('work-1'))?.continuations[0]?.idempotencyKey, 'turn-1')
    assert.equal((await reader.get('work-1'))?.turnDiagnostics[0]?.provider.finishReason, 'max_output_tokens')
    await reader.markContinuationRunning('work-1', 'turn-1')
    const recovered = await new FileWorkRecordStore(root).recoverIncomplete({ now: '2026-09-25T00:00:10.000Z' })
    assert.equal(recovered[0]?.continuations[0]?.status, 'queued')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('work records keep only the newest bounded provider turn diagnostics', () => {
  const diagnostics = Array.from({ length: WORK_TURN_DIAGNOSTIC_LIMIT + 3 }, (_, index) => ({
    turnId: `turn-${index}`,
    terminalState: 'completed' as const,
    recordedAt: `2026-09-25T00:00:${String(index).padStart(2, '0')}.000Z`,
    provider: { source: 'unavailable' }
  })).reduce(appendWorkTurnDiagnostic, [])
  assert.equal(diagnostics.length, WORK_TURN_DIAGNOSTIC_LIMIT)
  assert.equal(diagnostics[0]?.turnId, 'turn-3')
  assert.equal(diagnostics.at(-1)?.provider.source, 'unavailable')
})
