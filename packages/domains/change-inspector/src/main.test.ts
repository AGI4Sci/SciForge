import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHANGE_INSPECTOR_RESOURCE_KIND,
  type ChangeInspectorSnapshot
} from './contract.js'
import { createChangeInspectorCapabilityFactory } from './main.js'

type ChangeInspectorResourceRegistration = Readonly<{
  resourceId: string
  resourceKind: string
  workspaceId?: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  semanticRevision: string
  observe: () => Promise<{
    state: ChangeInspectorSnapshot
    semanticRevision: string
    operationIds: readonly string[]
  }>
  dispose: () => void
  retireAfterLastHandleExpires: true
}>

test('issues a read-only observed resource for one session', async () => {
  const snapshot: ChangeInspectorSnapshot = {
    sessionId: 'thread-1',
    revision: 'revision-7',
    changes: [],
    truncated: false
  }
  const definitions: unknown[] = []
  const factory = createChangeInspectorCapabilityFactory<unknown>({
    defineCapability: (definition) => {
      definitions.push(definition)
      return definition
    },
    snapshot: async () => snapshot
  })
  const [rawDefinition] = factory.createDefinitions()
  const definition = rawDefinition as {
    effect: string
    handler: (
      input: unknown,
      context: {
        caller: { workspaceId?: string }
        issueResource: (registration: unknown) => unknown
      }
    ) => Promise<{ output: unknown }>
  }
  let rawRegistration: unknown
  const handle = {
    token: `cap_${'a'.repeat(24)}`,
    semanticRevision: snapshot.revision,
    expiresAt: '2026-07-28T12:00:00.000Z'
  }
  const result = await definition.handler({
    sessionId: 'thread-1',
    runtimeId: 'codex'
  }, {
    caller: { workspaceId: '/repo' },
    issueResource: (registration) => {
      rawRegistration = registration
      return handle
    }
  })

  assert.equal(definitions.length, 1)
  assert.equal(definition.effect, 'read')
  assert.deepEqual(result.output, { resource: handle, sessionId: 'thread-1' })

  const registration = rawRegistration as {
    resourceKind: string
    semanticRevision: string
    observe: () => Promise<{
      state: ChangeInspectorSnapshot
      semanticRevision: string
    }>
  }
  assert.equal(registration.resourceKind, CHANGE_INSPECTOR_RESOURCE_KIND)
  assert.equal(registration.semanticRevision, snapshot.revision)
  assert.deepEqual(await registration.observe(), {
    state: snapshot,
    semanticRevision: snapshot.revision,
    operationIds: []
  })
})

test('repeated opens reuse the exact observer accepted by strict resource binding', async () => {
  const snapshot: ChangeInspectorSnapshot = {
    sessionId: 'thread-1',
    revision: 'revision-7',
    changes: [],
    truncated: false
  }
  const factory = createChangeInspectorCapabilityFactory({
    defineCapability: (definition) => definition,
    snapshot: async () => snapshot
  })
  const [definition] = factory.createDefinitions()
  assert.ok(definition)
  const registrations: ChangeInspectorResourceRegistration[] = []
  const bindingsByIdentity = new Map<
    string,
    Pick<ChangeInspectorResourceRegistration, 'observe' | 'dispose'>
  >()
  let handleOrdinal = 0
  const issueResource = (rawRegistration: unknown): unknown => {
    const registration = rawRegistration as ChangeInspectorResourceRegistration
    const key = JSON.stringify([
      registration.workspaceId ?? null,
      registration.resourceKind,
      registration.resourceId,
      [...registration.audiences].sort()
    ])
    const existing = bindingsByIdentity.get(key)
    if (
      existing &&
      (existing.observe !== registration.observe || existing.dispose !== registration.dispose)
    ) {
      throw new Error('resource_registration_conflict')
    }
    bindingsByIdentity.set(key, registration)
    registrations.push(registration)
    handleOrdinal += 1
    return {
      token: `cap_${String(handleOrdinal).padStart(24, 'a')}`,
      semanticRevision: registration.semanticRevision,
      expiresAt: '2026-07-28T12:00:00.000Z'
    }
  }
  const input = { sessionId: 'thread-1', runtimeId: 'codex' }
  const context = {
    caller: { workspaceId: '/repo' },
    issueResource
  }

  await definition.handler(input, context)
  await definition.handler(input, context)

  assert.equal(registrations.length, 2)
  assert.strictEqual(registrations[0]?.observe, registrations[1]?.observe)
  assert.strictEqual(registrations[0]?.dispose, registrations[1]?.dispose)
  assert.equal(registrations[0]?.retireAfterLastHandleExpires, true)
})

test('canonical resource identities separate delimiter collisions and workspaces', async () => {
  const snapshot: ChangeInspectorSnapshot = {
    sessionId: 'thread',
    revision: 'revision-1',
    changes: [],
    truncated: false
  }
  const factory = createChangeInspectorCapabilityFactory({
    defineCapability: (definition) => definition,
    snapshot: async (input) => ({ ...snapshot, sessionId: input.sessionId })
  })
  const [definition] = factory.createDefinitions()
  assert.ok(definition)
  const registrations: ChangeInspectorResourceRegistration[] = []
  const issueResource = (registration: unknown): unknown => {
    const parsed = registration as ChangeInspectorResourceRegistration
    registrations.push(parsed)
    return {
      token: `cap_${String(registrations.length).padStart(24, 'a')}`,
      semanticRevision: parsed.semanticRevision,
      expiresAt: '2026-07-28T12:00:00.000Z'
    }
  }
  const principalCaller = {
    workspaceId: '/repo',
    principalContextVersion: 9,
    principal: {
      authority: 'local.sciforge',
      subject: 'usr_alice',
      assurance: 'local-selection' as const,
      deviceId: 'device-1',
      identityVersion: 9
    }
  }

  await definition.handler(
    { runtimeId: 'codex:remote', sessionId: 'thread' },
    { caller: { workspaceId: '/repo' }, issueResource }
  )
  await definition.handler(
    { runtimeId: 'codex', sessionId: 'remote:thread' },
    { caller: { workspaceId: '/repo' }, issueResource }
  )
  await definition.handler(
    { runtimeId: 'codex:remote', sessionId: 'thread' },
    { caller: { workspaceId: '/other-repo' }, issueResource }
  )
  await definition.handler(
    { runtimeId: 'codex:remote', sessionId: 'thread' },
    {
      caller: principalCaller,
      issueResource
    }
  )

  assert.notEqual(registrations[0]?.resourceId, registrations[1]?.resourceId)
  assert.match(registrations[0]?.resourceId ?? '', /^session-changes:[a-f0-9]{64}$/u)
  assert.notStrictEqual(registrations[0]?.observe, registrations[1]?.observe)
  assert.notStrictEqual(registrations[0]?.observe, registrations[2]?.observe)
  assert.notStrictEqual(registrations[0]?.observe, registrations[3]?.observe)

  registrations[0]!.dispose()
  await definition.handler(
    { runtimeId: 'codex:remote', sessionId: 'thread' },
    { caller: principalCaller, issueResource }
  )
  assert.strictEqual(registrations[3]?.observe, registrations[4]?.observe)
  assert.strictEqual(registrations[3]?.dispose, registrations[4]?.dispose)
})

test('retirement disposes only the exact binding and frees bounded capacity', async () => {
  const snapshot: ChangeInspectorSnapshot = {
    sessionId: 'thread',
    revision: 'revision-1',
    changes: [],
    truncated: false
  }
  let snapshotCalls = 0
  const factory = createChangeInspectorCapabilityFactory({
    defineCapability: (definition) => definition,
    snapshot: async (input) => {
      snapshotCalls += 1
      return { ...snapshot, sessionId: input.sessionId }
    }
  })
  const [definition] = factory.createDefinitions()
  assert.ok(definition)
  const registrations: ChangeInspectorResourceRegistration[] = []
  const issueResource = (registration: unknown): unknown => {
    const parsed = registration as ChangeInspectorResourceRegistration
    registrations.push(parsed)
    return {
      token: `cap_${String(registrations.length).padStart(24, 'a')}`,
      semanticRevision: parsed.semanticRevision,
      expiresAt: '2026-07-28T12:00:00.000Z'
    }
  }
  const invokeOpen = (sessionId: string) => definition.handler(
    { runtimeId: 'codex', sessionId },
    { caller: { workspaceId: '/repo' }, issueResource }
  )

  for (let index = 0; index < 512; index += 1) {
    await invokeOpen(`thread-${index}`)
  }
  await assert.rejects(
    invokeOpen('thread-over-capacity'),
    /resource capacity is exhausted/u
  )
  assert.equal(snapshotCalls, 512)

  const retired = registrations[0]!
  retired.dispose()
  await invokeOpen('thread-over-capacity')
  const replacement = registrations.at(-1)!
  assert.notStrictEqual(replacement.observe, retired.observe)
  retired.dispose()
  await invokeOpen('thread-over-capacity')
  assert.strictEqual(registrations.at(-1)?.observe, replacement.observe)
  assert.strictEqual(registrations.at(-1)?.dispose, replacement.dispose)

  factory.dispose()
  await invokeOpen('thread-over-capacity')
  assert.notStrictEqual(registrations.at(-1)?.observe, replacement.observe)
})
