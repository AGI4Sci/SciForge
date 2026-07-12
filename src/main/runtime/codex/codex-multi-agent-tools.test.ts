import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FileMultiAgentStore, InMemoryMultiAgentStore } from '../../../../packages/workers/multi-agent/src'
import {
  CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
  createCodexMultiAgentToolBridge
} from './codex-multi-agent-tools'

describe('Codex multi-agent dynamic tools', () => {
  it('advertises the flat spawn tool expected by Codex app-server', () => {
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor: async () => ({ summary: 'unused' })
    })

    expect(bridge.dynamicTools()).toEqual([
      expect.objectContaining({
        type: 'function',
        name: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
        description: 'Send a query to a bounded child agent and return the child agent output.',
        inputSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            prompt: expect.objectContaining({ type: 'string' }),
            task: expect.objectContaining({ type: 'string' }),
            instructions: expect.objectContaining({ type: 'string' })
          })
        })
      })
    ])
  })

  it('handles flat and namespace spawn calls through the shared runtime', async () => {
    const executor = vi.fn(async ({ prompt }) => ({
      summary: `done: ${prompt}`,
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
    }))
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor
    })

    await expect(bridge.callTool({
      requestId: 'flat',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      arguments: { label: 'A', prompt: 'first' }
    })).resolves.toMatchObject({
      success: true,
      contentItems: [{ type: 'inputText', text: 'done: first' }]
    })

    await expect(bridge.callTool({
      requestId: 'namespaced',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      namespace: 'multi_agent_v1',
      tool: 'spawn_agent',
      arguments: { name: 'B', task: 'second' }
    })).resolves.toMatchObject({
      success: true,
      contentItems: [{ type: 'inputText', text: 'done: second' }]
    })
    expect(executor).toHaveBeenCalledTimes(2)
  })

  it('reuses one child run when app-server replays the same request', async () => {
    let release!: () => void
    let markEntered!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const entered = new Promise<void>((resolve) => { markEntered = resolve })
    const executor = vi.fn(async () => {
      markEntered()
      await waiting
      return { summary: 'done once' }
    })
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor
    })
    const request = {
      requestId: 'replayed-request',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      arguments: { label: 'reader', prompt: 'Read the paper' }
    }

    const first = bridge.callTool(request)
    const replayedWhileRunning = bridge.callTool(request)
    await entered
    expect(executor).toHaveBeenCalledTimes(1)

    release()
    await expect(Promise.all([first, replayedWhileRunning])).resolves.toEqual([
      expect.objectContaining({ success: true }),
      expect.objectContaining({ success: true })
    ])
    await expect(bridge.callTool(request)).resolves.toMatchObject({
      success: true,
      contentItems: [{ type: 'inputText', text: 'done once' }]
    })
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('treats the same request id in a restarted parent turn as a new attempt', async () => {
    const executor = vi.fn(async () => ({ summary: 'done' }))
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor
    })
    const base = {
      requestId: 'request-1',
      threadId: 'parent-thread',
      tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      arguments: { label: 'reader', prompt: 'Read the paper' }
    }

    await bridge.callTool({ ...base, turnId: 'turn-before-interrupt' })
    await bridge.callTool({ ...base, turnId: 'turn-after-restart' })

    expect(executor).toHaveBeenCalledTimes(2)
  })

  it('does not capacity-evict in-flight requests when concurrency exceeds the settled cache limit', async () => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const executor = vi.fn(async () => {
      await waiting
      return { summary: 'done' }
    })
    const bridge = createCodexMultiAgentToolBridge({
      maxParallel: 300,
      store: new InMemoryMultiAgentStore(),
      executor
    })
    const requests = Array.from({ length: 257 }, (_, index) => ({
      requestId: `request-${index}`,
      threadId: 'parent-thread',
      turnId: `parent-turn-${index}`,
      tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      arguments: { label: `reader-${index}`, prompt: `Read section ${index}` }
    }))

    const running = requests.map((request) => bridge.callTool(request))
    await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(257))
    const replayedOldest = bridge.callTool(requests[0])
    expect(executor).toHaveBeenCalledTimes(257)

    release()
    await expect(Promise.all([...running, replayedOldest])).resolves.toHaveLength(258)
    expect(executor).toHaveBeenCalledTimes(257)
  })

  it('retains a failed request result so replay does not execute side effects twice', async () => {
    const executor = vi.fn(async () => {
      throw new Error('child failed after a side effect')
    })
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor
    })
    const request = {
      requestId: 'failed-request',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      arguments: { label: 'writer', prompt: 'Perform one bounded write' }
    }

    await expect(bridge.callTool(request)).resolves.toMatchObject({ success: false })
    await expect(bridge.callTool(request)).resolves.toMatchObject({ success: false })
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('reuses the persisted child result after the main/app-server bridge restarts', async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), 'sciforge-codex-multi-agent-restart-'))
    try {
      const firstExecutor = vi.fn(async () => ({ summary: 'settled before restart' }))
      const request = {
        requestId: 'request-across-process-restart',
        threadId: 'parent-thread',
        turnId: 'parent-turn',
        tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
        arguments: { label: 'reader', prompt: 'Read exactly once' }
      }
      const firstBridge = createCodexMultiAgentToolBridge({
        storeRoot,
        executor: firstExecutor
      })
      await expect(firstBridge.callTool(request)).resolves.toMatchObject({
        success: true,
        contentItems: [{ type: 'inputText', text: 'settled before restart' }]
      })

      const replayExecutor = vi.fn(async () => ({ summary: 'must not run after restart' }))
      const restartedBridge = createCodexMultiAgentToolBridge({
        storeRoot,
        executor: replayExecutor
      })
      await expect(restartedBridge.callTool(request)).resolves.toMatchObject({
        success: true,
        contentItems: [{ type: 'inputText', text: 'settled before restart' }]
      })

      expect(firstExecutor).toHaveBeenCalledTimes(1)
      expect(replayExecutor).not.toHaveBeenCalled()
      const records = await new FileMultiAgentStore(storeRoot).list()
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({
        requestId: 'request-across-process-restart',
        status: 'completed',
        summary: 'settled before restart'
      })
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('reuses a persisted in-flight child identity after restart instead of spawning a duplicate', async () => {
    const store = new InMemoryMultiAgentStore()
    await store.upsert({
      contractVersion: 1,
      id: 'child-before-restart',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      requestId: 'request-in-flight-before-restart',
      prompt: 'Continue existing child',
      status: 'running',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      transcript: [],
      createdAt: '2026-07-12T00:00:00.000Z',
      startedAt: '2026-07-12T00:00:01.000Z',
      updatedAt: '2026-07-12T00:00:02.000Z'
    })
    const executor = vi.fn(async () => ({ summary: 'must not spawn duplicate' }))
    const restartedBridge = createCodexMultiAgentToolBridge({ store, executor })

    await expect(restartedBridge.callTool({
      requestId: 'request-in-flight-before-restart',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      arguments: { prompt: 'Continue existing child' }
    })).resolves.toMatchObject({
      success: false,
      contentItems: [{
        type: 'inputText',
        text: 'multi-agent child run is no longer active in this runtime process'
      }]
    })
    expect(executor).not.toHaveBeenCalled()
    expect(await store.list()).toHaveLength(1)
  })

  it('rejects empty prompts without starting a child run', async () => {
    const executor = vi.fn(async () => ({ summary: 'unreachable' }))
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor
    })

    await expect(bridge.callTool({
      requestId: 'empty',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      arguments: { label: 'A' }
    })).resolves.toEqual({
      success: false,
      contentItems: [{
        type: 'inputText',
        text: 'delegate_task requires a prompt, task, or instructions string.'
      }]
    })
    expect(executor).not.toHaveBeenCalled()
  })
})
