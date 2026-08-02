import { describe, expect, it, vi } from 'vitest'
import { InMemoryMultiAgentStore } from '../../../../packages/workers/multi-agent/src'
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
      maxChildren: 8
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
