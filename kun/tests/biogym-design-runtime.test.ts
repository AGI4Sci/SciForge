import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BIOGYM_DESIGN_PROVIDER_ID,
  BIOGYM_DESIGN_TOOL_NAME,
  buildBioGymDesignToolProviderFromConfig
} from '../src/adapters/tool/biogym-design-tool.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'
import { createLocalRuntimeServeRuntime } from '../src/server/runtime-factory.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('native runtime BioGym registration', () => {
  it('registers the first-party provider only from the private bootstrap config', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-biogym-runtime-'))
    const runtime = await createLocalRuntimeServeRuntime({
      host: '127.0.0.1',
      port: 8899,
      dataDir,
      runtimeToken: 'runtime-token',
      apiKey: 'router-key',
      modelRouterBaseUrl: 'http://127.0.0.1:3892/v1',
      model: 'sciforge-router',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: false,
      bioGymBridge: {
        baseUrl: 'http://127.0.0.1:47891',
        token: 'runtime-private-token'
      }
    })

    try {
      const diagnostics = await runtime.toolDiagnostics?.()
      expect(diagnostics?.providers).toContainEqual(expect.objectContaining({
        id: BIOGYM_DESIGN_PROVIDER_ID,
        kind: 'built-in',
        available: true
      }))

      const matchingTools = await runtime.toolHost?.listTools(context(
        'Design a de novo protein scaffold with RFdiffusion'
      ))
      expect(matchingTools).toContainEqual(expect.objectContaining({
        name: BIOGYM_DESIGN_TOOL_NAME,
        providerId: BIOGYM_DESIGN_PROVIDER_ID,
        providerKind: 'built-in'
      }))

      const unrelatedTools = await runtime.toolHost?.listTools(context(
        'Summarize this coding-agent paper'
      ))
      expect(unrelatedTools?.some((tool) => tool.name === BIOGYM_DESIGN_TOOL_NAME)).toBe(false)
    } finally {
      await runtime.shutdown?.()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('routes the reported Chinese workflow directly through one approved native start call', async () => {
    const prompt = '请使用 BioGym 设计一个 80–100 aa 的 de novo protein scaffold。先生成 3 个 backbone，然后用 ProteinMPNN 设计 sequence，最后选择最好的 2 个候选用 Boltz-2 验证结构。每个阶段完成后分析结果，并在 Biology Room 展示候选。'
    const bridgeEnvelopes: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bridgeEnvelopes.push(JSON.parse(String(init?.body)) as unknown)
      return new Response(JSON.stringify({
        ok: true,
        data: {
          snapshot: {
            designRunId: 'design-111111111111111111111111',
            roomId: 'biogym-111111111111111111111111',
            revision: 1,
            status: 'starting'
          },
          nextAction: {
            kind: 'wait_for_host_continuation',
            callToolNow: false
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const provider = buildBioGymDesignToolProviderFromConfig({
      baseUrl: 'http://127.0.0.1:47891',
      token: 'private-test-token'
    })
    const mcpSearch = LocalToolHost.defineTool({
      name: 'mcp_search',
      description: 'Discover optional MCP tools.',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      execute: async () => ({ output: { tools: [] } })
    })
    const observedRequests: ModelRequest[] = []
    let modelStep = 0
    const model: ModelClient = {
      provider: 'scripted-deepseek-shape',
      model: 'scripted-deepseek-shape',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        observedRequests.push(request)
        modelStep += 1
        if (modelStep === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_biogym_start',
            toolName: BIOGYM_DESIGN_TOOL_NAME,
            arguments: {
              operation: 'start',
              workflow: 'de_novo_scaffold',
              objective: 'Design an 80-100 aa de novo scaffold, then sequence-design and verify the best two candidates.'
            }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: 'BioGym run created; waiting for the host continuation.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const host = new LocalToolHost({
      tools: [...provider.provider.tools, mcpSearch]
    })
    const h = makeHarness(model, { toolHost: host })
    await bootstrapThread(h, {
      workspace: '/tmp/sciforge-biogym-exact-prompt',
      request: { prompt, approvalPolicy: 'auto' }
    })

    const run = h.loop.runTurn(h.threadId, h.turnId)
    const approval = await waitForApproval(h)
    expect(h.approvalGate.decide(approval.id, 'allow')).toBe(true)
    expect(await run).toBe('completed')

    expect(observedRequests).toHaveLength(2)
    expect(observedRequests[0]?.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      BIOGYM_DESIGN_TOOL_NAME,
      'mcp_search'
    ]))
    expect(observedRequests[0]?.contextInstructions?.join('\n')).toContain(
      'Invoke `biogym_design` directly; do not call `mcp_search`'
    )
    const items = await h.sessionStore.loadItems(h.threadId)
    expect(items.filter((item) => item.kind === 'tool_call')).toEqual([
      expect.objectContaining({ toolName: BIOGYM_DESIGN_TOOL_NAME, status: 'completed' })
    ])
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_result',
        toolName: BIOGYM_DESIGN_TOOL_NAME,
        isError: false
      })
    ]))
    expect(JSON.stringify(await h.sessionStore.loadEventsSince(h.threadId, 0))).not.toContain(
      'tool_loop_recovery'
    )
    expect(bridgeEnvelopes).toHaveLength(1)
    expect(bridgeEnvelopes[0]).toMatchObject({
      request: {
        operation: 'start',
        workflow: 'de_novo_scaffold'
      },
      context: {
        threadId: h.threadId,
        turnId: h.turnId,
        workspace: '/tmp/sciforge-biogym-exact-prompt'
      }
    })

    const followUp = await h.turns.startTurn({
      threadId: h.threadId,
      request: {
        prompt: '请查看结果并继续',
        approvalPolicy: 'auto',
        nativeToolContext: { activeToolNames: [BIOGYM_DESIGN_TOOL_NAME] }
      }
    })
    h.turnId = followUp.turnId
    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('completed')

    expect(observedRequests).toHaveLength(3)
    expect(observedRequests[2]?.tools.some((tool) => tool.name === BIOGYM_DESIGN_TOOL_NAME)).toBe(true)

    const terminalFollowUp = await h.turns.startTurn({
      threadId: h.threadId,
      request: { prompt: '普通后续问题', approvalPolicy: 'auto' }
    })
    h.turnId = terminalFollowUp.turnId
    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('completed')

    expect(observedRequests).toHaveLength(4)
    expect(observedRequests[3]?.tools.some((tool) => tool.name === BIOGYM_DESIGN_TOOL_NAME)).toBe(false)
    const followUpItems = await h.sessionStore.loadItems(h.threadId)
    expect(followUpItems).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'error', code: 'tool_catalog_changed' })
    ]))
    expect(JSON.stringify(await h.sessionStore.loadEventsSince(h.threadId, 0))).not.toContain(
      'tool_catalog_changed'
    )
  })
})

function context(requestText: string): ToolHostContext {
  return {
    threadId: 'thread-native',
    turnId: 'turn-native',
    workspace: '/tmp/native-workspace',
    requestText,
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

async function waitForApproval(
  h: ReturnType<typeof makeHarness>
): Promise<ReturnType<typeof h.approvalGate.pending>[number]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const approval = h.approvalGate.pending(h.threadId)[0]
    if (approval) return approval
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for BioGym start approval')
}
