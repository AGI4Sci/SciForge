import { describe, expect, it } from 'vitest'
import type { TraceEvent, TraceJsonValue } from '@sciforge/full-trace'
import { capabilityEvalTraceFromEvents } from './trace-adapter'

function event(eventId: string, timestamp: string, value: Record<string, unknown>): TraceEvent {
  return {
    schemaVersion: 'sciforge.trace.v1',
    eventId,
    traceId: 'trace-1',
    source: 'agent-runtime',
    kind: 'agent_event',
    timestamp,
    recordedAt: timestamp,
    payload: { eventKind: 'tool', event: value as TraceJsonValue }
  }
}

describe('capability trace adapter', () => {
  it('extracts discovery, approval ordering, invocation args, and latency', () => {
    const result = capabilityEvalTraceFromEvents([
      event('event-1', '2026-09-15T00:00:00.000Z', {
        kind: 'approval_requested',
        approvalId: 'approval-1',
        toolName: 'paper-radar.sync-arxiv',
        meta: { actionId: 'paper-radar.sync-arxiv', approvalMode: 'confirmation' }
      }),
      event('event-2', '2026-09-15T00:00:00.001Z', {
        kind: 'approval_resolved',
        approvalId: 'approval-1',
        decision: 'allowed'
      }),
      event('event-3', '2026-09-15T00:00:00.010Z', {
        kind: 'tool_event',
        itemId: 'call-1',
        status: 'running',
        toolName: 'sciforge_invoke',
        meta: {
          callId: 'call-1',
          arguments: { maxRecords: 1 },
          actionId: 'paper-radar.sync-arxiv'
        }
      }),
      event('event-4', '2026-09-15T00:00:00.042Z', {
        kind: 'tool_event',
        itemId: 'call-1',
        status: 'success',
        toolName: 'sciforge_invoke',
        meta: {
          callId: 'call-1',
          arguments: { maxRecords: 1 },
          actionId: 'paper-radar.sync-arxiv'
        }
      })
    ])
    expect(result.invocations).toMatchObject([{
      actionId: 'paper-radar.sync-arxiv',
      args: { maxRecords: 1 },
      success: true,
      latencyMs: 32
    }])
    expect(result.authorizationEvents.map((entry) => entry.status)).toEqual(['requested', 'allowed'])
    expect(result.toolCalls).toBe(2)
  })

  it('does not treat opaque operation references as action IDs', () => {
    const result = capabilityEvalTraceFromEvents([event('event-1', '2026-09-15T00:00:00.000Z', {
      kind: 'tool_event',
      itemId: 'call-1',
      status: 'success',
      toolName: 'sciforge_invoke',
      meta: {
        arguments: { operationRef: 'op_opaque-reference' },
        output: { operationRef: 'op_opaque-reference', output: { ok: true } }
      }
    })])
    expect(result.invocations).toEqual([])
    expect(result.unsupported).toEqual(undefined)
  })
})
