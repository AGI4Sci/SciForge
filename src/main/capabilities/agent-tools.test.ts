import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type {
  CapabilityCallerContext,
  CapabilityInvocationResult,
  CapabilityObservation,
  CapabilityResourceChangeEvent
} from '../../shared/capability-broker'
import {
  CAPABILITY_AGENT_TOOL_NAMES,
  CapabilityAgentToolError,
  createCapabilityAgentToolSurface,
  type CapabilityAgentBroker,
  type CapabilityAgentToolRequestContext
} from './agent-tools'
import { CapabilityBroker } from './broker'
import { CapabilityRegistry, defineCapability } from './registry'

const caller: CapabilityCallerContext = {
  audience: 'agent',
  callerId: 'thread-1',
  workspaceId: '/workspace',
  approvals: []
}

const context: CapabilityAgentToolRequestContext = {
  requestId: 'request-1',
  threadId: 'thread-1',
  workspaceId: '/workspace'
}

const resource = {
  token: 'cap_abcdefghijklmnopqrstuvwxyz',
  semanticRevision: 'revision-1',
  expiresAt: '2026-07-16T12:00:00.000Z'
}

const observation: CapabilityObservation = {
  resource,
  resourceRef: 'res_abcdefghijklmnopqrstuvwxyz',
  resourceKind: 'test.document',
  semanticRevision: 'revision-1',
  observedAt: '2026-07-16T11:00:00.000Z',
  state: { title: 'Current state' },
  operations: []
}

const invocation: CapabilityInvocationResult = {
  actionId: 'test.action',
  invocationId: 'invocation-1',
  output: { ok: true },
  changed: false,
  replayed: false,
  completedAt: '2026-07-16T11:00:00.000Z'
}

const event: CapabilityResourceChangeEvent = {
  id: 'event_abcdefghijklmnopqrstuvwxyz',
  type: 'resource.changed',
  occurredAt: '2026-07-16T11:00:00.000Z',
  workspaceId: '/workspace',
  resourceRef: 'res_abcdefghijklmnopqrstuvwxyz',
  resourceKind: 'test.document',
  actionId: 'test.action',
  invocationId: 'invocation-1',
  beforeRevision: 'revision-1',
  afterRevision: 'revision-2'
}

describe('CapabilityAgentToolSurface', () => {
  it('publishes only the four stable broker tools with executable JSON schemas', () => {
    const surface = createCapabilityAgentToolSurface({
      broker: brokerStub(),
      resolveCaller: () => caller
    })

    expect(surface.tools().map((tool) => tool.name)).toEqual([
      CAPABILITY_AGENT_TOOL_NAMES.discover,
      CAPABILITY_AGENT_TOOL_NAMES.observe,
      CAPABILITY_AGENT_TOOL_NAMES.invoke,
      CAPABILITY_AGENT_TOOL_NAMES.events
    ])
    expect(new Set(surface.tools().map((tool) => tool.name)).size).toBe(4)
    expect(surface.tools().every((tool) => tool.inputSchema.type === 'object')).toBe(true)
  })

  it('discovers capabilities from the live registry on every call', async () => {
    const registry = new CapabilityRegistry()
    const broker = new CapabilityBroker(registry)
    const discover = vi.spyOn(broker, 'discover')
    const surface = createCapabilityAgentToolSurface({
      broker,
      resolveCaller: () => caller
    })

    const first = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })
    expect(first.value).toEqual([])

    registry.register(readCapability('test.hot-discovered'))

    const second = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'hot-discovered' },
      context
    })
    expect(second.value).toEqual([expect.objectContaining({ id: 'test.hot-discovered' })])
    expect(discover).toHaveBeenCalledTimes(2)
    expect(surface.tools()).toBe(surface.tools())
  })

  it('has transport parity with direct broker observation and invocation', async () => {
    const handler = vi.fn(async (_input: { value: number }, handlerContext: { caller: CapabilityCallerContext }) => ({
      output: { callerId: handlerContext.caller.callerId }
    }))
    const registry = new CapabilityRegistry([
      defineCapability({
        id: 'test.document-read',
        version: '1',
        title: 'Read test document',
        description: 'Reads a test document through the broker.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: ['test.document'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: z.object({ value: z.number() }).strict(),
        outputSchema: z.object({ callerId: z.string() }).strict(),
        handler
      })
    ])
    const broker = new CapabilityBroker(registry, {
      now: () => new Date('2026-07-16T11:00:00.000Z')
    })
    const handle = broker.issueResourceHandle(caller, {
      resourceId: 'document-1',
      resourceKind: 'test.document',
      workspaceId: '/workspace',
      semanticRevision: 'revision-1',
      observe: async () => ({
        state: { title: 'Document 1' },
        semanticRevision: 'revision-1',
        operationIds: ['test.document-read']
      })
    })
    const surface = createCapabilityAgentToolSurface({ broker, resolveCaller: () => caller })

    const directObservation = await broker.observe(caller, { resource: handle })
    const transportedObservation = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resource: handle },
      context
    })
    expect(transportedObservation.value).toMatchObject({
      resourceKind: directObservation.resourceKind,
      semanticRevision: directObservation.semanticRevision,
      state: directObservation.state,
      operations: directObservation.operations
    })

    const request = { actionId: 'test.document-read', resource: handle, input: { value: 1 } }
    const directInvocation = await broker.invoke(caller, request)
    const transportedInvocation = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: request,
      context
    })
    expect(transportedInvocation.value).toEqual(directInvocation)
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls.every(([, handlerContext]) => handlerContext.caller.callerId === caller.callerId)).toBe(true)
  })

  it('routes observe, invoke, and events through the same broker with transport-derived caller identity', async () => {
    const observe = vi.fn(async () => observation)
    const invoke = vi.fn(async () => invocation)
    const listEvents = vi.fn(async () => [event])
    const surface = createCapabilityAgentToolSurface({
      broker: { ...brokerStub(), observe, invoke, listEvents },
      resolveCaller: (requestContext) => ({
        audience: 'agent',
        callerId: requestContext.threadId ?? String(requestContext.requestId),
        workspaceId: requestContext.workspaceId,
        approvals: []
      })
    })

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resource },
      context
    })).resolves.toEqual({ tool: CAPABILITY_AGENT_TOOL_NAMES.observe, value: observation })

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { actionId: 'test.action', invocationId: 'invocation-1', resource, input: { value: 1 } },
      context
    })).resolves.toEqual({ tool: CAPABILITY_AGENT_TOOL_NAMES.invoke, value: invocation })

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.events,
      arguments: { afterEventId: event.id, limit: 25 },
      context
    })).resolves.toEqual({ tool: CAPABILITY_AGENT_TOOL_NAMES.events, value: [event] })

    expect(observe).toHaveBeenCalledWith(caller, { resource })
    expect(invoke).toHaveBeenCalledWith(
      caller,
      { actionId: 'test.action', invocationId: 'invocation-1', resource, input: { value: 1 } },
      {}
    )
    expect(listEvents).toHaveBeenCalledWith(caller, { afterEventId: event.id, limit: 25 })
  })

  it('does not let tool arguments override caller identity or use the surface as a non-agent caller', async () => {
    const surface = createCapabilityAgentToolSurface({
      broker: brokerStub(),
      resolveCaller: () => caller
    })

    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { audience: 'system' },
      context
    })).rejects.toMatchObject({ name: 'ZodError' })

    const uiSurface = createCapabilityAgentToolSurface({
      broker: brokerStub(),
      resolveCaller: () => ({ ...caller, audience: 'ui' })
    })
    await expect(uiSurface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })).rejects.toEqual(expect.objectContaining<Partial<CapabilityAgentToolError>>({
      code: 'invalid_caller_audience'
    }))
  })

  it('rejects unknown transport tools without consulting the broker', async () => {
    const broker = brokerStub()
    const surface = createCapabilityAgentToolSurface({ broker, resolveCaller: () => caller })

    await expect(surface.call({ name: 'test.unknown', arguments: {}, context })).rejects.toMatchObject({
      code: 'unknown_agent_tool'
    })
    expect(broker.discover).not.toHaveBeenCalled()
    expect(broker.observe).not.toHaveBeenCalled()
    expect(broker.invoke).not.toHaveBeenCalled()
    expect(broker.listEvents).not.toHaveBeenCalled()
  })
})

function brokerStub(): CapabilityAgentBroker & {
  discover: ReturnType<typeof vi.fn>
  observe: ReturnType<typeof vi.fn>
  invoke: ReturnType<typeof vi.fn>
  listEvents: ReturnType<typeof vi.fn>
} {
  return {
    discover: vi.fn(async () => []),
    observe: vi.fn(async () => observation),
    invoke: vi.fn(async () => invocation),
    listEvents: vi.fn(async () => [])
  }
}

function readCapability(id: string) {
  return defineCapability({
    id,
    version: '1',
    title: 'Hot-discovered capability',
    description: 'Used to verify current-registry discovery.',
    audiences: ['agent'],
    scope: 'global',
    effect: 'read',
    approval: 'none',
    concurrency: { revision: 'none', idempotency: 'none' },
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ ok: z.boolean() }).strict(),
    handler: async () => ({ output: { ok: true } })
  })
}
