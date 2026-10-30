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
  it('retains unresolved capability requests for evidence without inventing an action identity', () => {
    const trace = capabilityEvalTraceFromEvents([
      event('start', '2026-09-15T00:00:00.000Z', {
        kind: 'tool_event', callId: 'unresolved', toolName: 'sciforge_invoke', status: 'running',
        meta: { arguments: { operationRef: 'op_unknown', input: { query: 'test' } } }
      }),
      event('end', '2026-09-15T00:00:00.010Z', {
        kind: 'tool_event', callId: 'unresolved', toolName: 'sciforge_invoke', status: 'error',
        errorCode: 'non_serializable_output'
      }),
      event('duplicate-end', '2026-09-15T00:00:00.011Z', {
        kind: 'tool_event', callId: 'unresolved', toolName: 'sciforge_invoke', status: 'error'
      }),
      event('other-tool', '2026-09-15T00:00:00.020Z', {
        kind: 'tool_event', callId: 'other', toolName: 'read_file', status: 'success'
      })
    ])
    expect(trace.invocations).toMatchObject([{
      operationRef: 'op_unknown',
      identityStatus: 'unresolved',
      outcome: 'failure',
      success: false
    }])
    expect(trace.toolCalls).toBe(2)
    expect(trace.capabilityToolCalls).toBe(1)
    expect(trace.unresolvedActionCount).toBe(1)
    expect(trace.toolCallDetails).toEqual([
      {
        callId: 'unresolved', toolName: 'sciforge_invoke', status: 'error', sequence: 0,
        args: { operationRef: 'op_unknown', input: { query: 'test' } },
        operationRef: 'op_unknown', errorCode: 'non_serializable_output'
      },
      { callId: 'other', toolName: 'read_file', status: 'success', sequence: 3 }
    ])
  })

  it('captures assistant output for final-answer inspection', () => {
    const trace = capabilityEvalTraceFromEvents([
      event('assistant-delta-1', '2026-09-15T00:00:00.000Z', {
        kind: 'assistant_delta', itemId: 'assistant-delta-1', text: 'partial '
      }),
      event('assistant-snapshot-1', '2026-09-15T00:00:00.010Z', {
        kind: 'item_snapshot', item: {
          id: 'assistant-message-1', kind: 'assistant_message', text: 'final answer'
        }
      })
    ])
    expect(trace.assistantMessages).toEqual(['final answer'])
    expect(trace.finalAnswer).toBe('final answer')
  })

  it('normalizes full-trace token usage for efficiency reporting', () => {
    const trace = capabilityEvalTraceFromEvents([
      event('usage-1', '2026-09-15T00:00:00.000Z', {
        kind: 'usage', inputTokens: 10, outputTokens: 5, totalTokens: 15
      }),
      event('usage-2', '2026-09-15T00:00:00.010Z', {
        kind: 'usage', inputTokens: 4, outputTokens: 3
      })
    ])
    expect(trace.usage).toEqual({ inputTokens: 14, outputTokens: 8, totalTokens: 22 })
  })

  it('retains fatal runtime errors over a later completed lifecycle event', () => {
    const trace = capabilityEvalTraceFromEvents([
      event('runtime-error', '2026-09-15T00:00:00.000Z', {
        kind: 'error', recoverable: false, severity: 'error',
        code: 'provider_usage_limit', message: 'Provider usage limit reached.'
      }),
      event('turn-failed', '2026-09-15T00:00:00.010Z', {
        kind: 'turn_lifecycle', state: 'failed'
      }),
      event('turn-completed', '2026-09-15T00:00:00.020Z', {
        kind: 'turn_lifecycle', state: 'completed'
      })
    ])

    expect(trace.executionStatus).toBe('failed')
    expect(trace.executionError).toBe('provider_usage_limit: Provider usage limit reached.')
  })

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
      authorizationSequence: 3,
      latencyMs: 32
    }])
    expect(result.authorizationEvents.map((entry) => entry.status)).toEqual(['requested', 'allowed'])
    expect(result.toolCalls).toBe(1)
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
    expect(result.invocations).toMatchObject([{
      operationRef: 'op_opaque-reference',
      identityStatus: 'unresolved',
      outcome: 'success',
      success: true
    }])
    expect(result.unsupported).toEqual(undefined)
  })

  it('does not treat descriptor tags as action IDs', () => {
    const result = capabilityEvalTraceFromEvents([event('event-1', '2026-09-15T00:00:00.000Z', {
      kind: 'tool_event',
      itemId: 'call-1',
      status: 'success',
      toolName: 'sciforge_discover',
      detail: JSON.stringify([{ operationRef: 'op_opaque-reference', tags: ['paper-radar', 'external-write'] }])
    })])
    expect(result.discoveredActions).toEqual([])
    expect(result.discoveryEvidenceStatus).toBe('partial')
  })

  it('marks a discovery result with opaque operation references as partial evidence', () => {
    const result = capabilityEvalTraceFromEvents([
      event('event-1', '2026-09-15T00:00:00.000Z', {
        kind: 'tool_event',
        itemId: 'discover-1',
        status: 'success',
        toolName: 'sciforge_discover',
        detail: JSON.stringify([{ operationRef: 'op_opaque-reference', title: 'Search papers' }])
      })
    ])
    expect(result.discoveredActions).toEqual([])
    expect(result.discoveryEvidenceStatus).toBe('partial')
  })

  it('keeps complete discovery evidence after a recoverable empty query', () => {
    const result = capabilityEvalTraceFromEvents([
      event('event-1', '2026-09-15T00:00:00.000Z', {
        kind: 'tool_event',
        itemId: 'discover-empty',
        status: 'error',
        toolName: 'sciforge_discover',
        errorCode: 'capability_discovery_empty'
      }),
      event('event-2', '2026-09-15T00:00:00.010Z', {
        kind: 'tool_event',
        itemId: 'discover-success',
        status: 'success',
        toolName: 'sciforge_discover',
        detail: JSON.stringify([{ operationRef: 'op_join' }])
      }),
      event('event-3', '2026-09-15T00:00:00.020Z', {
        kind: 'tool_event',
        itemId: 'invoke-join',
        callId: 'invoke-join',
        status: 'success',
        toolName: 'sciforge_invoke',
        meta: {
          callId: 'invoke-join',
          arguments: { operationRef: 'op_join', input: {} }
        },
        detail: JSON.stringify({ capabilityId: 'dataset-api.join', output: { ok: true } })
      })
    ])
    expect(result.discoveredActions).toEqual(['dataset-api.join'])
    expect(result.discoveryEvidenceStatus).toBe('complete')
  })

  it('uses the generated Registry set to exclude Runtime Tool names from Capability actions', () => {
    const result = capabilityEvalTraceFromEvents([event('event-1', '2026-09-15T00:00:00.000Z', {
      kind: 'tool_event',
      itemId: 'discover-1',
      status: 'success',
      toolName: 'sciforge_discover',
      detail: JSON.stringify([{ id: 'visual_generate' }, { id: 'paper-radar.search' }])
    })], { knownActionIds: new Set(['paper-radar.search']) })
    expect(result.discoveredActions).toEqual(['paper-radar.search'])
  })

  it('unwraps capability input from the sciforge_invoke envelope', () => {
    const result = capabilityEvalTraceFromEvents([
      event('event-1', '2026-09-15T00:00:00.000Z', {
        kind: 'tool_event',
        itemId: 'call-1',
        status: 'running',
        toolName: 'sciforge_invoke',
        meta: {
          callId: 'call-1',
          actionId: 'paper-radar.search',
          arguments: { operationRef: 'op_opaque-reference', input: { query: 'AlphaFold 3' } }
        }
      }),
      event('event-2', '2026-09-15T00:00:00.010Z', {
        kind: 'tool_event',
        itemId: 'call-1',
        status: 'success',
        toolName: 'sciforge_invoke',
        meta: {
          callId: 'call-1',
          actionId: 'paper-radar.search',
          arguments: { operationRef: 'op_opaque-reference', input: { query: 'AlphaFold 3' } }
        }
      })
    ])
    expect(result.invocations).toMatchObject([{ args: { query: 'AlphaFold 3' } }])
  })

  it('retains structured capability output from a serialized Host receipt', () => {
    const receipt = JSON.stringify([{
      type: 'inputText',
      text: JSON.stringify({
        capabilityId: 'paper-radar.search',
        operationRef: 'op_search',
        output: { ok: true, data: { count: 2, papers: [{ id: 'paper-1' }] } }
      })
    }])
    const result = capabilityEvalTraceFromEvents([
      event('event-1', '2026-09-15T00:00:00.000Z', {
        kind: 'tool_event',
        itemId: 'call-1',
        status: 'success',
        toolName: 'sciforge_invoke',
        meta: {
          callId: 'call-1',
          arguments: { operationRef: 'op_search', input: { query: 'AlphaFold 3' } }
        },
        receipt: { output: receipt }
      })
    ], { knownActionIds: new Set(['paper-radar.search']) })

    expect(result.invocations).toMatchObject([{
      actionId: 'paper-radar.search',
      output: { ok: true, data: { count: 2, papers: [{ id: 'paper-1' }] } }
    }])
    expect(result.toolCallDetails).toMatchObject([{
      output: { ok: true, data: { count: 2, papers: [{ id: 'paper-1' }] } }
    }])
  })

  it('maps a discovered operationRef to the capability ID from its later invocation receipt', () => {
    const result = capabilityEvalTraceFromEvents([
      event('event-1', '2026-09-15T00:00:00.000Z', {
        kind: 'tool_event',
        itemId: 'discover-1',
        status: 'success',
        toolName: 'sciforge_discover',
        detail: JSON.stringify([{ operationRef: 'op_status', title: 'Read Paper Radar status' }])
      }),
      event('event-2', '2026-09-15T00:00:00.010Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        status: 'running',
        toolName: 'sciforge_invoke',
        meta: {
          callId: 'invoke-1',
          arguments: { operationRef: 'op_status', input: {} }
        }
      }),
      event('event-3', '2026-09-15T00:00:00.020Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        status: 'success',
        toolName: 'sciforge_invoke',
        meta: {
          callId: 'invoke-1',
          arguments: { operationRef: 'op_status', input: {} }
        },
        detail: JSON.stringify({ capabilityId: 'paper-radar.status', output: { ok: true } })
      })
    ])
    expect(result.discoveredActions).toEqual(['paper-radar.status'])
    expect(result.discoveryEvidenceStatus).toBe('complete')
    expect(result.invocations).toMatchObject([{ actionId: 'paper-radar.status', success: true }])
    expect(result.toolCallDetails).toMatchObject([
      { toolName: 'sciforge_discover' },
      { toolName: 'sciforge_invoke', actionId: 'paper-radar.status', status: 'success' }
    ])
  })

  it('does not treat unselected opaque discovery candidates as unresolved evidence', () => {
    const result = capabilityEvalTraceFromEvents([
      event('event-1', '2026-09-15T00:00:00.000Z', {
        kind: 'tool_event',
        itemId: 'discover-1',
        status: 'success',
        toolName: 'sciforge_discover',
        detail: JSON.stringify([
          { operationRef: 'op_selected', title: 'Selected operation' },
          { operationRef: 'op_unselected', title: 'Unselected operation' }
        ])
      }),
      event('event-2', '2026-09-15T00:00:00.010Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        status: 'running',
        toolName: 'sciforge_invoke',
        meta: { arguments: { operationRef: 'op_selected', input: {} } }
      }),
      event('event-3', '2026-09-15T00:00:00.020Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        status: 'success',
        toolName: 'sciforge_invoke',
        meta: { arguments: { operationRef: 'op_selected', input: {} } },
        detail: JSON.stringify({ capabilityId: 'paper-radar.status', output: { ok: true } })
      })
    ])
    expect(result.discoveryEvidenceStatus).toBe('complete')
    expect(result.discoveredActions).toEqual(['paper-radar.status'])
  })

  it('backfills an earlier failed logical invocation from a later operationRef receipt', () => {
    const result = capabilityEvalTraceFromEvents([
      event('event-1', '2026-09-15T00:00:00.000Z', {
        kind: 'tool_event',
        itemId: 'discover-1',
        status: 'success',
        toolName: 'sciforge_discover',
        detail: JSON.stringify([{ operationRef: 'op_search', title: 'Search Paper Radar papers' }])
      }),
      event('event-2', '2026-09-15T00:00:00.010Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        status: 'running',
        toolName: 'sciforge_invoke',
        meta: {
          arguments: { operationRef: 'op_search', input: { query: 'AlphaFold 3', limit: 10 } }
        }
      }),
      event('event-3', '2026-09-15T00:00:00.020Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        status: 'error',
        errorCode: 'invalid_input',
        toolName: 'sciforge_invoke',
        meta: {
          arguments: { operationRef: 'op_search', input: { query: 'AlphaFold 3', limit: 10 } }
        }
      }),
      event('event-4', '2026-09-15T00:00:00.030Z', {
        kind: 'tool_event',
        itemId: 'invoke-2',
        callId: 'invoke-2',
        status: 'success',
        toolName: 'sciforge_invoke',
        meta: {
          arguments: { operationRef: 'op_search', input: { query: 'AlphaFold 3', topK: 5 } }
        },
        detail: JSON.stringify({ capabilityId: 'paper-radar.search', output: { ok: true } })
      })
    ])

    expect(result.invocations).toMatchObject([
      { actionId: 'paper-radar.search', success: false, errorCode: 'invalid_input' },
      { actionId: 'paper-radar.search', success: true }
    ])
  })

  it('uses the Host capability identity on failed invocations and backfills discovery', () => {
    const result = capabilityEvalTraceFromEvents([
      event('event-1', '2026-09-15T00:00:00.000Z', {
        kind: 'tool_event',
        itemId: 'discover-1',
        status: 'success',
        toolName: 'sciforge_discover',
        detail: JSON.stringify([{ operationRef: 'op_search', title: 'Search papers' }])
      }),
      event('event-2', '2026-09-15T00:00:00.010Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        status: 'running',
        toolName: 'sciforge_invoke',
        meta: {
          callId: 'invoke-1',
          arguments: { operationRef: 'op_search', input: { query: 'AlphaFold 3' } }
        }
      }),
      event('event-3', '2026-09-15T00:00:00.020Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        status: 'error',
        toolName: 'sciforge_invoke',
        errorCode: 'non_serializable_output',
        meta: {
          callId: 'invoke-1',
          arguments: { operationRef: 'op_search', input: { query: 'AlphaFold 3' } },
          capabilityIdentity: {
            operationRef: 'op_search',
            capabilityId: 'paper-radar.search'
          }
        }
      })
    ])

    expect(result.discoveredActions).toEqual(['paper-radar.search'])
    expect(result.invocations).toMatchObject([{
      actionId: 'paper-radar.search',
      success: false,
      errorCode: 'non_serializable_output',
      args: { query: 'AlphaFold 3' }
    }])
    expect(result.toolCallDetails).toEqual(expect.arrayContaining([expect.objectContaining({
      callId: 'invoke-1',
      actionId: 'paper-radar.search',
      operationRef: 'op_search'
    })]))
  })

  it('keeps conflicting operation references unresolved', () => {
    const result = capabilityEvalTraceFromEvents([
      event('discover-1', '2026-09-15T00:00:00.000Z', {
        kind: 'tool_event', itemId: 'discover-1', status: 'success', toolName: 'sciforge_discover',
        detail: JSON.stringify([{ operationRef: 'op_conflict', capabilityId: 'paper-radar.search' }])
      }),
      event('discover-2', '2026-09-15T00:00:00.001Z', {
        kind: 'tool_event', itemId: 'discover-2', status: 'success', toolName: 'sciforge_discover',
        detail: JSON.stringify([{ operationRef: 'op_conflict', capabilityId: 'paper-radar.status' }])
      }),
      event('invoke-1', '2026-09-15T00:00:00.010Z', {
        kind: 'tool_event', itemId: 'invoke-1', status: 'success', toolName: 'sciforge_invoke',
        meta: { arguments: { operationRef: 'op_conflict', input: {} } }
      })
    ], { knownActionIds: new Set(['paper-radar.search', 'paper-radar.status']) })

    expect(result.invocations).toMatchObject([{
      operationRef: 'op_conflict',
      identityStatus: 'conflict',
      outcome: 'success'
    }])
    expect(result.invocations[0]?.actionId).toBeUndefined()
    expect(result.unsupported).toEqual(expect.arrayContaining([
      'Operation reference op_conflict resolved to conflicting capability IDs.'
    ]))
  })

  it('does not count duplicate running lifecycle snapshots as provider retries', () => {
    const result = capabilityEvalTraceFromEvents([
      event('event-1', '2026-09-15T00:00:00.000Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        status: 'running',
        toolName: 'sciforge_invoke',
        meta: { actionId: 'paper-radar.search', arguments: { query: 'AlphaFold 3' } }
      }),
      event('event-2', '2026-09-15T00:00:00.001Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        status: 'running',
        toolName: 'sciforge_invoke',
        meta: { actionId: 'paper-radar.search', arguments: { query: 'AlphaFold 3' } }
      }),
      event('event-3', '2026-09-15T00:00:00.010Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        status: 'success',
        toolName: 'sciforge_invoke',
        meta: { actionId: 'paper-radar.search', arguments: { query: 'AlphaFold 3' } }
      })
    ])

    expect(result.invocations).toMatchObject([{
      retryCount: 0,
      providerAttempts: [{ attempt: 1, success: true }]
    }])
  })

  it('keeps one logical invocation separate from explicit provider attempts', () => {
    const result = capabilityEvalTraceFromEvents([
      event('event-1', '2026-09-15T00:00:00.000Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        attempt: 1,
        status: 'running',
        toolName: 'sciforge_invoke',
        meta: { actionId: 'paper-radar.search', arguments: { query: 'AlphaFold 3' } }
      }),
      event('event-2', '2026-09-15T00:00:00.010Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        attempt: 1,
        status: 'error',
        errorCode: 'timeout',
        toolName: 'sciforge_invoke',
        meta: { actionId: 'paper-radar.search', arguments: { query: 'AlphaFold 3' } }
      }),
      event('event-3', '2026-09-15T00:00:00.011Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        attempt: 2,
        status: 'running',
        toolName: 'sciforge_invoke',
        meta: { actionId: 'paper-radar.search', arguments: { query: 'AlphaFold 3' } }
      }),
      event('event-4', '2026-09-15T00:00:00.021Z', {
        kind: 'tool_event',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        attempt: 2,
        status: 'success',
        toolName: 'sciforge_invoke',
        meta: { actionId: 'paper-radar.search', arguments: { query: 'AlphaFold 3' } }
      })
    ])
    expect(result.invocations).toMatchObject([{
      actionId: 'paper-radar.search',
      logicalInvocationId: 'invoke-1',
      success: true,
      retryCount: 1,
      firstAttemptSuccess: false,
      eventualSuccess: true,
      providerAttempts: [
        { attempt: 1, success: false, errorCode: 'timeout', latencyMs: 10 },
        { attempt: 2, success: true, latencyMs: 10 }
      ]
    }])
    expect(result.attemptEvidence).toBe('complete')
  })
})
