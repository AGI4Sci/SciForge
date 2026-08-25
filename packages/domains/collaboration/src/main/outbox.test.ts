import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createCollaborationError,
  restResponseSchema,
  taskExecutionSchema,
  taskOfferSchema,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import {
  TEST_HASH,
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP,
  agentNodeFixture,
  taskFixture
} from '@sciforge/collaboration-contracts/testing'
import { DurableCloudOutbox } from './outbox.js'
import { createTestAgentCloudRuntime } from './test-agent-cloud-runtime.js'
import {
  CollaborationLocalStore,
  EMPTY_COLLABORATION_LOCAL_STATE,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'

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
  const authority = new IdempotentAgentAuthority()
  authority.ready = false
  const outbox = createOutbox(store, authority)

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)

  assert.equal(store.snapshot().outbox.length, 1)
  await assert.rejects(
    outbox.enqueueProjectionDelivery({ ...COMMAND, text: '不同业务正文' }, IDEMPOTENCY_KEY),
    /reused for a different command/u
  )
})

test('a pending command wakes after exact Agent authority becomes ready', async () => {
  const store = await localStore()
  const authority = new IdempotentAgentAuthority()
  authority.ready = false
  const outbox = createOutbox(store, authority)

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'pending')
  assert.equal(authority.attempts, 0)

  authority.ready = true
  outbox.wake()
  await outbox.waitForIdle()

  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(authority.attempts, 1)
  assert.equal(authority.businessCommits, 1)
})

test('an uncertain response retries durably without duplicating the cloud write', async () => {
  const store = await localStore()
  const authority = new IdempotentAgentAuthority()
  authority.dropNextResponse = true
  const outbox = createOutbox(store, authority)

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(authority.businessCommits, 1)

  await outbox.retry(IDEMPOTENCY_KEY)
  await outbox.waitForIdle()

  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(store.snapshot().outbox[0]?.attempts, 2)
  assert.equal(authority.attempts, 2)
  assert.equal(authority.businessCommits, 1)
})

test('restart reconciles an in-flight command and repeated wakes still deliver once', async () => {
  const backend = new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
  const firstStore = new CollaborationLocalStore(backend)
  await firstStore.open()
  const dormantAuthority = new IdempotentAgentAuthority()
  dormantAuthority.ready = false
  const dormantOutbox = createOutbox(firstStore, dormantAuthority)
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
  const authority = new IdempotentAgentAuthority()
  const outbox = createOutbox(restartedStore, authority)

  outbox.start()
  outbox.wake()
  outbox.wake()
  await outbox.waitForIdle()

  assert.equal(restartedStore.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(restartedStore.snapshot().outbox[0]?.attempts, 2)
  assert.equal(authority.attempts, 1)
  assert.equal(authority.businessCommits, 1)
})

test('persists and replays a strict Cloud fence error as a delivered command result', async () => {
  const store = await localStore()
  let attempts = 0
  const response: RestResponse = {
    protocolVersion: '1.0',
    type: 'rest.error',
    requestId: TEST_IDS.requestId,
    error: createCollaborationError('revision_conflict', 'Coordinator fence changed.', {
      requestId: TEST_IDS.requestId,
      expectedRevision: 1,
      currentRevision: 2
    })
  }
  const outbox = new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion
      }),
      execute: async (agentId, request) => {
        assert.equal(agentId, TEST_IDS.agentId)
        assert.equal(request.type, 'task.offer.withdraw')
        attempts += 1
        return response
      }
    }),
    localAgentId: () => TEST_IDS.agentId
  })
  const command = coordinatorWithdrawCommand()

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(attempts, 1)
  assert.deepEqual(store.snapshot().outbox[0], {
    ...store.snapshot().outbox[0],
    state: 'delivered',
    response
  })
})

test('rejects a strict Cloud error whose request envelope belongs to another command', async () => {
  const store = await localStore()
  const command = coordinatorWithdrawCommand()
  const response = restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.error',
    requestId: 'req_Reque0000002',
    error: createCollaborationError('revision_conflict', 'Coordinator fence changed.')
  })
  const outbox = coordinatorOutbox(store, async () => response)

  await assert.rejects(outbox.enqueueAndWait('coordinator.command', command))
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(store.snapshot().outbox[0]?.response, undefined)
})

test('delivers task.offer.create only through its exact canonical collection response', async () => {
  const store = await localStore()
  const command = coordinatorCreateCommand()
  const response = coordinatorOfferCollection(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('delivers task.offer.withdraw only through its exact terminal collection response', async () => {
  const store = await localStore()
  const command = coordinatorWithdrawCommand()
  const response = coordinatorWithdrawCollection(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('delivers task.offer.reassign only through its exact replacement collection response', async () => {
  const store = await localStore()
  const command = coordinatorReassignCommand()
  const response = coordinatorReassignCollection(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('rejects collection response drift instead of treating an arbitrary page as write success', async () => {
  const store = await localStore()
  const command = coordinatorCreateCommand()
  const response = coordinatorOfferCollection(command)
  assert.equal(response.type, 'rest.collection')
  const drifted = restResponseSchema.parse({
    ...response,
    nextCursor: 'opaque-write-page-cursor'
  })
  const outbox = coordinatorOutbox(store, async () => drifted)

  await assert.rejects(outbox.enqueueAndWait('coordinator.command', command))
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(store.snapshot().outbox[0]?.response, undefined)
})

test('recovers an idempotent Coordinator collection after the first response is lost', async () => {
  const store = await localStore()
  const command = coordinatorCreateCommand()
  const committedResponse = coordinatorOfferCollection(command)
  let attempts = 0
  let businessCommits = 0
  let responseLost = true
  let committed = false
  const outbox = coordinatorOutbox(store, async () => {
    attempts += 1
    if (!committed) {
      committed = true
      businessCommits += 1
    }
    if (responseLost) {
      responseLost = false
      throw new Error('response lost after canonical Cloud commit')
    }
    return committedResponse
  })

  await assert.rejects(outbox.enqueueAndWait('coordinator.command', command))
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  await outbox.retry('idem_task.offer.create-outbox-01')
  await outbox.waitForIdle()

  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.deepEqual(store.snapshot().outbox[0]?.response, committedResponse)
  assert.equal(attempts, 2)
  assert.equal(businessCommits, 1)
  assert.deepEqual(
    await outbox.enqueueAndWait('coordinator.command', command),
    committedResponse
  )
  assert.equal(attempts, 2)
})

test('does not change existing fire-and-retry outbox error semantics', async () => {
  const store = await localStore()
  const outbox = new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion
      }),
      execute: async (_agentId, request) => ({
        protocolVersion: '1.0',
        type: 'rest.error',
        requestId: request.requestId,
        error: createCollaborationError('provider_unavailable', 'Provider is temporarily unavailable.')
      })
    }),
    localAgentId: () => TEST_IDS.agentId
  })

  await outbox.enqueueProjectionDelivery(COMMAND, IDEMPOTENCY_KEY)
  await outbox.waitForIdle()
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(store.snapshot().outbox[0]?.response, undefined)
})

test('rejects a non-strict upstream response without persisting its raw body', async () => {
  const store = await localStore()
  const outbox = new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion
      }),
      execute: async (_agentId, request) => ({
        protocolVersion: '1.0',
        type: 'rest.error',
        requestId: request.requestId,
        error: createCollaborationError('revision_conflict', 'Coordinator fence changed.'),
        rawUpstreamBody: { internalDebug: 'must-not-be-retained' }
      } as never)
    }),
    localAgentId: () => TEST_IDS.agentId
  })

  await assert.rejects(
    outbox.enqueueAndWait('coordinator.command', coordinatorWithdrawCommand())
  )
  const entry = store.snapshot().outbox[0]
  assert.equal(entry?.state, 'failed')
  assert.equal(entry?.response, undefined)
  assert.equal(JSON.stringify(entry).includes('must-not-be-retained'), false)
})

class IdempotentAgentAuthority {
  ready = true
  attempts = 0
  businessCommits = 0
  dropNextResponse = false
  private readonly committed = new Map<string, RestResponse>()

  readonly runtime = createTestAgentCloudRuntime({
    authorityStatus: async (agentId) => this.ready
      ? {
          state: 'ready',
          agentId,
          userId: agentNodeFixture.ownerUserId,
          deviceId: agentNodeFixture.deviceId!,
          generation: agentNodeFixture.credentialVersion
        }
      : { state: 'agent_required', agentId },
    execute: async (agentId, request) => {
      assert.equal(agentId, TEST_IDS.agentId)
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
  })
}

function createOutbox(
  store: CollaborationLocalStore,
  authority: IdempotentAgentAuthority
): DurableCloudOutbox {
  return new DurableCloudOutbox({
    store,
    agentCloudRuntime: authority.runtime,
    localAgentId: () => TEST_IDS.agentId
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

function coordinatorWithdrawCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_task.offer.withdraw-outbox-01',
    type: 'task.offer.withdraw',
    taskOfferId: TEST_IDS.taskOfferId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    expectedTaskRevision: 1,
    expectedExecutionRevision: 1,
    expectedOfferRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    reason: 'Coordinator changed the synthetic assignment.'
  }
}

function coordinatorCreateCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_task.offer.create-outbox-01',
    type: 'task.offer.create',
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    projectPlanId: TEST_IDS.projectPlanId,
    expectedPlanRevision: 1,
    planItemId: 'item_Plan00000001',
    assigneeAgentId: TEST_IDS.secondAgentId,
    expectedAvailabilityRevision: 1,
    offerExpiresAt: TEST_LATER_TIMESTAMP
  }
}

function coordinatorReassignCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_task.offer.reassign-outbox-01',
    type: 'task.offer.reassign',
    taskId: TEST_IDS.taskId,
    previousExecutionId: TEST_IDS.executionId,
    expectedProjectRevision: 1,
    expectedTaskRevision: 1,
    expectedExecutionRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    assigneeAgentId: TEST_IDS.secondAgentId,
    expectedAvailabilityRevision: 1,
    offerExpiresAt: TEST_LATER_TIMESTAMP
  }
}

function coordinatorOfferCollection(request: RestRequest): RestResponse {
  const execution = taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    attempt: 1,
    offeredByCoordinatorAgentId: TEST_IDS.agentId,
    assigneeUserId: TEST_IDS.secondUserId,
    assigneeAgentId: TEST_IDS.secondAgentId,
    assigneeDeviceId: 'dev_WorkerDevice01',
    state: 'offered',
    stateRevision: 1,
    fence: {
      schemaVersion: 1,
      executionId: TEST_IDS.executionId,
      assigneeUserId: TEST_IDS.secondUserId,
      assigneeAgentId: TEST_IDS.secondAgentId,
      assigneeDeviceId: 'dev_WorkerDevice01',
      assignmentTaskRevision: 1,
      projectExecutionAuthorityEpoch: 1,
      userTaskAuthorityEpoch: 1,
      bindingRevision: null,
      status: 'open',
      reason: null,
      fencedAt: null
    },
    fileIntent: null,
    currentResultSubmissionId: null,
    offeredAt: TEST_TIMESTAMP,
    acceptedAt: null,
    startedAt: null,
    terminalAt: null,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  })
  const offer = taskOfferSchema.parse({
    schemaVersion: 1,
    type: 'task_offer',
    taskOfferId: TEST_IDS.taskOfferId,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    assigneeUserId: TEST_IDS.secondUserId,
    assigneeAgentId: TEST_IDS.secondAgentId,
    assigneeDeviceId: 'dev_WorkerDevice01',
    state: 'pending',
    offeredAt: TEST_TIMESTAMP,
    expiresAt: TEST_LATER_TIMESTAMP,
    respondedAt: null,
    rejectionReason: null,
    safeReasonDetail: null,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  })
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: request.requestId,
    items: [taskFixture, execution, offer]
  })
}

function coordinatorWithdrawCollection(request: RestRequest): RestResponse {
  const created = coordinatorOfferCollection(request)
  assert.equal(created.type, 'rest.collection')
  const task = created.items.find((item) => item.type === 'task')
  const execution = created.items.find((item) => item.type === 'task_execution')
  const offer = created.items.find((item) => item.type === 'task_offer')
  assert.ok(task && execution && offer)
  return restResponseSchema.parse({
    ...created,
    items: [
      {
        ...task,
        currentExecutionState: 'cancelled',
        status: 'revision_requested',
        revision: 2,
        updatedAt: TEST_LATER_TIMESTAMP
      },
      {
        ...execution,
        state: 'cancelled',
        stateRevision: 2,
        fence: {
          ...execution.fence,
          status: 'fenced',
          reason: 'offer_withdrawn',
          fencedAt: TEST_LATER_TIMESTAMP
        },
        terminalAt: TEST_LATER_TIMESTAMP,
        revision: 2,
        updatedAt: TEST_LATER_TIMESTAMP
      },
      {
        ...offer,
        state: 'withdrawn',
        respondedAt: TEST_LATER_TIMESTAMP,
        revision: 2,
        updatedAt: TEST_LATER_TIMESTAMP
      }
    ]
  })
}

function coordinatorReassignCollection(request: RestRequest): RestResponse {
  const created = coordinatorOfferCollection(request)
  assert.equal(created.type, 'rest.collection')
  const task = created.items.find((item) => item.type === 'task')
  const execution = created.items.find((item) => item.type === 'task_execution')
  const offer = created.items.find((item) => item.type === 'task_offer')
  assert.ok(task && execution && offer)
  const replacementExecutionId = 'exe_Exec00000002'
  return restResponseSchema.parse({
    ...created,
    items: [
      {
        ...task,
        currentExecutionId: replacementExecutionId,
        executionCount: 2,
        revision: 2,
        updatedAt: TEST_LATER_TIMESTAMP
      },
      {
        ...execution,
        executionId: replacementExecutionId,
        attempt: 2,
        fence: {
          ...execution.fence,
          executionId: replacementExecutionId,
          assignmentTaskRevision: 2
        },
        updatedAt: TEST_LATER_TIMESTAMP
      },
      {
        ...offer,
        taskOfferId: 'ofr_Offer00000002',
        executionId: replacementExecutionId,
        updatedAt: TEST_LATER_TIMESTAMP
      }
    ]
  })
}

function coordinatorOutbox(
  store: CollaborationLocalStore,
  execute: (agentId: string, request: RestRequest) => Promise<RestResponse>
): DurableCloudOutbox {
  return new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion
      }),
      execute
    }),
    localAgentId: () => TEST_IDS.agentId
  })
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}

async function localStore(): Promise<CollaborationLocalStore> {
  const store = new CollaborationLocalStore(
    new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
  )
  await store.open()
  return store
}
