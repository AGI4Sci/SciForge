import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHANGE_INSPECTOR_RESOURCE_KIND,
  type ChangeInspectorSnapshot
} from './contract.js'
import { createChangeInspectorCapabilityFactory } from './main.js'

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
