import { describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import {
  buildMcpToolProviders,
  isMcpServerTrusted,
  normalizeMcpToolName,
  type McpClientLike
} from '../src/adapters/tool/mcp-tool-provider.js'
import { REDACTED_SECRET } from '../src/config/secret-redaction.js'
import { LocalRuntimeCapabilitiesConfig, type McpServerConfig } from '../src/contracts/capabilities.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

function buildContext(workspace: string): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace,
    threadMode: 'agent',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function fakeClient(): McpClientLike {
  return {
    async listTools() {
      return {
        tools: [
          {
            name: 'Search Issues',
            description: 'Search issue tracker',
            inputSchema: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query']
            },
            annotations: { readOnlyHint: true }
          }
        ]
      }
    },
    async callTool(input) {
      return {
        content: [{ type: 'text', text: `called ${input.name}` }],
        structuredContent: input.arguments
      }
    },
    async close() {
      // no-op
    }
  }
}

describe('MCP tool provider', () => {
  it('normalizes stable MCP tool names', () => {
    expect(normalizeMcpToolName('GitHub Server', 'Search Issues')).toBe('mcp_github_server_search_issues')
  })

  it('evaluates workspace trust scopes', () => {
    const server = {
      enabled: true,
      transport: 'stdio',
      command: 'node',
      args: [],
      url: undefined,
      headers: {},
      env: {},
      trustScope: 'workspace',
      trustedWorkspaceRoots: ['/tmp/project'],
      timeoutMs: 30_000
    } satisfies McpServerConfig

    expect(isMcpServerTrusted(server, '/tmp/project')).toBe(true)
    expect(isMcpServerTrusted(server, '/tmp/project/sub')).toBe(true)
    expect(isMcpServerTrusted(server, '/tmp/other')).toBe(false)
  })

  it('builds registry providers from connected MCP clients and executes tools', async () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project']
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => fakeClient()
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })

    expect(built.connectedServers).toBe(1)
    expect(built.toolCount).toBe(1)
    expect(built.diagnostics[0]).toMatchObject({ id: 'github', status: 'connected', toolCount: 1 })

    const tools = await host.listTools(buildContext('/tmp/project'))
    expect(tools.map((tool) => tool.name)).toEqual(['mcp_github_search_issues'])
    expect(tools[0]?.providerId).toBe('mcp:github')

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'mcp_github_search_issues',
      arguments: { query: 'bug' }
    }, buildContext('/tmp/project'))
    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        serverId: 'github',
        toolName: 'Search Issues'
      })
    }
  })

  it('adds flat remote_* aliases for first-party remote_executor tools', async () => {
    const callInputs: Array<{ name: string; arguments: Record<string, unknown> }> = []
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          remote_executor: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => ({
        async listTools() {
          return {
            tools: [
              {
                name: 'remote_run',
                description: 'Run a command on a configured remote target.',
                inputSchema: {
                  type: 'object',
                  properties: { command: { type: 'string' } },
                  required: ['command']
                }
              }
            ]
          }
        },
        async callTool(input) {
          callInputs.push(input)
          return { ok: true, called: input.name, arguments: input.arguments }
        },
        async close() {
          // no-op
        }
      })
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    const context = buildContext('/tmp/project')

    expect((await host.listTools(context)).map((tool) => tool.name)).toEqual([
      'mcp_remote_executor_remote_run',
      'remote_run'
    ])
    expect(built.toolCount).toBe(1)
    expect(built.diagnostics[0]).toMatchObject({ id: 'remote_executor', toolCount: 1 })

    await host.execute({
      callId: 'call_remote_run',
      toolName: 'remote_run',
      arguments: { command: 'pwd' }
    }, context)

    expect(callInputs[0]).toEqual({
      name: 'remote_run',
      arguments: { command: 'pwd' }
    })
  })

  it('injects the selected remote target id for remote_executor tools', async () => {
    const callInputs: Array<{ name: string; arguments: Record<string, unknown> }> = []
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          remote_executor: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => ({
        async listTools() {
          return {
            tools: [
              {
                name: 'remote_run',
                description: 'Run a command on a configured remote target.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    target_id: { type: 'string' },
                    command: { type: 'string' }
                  },
                  required: ['target_id', 'command']
                }
              }
            ]
          }
        },
        async callTool(input) {
          callInputs.push(input)
          return { ok: true, called: input.name, arguments: input.arguments }
        },
        async close() {
          // no-op
        }
      })
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    const context = {
      ...buildContext('/tmp/project'),
      remoteTargetId: 'gpu-a'
    }

    await host.execute({
      callId: 'call_remote_default',
      toolName: 'remote_run',
      arguments: { command: 'pwd' }
    }, context)
    await host.execute({
      callId: 'call_remote_explicit',
      toolName: 'remote_run',
      arguments: { target_id: 'cpu-b', command: 'hostname' }
    }, context)

    expect(callInputs).toEqual([
      {
        name: 'remote_run',
        arguments: { target_id: 'gpu-a', command: 'pwd' }
      },
      {
        name: 'remote_run',
        arguments: { target_id: 'cpu-b', command: 'hostname' }
      }
    ])
  })

  it('skips remote_executor flat aliases that would collide with reserved tool names', async () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          remote_executor: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      reservedToolNames: ['remote_run'],
      clientFactory: async () => ({
        async listTools() {
          return {
            tools: [
              {
                name: 'remote_run',
                inputSchema: { type: 'object' }
              }
            ]
          }
        },
        async callTool(input) {
          return { ok: true, called: input.name }
        },
        async close() {
          // no-op
        }
      })
    })

    expect(built.providers[0]?.tools.map((tool) => tool.name)).toEqual([
      'mcp_remote_executor_remote_run'
    ])
  })

  it('repairs direct MCP tool arguments to satisfy numeric schema bounds', async () => {
    const callInputs: Array<{ name: string; arguments: Record<string, unknown> }> = []
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          research: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => ({
        async listTools() {
          return {
            tools: [
              {
                name: 'research_search',
                inputSchema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string' },
                    maxResults: { type: 'integer', minimum: 1, maximum: 100 }
                  }
                },
                annotations: { readOnlyHint: true }
              }
            ]
          }
        },
        async callTool(input) {
          callInputs.push(input)
          return { ok: true, arguments: input.arguments }
        },
        async close() {
          // no-op
        }
      })
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })

    await host.execute({
      callId: 'call_research',
      toolName: 'mcp_research_research_search',
      arguments: { query: 'AI scientist', maxResults: 1000 }
    }, buildContext('/tmp/project'))

    expect(callInputs[0]).toEqual({
      name: 'research_search',
      arguments: { query: 'AI scientist', maxResults: 100 }
    })
  })

  it('exposes gui_owl_computer_use as a flat computer_use MCP tool without context injection', async () => {
    const callInputs: Array<{ name: string; arguments: Record<string, unknown> }> = []
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          gui_owl_computer_use: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => ({
        async listTools() {
          return {
            tools: [
              {
                name: 'computer_use',
                inputSchema: {
                  type: 'object',
                  properties: {
                    instruction: { type: 'string' }
                  }
                }
              }
            ]
          }
        },
        async callTool(input) {
          callInputs.push(input)
          return {
            content: [],
            structuredContent: input.arguments
          }
        },
        async close() {
          // no-op
        }
      })
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    expect(built.providers.flatMap((provider) => provider.tools.map((tool) => tool.name))).toEqual(
      expect.arrayContaining(['mcp_gui_owl_computer_use_computer_use', 'computer_use'])
    )

    await host.execute({
      callId: 'call_computer_use',
      toolName: 'computer_use',
      arguments: { instruction: 'open the settings window' }
    }, buildContext('/tmp/project'))

    expect(callInputs[0]).toEqual({
      name: 'computer_use',
      arguments: {
        instruction: 'open the settings window'
      }
    })
  })

  it('uses BM25 MCP search meta tools when search discovery is enabled', async () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        search: {
          enabled: true,
          mode: 'search',
          topKDefault: 2,
          topKMax: 5
        },
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project']
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => ({
        async listTools() {
          return {
            tools: [
              {
                name: 'search_issues',
                title: 'Search issues',
                description: 'Search GitHub issues and pull requests by query',
                inputSchema: {
                  type: 'object',
                  properties: { query: { type: 'string', description: 'Issue search query' } },
                  required: ['query']
                },
                annotations: { readOnlyHint: true }
              },
              {
                name: 'create_issue',
                description: 'Create a GitHub issue',
                inputSchema: {
                  type: 'object',
                  properties: { title: { type: 'string' }, body: { type: 'string' } },
                  required: ['title']
                }
              }
            ]
          }
        },
        async callTool(input) {
          return { called: input.name, arguments: input.arguments }
        },
        async close() {
          // no-op
        }
      })
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    const context = buildContext('/tmp/project')

    expect(built.toolCount).toBe(2)
    expect(built.search).toMatchObject({
      enabled: true,
      mode: 'search',
      active: true,
      indexedToolCount: 2,
      advertisedToolCount: 4
    })
    expect((await host.listTools(context)).map((tool) => tool.name)).toEqual([
      'mcp_search',
      'mcp_describe',
      'mcp_call',
      'mcp_refresh_catalog'
    ])

    const search = await host.execute({
      callId: 'call_search',
      toolName: 'mcp_search',
      arguments: { query: '查 github issue' }
    }, context)
    expect(search.item.kind).toBe('tool_result')
    if (search.item.kind === 'tool_result') {
      const output = search.item.output as { results: Array<{ toolId: string }> }
      expect(output.results[0]?.toolId).toBe('github/search_issues')
    }

    const describe = await host.execute({
      callId: 'call_describe',
      toolName: 'mcp_describe',
      arguments: { toolId: 'github/search_issues' }
    }, context)
    if (describe.item.kind === 'tool_result') {
      expect(describe.item.output).toMatchObject({
        toolId: 'github/search_issues',
        toolName: 'search_issues'
      })
    }

    const call = await host.execute({
      callId: 'call_tool',
      toolName: 'mcp_call',
      arguments: { toolId: 'github/search_issues', arguments: { query: 'bug' } }
    }, context)
    if (call.item.kind === 'tool_result') {
      expect(call.item.output).toMatchObject({
        serverId: 'github',
        toolName: 'search_issues',
        result: {
          called: 'search_issues',
          arguments: { query: 'bug' }
        }
      })
    }
  })

  it('passes computer-use arguments through MCP search calls without context injection', async () => {
    const callInputs: Array<{ name: string; arguments: Record<string, unknown> }> = []
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        search: {
          enabled: true,
          mode: 'search'
        },
        servers: {
          gui_owl_computer_use: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => ({
        async listTools() {
          return {
            tools: [
              {
                name: 'computer_use',
                description: 'Shared computer use control.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    instruction: { type: 'string' }
                  }
                }
              }
            ]
          }
        },
        async callTool(input) {
          callInputs.push(input)
          return {
            content: [],
            structuredContent: input.arguments
          }
        },
        async close() {
          // no-op
        }
      })
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    expect(built.providers.flatMap((provider) => provider.tools.map((tool) => tool.name))).toEqual(
      expect.arrayContaining(['computer_use', 'mcp_call'])
    )

    await host.execute({
      callId: 'call_computer_use',
      toolName: 'mcp_call',
      arguments: {
        toolId: 'gui_owl_computer_use/computer_use',
        arguments: {
          instruction: 'open the settings window'
        }
      }
    }, buildContext('/tmp/project'))

    expect(callInputs[0]).toEqual({
      name: 'computer_use',
      arguments: {
        instruction: 'open the settings window'
      }
    })
  })

  it('repairs MCP search call arguments using the selected tool schema', async () => {
    const callInputs: Array<{ name: string; arguments: Record<string, unknown> }> = []
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        search: { enabled: true, mode: 'search' },
        servers: {
          research: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => ({
        async listTools() {
          return {
            tools: [
              {
                name: 'research_search',
                description: 'Search papers.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string' },
                    maxResults: { type: 'integer', minimum: 1, maximum: 100 }
                  }
                }
              }
            ]
          }
        },
        async callTool(input) {
          callInputs.push(input)
          return { ok: true }
        },
        async close() {
          // no-op
        }
      })
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })

    await host.execute({
      callId: 'call_research_via_search',
      toolName: 'mcp_call',
      arguments: {
        toolId: 'research/research_search',
        arguments: { query: 'AI scientist', maxResults: 1000 }
      }
    }, buildContext('/tmp/project'))

    expect(callInputs[0]).toEqual({
      name: 'research_search',
      arguments: { query: 'AI scientist', maxResults: 100 }
    })
  })

  it('hides workspace-scoped tools outside trusted roots', async () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project']
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => fakeClient()
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })

    expect(await host.listTools(buildContext('/tmp/other'))).toEqual([])
    await expect(
      host.execute({
        callId: 'call_1',
        toolName: 'mcp_github_search_issues',
        arguments: { query: 'bug' }
      }, buildContext('/tmp/other'))
    ).rejects.toThrow(/not advertised/)
  })

  it('records diagnostics for failed MCP server connections', async () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          broken: {
            transport: 'streamable-http',
            url: 'https://example.invalid/mcp',
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => {
        throw new Error('connect failed')
      }
    })

    expect(built.providers).toEqual([])
    expect(built.connectedServers).toBe(0)
    expect(built.diagnostics[0]).toMatchObject({
      id: 'broken',
      status: 'error',
      lastError: 'connect failed'
    })
  })

  it('passes MCP timeouts and abort signals to discovery and execution', async () => {
    const listOptions: Array<{ signal?: AbortSignal; timeout?: number } | undefined> = []
    const callOptions: Array<{ signal?: AbortSignal; timeout?: number } | undefined> = []
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project'],
            timeoutMs: 1234
          }
        }
      }
    })
    const client: McpClientLike = {
      async listTools(options) {
        listOptions.push(options)
        return {
          tools: [
            {
              name: 'read',
              inputSchema: { type: 'object' },
              annotations: { readOnlyHint: true }
            }
          ]
        }
      },
      async callTool(_input, options) {
        callOptions.push(options)
        return { ok: true }
      },
      async close() {
        // no-op
      }
    }
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => client
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    const controller = new AbortController()
    const context = { ...buildContext('/tmp/project'), abortSignal: controller.signal }

    await host.execute({
      callId: 'call_1',
      toolName: 'mcp_github_read',
      arguments: {}
    }, context)

    expect(listOptions[0]?.timeout).toBe(1234)
    expect(callOptions[0]?.timeout).toBe(1234)
    expect(callOptions[0]?.signal).toBe(controller.signal)
  })

  it('reconnects and retries once when an MCP tool call fails from a transient connection error', async () => {
    let factories = 0
    let closes = 0
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project']
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => {
        factories += 1
        const instance = factories
        return {
          async listTools() {
            return {
              tools: [
                {
                  name: 'read',
                  inputSchema: { type: 'object' },
                  annotations: { readOnlyHint: true }
                }
              ]
            }
          },
          async callTool() {
            if (instance === 1) throw new Error('stale connection closed')
            return { ok: true, instance }
          },
          async close() {
            closes += 1
          }
        }
      }
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    const result = await host.execute({
      callId: 'call_1',
      toolName: 'mcp_github_read',
      arguments: {}
    }, buildContext('/tmp/project'))

    expect(factories).toBe(2)
    expect(closes).toBe(1)
    expect(result.item.kind === 'tool_result' ? result.item.output : {}).toMatchObject({
      result: { ok: true, instance: 2 }
    })
  })

  it('does not reconnect for deterministic MCP input validation failures', async () => {
    let factories = 0
    let closes = 0
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          research: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => {
        factories += 1
        return {
          async listTools() {
            return {
              tools: [
                {
                  name: 'research_search',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      query: { type: 'string' },
                      maxResults: { type: 'integer', minimum: 1, maximum: 100 }
                    }
                  },
                  annotations: { readOnlyHint: true }
                }
              ]
            }
          },
          async callTool() {
            throw new Error('MCP input validation failed: maxResults must be <= 100')
          },
          async close() {
            closes += 1
          }
        }
      }
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    const result = await host.execute({
      callId: 'call_invalid',
      toolName: 'mcp_research_research_search',
      arguments: { query: 'AI scientist', maxResults: 1000 }
    }, buildContext('/tmp/project'))

    expect(factories).toBe(1)
    expect(closes).toBe(0)
    expect(result.item.kind === 'tool_result' ? result.item.output : {}).toMatchObject({
      code: 'tool_input_validation_failed',
      error: expect.stringContaining('MCP input validation failed')
    })
  })

  it('reports catalog drift after refreshing MCP search records', async () => {
    let expanded = false
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        search: { enabled: true, mode: 'search' },
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project']
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => ({
        async listTools() {
          return {
            tools: [
              { name: 'search_issues', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
              ...(expanded ? [{ name: 'create_issue', inputSchema: { type: 'object' } }] : [])
            ]
          }
        },
        async callTool() {
          return { ok: true }
        },
        async close() {
          // no-op
        }
      })
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    expanded = true
    const refresh = await host.execute({
      callId: 'call_refresh',
      toolName: 'mcp_refresh_catalog',
      arguments: {}
    }, buildContext('/tmp/project'))

    expect(refresh.item.kind === 'tool_result' ? refresh.item.output : {}).toMatchObject({
      totalIndexed: 2,
      catalogDrift: true
    })
  })

  it('redacts secrets from MCP diagnostics', async () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          broken: {
            transport: 'streamable-http',
            url: 'https://mcp.example.test/mcp',
            headers: { Authorization: 'Bearer config-secret' },
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => {
        throw new Error('connect failed: authorization: Bearer runtime-secret token=other-secret')
      }
    })

    const encoded = JSON.stringify(built.diagnostics)
    expect(encoded).toContain(REDACTED_SECRET)
    expect(encoded).not.toContain('runtime-secret')
    expect(encoded).not.toContain('other-secret')
    expect(encoded).not.toContain('config-secret')
  })

  it('closes connected MCP clients during shutdown', async () => {
    let closed = 0
    const config = LocalRuntimeCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project']
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => ({
        async listTools() {
          return { tools: [] }
        },
        async callTool() {
          return { ok: true }
        },
        async close() {
          closed += 1
        }
      })
    })

    await built.close()

    expect(closed).toBe(1)
  })
})
