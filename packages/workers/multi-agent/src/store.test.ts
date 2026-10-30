import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MultiAgentChildRunRecord, type MultiAgentChildRunRecord as MultiAgentChildRunRecordType } from './contract.js'
import { FileMultiAgentStore, InMemoryMultiAgentStore, MULTI_AGENT_RECENT_HISTORY_LIMIT } from './store.js'

test('file store persists child runs and filters by parent thread, turn, and status', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'sciforge-multi-agent-store-'))
  try {
    const store = new FileMultiAgentStore(rootDir)
    await store.upsert(record({
      id: 'child-a',
      parentThreadId: 'thread-1',
      parentTurnId: 'turn-1',
      requestId: 'request-a',
      status: 'completed',
      transcript: [
        { id: 'a-user', kind: 'user_message', text: 'prompt' },
        { id: 'a-assistant', kind: 'assistant_message', text: 'summary' }
      ]
    }))
    await store.upsert(record({
      id: 'child-b',
      parentThreadId: 'thread-1',
      parentTurnId: 'turn-2',
      status: 'failed'
    }))
    await store.upsert(record({
      id: 'child-c',
      parentThreadId: 'thread-2',
      parentTurnId: 'turn-1',
      status: 'running'
    }))

    assert.deepEqual((await store.list({ parentThreadId: 'thread-1' })).map((item) => item.id), ['child-a', 'child-b'])
    assert.deepEqual((await store.list({ parentThreadId: 'thread-1', parentTurnId: 'turn-2' })).map((item) => item.id), ['child-b'])
    assert.deepEqual((await store.list({ status: 'running' })).map((item) => item.id), ['child-c'])
    assert.deepEqual((await store.list({ parentThreadId: 'thread-1', offset: 1, limit: 1 })).map((item) => item.id), ['child-b'])

    assert.equal(await store.get('thread-2', 'child-a'), null)
    const child = await store.get('thread-1', 'child-a')
    assert.equal(child?.id, 'child-a')
    assert.equal((await store.findByRequest('thread-1', 'turn-1', 'request-a'))?.id, 'child-a')
    assert.equal(await store.findByRequest('thread-1', 'turn-2', 'request-a'), null)
    assert.equal(await store.delete('thread-1', 'child-b'), true)
    assert.equal(await store.get('thread-1', 'child-b'), null)
    assert.equal(await store.delete('thread-1', 'child-b'), false)

    const page = await store.readTranscript('thread-1', 'child-a', { offset: 1, limit: 1 })
    assert.equal(page?.total, 2)
    assert.deepEqual(page?.entries.map((entry) => entry.id), ['a-assistant'])

    await writeFile(join(rootDir, 'corrupt.json'), '{bad json', 'utf8')
    const diagnostics = await new FileMultiAgentStore(rootDir).diagnostics()
    assert.equal(diagnostics.records, 2)
    assert.equal(diagnostics.invalidRecords, 1)
    assert.equal(diagnostics.issues[0]?.code, 'store_read_failed')
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('40/200/400/1000 child histories keep pages bounded and exact lookup independent from the recent window', async () => {
  for (const size of [40, 200, 400, 1_000]) {
    const store = new InMemoryMultiAgentStore()
    for (let index = 0; index < size; index += 1) {
      await store.upsert(record({
        id: `child-${String(index).padStart(4, '0')}`,
        parentThreadId: 'scale-thread',
        parentTurnId: `turn-${Math.floor(index / 4)}`,
        status: 'completed',
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
      }))
    }
    await store.upsert(record({
      id: 'active-child',
      parentThreadId: 'scale-thread',
      parentTurnId: 'active-turn',
      status: 'running',
      timestamp: '2025-01-01T00:00:00.000Z',
      threadId: 'active-thread'
    }))

    const first = await store.listPage({ parentThreadId: 'scale-thread', limit: 40 })
    assert.equal(first.records[0]?.id, 'active-child')
    assert.ok(first.records.length <= 41)
    assert.ok(first.records.filter((item) => item.status === 'completed').length <= 40)
    assert.equal(first.historyTruncated, size > 40)
    if (first.nextCursor) {
      const second = await store.listPage({
        parentThreadId: 'scale-thread',
        cursor: first.nextCursor,
        limit: 40
      })
      assert.equal(second.records[0]?.id, 'active-child')
      const firstTerminalIds = new Set(first.records.filter((item) => item.status === 'completed').map((item) => item.id))
      assert.equal(second.records.some((item) => item.status === 'completed' && firstTerminalIds.has(item.id)), false)
    }
    assert.equal((await store.get('scale-thread', 'child-0000'))?.id, 'child-0000')
    assert.equal((await store.findByThreadId('active-thread'))?.id, 'active-child')
    const diagnostics = await store.diagnostics()
    assert.equal(diagnostics.records, size + 1)
    assert.equal(diagnostics.statusCounts.completed, size)
    assert.equal(diagnostics.statusCounts.running, 1)
    assert.equal(diagnostics.scans, 0)
    assert.ok(first.records.length <= Math.min(size, 40) + 1)
    assert.ok(MULTI_AGENT_RECENT_HISTORY_LIMIT >= first.records.length - 1)
  }
})

test('file-store diagnostics and recent pages reuse one bounded warmup scan', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'sciforge-multi-agent-store-cache-'))
  try {
    const writer = new FileMultiAgentStore(rootDir)
    for (let index = 0; index < 40; index += 1) {
      await writer.upsert(record({
        id: `cached-${index}`,
        parentThreadId: 'thread-cache',
        parentTurnId: 'turn-cache',
        status: 'completed',
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
      }))
    }
    const store = new FileMultiAgentStore(rootDir)
    assert.equal((await store.diagnostics()).scans, 1)
    assert.equal((await store.listPage({ parentThreadId: 'thread-cache', limit: 20 })).records.length, 20)
    assert.equal((await store.diagnostics()).scans, 1)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

function record(input: {
  id: string
  parentThreadId: string
  parentTurnId: string
  requestId?: string
  status: MultiAgentChildRunRecordType['status']
  transcript?: MultiAgentChildRunRecordType['transcript']
  timestamp?: string
  threadId?: string
}): MultiAgentChildRunRecordType {
  return MultiAgentChildRunRecord.parse({
    id: input.id,
    parentThreadId: input.parentThreadId,
    parentTurnId: input.parentTurnId,
    requestId: input.requestId,
    prompt: `Prompt for ${input.id}`,
    status: input.status,
    transcript: input.transcript ?? [],
    ...(input.threadId ? { threadRef: { threadId: input.threadId } } : {}),
    createdAt: input.timestamp ?? `2026-06-27T00:00:0${input.id.slice(-1)}.000Z`,
    updatedAt: input.timestamp ?? `2026-06-27T00:00:0${input.id.slice(-1)}.000Z`
  })
}
