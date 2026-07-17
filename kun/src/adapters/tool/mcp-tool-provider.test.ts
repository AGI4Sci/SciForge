import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpCapabilityConfig } from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import {
  buildMcpToolProviders,
  mcpStdioChildEnv,
  normalizeMcpToolName,
  type McpClientLike
} from './mcp-tool-provider.js'
import {
  CAPABILITY_RUNTIME_BRIDGE_SERVER_ID,
  CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES,
  CAPABILITY_RUNTIME_BRIDGE_VERSION,
  atomicWriteCapabilityRuntimeBridgeJson,
  capabilityRuntimeBridgePaths,
  capabilityRuntimeBridgeResponsePath,
  parseCapabilityRuntimeBridgeRequest,
  signCapabilityRuntimeBridgeCatalog,
  signCapabilityRuntimeBridgeResponse
} from '../../contracts/capability-runtime-bridge.js'

function fakeContext(): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspace: '/tmp/research-workspace',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function config() {
  return McpCapabilityConfig.parse({
    enabled: true,
    servers: {
      gui_workspace_intel: {
        enabled: true,
        transport: 'stdio',
        command: 'mock-workspace-intel',
        trustScope: 'user',
        timeoutMs: 1000
      }
    }
  })
}

describe('buildMcpToolProviders workspace-intel arguments', () => {
  it('builds a safe stdio child env with executable PATH support', () => {
    const env = mcpStdioChildEnv(
      {
        GITHUB_PERSONAL_ACCESS_TOKEN: 'github-token',
        OPENAI_API_KEY: 'server-openai-key',
        DEEPSEEK_BASE_URL: 'https://direct-provider.example/v1',
        SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'router-key',
        SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:3892/v1'
      },
      {
        PATH: '/usr/bin:/bin',
        HOME: '/Users/example',
        OPENAI_API_KEY: 'parent-openai-key',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'direct-sonnet',
        EDAG_LLM_API_KEY: 'parent-edag-key',
        SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'parent-router-key'
      }
    )

    expect(env.PATH?.split(':')).toEqual(expect.arrayContaining(['/usr/bin', '/bin']))
    if (process.platform !== 'win32') {
      expect(env.PATH?.split(':')).toEqual(expect.arrayContaining(['/opt/homebrew/bin', '/usr/local/bin']))
    }
    expect(env.HOME).toBe('/Users/example')
    expect(env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('github-token')
    expect(env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY).toBe('router-key')
    expect(env.SCIFORGE_MODEL_ROUTER_BASE_URL).toBe('http://127.0.0.1:3892/v1')
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.DEEPSEEK_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(env.EDAG_LLM_API_KEY).toBeUndefined()
  })

  it('injects the thread workspaceRoot for gui_workspace tools when the model omits it', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    const client: McpClientLike = {
      listTools: async () => ({
        tools: [{
          name: 'gui_workspace_tree',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              workspaceRoot: { type: 'string' }
            }
          }
        }]
      }),
      callTool,
      close: async () => undefined
    }
    const built = await buildMcpToolProviders(config(), {
      clientFactory: async () => client
    })
    const tool = built.providers[0]?.tools.find((candidate) =>
      candidate.name === normalizeMcpToolName('gui_workspace_intel', 'gui_workspace_tree')
    )

    await tool?.execute({ path: 'docs/research' }, fakeContext())

    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'gui_workspace_tree',
        arguments: {
          path: 'docs/research',
          workspaceRoot: '/tmp/research-workspace'
        }
      },
      expect.objectContaining({ timeout: 1000 })
    )
  })

  it('preserves an explicit workspaceRoot for gui_workspace tools', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    const client: McpClientLike = {
      listTools: async () => ({
        tools: [{
          name: 'gui_workspace_read',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              workspaceRoot: { type: 'string' }
            }
          }
        }]
      }),
      callTool,
      close: async () => undefined
    }
    const built = await buildMcpToolProviders(config(), {
      clientFactory: async () => client
    })
    const tool = built.providers[0]?.tools.find((candidate) =>
      candidate.name === normalizeMcpToolName('gui_workspace_intel', 'gui_workspace_read')
    )

    await tool?.execute({ path: 'PROJECT_research.md', workspaceRoot: '/tmp/explicit' }, fakeContext())

    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'gui_workspace_read',
        arguments: {
          path: 'PROJECT_research.md',
          workspaceRoot: '/tmp/explicit'
        }
      },
      expect.objectContaining({ timeout: 1000 })
    )
  })

  it('reconnects MCP clients that report Not connected', async () => {
    const firstClose = vi.fn(async () => undefined)
    const firstClient: McpClientLike = {
      listTools: async () => ({
        tools: [{ name: 'gui_workspace_read', inputSchema: { type: 'object' } }]
      }),
      callTool: vi.fn(async () => {
        throw new Error('Not connected')
      }),
      close: firstClose
    }
    const secondCallTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'reconnected' }] }))
    const secondClient: McpClientLike = {
      listTools: async () => ({ tools: [] }),
      callTool: secondCallTool,
      close: async () => undefined
    }
    let factoryCalls = 0
    const clientFactory = vi.fn(async () => factoryCalls++ === 0 ? firstClient : secondClient)
    const built = await buildMcpToolProviders(config(), { clientFactory })
    const tool = built.providers[0]?.tools.find((candidate) =>
      candidate.name === normalizeMcpToolName('gui_workspace_intel', 'gui_workspace_read')
    )

    const result = await tool?.execute({}, fakeContext())

    expect(result?.output).toEqual({
      serverId: 'gui_workspace_intel',
      toolName: 'gui_workspace_read',
      result: { content: [{ type: 'text', text: 'reconnected' }] }
    })
    expect(firstClose).toHaveBeenCalled()
    expect(secondCallTool).toHaveBeenCalled()
  })
})

describe('buildMcpToolProviders capability runtime bridge', () => {
  it('exposes only the four flat tools and injects ToolHostContext outside their schemas', async () => {
    const callToolWithContext = vi.fn(async () => ({ structuredContent: { ok: true } }))
    const client: McpClientLike = {
      listTools: async () => ({
        tools: CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES.map((name) => ({
          name,
          description: name,
          inputSchema: {
            type: 'object',
            properties: name === 'sciforge_discover' ? { text: { type: 'string' } } : {}
          },
          _meta: { capabilityIds: ['surface.inspect'] }
        }))
      }),
      callTool: async () => ({ isError: true }),
      callToolWithContext,
      close: async () => undefined
    }
    const built = await buildMcpToolProviders(McpCapabilityConfig.parse({
      enabled: true,
      servers: {
        [CAPABILITY_RUNTIME_BRIDGE_SERVER_ID]: {
          enabled: true,
          transport: 'file-bridge',
          rootDir: '/tmp/sciforge-capability-bridge',
          authSecret: 'runtime-bridge-test-secret-that-is-long-enough',
          trustScope: 'user',
          timeoutMs: 1000
        }
      },
      search: { enabled: true, mode: 'search' }
    }), { clientFactory: async () => client })
    const bridgeProvider = built.providers.find((provider) =>
      provider.id === `mcp:${CAPABILITY_RUNTIME_BRIDGE_SERVER_ID}:always`
    )
    const names = bridgeProvider?.tools.map((tool) => tool.name)

    expect(names).toEqual(CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES)
    expect(names).not.toContain('mcp_sciforge_capabilities_sciforge_discover')
    for (const tool of bridgeProvider?.tools ?? []) {
      expect(tool.inputSchema).not.toHaveProperty('properties.threadId')
      expect(tool.inputSchema).not.toHaveProperty('properties.turnId')
      expect(tool.inputSchema).not.toHaveProperty('properties.workspaceId')
      expect(tool.metadata).toMatchObject({ capabilityIds: ['surface.inspect'] })
    }

    const context = fakeContext()
    await bridgeProvider?.tools.find((tool) => tool.name === 'sciforge_discover')
      ?.execute({ text: 'surface' }, context)
    expect(callToolWithContext).toHaveBeenCalledWith(
      { name: 'sciforge_discover', arguments: { text: 'surface' } },
      context,
      expect.objectContaining({ timeout: 1000 })
    )
  })

  it('round-trips through the authenticated file client with bounded private context', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'kun-capability-bridge-'))
    const authSecret = 'runtime-bridge-test-secret-that-is-long-enough'
    try {
      const paths = capabilityRuntimeBridgePaths(rootDir)
      await atomicWriteCapabilityRuntimeBridgeJson(paths.catalog, signCapabilityRuntimeBridgeCatalog(authSecret, {
        version: CAPABILITY_RUNTIME_BRIDGE_VERSION,
        generatedAt: new Date().toISOString(),
        capabilityIds: ['surface.inspect'],
        tools: CAPABILITY_RUNTIME_BRIDGE_TOOL_NAMES.map((name) => ({
          type: 'function' as const,
          name,
          description: name,
          inputSchema: { type: 'object', properties: {} }
        }))
      }))
      const built = await buildMcpToolProviders(McpCapabilityConfig.parse({
        enabled: true,
        servers: {
          [CAPABILITY_RUNTIME_BRIDGE_SERVER_ID]: {
            transport: 'file-bridge',
            rootDir,
            authSecret,
            trustScope: 'user',
            timeoutMs: 1000
          }
        }
      }))
      const tool = built.providers[0]?.tools.find((candidate) => candidate.name === 'sciforge_discover')
      const execution = tool?.execute({}, fakeContext())
      const requestFile = await waitForRequestFile(paths.requests)
      const request = parseCapabilityRuntimeBridgeRequest(
        JSON.parse(await readFile(join(paths.requests, requestFile), 'utf8')),
        authSecret
      )
      await atomicWriteCapabilityRuntimeBridgeJson(
        capabilityRuntimeBridgeResponsePath(rootDir, request.requestId),
        signCapabilityRuntimeBridgeResponse(authSecret, {
          version: CAPABILITY_RUNTIME_BRIDGE_VERSION,
          requestId: request.requestId,
          completedAt: new Date().toISOString(),
          result: { ok: true, value: [{ operationRef: 'op_test' }] }
        })
      )

      expect(request.context).toMatchObject({
        threadId: 'thread-1',
        turnId: 'turn-1',
        workspaceId: '/tmp/research-workspace'
      })
      expect(await execution).toMatchObject({ isError: false })
      await built.close()
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})

async function waitForRequestFile(directory: string): Promise<string> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    const file = (await readdir(directory).catch(() => [])).find((name) => name.endsWith('.json'))
    if (file) return file
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for a capability bridge request.')
}
