import { describe, expect, it } from 'vitest'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { makeToolCallItem, makeToolResultItem } from '../src/domain/item.js'
import type { ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'

describe('event-driven agent policy integration', () => {
  it('uses a default hard tool budget and forces a final no-tools synthesis', async () => {
    let executions = 0
    let modelSteps = 0
    const advertisedToolCounts: number[] = []
    const tool = LocalToolHost.defineTool({
      name: 'inspect_value',
      description: 'Return a deterministic value.',
      inputSchema: { type: 'object', properties: { index: { type: 'number' } } },
      policy: 'auto',
      execute: async (args) => {
        executions += 1
        return { output: { value: args.index } }
      }
    })
    const h = makeHarness({
      provider: 'budget-model',
      model: 'budget-model',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        modelSteps += 1
        advertisedToolCounts.push(request.tools.length)
        if (request.tools.length > 0) {
          yield {
            kind: 'tool_call_complete',
            callId: `call_${modelSteps}`,
            toolName: 'inspect_value',
            arguments: { index: modelSteps }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: 'Final synthesis from collected evidence.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { tools: [tool] })
    await bootstrapThread(h)

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')
    expect(executions).toBe(16)
    expect(modelSteps).toBe(17)
    expect(advertisedToolCounts.at(-1)).toBe(0)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'error', code: 'tool_budget_exhausted' })
    ]))
  })

  it('fails a persisted A/B action-observation cycle before another model call', async () => {
    let executions = 0
    let modelSteps = 0
    const tool = LocalToolHost.defineTool({
      name: 'lookup',
      description: 'Return no matches.',
      inputSchema: { type: 'object', properties: { pattern: { type: 'string' } } },
      policy: 'auto',
      execute: async () => {
        executions += 1
        return { output: { matches: [] } }
      }
    })
    const h = makeHarness({
      provider: 'alternating-model',
      model: 'alternating-model',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        modelSteps += 1
        yield {
          kind: 'tool_call_complete',
          callId: `call_${modelSteps}`,
          toolName: 'lookup',
          arguments: { pattern: modelSteps % 2 === 1 ? 'alpha' : 'beta' }
        }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      }
    }, { tools: [tool], toolStorm: { enabled: false } })
    await bootstrapThread(h)

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('failed')
    expect(executions).toBe(6)
    expect(modelSteps).toBe(6)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'error',
        code: 'agent_stuck',
        details: expect.objectContaining({ kind: 'alternating_action_observation' })
      })
    ]))
  })

  it('detects a redundant read through path aliases and covered ranges', async () => {
    let executions = 0
    let modelSteps = 0
    const readTool = LocalToolHost.defineTool({
      name: 'read',
      description: 'Read a line range.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'number' },
          limit: { type: 'number' }
        }
      },
      policy: 'auto',
      execute: async (args) => {
        executions += 1
        const offset = Number(args.offset)
        const limit = Number(args.limit)
        return {
          output: {
            path: '/repo/src/value.ts',
            start_line: offset,
            end_line: offset + limit - 1,
            total_lines: 100,
            content_sha256: 'stable-version',
            content: 'unchanged evidence'
          }
        }
      }
    })
    const h = makeHarness({
      provider: 'redundant-read-model',
      model: 'redundant-read-model',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        modelSteps += 1
        yield {
          kind: 'tool_call_complete',
          callId: `call_${modelSteps}`,
          toolName: 'read',
          arguments: modelSteps === 1
            ? { path: 'src/value.ts', offset: 1, limit: 100 }
            : { path: '/repo/src/./value.ts', offset: 20, limit: 10 }
        }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      }
    }, { tools: [readTool] })
    await bootstrapThread(h, { workspace: '/repo' })

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('failed')
    expect(executions).toBe(3)
    expect(modelSteps).toBe(3)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'error',
        code: 'agent_stuck',
        details: expect.objectContaining({ kind: 'redundant_read' })
      })
    ]))
  })

  it('reconstructs an exhausted tool budget from persisted turn items', async () => {
    const advertisedToolCounts: number[] = []
    const tool = LocalToolHost.defineTool({
      name: 'inspect_value',
      description: 'Return a value.',
      inputSchema: { type: 'object', properties: { index: { type: 'number' } } },
      policy: 'auto',
      execute: async () => ({ output: { unexpected: true } })
    })
    const h = makeHarness({
      provider: 'reconstructed-budget-model',
      model: 'reconstructed-budget-model',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        advertisedToolCounts.push(request.tools.length)
        yield { kind: 'assistant_text_delta', text: 'Synthesis after reconstruction.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { tools: [tool] })
    await bootstrapThread(h)
    for (let index = 1; index <= 16; index += 1) {
      const callId = `persisted_${index}`
      await h.turns.applyItem(h.threadId, makeToolCallItem({
        id: `item_call_${index}`,
        threadId: h.threadId,
        turnId: h.turnId,
        callId,
        toolName: 'inspect_value',
        arguments: { index },
        status: 'completed'
      }))
      await h.turns.applyItem(h.threadId, makeToolResultItem({
        id: `item_result_${index}`,
        threadId: h.threadId,
        turnId: h.turnId,
        callId,
        toolName: 'inspect_value',
        output: { value: index }
      }))
    }

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')
    expect(advertisedToolCounts).toEqual([0])
  })

  it('counts denied approval outcomes toward the hard tool budget', async () => {
    let modelSteps = 0
    let sideEffects = 0
    const advertisedToolCounts: number[] = []
    const guarded = LocalToolHost.defineTool({
      name: 'guarded_action',
      description: 'A guarded action.',
      toolKind: 'file_change',
      inputSchema: { type: 'object', properties: { index: { type: 'number' } } },
      policy: 'auto',
      execute: async () => {
        sideEffects += 1
        return { output: { sideEffects } }
      }
    })
    const h = makeHarness({
      provider: 'denied-budget-model',
      model: 'denied-budget-model',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        modelSteps += 1
        advertisedToolCounts.push(request.tools.length)
        if (request.tools.length > 0) {
          yield {
            kind: 'tool_call_complete',
            callId: `denied_${modelSteps}`,
            toolName: 'guarded_action',
            arguments: { index: modelSteps }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: 'Stopped after denied attempts.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { tools: [guarded], toolStorm: { enabled: false } })
    await bootstrapThread(h, {
      request: { prompt: 'Try guarded actions.', approvalPolicy: 'untrusted' }
    })
    h.approvalGate.request = async () => 'deny'

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')
    expect(sideEffects).toBe(0)
    expect(modelSteps).toBe(17)
    expect(advertisedToolCounts.at(-1)).toBe(0)
    const items = await h.sessionStore.loadItems(h.threadId)
    expect(items.filter((item) => item.kind === 'approval' && item.status === 'denied')).toHaveLength(16)
  })
})
