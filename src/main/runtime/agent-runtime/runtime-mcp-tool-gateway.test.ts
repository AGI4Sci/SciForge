import { describe, expect, it, vi } from 'vitest'
import {
  createRuntimeMcpToolGateway,
  runtimeToolResponseFromMcpResult,
  type McpToolDescriptor,
  type RuntimeMcpClient
} from './runtime-mcp-tool-gateway'

describe('runtime MCP tool gateway', () => {
  it('advertises MCP tools as runtime tool definitions', async () => {
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
    const bridge = createRuntimeMcpToolGateway({
      servers: [{
        id: 'gui.research',
        command: '/bin/research-mcp',
        enabledTools: ['research.search']
      }],
      clientFactory: async () => client
    })

    await expect(bridge.tools()).resolves.toEqual([
      {
        type: 'function',
        namespace: 'mcp_gui_research',
        providerId: 'gui.research',
        providerToolName: 'research.search',
        name: 'research_search',
        description: 'Search scientific literature.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
      }
    ])
  })

  it('advertises provider-safe MCP input schemas for runtime tools', async () => {
    const bridge = createRuntimeMcpToolGateway({
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

    await expect(bridge.tools()).resolves.toEqual([
      {
        type: 'function',
        namespace: 'mcp_gui_owl_computer_use',
        providerId: 'gui_owl_computer_use',
        providerToolName: 'computer_use',
        name: 'computer_use',
        description: 'Shared host UI control.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list_targets', 'bind_target'] },
            targetId: { type: 'string' }
          },
          required: ['action']
        }
      }
    ])
  })

  it('isolates an items tuple schema while keeping valid tools available', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'healthy result' }] }))
    const bridge = createRuntimeMcpToolGateway({
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

    await expect(bridge.tools()).resolves.toEqual([{
      type: 'function',
      namespace: 'mcp_mixed-tools',
      providerId: 'mixed-tools',
      providerToolName: 'healthy_tool',
      name: 'healthy_tool',
      description: 'Must remain callable.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } }
      }
    }])
    // Re-enumeration must not flood the bounded diagnostic history.
    await bridge.tools()
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
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: 'non-object', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{
          name: 'bad_root',
          inputSchema: 'PRIVATE_NON_OBJECT_SCHEMA'
        }]
      })
    })

    await expect(bridge.tools()).resolves.toEqual([])
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
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: 'array-root', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{
          name: 'bad_array_root',
          inputSchema: { type: 'array', items: { type: 'string' } }
        }]
      })
    })

    await expect(bridge.tools()).resolves.toEqual([])
    expect(bridge.lifecycleEvents()).toEqual([
      expect.objectContaining({
        event: 'tool_unavailable',
        toolName: 'bad_array_root',
        diagnosticCode: 'schema_root_not_object'
      })
    ])
  })

  it('rejects nested non-object property schemas without leaking private fields', async () => {
    const bridge = createRuntimeMcpToolGateway({
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

    await expect(bridge.tools()).resolves.toEqual([])
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
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: '/private/mcp/server', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({ tools })
    })

    await expect(bridge.tools()).resolves.toEqual([])
    await bridge.tools()
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
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: vi.fn(async () => clients.shift() ?? secondClient)
    })

    await expect(bridge.tools()).resolves.toEqual([
      {
        type: 'function',
        namespace: 'mcp_server-1',
        providerId: 'server-1',
        providerToolName: 'lookup',
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
    const bridge = createRuntimeMcpToolGateway({
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

  it('uses stable provider namespaces for duplicate MCP tool names', async () => {
    const labACallTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'lab-a' }] }))
    const labBCallTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'lab-b' }] }))
    const bridge = createRuntimeMcpToolGateway({
      servers: [
        { id: 'lab.a', command: '/bin/lab-a' },
        { id: 'lab.b', command: '/bin/lab-b' }
      ],
      clientFactory: async (server) => fakeMcpClient({
        tools: [{ name: 'lookup', description: `Lookup for ${server.id}.` }],
        callTool: server.id === 'lab.a' ? labACallTool : labBCallTool
      })
    })

    const tools = await bridge.tools()
    expect(tools.map((tool) => ({ namespace: tool.namespace, name: tool.name }))).toEqual([
      { namespace: 'mcp_lab_a', name: 'lookup' },
      { namespace: 'mcp_lab_b', name: 'lookup' }
    ])

    await expect(bridge.callTool({
      requestId: 'call-request-namespaced',
      namespace: 'mcp_lab_b',
      tool: 'lookup',
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

  it('routes runtime tool calls back to the original MCP tool name', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { rows: 1 }
    }))
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'tool.with.dot', description: 'Callable.' }],
        callTool
      })
    })

    await bridge.tools()
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
      success: true,
      structuredContent: { rows: 1 }
    })
    expect(callTool).toHaveBeenCalledWith(
      { name: 'tool.with.dot', arguments: { value: 1 } },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('parses JSON string arguments from Codex runtime tool calls', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'lookup', description: 'Callable.' }],
        callTool
      })
    })

    await bridge.tools()
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

  it('passes MCP arguments through without silent schema repair', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    const bridge = createRuntimeMcpToolGateway({
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

    await bridge.tools()
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
          maxResults: 1000,
          nested: { limit: '12' }
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
      tools: [{
        name: 'lookup',
        description: 'Callable.',
        annotations: { readOnlyHint: true }
      }],
      callTool: firstCallTool,
      close: firstClose
    })
    const secondClient = fakeMcpClient({
      tools: [{
        name: 'lookup',
        description: 'Callable.',
        annotations: { readOnlyHint: true }
      }],
      callTool: secondCallTool
    })
    const clients = [firstClient, secondClient]
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: vi.fn(async () => clients.shift() ?? secondClient)
    })

    await bridge.tools()
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

  it('routes dotted runtime tool call names back to their MCP server namespace', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'lookup', description: 'Callable.' }],
        callTool
      })
    })

    await bridge.tools()
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

  it('returns a failed runtime tool response instead of throwing when lookup fails', async () => {
    const bridge = createRuntimeMcpToolGateway({
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
    })).resolves.toMatchObject({
      contentItems: [{ type: 'inputText', text: 'MCP tool lookup failed: catalog unavailable' }],
      success: false,
      errorCode: 'mcp_tool_failed',
      retryable: true
    })
  })

  it('passes trusted invocation metadata through generic domain contributions', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'bound' }],
      structuredContent: { ok: true }
    }))
    const bridge = createRuntimeMcpToolGateway({
      servers: [{
        id: 'domain-worker',
        command: '/bin/domain-worker',
        enabledTools: ['domain_tool']
      }],
      trustedInvocationMetadata: [{
        serverId: 'domain-worker',
        tools: ['domain_tool'],
        metadataKey: 'io.example/trusted-invocation',
        source: 'trusted-invocation'
      }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'domain_tool', description: 'Domain-owned tool.' }],
        callTool
      })
    })

    await bridge.tools()
    await expect(bridge.callTool({
      requestId: 'request-1',
      threadId: 'codex-thread-1',
      turnId: 'codex-turn-1',
      tool: 'domain_tool',
      arguments: {
        instruction: 'open the settings window'
      },
      trustedInvocation: {
        requestId: 'request-1',
        runtimeId: 'codex',
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        actionId: 'managed-mcp.computer-use',
        invocationId: 'invocation-1',
        approval: 'confirmation'
      }
    })).resolves.toMatchObject({
      success: true
    })
    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'domain_tool',
        arguments: {
          instruction: 'open the settings window'
        },
        _meta: {
          'io.example/trusted-invocation': {
            requestId: 'request-1',
            runtimeId: 'codex',
            threadId: 'codex-thread-1',
            turnId: 'codex-turn-1',
            actionId: 'managed-mcp.computer-use',
            invocationId: 'invocation-1',
            approval: 'confirmation'
          }
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
    const callTool: RuntimeMcpClient['callTool'] = vi.fn((_input, options) => new Promise((_, reject) => {
      resolveStarted()
      options?.signal?.addEventListener('abort', () => {
        reject(options.signal?.reason ?? new Error('aborted'))
      }, { once: true })
    }))
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'slow_tool', description: 'Slow callable.' }],
        callTool
      })
    })

    await bridge.tools()
    const pending = bridge.callTool({
      requestId: 'request-1',
      runtimeId: 'test-runtime',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'slow_tool',
      arguments: {}
    })
    await started
    expect(bridge.abortRequestsForTurn({
      runtimeId: 'other-runtime',
      threadId: 'thread-1',
      turnId: 'turn-1'
    }, 'user_stop')).toBe(0)
    expect(bridge.abortRequestsForTurn({
      runtimeId: 'test-runtime',
      threadId: 'thread-1',
      turnId: 'turn-1'
    }, 'user_stop')).toBe(1)
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

  it('compacts a deeply nested catalog schema without recursive cloning', async () => {
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: 'deep-schema', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{
          name: 'deep_tool',
          inputSchema: {
            type: 'object',
            properties: { recipe: deepSchema(5_000) }
          }
        }]
      })
    })

    await expect(bridge.tools()).resolves.toEqual([
      expect.objectContaining({
        providerId: 'deep-schema',
        providerToolName: 'deep_tool',
        inputSchema: {
          type: 'object',
          properties: { recipe: { type: 'object' } }
        }
      })
    ])
  })

  it('rejects non-object arguments without calling the MCP server', async () => {
    const callTool = vi.fn(async () => ({ content: [] }))
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({ tools: [{ name: 'lookup' }], callTool })
    })

    await bridge.tools()
    await expect(bridge.callTool({
      requestId: 'invalid-arguments',
      tool: 'lookup',
      arguments: ['not', 'an', 'object']
    })).resolves.toMatchObject({
      success: false,
      errorCode: 'invalid_arguments',
      failureClass: 'invalid_arguments'
    })
    expect(callTool).not.toHaveBeenCalled()
  })

  it('does not retry a non-idempotent tool after an ambiguous disconnect', async () => {
    const firstCall = vi.fn(async () => { throw new Error('Connection closed') })
    const secondCall = vi.fn(async () => ({ content: [{ type: 'text', text: 'duplicated' }] }))
    const clients = [
      fakeMcpClient({
        tools: [{
          name: 'mutate',
          annotations: { readOnlyHint: false, idempotentHint: false }
        }],
        callTool: firstCall
      }),
      fakeMcpClient({ tools: [{ name: 'mutate' }], callTool: secondCall })
    ]
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => clients.shift()!
    })

    await bridge.tools()
    await expect(bridge.callTool({
      requestId: 'non-idempotent-disconnect',
      tool: 'mutate',
      arguments: {}
    })).resolves.toMatchObject({ success: false })
    expect(firstCall).toHaveBeenCalledTimes(1)
    expect(secondCall).not.toHaveBeenCalled()
  })

  it('synchronizes changed server configs through the single shared gateway', async () => {
    const oldClose = vi.fn(async () => undefined)
    const oldClient = fakeMcpClient({ tools: [{ name: 'old_tool' }], close: oldClose })
    const newClient = fakeMcpClient({ tools: [{ name: 'new_tool' }] })
    const bridge = createRuntimeMcpToolGateway({
      servers: [{ id: 'shared', command: '/bin/old' }],
      clientFactory: async (server) => server.command === '/bin/old' ? oldClient : newClient
    })

    await bridge.tools()
    await expect(bridge.sync([{ id: 'shared', command: '/bin/new' }])).resolves.toBe(true)
    expect(oldClose).toHaveBeenCalledTimes(1)
    await expect(bridge.tools()).resolves.toEqual([
      expect.objectContaining({ providerId: 'shared', providerToolName: 'new_tool' })
    ])
    await expect(bridge.sync([{ id: 'shared', command: '/bin/new' }])).resolves.toBe(false)
  })

  it('converts MCP error results into failed runtime tool responses', () => {
    expect(runtimeToolResponseFromMcpResult({
      content: [{ type: 'text', text: 'failed upstream' }],
      isError: true
    })).toEqual({
      contentItems: [{ type: 'inputText', text: 'failed upstream' }],
      success: false
    })
  })

  it('forwards standard MCP images as runtime vision inputs', () => {
    expect(runtimeToolResponseFromMcpResult({
      content: [
        { type: 'text', text: 'Inspect the persisted render.' },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }
      ],
      structuredContent: {
        image: { relativePath: 'assets/paper-page.png' },
        markdownReference: '![Method](assets/paper-page.png)'
      }
    })).toMatchObject({
      contentItems: [
        { type: 'inputText', text: 'Inspect the persisted render.' },
        { type: 'inputImage', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' },
        { type: 'inputText', text: expect.stringContaining('assets/paper-page.png') }
      ],
      success: true
    })
  })

  it('preserves structured MCP failure receipts for execution governance', () => {
    expect(runtimeToolResponseFromMcpResult({
      structuredContent: {
        error: {
          code: 'unknown_resource_ref',
          failureClass: 'stale_resource',
          retryable: true,
          recoveryGuidance: 'Observe the resource again.',
          providerStage: 'evidence_validation'
        },
        resourceRef: 'res_surface_12345678901234567890'
      }
    })).toMatchObject({
      success: false,
      errorCode: 'unknown_resource_ref',
      failureClass: 'stale_resource',
      retryable: true,
      recoveryGuidance: 'Observe the resource again.',
      providerStage: 'evidence_validation',
      resourceIdentity: 'res_surface_12345678901234567890'
    })
  })
})

function deepSchema(depth: number): Record<string, unknown> {
  let schema: Record<string, unknown> = { type: 'string' }
  for (let index = 0; index < depth; index += 1) {
    schema = { type: 'object', properties: { child: schema } }
  }
  return schema
}

function fakeMcpClient(options: {
  tools?: McpToolDescriptor[]
  listTools?: RuntimeMcpClient['listTools']
  callTool?: RuntimeMcpClient['callTool']
  close?: RuntimeMcpClient['close']
}): RuntimeMcpClient {
  return {
    listTools: options.listTools ?? vi.fn(async () => ({ tools: options.tools ?? [] })),
    callTool: options.callTool ?? vi.fn(async () => ({ content: [] })),
    close: options.close ?? vi.fn(async () => undefined)
  }
}
