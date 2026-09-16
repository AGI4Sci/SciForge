import { describe, expect, it } from 'vitest'
import type {
  AgentRuntimeEvent,
  AgentRuntimeThreadStatus
} from '../../shared/agent-runtime-contract'
import { createLiveWorkflowExecutor } from './live-executor'
import { evalCaseSchema } from './schema'

function agentEvent(value: Record<string, unknown>): AgentRuntimeEvent {
  return value as AgentRuntimeEvent
}

describe('live workflow executor', () => {
  it('submits only the user query and returns the actual runtime trajectory', async () => {
    let currentStatus: AgentRuntimeThreadStatus = {
      id: 'thread-1',
      runtimeId: 'codex',
      latestSeq: 0,
      latestTurnId: undefined,
      latestTurnStatus: undefined
    }
    const startedTexts: string[] = []
    let deletedThread = ''
    let observedTrace: Record<string, unknown> | undefined
    const events: AgentRuntimeEvent[] = [
      agentEvent({
        kind: 'tool_event',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'discover-1',
        callId: 'discover-1',
        toolName: 'sciforge_discover',
        status: 'success',
        detail: JSON.stringify([{ id: 'paper-radar.search', operationRef: 'op_search' }])
      }),
      agentEvent({
        kind: 'tool_event',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        toolName: 'sciforge_invoke',
        status: 'running',
        createdAt: '2026-09-15T00:00:00.000Z',
        meta: {
          callId: 'invoke-1',
          arguments: { operationRef: 'op_search', input: { query: 'AlphaFold 3' } }
        }
      }),
      agentEvent({
        kind: 'tool_event',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'invoke-1',
        callId: 'invoke-1',
        toolName: 'sciforge_invoke',
        status: 'success',
        createdAt: '2026-09-15T00:00:00.010Z',
        meta: {
          callId: 'invoke-1',
          arguments: { operationRef: 'op_search', input: { query: 'AlphaFold 3' } },
          structuredContent: { capabilityId: 'paper-radar.search', output: { papers: [] } }
        }
      }),
      agentEvent({
        kind: 'turn_lifecycle',
        threadId: 'thread-1',
        turnId: 'turn-1',
        state: 'completed'
      })
    ]
    const runtime = {
      startThread: async () => ({
        id: 'thread-1',
        runtimeId: 'codex' as const,
        title: 'eval',
        updatedAt: '2026-09-15T00:00:00.000Z'
      }),
      readThreadStatus: async () => currentStatus,
      startTurn: async (input: { text: string }) => {
        startedTexts.push(input.text)
        currentStatus = {
          ...currentStatus,
          latestTurnId: 'turn-1',
          latestTurnStatus: 'completed'
        }
        return { threadId: 'thread-1', turnId: 'turn-1' }
      },
      async *subscribeEvents() {
        for (const event of events) yield event
      },
      deleteThread: async ({ threadId }: { threadId: string }) => {
        deletedThread = threadId
      }
    }
    const evalCase = evalCaseSchema.parse({
      id: 'live-search',
      query: 'Find AlphaFold 3 papers',
      expected: {
        domain: 'paper-radar',
        mustDiscover: ['paper-radar.search'],
        requiredActions: ['paper-radar.search'],
        allowedActions: ['paper-radar.search'],
        taskSuccess: true
      }
    })
    const executor = createLiveWorkflowExecutor({
      runtime,
      runtimeId: 'codex',
      pollIntervalMs: 25,
      onTrace: async (_, traceEvents, trace) => {
        expect(traceEvents.length).toBe(4)
        observedTrace = trace as Record<string, unknown>
      },
      inspectFinalState: async () => ({
        finalState: { papersFound: true },
        taskSuccess: true,
        evidence: ['verified by the test oracle']
      })
    })

    const execution = await executor.run(evalCase, {
      caseId: evalCase.id,
      directory: '/tmp/sciforge-live-eval-test',
      state: {}
    })

    expect(startedTexts).toEqual(['Find AlphaFold 3 papers'])
    expect(execution.trace.invocations).toMatchObject([{
      actionId: 'paper-radar.search',
      args: { query: 'AlphaFold 3' },
      success: true,
      logicalInvocationId: 'invoke-1'
    }])
    expect(execution.trace.taskSuccess).toBe(true)
    expect(execution.trace.finalState).toEqual({ papersFound: true })
    expect(execution.trace.evidence).toEqual(['verified by the test oracle'])
    expect(observedTrace).toMatchObject({
      finalState: { papersFound: true },
      taskSuccess: true,
      evidence: ['verified by the test oracle']
    })
    expect(execution.trace.executionStatus).toBe('completed')
    expect(deletedThread).toBe('thread-1')
  })

  it('persists and returns partial trace evidence when turn startup fails', async () => {
    let observedTrace: Record<string, unknown> | undefined
    const runtime = {
      startThread: async () => ({
        id: 'thread-failed', runtimeId: 'codex' as const, title: 'eval', updatedAt: '2026-09-15T00:00:00.000Z'
      }),
      readThreadStatus: async () => ({
        id: 'thread-failed', runtimeId: 'codex' as const, latestSeq: 0
      }),
      startTurn: async () => {
        throw new Error('agent turn rejected')
      },
      async *subscribeEvents() {
        yield agentEvent({
          kind: 'assistant_delta', threadId: 'thread-failed', turnId: '', text: 'partial answer'
        })
      },
      deleteThread: async () => undefined
    }
    const evalCase = evalCaseSchema.parse({
      id: 'live-start-failure',
      query: 'Run the failing task',
      expected: { requiredActions: [], allowedActions: [], taskSuccess: false }
    })
    const executor = createLiveWorkflowExecutor({
      runtime,
      runtimeId: 'codex',
      pollIntervalMs: 25,
      onTrace: async (_, __, trace) => {
        observedTrace = trace as Record<string, unknown>
      }
    })

    const execution = await executor.run(evalCase, {
      caseId: evalCase.id, directory: '/tmp/sciforge-live-eval-test', state: {}
    })

    expect(execution.trace.executionError).toBe('agent turn rejected')
    expect(execution.trace.executionStatus).toBe('failed')
    expect(execution.trace.finalAnswer).toBe('partial answer')
    expect(observedTrace).toMatchObject({ executionError: 'agent turn rejected' })
  })
})
