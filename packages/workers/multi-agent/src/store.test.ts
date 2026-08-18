import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MultiAgentChildRunRecord, type MultiAgentChildRunRecord as MultiAgentChildRunRecordType } from './contract.js'
import { FileMultiAgentStore } from './store.js'

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
    const diagnostics = await store.diagnostics()
    assert.equal(diagnostics.records, 2)
    assert.equal(diagnostics.invalidRecords, 1)
    assert.equal(diagnostics.issues[0]?.code, 'store_read_failed')
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
}): MultiAgentChildRunRecordType {
  return MultiAgentChildRunRecord.parse({
    id: input.id,
    parentThreadId: input.parentThreadId,
    parentTurnId: input.parentTurnId,
    requestId: input.requestId,
    prompt: `Prompt for ${input.id}`,
    status: input.status,
    transcript: input.transcript ?? [],
    createdAt: `2026-06-27T00:00:0${input.id.slice(-1)}.000Z`,
    updatedAt: `2026-06-27T00:00:0${input.id.slice(-1)}.000Z`
  })
}
