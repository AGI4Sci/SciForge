import { describe, expect, it, vi } from 'vitest'
import {
  CAPABILITY_AGENT_TOOL_NAMES,
  createCapabilityAgentToolSurface,
  type CapabilityAgentBroker
} from '../../capabilities/agent-tools'
import { createRuntimeCapabilityBroker } from './runtime-capability-broker'
import {
  createRuntimeMcpToolGateway,
  type RuntimeMcpClient
} from './runtime-mcp-tool-gateway'

describe('RuntimeCapabilityBroker', () => {
  it('keeps managed MCP schemas behind the four runtime-neutral tools', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'rendered' }],
      structuredContent: { artifactRef: 'artifact_123' }
    }))
    const client: RuntimeMcpClient = {
      listTools: vi.fn(async () => ({
        tools: [{
          name: 'visual.render',
          description: 'Render a scientific visual plan.',
          inputSchema: {
            type: 'object',
            properties: {
              workspaceRoot: { type: 'string' },
              recipe: deepObjectSchema(40)
            },
            required: ['recipe']
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false
          }
        }]
      })),
      callTool,
      close: vi.fn(async () => undefined)
    }
    const managedTools = createRuntimeMcpToolGateway({
      servers: [{
        id: 'image-generation',
        command: '/bin/image-generation',
        enabledTools: ['visual.render']
      }],
      clientFactory: async () => client
    })
    const broker = createRuntimeCapabilityBroker({
      broker: emptyBroker(),
      managedTools
    })
    const surface = createCapabilityAgentToolSurface({
      broker,
      resolveCaller: (context) => ({
        audience: 'agent',
        callerId: `${context.runtimeId}:${context.threadId}`,
        workspaceId: context.workspaceId
      })
    })
    const context = {
      requestId: 'request-1',
      runtimeId: 'future-runtime',
      threadId: 'thread-1',
      workspaceId: '/tmp/workspace'
    }

    expect(surface.tools().map((tool) => tool.name)).toEqual(Object.values(CAPABILITY_AGENT_TOOL_NAMES))
    expect(JSON.stringify(surface.tools())).not.toContain('visual.render')
    expect(JSON.stringify(surface.tools())).not.toContain('recipe')

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })).resolves.toMatchObject({ value: [] })
    expect(client.listTools).not.toHaveBeenCalled()

    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'visual' },
      context
    })
    expect(discovered.value).toEqual([expect.objectContaining({
      operationRef: expect.stringMatching(/^op_/),
      title: 'visual_render'
    })])
    const operationRef = (discovered.value as Array<{ operationRef: string }>)[0]!.operationRef

    const expanded = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { operationRef, includeSchema: true },
      context
    })
    expect(expanded.value).toEqual([expect.objectContaining({
      inputShape: {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', required: false },
          recipe: { type: 'object', required: true }
        }
      }
    })])

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef, input: { recipe: { scene: 'cells' } } },
      context
    })).resolves.toMatchObject({
      value: {
        output: { artifactRef: 'artifact_123' },
        changed: false
      }
    })
    expect(callTool).toHaveBeenCalledWith({
      name: 'visual.render',
      arguments: {
        workspaceRoot: '/tmp/workspace',
        recipe: { scene: 'cells' }
      }
    }, expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 }))
  })

  it('keeps duplicate provider tool identities stable across discoveries', async () => {
    const alphaCall = vi.fn(async () => ({ content: [{ type: 'text', text: 'alpha' }] }))
    const betaCall = vi.fn(async () => ({ content: [{ type: 'text', text: 'beta' }] }))
    const gateway = createRuntimeMcpToolGateway({
      servers: [
        { id: 'alpha-server', command: '/bin/alpha' },
        { id: 'beta-server', command: '/bin/beta' }
      ],
      clientFactory: async (server) => ({
        listTools: vi.fn(async () => ({ tools: [{
          name: 'lookup',
          description: `${server.id} lookup`,
          annotations: { readOnlyHint: true }
        }] })),
        callTool: server.id === 'alpha-server' ? alphaCall : betaCall,
        close: vi.fn(async () => undefined)
      })
    })
    const surface = createCapabilityAgentToolSurface({
      broker: createRuntimeCapabilityBroker({ broker: emptyBroker(), managedTools: gateway }),
      resolveCaller: (context) => ({
        audience: 'agent',
        callerId: `${context.runtimeId}:${context.threadId}`,
        workspaceId: context.workspaceId
      })
    })
    const context = {
      requestId: 'stable-id',
      runtimeId: 'future-runtime',
      threadId: 'thread-1',
      workspaceId: '/tmp/workspace'
    }
    const alpha = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'alpha-server' },
      context
    })
    const beta = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'beta-server' },
      context
    })
    const alphaRef = (alpha.value as Array<{ operationRef: string }>)[0]!.operationRef
    expect(alphaRef).not.toBe((beta.value as Array<{ operationRef: string }>)[0]!.operationRef)

    await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: alphaRef, input: {} },
      context
    })
    expect(alphaCall).toHaveBeenCalledTimes(1)
    expect(betaCall).not.toHaveBeenCalled()
  })

  it('enforces runtime availability and preserves structured failures', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'stale resource' }],
      structuredContent: {
        error: { code: 'stale_resource', failureClass: 'stale_resource', retryable: true },
        resourceRef: 'res_test_12345678901234567890'
      }
    }))
    const gateway = createRuntimeMcpToolGateway({
      servers: [{ id: 'restricted', command: '/bin/restricted' }],
      clientFactory: async () => ({
        listTools: vi.fn(async () => ({ tools: [{
          name: 'lookup',
          description: 'restricted lookup',
          annotations: { readOnlyHint: true }
        }] })),
        callTool,
        close: vi.fn(async () => undefined)
      })
    })
    const surface = createCapabilityAgentToolSurface({
      broker: createRuntimeCapabilityBroker({
        broker: emptyBroker(),
        managedTools: gateway,
        isToolAvailable: (context) => context.runtimeId === 'allowed-runtime'
      }),
      resolveCaller: (context) => ({
        audience: 'agent',
        callerId: `${context.runtimeId}:${context.threadId}`,
        workspaceId: context.workspaceId
      })
    })
    const deniedContext = {
      requestId: 'denied',
      runtimeId: 'denied-runtime',
      threadId: 'thread-1',
      workspaceId: '/tmp/workspace'
    }
    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'restricted' },
      context: deniedContext
    })).resolves.toMatchObject({ value: [] })

    const allowedContext = { ...deniedContext, requestId: 'allowed', runtimeId: 'allowed-runtime' }
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'restricted' },
      context: allowedContext
    })
    const operationRef = (discovered.value as Array<{ operationRef: string }>)[0]!.operationRef
    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef, input: {} },
      context: allowedContext
    })).rejects.toMatchObject({
      code: 'stale_resource',
      failureClass: 'stale_resource',
      retryable: true,
      resourceIdentity: 'res_test_12345678901234567890'
    })
  })
})

function deepObjectSchema(depth: number): Record<string, unknown> {
  let current: Record<string, unknown> = { type: 'string' }
  for (let index = 0; index < depth; index += 1) {
    current = { type: 'object', properties: { child: current } }
  }
  return current
}

function emptyBroker(): CapabilityAgentBroker {
  return {
    discover: async () => [],
    observe: async () => { throw new Error('unused') },
    bindResourceRef: async () => { throw new Error('unused') },
    invoke: async () => { throw new Error('unused') },
    listEvents: async () => []
  }
}
