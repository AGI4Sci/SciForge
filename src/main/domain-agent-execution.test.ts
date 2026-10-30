import { describe, expect, it, vi } from 'vitest'

import type { DomainMainTurnLifecycleEvent } from '@sciforge/domain-sdk/host'
import type { AgentRuntimeHost } from './runtime/agent-runtime/host'
import type { AgentRuntimeThreadPage, AgentRuntimeThreadStatus } from '../shared/agent-runtime-contract'
import {
  createDomainAgentExecutionHost,
  domainAgentExecutionFailure,
  resolveDomainAgentRuntimeReadiness
} from './domain-agent-execution'
import { createCodexAgentRuntimeAdapter } from './runtime/codex/codex-agent-runtime-adapter'
import { normalizeCodexEvent } from './runtime/codex/app-server/event-normalizer'
import { getModelRouterSettings, normalizeAppSettings } from '../shared/app-settings'

type ExecutionRuntime = Parameters<typeof createDomainAgentExecutionHost>[0]['runtime']
type LifecycleListener = Parameters<AgentRuntimeHost['subscribeTurnLifecycle']>[0]

describe('domain Agent execution Host', () => {
  it('settles the captured interrupted turn after HTTP 200 without task_complete', async () => {
    // final21 evidence 65/66/70: only task_started then turn_aborted;
    // the last received upstream response was 200, not a turn success receipt.
    const threadId = 'thread-fixed'
    const turnId = '01a17cc8-26a9-7141-b20d-c382e8369a0e'
    const capture = [
      { timestamp: '2026-10-27T09:54:14.327Z', type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } },
      { timestamp: '2026-10-27T09:58:58.522Z', kind: 'model_response_headers', status: 200 },
      { timestamp: '2026-10-27T09:59:01.349Z', ordinal: 323, type: 'event_msg', payload: {
        type: 'turn_aborted', turn_id: turnId, reason: 'interrupted',
        started_at: 1793094854, completed_at: 1793095141, duration_ms: 287027
      } }
    ]
    const payloads = capture.map((event) => normalizeCodexEvent(event, { threadId, turnId })).filter((event) => event !== null)
    expect(payloads).toHaveLength(2)
    expect(payloads.some((event) => event.turnComplete)).toBe(false)
    const adapter = createCodexAgentRuntimeAdapter({
      async *subscribeEvents() { for (const payload of payloads) yield payload }
    } as never)
    const events = []
    for await (const event of adapter.subscribeEvents({ settings: {} as never }, { runtimeId: 'codex', threadId })) events.push(event)
    const terminal = events.find((event) => event.kind === 'turn_lifecycle')!
    expect(terminal).toMatchObject({ state: 'aborted', turnId })
    const runtime = fakeRuntime({
      startTurn: vi.fn(async () => ({ threadId, turnId })),
      readThreadStatus: vi.fn(async (): Promise<AgentRuntimeThreadStatus> => ({ id: threadId, runtimeId: 'codex', latestSeq: 3,
        latestTurnId: turnId, latestTurnStatus: terminal.kind === 'turn_lifecycle' ? terminal.state : undefined })),
      readThreadPage: vi.fn(async (): Promise<AgentRuntimeThreadPage> => ({ runtimeId: 'codex', threadId, latestSeq: 3,
        turns: [{ id: turnId, threadId, status: 'aborted', items: [] }], nextCursor: null }))
    })
    const execution = createDomainAgentExecutionHost({ runtime, pollIntervalMs: 10,
      defaultRuntimeId: () => 'codex', runtimeReadiness: () => ({ state: 'ready', runtimeId: 'codex', capabilityTags: [] }) })
    vi.useFakeTimers()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('Interrupted turn remained running')), 200)
    try {
      const outcome = execution.run({ prompt: 'Finish the delivery.', signal: controller.signal }).then(
        (result) => ({ result }), (error: unknown) => ({ error })
      )
      await vi.advanceTimersByTimeAsync(200)
      expect(await outcome).toMatchObject({ result: {
        state: 'cancelled', failure: { code: 'runtime_interrupted', message: '本轮执行已中断。' }
      } })
      expect(runtime.interruptTurn).not.toHaveBeenCalled()
    } finally { clearTimeout(timeout); vi.useRealTimers() }
  })

  it.each(['cancelled', 'failed', 'completed'] as const)(
    'settles a %s lifecycle even before the start acknowledgement', async (state) => {
      let listener: LifecycleListener | undefined
      const runtime = fakeRuntime({
        subscribeTurnLifecycle: (next) => { listener = next; return () => undefined },
        startTurn: vi.fn(async () => {
          await listener?.(terminalEvent('codex', 'thread-fixed', 'turn-1', state))
          return { threadId: 'thread-fixed', turnId: 'turn-1' }
        }),
        readThreadPage: vi.fn(async (): Promise<AgentRuntimeThreadPage> => ({ runtimeId: 'codex', threadId: 'thread-fixed', latestSeq: 3,
          turns: [{ id: 'turn-1', threadId: 'thread-fixed', status: state, items: [
            { id: 'error', kind: 'system', status: 'error', text: rateLimitedStream, meta: { code: 'model_capacity' } }
          ] }], nextCursor: null }))
      })
      const execution = createDomainAgentExecutionHost({ runtime, defaultRuntimeId: () => 'codex',
        runtimeReadiness: () => ({ state: 'ready', runtimeId: 'codex', capabilityTags: [] }) })
      const result = await execution.run({ prompt: 'Run once.' })
      expect(result.state).toBe(state)
      expect(result.failure).toEqual(state === 'completed' ? undefined : state === 'cancelled'
        ? { code: 'runtime_cancelled', message: '本轮执行已取消。', retryable: false }
        : { code: 'model_capacity', message: rateLimitedStream, retryable: true })
      expect(runtime.readThreadStatus).not.toHaveBeenCalled()
    }
  )

  it('prepares one exact Session before a durable caller dispatches its stable directive', async () => {
    let listener: LifecycleListener | undefined
    const runtime = fakeRuntime({
      subscribeTurnLifecycle: (next) => {
        listener = next
        return () => undefined
      },
      startTurn: vi.fn(async (request) => {
        await listener?.(terminalEvent(request.runtimeId, request.threadId, 'turn-prepared', 'completed'))
        return { threadId: request.threadId, turnId: 'turn-prepared' }
      })
    })
    const execution = createDomainAgentExecutionHost({
      runtime,
      defaultRuntimeId: () => 'codex',
      runtimeReadiness: () => ({
        state: 'ready', runtimeId: 'codex', capabilityTags: ['agent-runtime.codex']
      })
    })

    const session = await execution.prepareSession!({
      workspaceRoot: '/workspace/project', title: 'Review Worker result',
      workspaceDisplayName: 'Project One',
      interaction: 'reviewable', mode: 'agent'
    })
    expect(session).toEqual({ runtimeId: 'codex', threadId: 'thread-fixed' })
    await expect(execution.run({
      ...session,
      workspaceRoot: '/workspace/project',
      clientDirectiveId: 'collab-worker-stable-directive',
      outputSchema: {
        type: 'object',
        properties: { result: { type: 'string' } },
        required: ['result'],
        additionalProperties: false
      },
      prompt: 'Execute the durable Worker task.'
    })).resolves.toMatchObject({
      runtimeId: 'codex', threadId: 'thread-fixed', turnId: 'turn-prepared'
    })
    expect(runtime.startThread).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runtime.startThread).mock.calls[0]?.[0]).not.toHaveProperty('reasoningEffort')
    expect(vi.mocked(runtime.startTurn).mock.calls[0]?.[0]).not.toHaveProperty('reasoningEffort')
    expect(runtime.startThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      workspace: '/workspace/project',
      workspaceDisplayName: 'Project One',
      title: 'Review Worker result',
      mode: 'agent',
      relation: 'side',
      threadSource: 'domain-runtime',
      sidebarVisibility: 'main'
    })
    expect(runtime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex', threadId: 'thread-fixed',
      clientDirectiveId: 'collab-worker-stable-directive',
      outputSchema: {
        type: 'object',
        properties: { result: { type: 'string' } },
        required: ['result'],
        additionalProperties: false
      }
    }))
  })

  it('continues the exact Session and preserves the stable directive identity', async () => {
    let listener: LifecycleListener | undefined
    const runtime = fakeRuntime({
      subscribeTurnLifecycle: (next) => {
        listener = next
        return () => undefined
      },
      startTurn: vi.fn(async (request) => {
        await listener?.(terminalEvent(request.runtimeId, request.threadId, 'turn-1', 'completed'))
        return { threadId: request.threadId, turnId: 'turn-1' }
      })
    })
    const execution = createDomainAgentExecutionHost({
      runtime,
      defaultRuntimeId: () => 'claude',
      runtimeReadiness: () => ({
        state: 'ready', runtimeId: 'claude', capabilityTags: ['agent-runtime.claude']
      })
    })

    await expect(execution.run({
      runtimeId: 'codex',
      threadId: 'thread-fixed',
      workspaceRoot: '/workspace/project',
      clientDirectiveId: 'projection:message-1',
      prompt: 'Continue this Session.'
    })).resolves.toEqual({
      runtimeId: 'codex',
      threadId: 'thread-fixed',
      turnId: 'turn-1',
      state: 'completed',
      text: 'final answer'
    })
    expect(runtime.startThread).not.toHaveBeenCalled()
    expect(runtime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'thread-fixed',
      clientDirectiveId: 'projection:message-1'
    }))
  })

  it('fails closed before dispatch when an expected workspace does not match', async () => {
    const runtime = fakeRuntime({
      readThreadSnapshot: vi.fn(async () => threadSnapshot('/workspace/actual'))
    })
    const execution = createDomainAgentExecutionHost({
      runtime,
      defaultRuntimeId: () => 'codex',
      runtimeReadiness: () => ({
        state: 'ready', runtimeId: 'codex', capabilityTags: ['agent-runtime.codex']
      })
    })

    await expect(execution.run({
      runtimeId: 'codex',
      threadId: 'thread-fixed',
      workspaceRoot: '/workspace/other',
      prompt: 'Do not retarget.'
    })).rejects.toThrow('does not match')
    expect(runtime.startTurn).not.toHaveBeenCalled()
  })

  it('returns an accepted failed turn as a terminal envelope', async () => {
    let listener: LifecycleListener | undefined
    const runtime = fakeRuntime({
      subscribeTurnLifecycle: (next) => {
        listener = next
        return () => undefined
      },
      startTurn: vi.fn(async (request) => {
        await listener?.(terminalEvent(request.runtimeId, request.threadId, 'turn-1', 'failed'))
        return { threadId: request.threadId, turnId: 'turn-1' }
      })
    })
    const execution = createDomainAgentExecutionHost({
      runtime,
      defaultRuntimeId: () => 'codex',
      runtimeReadiness: () => ({
        state: 'ready', runtimeId: 'codex', capabilityTags: ['agent-runtime.codex']
      })
    })

    await expect(execution.run({
      title: 'One-shot Worker task',
      prompt: 'Run once.'
    })).resolves.toMatchObject({
      runtimeId: 'codex',
      threadId: 'thread-fixed',
      turnId: 'turn-1',
      state: 'failed'
    })
    expect(runtime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      title: 'One-shot Worker task'
    }))
  })

  it('classifies model capacity as a retryable bounded failure', async () => {
    let listener: LifecycleListener | undefined
    const runtime = fakeRuntime({
      subscribeTurnLifecycle: (next) => {
        listener = next
        return () => undefined
      },
      startTurn: vi.fn(async (request) => {
        await listener?.(terminalEvent(request.runtimeId, request.threadId, 'turn-capacity', 'failed'))
        return { threadId: request.threadId, turnId: 'turn-capacity' }
      }),
      readThreadPage: vi.fn(async () => ({
        runtimeId: 'codex' as const,
        threadId: 'thread-fixed',
        latestSeq: 3,
        turns: [{
          id: 'turn-capacity', threadId: 'thread-fixed', status: 'failed' as const,
          items: [{
            id: 'capacity-error', kind: 'system' as const, status: 'error' as const,
            text: 'Selected model is at capacity. Please try a different model.'
          }]
        }],
        nextCursor: null
      }))
    })
    const execution = createDomainAgentExecutionHost({
      runtime,
      defaultRuntimeId: () => 'codex',
      runtimeReadiness: () => ({ state: 'ready', runtimeId: 'codex', capabilityTags: [] })
    })

    await expect(execution.run({ prompt: 'Run once.' })).resolves.toMatchObject({
      state: 'failed',
      failure: {
        code: 'model_capacity',
        message: 'Selected model is at capacity. Please try a different model.',
        retryable: true
      }
    })
  })

  it.each([
    { name: 'upstream 502', code: 'upstream_error', message: 'Upstream returned HTTP 502', expectedCode: 'upstream_unavailable', retryable: true },
    { name: 'incompatible response schema', code: 'provider_error', message: 'Chat Completions returned an incompatible response schema.', expectedCode: 'response_schema_incompatible', retryable: true },
    {
      name: 'canonical model-capacity code',
      code: 'model_capacity',
      message: 'Request could not be scheduled.',
      expectedCode: 'model_capacity',
      retryable: true
    },
    {
      name: 'canonical interrupted-connection code',
      code: 'runtime_connection_interrupted',
      message: 'Transport ended unexpectedly.',
      expectedCode: 'runtime_connection_interrupted',
      retryable: true
    },
    {
      name: 'unrelated temporary service error',
      code: 'service_unavailable',
      message: 'Service is temporarily unavailable.',
      expectedCode: 'service_unavailable',
      retryable: false
    }
  ])('uses $name without broadening retryability', async ({ code, message, expectedCode, retryable }) => {
    let listener: LifecycleListener | undefined
    const runtime = fakeRuntime({
      subscribeTurnLifecycle: (next) => {
        listener = next
        return () => undefined
      },
      startTurn: vi.fn(async (request) => {
        await listener?.(terminalEvent(request.runtimeId, request.threadId, 'turn-coded-failure', 'failed'))
        return { threadId: request.threadId, turnId: 'turn-coded-failure' }
      }),
      readThreadPage: vi.fn(async () => ({
        runtimeId: 'codex' as const,
        threadId: 'thread-fixed',
        latestSeq: 3,
        turns: [{
          id: 'turn-coded-failure', threadId: 'thread-fixed', status: 'failed' as const,
          items: [{
            id: 'coded-error', kind: 'system' as const, status: 'error' as const,
            text: message,
            meta: { code }
          }, ...(code === 'model_capacity' ? [{
            id: 'later-generic-error', kind: 'tool' as const, status: 'error' as const,
            text: 'A later generic tool error.'
          }] : [])]
        }],
        nextCursor: null
      }))
    })
    const execution = createDomainAgentExecutionHost({
      runtime,
      defaultRuntimeId: () => 'codex',
      runtimeReadiness: () => ({ state: 'ready', runtimeId: 'codex', capabilityTags: [] })
    })

    await expect(execution.run({ prompt: 'Run once.' })).resolves.toMatchObject({
      state: 'failed',
      failure: { code: expectedCode, message, retryable }
    })
  })

  const rateLimitedStream = 'stream disconnected before completion: Upstream returned HTTP 429.: {"error":{"message":"Channel rate limit reached for model","type":"rate_limit_exceeded","code":"rate_limit_exceeded"}}'
  it.each([
    { name: 'HTTP 429 behind a stream prefix', message: rateLimitedStream, expectedCode: 'model_capacity' },
    {
      name: 'HTTP 502 behind a stream prefix',
      message: 'stream disconnected before completion: Upstream returned HTTP 502.: {"error":{"message":"Bad gateway"}}',
      expectedCode: 'upstream_unavailable'
    },
    {
      name: 'a stream disconnect without an upstream status',
      message: 'stream disconnected before completion: error sending request for url',
      expectedCode: 'runtime_connection_interrupted'
    },
    {
      name: 'a rate_limit_exceeded error code without a status',
      message: '{"error":{"message":"Too many requests","type":"rate_limit_exceeded","code":"rate_limit_exceeded"}}',
      expectedCode: 'model_capacity'
    }
  ])('classifies $name by the upstream status before transport wording', ({ message, expectedCode }) => {
    expect(domainAgentExecutionFailure('failed', [{
      id: 'stream-error', kind: 'system', status: 'error', text: message
    }])).toEqual({ code: expectedCode, message, retryable: true })
  })

  it('projects only the exact configured runtime policy and capability tags', async () => {
    const execution = createDomainAgentExecutionHost({
      runtime: fakeRuntime(),
      defaultRuntimeId: () => 'codex',
      runtimeReadiness: () => ({
        state: 'not_configured',
        reason: 'The selected AgentRuntime has no executable model-access configuration.'
      })
    })

    await expect(execution.runtimeReadiness!()).resolves.toEqual({
      state: 'not_configured',
      reason: 'The selected AgentRuntime has no executable model-access configuration.'
    })
  })

  it('recovers the failed requested turn even when a later manual turn completed', async () => {
    const readThreadPage = vi.fn<ExecutionRuntime['readThreadPage']>(async (request) => ({
      runtimeId: 'codex' as const,
      threadId: 'thread-fixed',
      latestSeq: 529,
      turns: request.cursor ? [{
        id: 'turn-1', threadId: 'thread-fixed', status: 'failed' as const,
        items: [{ id: 'timeout', kind: 'system' as const, status: 'error', text: 'No model activity.' }]
      }] : [{
        id: 'manual-turn', threadId: 'thread-fixed', status: 'completed' as const,
        items: [{ id: 'manual-answer', kind: 'assistant_message' as const, text: '{"tasks":[]}' }]
      }],
      nextCursor: request.cursor ? null : 'older'
    }))
    const runtime = fakeRuntime({
      readThreadPage,
      readThreadStatus: vi.fn(async (): Promise<AgentRuntimeThreadStatus> => ({
        id: 'thread-fixed', runtimeId: 'codex', latestSeq: 529,
        latestTurnId: 'manual-turn', latestTurnStatus: 'completed', status: 'completed'
      }))
    })
    const execution = createDomainAgentExecutionHost({
      runtime, defaultRuntimeId: () => 'codex', pollIntervalMs: 10,
      runtimeReadiness: () => ({ state: 'ready', runtimeId: 'codex', capabilityTags: [] })
    })
    await expect(execution.run({
      runtimeId: 'codex', threadId: 'thread-fixed', clientDirectiveId: 'original-plan', prompt: 'Plan'
    })).resolves.toMatchObject({
      turnId: 'turn-1', state: 'failed', text: ''
    })
    expect(readThreadPage).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'older' }))
  })

  it('reads a completed requested turn beyond the first history page', async () => {
    let listener: LifecycleListener | undefined
    const runtime = fakeRuntime({
      subscribeTurnLifecycle: (next) => { listener = next; return () => undefined },
      startTurn: vi.fn(async () => {
        await listener?.(terminalEvent('codex', 'thread-fixed', 'turn-1', 'completed'))
        return { threadId: 'thread-fixed', turnId: 'turn-1' }
      }),
      readThreadPage: vi.fn(async ({ cursor }): Promise<AgentRuntimeThreadPage> => ({
        runtimeId: 'codex', threadId: 'thread-fixed', latestSeq: 600,
        turns: cursor ? [{
          id: 'turn-1', threadId: 'thread-fixed', status: 'completed',
          items: [{ id: 'exact-final', kind: 'assistant_message', text: 'exact output' }]
        }] : [],
        nextCursor: cursor ? null : 'older'
      }))
    })
    const execution = createDomainAgentExecutionHost({
      runtime, defaultRuntimeId: () => 'codex',
      runtimeReadiness: () => ({ state: 'ready', runtimeId: 'codex', capabilityTags: [] })
    })
    await expect(execution.run({ prompt: 'Plan' })).resolves.toMatchObject({ text: 'exact output' })
  })

  it.each(['prepare', 'snapshot'] as const)('does not dispatch after cancellation during %s', async (phase) => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const delayed = vi.fn(async () => {
      await waiting
      return threadSnapshot('/workspace/project')
    })
    const runtime = fakeRuntime({
      ...(phase === 'prepare' ? { startThread: delayed } : { readThreadSnapshot: delayed })
    })
    const controller = new AbortController()
    const execution = createDomainAgentExecutionHost({
      runtime, defaultRuntimeId: () => 'codex',
      runtimeReadiness: () => ({ state: 'ready', runtimeId: 'codex', capabilityTags: [] })
    })
    const pending = execution.run({
      runtimeId: 'codex', ...(phase === 'snapshot' ? { threadId: 'thread-fixed' } : {}),
      prompt: 'Plan', signal: controller.signal
    })
    const rejected = expect(pending).rejects.toThrow('cancel-before-dispatch')
    await vi.waitFor(() => expect(delayed).toHaveBeenCalledOnce())
    controller.abort(new Error('cancel-before-dispatch'))
    release()
    await rejected
    expect(runtime.startTurn).not.toHaveBeenCalled()
    expect(runtime.interruptTurn).not.toHaveBeenCalled()
  })

  it('aborts a stalled turn and releases the lifecycle subscription', async () => {
    const unsubscribe = vi.fn()
    const controller = new AbortController()
    const runtime = fakeRuntime({
      subscribeTurnLifecycle: vi.fn(() => unsubscribe),
      readThreadStatus: vi.fn(() => new Promise<AgentRuntimeThreadStatus>(() => undefined))
    })
    const execution = createDomainAgentExecutionHost({
      runtime, defaultRuntimeId: () => 'codex', pollIntervalMs: 10,
      runtimeReadiness: () => ({ state: 'ready', runtimeId: 'codex', capabilityTags: [] })
    })
    const pending = execution.run({ prompt: 'Plan', signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('deadline')
    await vi.waitFor(() => expect(runtime.readThreadStatus).toHaveBeenCalled())
    controller.abort(new Error('deadline'))
    await rejected
    expect(runtime.interruptTurn).toHaveBeenCalledWith({
      runtimeId: 'codex', threadId: 'thread-fixed', turnId: 'turn-1', discard: false
    })
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('requires executable model access before declaring the selected Runtime configured', () => {
    expect(resolveDomainAgentRuntimeReadiness(normalizeAppSettings({} as never))).toEqual({
      state: 'not_configured',
      reason: 'The selected AgentRuntime has no executable canonical model-access configuration.'
    })

    const configured = normalizeAppSettings({
      modelAccess: { mode: 'api' },
      activeAgentRuntime: 'codex',
      modelRouter: {
        runtimeApiKey: 'private-runtime-key',
        profiles: {
          default: {
            textReasoner: {
              baseUrl: 'https://models.example.test/v1',
              apiKey: 'private-provider-key',
              model: 'run0-text'
            }
          }
        }
      }
    } as never)
    expect(resolveDomainAgentRuntimeReadiness(configured)).toEqual({
      state: 'ready',
      runtimeId: 'codex',
      capabilityTags: ['agent-runtime.codex', 'model-access.api']
    })
    expect(JSON.stringify(resolveDomainAgentRuntimeReadiness(configured)))
      .not.toContain('private')

    expect(resolveDomainAgentRuntimeReadiness({
      ...configured,
      modelRouter: { ...getModelRouterSettings(configured), enabled: false }
    })).toEqual({
      state: 'not_configured',
      reason: 'The selected AgentRuntime has no executable canonical model-access configuration.'
    })
  })
})

function fakeRuntime(overrides: Partial<ExecutionRuntime> = {}): ExecutionRuntime {
  return {
    interruptTurn: vi.fn(async () => undefined),
    readThreadPage: vi.fn(async () => ({
      runtimeId: 'codex',
      threadId: 'thread-fixed',
      latestSeq: 3,
      turns: [{
        id: 'turn-1',
        threadId: 'thread-fixed',
        status: 'completed',
        items: [
          { id: 'assistant-draft', kind: 'assistant_message', text: 'draft' },
          { id: 'assistant-final', kind: 'assistant_message', text: 'final answer' }
        ]
      }],
      nextCursor: null
    })),
    readThreadSnapshot: vi.fn(async () => threadSnapshot('/workspace/project')),
    readThreadStatus: vi.fn(async () => ({
      id: 'thread-fixed',
      runtimeId: 'codex',
      latestSeq: 3,
      latestTurnId: 'turn-1',
      latestTurnStatus: 'completed'
    })),
    startThread: vi.fn(async () => threadSnapshot(undefined)),
    startTurn: vi.fn(async () => ({ threadId: 'thread-fixed', turnId: 'turn-1' })),
    subscribeTurnLifecycle: vi.fn(() => () => undefined),
    ...overrides
  } as ExecutionRuntime
}

function threadSnapshot(workspace: string | undefined) {
  return {
    id: 'thread-fixed',
    runtimeId: 'codex' as const,
    title: 'Fixed Session',
    updatedAt: '2026-08-15T00:00:00.000Z',
    ...(workspace ? { workspace } : {}),
    latestSeq: 0,
    turns: []
  }
}

function terminalEvent(
  runtimeId: string,
  threadId: string,
  turnId: string,
  state: 'completed' | 'failed' | 'cancelled'
): DomainMainTurnLifecycleEvent {
  return {
    kind: 'after-turn',
    state,
    runtimeId,
    threadId,
    turnId,
    issuerEpoch: 'test-epoch',
    deliveryAttemptOrdinal: 1,
    deliveryAttemptId: 'delivery-1',
    boundaryLeaseId: 'lease-1',
    clientDirectiveId: 'directive-1',
    occurredAt: '2026-08-15T00:00:00.000Z'
  }
}
