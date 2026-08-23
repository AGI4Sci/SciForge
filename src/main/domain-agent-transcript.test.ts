import { describe, expect, it } from 'vitest'

import {
  projectDomainAgentTurnMessages,
  subscribeDomainAgentTranscriptMessages
} from './domain-agent-transcript'
import type { AgentRuntimeEvent } from '../shared/agent-runtime-contract'

describe('domain agent transcript projection', () => {
  it('projects accepted user text, visible progress, and the final completed assistant reply', () => {
    expect(projectDomainAgentTurnMessages({
      id: 'turn-1',
      threadId: 'thread-1',
      status: 'completed',
      items: [
        { id: 'user-1', kind: 'user_message', text: ' question ' },
        { id: 'assistant-draft', kind: 'assistant_message', text: 'progress update' },
        { id: 'tool-1', kind: 'tool', text: 'private tool log' },
        { id: 'assistant-final', kind: 'assistant_message', text: ' final answer ' }
      ]
    })).toEqual([
      { itemId: 'user-1', turnId: 'turn-1', kind: 'user-message', text: 'question' },
      { itemId: 'assistant-draft', turnId: 'turn-1', kind: 'assistant-progress', text: 'progress update' },
      { itemId: 'assistant-final', turnId: 'turn-1', kind: 'assistant-final', text: 'final answer' }
    ])
  })

  it('does not project assistant snapshots from failed turns', () => {
    expect(projectDomainAgentTurnMessages({
      id: 'turn-1',
      threadId: 'thread-1',
      status: 'failed',
      items: [{ id: 'assistant-1', kind: 'assistant_message', text: 'partial output' }]
    })).toEqual([])
  })

  it('streams completed visible progress before turn completion and keeps the last message final', async () => {
    const events: AgentRuntimeEvent[] = [
      { kind: 'user_message', runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', itemId: 'user-1', text: 'hello', seq: 4 },
      { kind: 'assistant_delta', runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', itemId: 'assistant-1', text: 'par', seq: 5 },
      {
        kind: 'item_snapshot', runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', seq: 6,
        item: { id: 'assistant-progress', turnId: 'turn-1', kind: 'assistant_message', text: 'working' }
      },
      {
        kind: 'item_snapshot', runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', seq: 7,
        item: { id: 'assistant-1', turnId: 'turn-1', kind: 'assistant_message', text: 'answer' }
      },
      { kind: 'turn_lifecycle', runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', state: 'completed', seq: 8 }
    ]
    const host = {
      async *subscribeEvents() {
        for (const event of events) yield event
      },
      async readThreadSnapshot() {
        return {
          id: 'thread-1',
          runtimeId: 'codex' as const,
          title: 'Thread',
          updatedAt: '2026-08-15T00:00:00.000Z',
          status: 'completed',
          latestSeq: 8,
          turns: [{
            id: 'turn-1',
            threadId: 'thread-1',
            status: 'completed' as const,
            items: [
              { id: 'assistant-progress', kind: 'assistant_message' as const, text: 'working' },
              { id: 'assistant-1', kind: 'assistant_message' as const, text: 'answer' }
            ]
          }]
        }
      }
    }
    const output = []
    for await (const message of subscribeDomainAgentTranscriptMessages(host, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      afterSequence: 3
    })) output.push(message)

    expect(output).toEqual([
      {
        runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', sequence: 4,
        itemId: 'user-1', kind: 'user-message', text: 'hello'
      },
      {
        runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', sequence: 6,
        itemId: 'assistant-progress', kind: 'assistant-progress', text: 'working'
      },
      {
        runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', sequence: 7,
        itemId: 'assistant-1', kind: 'assistant-final', text: 'answer'
      }
    ])
  })

  it('does not publish a sole assistant snapshot before the turn establishes it as final', async () => {
    let releaseCompletion!: () => void
    const completion = new Promise<void>((resolve) => { releaseCompletion = resolve })
    const host = {
      async *subscribeEvents() {
        yield {
          kind: 'item_snapshot', runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', seq: 1,
          item: { id: 'assistant-1', turnId: 'turn-1', kind: 'assistant_message', text: 'answer' }
        } as const
        await completion
        yield {
          kind: 'turn_lifecycle', runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1',
          state: 'completed', seq: 2
        } as const
      },
      async readThreadSnapshot() {
        return {
          id: 'thread-1', runtimeId: 'codex' as const, title: 'Thread',
          updatedAt: '2026-08-15T00:00:00.000Z', status: 'completed', latestSeq: 2,
          turns: [{
            id: 'turn-1', threadId: 'thread-1', status: 'completed' as const,
            items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'answer' }]
          }]
        }
      }
    }
    const iterator = subscribeDomainAgentTranscriptMessages(host, {
      runtimeId: 'codex', threadId: 'thread-1'
    })[Symbol.asyncIterator]()
    const pending = iterator.next()
    await Promise.resolve()
    let settled = false
    void pending.then(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    releaseCompletion()
    await expect(pending).resolves.toMatchObject({
      value: { itemId: 'assistant-1', kind: 'assistant-final', sequence: 1 }
    })
  })
})
