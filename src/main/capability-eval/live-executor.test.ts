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
      runId: 'run-live-test-1',
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

  it('runs declared prior user turns in the same thread before the target query', async () => {
    let turnNumber = 0
    let status: AgentRuntimeThreadStatus = {
      id: 'thread-context',
      runtimeId: 'codex',
      latestSeq: 0
    }
    const startedTexts: string[] = []
    const events: AgentRuntimeEvent[] = [
      agentEvent({ kind: 'turn_lifecycle', threadId: 'thread-context', turnId: 'turn-1', seq: 1, state: 'completed' }),
      agentEvent({ kind: 'turn_lifecycle', threadId: 'thread-context', turnId: 'turn-2', seq: 2, state: 'completed' })
    ]
    const runtime = {
      startThread: async () => ({
        id: 'thread-context', runtimeId: 'codex' as const, title: 'context eval', updatedAt: '2026-09-15T00:00:00.000Z'
      }),
      readThreadStatus: async () => status,
      startTurn: async (input: { text: string }) => {
        turnNumber += 1
        const turnId = `turn-${turnNumber}`
        startedTexts.push(input.text)
        status = { ...status, latestSeq: turnNumber, latestTurnId: turnId, latestTurnStatus: 'completed' }
        return { threadId: 'thread-context', turnId }
      },
      async *subscribeEvents() {
        for (const event of events) yield event
      },
      deleteThread: async () => undefined
    }
    const evalCase = evalCaseSchema.parse({
      id: 'live-context',
      query: '根据刚才确定的研究方向继续处理。',
      queryLanguage: 'zh-CN',
      contextContract: {
        mode: 'conversation',
        visibleInputs: ['query', 'conversation-history'],
        requiredTurns: 2,
        missingContextBehavior: 'not-applicable'
      },
      priorTurns: ['我正在研究蛋白设计，请记住这个研究方向。'],
      expected: { taskSuccess: true }
    })
    let observedTurnIds: string[] = []
    const executor = createLiveWorkflowExecutor({
      runtime,
      runtimeId: 'codex',
      pollIntervalMs: 25,
      onTrace: async (_, traceEvents) => {
        observedTurnIds = traceEvents
          .map((event) => event.turnId)
          .filter((turnId): turnId is string => typeof turnId === 'string')
      },
      inspectFinalState: async (_, __, input) => ({
        finalState: { contextRetained: true },
        taskSuccess: true,
        evidence: [`target turn=${input.turnId}`]
      })
    })

    const execution = await executor.run(evalCase, {
      caseId: evalCase.id,
      runId: 'run-context-test-1',
      directory: '/tmp/sciforge-context-eval-test',
      state: {}
    })

    expect(startedTexts).toEqual(['我正在研究蛋白设计，请记住这个研究方向。', '根据刚才确定的研究方向继续处理。'])
    expect(observedTurnIds).toEqual(['turn-1', 'turn-2'])
    expect(execution.trace.turnId).toBe('turn-2')
    expect(execution.trace.finalState).toEqual({ contextRetained: true })
  })

  it('hydrates oversized tool output through the existing artifact reference before cleanup', async () => {
    let status: AgentRuntimeThreadStatus = {
      id: 'thread-artifact',
      runtimeId: 'codex',
      latestSeq: 0
    }
    const lifecycle: string[] = []
    const artifactRef = 'artifact-ref-1'
    const fullReceipt = JSON.stringify([{
      type: 'inputText',
      text: JSON.stringify({
        capabilityId: 'paper-radar.search',
        operationRef: 'op-search',
        output: { papers: [{ id: 'paper-1' }] }
      })
    }])
    const events: AgentRuntimeEvent[] = [
      agentEvent({
        kind: 'tool_event', threadId: 'thread-artifact', turnId: 'turn-artifact', seq: 1,
        itemId: 'discover-artifact', callId: 'discover-artifact', toolName: 'sciforge_discover',
        status: 'success', detail: JSON.stringify([{ id: 'paper-radar.search', operationRef: 'op-search' }])
      }),
      agentEvent({
        kind: 'tool_event', threadId: 'thread-artifact', turnId: 'turn-artifact', seq: 2,
        itemId: 'invoke-artifact', callId: 'invoke-artifact', toolName: 'sciforge_invoke', status: 'running',
        meta: { callId: 'invoke-artifact', arguments: { operationRef: 'op-search', input: { query: 'AlphaFold 3' } } }
      }),
      agentEvent({
        kind: 'tool_event', threadId: 'thread-artifact', turnId: 'turn-artifact', seq: 3,
        itemId: 'invoke-artifact', callId: 'invoke-artifact', toolName: 'sciforge_invoke', status: 'success',
        detailArtifact: { runtimeId: 'codex', threadId: 'thread-artifact', ref: artifactRef, size: fullReceipt.length },
        meta: {
          callId: 'invoke-artifact',
          arguments: { operationRef: 'op-search', input: { query: 'AlphaFold 3' } },
          capabilityIdentity: { operationRef: 'op-search', capabilityId: 'paper-radar.search' }
        }
      }),
      agentEvent({
        kind: 'turn_lifecycle', threadId: 'thread-artifact', turnId: 'turn-artifact', seq: 4, state: 'completed'
      })
    ]
    const runtime = {
      startThread: async () => ({
        id: 'thread-artifact', runtimeId: 'codex' as const, title: 'artifact eval', updatedAt: '2026-09-15T00:00:00.000Z'
      }),
      readThreadStatus: async () => status,
      startTurn: async () => {
        status = { ...status, latestSeq: 4, latestTurnId: 'turn-artifact', latestTurnStatus: 'completed' }
        return { threadId: 'thread-artifact', turnId: 'turn-artifact' }
      },
      async *subscribeEvents() {
        for (const event of events) yield event
      },
      readToolArtifact: async (input: { ref: string; threadId: string; runtimeId: 'codex'; size: number }) => {
        lifecycle.push('read-artifact')
        return { ...input, content: fullReceipt }
      },
      deleteThread: async () => {
        lifecycle.push('delete-thread')
      }
    }
    const evalCase = evalCaseSchema.parse({
      id: 'live-artifact-output',
      query: 'Find AlphaFold 3 papers',
      expected: { requiredActions: ['paper-radar.search'], allowedActions: ['paper-radar.search'] }
    })

    const execution = await createLiveWorkflowExecutor({
      runtime,
      runtimeId: 'codex',
      pollIntervalMs: 25,
      inspectFinalState: async (_, __, input) => {
        expect(input.trace.invocations[0]?.output).toEqual({ papers: [{ id: 'paper-1' }] })
        return { taskSuccess: true, evidence: ['hydrated from runtime tool artifact'] }
      }
    }).run(evalCase, { caseId: evalCase.id, runId: 'run-live-test-2', directory: '/tmp/sciforge-live-eval-test', state: {} })

    expect(execution.trace.invocations[0]?.output).toEqual({ papers: [{ id: 'paper-1' }] })
    expect(lifecycle).toEqual(['read-artifact', 'delete-thread'])
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
      caseId: evalCase.id, runId: 'run-live-test-3', directory: '/tmp/sciforge-live-eval-test', state: {}
    })

    expect(execution.trace.executionError).toBe('agent turn rejected')
    expect(execution.trace.executionStatus).toBe('failed')
    expect(execution.trace.finalAnswer).toBe('partial answer')
    expect(observedTrace).toMatchObject({ executionError: 'agent turn rejected' })
  })

  it('resolves only observed approval requests when an explicit live policy is configured', async () => {
    let status: AgentRuntimeThreadStatus = {
      id: 'thread-approval',
      runtimeId: 'codex',
      latestSeq: 0,
      latestTurnId: undefined,
      latestTurnStatus: undefined
    }
    const resolved: Array<Record<string, unknown>> = []
    const events: AgentRuntimeEvent[] = [
      agentEvent({
        kind: 'approval_requested',
        threadId: 'thread-approval',
        turnId: 'turn-approval',
        seq: 1,
        approvalId: 'approval-1',
        summary: 'Allow paper-radar.profiles.save?'
      }),
      agentEvent({
        kind: 'approval_resolved',
        threadId: 'thread-approval',
        turnId: 'turn-approval',
        seq: 2,
        approvalId: 'approval-1',
        decision: 'denied'
      }),
      agentEvent({
        kind: 'turn_lifecycle',
        threadId: 'thread-approval',
        turnId: 'turn-approval',
        seq: 3,
        state: 'completed'
      })
    ]
    const runtime = {
      startThread: async () => ({
        id: 'thread-approval',
        runtimeId: 'codex' as const,
        title: 'approval eval',
        updatedAt: '2026-09-15T00:00:00.000Z'
      }),
      readThreadStatus: async () => status,
      startTurn: async () => {
        status = {
          ...status,
          latestSeq: 3,
          latestTurnId: 'turn-approval',
          latestTurnStatus: 'completed'
        }
        return { threadId: 'thread-approval', turnId: 'turn-approval' }
      },
      async *subscribeEvents() {
        for (const event of events) yield event
      },
      resolveApproval: async (input: Record<string, unknown>) => {
        resolved.push(input)
      },
      deleteThread: async () => undefined
    }
    const evalCase = evalCaseSchema.parse({
      id: 'live-approval-policy',
      query: 'Save this profile only if approval is granted.',
      expected: { requiredActions: [], allowedActions: [] }
    })

    const execution = await createLiveWorkflowExecutor({
      runtime,
      runtimeId: 'codex',
      approvalDecision: 'denied',
      pollIntervalMs: 25
    }).run(evalCase, { caseId: evalCase.id, runId: 'run-live-test-4', directory: '/tmp/sciforge-live-eval-test', state: {} })

    expect(resolved).toEqual([{
      runtimeId: 'codex',
      threadId: 'thread-approval',
      approvalId: 'approval-1',
      decision: 'denied'
    }])
    expect(execution.trace.rawEventCount).toBe(3)
    expect(execution.trace.executionStatus).toBe('completed')
  })

  it('persists a zero-event execution failure instead of throwing an unreplayable error', async () => {
    let persistedEvents = -1
    let persistedError = ''
    const runtime = {
      startThread: async () => {
        throw new Error('thread creation rejected')
      },
      readThreadStatus: async () => ({ id: 'unused', runtimeId: 'codex' as const, latestSeq: 0 }),
      startTurn: async () => ({ threadId: 'unused', turnId: 'unused' }),
      subscribeEvents: () => {
        throw new Error('unreachable')
      }
    }
    const evalCase = evalCaseSchema.parse({
      id: 'live-thread-failure',
      query: 'Run the failing task',
      expected: { requiredActions: [], allowedActions: [] }
    })
    const executor = createLiveWorkflowExecutor({
      runtime,
      runtimeId: 'codex',
      onTrace: async (_, events, trace) => {
        persistedEvents = events.length
        persistedError = trace.executionError ?? ''
      }
    })

    const execution = await executor.run(evalCase, {
      caseId: evalCase.id,
      runId: 'run-live-test-5',
      directory: '/tmp/sciforge-live-eval-test',
      state: {}
    })

    expect(execution.trace.executionError).toBe('thread creation rejected')
    expect(execution.trace.evidenceStatus).toBe('unavailable')
    expect(persistedEvents).toBe(0)
    expect(persistedError).toBe('thread creation rejected')
  })

  it('preserves fatal runtime errors when the provider emits a later completed status', async () => {
    let status: AgentRuntimeThreadStatus = {
      id: 'thread-provider-limit',
      runtimeId: 'codex',
      latestSeq: 0
    }
    const events = [
      agentEvent({
        kind: 'error',
        threadId: 'thread-provider-limit',
        turnId: 'turn-provider-limit',
        seq: 2,
        recoverable: false,
        severity: 'error',
        code: 'provider_usage_limit',
        message: 'Provider usage limit reached.'
      }),
      agentEvent({
        kind: 'turn_lifecycle',
        threadId: 'thread-provider-limit',
        turnId: 'turn-provider-limit',
        seq: 2,
        state: 'failed',
        message: 'Provider usage limit reached.'
      }),
      agentEvent({
        kind: 'turn_lifecycle',
        threadId: 'thread-provider-limit',
        turnId: 'turn-provider-limit',
        seq: 4,
        state: 'completed'
      })
    ]
    const runtime = {
      startThread: async () => ({
        id: 'thread-provider-limit',
        runtimeId: 'codex' as const,
        title: 'provider limit eval',
        updatedAt: '2026-09-15T00:00:00.000Z'
      }),
      readThreadStatus: async () => status,
      startTurn: async () => {
        status = {
          ...status,
          latestSeq: 4,
          latestTurnId: 'turn-provider-limit',
          latestTurnStatus: 'completed'
        }
        return { threadId: 'thread-provider-limit', turnId: 'turn-provider-limit' }
      },
      async *subscribeEvents() {
        for (const event of events) yield event
      },
      deleteThread: async () => undefined
    }
    const evalCase = evalCaseSchema.parse({
      id: 'live-provider-limit',
      query: 'Run the provider-limited task',
      expected: { requiredActions: [], allowedActions: [] }
    })

    const execution = await createLiveWorkflowExecutor({
      runtime,
      runtimeId: 'codex',
      pollIntervalMs: 25
    }).run(evalCase, {
      caseId: evalCase.id,
      runId: 'run-live-test-provider-limit',
      directory: '/tmp/sciforge-live-eval-test',
      state: {}
    })

    expect(execution.trace.executionStatus).toBe('failed')
    expect(execution.trace.executionError).toBe('provider_usage_limit: Provider usage limit reached.')
    expect(execution.trace.evidenceStatus).toBe('partial')
  })

  it('keeps a contiguous trace complete when terminal status reports the next sequence', async () => {
    let status: AgentRuntimeThreadStatus = {
      id: 'thread-sequence',
      runtimeId: 'codex',
      latestSeq: 0
    }
    const events = [
      agentEvent({
        kind: 'tool_event',
        threadId: 'thread-sequence',
        turnId: 'turn-sequence',
        seq: 1,
        callId: 'call-sequence',
        itemId: 'item-sequence',
        toolName: 'sciforge_invoke',
        status: 'success',
        meta: {
          actionId: 'paper-radar.search',
          arguments: { operationRef: 'op-search', input: { query: 'AlphaFold 3' } },
          structuredContent: { capabilityId: 'paper-radar.search', output: {} }
        }
      }),
      agentEvent({
        kind: 'turn_lifecycle',
        threadId: 'thread-sequence',
        turnId: 'turn-sequence',
        seq: 2,
        state: 'completed'
      })
    ]
    const runtime = {
      startThread: async () => ({
        id: 'thread-sequence',
        runtimeId: 'codex' as const,
        title: 'sequence smoke',
        updatedAt: '2026-09-15T00:00:00.000Z'
      }),
      readThreadStatus: async () => status,
      startTurn: async () => {
        status = {
          ...status,
          latestSeq: 3,
          latestTurnId: 'turn-sequence',
          latestTurnStatus: 'completed'
        }
        return { threadId: 'thread-sequence', turnId: 'turn-sequence' }
      },
      async *subscribeEvents() {
        for (const event of events) yield event
      },
      deleteThread: async () => undefined
    }
    const evalCase = evalCaseSchema.parse({
      id: 'live-sequence-boundary',
      query: 'Find AlphaFold 3 papers',
      expected: {
        requiredActions: ['paper-radar.search'],
        allowedActions: ['paper-radar.search']
      }
    })
    const execution = await createLiveWorkflowExecutor({
      runtime,
      runtimeId: 'codex',
      pollIntervalMs: 25
    }).run(evalCase, { caseId: evalCase.id, runId: 'run-live-test-6', directory: '/tmp/sciforge-live-eval-test', state: {} })

    expect(execution.trace.evidenceStatus).toBe('complete')
    expect(execution.trace.traceSequenceWarning).toContain('latestSeq 3')
    expect(execution.trace.traceCollectionError).toBeUndefined()
  })

  it('trusts a terminal lifecycle event when status polling remains running', async () => {
    const events = [agentEvent({
      kind: 'turn_lifecycle',
      threadId: 'thread-event-terminal',
      turnId: 'turn-event-terminal',
      seq: 1,
      state: 'completed'
    })]
    const runtime = {
      startThread: async () => ({
        id: 'thread-event-terminal',
        runtimeId: 'codex' as const,
        title: 'event terminal smoke',
        updatedAt: '2026-09-15T00:00:00.000Z'
      }),
      readThreadStatus: async () => ({
        id: 'thread-event-terminal',
        runtimeId: 'codex' as const,
        latestSeq: 0,
        latestTurnId: 'turn-event-terminal',
        latestTurnStatus: 'running' as const,
        status: 'running' as const
      }),
      startTurn: async () => ({
        threadId: 'thread-event-terminal',
        turnId: 'turn-event-terminal'
      }),
      async *subscribeEvents() {
        for (const event of events) yield event
      },
      deleteThread: async () => undefined
    }
    const evalCase = evalCaseSchema.parse({
      id: 'live-event-terminal',
      query: 'Complete the task',
      expected: { requiredActions: [], allowedActions: [] }
    })
    const startedAt = Date.now()
    const execution = await createLiveWorkflowExecutor({
      runtime,
      runtimeId: 'codex',
      timeoutMs: 1_000,
      pollIntervalMs: 250
    }).run(evalCase, {
      caseId: evalCase.id,
      runId: 'run-live-test-event-terminal',
      directory: '/tmp/sciforge-live-eval-test',
      state: {}
    })

    expect(Date.now() - startedAt).toBeLessThan(750)
    expect(execution.trace.executionStatus).toBe('completed')
    expect(execution.trace.evidenceStatus).toBe('complete')
    expect(execution.trace.traceStatusWarning).toBeUndefined()
  })
})
