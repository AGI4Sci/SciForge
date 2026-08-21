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
  it('passes local resource-handle descriptions through to the Host Broker', () => {
    const caller = {
      audience: 'agent' as const,
      callerId: 'runtime-resource-projection',
      workspaceId: '/tmp/workspace',
      approvals: []
    }
    const resource = {
      token: `cap_${'r'.repeat(32)}`,
      semanticRevision: '1',
      expiresAt: '2026-07-16T12:00:00.000Z'
    }
    const description = {
      resourceRef: `res_${'r'.repeat(32)}`,
      resourceKind: 'document',
      semanticRevision: '1'
    }
    const describeResourceHandle = vi.fn(() => description)
    const runtime = createRuntimeCapabilityBroker({
      broker: { ...emptyBroker(), describeResourceHandle },
      managedTools: createRuntimeMcpToolGateway({
        servers: [],
        clientFactory: async () => { throw new Error('unused') }
      })
    })

    expect(runtime.describeResourceHandle(caller, resource)).toEqual(description)
    expect(describeResourceHandle).toHaveBeenCalledWith(caller, resource)
  })

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
      trustedInvocationMetadata: [{
        serverId: 'image-generation', tools: ['visual.render'],
        metadataKey: 'fixture/trusted-invocation', source: 'trusted-invocation'
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
      turnId: 'turn-1',
      callId: 'call-1',
      workspaceId: '/tmp/workspace'
    }

    expect(surface.tools().map((tool) => tool.name)).toEqual(Object.values(CAPABILITY_AGENT_TOOL_NAMES))
    expect(JSON.stringify(surface.tools())).not.toContain('visual.render')
    expect(JSON.stringify(surface.tools())).not.toContain('recipe')

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })).rejects.toMatchObject({
      code: 'capability_discovery_empty',
      details: {
        registryReadiness: { status: 'ready' },
        suggestedQueries: expect.any(Array)
      }
    })
    expect(client.listTools).not.toHaveBeenCalled()

    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'visual', providerFamily: 'managed-mcp' },
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
      },
      _meta: {
        'fixture/trusted-invocation': expect.objectContaining({
          requestId: 'request-1', runtimeId: 'future-runtime',
          threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1',
          actionId: expect.any(String)
        })
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
      turnId: 'turn-1',
      callId: 'call-1',
      workspaceId: '/tmp/workspace'
    }
    const alpha = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'alpha-server', providerFamily: 'managed-mcp' },
      context
    })
    const beta = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'beta-server', providerFamily: 'managed-mcp' },
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

  it('filters managed discovery by generic package scope', async () => {
    const gateway = createRuntimeMcpToolGateway({
      servers: [
        { id: 'computer-server', packageName: '@sciforge/domain-computer-use', command: '/bin/computer' },
        { id: 'other-server', packageName: '@sciforge/domain-other', command: '/bin/other' }
      ],
      clientFactory: async (server) => ({
        listTools: vi.fn(async () => ({ tools: [{
          name: 'operate',
          description: `${server.packageName} operation`,
          annotations: { readOnlyHint: true }
        }] })),
        callTool: vi.fn(async () => ({ content: [] })),
        close: vi.fn(async () => undefined)
      })
    })
    const surface = createCapabilityAgentToolSurface({
      broker: createRuntimeCapabilityBroker({ broker: emptyBroker(), managedTools: gateway }),
      resolveCaller: (context) => ({
        audience: 'agent', callerId: `${context.runtimeId}:${context.threadId}`,
        workspaceId: context.workspaceId
      })
    })
    const result = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { providerFamily: 'managed-mcp' },
      context: {
        requestId: 'scoped', runtimeId: 'codex', threadId: 'child',
        workspaceId: '/tmp/workspace',
        brokerScope: { providerFamily: 'managed-mcp', packageName: '@sciforge/domain-computer-use' }
      }
    })
    expect(result.value).toEqual([expect.objectContaining({
      description: '@sciforge/domain-computer-use operation',
      tags: expect.arrayContaining(['package-sciforge-domain-computer-use'])
    })])
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
      arguments: { text: 'restricted', providerFamily: 'managed-mcp' },
      context: deniedContext
    })).rejects.toMatchObject({ code: 'capability_discovery_empty' })

    const allowedContext = { ...deniedContext, requestId: 'allowed', runtimeId: 'allowed-runtime' }
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'restricted', providerFamily: 'managed-mcp' },
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

  it('joins a pending managed write and fails admission instead of evicting it', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const callTool = vi.fn(async () => {
      await gate
      return { content: [{ type: 'text' as const, text: 'completed' }] }
    })
    const gateway = createRuntimeMcpToolGateway({
      servers: [{ id: 'pending-writes', command: '/bin/pending-writes' }],
      clientFactory: async () => ({
        listTools: vi.fn(async () => ({ tools: [{
          name: 'publish',
          description: 'Publish one external mutation.',
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true
          }
        }] })),
        callTool,
        close: vi.fn(async () => undefined)
      })
    })
    const surface = createCapabilityAgentToolSurface({
      broker: createRuntimeCapabilityBroker({
        broker: emptyBroker(),
        managedTools: gateway,
        maxManagedInvocations: 1
      }),
      resolveCaller: (request) => ({
        audience: 'agent',
        callerId: `${request.runtimeId}:${request.threadId}`,
        workspaceId: request.workspaceId
      }),
      requestApproval: async () => 'allowed' as const
    })
    const baseContext = {
      requestId: 'pending-write',
      runtimeId: 'future-runtime',
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspaceId: '/tmp/workspace'
    }
    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'publish', providerFamily: 'managed-mcp' },
      context: baseContext
    })
    const operationRef = (discovered.value as Array<{ operationRef: string }>)[0]!.operationRef
    const invoke = (callId: string) => surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef, input: {} },
      context: { ...baseContext, callId }
    })

    const first = invoke('call-1')
    await vi.waitFor(() => expect(callTool).toHaveBeenCalledOnce())
    const joined = invoke('call-1')
    await expect(invoke('call-2')).rejects.toMatchObject({
      code: 'idempotency_capacity_exceeded'
    })
    expect(callTool).toHaveBeenCalledOnce()
    release?.()
    await expect(Promise.all([first, joined])).resolves.toHaveLength(2)
    expect(callTool).toHaveBeenCalledOnce()
  })

  it('retains rejected managed invocations so terminal failures cannot execute again', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'action outcome is unknown' }],
      isError: true,
      structuredContent: {
        error: {
          code: 'ACTION_OUTCOME_UNKNOWN',
          failureClass: 'unknown_outcome',
          retryable: false
        }
      }
    }))
    const gateway = createRuntimeMcpToolGateway({
      servers: [{ id: 'computer-use', command: '/bin/computer-use' }],
      clientFactory: async () => ({
        listTools: vi.fn(async () => ({ tools: [{
          name: 'computer_use',
          description: 'Mutate one bound CDP target.',
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false
          }
        }] })),
        callTool,
        close: vi.fn(async () => undefined)
      })
    })
    const broker = createRuntimeCapabilityBroker({ broker: emptyBroker(), managedTools: gateway })
    const caller = {
      audience: 'agent' as const,
      callerId: 'codex:thread-1',
      workspaceId: '/tmp/workspace',
      approvals: []
    }
    const context = {
      requestId: 'transport-1',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-1',
      workspaceId: '/tmp/workspace'
    }
    const [operation] = await broker.discover(
      caller, { providerFamily: 'managed-mcp' }, { context }
    )
    expect(operation).toBeDefined()
    const request = {
      actionId: operation!.id,
      invocationId: 'invocation-1',
      input: { sessionId: 'session-1' }
    }

    await expect(broker.invoke(caller, request, { context })).rejects.toMatchObject({
      code: 'ACTION_OUTCOME_UNKNOWN',
      retryable: false
    })
    await expect(broker.invoke(caller, request, {
      context: { ...context, requestId: 'transport-2' }
    })).rejects.toMatchObject({
      code: 'ACTION_OUTCOME_UNKNOWN',
      retryable: false
    })
    await expect(broker.invoke(caller, {
      ...request,
      input: { sessionId: 'different-session' }
    }, { context })).rejects.toMatchObject({ code: 'idempotency_conflict' })
    expect(callTool).toHaveBeenCalledTimes(1)
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
    describeResourceHandle: async () => { throw new Error('unused') },
    bindResourceRef: async () => { throw new Error('unused') },
    invoke: async () => { throw new Error('unused') },
    listEvents: async () => []
  }
}
