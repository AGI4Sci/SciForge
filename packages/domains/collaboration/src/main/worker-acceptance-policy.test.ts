import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TEST_IDS,
  TEST_TIMESTAMP,
  agentNodeFixture
} from '@sciforge/collaboration-contracts/testing'
import {
  CollaborationLocalStore,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'
import { WorkerAcceptancePolicyService } from './worker-acceptance-policy.js'

test('Worker acceptance policy defaults to manual and persists independently per Agent Device', async () => {
  const backend = new MemoryBackend({
    schemaVersion: 1,
    revision: 0,
    lastInboxSequence: 0,
    endpoints: [],
    endpointLocators: [],
    agents: [agentNodeFixture],
    projections: [],
    projects: [],
    tasks: [],
    taskRuns: [],
    queue: [],
    receipts: [],
    outbox: [],
    diagnostics: []
  })
  const store = new CollaborationLocalStore(backend)
  await store.open()
  const policies = new WorkerAcceptancePolicyService(
    store,
    () => new Date(TEST_TIMESTAMP)
  )

  assert.equal(policies.read(TEST_IDS.agentId), 'manual')
  assert.equal(await policies.update(TEST_IDS.agentId, 'automatic'), 'automatic')
  assert.equal(policies.read(TEST_IDS.agentId), 'automatic')

  const reopened = new CollaborationLocalStore(backend)
  await reopened.open()
  assert.equal(new WorkerAcceptancePolicyService(reopened).read(TEST_IDS.agentId), 'automatic')
})

test('Worker acceptance policy cannot be attached to a missing or revoked local Agent', async () => {
  const store = new CollaborationLocalStore(new MemoryBackend({
    schemaVersion: 1,
    revision: 0,
    lastInboxSequence: 0,
    endpoints: [],
    endpointLocators: [],
    agents: [],
    projections: [],
    projects: [],
    tasks: [],
    taskRuns: [],
    queue: [],
    receipts: [],
    outbox: [],
    diagnostics: []
  }))
  await store.open()

  await assert.rejects(
    new WorkerAcceptancePolicyService(store).update(TEST_IDS.agentId, 'automatic'),
    /requires this Device active Agent/u
  )
})

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}

  async read(): Promise<unknown> {
    return structuredClone(this.value)
  }

  async write(value: CollaborationLocalState): Promise<void> {
    this.value = structuredClone(value)
  }
}
