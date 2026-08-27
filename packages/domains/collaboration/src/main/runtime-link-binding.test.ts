import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentNodeFixture,
  humanEndpointBindingFixture,
  remoteSessionProjectionFixture,
  userPrincipalFixture
} from '@sciforge/collaboration-contracts/testing'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { AgentCloudRuntime } from '@sciforge/domain-identity-access/agent-cloud-runtime'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import { CollaborationRuntime } from './runtime.js'
import {
  CollaborationLocalStore,
  EMPTY_COLLABORATION_LOCAL_STATE,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'

test('serializes concurrent links so one local Session can permanently claim only one Topic', async () => {
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    user: userPrincipalFixture,
    endpoints: [humanEndpointBindingFixture],
    agents: [agentNodeFixture]
  })
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: settings,
    authenticatedCloudTransport: {} as AuthenticatedCloudTransport,
    agentCloudRuntime: {} as AgentCloudRuntime,
    stateBackend: backend
  })
  const internals = runtime as unknown as {
    store: CollaborationLocalStore
    connection: { executeAsUser: (request: unknown) => Promise<unknown> }
    active: boolean
  }
  await internals.store.open()
  internals.active = true
  let releaseFirst!: () => void
  let enteredFirst!: () => void
  const firstMayReturn = new Promise<void>((resolve) => { releaseFirst = resolve })
  const firstEntered = new Promise<void>((resolve) => { enteredFirst = resolve })
  let cloudCreates = 0
  internals.connection = {
    executeAsUser: async () => {
      cloudCreates += 1
      enteredFirst()
      await firstMayReturn
      return { protocolVersion: '1.0', type: 'rest.entity', entity: remoteSessionProjectionFixture }
    }
  }
  const base = {
    mode: 'existing' as const,
    agentId: agentNodeFixture.agentId,
    humanEndpointId: humanEndpointBindingFixture.humanEndpointId,
    locator: remoteSessionProjectionFixture.locator,
    runtimeId: 'codex',
    threadId: 'fixed-thread',
    displayName: 'Fixed Session'
  }
  const first = runtime.linkProjection(base)
  await firstEntered
  const second = runtime.linkProjection({
    ...base,
    locator: { ...base.locator, topicId: 'topic_other_1234', topicDisplayName: 'Other Topic' }
  })
  releaseFirst()

  const [firstResult, secondResult] = await Promise.allSettled([first, second])
  assert.equal(firstResult.status, 'fulfilled')
  assert.equal(secondResult.status, 'rejected')
  assert.match(String((secondResult as PromiseRejectedResult).reason), /permanently bound/u)
  assert.equal(cloudCreates, 1)
})

const settings: DomainMainPackageSettingsHost = {
  read: async () => ({ revision: 0, value: null }),
  write: async () => { throw new Error('Settings writes are not expected.') },
  clear: async () => { throw new Error('Settings writes are not expected.') }
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}
