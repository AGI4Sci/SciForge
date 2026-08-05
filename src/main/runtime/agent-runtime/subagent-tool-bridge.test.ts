import { describe, expect, it, vi } from 'vitest'
import {
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
  AGENT_RUNTIME_SUBAGENT_MESSAGE_TOOL_NAME,
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
    maxChildren?: number
    onChildEvent?: AgentRuntimeSubagentToolBridgeOptions['onChildEvent']
  } = {}
) {
  return createAgentRuntimeSubagentToolBridge({
    storeFactory: () => new InMemoryMultiAgentStore(),
    resolveBinding: async () => ({
      adapter,
      context: context(),
      enabled: true,
      maxParallel: options.maxParallel ?? 2,
      maxChildren: options.maxChildren ?? 8
    }),
    onChildEvent: options.onChildEvent
  })
}

function completedAdapter(runtime: AgentRuntimeId): AgentRuntimeSubagentAdapter {
  return {
    spawn: vi.fn(async (_context, input) => {
      await input.onSpawned({ runtime, threadId: `${runtime}-child-thread`, turnId: `${runtime}-child-turn` })
      return {
        summary: `${runtime}: ${input.prompt}`,
        threadRef: { runtime, threadId: `${runtime}-child-thread`, turnId: `${runtime}-child-turn` }
      }
    }),
    inspect: vi.fn(async () => ({ state: 'active' as const, observedAt: '2026-08-02T00:00:00.000Z' })),
    message: vi.fn(async () => ({ established: true })),
    cancel: vi.fn(async () => undefined)
  }
}

function childId(response: Awaited<ReturnType<ReturnType<typeof bridgeWith>['callTool']>>): string {
  const value = response.structuredContent as { childId?: unknown } | undefined
  return typeof value?.childId === 'string' ? value.childId : ''
}

describe('AgentRuntime subagent tool bridge', () => {
  it('owns one provider-neutral tool contract', () => {
    const bridge = bridgeWith(completedAdapter('codex'))
    expect(bridge.dynamicTools().map((tool) => tool.name)).toEqual([
      AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      AGENT_RUNTIME_SUBAGENT_STATUS_TOOL_NAME,
      AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      AGENT_RUNTIME_SUBAGENT_MESSAGE_TOOL_NAME,
      AGENT_RUNTIME_SUBAGENT_CANCEL_TOOL_NAME
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
      'the configured child-run budget is shared by every delegate_task call in the same parent turn'
    )
    expect(bridge.dynamicTools()[0]?.description).toContain(
      'splitting the same workload across later delegate_task calls does not reset it'
    )
  })

  it('explains both concurrency and whole-turn budgets before an oversized batch can start', async () => {
    const adapter = completedAdapter('codex')
    const bridge = bridgeWith(adapter, { maxParallel: 2, maxChildren: 4 })

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

    expect(response).toMatchObject({ success: false })
    expect(response.contentItems).toEqual([{
      type: 'inputText',
      text: expect.stringContaining(
        'at most 2 concurrent tasks in one call, and this parent turn allows 4 child runs total'
      )
    }])
    expect(response.contentItems[0]?.type === 'inputText' ? response.contentItems[0].text : '').toContain(
      'splitting it into additional delegate_task calls does not reset the turn budget'
    )
    expect(adapter.spawn).not.toHaveBeenCalled()
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
      inspect: vi.fn(async () => ({ state: 'active' as const, observedAt: '2026-08-02T00:00:00.000Z' })),
      message: vi.fn(async () => ({ established: true })),
      cancel: vi.fn(async () => undefined)
    }
    const bridge = bridgeWith(adapter)
    const started = await bridge.callTool({
      requestId: 'spawn',
      runtimeId: 'claude',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      arguments: { prompt: 'keep working' }
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
    expect(adapter.inspect).toHaveBeenCalledOnce()
    expect(adapter.message).toHaveBeenCalledWith(context(), expect.objectContaining({ message: 'send a progress update' }))
    expect(adapter.cancel).toHaveBeenCalledOnce()
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
        maxParallel: 2,
        maxChildren: 8
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
})
