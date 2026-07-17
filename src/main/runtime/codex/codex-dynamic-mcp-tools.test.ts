import { describe, expect, it, vi } from 'vitest'
import {
  createCodexDynamicMcpToolBridge,
  dynamicToolResponseFromMcpResult,
  type CodexDynamicMcpClient
} from './codex-dynamic-mcp-tools'
import { createCodexMultiAgentToolBridge } from './codex-multi-agent-tools'

describe('Codex dynamic MCP tool bridge', () => {
  it('advertises MCP tools as flat Codex dynamic tools', async () => {
    const client = fakeMcpClient({
      tools: [
        {
          name: 'research.search',
          description: 'Search scientific literature.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
        },
        {
          name: 'ignored_tool',
          description: 'Not enabled.'
        }
      ]
    })
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{
        id: 'gui.research',
        command: '/bin/research-mcp',
        enabledTools: ['research.search']
      }],
      clientFactory: async () => client
    })

    await expect(bridge.dynamicTools()).resolves.toEqual([
      {
        type: 'function',
        name: 'research_search',
        description: 'Search scientific literature.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
      }
    ])
  })

  it('advertises provider-safe MCP input schemas for Codex dynamic tools', async () => {
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{
        id: 'gui_owl_computer_use',
        command: '/bin/computer-use-mcp',
        enabledTools: ['computer_use']
      }],
      clientFactory: async () => fakeMcpClient({
        tools: [{
          name: 'computer_use',
          description: 'Shared host UI control.',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list_targets', 'bind_target'],
                title: 'Action'
              },
              targetId: {
                type: 'string',
                minLength: 1
              }
            },
            required: ['action'],
            '$schema': 'http://json-schema.org/draft-07/schema#',
            definitions: { unused: { type: 'string' } }
          }
        }]
      })
    })

    await expect(bridge.dynamicTools()).resolves.toEqual([
      {
        type: 'function',
        name: 'computer_use',
        description: 'Shared host UI control.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list_targets', 'bind_target'] },
            targetId: { type: 'string', minLength: 1 }
          },
          required: ['action']
        }
      }
    ])
  })

  it('isolates an items tuple schema while keeping valid tools available', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'healthy result' }] }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'mixed-tools', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{
          name: 'bad_tuple',
          description: 'Must be unavailable.',
          inputSchema: {
            type: 'object',
            properties: {
              reviewEvidence: {
                type: 'object',
                properties: {
                  violations: { type: 'array', items: [] }
                }
              }
            },
            privateValue: 'DO_NOT_LEAK_SCHEMA_VALUE'
          }
        }, {
          name: 'healthy_tool',
          description: 'Must remain callable.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } }
          }
        }],
        callTool
      })
    })

    await expect(bridge.dynamicTools()).resolves.toEqual([{
      type: 'function',
      name: 'healthy_tool',
      description: 'Must remain callable.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } }
      }
    }])
    // Re-enumeration must not flood the bounded diagnostic history.
    await bridge.dynamicTools()
    await expect(bridge.callTool({
      requestId: 'healthy-after-invalid-schema',
      tool: 'healthy_tool',
      arguments: { query: 'evidence' }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'healthy result' }],
      success: true
    })
    expect(callTool).toHaveBeenCalledWith(
      { name: 'healthy_tool', arguments: { query: 'evidence' } },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
    expect(bridge.lifecycleEvents()).toEqual([
      expect.objectContaining({
        event: 'tool_unavailable',
        reason: 'invalid_input_schema',
        toolName: 'bad_tuple',
        diagnosticCode: 'schema_items_not_object'
      })
    ])
    expect(JSON.stringify(bridge.lifecycleEvents())).not.toContain('DO_NOT_LEAK_SCHEMA_VALUE')
    expect(JSON.stringify(bridge.lifecycleEvents())).not.toContain('violations')
  })

  it('rejects an explicit non-object input schema without exposing its value', async () => {
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'non-object', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{
          name: 'bad_root',
          inputSchema: 'PRIVATE_NON_OBJECT_SCHEMA'
        }]
      })
    })

    await expect(bridge.dynamicTools()).resolves.toEqual([])
    expect(bridge.lifecycleEvents()).toEqual([
      expect.objectContaining({
        event: 'tool_unavailable',
        toolName: 'bad_root',
        diagnosticCode: 'schema_root_not_object'
      })
    ])
    expect(JSON.stringify(bridge.lifecycleEvents())).not.toContain('PRIVATE_NON_OBJECT_SCHEMA')
  })

  it('rejects a JSON Schema whose root explicitly describes a non-object', async () => {
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'array-root', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{
          name: 'bad_array_root',
          inputSchema: { type: 'array', items: { type: 'string' } }
        }]
      })
    })

    await expect(bridge.dynamicTools()).resolves.toEqual([])
    expect(bridge.lifecycleEvents()).toEqual([
      expect.objectContaining({
        event: 'tool_unavailable',
        toolName: 'bad_array_root',
        diagnosticCode: 'schema_root_not_object'
      })
    ])
  })

  it('rejects nested non-object property schemas without leaking private fields', async () => {
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'nested-invalid', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{
          name: 'bad_nested',
          inputSchema: {
            type: 'object',
            properties: {
              privateCredential: 'PRIVATE_NESTED_SCHEMA_VALUE'
            }
          }
        }]
      })
    })

    await expect(bridge.dynamicTools()).resolves.toEqual([])
    expect(bridge.lifecycleEvents()).toEqual([
      expect.objectContaining({
        event: 'tool_unavailable',
        toolName: 'bad_nested',
        diagnosticCode: 'schema_property_not_object'
      })
    ])
    const diagnostics = JSON.stringify(bridge.lifecycleEvents())
    expect(diagnostics).not.toContain('privateCredential')
    expect(diagnostics).not.toContain('PRIVATE_NESTED_SCHEMA_VALUE')
  })

  it('keeps unavailable-tool lifecycle diagnostics bounded, deduplicated, and path/schema safe', async () => {
    const tools = Array.from({ length: 60 }, (_, index) => ({
      name: `bad_/private/schema-${index}`,
      inputSchema: {
        type: 'object',
        properties: {
          [`/Users/private/research/schema-${index}`]: 'DO_NOT_EXPOSE_SCHEMA_OR_PATH'
        }
      }
    }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: '/private/mcp/server', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({ tools })
    })

    await expect(bridge.dynamicTools()).resolves.toEqual([])
    await bridge.dynamicTools()
    const diagnostics = bridge.toolUnavailableDiagnostics()
    expect(diagnostics).toHaveLength(50)
    expect(new Set(diagnostics.map((item) => `${item.toolName}:${item.diagnosticCode}`)).size).toBe(50)
    expect(diagnostics.every((item) => item.event === 'tool_unavailable')).toBe(true)
    expect(diagnostics.every((item) => item.reason === 'invalid_input_schema')).toBe(true)
    const serialized = JSON.stringify(diagnostics)
    expect(serialized).not.toContain('/private/')
    expect(serialized).not.toContain('/Users/')
    expect(serialized).not.toContain('DO_NOT_EXPOSE_SCHEMA_OR_PATH')
    expect(serialized).not.toContain('properties')
  })

  it('reconnects when an MCP connection closes while loading the tool catalog', async () => {
    const firstClose = vi.fn(async () => undefined)
    const firstListTools = vi.fn(async () => {
      throw new Error('Transport closed')
    })
    const secondListTools = vi.fn(async () => ({
      tools: [{ name: 'lookup', description: 'Callable.' }]
    }))
    const firstClient = fakeMcpClient({
      listTools: firstListTools,
      close: firstClose
    })
    const secondClient = fakeMcpClient({
      listTools: secondListTools
    })
    const clients = [firstClient, secondClient]
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: vi.fn(async () => clients.shift() ?? secondClient)
    })

    await expect(bridge.dynamicTools()).resolves.toEqual([
      {
        type: 'function',
        name: 'lookup',
        description: 'Callable.',
        inputSchema: { type: 'object', properties: {} }
      }
    ])
    expect(firstListTools).toHaveBeenCalledTimes(1)
    expect(firstClose).toHaveBeenCalledTimes(1)
    expect(secondListTools).toHaveBeenCalledTimes(1)
  })

  it('skips failed optional MCP catalogs when resolving an unqualified tool call', async () => {
    const workingCallTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'called working server' }]
    }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [
        { id: 'optional-broken', command: '/bin/broken' },
        { id: 'working', command: '/bin/working' }
      ],
      clientFactory: async (server) => {
        if (server.id === 'optional-broken') {
          return fakeMcpClient({
            listTools: vi.fn(async () => {
              throw new Error('MCP error -32000: Connection closed')
            })
          })
        }
        return fakeMcpClient({
          tools: [{ name: 'lookup', description: 'Callable.' }],
          callTool: workingCallTool
        })
      }
    })

    await expect(bridge.callTool({
      requestId: 'call-request-skip-broken-catalog',
      tool: 'lookup',
      arguments: { value: 1 }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'called working server' }],
      success: true
    })
    expect(workingCallTool).toHaveBeenCalledWith(
      { name: 'lookup', arguments: { value: 1 } },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('disambiguates duplicate MCP tool names without relying on namespace exposure', async () => {
    const labACallTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'lab-a' }] }))
    const labBCallTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'lab-b' }] }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [
        { id: 'lab.a', command: '/bin/lab-a' },
        { id: 'lab.b', command: '/bin/lab-b' }
      ],
      clientFactory: async (server) => fakeMcpClient({
        tools: [{ name: 'lookup', description: `Lookup for ${server.id}.` }],
        callTool: server.id === 'lab.a' ? labACallTool : labBCallTool
      })
    })

    const tools = await bridge.dynamicTools()
    expect(tools.map((tool) => tool.name)).toEqual(['mcp_lab_a_lookup', 'mcp_lab_b_lookup'])

    await expect(bridge.callTool({
      requestId: 'call-request-flat',
      tool: 'mcp_lab_b_lookup',
      arguments: { value: 1 }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'lab-b' }],
      success: true
    })
    expect(labACallTool).not.toHaveBeenCalled()
    expect(labBCallTool).toHaveBeenCalledWith(
      { name: 'lookup', arguments: { value: 1 } },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('routes dynamic tool calls back to the original MCP tool name', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { rows: 1 }
    }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'tool.with.dot', description: 'Callable.' }],
        callTool
      })
    })

    await bridge.dynamicTools()
    await expect(bridge.callTool({
      requestId: 'call-request-1',
      namespace: 'mcp_server-1',
      tool: 'tool_with_dot',
      arguments: { value: 1 }
    })).resolves.toEqual({
      contentItems: [
        { type: 'inputText', text: 'ok' },
        { type: 'inputText', text: 'structuredContent:\n{\n  "rows": 1\n}' }
      ],
      success: true
    })
    expect(callTool).toHaveBeenCalledWith(
      { name: 'tool.with.dot', arguments: { value: 1 } },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('parses JSON string arguments from Codex dynamic tool calls', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'lookup', description: 'Callable.' }],
        callTool
      })
    })

    await bridge.dynamicTools()
    await expect(bridge.callTool({
      requestId: 'call-request-json-string',
      tool: 'lookup',
      arguments: '{"id":"ABC-123"}'
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'ok' }],
      success: true
    })
    expect(callTool).toHaveBeenCalledWith(
      { name: 'lookup', arguments: { id: 'ABC-123' } },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('repairs numeric MCP arguments to match advertised schema bounds', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{
          name: 'research_search',
          description: 'Search scientific literature.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              maxResults: {
                type: 'integer',
                minimum: 1,
                maximum: 100
              },
              nested: {
                type: 'object',
                properties: {
                  limit: {
                    type: 'number',
                    minimum: 0,
                    maximum: 10
                  }
                }
              }
            }
          }
        }],
        callTool
      })
    })

    await bridge.dynamicTools()
    await expect(bridge.callTool({
      requestId: 'call-request-bounded-number',
      tool: 'research_search',
      arguments: {
        query: 'AI scientist',
        maxResults: 1000,
        nested: { limit: '12' }
      }
    })).resolves.toMatchObject({ success: true })
    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'research_search',
        arguments: {
          query: 'AI scientist',
          maxResults: 100,
          nested: { limit: 10 }
        }
      },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('reconnects and retries once when a cached MCP connection is closed', async () => {
    const firstClose = vi.fn(async () => undefined)
    const firstCallTool = vi.fn(async () => {
      throw new Error('MCP error -32000: Connection closed')
    })
    const secondCallTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'reconnected' }]
    }))
    const firstClient = fakeMcpClient({
      tools: [{ name: 'lookup', description: 'Callable.' }],
      callTool: firstCallTool,
      close: firstClose
    })
    const secondClient = fakeMcpClient({
      tools: [{ name: 'lookup', description: 'Callable.' }],
      callTool: secondCallTool
    })
    const clients = [firstClient, secondClient]
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: vi.fn(async () => clients.shift() ?? secondClient)
    })

    await bridge.dynamicTools()
    await expect(bridge.callTool({
      requestId: 'call-request-reconnect',
      tool: 'lookup',
      arguments: { value: 1 }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'reconnected' }],
      success: true
    })

    expect(firstCallTool).toHaveBeenCalledTimes(1)
    expect(firstClose).toHaveBeenCalledTimes(1)
    expect(secondCallTool).toHaveBeenCalledWith(
      { name: 'lookup', arguments: { value: 1 } },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('routes dotted dynamic tool call names back to their MCP server namespace', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'lookup', description: 'Callable.' }],
        callTool
      })
    })

    await bridge.dynamicTools()
    await expect(bridge.callTool({
      requestId: 'call-request-dotted',
      tool: 'mcp_server-1.lookup',
      arguments: { value: 1 }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'ok' }],
      success: true
    })
    expect(callTool).toHaveBeenCalledWith(
      { name: 'lookup', arguments: { value: 1 } },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('returns a failed dynamic tool response instead of throwing when lookup fails', async () => {
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => ({
        listTools: vi.fn(async () => {
          throw new Error('catalog unavailable')
        }),
        callTool: vi.fn(),
        close: vi.fn(async () => undefined)
      })
    })

    await expect(bridge.callTool({
      requestId: 'call-request-catalog-error',
      tool: 'lookup',
      arguments: {}
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'MCP tool lookup failed: catalog unavailable' }],
      success: false
    })
  })

  it('passes Codex computer-use arguments through dynamic MCP calls', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'bound' }],
      structuredContent: { ok: true }
    }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{
        id: 'gui_owl_computer_use',
        command: '/bin/computer-use-mcp',
        enabledTools: ['computer_use']
      }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'computer_use', description: 'Shared host UI control.' }],
        callTool
      })
    })

    await bridge.dynamicTools()
    await expect(bridge.callTool({
      requestId: 'request-1',
      threadId: 'codex-thread-1',
      turnId: 'codex-turn-1',
      tool: 'computer_use',
      arguments: {
        instruction: 'open the settings window'
      }
    })).resolves.toMatchObject({
      success: true
    })
    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'computer_use',
        arguments: {
          instruction: 'open the settings window'
        }
      },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('aborts in-flight MCP calls for an interrupted turn and records the reason', async () => {
    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const callTool: CodexDynamicMcpClient['callTool'] = vi.fn((_input, options) => new Promise((_, reject) => {
      resolveStarted()
      options?.signal?.addEventListener('abort', () => {
        reject(options.signal?.reason ?? new Error('aborted'))
      }, { once: true })
    }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'slow_tool', description: 'Slow callable.' }],
        callTool
      })
    })

    await bridge.dynamicTools()
    const pending = bridge.callTool({
      requestId: 'request-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'slow_tool',
      arguments: {}
    })
    await started
    expect(bridge.abortRequestsForTurn('thread-1', 'turn-1', 'user_stop')).toBe(1)
    await expect(pending).resolves.toMatchObject({ success: false })
    expect(bridge.lifecycleEvents()).toEqual([
      expect.objectContaining({
        event: 'request_aborted',
        reason: 'user_stop',
        requestId: 'request-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        toolName: 'slow_tool'
      })
    ])
  })

  it('only aborts multi-agent child calls for the exact interrupted turn', async () => {
    const bridge = createCodexMultiAgentToolBridge({
      executor: async ({ signal }) => {
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason ?? new Error('aborted'))
          }, { once: true })
        })
        return { summary: 'unreachable' }
      }
    })
    const first = bridge.callTool({
      requestId: 'request-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'delegate_task',
      arguments: { prompt: 'wait' }
    })
    const second = bridge.callTool({
      requestId: 'request-2',
      threadId: 'thread-1',
      turnId: 'turn-2',
      tool: 'delegate_task',
      arguments: { prompt: 'wait' }
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(bridge.abortRequestsForTurn('thread-1', 'turn-1')).toBe(1)
    await expect(first).resolves.toMatchObject({ success: false })
    expect(bridge.abortRequestsForTurn('thread-1', 'turn-2')).toBe(1)
    await expect(second).resolves.toMatchObject({ success: false })
  })

  it('converts MCP error results into failed dynamic tool responses', () => {
    expect(dynamicToolResponseFromMcpResult({
      content: [{ type: 'text', text: 'failed upstream' }],
      isError: true
    })).toEqual({
      contentItems: [{ type: 'inputText', text: 'failed upstream' }],
      success: false
    })
  })

  it('preserves structured MCP failure receipts for execution governance', () => {
    expect(dynamicToolResponseFromMcpResult({
      structuredContent: {
        error: {
          code: 'unknown_resource_ref',
          failureClass: 'stale_resource',
          retryable: true
        },
        resourceRef: 'res_surface_12345678901234567890'
      }
    })).toMatchObject({
      success: false,
      errorCode: 'unknown_resource_ref',
      failureClass: 'stale_resource',
      retryable: true,
      resourceIdentity: 'res_surface_12345678901234567890'
    })
  })
})

function fakeMcpClient(options: {
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>
  listTools?: CodexDynamicMcpClient['listTools']
  callTool?: CodexDynamicMcpClient['callTool']
  close?: CodexDynamicMcpClient['close']
}): CodexDynamicMcpClient {
  return {
    listTools: options.listTools ?? vi.fn(async () => ({ tools: options.tools ?? [] })),
    callTool: options.callTool ?? vi.fn(async () => ({ content: [] })),
    close: options.close ?? vi.fn(async () => undefined)
  }
}
