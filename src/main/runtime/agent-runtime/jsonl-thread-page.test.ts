import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppDataJsonlStore } from '../../services/app-data-store'
import {
  boundAgentRuntimeEventForDelivery,
  boundedToolExecutionReceipt,
  decodeToolArtifactRef,
  externalizeToolEventDetails,
  externalizeToolDetails,
  readJsonlThreadPage
} from './jsonl-thread-page'

type TestRecord = {
  seq: number
  threadId: string
  turnId?: string
  value: string
}

async function tempStore(): Promise<AppDataJsonlStore> {
  const rootDir = await mkdtemp(join(tmpdir(), 'sciforge-jsonl-page-'))
  return new AppDataJsonlStore({ rootDir, segments: ['events', 'thread.jsonl'] })
}

function parseRecord(line: string): TestRecord | null {
  try {
    return JSON.parse(line) as TestRecord
  } catch {
    return null
  }
}

describe('readJsonlThreadPage', () => {
  it('pages newest complete turn buckets and resumes with an opaque cursor', async () => {
    const store = await tempStore()
    await store.appendJson([
      { seq: 1, threadId: 'thread-1', turnId: 'turn-1', value: 'one-a' },
      { seq: 2, threadId: 'thread-1', turnId: 'turn-1', value: 'one-b' },
      { seq: 3, threadId: 'thread-1', value: 'orphan' },
      { seq: 4, threadId: 'thread-1', turnId: 'turn-2', value: 'two-a' },
      { seq: 5, threadId: 'thread-1', turnId: 'turn-2', value: 'two-b' },
      { seq: 6, threadId: 'thread-1', turnId: 'turn-3', value: 'three' },
      { seq: 7, threadId: 'other-thread', turnId: 'turn-x', value: 'ignored' }
    ])

    const latest = await readJsonlThreadPage({
      store,
      threadId: 'thread-1',
      limit: 2,
      parse: parseRecord,
      turnId: (record) => record.turnId
    })
    expect(latest.records.map((record) => record.seq)).toEqual([4, 5, 6])
    expect(latest.nextCursor).toEqual(expect.any(String))

    const earlier = await readJsonlThreadPage({
      store,
      threadId: 'thread-1',
      cursor: latest.nextCursor!,
      limit: 2,
      parse: parseRecord,
      turnId: (record) => record.turnId
    })
    expect(earlier.records.map((record) => record.seq)).toEqual([1, 2, 3])
    expect(earlier.nextCursor).toBeNull()
  })

  it('clamps page limits and rejects malformed cursors', async () => {
    const store = await tempStore()
    await store.appendJson(Array.from({ length: 105 }, (_, index) => ({
      seq: index + 1,
      threadId: 'thread-1',
      turnId: `turn-${index + 1}`,
      value: String(index + 1)
    })))

    const largest = await readJsonlThreadPage({
      store,
      threadId: 'thread-1',
      limit: 1_000,
      parse: parseRecord,
      turnId: (record) => record.turnId
    })
    expect(largest.records).toHaveLength(100)
    expect(largest.records[0]?.seq).toBe(6)
    expect(largest.nextCursor).toEqual(expect.any(String))

    const smallest = await readJsonlThreadPage({
      store,
      threadId: 'thread-1',
      limit: 0,
      parse: parseRecord,
      turnId: (record) => record.turnId
    })
    expect(smallest.records.map((record) => record.seq)).toEqual([105])

    await expect(readJsonlThreadPage({
      store,
      threadId: 'thread-1',
      cursor: 'not-a-cursor',
      parse: parseRecord,
      turnId: (record) => record.turnId
    })).rejects.toMatchObject({ code: 'invalid_thread_history_cursor' })
  })

  it('continues within one long turn without repeating or materializing the whole turn', async () => {
    const store = await tempStore()
    await store.appendJson(Array.from({ length: 600 }, (_, index) => ({
      seq: index + 1,
      threadId: 'thread-1',
      turnId: 'one-very-long-turn',
      value: `chunk-${index + 1}`
    })))

    const seen: number[] = []
    let cursor: string | undefined
    do {
      const page = await readJsonlThreadPage({
        store,
        threadId: 'thread-1',
        cursor,
        limit: 20,
        maxRecords: 100,
        maxSourceBytes: 1024 * 1024,
        parse: parseRecord,
        turnId: (record) => record.turnId
      })
      expect(page.records.length).toBeLessThanOrEqual(100)
      seen.push(...page.records.map((record) => record.seq))
      cursor = page.nextCursor ?? undefined
    } while (cursor)

    expect(seen).toHaveLength(600)
    expect(new Set(seen).size).toBe(600)
    expect([...seen].sort((left, right) => left - right)).toEqual(
      Array.from({ length: 600 }, (_, index) => index + 1)
    )
  })

  it('stops a long turn at the raw source-byte boundary', async () => {
    const store = await tempStore()
    await store.appendJson(Array.from({ length: 20 }, (_, index) => ({
      seq: index + 1,
      threadId: 'thread-1',
      turnId: 'large-turn',
      value: '界'.repeat(1_000)
    })))

    const page = await readJsonlThreadPage({
      store,
      threadId: 'thread-1',
      limit: 20,
      maxRecords: 100,
      maxSourceBytes: 7_000,
      parse: parseRecord,
      turnId: (record) => record.turnId
    })

    expect(page.records).toHaveLength(2)
    expect(page.records.map((record) => record.seq)).toEqual([19, 20])
    expect(page.nextCursor).toEqual(expect.any(String))
  })
})

describe('tool detail artifacts', () => {
  it('keeps a bounded preview and encodes a byte-accurate artifact reference', () => {
    const detail = 'αβγδεζ'
    const [item] = externalizeToolDetails({
      runtimeId: 'codex',
      threadId: 'thread-1',
      items: [{ id: 'tool-1', kind: 'tool', summary: 'Large tool', detail }],
      maxInlineBytes: 8,
      previewBytes: 6
    })

    expect(item).toMatchObject({
      id: 'tool-1',
      detail: 'αβγ',
      detailArtifact: {
        runtimeId: 'codex',
        threadId: 'thread-1',
        size: Buffer.byteLength(detail, 'utf8')
      }
    })
    expect(decodeToolArtifactRef(item!.detailArtifact!.ref)).toBe('tool-1')
    expect(() => decodeToolArtifactRef('not-a-ref')).toThrow(/Invalid tool artifact reference/)
  })

  it('bounds duplicated metadata and receipt output at the canonical event boundary', () => {
    const detail = 'result'.repeat(8_000)
    const event = externalizeToolEventDetails({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      kind: 'tool_event',
      itemId: 'tool-1',
      status: 'success',
      detail,
      meta: { toolName: 'exec', output: detail, arguments: { prompt: detail } },
      completionReceipts: [{
        contractVersion: 'completion-receipt.v1',
        receiptId: 'receipt-1',
        kind: 'artifact.reference-validation',
        status: 'satisfied',
        issuer: 'test',
        callId: 'tool-1',
        subjectRef: 'artifact-1',
        attestation: detail,
        createdAt: '2026-08-09T00:00:00.000Z'
      }],
      receipt: {
        status: 'success',
        outcome: 'progress',
        output: { nested: detail },
        detail
      }
    })

    expect(event).toMatchObject({
      kind: 'tool_event',
      detail: detail.slice(0, 4_096),
      meta: { toolName: 'exec' },
      detailArtifact: { size: Buffer.byteLength(detail, 'utf8') }
    })
    if (event.kind !== 'tool_event' || event.status !== 'success') throw new Error('unexpected event')
    expect(event.receipt.detail).toHaveLength(4_096)
    expect(event.receipt.output).toBeUndefined()
    expect(event.completionReceipts?.[0]?.attestation).toHaveLength(512)
    expect(Buffer.byteLength(JSON.stringify(event), 'utf8')).toBeLessThan(16_384)
  })

  it('bounds a standalone execution receipt without changing scalar facts', () => {
    const receipt = boundedToolExecutionReceipt({
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'E_BIG',
      output: 'x'.repeat(20_000),
      detail: 'y'.repeat(20_000)
    })
    expect(receipt).toMatchObject({
      status: 'error',
      outcome: 'retryable_error',
      errorCode: 'E_BIG',
      output: undefined,
      detail: 'y'.repeat(4_096)
    })
  })

  it('bounds every opaque event payload while preserving streaming model deltas', () => {
    const huge = '界'.repeat(30_000)
    const events = [
      {
        kind: 'runtime_status', threadId: 'thread-1', runtimeId: 'codex',
        message: huge, metadata: { output: huge, nested: { result: huge }, ok: true }
      },
      {
        kind: 'review_event', threadId: 'thread-1', runtimeId: 'codex', status: 'success',
        title: huge, reviewText: huge, output: { report: huge }
      },
      {
        kind: 'error', threadId: 'thread-1', runtimeId: 'codex', recoverable: true,
        severity: 'error', message: huge, detail: huge
      },
      {
        kind: 'compaction_event', threadId: 'thread-1', runtimeId: 'codex', status: 'success',
        summary: huge, detail: huge, sourceItemIds: Array.from({ length: 500 }, () => huge)
      },
      {
        kind: 'approval_requested', threadId: 'thread-1', runtimeId: 'codex', approvalId: 'approval-1',
        summary: huge, meta: { arguments: huge, output: huge, safe: 1 }
      },
      {
        kind: 'child_event', threadId: 'thread-1', runtimeId: 'codex',
        child: {
          runtimeId: 'codex', parentThreadId: 'thread-1', id: 'child-1', kind: 'agent',
          status: 'running', prompt: huge, summary: huge, metadata: { output: huge },
          transcriptRef: { metadata: { transcript: huge } }
        }
      },
      {
        kind: 'todo_event', threadId: 'thread-1', runtimeId: 'codex',
        items: Array.from({ length: 100 }, (_, index) => ({
          id: `todo-${index}`, content: huge, status: 'pending',
          createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z'
        }))
      }
    ] as const

    for (const event of events) {
      const bounded = boundAgentRuntimeEventForDelivery(event as never)
      expect(Buffer.byteLength(JSON.stringify(bounded), 'utf8')).toBeLessThan(16_384)
    }

    const delta = {
      kind: 'assistant_delta' as const,
      threadId: 'thread-1',
      runtimeId: 'codex' as const,
      itemId: 'assistant-1',
      text: huge
    }
    expect(boundAgentRuntimeEventForDelivery(delta)).toBe(delta)
  })

  it('externalizes tool item snapshots with an artifact reference', () => {
    const detail = 'artifact'.repeat(8_000)
    const event = boundAgentRuntimeEventForDelivery({
      kind: 'item_snapshot',
      runtimeId: 'claude',
      threadId: 'thread-1',
      item: { id: 'tool-snapshot-1', kind: 'tool', detail, meta: { output: detail } }
    })
    if (event.kind !== 'item_snapshot') throw new Error('unexpected event')
    expect(event.item.detailArtifact).toMatchObject({
      runtimeId: 'claude',
      threadId: 'thread-1',
      size: Buffer.byteLength(detail, 'utf8')
    })
    expect(decodeToolArtifactRef(event.item.detailArtifact!.ref)).toBe('tool-snapshot-1')
    expect(Buffer.byteLength(JSON.stringify(event), 'utf8')).toBeLessThan(16_384)
  })
})
