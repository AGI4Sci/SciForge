import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FileMultiAgentStore,
  InMemoryMultiAgentStore,
  MultiAgentChildRunRecord
} from '../../../../packages/workers/multi-agent/src'
import type { AgentRuntimeId } from '../../../shared/agent-runtime-contract'
import type {
  AgentRuntimeSubagentAdapter,
  AgentRuntimeSubagentSpawnInput
} from './adapter'
import {
  AGENT_RUNTIME_SUBAGENT_CANCEL_TOOL_NAME,
  AGENT_RUNTIME_SUBAGENT_DIAGNOSTICS_TOOL_NAME,
  AGENT_RUNTIME_SUBAGENT_DELETE_TOOL_NAME,
  AGENT_RUNTIME_SUBAGENT_MESSAGE_TOOL_NAME,
  AGENT_RUNTIME_SUBAGENT_RESUME_TOOL_NAME,
  AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
  AGENT_RUNTIME_SUBAGENT_STATUS_TOOL_NAME,
  AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
  agentRuntimeChildFromMultiAgentRecord,
  createAgentRuntimeSubagentToolBridge,
  type AgentRuntimeSubagentToolBridgeOptions
} from './subagent-tool-bridge'

function context() {
  return { settings: {} as never }
}

function bridgeWith(
  adapter: AgentRuntimeSubagentAdapter,
  options: {
    maxParallel?: number
    onChildEvent?: AgentRuntimeSubagentToolBridgeOptions['onChildEvent']
    onChildTerminal?: AgentRuntimeSubagentToolBridgeOptions['onChildTerminal']
  } = {}
) {
  return createAgentRuntimeSubagentToolBridge({
    storeFactory: () => new InMemoryMultiAgentStore(),
    resolveBinding: async () => ({
      adapter,
      context: context(),
      enabled: true,
      maxParallel: options.maxParallel ?? 2
    }),
    onChildEvent: options.onChildEvent,
    onChildTerminal: options.onChildTerminal
  })
}

function completedAdapter(runtime: AgentRuntimeId): AgentRuntimeSubagentAdapter {
  return {
    spawn: vi.fn(async (_context, input) => {
      await input.onThreadBound({ runtime, threadId: `${runtime}-child-thread` })
      await input.onSpawned({ runtime, threadId: `${runtime}-child-thread`, turnId: `${runtime}-child-turn` })
      return {
        summary: `${runtime}: ${input.prompt}`,
        threadRef: { runtime, threadId: `${runtime}-child-thread`, turnId: `${runtime}-child-turn` }
      }
    }),
    resume: vi.fn(async (_context, input) => {
      await input.onThreadBound({ runtime, threadId: input.threadRef.threadId })
      await input.onSpawned({ runtime, threadId: input.threadRef.threadId, turnId: `${runtime}-resumed-turn` })
      return {
        summary: `${runtime}: ${input.prompt}`,
        threadRef: { runtime, threadId: input.threadRef.threadId, turnId: `${runtime}-resumed-turn` }
      }
    }),
    inspect: vi.fn(async () => ({ state: 'active' as const, observedAt: '2026-08-02T00:00:00.000Z' })),
    message: vi.fn(async () => ({ established: true })),
    cancel: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined)
  }
}

function childId(response: Awaited<ReturnType<ReturnType<typeof bridgeWith>['callTool']>>): string {
  const value = response.structuredContent as { childId?: unknown } | undefined
  return typeof value?.childId === 'string' ? value.childId : ''
}

describe('AgentRuntime subagent tool bridge', () => {
  it('reuses an existing child when a stable taskKey is delegated again', async () => {
    const adapter = completedAdapter('codex')
    const bridge = bridgeWith(adapter)
    const base = { runtimeId: 'codex' as const, threadId: 'parent-thread', turnId: 'parent-turn' }
    const first = await bridge.callTool({
      ...base,
      requestId: 'delegate-first',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: { prompt: 'Produce the report', taskKey: 'report:v1' }
    })
    const second = await bridge.callTool({
      ...base,
      requestId: 'delegate-retry',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: { prompt: 'Produce the report', taskKey: 'report:v1' }
    })
    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(childId(second)).toBe(childId(first))
    expect(adapter.spawn).toHaveBeenCalledTimes(1)
    bridge.dispose()
  })

  it('rediscovers disk-persisted interrupted children and resumes their existing provider conversation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'subagent-recovery-'))
    const store = new FileMultiAgentStore(join(root, 'codex'))
    for (const [id, parent] of [['interrupted', 'parent-thread'], ['private-child', 'another-parent']]) {
      await store.upsert(MultiAgentChildRunRecord.parse({
        id, parentThreadId: parent, parentTurnId: 'old-turn',
        prompt: 'Finish the review', status: 'running',
        threadRef: { runtime: 'codex', threadId: `${id}-provider-thread`, turnId: 'old-child-turn' },
        transcript: [{ id: 'progress', kind: 'assistant_message', text: 'Reviewed the first two sections.' }],
        createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:01.000Z'
      }))
    }
    const adapter = completedAdapter('codex')
    const bridge = createAgentRuntimeSubagentToolBridge({
      storeRoot: root,
      resolveBinding: async () => ({ adapter, context: context(), enabled: true, maxParallel: 2 })
    })
    try {
      const state = await bridge.parentContext('codex', 'parent-thread')
      expect(state).toContain('interrupted')
      expect(state).toContain('subagent_resume')
      expect(state).not.toContain('private-child')
      const base = { runtimeId: 'codex', threadId: 'parent-thread', turnId: 'new-turn' }
      const listed = await bridge.callTool({ ...base, requestId: 'list', tool: AGENT_RUNTIME_SUBAGENT_STATUS_TOOL_NAME, arguments: {} })
      expect(listed).toMatchObject({ success: true, structuredContent: {
        children: [{ childId: 'interrupted', status: 'aborted', resumable: true, recentProgress: expect.arrayContaining([
          expect.objectContaining({ text: 'Reviewed the first two sections.' })
        ]) }]
      } })
      const inspected = await bridge.callTool({ ...base, requestId: 'status', tool: AGENT_RUNTIME_SUBAGENT_STATUS_TOOL_NAME, arguments: { childId: 'interrupted' } })
      expect(inspected.success).toBe(true)
      const resumed = await bridge.callTool({ ...base, requestId: 'resume', tool: AGENT_RUNTIME_SUBAGENT_RESUME_TOOL_NAME, arguments: { childId: 'interrupted' } })
      expect(resumed.success).toBe(true)
      const finished = await bridge.callTool({ ...base, requestId: 'wait', tool: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME, arguments: { childId: 'interrupted', timeoutMs: 1000 } })
      expect(finished.structuredContent).toMatchObject({ childId: 'interrupted', status: 'completed', attempt: 2 })
      expect(adapter.spawn).not.toHaveBeenCalled()
      expect(adapter.resume).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        threadRef: expect.objectContaining({ threadId: 'interrupted-provider-thread' })
      }))
    } finally {
      bridge.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('binds the captured parent Principal to each exact child turn until terminal settlement', async () => {
    const bound = new Map<string, unknown>()
    const released: string[] = []
    const principalContext = Object.freeze({ identityVersion: 7, principal: null })
    const adapter = completedAdapter('codex')
    adapter.spawn = vi.fn(async (_context, input) => {
      const label = input.label ?? 'child'
      const threadRef = {
        runtime: 'codex',
        threadId: `${label}-thread`,
        turnId: `${label}-turn`
      }
      await input.onSpawned(threadRef)
      expect(bound.get(`${threadRef.threadId}:${threadRef.turnId}`)).toEqual(principalContext)
      return { summary: `${label} complete`, threadRef }
    })
    const bridge = createAgentRuntimeSubagentToolBridge({
      storeFactory: () => new InMemoryMultiAgentStore(),
      resolveBinding: async () => ({
        adapter,
        context: context(),
        enabled: true,
        maxParallel: 4
      }),
      principalForParentTurn: () => principalContext,
      bindChildTurnPrincipal: (_runtimeId, threadRef, captured) => {
        const key = `${threadRef.threadId}:${threadRef.turnId}`
        bound.set(key, captured)
        return () => {
          bound.delete(key)
          released.push(key)
        }
      }
    })

    const started = await bridge.callTool({
      requestId: 'principal-batch',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: {
        tasks: [
          { label: 'alpha', prompt: 'Alpha task' },
          { label: 'beta', prompt: 'Beta task' }
        ]
      }
    })
    const childIds = (started.structuredContent as {
      children: Array<{ childId?: string }>
    }).children.flatMap((result) => result.childId ? [result.childId] : [])
    expect(childIds).toHaveLength(2)
    await Promise.all(childIds.map((id) => bridge.callTool({
      requestId: `wait-${id}`,
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      arguments: { childId: id, timeoutMs: 1_000 }
    })))

    expect(bound.size).toBe(0)
    expect(released.sort()).toEqual(['alpha-thread:alpha-turn', 'beta-thread:beta-turn'])
  })

  it('owns one provider-neutral tool contract', () => {
    const bridge = bridgeWith(completedAdapter('codex'))
    expect(bridge.dynamicTools().map((tool) => tool.name)).toEqual([
      AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      AGENT_RUNTIME_SUBAGENT_STATUS_TOOL_NAME,
      AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      AGENT_RUNTIME_SUBAGENT_MESSAGE_TOOL_NAME,
      AGENT_RUNTIME_SUBAGENT_CANCEL_TOOL_NAME,
      AGENT_RUNTIME_SUBAGENT_DIAGNOSTICS_TOOL_NAME,
      AGENT_RUNTIME_SUBAGENT_RESUME_TOOL_NAME,
      AGENT_RUNTIME_SUBAGENT_DELETE_TOOL_NAME
    ])
    expect(bridge.canHandle({
      requestId: 'legacy',
      runtimeId: 'codex',
      threadId: 'parent',
      turnId: 'turn',
      namespace: 'multi_agent_v1',
      tool: 'spawn_agent',
      arguments: {}
    })).toBe(false)
    expect(bridge.dynamicTools()[0]?.description).toContain(
      'any number of independent child tasks'
    )
  })

  it('exposes only redacted product-level lifecycle counters', async () => {
    const bridge = bridgeWith(completedAdapter('codex'))
    const started = await bridge.callTool({
      requestId: 'diagnostic-child',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: { prompt: 'sensitive child prompt' }
    })
    await bridge.callTool({
      requestId: 'wait-diagnostic-child',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      arguments: { childId: childId(started), timeoutMs: 1_000 }
    })

    const response = await bridge.callTool({
      requestId: 'read-diagnostics',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_DIAGNOSTICS_TOOL_NAME,
      arguments: {}
    })

    expect(response).toMatchObject({
      success: true,
      structuredContent: {
        activeChildExecutions: 0,
        activeLifecycleControls: 0,
        activeBoundaries: 0,
        pendingDelegationRequests: 0,
        trackedChildren: 1,
        statusCounts: { completed: 1 }
      }
    })
    expect(JSON.stringify(response)).not.toContain('sensitive child prompt')
  })

  it('starts an oversized batch without applying a per-call task limit', async () => {
    const adapter = completedAdapter('codex')
    const bridge = bridgeWith(adapter, { maxParallel: 2 })

    const response = await bridge.callTool({
      requestId: 'oversized-batch',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: {
        tasks: [
          { prompt: 'task 1' },
          { prompt: 'task 2' },
          { prompt: 'task 3' }
        ]
      }
    })

    expect(response).toMatchObject({ success: true })
    expect(adapter.spawn).toHaveBeenCalledTimes(3)
  })

  it('starts ten child agents in one call when configured capacity is ten', async () => {
    const adapter = completedAdapter('codex')
    const bridge = bridgeWith(adapter, { maxParallel: 10 })

    const response = await bridge.callTool({
      requestId: 'ten-child-batch',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: {
        tasks: Array.from({ length: 10 }, (_, index) => ({
          prompt: `task ${index + 1}`
        }))
      }
    })

    expect(response).toMatchObject({
      success: true,
      structuredContent: {
        mode: 'parallel',
        children: expect.arrayContaining([
          expect.objectContaining({ index: 0, success: true }),
          expect.objectContaining({ index: 9, success: true })
        ])
      }
    })
    expect(adapter.spawn).toHaveBeenCalledTimes(10)
  })

  it('cancels every active child when its exact parent turn is aborted after delegation returns', async () => {
    const adapter: AgentRuntimeSubagentAdapter = {
      spawn: vi.fn(async (_context, input) => {
        await input.onSpawned({
          runtime: 'codex',
          threadId: `child-thread-${input.childId}`,
          turnId: `child-turn-${input.childId}`
        })
        await new Promise<void>((resolve) => {
          if (input.signal.aborted) resolve()
          else input.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        const error = new Error('cancelled')
        error.name = 'AbortError'
        throw error
      }),
      resume: vi.fn(async () => { throw new Error('unexpected resume') }),
      inspect: vi.fn(async () => ({ state: 'active' as const, observedAt: new Date().toISOString() })),
      message: vi.fn(async () => ({ established: true })),
      cancel: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined)
    }
    const bridge = bridgeWith(adapter, { maxParallel: 8 })
    const started = await bridge.callTool({
      requestId: 'eight-child-parent-cancel',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: {
        tasks: Array.from({ length: 8 }, (_, index) => ({ prompt: `task ${index + 1}` }))
      }
    })
    expect(started).toMatchObject({ success: true })

    expect(bridge.abortRequestsForTurn('codex', 'parent-thread', 'parent-turn')).toBe(8)
    await vi.waitFor(async () => {
      const diagnostics = await bridge.callTool({
        requestId: 'diagnostics-after-parent-cancel',
        runtimeId: 'codex',
        threadId: 'parent-thread',
        tool: AGENT_RUNTIME_SUBAGENT_DIAGNOSTICS_TOOL_NAME,
        arguments: {}
      })
      expect(diagnostics.structuredContent).toMatchObject({
        activeChildExecutions: 0,
        activeLifecycleControls: 0,
        activeBoundaries: 0
      })
    })
    expect(adapter.cancel).toHaveBeenCalledTimes(8)
  })

  it('intersects child tools with parent policy and forwards generic broker/deadline budgets', async () => {
    const adapter = completedAdapter('codex')
    const bridge = bridgeWith(adapter)
    await bridge.callTool({
      requestId: 'scoped-child',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      delegationContext: {
        allowedToolNames: ['sciforge_discover', 'sciforge_invoke'],
        brokerScope: { providerFamily: 'managed-mcp', packageName: '@sciforge/domain-computer-use' }
      },
      arguments: {
        prompt: 'use one managed package',
        allowedToolNames: ['sciforge_discover', 'sciforge_invoke', 'shell'],
        brokerScope: { providerFamily: 'managed-mcp', packageName: '@sciforge/domain-computer-use' },
        deadlineMs: 30_000,
        maxToolCalls: 32
      }
    })

    expect(adapter.spawn).toHaveBeenCalledWith(context(), expect.objectContaining({
      allowedTools: ['sciforge_discover', 'sciforge_invoke'],
      brokerScope: { providerFamily: 'managed-mcp', packageName: '@sciforge/domain-computer-use' },
      maxToolCalls: 32
    }))
  })

  it.each<AgentRuntimeId>(['codex', 'claude'])(
    'routes spawn and observation through the %s adapter contract',
    async (runtimeId) => {
      const adapter = completedAdapter(runtimeId)
      const bridge = bridgeWith(adapter)
      const started = await bridge.callTool({
        requestId: 'spawn',
        runtimeId,
        threadId: 'parent-thread',
        turnId: 'parent-turn',
        tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
        arguments: { prompt: 'inspect the repository' }
      })
      expect(started).toMatchObject({ success: true, structuredContent: { status: 'running' } })
      const id = childId(started)
      expect(id).not.toBe('')
      await expect(bridge.callTool({
        requestId: 'wait',
        runtimeId,
        threadId: 'parent-thread',
        tool: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
        arguments: { childId: id, timeoutMs: 1_000 }
      })).resolves.toMatchObject({
        success: true,
        structuredContent: { status: 'completed' }
      })
      expect(adapter.spawn).toHaveBeenCalledOnce()
    }
  )

  it('maps inspect, message, and cancel to separate adapter operations', async () => {
    let spawned!: (input: AgentRuntimeSubagentSpawnInput) => void
    const ready = new Promise<AgentRuntimeSubagentSpawnInput>((resolve) => { spawned = resolve })
    const adapter: AgentRuntimeSubagentAdapter = {
      spawn: vi.fn(async (_context, input) => {
        await input.onSpawned({ runtime: 'claude', threadId: 'child-thread', turnId: 'child-turn' })
        spawned(input)
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
        const error = new Error('cancelled')
        error.name = 'AbortError'
        throw error
      }),
      resume: vi.fn(async () => ({ summary: 'resumed' })),
      inspect: vi.fn(async () => ({ state: 'active' as const, observedAt: '2026-08-02T00:00:00.000Z' })),
      message: vi.fn(async () => ({ established: true })),
      cancel: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined)
    }
    const bridge = bridgeWith(adapter)
    const started = await bridge.callTool({
      requestId: 'spawn',
      runtimeId: 'claude',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      delegationContext: {
        allowedToolNames: ['sciforge_discover', 'sciforge_invoke'],
        brokerScope: {
          providerFamily: 'managed-mcp',
          packageName: '@sciforge/domain-computer-use'
        }
      },
      arguments: {
        prompt: 'keep working',
        allowedToolNames: ['sciforge_discover', 'sciforge_invoke', 'shell'],
        brokerScope: {
          providerFamily: 'managed-mcp',
          packageName: '@sciforge/domain-computer-use'
        },
        deadlineMs: 30_000,
        maxToolCalls: 32
      }
    })
    await ready
    const id = childId(started)
    await expect(bridge.callTool({
      requestId: 'inspect',
      runtimeId: 'claude',
      threadId: 'parent-thread',
      tool: AGENT_RUNTIME_SUBAGENT_STATUS_TOOL_NAME,
      arguments: { childId: id }
    })).resolves.toMatchObject({ success: true, structuredContent: { liveness: { state: 'active' } } })
    await expect(bridge.callTool({
      requestId: 'message',
      runtimeId: 'claude',
      threadId: 'parent-thread',
      tool: AGENT_RUNTIME_SUBAGENT_MESSAGE_TOOL_NAME,
      arguments: { childId: id, message: 'send a progress update' }
    })).resolves.toMatchObject({ success: true })
    await expect(bridge.callTool({
      requestId: 'cancel',
      runtimeId: 'claude',
      threadId: 'parent-thread',
      tool: AGENT_RUNTIME_SUBAGENT_CANCEL_TOOL_NAME,
      arguments: { childId: id }
    })).resolves.toMatchObject({ success: true, structuredContent: { status: 'aborted' } })
    await expect(bridge.callTool({
      requestId: 'resume',
      runtimeId: 'claude',
      threadId: 'parent-thread',
      turnId: 'parent-turn-2',
      tool: AGENT_RUNTIME_SUBAGENT_RESUME_TOOL_NAME,
      arguments: { childId: id, prompt: 'Continue the task.' }
    })).resolves.toMatchObject({ success: true, structuredContent: { status: 'running', resumed: true, attempt: 2 } })
    await expect(bridge.callTool({
      requestId: 'resume-wait',
      runtimeId: 'claude',
      threadId: 'parent-thread',
      tool: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      arguments: { childId: id, timeoutMs: 1_000 }
    })).resolves.toMatchObject({ success: true, structuredContent: { status: 'completed' } })
    await expect(bridge.callTool({
      requestId: 'delete',
      runtimeId: 'claude',
      threadId: 'parent-thread',
      tool: AGENT_RUNTIME_SUBAGENT_DELETE_TOOL_NAME,
      arguments: { childId: id }
    })).resolves.toMatchObject({ success: true, structuredContent: { deleted: true } })
    expect(adapter.inspect).toHaveBeenCalledOnce()
    expect(adapter.message).toHaveBeenCalledWith(context(), expect.objectContaining({ message: 'send a progress update' }))
    expect(adapter.cancel).toHaveBeenCalledOnce()
    expect(adapter.resume).toHaveBeenCalledWith(context(), expect.objectContaining({
      threadRef: expect.objectContaining({ threadId: 'child-thread' }),
      prompt: 'Continue the task.',
      allowedTools: ['sciforge_discover', 'sciforge_invoke'],
      brokerScope: {
        providerFamily: 'managed-mcp',
        packageName: '@sciforge/domain-computer-use'
      },
      maxToolCalls: 32
    }))
    expect(adapter.delete).toHaveBeenCalledOnce()
  })

  it('publishes runtime-neutral child records with the selected runtime identity', async () => {
    const events = vi.fn()
    const bridge = bridgeWith(completedAdapter('claude'), { onChildEvent: events })
    const started = await bridge.callTool({
      requestId: 'spawn',
      runtimeId: 'claude',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: { prompt: 'read a paper' }
    })
    await bridge.callTool({
      requestId: 'wait',
      runtimeId: 'claude',
      threadId: 'parent-thread',
      tool: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      arguments: { childId: childId(started), timeoutMs: 1_000 }
    })
    const [, event, record] = events.mock.calls.at(-1)!
    expect(agentRuntimeChildFromMultiAgentRecord('claude', record, event)).toMatchObject({
      runtimeId: 'claude',
      parentThreadId: 'parent-thread',
      openAsThreadRef: { runtimeId: 'claude', threadId: 'claude-child-thread' }
    })
  })

  it('delivers one terminal lifecycle when a completed child is later deleted', async () => {
    const terminal = vi.fn()
    const refresh = vi.fn()
    const bridge = bridgeWith(completedAdapter('codex'), {
      onChildEvent: refresh,
      onChildTerminal: terminal
    })
    const started = await bridge.callTool({
      requestId: 'terminal-once',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: { prompt: 'complete once' }
    })
    const id = childId(started)
    await bridge.callTool({
      requestId: 'terminal-once-wait',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      tool: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      arguments: { childId: id, timeoutMs: 1_000 }
    })
    await bridge.callTool({
      requestId: 'terminal-once-delete',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      tool: AGENT_RUNTIME_SUBAGENT_DELETE_TOOL_NAME,
      arguments: { childId: id }
    })

    expect(terminal).toHaveBeenCalledOnce()
    expect(refresh.mock.calls.map(([, event]) => event.operation)).toContain('delete')
  })

  it('recovers persisted stale children before spawning and isolates refresh failures', async () => {
    const store = new InMemoryMultiAgentStore()
    await store.upsert(MultiAgentChildRunRecord.parse({
      id: 'child-stale',
      parentThreadId: 'parent-thread',
      parentTurnId: 'stale-turn',
      requestId: 'stale-request',
      prompt: 'stale work',
      status: 'queued',
      transcript: [],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    }))
    const adapter = completedAdapter('codex')
    const refresh = vi.fn(async () => {
      throw new Error('child refresh unavailable')
    })
    const bridge = createAgentRuntimeSubagentToolBridge({
      storeFactory: () => store,
      resolveBinding: async () => ({
        adapter,
        context: context(),
        enabled: true,
        maxParallel: 2
      }),
      onChildEvent: refresh
    })

    const started = await bridge.callTool({
      requestId: 'fresh-request',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'fresh-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: { prompt: 'fresh work' }
    })
    await bridge.callTool({
      requestId: 'fresh-wait',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      tool: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      arguments: { childId: childId(started), timeoutMs: 1_000 }
    })

    expect((await store.get('parent-thread', 'child-stale'))?.status).toBe('aborted')
    expect(adapter.spawn).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalled()
    expect((await store.get('parent-thread', childId(started)))?.status).toBe('completed')
  })

  it('rejects recursive delegation from provider child threads', async () => {
    const bridge = bridgeWith(completedAdapter('codex'))
    const started = await bridge.callTool({
      requestId: 'spawn',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: { prompt: 'first level' }
    })
    await bridge.callTool({
      requestId: 'wait',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      tool: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      arguments: { childId: childId(started), timeoutMs: 1_000 }
    })
    await expect(bridge.callTool({
      requestId: 'nested',
      runtimeId: 'codex',
      threadId: 'codex-child-thread',
      turnId: 'codex-child-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: { prompt: 'nested child' }
    })).resolves.toMatchObject({
      success: false,
      contentItems: [{ text: 'Subagent delegation is disabled inside child agents.' }]
    })
  })

  it('marks provider-completed children with a persisted thread as resumable', async () => {
    const bridge = bridgeWith(completedAdapter('codex'))
    const started = await bridge.callTool({
      requestId: 'spawn',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: { prompt: 'partial work' }
    })
    const finished = await bridge.callTool({
      requestId: 'wait',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      tool: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      arguments: { childId: childId(started), timeoutMs: 1_000 }
    })
    expect(finished.structuredContent).toMatchObject({
      status: 'completed',
      resumable: true,
      resumeTool: AGENT_RUNTIME_SUBAGENT_RESUME_TOOL_NAME
    })
    const resumed = await bridge.callTool({
      requestId: 'resume-completed',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'follow-up-turn',
      tool: AGENT_RUNTIME_SUBAGENT_RESUME_TOOL_NAME,
      arguments: { childId: childId(started), prompt: 'Verify the files and finish any missing deliverable.' }
    })
    expect(resumed).toMatchObject({
      success: true,
      structuredContent: { status: 'running', resumed: true, attempt: 2 }
    })
    await expect(bridge.callTool({
      requestId: 'resume-completed-wait',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'follow-up-turn',
      tool: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      arguments: { childId: childId(started), timeoutMs: 1_000 }
    })).resolves.toMatchObject({
      success: true,
      structuredContent: { status: 'completed', attempt: 2 }
    })
  })

  it('exposes the persisted child transcript for continuation after a terminal turn', async () => {
    const bridge = bridgeWith(completedAdapter('codex'))
    const started = await bridge.callTool({
      requestId: 'transcript-spawn',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: { prompt: 'write and verify the report' }
    })
    const id = childId(started)
    const transcript = await bridge.callTool({
      requestId: 'transcript-read',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_STATUS_TOOL_NAME,
      arguments: { childId: id, includeTranscript: true, offset: 0, transcriptLimit: 20 }
    })
    expect(transcript).toMatchObject({
      success: true,
      structuredContent: {
        childId: id,
        transcript: {
          entries: expect.arrayContaining([
            expect.objectContaining({ kind: 'user_message', text: 'write and verify the report' })
          ])
        }
      }
    })
  })

  it('suspends only the exact persistent child deadline during external interaction', async () => {
    let resolveThreadBound!: () => void
    const threadBound = new Promise<void>((resolve) => { resolveThreadBound = resolve })
    let continueStartup!: () => void
    const startupMayContinue = new Promise<void>((resolve) => { continueStartup = resolve })
    let childSignal: AbortSignal | undefined
    const adapter: AgentRuntimeSubagentAdapter = {
      spawn: vi.fn(async (_context, input) => {
        childSignal = input.signal
        await input.onThreadBound({
          runtime: 'codex',
          threadId: 'codex-waiting-child'
        })
        resolveThreadBound()
        await startupMayContinue
        await input.onSpawned({
          runtime: 'codex',
          threadId: 'codex-waiting-child',
          turnId: 'codex-waiting-turn'
        })
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
        throw input.signal.reason
      }),
      resume: vi.fn(async () => { throw new Error('unexpected resume') }),
      inspect: vi.fn(async () => ({ state: 'active' as const, observedAt: '2026-08-02T00:00:00.000Z' })),
      message: vi.fn(async () => ({ established: true })),
      cancel: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined)
    }
    const bridge = bridgeWith(adapter)
    const started = await bridge.callTool({
      requestId: 'spawn-waiting-child',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: { prompt: 'wait for approval', deadlineMs: 40 }
    })
    await threadBound

    expect(bridge.suspendChildExecutionDeadline('codex', 'codex-waiting-child', 'approval-1')).toBe(true)
    expect(bridge.suspendChildExecutionDeadline('codex', 'unrelated-child', 'approval-2')).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(childSignal?.aborted).toBe(false)
    expect(bridge.resumeChildExecutionDeadline('codex', 'codex-waiting-child', 'approval-1')).toBe(true)
    continueStartup()

    const waited = await bridge.callTool({
      requestId: 'wait-for-deadline',
      runtimeId: 'codex',
      threadId: 'parent-thread',
      tool: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      arguments: { childId: childId(started), timeoutMs: 1_000 }
    })
    expect(waited.structuredContent).toMatchObject({ status: 'aborted' })
    expect(bridge.resumeChildExecutionDeadline('codex', 'codex-waiting-child', 'approval-1')).toBe(false)
  })
})
