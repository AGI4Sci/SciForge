import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CREATE_PLAN_TOOL_NAME } from '../src/adapters/tool/create-plan-tool.js'
import { LocalToolHost, buildDefaultLocalTools, type LocalTool } from '../src/adapters/tool/local-tool-host.js'
import { resolvePlanModeToolSpecs } from '../src/loop/agent-loop.js'
import type { ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'

describe('AgentLoop sandbox policy', () => {
  it('uses the active turn sandbox when advertising tools to the model', async () => {
    let observedRequest: ModelRequest | null = null
    const h = makeHarness({
      provider: 'sandbox-observer',
      model: 'sandbox-observer',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        observedRequest = request
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h, {
      request: {
        prompt: 'inspect only',
        approvalPolicy: 'on-request',
        sandboxMode: 'read-only'
      }
    })

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    const request = observedRequest as ModelRequest | null
    if (!request) throw new Error('expected model request')
    const toolNames = request.tools.map((tool) => tool.name)
    expect(toolNames).toEqual(expect.arrayContaining(['read', 'grep', 'find', 'ls']))
    expect(toolNames).not.toContain('bash')
    expect(toolNames).not.toContain('edit')
    expect(toolNames).not.toContain('write')
    const context = request.contextInstructions?.join('\n') ?? ''
    expect(context).not.toContain('Shell runtime:')
    expect(context).not.toContain('<shell_environment>')
  })

  it('blocks mutating tool execution when a read-only turn calls it anyway', async () => {
    let executed = false
    const mutatingTool: LocalTool = LocalToolHost.defineTool({
      name: 'mutate_marker',
      description: 'Mutate a marker.',
      toolKind: 'file_change',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      policy: 'auto',
      execute: async () => {
        executed = true
        return { output: { mutated: true } }
      }
    })
    let calls = 0
    const h = makeHarness(
      {
        provider: 'sandbox-executor',
        model: 'sandbox-executor',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_mutate_marker',
              toolName: 'mutate_marker',
              arguments: {}
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [mutatingTool] }
    )
    await bootstrapThread(h, {
      request: {
        prompt: 'inspect only',
        sandboxMode: 'read-only'
      }
    })

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const result = items.find(
      (item) => item.kind === 'tool_result' && item.toolName === 'mutate_marker'
    )

    expect(status).toBe('completed')
    expect(executed).toBe(false)
    expect(result).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: {
        code: 'sandbox_read_only'
      }
    })
  })

  it('limits plan mode to read-only investigation tools and create_plan', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-plan-sandbox-'))
    let observedRequest: ModelRequest | null = null
    let calls = 0
    try {
      const h = makeHarness(
        {
          provider: 'plan-sandbox',
          model: 'plan-sandbox',
          async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
            calls += 1
            if (calls === 1) {
              observedRequest = request
              yield {
                kind: 'tool_call_complete',
                callId: 'call_plan',
                toolName: CREATE_PLAN_TOOL_NAME,
                arguments: {
                  markdown: '# Plan\n\n- Inspect first.',
                  operation: 'draft',
                  source_request: 'Plan the change'
                }
              }
              yield { kind: 'completed', stopReason: 'tool_calls' }
              return
            }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan the change',
          mode: 'plan'
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)

      expect(status).toBe('completed')
      const request = observedRequest as ModelRequest | null
      if (!request) throw new Error('expected model request')
      const toolNames = request.tools.map((tool) => tool.name)
      const allowedPlanTools = new Set([
        'read',
        'grep',
        'find',
        'ls',
        'web_search',
        'web_fetch',
        'request_user_input',
        CREATE_PLAN_TOOL_NAME
      ])
      expect(toolNames).toContain(CREATE_PLAN_TOOL_NAME)
      expect(toolNames).toContain('request_user_input')
      expect(toolNames).not.toContain('user_input')
      expect(toolNames.filter((name) => !allowedPlanTools.has(name))).toEqual([])
      expect(toolNames).not.toContain('bash')
      expect(toolNames).not.toContain('edit')
      expect(toolNames).not.toContain('write')
      expect(request.modeInstruction).toContain('Plan mode')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('keeps one structured user-input tool available after plan exploration', () => {
    const tools = [
      { name: 'read', description: '', inputSchema: {} },
      { name: 'bash', description: '', inputSchema: {} },
      { name: 'request_user_input', description: '', inputSchema: {} },
      { name: 'user_input', description: '', inputSchema: {} },
      { name: CREATE_PLAN_TOOL_NAME, description: '', inputSchema: {} }
    ] as ModelRequest['tools']

    expect(resolvePlanModeToolSpecs(tools, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 1
    }).map((tool) => tool.name)).toEqual([
      'request_user_input',
      CREATE_PLAN_TOOL_NAME
    ])
  })
})
