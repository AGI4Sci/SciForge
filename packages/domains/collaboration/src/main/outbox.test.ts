import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RestRequest, RestResponse } from '@sciforge/collaboration-contracts'
import { TEST_HASH, TEST_IDS, TEST_TIMESTAMP } from '@sciforge/collaboration-contracts/testing'
import type { DomainMainPackageSecretStoreHost } from '@sciforge/domain-sdk/package-storage'
import type {
  CollaborationCloudClient,
  CollaborationCredential
} from './cloud-client.js'
import { DurableCloudOutbox } from './outbox.js'
import {
  CollaborationLocalStore,
  EMPTY_COLLABORATION_LOCAL_STATE,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'

const DEVICE_CREDENTIAL = `device-${'x'.repeat(32)}`
const IDEMPOTENCY_KEY = 'idem_projection.outbox-recovery-01'
const COMMAND = {
  projectionId: TEST_IDS.projectionId,
  projectionRevision: 1,
  localItemId: TEST_IDS.localItemId,
  kind: 'user_message' as const,
  text: '同步一次',
  occurredAt: TEST_TIMESTAMP
}

test('coalesces the same logical command when only its request id changes', async () => {
  const store = await localStore()
  const outbox = new DurableCloudOutbox({
    store,
    packageSecrets: new MemorySecretStore(),
    cloudClient: () => null
  })

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)

  assert.equal(store.snapshot().outbox.length, 1)
  await assert.rejects(
    outbox.enqueueProjectionDelivery({ ...COMMAND, text: '不同业务正文' }, IDEMPOTENCY_KEY),
    /reused for a different command/u
  )
})

test('a pending command wakes after the device credential becomes available', async () => {
  const store = await localStore()
  const secrets = new MemorySecretStore()
  const client = new IdempotentCloudClient()
  const outbox = new DurableCloudOutbox({ store, packageSecrets: secrets, cloudClient: () => client })

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'pending')
  assert.equal(client.attempts, 0)

  await secrets.write('device-credential', DEVICE_CREDENTIAL)
  outbox.wake()
  await outbox.waitForIdle()

  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(client.attempts, 1)
  assert.equal(client.businessCommits, 1)
})

test('an uncertain response retries with the durable request and does not duplicate the cloud write', async () => {
  const store = await localStore()
  const secrets = new MemorySecretStore([['device-credential', DEVICE_CREDENTIAL]])
  const client = new IdempotentCloudClient()
  client.dropNextResponse = true
  const outbox = new DurableCloudOutbox({ store, packageSecrets: secrets, cloudClient: () => client })

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(client.attempts, 1)
  assert.equal(client.businessCommits, 1)

  await outbox.retry(IDEMPOTENCY_KEY)
  await outbox.waitForIdle()

  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(store.snapshot().outbox[0]?.attempts, 2)
  assert.equal(client.attempts, 2)
  assert.equal(client.businessCommits, 1)
})

test('restart reconciles an in-flight command and repeated wake calls still deliver once', async () => {
  const backend = new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
  const firstStore = new CollaborationLocalStore(backend)
  await firstStore.open()
  const dormantOutbox = new DurableCloudOutbox({
    store: firstStore,
    packageSecrets: new MemorySecretStore(),
    cloudClient: () => null
  })
  await dormantOutbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await firstStore.transact((draft) => {
    const entry = draft.outbox[0]
    assert.ok(entry)
    entry.state = 'sending'
    entry.attempts = 1
  })

  const restartedStore = new CollaborationLocalStore(backend)
  const recovered = await restartedStore.open()
  assert.equal(recovered.outbox[0]?.state, 'reconciling')
  const client = new IdempotentCloudClient()
  const outbox = new DurableCloudOutbox({
    store: restartedStore,
    packageSecrets: new MemorySecretStore([['device-credential', DEVICE_CREDENTIAL]]),
    cloudClient: () => client
  })

  outbox.start()
  outbox.wake()
  outbox.wake()
  await outbox.waitForIdle()

  assert.equal(restartedStore.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(restartedStore.snapshot().outbox[0]?.attempts, 2)
  assert.equal(client.attempts, 1)
  assert.equal(client.businessCommits, 1)
})

class IdempotentCloudClient implements CollaborationCloudClient {
  attempts = 0
  businessCommits = 0
  dropNextResponse = false
  private readonly committed = new Map<string, RestResponse>()

  readonly execute = async (
    request: RestRequest,
    credential?: CollaborationCredential
  ): Promise<RestResponse> => {
    assert.equal(credential?.value, DEVICE_CREDENTIAL)
    this.attempts += 1
    const idempotencyKey = 'idempotencyKey' in request ? request.idempotencyKey : undefined
    assert.ok(idempotencyKey)
    let response = this.committed.get(idempotencyKey)
    if (!response) {
      this.businessCommits += 1
      response = receiptFor(request)
      this.committed.set(idempotencyKey, response)
    }
    if (this.dropNextResponse) {
      this.dropNextResponse = false
      throw new Error('response lost after cloud commit')
    }
    return response
  }

  readonly pullAgentInbox: CollaborationCloudClient['pullAgentInbox'] = async () => ({
    messages: [],
    nextSequence: 0
  })

  readonly observeAgentInbox: CollaborationCloudClient['observeAgentInbox'] = (_credential, signal) => ({
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise((resolve) => {
        if (signal.aborted) {
          resolve({ done: true as const, value: undefined })
          return
        }
        signal.addEventListener('abort', () => {
          resolve({ done: true as const, value: undefined })
        }, { once: true })
      })
    })
  })
}

function receiptFor(request: RestRequest): RestResponse {
  assert.equal(request.type, 'projection.message.publish')
  return {
    protocolVersion: '1.0',
    type: 'rest.receipt',
    requestId: request.requestId,
    receipt: {
      schemaVersion: 1,
      type: 'projection.message.receipt',
      receiptId: 'rcp_Outbox000001',
      createdAt: TEST_TIMESTAMP,
      projectionId: request.projectionId,
      direction: 'local_to_remote',
      localItemId: request.localItemId,
      payloadHash: TEST_HASH,
      attempt: 1,
      status: 'succeeded',
      providerMessageId: 'provider-outbox-message-1'
    }
  }
}

class MemorySecretStore implements DomainMainPackageSecretStoreHost {
  private readonly values: Map<string, string>

  constructor(entries: ReadonlyArray<readonly [string, string]> = []) {
    this.values = new Map(entries)
  }

  async has(key: string): Promise<boolean> { return this.values.has(key) }
  async read(key: string): Promise<string | null> { return this.values.get(key) ?? null }
  async write(key: string, value: string): Promise<void> { this.values.set(key, value) }
  async remove(key: string): Promise<void> { this.values.delete(key) }
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}

async function localStore(): Promise<CollaborationLocalStore> {
  const store = new CollaborationLocalStore(new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE)))
  await store.open()
  return store
}
