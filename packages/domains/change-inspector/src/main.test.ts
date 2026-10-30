import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHANGE_INSPECTOR_CAPABILITY_IDS,
  CHANGE_INSPECTOR_RESOURCE_KIND,
  changeInspectorListChangesInputSchema,
  changeInspectorListChangesOutputSchema,
  type ChangeInspectorSnapshot
} from './contract.js'
import {
  createChangeInspectorCapabilityFactory,
  createDomainMainEntry,
  type ChangeInspectorCapabilityFactory
} from './main.js'

type CapabilityDefinition = Parameters<
  Parameters<typeof createChangeInspectorCapabilityFactory>[0]['defineCapability']
>[0]

function readContext(
  workspaceId?: string
): Parameters<CapabilityDefinition['handler']>[1] {
  return {
    caller: workspaceId === undefined ? {} : { workspaceId },
    issueResource: () => assert.fail('Listing changes must not issue resources.')
  }
}

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
  const listed = {
    changes: [],
    nextCursor: null,
    revision: snapshot.revision,
    truncated: false
  }
  const definitions: unknown[] = []
  const factory = createChangeInspectorCapabilityFactory<unknown>({
    defineCapability: (definition) => {
      definitions.push(definition)
      return definition
    },
    snapshot: async () => snapshot,
    listChanges: async () => listed
  })
  factory.createDefinitions()
  const rawDefinition = definitions.find((definition) =>
    (definition as { id?: string }).id === CHANGE_INSPECTOR_CAPABILITY_IDS.openSession
  )
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
  assert.ok(definition)
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

  assert.equal(definitions.length, 2)
  assert.ok(definitions.some((definition) =>
    (definition as { id?: string }).id === CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges
  ))
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
    snapshot: async () => snapshot,
    listChanges: async () => ({
      changes: [],
      nextCursor: null,
      revision: snapshot.revision,
      truncated: false
    })
  })
  const definition = factory.createDefinitions().find(({ id }) =>
    id === CHANGE_INSPECTOR_CAPABILITY_IDS.openSession
  )
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
    snapshot: async (input) => ({ ...snapshot, sessionId: input.sessionId }),
    listChanges: async () => ({
      changes: [],
      nextCursor: null,
      revision: snapshot.revision,
      truncated: false
    })
  })
  const definition = factory.createDefinitions().find(({ id }) =>
    id === CHANGE_INSPECTOR_CAPABILITY_IDS.openSession
  )
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
    },
    listChanges: async () => ({
      changes: [],
      nextCursor: null,
      revision: snapshot.revision,
      truncated: false
    })
  })
  const definition = factory.createDefinitions().find(({ id }) =>
    id === CHANGE_INSPECTOR_CAPABILITY_IDS.openSession
  )
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

test('list-changes is a governed read capability over the canonical snapshot store', async () => {
  const calls: Array<{ input: unknown; workspaceRoot: string }> = []
  const factory = createChangeInspectorCapabilityFactory({
    defineCapability: (definition) => definition,
    snapshot: async () => ({
      sessionId: 'thread-1',
      revision: 'revision-7',
      changes: [],
      truncated: false
    }),
    listChanges: async (input, workspaceRoot) => {
      calls.push({ input, workspaceRoot })
      return {
        changes: [],
        nextCursor: null,
        revision: 'revision-7',
        truncated: false
      }
    }
  })
  const definitions = new Map(
    factory.createDefinitions().map((definition) => [definition.id, definition])
  )
  const definition = definitions.get(CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges)
  assert.ok(definition)
  assert.equal(definition.effect, 'read')
  assert.equal(definition.approval, 'none')
  assert.equal(definition.scope, 'workspace')
  assert.deepEqual([...definition.audiences], ['ui', 'agent'])

  await assert.rejects(
    definition.handler({ sessionId: 'thread-1' }, readContext()),
    /requires an active workspace/u
  )
  assert.deepEqual(calls, [])

  const result = await definition.handler(
    { sessionId: 'thread-1', limit: 25, cursor: 'change-1' },
    readContext('/repo')
  )
  assert.deepEqual(result.output, {
    changes: [],
    nextCursor: null,
    revision: 'revision-7',
    truncated: false
  })
  assert.deepEqual(calls, [{
    input: { sessionId: 'thread-1', limit: 25, cursor: 'change-1' },
    workspaceRoot: '/repo'
  }])
})

test('list-changes resolves one session through Host thread authority end to end', async () => {
  const entry = createDomainMainEntry<CapabilityDefinition>({
    getUserDataDir: () => assert.fail('Listing changes must not access user data.'),
    defineCapability: (definition) => definition
  })
  const factory = entry.contributions[0]!.value as ChangeInspectorCapabilityFactory<CapabilityDefinition>
  const lifecycle = entry.contributions[1]!.value as {
    activate(context: unknown): Promise<() => void>
  }
  const definition = factory.createDefinitions().find(({ id }) =>
    id === CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges
  )
  assert.ok(definition)

  const unifiedDiff = [
    'diff --git a/note.txt b/note.txt',
    '--- a/note.txt',
    '+++ b/note.txt',
    '@@ -0,0 +1 @@',
    '+hello'
  ].join('\n')
  const readCalls: unknown[] = []
  const deactivate = await lifecycle.activate({
    agentThreads: {
      list: async () => [
        { id: 'thread-1', runtimeId: 'codex', workspaceRoot: '/repo' },
        { id: 'thread-2', runtimeId: 'codex', workspaceRoot: '/other' }
      ],
      read: async (identity: { runtimeId: string; threadId: string }) => {
        readCalls.push(identity)
        const workspaceRoot = identity.threadId === 'thread-2' ? '/other' : '/repo'
        if (identity.threadId === 'thread-2') {
          return {
            id: 'thread-2',
            runtimeId: 'codex',
            workspaceRoot,
            watermark: 'revision-2',
            turns: [],
            artifacts: []
          }
        }
        return {
          id: 'thread-1',
          runtimeId: 'codex',
          workspaceRoot,
          watermark: 'revision-9',
          turns: [],
          artifacts: [{
            kind: 'tool',
            toolKind: 'file_change',
            id: 'file-change-1',
            status: 'success',
            filePath: 'note.txt',
            detail: unifiedDiff,
            createdAt: '2026-10-26T00:00:00Z'
          }]
        }
      }
    }
  })

  const result = await definition.handler(
    { sessionId: 'thread-1' },
    readContext('/repo')
  )
  const output = changeInspectorListChangesOutputSchema.parse(result.output)
  assert.deepEqual(readCalls, [{ runtimeId: 'codex', threadId: 'thread-1' }])
  assert.equal(output.revision, 'revision-9')
  assert.equal(output.truncated, false)
  assert.equal(output.nextCursor, null)
  assert.equal(output.changes.length, 1)
  const summary = output.changes[0]
  assert.equal(summary.id, 'file-change-1')
  assert.equal(summary.status, 'success')
  assert.equal(summary.filePath, 'note.txt')
  assert.equal(summary.patch, unifiedDiff)
  assert.equal(summary.patchBytes, Buffer.byteLength(unifiedDiff))
  assert.equal(summary.patchTruncated, false)
  assert.equal(summary.occurredAt, '2026-10-26T00:00:00.000Z')

  await assert.rejects(
    definition.handler(
      { sessionId: 'thread-2' },
      readContext('/repo')
    ),
    /belongs to another workspace/u
  )
  await assert.rejects(
    definition.handler(
      { sessionId: 'thread-missing' },
      readContext('/repo')
    ),
    /is not available/u
  )
  await deactivate()
})

test('list-changes rejects a foreign-workspace session through the same path as open-session', async () => {
  const entry = createDomainMainEntry<CapabilityDefinition>({
    getUserDataDir: () => assert.fail('Listing changes must not access user data.'),
    defineCapability: (definition) => definition
  })
  const factory = entry.contributions[0]!.value as ChangeInspectorCapabilityFactory<CapabilityDefinition>
  const lifecycle = entry.contributions[1]!.value as {
    activate(context: unknown): Promise<() => void>
  }
  const definition = factory.createDefinitions().find(({ id }) =>
    id === CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges
  )
  assert.ok(definition)
  const openDefinition = factory.createDefinitions().find(({ id }) =>
    id === CHANGE_INSPECTOR_CAPABILITY_IDS.openSession
  )
  assert.ok(openDefinition)

  const threads = [
    { id: 'thread-a', runtimeId: 'codex', workspaceRoot: '/repo-a' },
    { id: 'thread-b', runtimeId: 'codex', workspaceRoot: '/repo-b' }
  ]
  const activateHost = () => lifecycle.activate({
    agentThreads: {
      list: async () => threads,
      read: async (identity: { threadId: string }) => {
        const thread = threads.find((candidate) =>
          candidate.id === identity.threadId
        )
        return {
          id: thread!.id,
          runtimeId: thread!.runtimeId,
          workspaceRoot: thread!.workspaceRoot,
          watermark: 'revision-1',
          turns: [],
          artifacts: []
        }
      }
    }
  })

  // open-session establishes the canonical rejection this port must mirror.
  const deactivate = await activateHost()
  await assert.rejects(
    openDefinition.handler(
      { sessionId: 'thread-b', runtimeId: 'codex' },
      { caller: { workspaceId: '/repo-a' }, issueResource: () => undefined }
    ),
    (error: unknown) => error instanceof Error &&
      error.message === 'The requested session belongs to another workspace.'
  )

  const foreign = await definition.handler(
    { sessionId: 'thread-b' },
    readContext('/repo-a')
  ).then(
    () => null,
    (error: unknown) => error as Error
  )
  assert.ok(foreign instanceof Error)
  assert.equal(
    foreign.message,
    'The requested session belongs to another workspace.'
  )
  const own = await definition.handler(
    { sessionId: 'thread-a' },
    readContext('/repo-a')
  )
  assert.equal(changeInspectorListChangesOutputSchema.parse(own.output).revision, 'revision-1')
  await deactivate()
})

test('list-changes rejects an over-limit page instead of silently clamping', async () => {
  let listCalls = 0
  const factory = createChangeInspectorCapabilityFactory({
    defineCapability: (definition) => definition,
    snapshot: async () => ({
      sessionId: 'thread-1',
      revision: 'revision-7',
      changes: [],
      truncated: false
    }),
    listChanges: async () => {
      listCalls += 1
      return {
        changes: [],
        nextCursor: null,
        revision: 'revision-7',
        truncated: false
      }
    }
  })
  const definition = factory.createDefinitions().find(({ id }) =>
    id === CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges
  )
  assert.ok(definition)

  // The strict contract rejects over-limit input; nothing is dispatched.
  assert.equal(changeInspectorListChangesInputSchema.safeParse({
    sessionId: 'thread-1',
    limit: 999_999
  }).success, false)
  await assert.rejects(
    definition.handler(
      { sessionId: 'thread-1', limit: 999_999 },
      readContext('/repo')
    ),
    (error: unknown) => error instanceof Error && error.name === 'ZodError'
  )
  assert.equal(listCalls, 0)
})

test('list-changes performs zero writes against the Host record store', async () => {
  const entry = createDomainMainEntry<CapabilityDefinition>({
    getUserDataDir: () => assert.fail('Listing changes must not access user data.'),
    defineCapability: (definition) => definition
  })
  const factory = entry.contributions[0]!.value as ChangeInspectorCapabilityFactory<CapabilityDefinition>
  const lifecycle = entry.contributions[1]!.value as {
    activate(context: unknown): Promise<() => void>
  }
  const definition = factory.createDefinitions().find(({ id }) =>
    id === CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges
  )
  assert.ok(definition)

  const detail = deepFreeze({
    id: 'thread-1',
    runtimeId: 'codex',
    workspaceRoot: '/repo',
    watermark: 'revision-11',
    turns: [],
    artifacts: [{
      kind: 'tool',
      toolKind: 'file_change',
      id: 'file-change-1',
      status: 'success',
      filePath: 'big.txt',
      createdAt: '2026-10-26T00:00:00Z',
      detail: `--- a/big.txt\n+++ b/big.txt\n@@ -1 +1 @@\n-${'a'.repeat(4_000)}\n+${'b'.repeat(4_000)}`
    }, {
      kind: 'tool',
      toolKind: 'file_change',
      id: 'file-change-2',
      status: 'success',
      filePath: 'small.txt',
      detail: '--- a/small.txt\n+++ b/small.txt\n@@ -1 +1 @@\n-a\n+b'
    }]
  })
  const pristine = JSON.parse(JSON.stringify(detail))
  let listCalls = 0
  let readCalls = 0
  const deactivate = await lifecycle.activate({
    agentThreads: {
      list: async () => {
        listCalls += 1
        return [{ id: 'thread-1', runtimeId: 'codex', workspaceRoot: '/repo' }]
      },
      read: async () => {
        readCalls += 1
        return detail
      }
    }
  })

  // Two bounded walks, including the truncation path, over frozen records:
  // any attempted write would throw under strict-mode ESM, and any mutation
  // that slipped through would surface in the before/after deep comparison.
  const first = await definition.handler(
    { sessionId: 'thread-1', limit: 1 },
    readContext('/repo')
  )
  const firstOutput = changeInspectorListChangesOutputSchema.parse(first.output)
  assert.equal(firstOutput.changes.length, 1)
  assert.equal(firstOutput.nextCursor, 'file-change-1')
  const second = await definition.handler(
    { sessionId: 'thread-1', cursor: firstOutput.nextCursor ?? '' },
    readContext('/repo')
  )
  const secondOutput = changeInspectorListChangesOutputSchema.parse(second.output)
  assert.equal(secondOutput.changes.length, 1)
  assert.equal(secondOutput.nextCursor, null)

  assert.deepEqual(JSON.parse(JSON.stringify(detail)), pristine)
  assert.equal(listCalls, 2)
  assert.equal(readCalls, 2)
  await deactivate()
})

test('list-changes fails closed with an explicit error for a nonexistent session', async () => {
  const entry = createDomainMainEntry<CapabilityDefinition>({
    getUserDataDir: () => assert.fail('Listing changes must not access user data.'),
    defineCapability: (definition) => definition
  })
  const factory = entry.contributions[0]!.value as ChangeInspectorCapabilityFactory<CapabilityDefinition>
  const lifecycle = entry.contributions[1]!.value as {
    activate(context: unknown): Promise<() => void>
  }
  const definition = factory.createDefinitions().find(({ id }) =>
    id === CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges
  )
  assert.ok(definition)
  const deactivate = await lifecycle.activate({
    agentThreads: {
      list: async () => [
        { id: 'thread-1', runtimeId: 'codex', workspaceRoot: '/repo' }
      ],
      read: async () => {
        throw new Error('read must not run for an unknown session.')
      }
    }
  })

  const failure = await definition.handler(
    { sessionId: 'thread-missing' },
    readContext('/repo')
  ).then(
    () => null,
    (error: unknown) => error as Error
  )
  assert.ok(failure instanceof Error)
  assert.match(failure.message, /thread-missing is not available/u)
  await deactivate()
})

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}
