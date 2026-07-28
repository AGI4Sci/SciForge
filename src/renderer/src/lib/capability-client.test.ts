import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import type {
  CapabilityJsonValue,
  CapabilityObservation,
  CapabilityReadiness
} from '@shared/capability-broker'
import type { SciForgeApi } from '@shared/sciforge-api'
import { RendererCapabilityClient, type RendererCapabilityContract } from './capability-client'

const READY: CapabilityReadiness = {
  contractVersion: 1,
  status: 'ready' as const,
  registryFingerprint: '0'.repeat(64),
  availableCapabilityIds: ['example.read', 'example.compute'],
  missingCapabilityIds: [],
  message: 'ready'
}

function result(actionId: string, output: CapabilityJsonValue, invocationId?: string) {
  return {
    actionId,
    ...(invocationId ? { invocationId } : {}),
    output,
    changed: false,
    replayed: false,
    completedAt: '2026-07-22T00:00:00.000Z'
  }
}

function transport(output: CapabilityJsonValue) {
  const readiness = vi.fn(async (): Promise<CapabilityReadiness> => READY)
  const observe = vi.fn(async (): Promise<CapabilityObservation> => {
    throw new Error('observe not configured')
  })
  const invoke = vi.fn(async ({ request }: Parameters<SciForgeApi['capabilities']['invoke']>[0]) =>
    result(request.actionId, output, request.invocationId)
  )
  const subscribe = vi.fn(async () => ({
    subscriptionId: '123e4567-e89b-12d3-a456-426614174000'
  }))
  const unsubscribe = vi.fn(async () => true)
  let eventHandler: Parameters<SciForgeApi['capabilities']['onEvent']>[0] | null = null
  const removeEventListener = vi.fn()
  const onEvent = vi.fn((handler: Parameters<SciForgeApi['capabilities']['onEvent']>[0]) => {
    eventHandler = handler
    return removeEventListener
  })
  return {
    readiness,
    observe,
    invoke,
    subscribe,
    unsubscribe,
    onEvent,
    removeEventListener,
    emitEvent: (payload: Parameters<NonNullable<typeof eventHandler>>[0]) => eventHandler?.(payload)
  }
}

describe('RendererCapabilityClient', () => {
  it('validates readiness, input and output around one generic invocation', async () => {
    const bridge = transport({ value: 2 })
    const client = new RendererCapabilityClient({ getTransport: () => bridge })
    const contract: RendererCapabilityContract<{ value: number }, { value: number }> = {
      actionId: 'example.read',
      effect: 'read',
      inputSchema: z.object({ value: z.number() }).strict(),
      outputSchema: z.object({ value: z.number() }).strict()
    }

    await expect(client.invoke(contract, { value: 1 })).resolves.toEqual({ value: 2 })
    expect(bridge.readiness).toHaveBeenCalledWith({
      expectedContractVersion: 1,
      requiredCapabilityIds: ['example.read']
    })
    expect(bridge.invoke.mock.calls[0]?.[0].request).toEqual({
      actionId: 'example.read',
      input: { value: 1 }
    })
  })

  it('adds an invocation ID to every non-read action', async () => {
    const bridge = transport({ ok: true })
    const client = new RendererCapabilityClient({
      getTransport: () => bridge,
      createInvocationId: () => 'invocation-1'
    })
    const contract = {
      actionId: 'example.compute',
      effect: 'compute' as const,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict()
    }

    await client.invoke(contract, {})
    expect(bridge.invoke.mock.calls[0]?.[0].request.invocationId).toBe('invocation-1')
  })

  it('maps resource-scoped invocation options into the canonical request', async () => {
    const bridge = transport({ ok: true })
    const client = new RendererCapabilityClient({
      getTransport: () => bridge,
      createInvocationId: () => 'invocation-resource-1'
    })
    const resource = {
      token: 'cap_abcdefghijklmnopqrst',
      semanticRevision: 'revision-7',
      expiresAt: '2026-07-22T01:00:00.000Z'
    }

    await client.invoke({
      actionId: 'example.compute',
      effect: 'compute',
      inputSchema: z.object({ value: z.number() }).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict()
    }, { value: 1 }, {
      workspaceId: '/workspace',
      resource,
      expectedRevision: resource.semanticRevision,
      approval: { mode: 'confirmation' }
    })

    expect(bridge.readiness).toHaveBeenCalledWith({
      workspaceId: '/workspace',
      expectedContractVersion: 1,
      requiredCapabilityIds: ['example.compute']
    })
    expect(bridge.invoke).toHaveBeenCalledWith({
      workspaceId: '/workspace',
      request: {
        actionId: 'example.compute',
        invocationId: 'invocation-resource-1',
        resource,
        expectedRevision: 'revision-7',
        input: { value: 1 }
      },
      approval: { mode: 'confirmation' }
    })
  })

  it('observes a resource through the canonical broker path and validates domain state', async () => {
    const bridge = transport(null)
    const resource = {
      token: 'cap_abcdefghijklmnopqrst',
      semanticRevision: 'revision-7',
      expiresAt: '2026-07-22T01:00:00.000Z'
    }
    bridge.observe.mockResolvedValue({
      resource: { ...resource, semanticRevision: 'revision-8' },
      resourceRef: 'res_abcdefghijklmnopqrst',
      resourceKind: 'example-resource',
      semanticRevision: 'revision-8',
      observedAt: '2026-07-22T00:05:00.000Z',
      state: { status: 'online' },
      operations: []
    })
    const client = new RendererCapabilityClient({ getTransport: () => bridge })

    await expect(client.observe({
      resourceKind: 'example-resource',
      stateSchema: z.object({ status: z.literal('online') }).strict()
    }, resource, { workspaceId: '/workspace' })).resolves.toEqual({
      resource: { ...resource, semanticRevision: 'revision-8' },
      resourceRef: 'res_abcdefghijklmnopqrst',
      resourceKind: 'example-resource',
      semanticRevision: 'revision-8',
      observedAt: '2026-07-22T00:05:00.000Z',
      state: { status: 'online' }
    })
    expect(bridge.observe).toHaveBeenCalledWith({
      workspaceId: '/workspace',
      request: { resource }
    })
  })

  it('rejects observations whose resource kind does not match the domain contract', async () => {
    const bridge = transport(null)
    const resource = {
      token: 'cap_abcdefghijklmnopqrst',
      semanticRevision: 'revision-7',
      expiresAt: '2026-07-22T01:00:00.000Z'
    }
    bridge.observe.mockResolvedValue({
      resource,
      resourceRef: 'res_abcdefghijklmnopqrst',
      resourceKind: 'unexpected-resource',
      semanticRevision: 'revision-7',
      observedAt: '2026-07-22T00:05:00.000Z',
      state: {},
      operations: []
    })
    const client = new RendererCapabilityClient({ getTransport: () => bridge })

    await expect(client.observe({
      resourceKind: 'example-resource',
      stateSchema: z.object({}).strict()
    }, resource)).rejects.toThrow(
      'Capability observation resource kind mismatch: expected "example-resource", received "unexpected-resource".'
    )
  })

  it('subscribes through the canonical broker stream and filters by resource reference', async () => {
    const bridge = transport(null)
    const listener = vi.fn()
    const client = new RendererCapabilityClient({ getTransport: () => bridge })
    const dispose = await client.subscribe(
      'res_abcdefghijklmnopqrst',
      listener,
      { workspaceId: '/workspace' }
    )

    expect(bridge.subscribe).toHaveBeenCalledWith('/workspace')
    bridge.emitEvent({
      subscriptionId: '123e4567-e89b-12d3-a456-426614174000',
      event: {
        id: 'event_abcdefghijklmnopqrst',
        type: 'resource.changed',
        occurredAt: '2026-07-22T00:06:00.000Z',
        workspaceId: '/workspace',
        resourceRef: 'res_otherabcdefghijklmnop',
        resourceKind: 'example-resource',
        actionId: 'example.compute',
        invocationId: 'invocation-1',
        beforeRevision: 'revision-7',
        afterRevision: 'revision-8'
      }
    })
    bridge.emitEvent({
      subscriptionId: '123e4567-e89b-12d3-a456-426614174000',
      event: {
        id: 'event_zyxwvutsrqponmlkjihg',
        type: 'resource.changed',
        occurredAt: '2026-07-22T00:07:00.000Z',
        workspaceId: '/workspace',
        resourceRef: 'res_abcdefghijklmnopqrst',
        resourceKind: 'example-resource',
        actionId: 'example.compute',
        invocationId: 'invocation-2',
        beforeRevision: 'revision-8',
        afterRevision: 'revision-9'
      }
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({
      resourceRef: 'res_abcdefghijklmnopqrst',
      resourceKind: 'example-resource',
      actionId: 'example.compute',
      beforeRevision: 'revision-8',
      afterRevision: 'revision-9',
      changedAt: '2026-07-22T00:07:00.000Z'
    })

    dispose()
    expect(bridge.removeEventListener).toHaveBeenCalledOnce()
    expect(bridge.unsubscribe).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174000')
  })

  it('fails closed when a capability subscription cannot be established', async () => {
    const bridge = transport(null)
    bridge.subscribe.mockRejectedValue(new Error('subscription unavailable'))
    const client = new RendererCapabilityClient({ getTransport: () => bridge })

    await expect(client.subscribe(
      'res_abcdefghijklmnopqrst',
      vi.fn()
    )).rejects.toThrow('subscription unavailable')
    expect(bridge.removeEventListener).toHaveBeenCalledOnce()
  })

  it('rejects values outside the JSON transport boundary before invoking', async () => {
    const bridge = transport(null)
    const client = new RendererCapabilityClient({ getTransport: () => bridge })
    const contract = {
      actionId: 'example.read',
      effect: 'read' as const,
      inputSchema: z.unknown(),
      outputSchema: z.null()
    }

    await expect(client.invoke(contract, Number.NaN)).rejects.toThrow()
    expect(bridge.readiness).not.toHaveBeenCalled()
    expect(bridge.invoke).not.toHaveBeenCalled()
  })

  it('fails closed when the required action is not ready', async () => {
    const bridge = transport(null)
    bridge.readiness.mockResolvedValue({
      ...READY,
      status: 'incomplete',
      availableCapabilityIds: [],
      missingCapabilityIds: ['example.read'],
      message: 'missing example.read'
    })
    const client = new RendererCapabilityClient({ getTransport: () => bridge })

    await expect(client.invoke({
      actionId: 'example.read',
      effect: 'read',
      inputSchema: z.object({}).strict(),
      outputSchema: z.null()
    }, {})).rejects.toThrow('missing example.read')
    expect(bridge.invoke).not.toHaveBeenCalled()
  })
})
