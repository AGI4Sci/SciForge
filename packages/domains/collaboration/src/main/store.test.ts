import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TEST_HASH,
  TEST_IDS,
  TEST_TIMESTAMP,
  remoteSessionProjectionFixture,
  userPrincipalFixture
} from '@sciforge/collaboration-contracts/testing'
import {
  CollaborationLocalStore,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'

test('restart recovery only rewinds safely replayable local and outbox work', async () => {
  const state: CollaborationLocalState = {
    schemaVersion: 1,
    revision: 4,
    lastInboxSequence: 8,
    user: userPrincipalFixture,
    endpoints: [],
    endpointLocators: [],
    managedContainers: [],
    agents: [],
    projections: [{
      projection: remoteSessionProjectionFixture,
      runtimeId: 'codex',
      threadId: 'thread-stable-1',
      bindingMode: 'existing',
      nextSequence: 2
    }],
    projects: [],
    tasks: [],
    taskRuns: [],
    workerAcceptancePolicies: [],
    queue: [{
      queueItemId: 'lqi_Queue00000001',
      projectionId: TEST_IDS.projectionId,
      sequence: 1,
      direction: 'inbound',
      origin: 'human-endpoint',
      kind: 'user-message',
      senderUserId: TEST_IDS.userId,
      senderHumanEndpointId: TEST_IDS.humanEndpointId,
      providerMessageId: 'provider-message-1',
      localItemId: TEST_IDS.localItemId,
      clientDirectiveId: 'collab-directive-stable-1',
      contentHash: TEST_HASH,
      text: '继续分析。',
      state: 'executing',
      attempts: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    }],
    receipts: [],
    outbox: [{
      outboxId: 'obx_Outbox000001',
      idempotencyKey: 'idem_projection.test-1',
      kind: 'projection.message',
      body: {},
      state: 'sending',
      attempts: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    }],
    diagnostics: [],
    remoteApprovals: []
  }
  const store = new CollaborationLocalStore(new MemoryBackend(state))
  const recovered = await store.open()

  assert.equal(recovered.queue[0]?.state, 'reconciling')
  assert.equal(recovered.outbox[0]?.state, 'reconciling')
  assert.equal(recovered.revision, 5)
})

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}
