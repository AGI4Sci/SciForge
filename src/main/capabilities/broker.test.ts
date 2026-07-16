import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import type {
  CapabilityAudience,
  CapabilityCallerContextInput,
  CapabilityInvocationRequest,
  CapabilityResourceHandle
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
    observe: async () => ({
      state: { title: 'Paper', annotationCount: 0 },
      semanticRevision,
      layoutRevision: 'layout-2',
      operationIds: ['document.read-section', 'document.annotation-upsert']
    })
  })
}

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
  })

  it('discovers only actions registered for the caller audience and resource kind', () => {
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
    const registry = new CapabilityRegistry([readCapability(), uiOnly])

    expect(registry.discover(agent, { resourceKind: 'document' }).map((item) => item.id))
      .toEqual(['document.read-section'])
    expect(registry.discover(ui, { resourceKind: 'document' }).map((item) => item.id))
      .toEqual(['document.human-review', 'document.read-section'])
  })
})

describe('CapabilityBroker', () => {
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
    const handle = issueDocument(broker)
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
})
