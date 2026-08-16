import { describe, expect, it, vi } from 'vitest'

import type { DomainMainTurnLifecycleEvent } from '@sciforge/domain-sdk/host'
import type { AgentRuntimeHost } from './runtime/agent-runtime/host'
import { createDomainAgentExecutionHost } from './domain-agent-execution'

type ExecutionRuntime = Parameters<typeof createDomainAgentExecutionHost>[0]['runtime']
type LifecycleListener = Parameters<AgentRuntimeHost['subscribeTurnLifecycle']>[0]

describe('domain Agent execution Host', () => {
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
      defaultRuntimeId: () => 'claude'
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
      defaultRuntimeId: () => 'codex'
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
      defaultRuntimeId: () => 'codex'
    })

    await expect(execution.run({ prompt: 'Run once.' })).resolves.toMatchObject({
      runtimeId: 'codex',
      threadId: 'thread-fixed',
      turnId: 'turn-1',
      state: 'failed'
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
