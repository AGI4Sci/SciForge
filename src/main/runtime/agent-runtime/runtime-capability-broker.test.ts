import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CapabilityBroker } from '../../capabilities/broker'
import { CapabilityRegistry, defineCapability } from '../../capabilities/registry'
import {
  CAPABILITY_AGENT_TOOL_NAMES,
  createCapabilityAgentToolSurface,
  type CapabilityAgentBroker
} from '../../capabilities/agent-tools'
import { createRuntimeCapabilityBroker, type RuntimeCapabilityBroker } from './runtime-capability-broker'
import {
  createRuntimeMcpToolGateway,
  type RuntimeMcpClient
} from './runtime-mcp-tool-gateway'

describe('RuntimeCapabilityBroker', () => {
  it.each(nonLosslessSnapshotCases())(
    'rejects non-lossless Session %s via %s: %s before authorization or dispatch',
    async (field, route, _name, createValue) => {
      const authorize = vi.fn()
      const dispatch = vi.fn<RuntimeCapabilityBroker['invokeOrdinarySession']>(
        async (_caller, request) => ({
          actionId: request.actionId, output: null, changed: false,
          replayed: false, completedAt: '2026-08-28T00:00:00.000Z'
        })
      )
      const runtime = createRuntimeCapabilityBroker({
        broker: { ...emptyBroker(), invokeOrdinarySession: dispatch },
        managedTools: createRuntimeMcpToolGateway({
          servers: [], clientFactory: async () => { throw new Error('unused') }
        }),
        assertOrdinarySessionAccess: authorize
      })
      const caller = { audience: 'agent' as const, callerId: 'principal-a', approvals: [] }
      const request = { actionId: 'fixture.native-read', input: {} }
      const session = { runtimeId: 'runtime-a', threadId: 'thread-a' }
      const context = { requestId: 'request-a', ...session }
      const value = createValue()
      if (field === 'input') request.input = value as never
      else Object.assign({ caller, request, session, context }[field], {
        metadata: { deep: [{ value }] }
      })
      const pending = route === 'direct'
        ? runtime.invokeOrdinarySession(caller, request, session, { context })
        : runtime.invoke(caller, request, { context })
      await expect(pending).rejects.toMatchObject({
        code: 'invalid_invocation_snapshot', failureClass: 'invalid_arguments', retryable: false
      })
      expect(authorize).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalled()
    }
  )

  it('preserves deeply nested plain JSON and live cancellation in one authorized snapshot', async () => {
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const shared = { text: '原文', number: 3.5, bool: false, nil: null, empty: ['', [], {}] }
    const nullPrototype = Object.assign(Object.create(null), { value: 'plain' })
    let deep: unknown = { shared, alias: shared, nullPrototype,
      special: JSON.parse('{"__proto__":{"value":"own-key"}}') }
    for (let index = 0; index < 64; index += 1) deep = { child: [deep] }
    const caller = {
      audience: 'agent' as const, callerId: 'principal-a', approvals: [], metadata: deep
    }
    const session = { runtimeId: 'runtime-a', threadId: 'thread-a', metadata: deep }
    const context = { requestId: 'request-a', ...session }
    const request = { actionId: 'fixture.native-read', input: deep as never }
    const expected = structuredClone({ caller, session, context, request })
    const controller = new AbortController()
    const authorize = vi.fn(async (
      admittedCaller: Parameters<RuntimeCapabilityBroker['invokeOrdinarySession']>[0],
      admittedSession: Parameters<RuntimeCapabilityBroker['invokeOrdinarySession']>[2],
      admittedContext?: NonNullable<Parameters<RuntimeCapabilityBroker['invokeOrdinarySession']>[3]>['context']
    ) => {
      expect(admittedCaller).toStrictEqual(expected.caller)
      expect(admittedSession).toStrictEqual(expected.session)
      expect(admittedContext).toStrictEqual(expected.context)
      expect(Reflect.set(admittedCaller, 'callerId', 'forged')).toBe(false)
      await barrier
    })
    const dispatch = vi.fn<RuntimeCapabilityBroker['invokeOrdinarySession']>(
      async (_caller, admittedRequest) => ({
        actionId: admittedRequest.actionId, output: null, changed: false,
        replayed: false, completedAt: '2026-08-28T00:00:00.000Z'
      })
    )
    const runtime = createRuntimeCapabilityBroker({
      broker: { ...emptyBroker(), invokeOrdinarySession: dispatch },
      managedTools: createRuntimeMcpToolGateway({
        servers: [], clientFactory: async () => { throw new Error('unused') }
      }),
      assertOrdinarySessionAccess: authorize
    })
    const pending = runtime.invokeOrdinarySession(caller, request, session, {
      context, signal: controller.signal
    })
    expect(authorize).toHaveBeenCalledOnce()
    shared.text = 'changed'
    controller.abort('user_stop')
    release()
    await pending
    const admitted = authorize.mock.calls[0]!
    const downstream = dispatch.mock.calls[0]!
    expect(downstream[0]).toBe(admitted[0])
    expect(downstream[1]).toStrictEqual(expected.request)
    expect(downstream[2]).toBe(admitted[1])
    expect(downstream[3]?.context).toBe(admitted[2])
    expect(downstream[3]?.signal).toBe(controller.signal)
    expect(downstream[3]?.signal?.aborted).toBe(true)
    expect(downstream[3]?.signal?.reason).toBe('user_stop')
    expect(Object.isFrozen(controller.signal)).toBe(false)
    const seen = new Set<object>()
    const assertFrozen = (value: unknown): void => {
      if (!value || typeof value !== 'object' || seen.has(value)) return
      seen.add(value)
      expect(Object.isFrozen(value)).toBe(true)
      for (const child of Object.values(value)) assertFrozen(child)
    }
    for (const value of [downstream[0], downstream[1], downstream[2], downstream[3]?.context]) {
      assertFrozen(value)
    }
    expect(Object.isFrozen(shared)).toBe(false)
  })

  it.each(['runtime-context', 'direct-with-context', 'direct-without-context'] as const)(
    'fails closed without Host Session authorization on the %s route',
    async (route) => {
      const invokeOrdinarySession = vi.fn(async (_caller, request, ordinarySession) => ({
        actionId: request.actionId,
        output: ordinarySession,
        changed: false,
        replayed: false,
        completedAt: '2026-08-28T00:00:00.000Z'
      }))
      const invoke = vi.fn()
      const runtime = createRuntimeCapabilityBroker({
        broker: { ...emptyBroker(), invoke, invokeOrdinarySession },
        managedTools: createRuntimeMcpToolGateway({
          servers: [],
          clientFactory: async () => { throw new Error('unused') }
        })
      })
      const caller = { audience: 'agent' as const, callerId: 'principal-a', approvals: [] }
      const request = { actionId: 'fixture.native-read', input: {} }
      const session = { runtimeId: 'runtime-a', threadId: 'thread-a' }
      const context = { requestId: 'unauthorized', ...session }
      const result = route === 'runtime-context'
        ? runtime.invoke(caller, request, { context })
        : runtime.invokeOrdinarySession(caller, request, session,
          route === 'direct-with-context' ? { context } : {})

      await expect(result).rejects.toMatchObject({
        code: 'ordinary_session_authorization_unavailable',
        failureClass: 'configuration',
        retryable: false
      })
      expect(invokeOrdinarySession).not.toHaveBeenCalled()
      expect(invoke).not.toHaveBeenCalled()
    }
  )

  it.each(['nested-mutation', 'context-rebinding'] as const)(
    'captures one immutable lossless Session envelope before authorization: %s',
    async (mutation) => {
      let release!: () => void
      const barrier = new Promise<void>((resolve) => { release = resolve })
      const caller = {
        audience: 'agent' as const, callerId: 'A', workspaceId: 'workspace-a',
        approvals: [{ actionId: 'fixture.native-read', mode: 'confirmation' as const }]
      }
      const session = { runtimeId: 'codex', threadId: 't' }
      const context = {
        requestId: 'request-a', runtimeId: 'codex', threadId: 't',
        brokerScope: { providerFamily: 'managed-mcp' as const, packageName: 'package-a' }
      }
      const request = { actionId: 'fixture.native-read', input: { nested: ['original'] } }
      const controller = new AbortController()
      const options = { context, signal: controller.signal }
      const expected = structuredClone({ caller, session, context, request })
      const authorize = vi.fn(async (
        admittedCaller: Parameters<RuntimeCapabilityBroker['invokeOrdinarySession']>[0],
        admittedSession: Parameters<RuntimeCapabilityBroker['invokeOrdinarySession']>[2],
        admittedContext?: NonNullable<Parameters<RuntimeCapabilityBroker['invokeOrdinarySession']>[3]>['context']
      ) => {
        expect(admittedCaller).toStrictEqual(expected.caller)
        expect(admittedSession).toStrictEqual(expected.session)
        expect(admittedContext).toStrictEqual(expected.context)
        await barrier
      })
      const dispatch = vi.fn<RuntimeCapabilityBroker['invokeOrdinarySession']>(
        async (_caller, downstreamRequest) => ({
          actionId: downstreamRequest.actionId, output: null, changed: false,
          replayed: false, completedAt: '2026-08-28T00:00:00.000Z'
        })
      )
      const runtime = createRuntimeCapabilityBroker({
        broker: { ...emptyBroker(), invokeOrdinarySession: dispatch },
        managedTools: createRuntimeMcpToolGateway({
          servers: [], clientFactory: async () => { throw new Error('unused') }
        }),
        assertOrdinarySessionAccess: authorize
      })
      const pending = runtime.invokeOrdinarySession(caller, request, session, options)
      expect(authorize).toHaveBeenCalledOnce()
      expect(dispatch).not.toHaveBeenCalled()
      caller.callerId = 'B'
      caller.approvals[0]!.actionId = 'fixture.other'
      session.threadId = 'other-t'
      request.input.nested[0] = 'changed'
      if (mutation === 'nested-mutation') {
        context.threadId = 'other-t'
        context.brokerScope.packageName = 'package-b'
      } else {
        options.context = { ...context, threadId: 'other-t', brokerScope: {
          providerFamily: 'managed-mcp', packageName: 'package-b'
        } }
        options.signal = new AbortController().signal
      }
      release()
      await pending
      const authorized = authorize.mock.calls[0]!
      const dispatched = dispatch.mock.calls[0]!
      expect(dispatched[0]).toEqual(expected.caller)
      expect(dispatched[1]).toEqual(expected.request)
      expect(dispatched[2]).toEqual(expected.session)
      expect(dispatched[3]?.context).toStrictEqual(expected.context)
      expect(dispatched[0]).toBe(authorized[0])
      expect(dispatched[2]).toBe(authorized[1])
      expect(dispatched[3]?.context).toBe(authorized[2])
      expect(dispatched[3]?.signal).toBe(controller.signal)
      for (const value of [dispatched[0], dispatched[0].approvals,
        dispatched[0].approvals[0], dispatched[1], dispatched[1].input,
        dispatched[2], dispatched[3], dispatched[3]?.context,
        dispatched[3]?.context?.brokerScope]) {
        expect(Object.isFrozen(value)).toBe(true)
      }
      expect(Object.isFrozen(caller)).toBe(false)
      expect(Object.isFrozen(context.brokerScope)).toBe(false)
    }
  )

  it('projects only exact runtime/thread identity onto native Agent invocations', async () => {
    const invoke = vi.fn(async () => ({
      actionId: 'fixture.native-read',
      output: { route: 'plain' },
      changed: false,
      replayed: false,
      completedAt: '2026-08-28T00:00:00.000Z'
    }))
    const invokeOrdinarySession = vi.fn(async (_caller, request, ordinarySession) => ({
      actionId: request.actionId,
      output: ordinarySession,
      changed: false,
      replayed: false,
      completedAt: '2026-08-28T00:00:00.000Z'
    }))
    const runtime = createRuntimeCapabilityBroker({
      broker: { ...emptyBroker(), invoke, invokeOrdinarySession },
      managedTools: createRuntimeMcpToolGateway({
        servers: [],
        clientFactory: async () => { throw new Error('unused') }
      }),
      assertOrdinarySessionAccess: (_caller, session, context) => {
        expect(session).toEqual({ runtimeId: 'runtime-a', threadId: 'thread-a' })
        expect(context).toEqual({
          requestId: 'request-exact', runtimeId: ' runtime-a ', threadId: ' thread-a '
        })
      }
    })
    const caller = {
      audience: 'agent' as const,
      callerId: 'runtime-a:thread-a',
      approvals: []
    }
    const request = { actionId: 'fixture.native-read', input: {} }

    await runtime.invoke(caller, request, {
      context: {
        requestId: 'request-exact',
        runtimeId: ' runtime-a ',
        threadId: ' thread-a '
      }
    })
    expect(invokeOrdinarySession).toHaveBeenCalledWith(
      caller,
      request,
      { runtimeId: 'runtime-a', threadId: 'thread-a' },
      { signal: undefined, context: expect.objectContaining({
        runtimeId: ' runtime-a ', threadId: ' thread-a '
      }) }
    )
    expect(invoke).not.toHaveBeenCalled()

    await runtime.invoke(caller, {
      actionId: 'fixture.native-read',
      input: { title: 'thread-guessed', prompt: 'runtime-guessed' }
    }, {
      context: {
        requestId: 'request-no-thread',
        runtimeId: 'runtime-a'
      }
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invokeOrdinarySession).toHaveBeenCalledTimes(1)
  })

  it('requires Host authorization beyond the Session ID before cross-process Session routing', async () => {
    const invokeOrdinarySession = vi.fn(async (_caller, request, ordinarySession) => ({
      actionId: request.actionId,
      output: ordinarySession,
      changed: false,
      replayed: false,
      completedAt: '2026-08-28T00:00:00.000Z'
    }))
    const assertOrdinarySessionAccess = vi.fn(async (caller, ordinarySession, context) => {
      if (caller.callerId !== 'principal-a') throw new Error('Session is unavailable to this Principal.')
      if (ordinarySession.runtimeId !== 'runtime-a') throw new Error('Runtime binding mismatch.')
      if (ordinarySession.threadId !== 'thread-a') throw new Error('Session binding mismatch.')
      expect(context?.runtimeId).toBe(' runtime-a ')
      expect(context?.threadId).toBe(' thread-a ')
    })
    const runtime = createRuntimeCapabilityBroker({
      broker: { ...emptyBroker(), invokeOrdinarySession },
      managedTools: createRuntimeMcpToolGateway({
        servers: [],
        clientFactory: async () => { throw new Error('unused') }
      }),
      assertOrdinarySessionAccess
    })
    const request = { actionId: 'fixture.native-read', input: {} }
    const session = { runtimeId: 'runtime-a', threadId: 'thread-a' }

    await runtime.invoke({ audience: 'agent', callerId: 'principal-a', approvals: [] }, request, {
      context: { requestId: 'authorized', runtimeId: ' runtime-a ', threadId: ' thread-a ' }
    })
    expect(assertOrdinarySessionAccess).toHaveBeenCalledWith(
      { audience: 'agent', callerId: 'principal-a', approvals: [] },
      session,
      expect.objectContaining({ runtimeId: ' runtime-a ', threadId: ' thread-a ' })
    )
    expect(invokeOrdinarySession).toHaveBeenCalledTimes(1)

    await expect(runtime.invoke({ audience: 'agent', callerId: 'principal-b', approvals: [] }, request, {
      context: { requestId: 'forged', runtimeId: 'runtime-a', threadId: 'thread-a' }
    })).rejects.toThrow('unavailable to this Principal')
    expect(invokeOrdinarySession).toHaveBeenCalledTimes(1)

    await expect(runtime.invokeOrdinarySession(
      { audience: 'agent', callerId: 'principal-a', approvals: [] },
      request,
      { runtimeId: 'runtime-a', threadId: 'thread-b' },
      { context: { requestId: 'cross-thread', runtimeId: 'runtime-a', threadId: 'thread-a' } }
    )).rejects.toThrow('Session binding mismatch')
    expect(invokeOrdinarySession).toHaveBeenCalledTimes(1)

    await expect(runtime.invokeOrdinarySession(
      { audience: 'agent', callerId: 'principal-a', approvals: [] },
      request,
      { runtimeId: 'runtime-b', threadId: 'thread-a' },
      { context: { requestId: 'cross-runtime', runtimeId: 'runtime-a', threadId: 'thread-a' } }
    )).rejects.toThrow('Runtime binding mismatch')
    expect(invokeOrdinarySession).toHaveBeenCalledTimes(1)

    const caller = { audience: 'agent' as const, callerId: 'principal-a', approvals: [] }
    const context = Object.freeze({
      requestId: 'direct-authorized', runtimeId: ' runtime-a ', threadId: ' thread-a ',
      turnId: 'turn-a', callId: 'call-a', workspaceId: 'workspace-a'
    })
    const options = { context, signal: new AbortController().signal }
    await runtime.invokeOrdinarySession(caller, request, session, options)
    expect(assertOrdinarySessionAccess.mock.lastCall?.[2]).toStrictEqual(context)
    expect(invokeOrdinarySession.mock.lastCall?.[2]).toStrictEqual(session)
    expect(invokeOrdinarySession).toHaveBeenLastCalledWith(caller, request, session, options)
    expect(invokeOrdinarySession).toHaveBeenCalledTimes(2)
  })

  it.each(['without-context', 'without-thread', 'authorized-session'] as const)(
    'preserves real global compute dispatch %s',
    async (route) => {
      const definition = defineCapability({
        id: 'fixture.global-compute',
        version: '1',
        title: 'Global compute',
        description: 'Compute through the canonical native Broker.',
        audiences: ['agent'],
        scope: 'global',
        effect: 'compute',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: z.object({ value: z.string() }).strict(),
        outputSchema: z.object({ value: z.string() }).strict(),
        handler: async (input) => ({ output: input })
      })
      const context = Object.freeze({
        requestId: 'compute', runtimeId: 'runtime-a', threadId: 'thread-a',
        turnId: 'turn-a', callId: 'call-a'
      })
      const assertOrdinarySessionAccess = vi.fn(async (_caller, session, originalContext) => {
        expect(session).toEqual({ runtimeId: 'runtime-a', threadId: 'thread-a' })
        expect(originalContext).toStrictEqual(context)
      })
      const runtime = createRuntimeCapabilityBroker({
        broker: new CapabilityBroker(new CapabilityRegistry([definition])),
        managedTools: createRuntimeMcpToolGateway({
          servers: [],
          clientFactory: async () => { throw new Error('unused') }
        }),
        ...(route === 'authorized-session' ? { assertOrdinarySessionAccess } : {})
      })
      if (route === 'authorized-session') {
        const surface = createCapabilityAgentToolSurface({
          broker: runtime,
          resolveCaller: () => ({ audience: 'agent', callerId: 'principal-a' })
        })
        const discovered = await surface.call({
          name: CAPABILITY_AGENT_TOOL_NAMES.discover,
          arguments: { capabilityId: definition.descriptor.id },
          context
        })
        const operationRef = (discovered.value as Array<{ operationRef: string }>)[0]!.operationRef
        await expect(surface.call({
          name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
          arguments: { operationRef, input: { value: 'computed' } },
          context
        })).resolves.toMatchObject({ value: { output: { value: 'computed' } } })
        expect(assertOrdinarySessionAccess).toHaveBeenCalledOnce()
      } else {
        await expect(runtime.invoke(
          { audience: 'agent', callerId: 'principal-a', approvals: [] },
          { actionId: definition.descriptor.id, invocationId: 'compute-1', input: { value: 'computed' } },
          route === 'without-context' ? {} : { context: { requestId: 'compute', runtimeId: 'runtime-a' } }
        )).resolves.toMatchObject({ output: { value: 'computed' } })
        expect(assertOrdinarySessionAccess).not.toHaveBeenCalled()
      }
    }
  )

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
      resourceRef: `res_${'r'.repeat(32)}`
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
          recipe: expect.objectContaining({
            type: 'object',
            required: true,
            properties: expect.any(Object)
          })
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

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: {
        operationRef,
        input: JSON.stringify({ recipe: { scene: 'encoded-cells' } })
      },
      context: { ...context, requestId: 'request-encoded', callId: 'call-encoded' }
    })).resolves.toMatchObject({
      value: {
        output: { artifactRef: 'artifact_123' },
        changed: false
      }
    })
    expect(callTool).toHaveBeenLastCalledWith({
      name: 'visual.render',
      arguments: {
        workspaceRoot: '/tmp/workspace',
        recipe: { scene: 'encoded-cells' }
      },
      _meta: {
        'fixture/trusted-invocation': expect.objectContaining({
          requestId: 'request-encoded', callId: 'call-encoded', actionId: expect.any(String)
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

function nonLosslessSnapshotCases(): Array<[
  'input' | 'caller' | 'request' | 'session' | 'context',
  'direct' | 'runtime-context', string, () => unknown
]> {
  const invalid: Array<[string, () => unknown]> = [
    ['Date', () => new Date('2026-08-28T00:00:00.000Z')],
    ['NaN', () => Number.NaN],
    ['Infinity', () => Infinity],
    ['negative Infinity', () => -Infinity],
    ['undefined', () => undefined],
    ['function', () => () => 'not JSON'],
    ['symbol', () => Symbol('not JSON')],
    ['bigint', () => 1n],
    ['object cycle', () => { const value: Record<string, unknown> = {}; value.self = value; return value }],
    ['array cycle', () => { const value: unknown[] = []; value.push(value); return value }],
    ['Map', () => new Map([['value', 'not JSON']])],
    ['Set', () => new Set(['not JSON'])],
    ['WeakMap', () => new WeakMap()],
    ['WeakSet', () => new WeakSet()],
    ['typed array', () => new Uint8Array([1])],
    ['Buffer', () => Buffer.from([1])],
    ['ArrayBuffer', () => new ArrayBuffer(1)],
    ['DataView', () => new DataView(new ArrayBuffer(1))],
    ['RegExp', () => /not-json/],
    ['Error', () => new Error('not JSON')],
    ['boxed number', () => Object(1)],
    ['class instance', () => new (class { value = 'not JSON' })()],
    ['array subclass', () => new (class extends Array<string> {})('not plain')],
    ['sparse array', () => Array(2)],
    ['partial sparse array', () => { const value = ['valid']; value.length = 2; return value }],
    ['array extra property', () => Object.assign(['valid'], { ignored: 'lost' })],
    ['symbol property', () => ({ [Symbol('ignored')]: 'lost' })],
    ['non-enumerable property', () => Object.defineProperty({}, 'ignored', { value: 'lost' })],
    ['accessor', () => Object.defineProperty({}, 'value', { enumerable: true, get: () => 'not data' })]
  ]
  return (['input', 'caller', 'request', 'session', 'context'] as const).flatMap((field) => (
    (['direct', 'runtime-context'] as const).filter((route) => field !== 'session' || route === 'direct')
      .flatMap((route) => invalid.map(
        ([name, createValue]): [typeof field, typeof route, string, () => unknown] => (
          [field, route, name, createValue]
        )
      ))
  ))
}

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
