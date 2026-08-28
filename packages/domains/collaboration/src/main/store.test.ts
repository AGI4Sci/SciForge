import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  FileCollaborationStateBackend,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'

test('restart recovery only rewinds safely replayable local and outbox work', async () => {
  const state: CollaborationLocalState = {
    schemaVersion: 2,
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

test('obsolete local Collaboration state fails with an explicit recovery boundary', async () => {
  const store = new CollaborationLocalStore(new MemoryBackend({ schemaVersion: 1 }))
  await assert.rejects(
    store.open(),
    /not schema version 2; clear the obsolete local Collaboration state and reconnect to Cloud/u
  )
})

test('file-backed obsolete Collaboration state is preserved and replaced with current empty state', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-collaboration-state-'))
  context.after(async () => rm(directory, { recursive: true, force: true }))
  const statePath = join(directory, 'state.json')
  const obsoleteState = '{"schemaVersion":1,"sentinel":"preserve-this-state"}\n'
  await writeFile(statePath, obsoleteState, { encoding: 'utf8', mode: 0o600 })

  const store = new CollaborationLocalStore(new FileCollaborationStateBackend(statePath))
  const recovered = await store.open()

  assert.equal(recovered.schemaVersion, 2)
  assert.equal(recovered.revision, 0)
  assert.deepEqual(recovered.outbox, [])
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).schemaVersion, 2)
  const preserved = (await readdir(directory)).filter((name) =>
    name.startsWith('state.json.unsupported-')
  )
  assert.equal(preserved.length, 1)
  assert.equal(await readFile(join(directory, preserved[0]!), 'utf8'), obsoleteState)
})

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}
