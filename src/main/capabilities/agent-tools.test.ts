import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type {
  CapabilityCallerContext,
  CapabilityDescriptor,
  CapabilityInvocationResult,
  CapabilityObservation,
  CapabilityResourceHandle
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
import { surfaceObservationStateSchema } from '../../shared/surface-inspection'

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

describe('CapabilityAgentToolSurface', () => {
  it('publishes the four v2 meta-tools without broker authority fields', () => {
    const surface = createCapabilityAgentToolSurface({ broker: brokerStub(), resolveCaller: () => caller })

    expect(surface.tools().map((tool) => tool.name)).toEqual([
      'sciforge_discover',
      'sciforge_observe',
      'sciforge_invoke',
      'sciforge_events'
    ])
    expect(surface.tools().every((tool) => tool.inputSchema.type === 'object')).toBe(true)
    expect(JSON.stringify(surface.tools())).not.toMatch(
      /snapshotToken|componentId|expectedRevision|semanticRevision|invocationId|actionId|coordinates/u
    )
  })

  it('discovers live operations as opaque refs and expands only a requested compact schema', async () => {
    const registry = new CapabilityRegistry()
    const broker = new CapabilityBroker(registry)
    const surface = createCapabilityAgentToolSurface({ broker, resolveCaller: () => caller })

    expect((await surface.call({ name: CAPABILITY_AGENT_TOOL_NAMES.discover, arguments: {}, context })).value)
      .toEqual([])
    registry.register(readCapability('test.hot-discovered'))

    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { text: 'hot-discovered' },
      context
    })
    if (discovered.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected discover result.')
    const operation = discovered.value[0]
    expect(operation).toMatchObject({
      operationRef: expect.stringMatching(/^op_/u),
      schemaRef: expect.stringMatching(/^schema_/u),
      title: 'Hot-discovered capability'
    })
    expect(operation).not.toHaveProperty('id')
    expect(operation).not.toHaveProperty('inputShape')

    const expanded = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { operationRef: operation?.operationRef, includeSchema: true },
      context
    })
    if (expanded.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected discover result.')
    expect(expanded.value[0]).toHaveProperty('inputShape')
  })

  it('keeps handles, revisions, action ids, and mutation ids inside the adapter', async () => {
    const surfaceHandle = handle('surface-revision')
    const documentHandle = handle('document-revision', 'b')
    const open = descriptor('surface.current', 'Open current surface', 'global', 'read')
    const inspect = descriptor('surface.inspect', 'Inspect surface', 'resource', 'read')
    const mutate = descriptor('document.update', 'Update document', 'resource', 'workspace-write')
    const surfaceObservation = observation(
      surfaceHandle,
      'res_surface_abcdefghijklmnopqrstuvwxyz',
      'surface',
      {
        layoutFreshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
        targets: [],
        resources: [{ kind: 'workspace-preview', resource: documentHandle }]
      },
      [inspect, mutate]
    )
    const documentObservation = observation(
      documentHandle,
      'res_document_abcdefghijklmnopqrstuvwxyz',
      'workspace-preview',
      { title: 'Paper' },
      [mutate]
    )
    const discover = vi.fn(async () => [open, inspect, mutate])
    const observe = vi.fn(async (_caller, request) => (
      request.resource.token === surfaceHandle.token ? surfaceObservation : documentObservation
    ))
    const invoke = vi.fn(async (_caller, request): Promise<CapabilityInvocationResult> => ({
      actionId: request.actionId,
      ...(request.invocationId ? { invocationId: request.invocationId } : {}),
      output: request.actionId === open.id ? { surface: surfaceHandle } : { ok: true },
      changed: request.actionId === mutate.id,
      replayed: false,
      completedAt: '2026-07-16T11:00:00.000Z'
    }))
    const surface = createCapabilityAgentToolSurface({
      broker: {
        discover,
        observe,
        bindResourceRef: vi.fn(async () => documentHandle),
        invoke,
        listEvents: vi.fn(async () => [])
      },
      resolveCaller: () => caller
    })

    const discovered = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: {},
      context
    })
    if (discovered.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) throw new Error('Expected discover result.')
    const operations = discovered.value
    const openRef = operations.find((candidate) => candidate.title === open.title)?.operationRef
    const mutateRef = operations.find((candidate) => candidate.title === mutate.title)?.operationRef
    const opened = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: openRef, input: {} },
      context
    })
    if (opened.tool !== CAPABILITY_AGENT_TOOL_NAMES.invoke) throw new Error('Expected invoke result.')
    const surfaceRef = (opened.value.output as { surface: { resourceRef: string } }).surface.resourceRef
    const observed = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef: surfaceRef },
      context
    })
    if (observed.tool !== CAPABILITY_AGENT_TOOL_NAMES.observe) throw new Error('Expected observe result.')
    const sanitizedState = surfaceObservationStateSchema.parse(observed.value.state)
    const documentRef = sanitizedState.resources[0]?.resourceRef

    await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: mutateRef, resourceRef: documentRef, input: { title: 'Updated' } },
      context
    })

    expect(invoke).toHaveBeenLastCalledWith(caller, expect.objectContaining({
      actionId: mutate.id,
      resource: documentHandle,
      expectedRevision: documentHandle.semanticRevision,
      invocationId: expect.stringMatching(/^agent_inv_/u),
      input: { title: 'Updated' }
    }), {})
    expect(JSON.stringify({ opened, observed })).not.toMatch(
      /cap_|semanticRevision|expiresAt|actionId|invocationId|expectedRevision|snapshotToken|componentId/u
    )
  })

  it('binds a transferred resourceRef and renews its expired cached handle on observation', async () => {
    let now = new Date('2026-07-16T11:00:00.000Z')
    const read = defineCapability({
      id: 'document.read',
      version: '1',
      title: 'Read document',
      description: 'Reads a bound document resource.',
      audiences: ['agent', 'ui'],
      scope: 'resource',
      resourceKinds: ['document'],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    })
    const registry = new CapabilityRegistry([read])
    const broker = new CapabilityBroker(registry, { now: () => now, handleTtlMs: 1_000 })
    const uiCaller: CapabilityCallerContext = {
      audience: 'ui',
      callerId: 'window-1',
      workspaceId: '/workspace',
      approvals: []
    }
    const uiHandle = broker.issueResourceHandle(uiCaller, {
      resourceId: 'internal-paper',
      resourceKind: 'document',
      workspaceId: '/workspace',
      audiences: ['ui', 'agent'],
      semanticRevision: '1',
      expiresInMs: 1_000,
      observe: async () => ({
        state: { title: 'Paper' },
        semanticRevision: '1',
        operationIds: ['document.read']
      })
    })
    const transferred = await broker.observe(uiCaller, { resource: uiHandle })
    const surface = createCapabilityAgentToolSurface({ broker, resolveCaller: () => caller })

    const first = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef: transferred.resourceRef },
      context
    })
    expect(first.value).toMatchObject({ resourceRef: transferred.resourceRef, state: { title: 'Paper' } })
    if (first.tool !== CAPABILITY_AGENT_TOOL_NAMES.observe) throw new Error('Expected observe result.')
    const readRef = first.value.operations[0]?.operationRef

    now = new Date('2026-07-16T11:00:02.000Z')
    const invoked = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: readRef, resourceRef: transferred.resourceRef, input: {} },
      context
    })
    expect(invoked.value).toMatchObject({ resourceRef: transferred.resourceRef, output: { ok: true } })
    const renewed = await surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef: transferred.resourceRef },
      context
    })
    expect(renewed.value).toMatchObject({ resourceRef: transferred.resourceRef, state: { title: 'Paper' } })
  })

  it('derives caller identity from transport and rejects non-agent callers and unknown refs', async () => {
    const surface = createCapabilityAgentToolSurface({ broker: brokerStub(), resolveCaller: () => caller })
    await expect(surface.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.observe,
      arguments: { resourceRef: 'res_abcdefghijklmnopqrstuvwxyz' },
      context
    })).rejects.toMatchObject({ code: 'unknown_resource_ref' })

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
})

function handle(revision: string, suffix = 'a'): CapabilityResourceHandle {
  return {
    token: `cap_${suffix.repeat(26)}`,
    semanticRevision: revision,
    expiresAt: '2026-07-16T12:00:00.000Z'
  }
}

function observation(
  resource: CapabilityResourceHandle,
  resourceRef: string,
  resourceKind: string,
  state: CapabilityObservation['state'],
  operations: CapabilityDescriptor[]
): CapabilityObservation {
  return {
    resource,
    resourceRef,
    resourceKind,
    semanticRevision: resource.semanticRevision,
    observedAt: '2026-07-16T11:00:00.000Z',
    state,
    operations
  }
}

function descriptor(
  id: string,
  title: string,
  scope: CapabilityDescriptor['scope'],
  effect: CapabilityDescriptor['effect']
): CapabilityDescriptor {
  return defineCapability({
    id,
    version: '2',
    title,
    description: `${title} through the broker.`,
    audiences: ['agent'],
    scope,
    ...(scope === 'resource' ? { resourceKinds: ['surface', 'workspace-preview'] } : {}),
    effect,
    approval: 'none',
    concurrency: effect === 'read'
      ? { revision: 'none', idempotency: 'none' }
      : { revision: 'optimistic', idempotency: 'required' },
    inputSchema: z.object({ title: z.string().optional() }).strict(),
    outputSchema: z.object({ ok: z.boolean() }).strict(),
    handler: async () => ({ output: { ok: true } })
  }).descriptor
}

function brokerStub(): CapabilityAgentBroker {
  return {
    discover: vi.fn(async () => []),
    observe: vi.fn(),
    bindResourceRef: vi.fn(() => {
      throw new CapabilityAgentToolError('unknown_resource_ref', 'The resource reference is unknown or expired.')
    }),
    invoke: vi.fn(),
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
    inputSchema: z.object({ query: z.string().optional() }).strict(),
    outputSchema: z.object({ ok: z.boolean() }).strict(),
    handler: async () => ({ output: { ok: true } })
  })
}
