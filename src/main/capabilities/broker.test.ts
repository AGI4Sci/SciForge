import { createHash } from 'node:crypto'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import {
  capabilityResourceChangeEventSchema,
  type CapabilityAudience,
  type CapabilityCallerContextInput,
  type CapabilityInvocationRequest,
  type CapabilityResourceHandle
} from '../../shared/capability-broker'
import { CapabilityBroker, CapabilityBrokerError } from './broker'
import {
  CapabilityRegistrationError,
  CapabilityRegistry,
  defineCapability,
  type CapabilityDefinition
} from './registry'

const agent: CapabilityCallerContextInput = {
  audience: 'agent',
  callerId: 'agent-1',
  workspaceId: 'workspace-1'
}

const ui: CapabilityCallerContextInput = {
  audience: 'ui',
  callerId: 'window-1',
  workspaceId: 'workspace-1'
}

const principalA: PrincipalSnapshot = {
  authority: 'sciforge.identity-access',
  subject: 'person-a',
  assurance: 'local-selection',
  deviceId: 'installation-1',
  identityVersion: 1
}

const principalB: PrincipalSnapshot = {
  ...principalA,
  subject: 'person-b',
  identityVersion: 2
}

function expectBrokerCode(error: unknown, code: string): boolean {
  expect(error).toBeInstanceOf(CapabilityBrokerError)
  expect((error as CapabilityBrokerError).code).toBe(code)
  return true
}

function readCapability(handler = vi.fn(async (input: { section: string }) => ({
  output: { text: `read:${input.section}` }
}))) {
  return defineCapability({
    id: 'document.read-section',
    version: '1',
    title: 'Read document section',
    description: 'Read a named section from a document resource.',
    audiences: ['ui', 'agent'],
    scope: 'resource',
    resourceKinds: ['document'],
    effect: 'read',
    approval: 'none',
    concurrency: { revision: 'none', idempotency: 'none' },
    inputSchema: z.object({ section: z.string().min(1) }).strict(),
    outputSchema: z.object({ text: z.string() }).strict(),
    handler
  })
}

function mutationCapability(handler = vi.fn(async (input: { text: string }, context) => ({
  output: { saved: input.text },
  changed: true,
  semanticRevision: `${Number(context.resource?.semanticRevision ?? '0') + 1}`
}))) {
  return defineCapability({
    id: 'document.annotation-upsert',
    version: '1',
    title: 'Upsert annotation',
    description: 'Create or update an annotation through the canonical document provider.',
    audiences: ['ui', 'agent'],
    scope: 'resource',
    resourceKinds: ['document'],
    effect: 'workspace-write',
    approval: 'none',
    concurrency: { revision: 'optimistic', idempotency: 'required' },
    inputSchema: z.object({ text: z.string().min(1) }).strict(),
    outputSchema: z.object({ saved: z.string() }).strict(),
    handler
  })
}

function issueDocument(
  broker: CapabilityBroker,
  caller: CapabilityCallerContextInput = agent,
  options: {
    semanticRevision?: string
    expiresInMs?: number
    layoutRevision?: string
    audiences?: CapabilityAudience[]
    dispose?: () => void | Promise<void>
    retireAfterLastHandleExpires?: boolean
  } = {}
): CapabilityResourceHandle {
  const semanticRevision = options.semanticRevision ?? '1'
  return broker.issueResourceHandle(caller, {
    resourceId: 'internal/path/paper.pdf',
    resourceKind: 'document',
    workspaceId: caller.workspaceId,
    audiences: options.audiences,
    semanticRevision,
    layoutRevision: options.layoutRevision,
    expiresInMs: options.expiresInMs,
    dispose: options.dispose,
    retireAfterLastHandleExpires: options.retireAfterLastHandleExpires,
    observe: async () => ({
      state: { title: 'Paper', annotationCount: 0 },
      semanticRevision,
      layoutRevision: 'layout-2',
      operationIds: ['document.read-section', 'document.annotation-upsert']
    })
  })
}

describe('Capability resource change events', () => {
  const baseEvent = {
    id: 'event_abcdefghijklmnopqrstuvwxyz',
    type: 'resource.changed' as const,
    occurredAt: '2026-07-22T00:00:00.000Z',
    resourceRef: 'res_abcdefghijklmnopqrstuvwxyz',
    resourceKind: 'document',
    beforeRevision: '1',
    afterRevision: '2'
  }

  it('requires an explicit origin and accepts both valid event variants', () => {
    expect(capabilityResourceChangeEventSchema.safeParse({
      ...baseEvent,
      actionId: 'document.annotation-upsert',
      invocationId: 'missing-origin'
    }).success).toBe(false)
    expect(capabilityResourceChangeEventSchema.parse({
      ...baseEvent,
      origin: 'capability',
      actionId: 'document.annotation-upsert',
      invocationId: 'capability-invocation'
    })).toMatchObject({ origin: 'capability' })
    expect(capabilityResourceChangeEventSchema.parse({
      ...baseEvent,
      origin: 'provider'
    })).toMatchObject({ origin: 'provider' })
  })

  it('keeps provider and capability causes structurally disjoint', () => {
    expect(capabilityResourceChangeEventSchema.safeParse({
      ...baseEvent,
      origin: 'provider',
      actionId: 'document.annotation-upsert',
      invocationId: 'forged-provider-invocation'
    }).success).toBe(false)
    expect(capabilityResourceChangeEventSchema.safeParse({
      ...baseEvent,
      origin: 'capability'
    }).success).toBe(false)
  })
})

describe('CapabilityRegistry', () => {
  it('atomically binds wire metadata, Zod schemas, and one executable handler', () => {
    const handler = vi.fn(async () => ({ output: { text: 'ok' } }))
    const definition = readCapability(handler)
    const registry = new CapabilityRegistry([definition])

    expect(registry.require('document.read-section').handler).toBe(handler)
    expect(registry.list()).toHaveLength(1)
    expect(registry.list()[0]).toMatchObject({
      id: 'document.read-section',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' }
    })
  })

  it('fails fast for duplicate or incomplete definitions', () => {
    const definition = readCapability()
    const registry = new CapabilityRegistry([definition])
    expect(() => registry.register(definition)).toThrowError(CapabilityRegistrationError)
    expect(() => registry.register(definition)).toThrow(/already registered/)

    const incomplete = { ...definition, handler: undefined } as unknown as CapabilityDefinition
    expect(() => new CapabilityRegistry([incomplete])).toThrow(/exactly one handler/)
    expect(() => defineCapability({
      ...definition.descriptor,
      inputSchema: z.function(),
      outputSchema: z.object({ ok: z.boolean() }),
      handler: async () => ({ output: { ok: true } })
    })).toThrow(/cannot be represented as JSON Schema/)
  })

  it('rejects unsafe audience, effect, approval, scope, and concurrency combinations', () => {
    expect(() => defineCapability({
      id: 'desktop.delete-everything',
      version: '1',
      title: 'Delete everything',
      description: 'Unsafe test action.',
      audiences: ['agent'],
      scope: 'global',
      effect: 'destructive',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    })).toThrow(/require approval/)

    expect(() => defineCapability({
      id: 'workspace.bad-revision',
      version: '1',
      title: 'Bad revision action',
      description: 'Invalid non-resource optimistic action.',
      audiences: ['ui'],
      scope: 'workspace',
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    })).toThrow(/Optimistic revisions require resource scope/)

    expect(() => defineCapability({
      id: 'identity.unsafe-transition',
      version: '1',
      title: 'Unsafe Principal transition',
      description: 'Attempts to expose a Principal transition outside trusted UI.',
      audiences: ['agent'],
      scope: 'workspace',
      effect: 'external-write',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      principalTransition: 'host-authority',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    })).toThrow(/Principal transitions/)

    const delegatedBase = {
      id: 'content.delegated-batch-operation',
      version: '1',
      title: 'Delegated batch operation',
      description: 'Exercises the finite Human-confirmed batch descriptor constraints.',
      audiences: ['agent', 'system'] as CapabilityAudience[],
      scope: 'global' as const,
      effect: 'external-write' as const,
      approval: 'confirmation' as const,
      delegatedBatchGrant: 'content.provisioning-batch',
      concurrency: { revision: 'none' as const, idempotency: 'required' as const },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    }
    expect(() => defineCapability({ ...delegatedBase, audiences: ['agent'] }))
      .toThrow(/system audience/iu)
    expect(() => defineCapability({ ...delegatedBase, approval: 'system' }))
      .toThrow(/cannot delegate system approval/iu)
    expect(() => defineCapability({
      ...delegatedBase,
      audiences: ['ui', 'system'],
      principalTransition: 'host-authority'
    })).toThrow(/cannot delegate Host Principal transitions/iu)
  })

  it('allows approval-free Agent writes only under explicit resource authority', async () => {
    const write = defineCapability({
      id: 'external.resource-authorized-write',
      version: '1',
      title: 'Write an authorized external resource',
      description: 'Exercises a bounded resource-authorized Agent write.',
      audiences: ['agent'],
      scope: 'resource',
      resourceKinds: ['document'],
      effect: 'external-write',
      approval: 'none',
      autonomousWrite: 'resource-authorized',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ written: z.literal(true) }).strict(),
      handler: async () => ({ output: { written: true as const }, changed: false })
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([write]))
    const resource = issueDocument(broker)

    await expect(broker.invoke(agent, {
      actionId: write.descriptor.id,
      invocationId: 'resource-authorized-write-1',
      resource,
      input: {}
    })).resolves.toMatchObject({
      output: { written: true },
      changed: false,
      beforeRevision: '1',
      afterRevision: '1'
    })

    const remove = defineCapability({
      id: 'external.resource-authorized-remove',
      version: '1',
      title: 'Remove from an authorized external resource',
      description: 'Exercises a bounded resource-authorized destructive Agent write.',
      audiences: ['agent'],
      scope: 'resource',
      resourceKinds: ['document'],
      effect: 'destructive',
      approval: 'none',
      autonomousWrite: 'resource-authorized',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ removed: z.literal(true) }).strict(),
      handler: async () => ({ output: { removed: true as const }, changed: false })
    })
    broker.registry.register(remove)
    await expect(broker.invoke(agent, {
      actionId: remove.descriptor.id,
      invocationId: 'resource-authorized-remove-1',
      resource,
      input: {}
    })).resolves.toMatchObject({ output: { removed: true }, changed: false })

    const invalidBase = {
      id: 'external.invalid-autonomous-write',
      version: '1',
      title: 'Invalid autonomous write',
      description: 'Must not broaden autonomous writes beyond one Broker resource.',
      audiences: ['agent'] as CapabilityAudience[],
      effect: 'external-write' as const,
      approval: 'none' as const,
      autonomousWrite: 'resource-authorized' as const,
      concurrency: { revision: 'none' as const, idempotency: 'required' as const },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ written: z.literal(true) }).strict(),
      handler: async () => ({ output: { written: true as const } })
    }
    expect(() => defineCapability({ ...invalidBase, scope: 'global' }))
      .toThrow(/resource-scoped/iu)
    expect(() => defineCapability({
      ...invalidBase,
      scope: 'global',
      effect: 'destructive'
    })).toThrow(/resource-scoped/iu)
  })

  it('projects only the exact Broker-resolved input resource into the active Host lease', async () => {
    let broker!: CapabilityBroker
    let activeLease: ReturnType<CapabilityBroker['currentInvocation']>
    const write = defineCapability({
      id: 'external.host-resource-lease',
      version: '1',
      title: 'Project the authorized resource lease',
      description: 'Exposes the Host-private active lease only during exact resource dispatch.',
      audiences: ['agent'],
      scope: 'resource',
      resourceKinds: ['document'],
      effect: 'external-write',
      approval: 'none',
      autonomousWrite: 'resource-authorized',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ written: z.literal(true) }).strict(),
      handler: async () => {
        activeLease = broker.currentInvocation()
        return { output: { written: true as const }, changed: false }
      }
    })
    broker = new CapabilityBroker(new CapabilityRegistry([write]))
    const resource = issueDocument(broker, agent, { semanticRevision: 'lease-revision-1' })

    await broker.invoke(agent, {
      actionId: write.descriptor.id,
      invocationId: 'host-resource-lease-1',
      resource,
      input: {}
    })

    expect(activeLease).toMatchObject({
      actionId: write.descriptor.id,
      invocationId: 'host-resource-lease-1',
      effect: 'external-write',
      approval: 'none',
      approved: true,
      scope: 'resource',
      autonomousWrite: 'resource-authorized',
      authorizedResource: {
        resourceRef: expect.stringMatching(/^res_/u),
        resourceKind: 'document',
        workspaceId: agent.workspaceId,
        semanticRevision: 'lease-revision-1'
      }
    })
    expect(Object.isFrozen(activeLease?.authorizedResource)).toBe(true)
    expect(broker.currentInvocation()).toBeUndefined()
  })

  it('enforces each Host Principal transition descriptor constraint independently', () => {
    const base = {
      id: 'identity.transition-constraint',
      version: '1',
      title: 'Principal transition constraint',
      description: 'Exercises one Host Principal transition descriptor constraint.',
      audiences: ['ui'] as CapabilityAudience[],
      scope: 'global' as const,
      effect: 'external-write' as const,
      approval: 'none' as const,
      concurrency: { revision: 'none' as const, idempotency: 'required' as const },
      principalTransition: 'host-authority' as const,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    }

    expect(() => defineCapability({ ...base, audiences: ['agent'] }))
      .toThrow(/Principal transitions/)
    expect(() => defineCapability({ ...base, scope: 'workspace' }))
      .toThrow(/Principal transitions/)
    expect(() => defineCapability({
      ...base,
      effect: 'read',
      concurrency: { revision: 'none', idempotency: 'none' }
    })).toThrow(/Principal transitions/)
    expect(() => defineCapability({
      ...base,
      producedResourceKinds: ['identity-resource']
    })).toThrow(/Principal transitions/)
  })

  it('discovers by exact ID and ranked unordered tokens with independent bounded filters', () => {
    const uiOnly = defineCapability({
      id: 'document.human-review',
      version: '1',
      title: 'Human review',
      description: 'A UI-only human review decision.',
      audiences: ['ui'],
      scope: 'resource',
      resourceKinds: ['document'],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ready: z.boolean() }).strict(),
      handler: async () => ({ output: { ready: true } })
    })
    const openPreview = defineCapability({
      id: 'workspace-preview.open',
      version: '1',
      title: 'Open Workspace Preview',
      description: 'Open a workspace file through the canonical preview provider.',
      audiences: ['ui', 'agent'],
      scope: 'workspace',
      producedResourceKinds: ['workspace-preview'],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['workspace', 'preview', 'open'],
      inputSchema: z.object({ path: z.string() }).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ output: { ok: true } })
    })
    const registry = new CapabilityRegistry([readCapability(), uiOnly, openPreview])

    expect(registry.discover(agent, { acceptedResourceKind: 'document' }).map((item) => item.id))
      .toEqual(['document.read-section'])
    expect(registry.discover(ui, { acceptedResourceKind: 'document' }).map((item) => item.id))
      .toEqual(['document.human-review', 'document.read-section'])
    expect(registry.discover(agent, {
      capabilityId: 'workspace-preview.open',
      text: 'words that do not match'
    }).map((item) => item.id)).toEqual(['workspace-preview.open'])
    expect(registry.discover(agent, {
      text: 'file preview workspace open'
    }).map((item) => item.id)).toEqual(['workspace-preview.open'])
    expect(registry.discover(agent, {
      text: 'open workspace file image png view'
    }).map((item) => item.id)).toEqual(['workspace-preview.open'])
    expect(registry.discover(agent, {
      text: 'image png view'
    })).toEqual([])
    expect(registry.discover(agent, {
      scope: 'workspace',
      producedResourceKind: 'workspace-preview'
    }).map((item) => item.id)).toEqual(['workspace-preview.open'])
    expect(registry.discover(agent, {
      providerFamily: 'managed-mcp'
    })).toEqual([])
    expect(registry.discover(ui, { limit: 1 })).toHaveLength(1)
  })
})

describe('CapabilityBroker', () => {
  it('injects only Host Principal authority and scopes idempotency to its exact lease', async () => {
    let currentPrincipal: PrincipalSnapshot | null = principalA
    const handler = vi.fn(async (_input: Record<string, never>, context) => ({
      output: {
        subject: context.caller.principal?.subject ?? 'anonymous',
        invocationId: context.invocationId ?? 'missing'
      }
    }))
    const capability = defineCapability({
      id: 'principal.verify-write',
      version: '1',
      title: 'Verify Principal write',
      description: 'Verifies trusted Principal attribution and invocation identity.',
      audiences: ['ui'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ subject: z.string(), invocationId: z.string() }).strict(),
      handler
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([capability]), {
      resolveCurrentPrincipal: () => currentPrincipal
    })
    const request = {
      actionId: 'principal.verify-write',
      invocationId: 'same-invocation',
      input: {}
    }

    expect(() => broker.discover({
      ...ui,
      principal: principalB
    } as never)).toThrow(expect.objectContaining({ code: 'invalid_caller' }))

    await expect(broker.invoke(ui, request)).resolves.toMatchObject({
      output: { subject: 'person-a', invocationId: 'same-invocation' },
      replayed: false
    })
    currentPrincipal = principalB
    await expect(broker.invoke(ui, request)).resolves.toMatchObject({
      output: { subject: 'person-b', invocationId: 'same-invocation' },
      replayed: false
    })
    currentPrincipal = principalA
    await expect(broker.invoke(ui, request)).resolves.toMatchObject({ replayed: true })
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('scopes ordinary idempotency to the canonical workspace locator', async () => {
    const handler = vi.fn(async (_input: Record<string, never>, context) => ({
      output: { hostSessionId: context.caller.workspaceLocator?.hostSessionId ?? 'local' }
    }))
    const capability = defineCapability({
      id: 'workspace-locator.verify-write',
      version: '1',
      title: 'Verify workspace locator write',
      description: 'Keeps remote workspace placements in the idempotency scope.',
      audiences: ['agent'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ hostSessionId: z.string() }).strict(),
      handler
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([capability]))
    const request = {
      actionId: capability.descriptor.id,
      invocationId: 'same-workspace-id-different-locator',
      input: {}
    }
    const remoteCaller = (hostSessionId: string): CapabilityCallerContextInput => ({
      ...agent,
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId,
        path: '/remote/workspace'
      }
    })

    await expect(broker.invoke(remoteCaller('host-session-1'), request))
      .resolves.toMatchObject({ output: { hostSessionId: 'host-session-1' }, replayed: false })
    await expect(broker.invoke(remoteCaller('host-session-2'), request))
      .resolves.toMatchObject({ output: { hostSessionId: 'host-session-2' }, replayed: false })
    await expect(broker.invoke(remoteCaller('host-session-1'), request))
      .resolves.toMatchObject({ output: { hostSessionId: 'host-session-1' }, replayed: true })
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('reports outcome_unknown when Principal changes while awaiting a settled mutation replay', async () => {
    let currentPrincipal: PrincipalSnapshot | null = principalA
    const handler = vi.fn(async () => ({ output: { ok: true as const }, changed: false }))
    const publish = defineCapability({
      id: 'external.replay-principal-barrier',
      version: '1',
      title: 'Publish replay barrier',
      description: 'Exercises final Principal validation for a settled mutation replay.',
      audiences: ['ui'],
      scope: 'global',
      effect: 'external-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      handler
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([publish]), {
      resolveCurrentPrincipal: () => currentPrincipal
    })
    const request = {
      actionId: publish.descriptor.id,
      invocationId: 'settled-mutation-replay-principal-switch',
      input: {}
    }
    await expect(broker.invoke(ui, request)).resolves.toMatchObject({ replayed: false })

    const replay = broker.invoke(ui, request)
    currentPrincipal = principalB
    await expect(replay)
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'outcome_unknown'))
    expect(handler).toHaveBeenCalledOnce()
  })

  it('atomically issues handle and resource reference under one Principal-bound resource', async () => {
    let currentPrincipal: PrincipalSnapshot | null = principalA
    const dispose = vi.fn(async () => undefined)
    const broker = new CapabilityBroker(new CapabilityRegistry([readCapability()]), {
      resolveCurrentPrincipal: () => currentPrincipal
    })
    const issued = broker.issueResource(ui, {
      resourceId: 'principal-owned-document',
      resourceKind: 'document',
      workspaceId: ui.workspaceId,
      audiences: ['ui', 'agent'],
      semanticRevision: '1',
      observe: async () => ({
        state: { title: 'Principal document' },
        semanticRevision: '1',
        operationIds: ['document.read-section']
      }),
      dispose
    })

    await expect(broker.observe(ui, { resource: issued.resource })).resolves.toMatchObject({
      resourceRef: issued.resourceRef,
      semanticRevision: '1'
    })
    currentPrincipal = principalB
    await expect(broker.observe(ui, { resource: issued.resource }))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'resource_scope_mismatch'))
    expect(() => broker.bindResourceRef(ui, issued.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_scope_mismatch' }))
    expect(() => broker.describeResourceRef(ui, issued.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_scope_mismatch' }))
    currentPrincipal = principalA
    expect(broker.bindResourceRef(agent, issued.resourceRef)).toMatchObject({
      semanticRevision: '1'
    })
    await issued.retire({ deferWhileRetained: false })
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(() => broker.describeResourceRef(ui, issued.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
  })

  it('projects an authorized handle to its opaque reference without observing provider state', () => {
    const observe = vi.fn(async () => ({ state: { title: 'Paper' }, semanticRevision: '1' }))
    const broker = new CapabilityBroker(new CapabilityRegistry())
    const issued = broker.issueResource(agent, {
      resourceId: 'local-handle-projection',
      resourceKind: 'document',
      workspaceId: agent.workspaceId,
      audiences: ['agent'],
      semanticRevision: '1',
      observe
    })

    expect(broker.describeResourceHandle(agent, issued.resource)).toEqual({
      resourceRef: issued.resourceRef
    })
    expect(observe).not.toHaveBeenCalled()
    expect(() => broker.describeResourceHandle(
      { ...agent, workspaceId: 'workspace-2' },
      issued.resource
    )).toThrow(expect.objectContaining({ code: 'resource_scope_mismatch' }))
    expect(() => broker.describeResourceHandle(agent, {
      ...issued.resource,
      token: `cap_${'f'.repeat(32)}`
    })).toThrow(expect.objectContaining({ code: 'invalid_resource_handle' }))
    expect(observe).not.toHaveBeenCalled()
  })

  it('gives long-running handlers a Host-only live Principal reauthorization closure', async () => {
    let currentPrincipal: PrincipalSnapshot | null = principalA
    let release: (() => void) | undefined
    let started: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const handlerStarted = new Promise<void>((resolve) => { started = resolve })
    const capability = defineCapability({
      id: 'principal.long-operation',
      version: '1',
      title: 'Long Principal operation',
      description: 'Reauthorizes after a provider operation.',
      audiences: ['ui'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      handler: async (_input, context) => {
        started?.()
        await gate
        context.assertPrincipalCurrent()
        return { output: { ok: true as const } }
      }
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([capability]), {
      resolveCurrentPrincipal: () => currentPrincipal
    })

    const invocation = broker.invoke(ui, {
      actionId: capability.descriptor.id,
      invocationId: 'principal-long-operation',
      input: {}
    })
    await handlerStarted
    currentPrincipal = principalB
    release?.()

    await expect(invocation)
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'principal_changed'))
  })

  it('revalidates the Principal after observation cleanup yields and before delivering state', async () => {
    let currentPrincipal: PrincipalSnapshot | null = principalA
    let principalReads = 0
    let scheduleSwitch = false
    const broker = new CapabilityBroker(new CapabilityRegistry(), {
      resolveCurrentPrincipal: () => {
        principalReads += 1
        if (scheduleSwitch && principalReads === 3) {
          queueMicrotask(() => { currentPrincipal = principalB })
        }
        return currentPrincipal
      }
    })
    const issued = broker.issueResource(ui, {
      resourceId: 'principal-observation-delivery-barrier',
      resourceKind: 'document',
      workspaceId: ui.workspaceId,
      semanticRevision: '1',
      observe: async () => ({
        state: { title: 'Principal A state must not reach B' },
        semanticRevision: '1'
      })
    })
    principalReads = 0
    scheduleSwitch = true

    await expect(broker.observe(ui, { resource: issued.resource }))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'principal_changed'))
    expect(currentPrincipal).toEqual(principalB)
  })

  it('revalidates the Principal after invocation cleanup and never redispatches a committed retirement', async () => {
    let currentPrincipal: PrincipalSnapshot | null = principalA
    let releaseDispose: (() => void) | undefined
    let markDisposeStarted: (() => void) | undefined
    const disposeGate = new Promise<void>((resolve) => { releaseDispose = resolve })
    const disposeStarted = new Promise<void>((resolve) => { markDisposeStarted = resolve })
    const dispose = vi.fn(async () => {
      markDisposeStarted?.()
      await disposeGate
    })
    const createdDispose = vi.fn(async () => undefined)
    let issuedDuringHandler: CapabilityResourceHandle | undefined
    const handler = vi.fn(async (_input: Record<string, never>, context) => {
      issuedDuringHandler = context.issueResource({
        resourceId: 'principal-delivery-undisclosed-resource',
        resourceKind: 'transactional-resource',
        workspaceId: context.caller.workspaceId,
        semanticRevision: '1',
        observe: async () => ({ state: {}, semanticRevision: '1' }),
        dispose: createdDispose
      })
      return {
        output: { retired: true as const },
        changed: false,
        retireResource: true as const
      }
    })
    const retire = defineCapability({
      id: 'principal.retire-at-delivery-barrier',
      version: '1',
      title: 'Retire at Principal delivery barrier',
      description: 'Commits retirement while final delivery remains Principal-bound.',
      audiences: ['ui'],
      scope: 'resource',
      resourceKinds: ['document'],
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ retired: z.literal(true) }).strict(),
      handler
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([retire]), {
      resolveCurrentPrincipal: () => currentPrincipal
    })
    const issued = broker.issueResource(ui, {
      resourceId: 'principal-invocation-delivery-barrier',
      resourceKind: 'document',
      workspaceId: ui.workspaceId,
      semanticRevision: '1',
      observe: async () => ({ state: {}, semanticRevision: '1' }),
      dispose
    })
    const request = {
      actionId: retire.descriptor.id,
      invocationId: 'principal-retire-delivery-barrier-1',
      resource: issued.resource,
      input: {}
    }

    const invocation = broker.invoke(ui, request)
    await disposeStarted
    currentPrincipal = principalB
    releaseDispose?.()
    await expect(invocation)
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'outcome_unknown'))

    currentPrincipal = principalA
    await expect(broker.observe(ui, { resource: issuedDuringHandler! }))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'invalid_resource_handle'))
    await expect(broker.invoke(ui, request))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'invalid_resource_handle'))
    expect(handler).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(createdDispose).toHaveBeenCalledOnce()
  })

  it('fails closed after an unnoticed Principal switch but preserves an acknowledged typed unknown', async () => {
    let currentPrincipal: PrincipalSnapshot | null = principalA
    let releaseForgotten: (() => void) | undefined
    let startedForgotten: (() => void) | undefined
    const forgottenGate = new Promise<void>((resolve) => { releaseForgotten = resolve })
    const forgottenStarted = new Promise<void>((resolve) => { startedForgotten = resolve })
    const forgotReauthorization = defineCapability({
      id: 'principal.forgot-reauthorization',
      version: '1',
      title: 'Forgot Principal reauthorization',
      description: 'Returns after a long operation without checking the live Principal.',
      audiences: ['ui'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ outcome: z.literal('success') }).strict(),
      handler: async () => {
        startedForgotten?.()
        await forgottenGate
        return { output: { outcome: 'success' as const } }
      }
    })
    const broker = new CapabilityBroker(
      new CapabilityRegistry([forgotReauthorization]),
      { resolveCurrentPrincipal: () => currentPrincipal }
    )
    const forgotten = broker.invoke(ui, {
      actionId: forgotReauthorization.descriptor.id,
      invocationId: 'forgotten-principal-check',
      input: {}
    })
    await forgottenStarted
    currentPrincipal = principalB
    releaseForgotten?.()
    await expect(forgotten)
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'principal_changed'))

    currentPrincipal = principalA
    let releaseAcknowledged: (() => void) | undefined
    let startedAcknowledged: (() => void) | undefined
    const acknowledgedGate = new Promise<void>((resolve) => { releaseAcknowledged = resolve })
    const acknowledgedStarted = new Promise<void>((resolve) => { startedAcknowledged = resolve })
    const acknowledgeUnknown = defineCapability({
      id: 'principal.acknowledge-unknown',
      version: '1',
      title: 'Acknowledge unknown result',
      description: 'Maps a post-dispatch Principal switch to a typed unknown result.',
      audiences: ['ui'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ outcome: z.literal('outcome_unknown') }).strict(),
      handler: async (_input, context) => {
        startedAcknowledged?.()
        await acknowledgedGate
        try {
          context.assertPrincipalCurrent()
        } catch (error) {
          if (!(error instanceof CapabilityBrokerError) || error.code !== 'principal_changed') {
            throw error
          }
          return { output: { outcome: 'outcome_unknown' as const }, changed: false }
        }
        throw new Error('Expected the Principal lease to change.')
      }
    })
    broker.registry.register(acknowledgeUnknown)
    const acknowledged = broker.invoke(ui, {
      actionId: acknowledgeUnknown.descriptor.id,
      invocationId: 'acknowledged-principal-check',
      input: {}
    })
    await acknowledgedStarted
    currentPrincipal = principalB
    releaseAcknowledged?.()
    await expect(acknowledged).resolves.toMatchObject({
      output: { outcome: 'outcome_unknown' },
      changed: false
    })
  })

  it('allows declared Host Principal transitions and replays them exactly once across leases', async () => {
    let currentPrincipal: PrincipalSnapshot | null = null
    let principalContextVersion = 0
    const handler = vi.fn(async (
      input: { target: 'a' | 'b' | 'none' },
      context: { assertPrincipalCurrent(): void }
    ) => {
      currentPrincipal = input.target === 'none'
        ? null
        : input.target === 'a'
          ? principalA
          : principalB
      principalContextVersion = currentPrincipal?.identityVersion ?? principalContextVersion + 1
      try {
        context.assertPrincipalCurrent()
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 'principal_changed'
        ) throw error
      }
      return { output: { subject: currentPrincipal?.subject ?? null } }
    })
    const transition = defineCapability({
      id: 'identity.transition-principal',
      version: '1',
      title: 'Transition Host Principal',
      description: 'Changes the current Host Principal through trusted UI.',
      audiences: ['ui'],
      scope: 'global',
      effect: 'external-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      principalTransition: 'host-authority',
      inputSchema: z.object({ target: z.enum(['a', 'b', 'none']) }).strict(),
      outputSchema: z.object({ subject: z.string().nullable() }).strict(),
      handler
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([transition]), {
      resolveCurrentPrincipalContext: () => ({
        identityVersion: principalContextVersion,
        principal: currentPrincipal
      })
    })

    const created = await broker.invoke(ui, {
      actionId: transition.descriptor.id,
      invocationId: 'principal-transition-create',
      input: { target: 'a' }
    })
    expect(created).toMatchObject({ output: { subject: 'person-a' }, replayed: false })
    expect(currentPrincipal).toEqual(principalA)

    await expect(broker.invoke(ui, {
      actionId: transition.descriptor.id,
      invocationId: 'principal-transition-create',
      input: { target: 'a' }
    })).resolves.toMatchObject({ output: { subject: 'person-a' }, replayed: true })
    await expect(broker.invoke({
      ...ui,
      workspaceId: 'other-workspace',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'other-host-session',
        path: '/other-workspace'
      }
    }, {
      actionId: transition.descriptor.id,
      invocationId: 'principal-transition-create',
      input: { target: 'a' }
    })).resolves.toMatchObject({ output: { subject: 'person-a' }, replayed: true })
    expect(handler).toHaveBeenCalledTimes(1)
    await expect(broker.invoke(ui, {
      actionId: transition.descriptor.id,
      invocationId: 'principal-transition-create',
      input: { target: 'b' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'idempotency_conflict'))

    await expect(broker.invoke(ui, {
      actionId: transition.descriptor.id,
      invocationId: 'principal-transition-select',
      input: { target: 'b' }
    })).resolves.toMatchObject({ output: { subject: 'person-b' } })
    expect(currentPrincipal).toEqual(principalB)
    await expect(broker.invoke(ui, {
      actionId: transition.descriptor.id,
      invocationId: 'principal-transition-create',
      input: { target: 'a' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'idempotency_post_state_mismatch'))
    await expect(broker.invoke(ui, {
      actionId: transition.descriptor.id,
      invocationId: 'principal-transition-exit',
      input: { target: 'none' }
    })).resolves.toMatchObject({ output: { subject: null } })
    expect(currentPrincipal).toBeNull()
    expect(handler).toHaveBeenCalledTimes(3)

    await expect(broker.invoke(ui, {
      actionId: transition.descriptor.id,
      invocationId: 'principal-transition-exit',
      input: { target: 'none' }
    })).resolves.toMatchObject({ output: { subject: null }, replayed: true })
    principalContextVersion += 1
    await expect(broker.invoke(ui, {
      actionId: transition.descriptor.id,
      invocationId: 'principal-transition-exit',
      input: { target: 'none' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'idempotency_post_state_mismatch'))
    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('rejects rebinding one live resource identity to different provider callbacks', () => {
    const broker = new CapabilityBroker(new CapabilityRegistry([readCapability()]))
    const subscribeChanges = () => () => undefined
    const registration = {
      resourceId: 'stable-document',
      resourceKind: 'document',
      semanticRevision: '1',
      subscribeChanges,
      observe: async () => ({
        state: { title: 'Stable document' },
        semanticRevision: '1'
      })
    }
    const issued = broker.issueResource(ui, registration)

    expect(() => broker.issueResource(ui, {
      ...registration,
      observe: async () => ({
        state: { title: 'Forged replacement' },
        semanticRevision: '1'
      })
    })).toThrow(expect.objectContaining({ code: 'resource_registration_conflict' }))
    expect(() => broker.issueResource(ui, {
      ...registration,
      subscribeChanges: () => () => undefined
    })).toThrow(expect.objectContaining({ code: 'resource_registration_conflict' }))
    expect(broker.describeResourceRef(ui, issued.resourceRef)).toMatchObject({
      resourceId: 'stable-document',
      semanticRevision: '1'
    })
  })

  it('publishes validated provider changes and refreshes stale handles without weakening optimistic revisions', async () => {
    let currentRevision = '1'
    let notify: ((change: { semanticRevision: string; layoutRevision?: string }) => void) | undefined
    const unsubscribeProvider = vi.fn()
    const cleanupErrors: unknown[] = []
    const subscribeChanges = vi.fn((
      listener: (change: { semanticRevision: string; layoutRevision?: string }) => void
    ) => {
      notify = listener
      currentRevision = '2'
      listener({ semanticRevision: currentRevision, layoutRevision: 'layout-2' })
      return unsubscribeProvider
    })
    const dispose = vi.fn(async () => undefined)
    const broker = new CapabilityBroker(
      new CapabilityRegistry([mutationCapability()]),
      { reportCleanupError: (error) => cleanupErrors.push(error) }
    )
    const registration = {
      resourceId: 'provider-push-document',
      resourceKind: 'document',
      semanticRevision: '1',
      subscribeChanges,
      observe: async () => ({
        state: { revision: currentRevision },
        semanticRevision: currentRevision
      }),
      dispose
    }
    const issued = broker.issueResource(agent, registration)
    const repeated = broker.issueResource(agent, {
      ...registration,
      semanticRevision: currentRevision,
      layoutRevision: 'layout-2'
    })

    expect(subscribeChanges).toHaveBeenCalledOnce()
    expect(repeated.resourceRef).toBe(issued.resourceRef)
    expect(issued.resource.semanticRevision).toBe('2')
    expect(broker.describeResourceRef(agent, issued.resourceRef)).toMatchObject({
      semanticRevision: '2',
      layoutRevision: 'layout-2'
    })
    expect(broker.listEvents(agent)).toHaveLength(1)
    expect(broker.listEvents(agent)[0]).toMatchObject({
      origin: 'provider',
      beforeRevision: '1',
      afterRevision: '2'
    })
    expect(broker.listEvents(agent)[0]).not.toHaveProperty('actionId')
    expect(broker.listEvents(agent)[0]).not.toHaveProperty('invocationId')

    notify?.({ semanticRevision: '2' })
    ;(notify as ((change: unknown) => void) | undefined)?.({ semanticRevision: ' ' })
    expect(broker.listEvents(agent)).toHaveLength(1)
    expect(cleanupErrors).toHaveLength(1)

    currentRevision = '3'
    notify?.({ semanticRevision: currentRevision })
    expect(broker.listEvents(agent)).toHaveLength(2)
    await expect(broker.invoke(agent, {
      actionId: 'document.annotation-upsert',
      invocationId: 'stale-after-provider-change',
      resource: issued.resource,
      expectedRevision: '2',
      input: { text: 'must not commit' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'revision_conflict'))
    await expect(broker.observe(agent, { resource: issued.resource })).resolves.toMatchObject({
      semanticRevision: '3',
      resource: { semanticRevision: '3' },
      state: { revision: '3' }
    })

    await issued.retire({ deferWhileRetained: false })
    expect(unsubscribeProvider).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    notify?.({ semanticRevision: '4' })
    expect(broker.listEvents(agent)).toHaveLength(2)
  })

  it('continues resource retirement when provider change unsubscribe throws', async () => {
    const cleanupErrors: unknown[] = []
    const dispose = vi.fn(async () => undefined)
    const unsubscribeProvider = vi.fn(() => {
      throw new Error('unsubscribe failed')
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([]), {
      reportCleanupError: (error) => cleanupErrors.push(error)
    })
    const issued = broker.issueResource(agent, {
      resourceId: 'throwing-provider-unsubscribe',
      resourceKind: 'document',
      semanticRevision: '1',
      subscribeChanges: () => unsubscribeProvider,
      observe: async () => ({ state: {}, semanticRevision: '1' }),
      dispose
    })

    await expect(issued.retire({ deferWhileRetained: false })).resolves.toBeUndefined()
    expect(unsubscribeProvider).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(cleanupErrors).toEqual([expect.objectContaining({ message: 'unsubscribe failed' })])
    expect(() => broker.describeResourceRef(agent, issued.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
  })

  it('retries a failed provider change subscription on the next identical issue', async () => {
    let revision = '1'
    let notify: ((change: { semanticRevision: string }) => void) | undefined
    const unsubscribeProvider = vi.fn()
    const cleanupErrors: unknown[] = []
    const subscribeChanges = vi.fn((listener: (change: { semanticRevision: string }) => void) => {
      if (subscribeChanges.mock.calls.length === 1) {
        listener({ semanticRevision: 'discarded-before-subscribe-returned' })
        throw new Error('subscription unavailable')
      }
      notify = listener
      return unsubscribeProvider
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([]), {
      reportCleanupError: (error) => cleanupErrors.push(error)
    })
    const registration = {
      resourceId: 'retry-provider-subscription',
      resourceKind: 'document',
      semanticRevision: revision,
      subscribeChanges,
      observe: async () => ({ state: { revision }, semanticRevision: revision })
    }

    const first = broker.issueResource(agent, registration)
    expect(subscribeChanges).toHaveBeenCalledOnce()
    expect(broker.listEvents(agent)).toEqual([])
    const second = broker.issueResource(agent, registration)
    const third = broker.issueResource(agent, registration)
    expect(second.resourceRef).toBe(first.resourceRef)
    expect(third.resourceRef).toBe(first.resourceRef)
    expect(subscribeChanges).toHaveBeenCalledTimes(2)
    expect(cleanupErrors).toEqual([expect.objectContaining({ message: 'subscription unavailable' })])

    revision = '2'
    notify?.({ semanticRevision: revision })
    expect(broker.listEvents(agent)).toHaveLength(1)
    await first.retire({ deferWhileRetained: false })
    expect(unsubscribeProvider).toHaveBeenCalledOnce()
  })

  it('does not deliver provider changes after the live Principal lease changes', () => {
    let currentPrincipal: PrincipalSnapshot | null = principalA
    let notify: ((change: { semanticRevision: string }) => void) | undefined
    const broker = new CapabilityBroker(new CapabilityRegistry([]), {
      resolveCurrentPrincipal: () => currentPrincipal
    })
    const issued = broker.issueResource(ui, {
      resourceId: 'principal-provider-change',
      resourceKind: 'document',
      semanticRevision: '1',
      subscribeChanges: (listener) => {
        notify = listener
        return () => undefined
      },
      observe: async () => ({ state: {}, semanticRevision: '1' })
    })
    const delivered: unknown[] = []
    const unsubscribe = broker.subscribe(ui, (event) => delivered.push(event))

    currentPrincipal = principalB
    notify?.({ semanticRevision: '2' })
    expect(delivered).toEqual([])
    expect(broker.listEvents(ui, { resourceRef: issued.resourceRef, limit: 50 })).toEqual([])
    unsubscribe()
  })

  it('keeps provider state events and the final capability attribution as distinct changes', async () => {
    let revision = '1'
    let notify: ((change: { semanticRevision: string }) => void) | undefined
    const handler = vi.fn(async (input: { text: string }) => {
      revision = '2'
      notify?.({ semanticRevision: revision })
      return {
        output: { saved: input.text },
        changed: true,
        semanticRevision: revision
      }
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([mutationCapability(handler)]))
    const issued = broker.issueResource(agent, {
      resourceId: 'provider-change-during-capability',
      resourceKind: 'document',
      semanticRevision: revision,
      subscribeChanges: (listener) => {
        notify = listener
        return () => undefined
      },
      observe: async () => ({ state: { revision }, semanticRevision: revision })
    })

    await expect(broker.invoke(agent, {
      actionId: 'document.annotation-upsert',
      invocationId: 'provider-change-during-capability',
      resource: issued.resource,
      expectedRevision: '1',
      input: { text: 'commit once' }
    })).resolves.toMatchObject({ changed: true, afterRevision: '2' })
    expect(broker.listEvents(agent).map((event) => event.origin)).toEqual([
      'provider',
      'capability'
    ])
    expect(broker.listEvents(agent)[1]).toMatchObject({
      actionId: 'document.annotation-upsert',
      invocationId: 'provider-change-during-capability',
      beforeRevision: '1',
      afterRevision: '2'
    })
  })

  it('rejects handle issue and bind while provider retirement is in flight', async () => {
    let releaseDispose: (() => void) | undefined
    const disposeGate = new Promise<void>((resolve) => { releaseDispose = resolve })
    const observe = async () => ({ state: {}, semanticRevision: '1' })
    const dispose = vi.fn(() => disposeGate)
    const registration = {
      resourceId: 'retiring-document',
      resourceKind: 'document',
      semanticRevision: '1',
      observe,
      dispose
    }
    const broker = new CapabilityBroker(new CapabilityRegistry())
    const issued = broker.issueResource(ui, registration)
    const retirement = issued.retire({ deferWhileRetained: false })

    expect(() => broker.bindResourceRef(ui, issued.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_retiring' }))
    expect(() => broker.issueResource(ui, registration))
      .toThrow(expect.objectContaining({ code: 'resource_retiring' }))
    expect(() => broker.describeResourceRef(ui, issued.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_retiring' }))
    await expect(broker.observe(ui, { resource: issued.resource }))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'resource_retiring'))
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1))

    releaseDispose?.()
    await retirement
    expect(() => broker.describeResourceRef(ui, issued.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
  })

  it('blocks new resource use but waits for an active provider invocation before disposal', async () => {
    let releaseHandler: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const handlerGate = new Promise<void>((resolve) => { releaseHandler = resolve })
    const handlerStarted = new Promise<void>((resolve) => { markStarted = resolve })
    const handler = vi.fn(async (input: { section: string }) => {
      markStarted?.()
      await handlerGate
      return { output: { text: `read:${input.section}` } }
    })
    const dispose = vi.fn(async () => undefined)
    const broker = new CapabilityBroker(new CapabilityRegistry([readCapability(handler)]))
    const issued = broker.issueResource(agent, {
      resourceId: 'active-provider-invocation',
      resourceKind: 'document',
      workspaceId: agent.workspaceId,
      semanticRevision: '1',
      dispose,
      observe: async () => ({ state: {}, semanticRevision: '1' })
    })
    const invocation = broker.invoke(agent, {
      actionId: 'document.read-section',
      resource: issued.resource,
      input: { section: 'methods' }
    })
    await handlerStarted

    const retirement = issued.retire({ deferWhileRetained: false })
    expect(dispose).not.toHaveBeenCalled()
    await expect(broker.observe(agent, { resource: issued.resource }))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'resource_retiring'))
    releaseHandler?.()
    await Promise.all([invocation, retirement])
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('retires opt-in resources only after the last refreshed handle expires', async () => {
    vi.useFakeTimers()
    try {
      let now = new Date('2026-08-16T00:00:00.000Z')
      const dispose = vi.fn(async () => undefined)
      const observe = async () => ({ state: {}, semanticRevision: '1' })
      const broker = new CapabilityBroker(new CapabilityRegistry(), {
        now: () => now,
        handleTtlMs: 1_000
      })
      const issued = broker.issueResource(ui, {
        resourceId: 'expiring-portable',
        resourceKind: 'portable',
        semanticRevision: '1',
        observe,
        dispose,
        retireAfterLastHandleExpires: true
      })

      now = new Date('2026-08-16T00:00:00.500Z')
      const refreshed = broker.bindResourceRef(ui, issued.resourceRef)
      now = new Date('2026-08-16T00:00:01.000Z')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(dispose).not.toHaveBeenCalled()
      expect(broker.describeResourceRef(ui, issued.resourceRef)).toMatchObject({
        resourceId: 'expiring-portable'
      })

      now = new Date('2026-08-16T00:00:01.500Z')
      await vi.advanceTimersByTimeAsync(500)
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(() => broker.describeResourceRef(ui, issued.resourceRef))
        .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
      expect(refreshed.expiresAt).toBe('2026-08-16T00:00:01.500Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('defers expiry retirement while retained and joins concurrent retirement requests', async () => {
    vi.useFakeTimers()
    try {
      let now = new Date('2026-08-16T00:00:00.000Z')
      let releaseDispose: (() => void) | undefined
      const disposeGate = new Promise<void>((resolve) => { releaseDispose = resolve })
      const dispose = vi.fn(() => disposeGate)
      const broker = new CapabilityBroker(new CapabilityRegistry(), {
        now: () => now,
        handleTtlMs: 1_000
      })
      const issued = broker.issueResource(ui, {
        resourceId: 'retained-portable',
        resourceKind: 'portable',
        semanticRevision: '1',
        observe: async () => ({ state: {}, semanticRevision: '1' }),
        dispose,
        retireAfterLastHandleExpires: true
      })
      const releaseRetention = broker.retainResourceRefs(ui, [issued.resourceRef])

      now = new Date('2026-08-16T00:00:01.000Z')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(dispose).not.toHaveBeenCalled()
      const rebound = broker.bindResourceRef(ui, issued.resourceRef)
      expect(rebound.expiresAt).toBe('2026-08-16T00:00:02.000Z')
      await releaseRetention()
      expect(dispose).not.toHaveBeenCalled()

      now = new Date('2026-08-16T00:00:02.000Z')
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1))
      const explicitRetirement = issued.retire({ deferWhileRetained: false })
      releaseDispose?.()
      await explicitRetirement
      expect(dispose).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('pins provider observation across handle expiry and retires after the provider settles', async () => {
    vi.useFakeTimers()
    try {
      let now = new Date('2026-08-16T00:00:00.000Z')
      let releaseObserve: (() => void) | undefined
      let markStarted: (() => void) | undefined
      const observeGate = new Promise<void>((resolve) => { releaseObserve = resolve })
      const observeStarted = new Promise<void>((resolve) => { markStarted = resolve })
      const dispose = vi.fn(async () => undefined)
      const broker = new CapabilityBroker(new CapabilityRegistry(), {
        now: () => now,
        handleTtlMs: 1_000
      })
      const issued = broker.issueResource(ui, {
        resourceId: 'observed-across-expiry',
        resourceKind: 'portable',
        semanticRevision: '1',
        retireAfterLastHandleExpires: true,
        dispose,
        observe: async () => {
          markStarted?.()
          await observeGate
          throw new Error('provider observation failed after expiry')
        }
      })

      const observation = broker.observe(ui, { resource: issued.resource })
      await observeStarted
      now = new Date('2026-08-16T00:00:01.000Z')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(dispose).not.toHaveBeenCalled()
      releaseObserve?.()
      await expect(observation)
        .rejects.toSatisfy((error) => expectBrokerCode(error, 'observation_failed'))
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(() => broker.describeResourceRef(ui, issued.resourceRef))
        .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not mint an undisclosed handle before advertised observation operations validate', async () => {
    vi.useFakeTimers()
    try {
      let now = new Date('2026-08-16T00:00:00.000Z')
      const dispose = vi.fn(async () => undefined)
      const broker = new CapabilityBroker(new CapabilityRegistry(), {
        now: () => now,
        handleTtlMs: 10_000
      })
      const issued = broker.issueResource(ui, {
        resourceId: 'invalid-observation-operation',
        resourceKind: 'portable',
        semanticRevision: '1',
        expiresInMs: 100,
        retireAfterLastHandleExpires: true,
        dispose,
        observe: async () => ({
          state: {},
          semanticRevision: '1',
          operationIds: ['unregistered.observation-operation']
        })
      })

      await expect(broker.observe(ui, { resource: issued.resource }))
        .rejects.toSatisfy((error) => expectBrokerCode(error, 'unregistered_operation'))
      now = new Date('2026-08-16T00:00:00.100Z')
      await vi.advanceTimersByTimeAsync(100)
      expect(dispose).toHaveBeenCalledOnce()
      expect(() => broker.describeResourceRef(ui, issued.resourceRef))
        .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('forwards one observation signal and maps pre-dispatch or provider abort canonically', async () => {
    let observedSignal: AbortSignal | undefined
    const observe = vi.fn(async (
      _caller: unknown,
      options: { signal?: AbortSignal }
    ) => {
      observedSignal = options.signal
      await new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => reject(options.signal?.reason ?? new Error('aborted')),
          { once: true }
        )
      })
      return { state: {}, semanticRevision: '1' }
    })
    const broker = new CapabilityBroker(new CapabilityRegistry())
    const issued = broker.issueResource(ui, {
      resourceId: 'abortable-observation',
      resourceKind: 'portable',
      semanticRevision: '1',
      observe
    })

    const beforeDispatch = new AbortController()
    beforeDispatch.abort(new Error('cancelled before dispatch'))
    await expect(broker.observe(ui, { resource: issued.resource }, {
      signal: beforeDispatch.signal
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'invocation_cancelled'))
    expect(observe).not.toHaveBeenCalled()

    const duringDispatch = new AbortController()
    const pending = broker.observe(ui, { resource: issued.resource }, {
      signal: duringDispatch.signal
    })
    await vi.waitFor(() => expect(observe).toHaveBeenCalledOnce())
    expect(observedSignal).toBe(duringDispatch.signal)
    duringDispatch.abort(new Error('cancelled during dispatch'))
    await expect(pending)
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'invocation_cancelled'))
  })

  it('pins provider invocation across handle expiry and disposes only after dispatch completes', async () => {
    vi.useFakeTimers()
    try {
      let now = new Date('2026-08-16T00:00:00.000Z')
      let releaseHandler: (() => void) | undefined
      let markStarted: (() => void) | undefined
      const handlerGate = new Promise<void>((resolve) => { releaseHandler = resolve })
      const handlerStarted = new Promise<void>((resolve) => { markStarted = resolve })
      const handler = vi.fn(async (input: { section: string }) => {
        markStarted?.()
        await handlerGate
        return { output: { text: `read:${input.section}` } }
      })
      const dispose = vi.fn(async () => undefined)
      const broker = new CapabilityBroker(new CapabilityRegistry([readCapability(handler)]), {
        now: () => now,
        handleTtlMs: 1_000
      })
      const handle = issueDocument(broker, agent, {
        dispose,
        retireAfterLastHandleExpires: true
      })

      const invocation = broker.invoke(agent, {
        actionId: 'document.read-section',
        resource: handle,
        input: { section: 'abstract' }
      })
      await handlerStarted
      now = new Date('2026-08-16T00:00:01.000Z')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(dispose).not.toHaveBeenCalled()
      releaseHandler?.()
      await expect(invocation).resolves.toMatchObject({ output: { text: 'read:abstract' } })
      expect(dispose).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps disposal failures poisoned and retries cleanup without restoring liveness', async () => {
    vi.useFakeTimers()
    try {
      let now = new Date('2026-08-16T00:00:00.000Z')
      const dispose = vi.fn()
        .mockRejectedValueOnce(new Error('first disposal failed'))
        .mockResolvedValue(undefined)
      const broker = new CapabilityBroker(new CapabilityRegistry(), {
        now: () => now,
        handleTtlMs: 1_000
      })
      const issued = broker.issueResource(ui, {
        resourceId: 'poisoned-retirement',
        resourceKind: 'portable',
        semanticRevision: '1',
        retireAfterLastHandleExpires: true,
        dispose,
        observe: async () => ({ state: {}, semanticRevision: '1' })
      })

      now = new Date('2026-08-16T00:00:01.000Z')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(() => broker.bindResourceRef(ui, issued.resourceRef))
        .toThrow(expect.objectContaining({ code: 'resource_retiring' }))
      expect(() => broker.describeResourceRef(ui, issued.resourceRef))
        .toThrow(expect.objectContaining({ code: 'resource_retiring' }))

      await vi.advanceTimersByTimeAsync(1_000)
      expect(dispose).toHaveBeenCalledTimes(2)
      expect(() => broker.describeResourceRef(ui, issued.resourceRef))
        .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('revalidates Principal authority before delivering resource subscriptions', async () => {
    let currentPrincipal: PrincipalSnapshot | null = principalA
    let releaseHandler: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const handlerGate = new Promise<void>((resolve) => { releaseHandler = resolve })
    const handlerStarted = new Promise<void>((resolve) => { markStarted = resolve })
    const handler = vi.fn(async (_input: { text: string }, context) => {
      markStarted?.()
      await handlerGate
      return {
        output: { saved: 'done' },
        changed: true,
        semanticRevision: `${Number(context.resource?.semanticRevision ?? '0') + 1}`
      }
    })
    const broker = new CapabilityBroker(
      new CapabilityRegistry([mutationCapability(handler)]),
      { resolveCurrentPrincipal: () => currentPrincipal }
    )
    const handle = issueDocument(broker, agent, { audiences: ['ui', 'agent'] })
    const events: unknown[] = []
    const unsubscribe = broker.subscribe(ui, (event) => events.push(event))
    const invocation = broker.invoke(agent, {
      actionId: 'document.annotation-upsert',
      invocationId: 'principal-switch-in-flight',
      resource: handle,
      expectedRevision: '1',
      input: { text: 'change' }
    })

    await handlerStarted
    currentPrincipal = principalB
    releaseHandler?.()
    await expect(invocation)
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'outcome_unknown'))

    expect(events).toEqual([])
    expect(broker.listEvents(ui)).toEqual([])
    currentPrincipal = principalA
    expect(broker.listEvents(ui)).toEqual([])
    unsubscribe()
  })

  it('validates caller audience, approval, input, and provider output before returning', async () => {
    const destructive = defineCapability({
      id: 'external.publish-result',
      version: '1',
      title: 'Publish result',
      description: 'Publish a result outside the workspace.',
      audiences: ['ui', 'agent'],
      scope: 'workspace',
      effect: 'external-write',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({ destination: z.string().url() }).strict(),
      outputSchema: z.object({ published: z.boolean() }).strict(),
      handler: vi.fn(async () => ({ output: { published: true } }))
    })
    const invalidOutput = readCapability(vi.fn(async () => ({ output: { text: 42 } })) as never)
    const broker = new CapabilityBroker(new CapabilityRegistry([destructive, invalidOutput]))

    await expect(broker.invoke(agent, {
      actionId: 'external.publish-result',
      invocationId: 'publish-1',
      input: { destination: 'https://example.com' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'approval_denied'))

    const approved = {
      ...agent,
      approvals: [{ actionId: 'external.publish-result', invocationId: 'publish-1', mode: 'confirmation' as const }]
    }
    await expect(broker.invoke(approved, {
      actionId: 'external.publish-result',
      invocationId: 'publish-1',
      input: { destination: 'not-a-url' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'invalid_input'))

    const handle = issueDocument(broker)
    await expect(broker.invoke(agent, {
      actionId: 'document.read-section',
      resource: handle,
      input: { section: 'abstract' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'invalid_output'))
  })

  it('keeps resource identity opaque and rejects forged, cross-audience, cross-workspace, and expired handles', async () => {
    let now = new Date('2026-07-16T00:00:00.000Z')
    const broker = new CapabilityBroker(new CapabilityRegistry([readCapability()]), { now: () => now })
    const handle = issueDocument(broker, agent, { expiresInMs: 1_000 })

    expect(JSON.stringify(handle)).not.toContain('paper.pdf')
    await expect(broker.invoke(ui, {
      actionId: 'document.read-section',
      resource: handle,
      input: { section: 'abstract' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'resource_audience_denied'))
    await expect(broker.invoke({ ...agent, workspaceId: 'workspace-2' }, {
      actionId: 'document.read-section',
      resource: handle,
      input: { section: 'abstract' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'resource_scope_mismatch'))
    await expect(broker.invoke(agent, {
      actionId: 'document.read-section',
      resource: { ...handle, semanticRevision: 'forged' },
      input: { section: 'abstract' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'invalid_resource_handle'))

    now = new Date('2026-07-16T00:00:01.001Z')
    await expect(broker.observe(agent, { resource: handle }))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'resource_handle_expired'))
  })

  it('keeps resource handles audience-private unless transfer is explicitly declared', async () => {
    const broker = new CapabilityBroker(new CapabilityRegistry([readCapability()]))
    const handle = issueDocument(broker, ui)

    await expect(broker.observe(agent, { resource: handle }))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'resource_audience_denied'))
  })

  it('allows explicitly shared handles in the same workspace and preserves transfer through refresh', async () => {
    const handler = vi.fn(async (input: { text: string }, context) => ({
      output: { saved: input.text },
      changed: true,
      semanticRevision: `${Number(context.resource?.semanticRevision ?? '0') + 1}`
    }))
    const broker = new CapabilityBroker(new CapabilityRegistry([
      readCapability(),
      mutationCapability(handler)
    ]))
    const handle = issueDocument(broker, ui, { audiences: ['ui', 'agent', 'system'] })

    const observed = await broker.observe(agent, { resource: handle })
    expect(observed.operations.map((operation) => operation.id)).toContain('document.annotation-upsert')
    const changed = await broker.invoke(agent, {
      actionId: 'document.annotation-upsert',
      invocationId: 'shared-edit-1',
      resource: observed.resource,
      expectedRevision: observed.semanticRevision,
      input: { text: 'Shared annotation' }
    })
    expect(changed).toMatchObject({ changed: true, beforeRevision: '1', afterRevision: '2' })
    expect(handler).toHaveBeenCalledTimes(1)

    await expect(broker.observe({ ...agent, workspaceId: 'workspace-2' }, { resource: changed.resource! }))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'resource_scope_mismatch'))
  })

  it('renews a stable resource reference only after audience and workspace checks', async () => {
    let now = new Date('2026-07-16T00:00:00.000Z')
    const broker = new CapabilityBroker(new CapabilityRegistry([readCapability(), mutationCapability()]), {
      now: () => now,
      handleTtlMs: 1_000
    })
    const sharedHandle = issueDocument(broker, ui, {
      audiences: ['ui', 'agent', 'system'],
      expiresInMs: 1_000
    })
    const shared = await broker.observe(ui, { resource: sharedHandle })
    now = new Date('2026-07-16T00:00:02.000Z')

    const renewed = broker.bindResourceRef(agent, shared.resourceRef)
    expect(broker.describeResourceRef(agent, shared.resourceRef)).toMatchObject({
      resourceId: 'internal/path/paper.pdf',
      resourceRef: shared.resourceRef,
      resourceKind: 'document',
      workspaceId: 'workspace-1',
      semanticRevision: '1'
    })
    await expect(broker.observe(agent, { resource: renewed })).resolves.toMatchObject({
      resourceRef: shared.resourceRef,
      resourceKind: 'document'
    })
    await expect(Promise.resolve().then(() => broker.bindResourceRef(
      { ...agent, workspaceId: 'workspace-2' },
      shared.resourceRef
    ))).rejects.toSatisfy((error) => expectBrokerCode(error, 'resource_scope_mismatch'))
    expect(() => broker.describeResourceRef(
      { ...agent, workspaceId: 'workspace-2' },
      shared.resourceRef
    )).toThrow(expect.objectContaining({ code: 'resource_scope_mismatch' }))

    const privateHandle = issueDocument(broker, ui, { expiresInMs: 1_000 })
    const privateObservation = await broker.observe(ui, { resource: privateHandle })
    await expect(Promise.resolve().then(() => broker.bindResourceRef(agent, privateObservation.resourceRef)))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'resource_audience_denied'))
    expect(() => broker.describeResourceRef(agent, privateObservation.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_audience_denied' }))
  })

  it('observes current semantic state, keeps layout revisions separate, and returns executable operations', async () => {
    const broker = new CapabilityBroker(new CapabilityRegistry([readCapability(), mutationCapability()]))
    const handle = issueDocument(broker, agent, { layoutRevision: 'layout-1' })
    const observation = await broker.observe(agent, { resource: handle })

    expect(observation).toMatchObject({
      resourceKind: 'document',
      semanticRevision: '1',
      layoutRevision: 'layout-2',
      state: { title: 'Paper', annotationCount: 0 }
    })
    expect(observation.resource.semanticRevision).toBe('1')
    expect(observation.operations.map((item) => item.id)).toEqual([
      'document.read-section',
      'document.annotation-upsert'
    ])
  })

  it('enforces semantic revisions and makes mutations idempotent, audited, and evented', async () => {
    const handler = vi.fn(async (input: { text: string }, context) => ({
      output: { saved: input.text },
      changed: true,
      semanticRevision: `${Number(context.resource?.semanticRevision ?? '0') + 1}`
    }))
    const broker = new CapabilityBroker(new CapabilityRegistry([mutationCapability(handler)]))
    const handle = issueDocument(broker, agent, { audiences: ['ui', 'agent'] })
    const events: unknown[] = []
    const unsubscribe = broker.subscribe(ui, (event) => events.push(event))
    const request: CapabilityInvocationRequest = {
      actionId: 'document.annotation-upsert',
      invocationId: 'annotation-1',
      resource: handle,
      expectedRevision: '1',
      input: { text: 'Major comment' }
    }

    const first = await broker.invoke(agent, request)
    const retry = await broker.invoke(agent, request)
    unsubscribe()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(first).toMatchObject({
      beforeRevision: '1',
      afterRevision: '2',
      changed: true,
      replayed: false
    })
    expect(first.resource?.semanticRevision).toBe('2')
    expect(retry).toMatchObject({ afterRevision: '2', replayed: true })
    expect(events).toHaveLength(1)
    expect(broker.listEvents(ui)).toHaveLength(1)
    expect(broker.listEvents({ ...ui, workspaceId: 'workspace-2' })).toHaveLength(0)
    expect(broker.listAuditRecords().map((record) => record.status)).toEqual(['success', 'replayed'])

    await expect(broker.invoke(agent, {
      ...request,
      invocationId: 'annotation-2'
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'revision_conflict'))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(broker.listAuditRecords().at(-1)).toMatchObject({
      status: 'rejected',
      errorCode: 'revision_conflict'
    })
  })

  it('projects historical resource liveness and rejects retired references with a stable code', async () => {
    const release = defineCapability({
      id: 'document.release',
      version: '1',
      title: 'Release document',
      description: 'Retires the broker resource after its provider is released.',
      audiences: ['agent'],
      scope: 'resource',
      resourceKinds: ['document'],
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ released: z.boolean() }).strict(),
      handler: async () => ({
        output: { released: true },
        changed: false,
        retireResource: true
      })
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([mutationCapability(), release]))
    const handle = issueDocument(broker)
    const changed = await broker.invoke(agent, {
      actionId: 'document.annotation-upsert',
      invocationId: 'annotation-before-release',
      resource: handle,
      expectedRevision: '1',
      input: { text: 'Audit this change' }
    })
    const liveEvent = broker.listEvents(agent)[0]
    expect(liveEvent).toMatchObject({ resourceStatus: 'live' })
    const releaseTaskBinding = broker.retainResourceRefs(agent, [liveEvent!.resourceRef])

    await broker.invoke(agent, {
      actionId: 'document.release',
      invocationId: 'release-document',
      resource: changed.resource,
      input: {}
    })

    expect(broker.listEvents(agent)[0]).toMatchObject({
      id: liveEvent?.id,
      resourceRef: liveEvent?.resourceRef,
      resourceStatus: 'retired'
    })
    expect(() => broker.bindResourceRef(agent, liveEvent!.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
    await releaseTaskBinding()
  })

  it('defers provider disposal while a task retains the question-time resource', async () => {
    const release = defineCapability({
      id: 'document.release',
      version: '1',
      title: 'Release document',
      description: 'Requests retirement of the document resource.',
      audiences: ['ui', 'agent'],
      scope: 'resource',
      resourceKinds: ['document'],
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ released: z.boolean() }).strict(),
      handler: async () => ({
        output: { released: true },
        changed: false,
        retireResource: 'defer-while-retained'
      })
    })
    const dispose = vi.fn()
    const broker = new CapabilityBroker(new CapabilityRegistry([readCapability(), mutationCapability(), release]))
    const handle = issueDocument(broker, agent, { audiences: ['ui', 'agent'], dispose })
    const observed = await broker.observe(agent, { resource: handle })
    const releaseTaskBinding = broker.retainResourceRefs(agent, [observed.resourceRef])
    const releaseSecondTaskBinding = broker.retainResourceRefs(agent, [observed.resourceRef])

    await broker.invoke(ui, {
      actionId: 'document.release',
      invocationId: 'release-from-ui',
      resource: handle,
      input: {}
    })

    expect(dispose).not.toHaveBeenCalled()
    expect(broker.describeResourceRef(agent, observed.resourceRef)).toMatchObject({
      resourceId: 'internal/path/paper.pdf',
      resourceRef: observed.resourceRef
    })
    const rebound = broker.bindResourceRef(agent, observed.resourceRef)
    expect(rebound).toMatchObject({
      semanticRevision: '1'
    })
    await expect(broker.observe(agent, { resource: rebound }))
      .resolves.toMatchObject({ resourceRef: observed.resourceRef })
    expect(() => broker.issueResource(agent, {
      resourceId: 'internal/path/paper.pdf',
      resourceKind: 'document',
      workspaceId: agent.workspaceId,
      audiences: ['ui', 'agent'],
      semanticRevision: '1',
      observe: async () => ({ state: { forged: true }, semanticRevision: '1' }),
      dispose
    })).toThrow(expect.objectContaining({ code: 'resource_registration_conflict' }))

    await releaseTaskBinding()
    expect(dispose).not.toHaveBeenCalled()
    expect(broker.describeResourceRef(agent, observed.resourceRef)).toMatchObject({
      resourceRef: observed.resourceRef
    })
    await releaseSecondTaskBinding()
    expect(dispose).toHaveBeenCalledOnce()
    expect(() => broker.bindResourceRef(agent, observed.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
  })

  it('fails and journals a self-retiring invocation when provider disposal fails', async () => {
    const handler = vi.fn(async () => ({
      output: { released: true },
      changed: false,
      retireResource: true as const
    }))
    const release = defineCapability({
      id: 'document.release-failing-provider',
      version: '1',
      title: 'Release document with failing provider',
      description: 'Propagates provider disposal failure after releasing the invocation pin.',
      audiences: ['agent'],
      scope: 'resource',
      resourceKinds: ['document'],
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ released: z.boolean() }).strict(),
      handler
    })
    const dispose = vi.fn(async () => { throw new Error('provider disposal failed') })
    const broker = new CapabilityBroker(new CapabilityRegistry([release]))
    const handle = issueDocument(broker, agent, { dispose })
    const request = {
      actionId: release.descriptor.id,
      invocationId: 'release-failing-provider-1',
      resource: handle,
      input: {}
    }

    await expect(broker.invoke(agent, request))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'resource_disposal_failed'))
    await expect(broker.invoke(agent, request))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'resource_retiring'))
    expect(handler).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(broker.listAuditRecords().every((record) => record.status !== 'success')).toBe(true)
  })

  it('deduplicates concurrent retries and rejects invocation ID reuse with different input', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const handler = vi.fn(async (input: { text: string }) => {
      await gate
      return { output: { saved: input.text }, changed: true, semanticRevision: '2' }
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([mutationCapability(handler)]))
    const handle = issueDocument(broker)
    const request: CapabilityInvocationRequest = {
      actionId: 'document.annotation-upsert',
      invocationId: 'same-invocation',
      resource: handle,
      expectedRevision: '1',
      input: { text: 'same' }
    }

    const first = broker.invoke(agent, request)
    const second = broker.invoke(agent, request)
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    release?.()
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect([firstResult.replayed, secondResult.replayed].sort()).toEqual([false, true])

    await expect(broker.invoke(agent, {
      ...request,
      input: { text: 'different' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'idempotency_conflict'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('preserves idempotency for sensitive input without exposing it in the audit journal', async () => {
    const handler = vi.fn(async (input: { password: string }) => ({
      output: { accepted: input.password.length > 0 }
    }))
    const capability = defineCapability({
      id: 'provider-connection.bind',
      version: '1',
      title: 'Bind provider connection',
      description: 'Validates a provider credential without retaining it in broker journals.',
      audiences: ['ui'],
      scope: 'global',
      effect: 'external-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      tags: ['sensitive-input'],
      inputSchema: z.object({ password: z.string().min(1) }).strict(),
      outputSchema: z.object({ accepted: z.boolean() }).strict(),
      handler
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([capability]))
    const request = {
      actionId: capability.descriptor.id,
      invocationId: 'bind-sensitive-1',
      input: { password: 'fixture-secret-never-journal' }
    }

    await expect(broker.invoke(ui, request)).resolves.toMatchObject({ replayed: false })
    await expect(broker.invoke(ui, request)).resolves.toMatchObject({ replayed: true })
    await expect(broker.invoke(ui, {
      ...request,
      input: { password: 'different-fixture-secret' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'idempotency_conflict'))
    expect(handler).toHaveBeenCalledOnce()
    expect(JSON.stringify(broker.listAuditRecords())).not.toContain('fixture-secret')
  })

  it('does not retain an offline-guessable or Broker-stable verifier for sensitive input', async () => {
    const password = 'fixture-low-entropy-password'
    const offlineVerifier = createHash('sha256')
      .update(JSON.stringify({ password }))
      .digest('hex')
    const capability = defineCapability({
      id: 'provider-connection.bind',
      version: '1',
      title: 'Bind provider connection',
      description: 'Validates a provider credential without retaining a reusable verifier.',
      audiences: ['ui'],
      scope: 'global',
      effect: 'external-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      tags: ['sensitive-input'],
      inputSchema: z.object({ password: z.string().min(1) }).strict(),
      outputSchema: z.object({ accepted: z.boolean() }).strict(),
      handler: async () => ({ output: { accepted: true } })
    })
    const request = {
      actionId: capability.descriptor.id,
      invocationId: 'bind-sensitive-verifier-1',
      input: { password }
    }
    const setSpy = vi.spyOn(Map.prototype, 'set')

    try {
      await new CapabilityBroker(new CapabilityRegistry([capability])).invoke(ui, request)
      await new CapabilityBroker(new CapabilityRegistry([capability])).invoke(ui, request)

      const fingerprints = setSpy.mock.calls.flatMap(([, value]) => {
        if (!value || typeof value !== 'object') return []
        const fingerprint = Reflect.get(value, 'fingerprint')
        const promise = Reflect.get(value, 'promise')
        return typeof fingerprint === 'string' && promise instanceof Promise
          ? [fingerprint]
          : []
      })
      expect(fingerprints).toHaveLength(2)
      expect({
        retainsOfflineVerifier: fingerprints.some((fingerprint) => fingerprint.includes(offlineVerifier)),
        correlatesAcrossBrokerLifetimes: fingerprints[0] === fingerprints[1]
      }).toEqual({
        retainsOfflineVerifier: false,
        correlatesAcrossBrokerLifetimes: false
      })
    } finally {
      setSpy.mockRestore()
    }
  })

  it('never evicts pending idempotency work or redispatches a failed write', async () => {
    let release: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const handler = vi.fn(async (input: { text: string }) => {
      markStarted?.()
      await gate
      if (input.text === 'fails-after-dispatch') throw new Error('transport outcome unknown')
      return { output: { saved: input.text }, changed: true, semanticRevision: '2' }
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([mutationCapability(handler)]), {
      maxIdempotencyEntries: 1
    })
    const handle = issueDocument(broker)
    const pendingRequest: CapabilityInvocationRequest = {
      actionId: 'document.annotation-upsert',
      invocationId: 'pending-oldest',
      resource: handle,
      expectedRevision: '1',
      input: { text: 'fails-after-dispatch' }
    }
    const pending = broker.invoke(agent, pendingRequest)
    await started
    const joined = broker.invoke(agent, pendingRequest)
    await expect(broker.invoke(agent, {
      ...pendingRequest,
      invocationId: 'capacity-overflow',
      input: { text: 'must-not-dispatch' }
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'idempotency_capacity_exceeded'))
    release?.()
    await expect(pending).rejects.toSatisfy((error) => expectBrokerCode(error, 'handler_failed'))
    await expect(joined).rejects.toSatisfy((error) => expectBrokerCode(error, 'handler_failed'))
    await expect(broker.invoke(agent, pendingRequest))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'handler_failed'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('rejects raw grants and preserves Host-issued grants across resource issue and mutation', async () => {
    const resourceHandleSchema = z.object({
      token: z.string(),
      semanticRevision: z.string(),
      expiresAt: z.string()
    }).strict()
    const open = defineCapability({
      id: 'authority.resource.open',
      version: '1.0.0',
      title: 'Open authority resource',
      description: 'Issues a resource while preserving Host-issued caller authority.',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: z.object({}).strict(),
      outputSchema: resourceHandleSchema,
      handler: async (_input, context) => {
        expect(context.caller.capabilityGrants).toEqual(['authority.resource.mutate'])
        return {
          output: context.issueResource({
            resourceId: 'authority-state',
            resourceKind: 'authority-state',
            workspaceId: context.caller.workspaceId,
            audiences: ['system'],
            semanticRevision: 'revision-1',
            observe: async () => ({ state: {}, semanticRevision: 'revision-1' })
          })
        }
      }
    })
    const mutate = defineCapability({
      id: 'authority.resource.mutate',
      version: '1.0.0',
      title: 'Mutate authority resource',
      description: 'Mutates a resource while preserving Host-issued caller authority.',
      audiences: ['system'],
      scope: 'resource',
      resourceKinds: ['authority-state'],
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      handler: async (_input, context) => {
        expect(context.caller.capabilityGrants).toEqual(['authority.resource.mutate'])
        return {
          output: { ok: true as const },
          changed: true,
          semanticRevision: 'revision-2'
        }
      }
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([open, mutate]))
    const forgedCaller = {
      audience: 'system',
      callerId: 'domain-runtime:forged',
      workspaceId: '/workspace',
      capabilityGrants: ['authority.resource.mutate']
    }
    await expect(broker.invoke(forgedCaller as never, {
      actionId: open.descriptor.id,
      input: {}
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'invalid_caller'))

    const caller = {
      callerId: 'domain-runtime:fixture.authority',
      workspaceId: '/workspace',
      capabilityGrants: ['authority.resource.mutate']
    }
    const opened = await broker.invokeHostSystem(caller, {
      actionId: open.descriptor.id,
      input: {}
    })
    const handle = resourceHandleSchema.parse(opened.output) as CapabilityResourceHandle
    await expect(broker.invokeHostSystem(caller, {
      actionId: mutate.descriptor.id,
      invocationId: 'authority-mutation-1',
      resource: handle,
      expectedRevision: 'revision-1',
      input: {}
    })).resolves.toMatchObject({
      changed: true,
      afterRevision: 'revision-2',
      resource: { semanticRevision: 'revision-2' }
    })
    await expect(broker.invokeHostSystem({
      callerId: caller.callerId,
      workspaceId: caller.workspaceId
    }, {
      actionId: mutate.descriptor.id,
      invocationId: 'authority-mutation-1',
      resource: handle,
      expectedRevision: 'revision-1',
      input: {}
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'idempotency_conflict'))
  })

  it('rolls back handler-issued resources when dispatch throws', async () => {
    const dispose = vi.fn(async () => undefined)
    let issued: CapabilityResourceHandle | undefined
    const handler = vi.fn(async (_input: Record<string, never>, context) => {
      issued = context.issueResource({
        resourceId: 'transactional-context-resource',
        resourceKind: 'transactional-resource',
        workspaceId: context.caller.workspaceId,
        semanticRevision: '1',
        observe: async () => ({ state: {}, semanticRevision: '1' }),
        dispose
      })
      throw new Error('provider failed after issuance')
    })
    const capability = defineCapability({
      id: 'transactional-resource.throw',
      version: '1',
      title: 'Issue then throw',
      description: 'Exercises invocation-scoped resource rollback.',
      audiences: ['agent'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([capability]))
    const request = {
      actionId: capability.descriptor.id,
      invocationId: 'transactional-throw-1',
      input: {}
    }

    await expect(broker.invoke(agent, request))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'handler_failed'))
    expect(dispose).toHaveBeenCalledOnce()
    await expect(broker.observe(agent, { resource: issued! }))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'invalid_resource_handle'))
    await expect(broker.invoke(agent, request))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'handler_failed'))
    expect(handler).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('removes only the new handle when a failed invocation reuses a live resource', async () => {
    const observe = vi.fn(async () => ({ state: { live: true }, semanticRevision: '1' }))
    const dispose = vi.fn(async () => undefined)
    const registration = {
      resourceId: 'shared-transactional-resource',
      resourceKind: 'transactional-resource',
      workspaceId: agent.workspaceId,
      semanticRevision: '1',
      observe,
      dispose
    }
    let broker!: CapabilityBroker
    let issuedDuringFailure: ReturnType<CapabilityBroker['issueResource']> | undefined
    const capability = defineCapability({
      id: 'transactional-resource.invalid-output',
      version: '1',
      title: 'Issue invalid output',
      description: 'Reuses a live resource before returning an invalid output.',
      audiences: ['agent'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async (_input, context) => {
        issuedDuringFailure = broker.issueResource(context.caller, registration)
        return { output: { ok: 'not-a-boolean' } as never }
      }
    })
    broker = new CapabilityBroker(new CapabilityRegistry([capability]))
    const preexisting = broker.issueResource(agent, registration)

    await expect(broker.invoke(agent, {
      actionId: capability.descriptor.id,
      invocationId: 'transactional-invalid-output-1',
      input: {}
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'invalid_output'))

    expect(dispose).not.toHaveBeenCalled()
    await expect(broker.observe(agent, { resource: preexisting.resource }))
      .resolves.toMatchObject({ state: { live: true } })
    await expect(broker.observe(agent, { resource: issuedDuringFailure!.resource }))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'invalid_resource_handle'))
  })

  it('keeps a shared provisional resource when a concurrent adopter commits before its creator rolls back', async () => {
    let releaseCreator: (() => void) | undefined
    let markCreatorIssued: (() => void) | undefined
    const creatorGate = new Promise<void>((resolve) => { releaseCreator = resolve })
    const creatorIssued = new Promise<void>((resolve) => { markCreatorIssued = resolve })
    const observe = vi.fn(async () => ({ state: { adopted: true }, semanticRevision: '1' }))
    const dispose = vi.fn(async () => undefined)
    const unsubscribeProvider = vi.fn()
    const subscribeChanges = vi.fn(() => unsubscribeProvider)
    const registration = {
      resourceId: 'concurrent-adoption-resource',
      resourceKind: 'transactional-resource',
      workspaceId: agent.workspaceId,
      semanticRevision: '1',
      observe,
      subscribeChanges,
      dispose
    }
    let broker!: CapabilityBroker
    let adoptedHandle: CapabilityResourceHandle | undefined
    const capability = defineCapability({
      id: 'transactional-resource.concurrent-adoption',
      version: '1',
      title: 'Concurrently adopt a resource',
      description: 'Keeps a resource that another invocation commits before creator rollback.',
      audiences: ['agent'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({ role: z.enum(['creator', 'adopter']) }).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async (input, context) => {
        const issued = broker.issueResource(context.caller, registration)
        if (input.role === 'creator') {
          markCreatorIssued?.()
          await creatorGate
          throw new Error('creator failed after concurrent adoption')
        }
        adoptedHandle = issued.resource
        return { output: { ok: true } }
      }
    })
    broker = new CapabilityBroker(new CapabilityRegistry([capability]))

    const creatorTask = broker.invoke(agent, {
      actionId: capability.descriptor.id,
      invocationId: 'concurrent-adoption-creator',
      input: { role: 'creator' }
    })
    const creatorFailure = expect(creatorTask)
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'handler_failed'))
    await creatorIssued
    expect(subscribeChanges).not.toHaveBeenCalled()
    await expect(broker.invoke(agent, {
      actionId: capability.descriptor.id,
      invocationId: 'concurrent-adoption-success',
      input: { role: 'adopter' }
    })).resolves.toMatchObject({ output: { ok: true } })
    expect(subscribeChanges).toHaveBeenCalledOnce()
    releaseCreator?.()
    await creatorFailure

    expect(dispose).not.toHaveBeenCalled()
    expect(unsubscribeProvider).not.toHaveBeenCalled()
    await expect(broker.observe(agent, { resource: adoptedHandle! }))
      .resolves.toMatchObject({ state: { adopted: true } })
  })

  it('retires a shared provisional resource exactly once after every concurrent adopter rolls back', async () => {
    let releaseCreator: (() => void) | undefined
    let releaseAdopter: (() => void) | undefined
    let markCreatorIssued: (() => void) | undefined
    let markAdopterIssued: (() => void) | undefined
    const creatorGate = new Promise<void>((resolve) => { releaseCreator = resolve })
    const adopterGate = new Promise<void>((resolve) => { releaseAdopter = resolve })
    const creatorIssued = new Promise<void>((resolve) => { markCreatorIssued = resolve })
    const adopterIssued = new Promise<void>((resolve) => { markAdopterIssued = resolve })
    const dispose = vi.fn(async () => undefined)
    const subscribeChanges = vi.fn(() => vi.fn())
    const registration = {
      resourceId: 'concurrent-rollback-resource',
      resourceKind: 'transactional-resource',
      workspaceId: agent.workspaceId,
      semanticRevision: '1',
      observe: async () => ({ state: {}, semanticRevision: '1' }),
      subscribeChanges,
      dispose
    }
    const issuedHandles: CapabilityResourceHandle[] = []
    let broker!: CapabilityBroker
    const capability = defineCapability({
      id: 'transactional-resource.concurrent-rollback',
      version: '1',
      title: 'Concurrently roll back a resource',
      description: 'Retires only after all provisional resource adopters fail.',
      audiences: ['agent'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({ role: z.enum(['creator', 'adopter']) }).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async (input, context) => {
        issuedHandles.push(broker.issueResource(context.caller, registration).resource)
        if (input.role === 'creator') {
          markCreatorIssued?.()
          await creatorGate
        } else {
          markAdopterIssued?.()
          await adopterGate
        }
        throw new Error(`${input.role} failed after issuance`)
      }
    })
    broker = new CapabilityBroker(new CapabilityRegistry([capability]))

    const creatorTask = broker.invoke(agent, {
      actionId: capability.descriptor.id,
      invocationId: 'concurrent-rollback-creator',
      input: { role: 'creator' }
    })
    const creatorFailure = expect(creatorTask)
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'handler_failed'))
    await creatorIssued
    const adopterTask = broker.invoke(agent, {
      actionId: capability.descriptor.id,
      invocationId: 'concurrent-rollback-adopter',
      input: { role: 'adopter' }
    })
    const adopterFailure = expect(adopterTask)
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'handler_failed'))
    await adopterIssued
    expect(subscribeChanges).not.toHaveBeenCalled()

    releaseCreator?.()
    await creatorFailure
    expect(dispose).not.toHaveBeenCalled()
    releaseAdopter?.()
    await adopterFailure
    expect(subscribeChanges).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
    for (const handle of issuedHandles) {
      await expect(broker.observe(agent, { resource: handle }))
        .rejects.toSatisfy((error) => expectBrokerCode(error, 'invalid_resource_handle'))
    }
  })

  it('rolls back resources when Principal changes after issuance', async () => {
    let currentPrincipal: PrincipalSnapshot | null = principalA
    const dispose = vi.fn(async () => undefined)
    let issued: CapabilityResourceHandle | undefined
    const capability = defineCapability({
      id: 'transactional-resource.principal-switch',
      version: '1',
      title: 'Issue before Principal switch',
      description: 'Exercises post-handler Principal reauthorization rollback.',
      audiences: ['agent'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async (_input, context) => {
        issued = context.issueResource({
          resourceId: 'principal-switched-transactional-resource',
          resourceKind: 'transactional-resource',
          workspaceId: context.caller.workspaceId,
          semanticRevision: '1',
          observe: async () => ({ state: {}, semanticRevision: '1' }),
          dispose
        })
        currentPrincipal = principalB
        return { output: { ok: true } }
      }
    })
    const broker = new CapabilityBroker(new CapabilityRegistry([capability]), {
      resolveCurrentPrincipal: () => currentPrincipal
    })

    await expect(broker.invoke(agent, {
      actionId: capability.descriptor.id,
      invocationId: 'transactional-principal-switch-1',
      input: {}
    })).rejects.toSatisfy((error) => expectBrokerCode(error, 'principal_changed'))
    expect(dispose).toHaveBeenCalledOnce()
    await expect(broker.observe(agent, { resource: issued! }))
      .rejects.toSatisfy((error) => expectBrokerCode(error, 'invalid_resource_handle'))
  })
})
