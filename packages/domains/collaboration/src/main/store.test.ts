import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  FileCollaborationStateBackend,
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

test('current state defaults the persisted Project unavailable fence collection', async () => {
  const { projectUnavailableFences: _omitted, ...stored } = EMPTY_COLLABORATION_LOCAL_STATE
  const store = new CollaborationLocalStore(new MemoryBackend(stored))

  await store.open()

  assert.deepEqual(store.snapshot().projectUnavailableFences, [])
})

test('restart recovery only rewinds safely replayable local and outbox work', async () => {
  const state: CollaborationLocalState = {
    schemaVersion: 4,
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
    projectUnavailableFences: [],
    tasks: [],
    taskRuns: [],
    taskInteractions: [],
    taskCheckpoints: [],
    pendingTaskOffers: [],
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
    outboxWait: null,
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
    /clear the obsolete local Collaboration state and reconnect to Cloud/u
  )
  assert.equal(backend.writes, 0)
})

test('file-backed obsolete Collaboration state is preserved and replaced with current empty state', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-collaboration-state-'))
  context.after(async () => rm(directory, { recursive: true, force: true }))
  const statePath = join(directory, 'state.json')
  const obsoleteState = '{"schemaVersion":2,"sentinel":"preserve-this-state"}\n'
  await writeFile(statePath, obsoleteState, { encoding: 'utf8', mode: 0o600 })

  const store = new CollaborationLocalStore(new FileCollaborationStateBackend(statePath))
  const recovered = await store.open()

  assert.equal(recovered.schemaVersion, 4)
  assert.equal(recovered.revision, 0)
  assert.deepEqual(recovered.outbox, [])
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).schemaVersion, 4)
  const preserved = (await readdir(directory)).filter((name) =>
    name.startsWith('state.json.unsupported-')
  )
  assert.equal(preserved.length, 1)
  assert.equal(await readFile(join(directory, preserved[0]!), 'utf8'), obsoleteState)
})

test('file-backed schema v3 state with unrecognized keys is quarantined and replaced with empty state', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-collaboration-state-'))
  context.after(async () => rm(directory, { recursive: true, force: true }))
  const statePath = join(directory, 'state.json')
  const driftedState = `${JSON.stringify({
    schemaVersion: 3,
    revision: 7,
    lastInboxSequence: 0,
    endpoints: [],
    endpointLocators: [],
    managedContainers: [],
    agents: [],
    projections: [],
    sessionBindings: [],
    projects: [],
    projectUnavailableFences: [],
    tasks: [],
    taskRuns: [],
    pendingTaskOffers: [],
    queue: [],
    receipts: [],
    outbox: [],
    diagnostics: [],
    contentMode: 'key-dropped-by-a-newer-build'
  })}\n`
  await writeFile(statePath, driftedState, { encoding: 'utf8', mode: 0o600 })

  const store = new CollaborationLocalStore(new FileCollaborationStateBackend(statePath))
  const recovered = await store.open()

  assert.equal(recovered.schemaVersion, EMPTY_COLLABORATION_LOCAL_STATE.schemaVersion)
  assert.equal(recovered.revision, 0)
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).revision, 0)
  const preserved = (await readdir(directory)).filter((name) =>
    name.startsWith('state.json.unsupported-')
  )
  assert.equal(preserved.length, 1)
  assert.equal(await readFile(join(directory, preserved[0]!), 'utf8'), driftedState)
})

test('schema-validating state fails closed without rewrite when the backend cannot quarantine', async () => {
  const backend = new MemoryBackend({ schemaVersion: 3, revision: 1, rogue: true })
  const store = new CollaborationLocalStore(backend)
  await assert.rejects(
    store.open(),
    /clear the obsolete local Collaboration state and reconnect to Cloud/u
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

test('schema v3 upgrade removes automatic configuration and cannot replay an unconfirmed automatic claim', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-manual-offer-upgrade-'))
  try {
    const path = join(directory, 'collaboration.json')
    const offerId = 'ofr_LegacyAutomatic01'
    await writeFile(path, JSON.stringify({
      ...EMPTY_COLLABORATION_LOCAL_STATE,
      workerAcceptancePolicies: [{ agentId: TEST_IDS.agentId, mode: 'automatic', updatedAt: TEST_TIMESTAMP }],
      pendingTaskOffers: [{ projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
        taskOfferId: offerId, workerUserId: TEST_IDS.userId, currentTaskRevision: 1, offerRevision: 1,
        recipientAgentId: TEST_IDS.agentId, receivedAt: TEST_TIMESTAMP, preflightReasons: [],
        state: 'claiming', updatedAt: TEST_TIMESTAMP, completedAt: null, error: null }],
      outbox: [{ outboxId: 'obx_LegacyAutomatic01', idempotencyKey: 'idem_legacy_automatic_offer',
        kind: 'task.offer-decision', body: { type: 'task.offer.accept', taskOfferId: offerId },
        state: 'sending', attempts: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP }]
    }))
    const store = new CollaborationLocalStore(new FileCollaborationStateBackend(path))
    await store.open()
    assert.equal(store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')
    assert.equal(store.snapshot().outbox.length, 0)
    assert.equal('workerAcceptancePolicies' in store.snapshot(), false)
    const persisted = JSON.parse(await readFile(path, 'utf8'))
    assert.equal('workerAcceptancePolicies' in persisted, false)
    const reopened = new CollaborationLocalStore(new FileCollaborationStateBackend(path))
    await reopened.open()
    assert.equal(reopened.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
