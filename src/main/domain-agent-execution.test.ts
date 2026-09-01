import { describe, expect, it, vi } from 'vitest'

import type { DomainMainTurnLifecycleEvent } from '@sciforge/domain-sdk/host'
import type { AgentRuntimeHost } from './runtime/agent-runtime/host'
import {
  createDomainAgentExecutionHost,
  resolveDomainAgentRuntimeReadiness
} from './domain-agent-execution'
import { getModelRouterSettings, normalizeAppSettings } from '../shared/app-settings'

type ExecutionRuntime = Parameters<typeof createDomainAgentExecutionHost>[0]['runtime']
type LifecycleListener = Parameters<AgentRuntimeHost['subscribeTurnLifecycle']>[0]

describe('domain Agent execution Host', () => {
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
    expect(runtime.startThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      workspace: '/workspace/project',
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
