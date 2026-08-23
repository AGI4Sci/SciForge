import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TEST_HASH,
  TEST_IDS,
  TEST_TIMESTAMP,
  agentNodeFixture,
  remoteSessionProjectionFixture,
  taskFixture,
  userPrincipalFixture
} from '@sciforge/collaboration-contracts/testing'
import {
  CollaborationLocalStore,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'

test('restart recovery reconciles in-flight projection, outbox, and Task identities', async () => {
  const state: CollaborationLocalState = {
    schemaVersion: 1,
    revision: 4,
    lastInboxSequence: 8,
    user: userPrincipalFixture,
    endpoints: [],
    endpointLocators: [],
    managedContainers: [],
    agents: [agentNodeFixture],
    projections: [{
      projection: remoteSessionProjectionFixture,
      runtimeId: 'codex',
      threadId: 'thread-stable-1',
      bindingMode: 'existing',
      nextSequence: 2
    }],
    projects: [],
    tasks: [taskFixture],
    taskRuns: [{
      task: taskFixture,
      state: 'running',
      runtimeId: 'codex',
      threadId: 'task-thread-1',
      clientDirectiveId: 'collab-task-stable-1',
      localTurnId: 'runtime-turn-1',
      startedAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    }],
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
    receipts: [{
      receiptKey: 'provider:projection:message-1',
      contentHash: TEST_HASH,
      queueItemId: 'lqi_Queue00000001',
      projectionId: TEST_IDS.projectionId,
      status: 'processing',
      providerMessageId: 'provider-message-1',
      localItemId: TEST_IDS.localItemId,
      attempts: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    }],
    outbox: [{
      outboxId: 'obx_Outbox000001',
      idempotencyKey: 'idem_projection.test-1',
      kind: 'projection.message',
      body: { type: 'fixture' },
      state: 'sending',
      attempts: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    }],
    diagnostics: [],
    remoteApprovals: []
  }
  const backend = new MemoryBackend(state)
  const store = new CollaborationLocalStore(backend)
  const recovered = await store.open()

  assert.equal(recovered.queue[0]?.state, 'reconciling')
  assert.equal(recovered.outbox[0]?.state, 'reconciling')
  assert.equal(recovered.taskRuns[0]?.state, 'reconciling')
  assert.equal(recovered.queue[0]?.clientDirectiveId, 'collab-directive-stable-1')
  assert.equal(recovered.taskRuns[0]?.clientDirectiveId, 'collab-task-stable-1')
  assert.equal(recovered.revision, 5)
  assert.equal(backend.writes, 1)
})

class MemoryBackend implements CollaborationStateBackend {
  writes = 0

  constructor(private value: unknown) {}

  async read(): Promise<unknown> {
    return structuredClone(this.value)
  }

  async write(value: CollaborationLocalState): Promise<void> {
    this.writes += 1
    this.value = structuredClone(value)
  }
}
