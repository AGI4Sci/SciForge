import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../src/contracts/items.js'
import { toTraceItems } from '../src/services/evidence-dag-feed.js'

const base = { turnId: 't1', threadId: 'c1', createdAt: '2026-01-01T00:00:00Z' }

describe('toTraceItems', () => {
  it('maps text/reasoning/tool items and drops noise + failed results', () => {
    const items: TurnItem[] = [
      { ...base, id: 'i1', role: 'user', status: 'completed', kind: 'user_message', text: 'hi' },
      { ...base, id: 'i2', role: 'assistant', status: 'completed', kind: 'assistant_text', text: 'answer' },
      { ...base, id: 'i3', role: 'assistant', status: 'completed', kind: 'assistant_reasoning', text: 'thinking' },
      {
        ...base, id: 'i4', role: 'assistant', status: 'completed', kind: 'tool_call',
        toolName: 'web', callId: 'c1', toolKind: 'tool_call', arguments: { q: 'x' }
      },
      {
        ...base, id: 'i5', role: 'tool', status: 'completed', kind: 'tool_result',
        toolName: 'web', callId: 'c1', toolKind: 'tool_call', output: { found: 42 }, isError: false
      },
      {
        ...base, id: 'i6', role: 'tool', status: 'failed', kind: 'tool_result',
        toolName: 'web', callId: 'c2', toolKind: 'tool_call', output: 'boom', isError: true
      },
      { ...base, id: 'i7', role: 'system', status: 'failed', kind: 'error', message: 'oops' }
    ]

    const trace = toTraceItems(items)

    expect(trace.map((t) => t.id)).toEqual(['i1', 'i2', 'i3', 'i4', 'i5']) // i6 (error result) + i7 (error) dropped
    expect(trace[0]).toMatchObject({ type: 'message', role: 'user', content: 'hi' })
    expect(trace[3]).toMatchObject({ type: 'tool_call', tool_name: 'web', arguments: { q: 'x' } })
    expect(trace[4]).toMatchObject({ type: 'tool_result', tool_name: 'web', content: '{"found":42}' })
  })

  it('returns empty for a turn with no evidentiary content', () => {
    const items: TurnItem[] = [
      {
        ...base, id: 'a1', role: 'assistant', status: 'pending', kind: 'approval',
        approvalId: 'ap1', toolName: 'bash', summary: 'run?'
      }
    ]
    expect(toTraceItems(items)).toEqual([])
  })
})
