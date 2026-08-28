import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agentNodeFixture,
  humanEndpointBindingFixture,
  participantProfileFixture,
  TEST_HASH,
  TEST_IDS,
  TEST_TIMESTAMP,
  remoteSessionProjectionFixture,
  userPrincipalFixture
} from '@sciforge/collaboration-contracts/testing'
import {
  CollaborationLocalStore,
  EMPTY_COLLABORATION_LOCAL_STATE,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'

test('a new signed-in User may replace only an unbound identity cache', async () => {
  const store = new CollaborationLocalStore(new MemoryBackend(replaceableOtherUserCache()))
  await store.open()

  await store.prepareForAuthenticatedUser(TEST_IDS.userId)

  const state = store.snapshot()
  assert.equal(state.revision, 5)
  assert.equal(state.user, undefined)
  assert.equal(state.participant, undefined)
  assert.deepEqual(state.agents, [])
  assert.deepEqual(state.outbox, [])
  assert.deepEqual(state.diagnostics, [])
})

test('a new signed-in User cannot replace a cache with a bound phone endpoint', async () => {
  const cached = replaceableOtherUserCache()
  cached.endpoints = [{ ...humanEndpointBindingFixture, userId: TEST_IDS.secondUserId }]
  cached.participant = {
    ...participantProfileFixture,
    userId: TEST_IDS.secondUserId
  }
  const store = new CollaborationLocalStore(new MemoryBackend(cached))
  await store.open()

  await assert.rejects(
    store.prepareForAuthenticatedUser(TEST_IDS.userId),
    /already has Phone Link or Session data/u
  )

  const state = store.snapshot()
  assert.equal(state.user?.userId, TEST_IDS.secondUserId)
  assert.equal(state.endpoints.length, 1)
  assert.equal(state.revision, 4)
})

test('restart recovery only rewinds safely replayable local and outbox work', async () => {
  const state: CollaborationLocalState = {
    schemaVersion: 3,
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
    pendingTaskOffers: [],
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

test('schema v2 local Collaboration state fails closed without being rewritten', async () => {
  const backend = new MemoryBackend({ schemaVersion: 2 })
  const store = new CollaborationLocalStore(backend)
  await assert.rejects(
    store.open(),
    /not schema version 3; clear the obsolete local Collaboration state and reconnect to Cloud/u
  )
  assert.equal(backend.writes, 0)
})

class MemoryBackend implements CollaborationStateBackend {
  writes = 0
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> {
    this.value = structuredClone(value)
    this.writes += 1
  }
}

function replaceableOtherUserCache(): CollaborationLocalState {
  return {
    ...structuredClone(EMPTY_COLLABORATION_LOCAL_STATE),
    revision: 4,
    user: { ...userPrincipalFixture, userId: TEST_IDS.secondUserId },
    participant: {
      ...participantProfileFixture,
      userId: TEST_IDS.secondUserId,
      primaryHumanEndpointId: null,
      status: 'incomplete'
    },
    agents: [{ ...agentNodeFixture, ownerUserId: TEST_IDS.secondUserId }],
    outbox: [{
      outboxId: 'obx_OtherUser0001',
      idempotencyKey: 'idem_worker.availability.other-user-1',
      kind: 'worker.availability',
      body: {},
      state: 'pending',
      attempts: 0,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    }],
    diagnostics: [{
      code: 'collaboration.connection_error',
      severity: 'error',
      message: 'Safe cached diagnostic.',
      recoverable: true,
      occurredAt: TEST_TIMESTAMP
    }]
  }
}
