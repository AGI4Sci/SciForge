import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createCollaborationError,
  restResponseSchema,
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
  humanNeededFixture,
  projectFixture,
  projectRecordFixture,
  taskFixture
} from '@sciforge/collaboration-contracts/testing'
import { canonicalTaskIdForPlanItem } from '@sciforge/collaboration-contracts/node'
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

test('enqueueAndWait joins the exact pending command until authority wakes it to one terminal receipt', async () => {
  const store = await localStore()
  let ready = false
  let attempts = 0
  let projectsCreated = 0
  const command = coordinatorProjectCreateCommand()
  const outbox = new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ready
        ? {
            state: 'ready',
            agentId,
            userId: agentNodeFixture.ownerUserId,
            deviceId: agentNodeFixture.deviceId!,
            generation: agentNodeFixture.credentialVersion,
            runtimeId: 'codex',
            capabilityTags: ['agent-runtime.codex', 'model-access.api']
          }
        : { state: 'agent_required', agentId },
      execute: async (_agentId, request) => {
        attempts += 1
        projectsCreated += 1
        return coordinatorProjectCreatedResponse(request)
      }
    }),
    localAgentId: () => TEST_IDS.agentId
  })

  await outbox.enqueue('coordinator.command', command)
  await outbox.waitForIdle()
  let settled = 0
  const first = outbox.enqueueAndWait('coordinator.command', command).then((response) => {
    settled += 1
    return response
  })
  const second = outbox.enqueueAndWait('coordinator.command', {
    ...command,
    requestId: 'req_ProjectCreateRetry1'
  }).then((response) => {
    settled += 1
    return response
  })
  await outbox.waitForIdle()

  assert.equal(settled, 0)
  assert.equal(store.snapshot().outbox.length, 1)
  assert.equal(store.snapshot().outbox[0]?.state, 'pending')
  ready = true
  outbox.wake()
  const expected = coordinatorProjectCreatedResponse(command)
  assert.deepEqual(await Promise.all([first, second]), [expected, expected])
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(attempts, 1)
  assert.equal(projectsCreated, 1)
})

test('a current Worker availability supersedes stale undelivered heartbeat facts', async () => {
  const store = await localStore()
  const attemptedAgentRevisions: number[] = []
  const outbox = availabilityOutbox(store, attemptedAgentRevisions)
  outbox.stop()

  await outbox.enqueue('worker.availability', availabilityCommand({
    expectedAgentRevision: 45,
    connectionStatus: 'offline',
    observedAt: TEST_TIMESTAMP
  }))
  await outbox.enqueue('worker.availability', availabilityCommand({
    expectedAgentRevision: 46,
    connectionStatus: 'online',
    observedAt: TEST_LATER_TIMESTAMP
  }))
  outbox.start()
  await outbox.waitForIdle()

  assert.deepEqual(attemptedAgentRevisions, [46])
  const entries = store.snapshot().outbox.filter(({ kind }) => kind === 'worker.availability')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.state, 'delivered', entries[0]?.error)
})

test('a late stale Worker availability cannot supersede the current Agent revision', async () => {
  const store = await localStore()
  const attemptedAgentRevisions: number[] = []
  const outbox = availabilityOutbox(store, attemptedAgentRevisions)
  outbox.stop()

  await outbox.enqueue('worker.availability', availabilityCommand({
    expectedAgentRevision: 46,
    connectionStatus: 'online',
    observedAt: TEST_LATER_TIMESTAMP
  }))
  await outbox.enqueue('worker.availability', availabilityCommand({
    expectedAgentRevision: 45,
    connectionStatus: 'offline',
    observedAt: TEST_TIMESTAMP
  }))
  outbox.start()
  await outbox.waitForIdle()

  assert.deepEqual(attemptedAgentRevisions, [46])
  const entries = store.snapshot().outbox.filter(({ kind }) => kind === 'worker.availability')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.state, 'delivered', entries[0]?.error)
})

test('an in-flight Worker availability is retained while the current fact is queued', async () => {
  const store = await localStore()
  const outbox = availabilityOutbox(store, [])
  outbox.stop()
  await outbox.enqueue('worker.availability', availabilityCommand({
    expectedAgentRevision: 45,
    connectionStatus: 'offline',
    observedAt: TEST_TIMESTAMP
  }))
  await store.transact((draft) => {
    const sending = draft.outbox[0]
    assert.ok(sending)
    sending.state = 'sending'
  })

  await outbox.enqueue('worker.availability', availabilityCommand({
    expectedAgentRevision: 46,
    connectionStatus: 'online',
    observedAt: TEST_LATER_TIMESTAMP
  }))

  assert.deepEqual(store.snapshot().outbox.map(({ state, body }) => ({
    state,
    expectedAgentRevision: body.expectedAgentRevision
  })), [
    { state: 'sending', expectedAgentRevision: 45 },
    { state: 'pending', expectedAgentRevision: 46 }
  ])
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
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
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

test('delivers project.create through its exact canonical creation response', async () => {
  const store = await localStore()
  const command = coordinatorProjectCreateCommand()
  const response = coordinatorProjectCreatedResponse(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('rejects a project.create response whose durable facts drift from the request', async () => {
  const store = await localStore()
  const command = coordinatorProjectCreateCommand()
  const response = coordinatorProjectCreatedResponse(command)
  assert.equal(response.type, 'rest.project_created')
  const drifted = restResponseSchema.parse({
    ...response,
    project: { ...response.project, displayName: 'Another Project' }
  })
  const outbox = coordinatorOutbox(store, async () => drifted)

  await assert.rejects(outbox.enqueueAndWait('coordinator.command', command))
  assert.equal(store.snapshot().outbox[0]?.state, 'failed')
  assert.equal(store.snapshot().outbox[0]?.response, undefined)
})

test('delivers human.needed.create through its exact Coordinator request response', async () => {
  const store = await localStore()
  const command = coordinatorHumanNeededCommand()
  const response = coordinatorHumanNeededResponse(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('delivers Worker human.needed.create through its exact execution response', async () => {
  const store = await localStore()
  const command = coordinatorWorkerHumanNeededCommand()
  const response = coordinatorHumanNeededResponse(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('delivers task.result.review through its exact accepted-result collection', async () => {
  const store = await localStore()
  const command = coordinatorResultReviewCommand()
  const response = coordinatorResultReviewResponse(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('delivers task.result.review through its exact revision-offer collection', async () => {
  const store = await localStore()
  const command = coordinatorResultRevisionCommand()
  const response = coordinatorResultRevisionResponse(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('delivers project.decision.submit through its exact Project record collection', async () => {
  const store = await localStore()
  const command = coordinatorDecisionCommand()
  const response = coordinatorDecisionResponse(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
})

test('delivers project.final_summary.submit through its exact terminal collection', async () => {
  const store = await localStore()
  const command = coordinatorFinalSummaryCommand()
  const response = coordinatorFinalSummaryResponse(command)
  const outbox = coordinatorOutbox(store, async () => response)

  assert.deepEqual(await outbox.enqueueAndWait('coordinator.command', command), response)
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
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

test('a repeated idempotent Coordinator command retries its original durable body after response loss', async () => {
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
  assert.deepEqual(
    await outbox.enqueueAndWait('coordinator.command', command),
    committedResponse
  )
  assert.equal(store.snapshot().outbox[0]?.state, 'delivered')
  assert.deepEqual(store.snapshot().outbox[0]?.response, committedResponse)
  assert.equal(attempts, 2)
  assert.equal(businessCommits, 1)
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
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
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
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
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
          generation: agentNodeFixture.credentialVersion,
          runtimeId: 'codex',
          capabilityTags: ['agent-runtime.codex', 'model-access.api']
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

function availabilityCommand(input: Readonly<{
  expectedAgentRevision: number
  connectionStatus: 'online' | 'offline'
  observedAt: string
}>): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: input.expectedAgentRevision === 45
      ? 'req_AvailabilityStale01'
      : 'req_AvailabilityCurrent1',
    idempotencyKey: `idem_worker.availability.${input.expectedAgentRevision}`,
    type: 'worker.availability.publish',
    agentId: TEST_IDS.agentId,
    expectedAgentRevision: input.expectedAgentRevision,
    connectionStatus: input.connectionStatus,
    lastHeartbeatAt: input.connectionStatus === 'online' ? TEST_LATER_TIMESTAMP : null,
    runtimeReadiness: 'ready',
    runtimeCapabilityTags: ['agent-runtime.codex', 'model-access.api'],
    acceptsNewOffers: input.connectionStatus === 'online',
    activeTaskCount: 0,
    observedAt: input.observedAt
  }
}

function availabilityOutbox(
  store: CollaborationLocalStore,
  attemptedAgentRevisions: number[]
): DurableCloudOutbox {
  return new DurableCloudOutbox({
    store,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => ({
        state: 'ready',
        agentId,
        userId: agentNodeFixture.ownerUserId,
        deviceId: agentNodeFixture.deviceId!,
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
      }),
      execute: async (_agentId, request) => {
        assert.equal(request.type, 'worker.availability.publish')
        if (request.type !== 'worker.availability.publish') {
          throw new Error('Expected a Worker availability command.')
        }
        attemptedAgentRevisions.push(request.expectedAgentRevision)
        if (request.expectedAgentRevision === 45) {
          return {
            protocolVersion: '1.0',
            type: 'rest.error',
            requestId: request.requestId,
            error: createCollaborationError(
              'revision_conflict',
              'The resource revision is stale.'
            )
          }
        }
        return {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: request.requestId,
          entity: {
            schemaVersion: 1,
            type: 'worker_availability_projection',
            userId: agentNodeFixture.ownerUserId,
            agentId: TEST_IDS.agentId,
            deviceId: agentNodeFixture.deviceId!,
            agentActive: true,
            deviceActive: true,
            connectionStatus: 'online',
            lastHeartbeatAt: TEST_LATER_TIMESTAMP,
            runtimeReadiness: 'ready',
            runtimeCapabilityTags: ['agent-runtime.codex', 'model-access.api'],
            acceptsNewOffers: true,
            activeTaskCount: 0,
            observedAt: TEST_LATER_TIMESTAMP,
            expiresAt: '2099-08-15T09:01:30.000Z',
            revision: 2,
            createdAt: TEST_TIMESTAMP,
            updatedAt: TEST_LATER_TIMESTAMP
          }
        }
      }
    }),
    localAgentId: () => TEST_IDS.agentId
  })
}

function coordinatorWithdrawCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_task.offer.withdraw-outbox-01',
    type: 'task.offer.withdraw',
    taskOfferId: TEST_IDS.taskOfferId,
    taskId: TEST_IDS.taskId,
    expectedTaskRevision: 1,
    expectedOfferRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    reason: 'Coordinator changed the synthetic assignment.'
  }
}

function coordinatorProjectCreateCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_project.create-outbox-01',
    type: 'project.create',
    createIntentId: 'pct_OutboxCreateIntent01',
    displayName: 'Durable Project',
    goal: 'Create a durable collaboration Project exactly once.',
    budget: {
      maxTasks: 20,
      maxTasksPerRound: 4,
      maxCoordinationRounds: 10,
      maxTaskRetries: 2
    }
  }
}

function coordinatorProjectCreatedResponse(request: RestRequest): RestResponse {
  assert.equal(request.type, 'project.create')
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.project_created',
    requestId: request.requestId,
    project: {
      ...projectFixture,
      displayName: request.displayName,
      goal: request.goal,
      budget: request.budget,
      contentMode: 'none',
      status: 'draft'
    },
    memberships: [{
      schemaVersion: 1,
      type: 'project_membership',
      projectMembershipId: TEST_IDS.projectMembershipId,
      projectId: TEST_IDS.projectId,
      userId: TEST_IDS.userId,
      state: 'active',
      authorityEpoch: 1,
      activatedAt: TEST_TIMESTAMP,
      removalRequestedAt: null,
      removalRequestedByUserId: null,
      removedAt: null,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    }],
    provisioningIntent: null
  })
}

function coordinatorHumanNeededCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_human.needed.create-outbox-01',
    type: 'human.needed.create',
    projectId: TEST_IDS.projectId,
    targetUserId: TEST_IDS.secondUserId,
    context: {
      scope: 'coordinator_project',
      expectedProjectRevision: 5,
      expectedCoordinatorAuthorityEpoch: 2
    },
    requiredAssurance: 'verified',
    prompt: 'Choose the direction the Coordinator should record.',
    confirmableAction: null,
    expiresAt: TEST_LATER_TIMESTAMP
  }
}

function coordinatorWorkerHumanNeededCommand(): RestRequest {
  const command = coordinatorHumanNeededCommand()
  assert.equal(command.type, 'human.needed.create')
  return {
    ...command,
    idempotencyKey: 'idem_human.needed.worker-outbox-01',
    context: {
      scope: 'worker_execution',
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      expectedTaskRevision: 4,
      expectedExecutionRevision: 3
    }
  }
}

function coordinatorHumanNeededResponse(request: RestRequest): RestResponse {
  assert.equal(request.type, 'human.needed.create')
  const context = request.context.scope === 'worker_execution'
    ? {
        scope: 'worker_execution' as const,
        taskId: request.context.taskId,
        executionId: request.context.executionId
      }
    : {
        scope: 'coordinator_project' as const,
        coordinatorAuthorityEpoch: request.context.expectedCoordinatorAuthorityEpoch
      }
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.entity',
    requestId: request.requestId,
    entity: {
      ...humanNeededFixture,
      projectId: request.projectId,
      context,
      targetUserId: request.targetUserId,
      requestedByAgentId: TEST_IDS.agentId,
      requiredAssurance: request.requiredAssurance,
      prompt: request.prompt,
      confirmableAction: request.confirmableAction,
      expiresAt: request.expiresAt
    }
  })
}

function coordinatorResultReviewCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_task.result.review-outbox-01',
    type: 'task.result.review',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    resultSubmissionId: TEST_IDS.resultSubmissionId,
    expectedProjectRevision: 5,
    expectedTaskRevision: 4,
    expectedExecutionRevision: 4,
    expectedResultRevision: 1,
    expectedCoordinatorAuthorityEpoch: 2,
    decision: 'accept',
    instruction: null,
    nextWorkerUserId: null,
    nextOfferExpiresAt: null,
    nextFileIntent: null
  }
}

function coordinatorResultReviewResponse(request: RestRequest): RestResponse {
  assert.equal(request.type, 'task.result.review')
  assert.equal(request.decision, 'accept')
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: request.requestId,
    items: [{
      ...taskFixture,
      currentExecutionId: request.executionId,
      currentExecutionState: 'completed',
      status: 'completed',
      executionCount: 1,
      completedAt: TEST_LATER_TIMESTAMP,
      revision: request.expectedTaskRevision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    }, {
      schemaVersion: 1,
      type: 'task_execution',
      projectId: request.projectId,
      taskId: request.taskId,
      executionId: request.executionId,
      attempt: 1,
      offeredByCoordinatorAgentId: TEST_IDS.agentId,
      assigneeUserId: TEST_IDS.secondUserId,
      assigneeAgentId: TEST_IDS.secondAgentId,
      assigneeDeviceId: 'dev_WorkerDevice01',
      state: 'completed',
      stateRevision: 5,
      fence: {
        schemaVersion: 1,
        executionId: request.executionId,
        assigneeUserId: TEST_IDS.secondUserId,
        assigneeAgentId: TEST_IDS.secondAgentId,
        assigneeDeviceId: 'dev_WorkerDevice01',
        assignmentTaskRevision: 2,
        projectExecutionAuthorityEpoch: 1,
        userTaskAuthorityEpoch: 3,
        bindingRevision: null,
        status: 'fenced',
        reason: 'completed',
        fencedAt: TEST_LATER_TIMESTAMP
      },
      fileIntent: null,
      currentResultSubmissionId: request.resultSubmissionId,
      offeredAt: TEST_TIMESTAMP,
      acceptedAt: TEST_TIMESTAMP,
      startedAt: TEST_TIMESTAMP,
      terminalAt: TEST_LATER_TIMESTAMP,
      revision: request.expectedExecutionRevision + 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    }, {
      schemaVersion: 1,
      type: 'task_review_decision',
      reviewDecisionId: TEST_IDS.reviewDecisionId,
      projectId: request.projectId,
      taskId: request.taskId,
      executionId: request.executionId,
      resultSubmissionId: request.resultSubmissionId,
      reviewedResultRevision: request.expectedResultRevision,
      decidedByUserId: TEST_IDS.userId,
      decidedByCoordinatorAgentId: TEST_IDS.agentId,
      decision: request.decision,
      instruction: request.instruction,
      acceptedProjectRecordId: TEST_IDS.projectRecordId,
      nextTaskOfferId: null,
      decidedAt: TEST_LATER_TIMESTAMP,
      revision: 1,
      createdAt: TEST_LATER_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    }]
  })
}

function coordinatorResultRevisionCommand(): RestRequest {
  const command = coordinatorResultReviewCommand()
  assert.equal(command.type, 'task.result.review')
  return {
    ...command,
    idempotencyKey: 'idem_task.result.revise-outbox-01',
    decision: 'request_revision',
    instruction: 'Address the missing evidence and resubmit.',
    nextWorkerUserId: TEST_IDS.secondUserId,
    nextOfferExpiresAt: '2026-08-15T08:02:00.000Z',
    nextFileIntent: null
  }
}

function coordinatorResultRevisionResponse(request: RestRequest): RestResponse {
  assert.equal(request.type, 'task.result.review')
  assert.equal(request.decision, 'request_revision')
  const accepted = coordinatorResultReviewResponse({
    ...request,
    decision: 'accept',
    instruction: null,
    nextWorkerUserId: null,
    nextOfferExpiresAt: null,
    nextFileIntent: null
  })
  assert.equal(accepted.type, 'rest.collection')
  const [task, execution, review] = accepted.items
  assert.equal(task?.type, 'task')
  assert.equal(execution?.type, 'task_execution')
  assert.equal(review?.type, 'task_review_decision')
  const nextTaskOfferId = 'ofr_NextRevision001'
  return restResponseSchema.parse({
    ...accepted,
    items: [{
      ...task,
      status: 'offered',
      currentExecutionId: null,
      currentExecutionState: null,
      fileIntent: request.nextFileIntent,
      completedAt: null
    }, {
      ...execution,
      state: 'superseded',
      fence: {
        ...execution.fence,
        reason: 'reassigned'
      }
    }, {
      ...review,
      decision: request.decision,
      instruction: request.instruction,
      acceptedProjectRecordId: null,
      nextTaskOfferId
    }, {
      schemaVersion: 1,
      type: 'task_offer',
      taskOfferId: nextTaskOfferId,
      projectId: request.projectId,
      taskId: request.taskId,
      executionId: null,
      workerUserId: request.nextWorkerUserId,
      offeredByCoordinatorAgentId: TEST_IDS.agentId,
      state: 'pending',
      offeredAt: TEST_LATER_TIMESTAMP,
      expiresAt: request.nextOfferExpiresAt,
      respondedAt: null,
      revision: 1,
      createdAt: TEST_LATER_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    }]
  })
}

function coordinatorDecisionCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_project.decision.submit-outbox-01',
    type: 'project.decision.submit',
    projectId: TEST_IDS.projectId,
    humanRequestId: TEST_IDS.humanRequestId,
    humanAnswerId: TEST_IDS.humanAnswerId,
    expectedProjectRevision: 5,
    expectedCoordinatorAuthorityEpoch: 2,
    expectedHumanRequestRevision: 2,
    expectedHumanAnswerRevision: 1,
    decision: 'Proceed with the confirmed lower-risk direction.'
  }
}

function coordinatorDecisionResponse(request: RestRequest): RestResponse {
  assert.equal(request.type, 'project.decision.submit')
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: request.requestId,
    items: [{
      ...projectFixture,
      coordinatorAuthorityEpoch: request.expectedCoordinatorAuthorityEpoch,
      revision: request.expectedProjectRevision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    }, {
      ...projectRecordFixture,
      kind: 'decision',
      body: request.decision,
      sourceTaskId: null,
      sourceResultSubmissionId: null,
      sourceHumanAnswerId: request.humanAnswerId,
      sourceRevision: request.expectedHumanAnswerRevision,
      acceptedAt: TEST_LATER_TIMESTAMP,
      createdAt: TEST_LATER_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    }]
  })
}

function coordinatorFinalSummaryCommand(): RestRequest {
  return {
    protocolVersion: '1.0',
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_project.final_summary.submit-outbox-01',
    type: 'project.final_summary.submit',
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: 5,
    expectedCoordinatorAuthorityEpoch: 2,
    expectedExecutionAuthorityEpoch: 3,
    projectPlanId: TEST_IDS.projectPlanId,
    confirmedPlanRevision: 2,
    acceptedResultSubmissionIds: [TEST_IDS.resultSubmissionId],
    summary: 'The accepted result completes the durable Project.'
  }
}

function coordinatorFinalSummaryResponse(request: RestRequest): RestResponse {
  assert.equal(request.type, 'project.final_summary.submit')
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: request.requestId,
    items: [{
      ...projectFixture,
      coordinatorAuthorityEpoch: request.expectedCoordinatorAuthorityEpoch,
      executionAuthorityEpoch: request.expectedExecutionAuthorityEpoch + 1,
      status: 'completed',
      revision: request.expectedProjectRevision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    }, {
      ...projectRecordFixture,
      kind: 'summary',
      body: request.summary,
      sourceTaskId: null,
      sourceResultSubmissionId: null,
      sourceHumanAnswerId: null,
      sourceRevision: 1,
      acceptedAt: TEST_LATER_TIMESTAMP,
      createdAt: TEST_LATER_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    }, {
      schemaVersion: 1,
      type: 'project_final_summary',
      projectId: request.projectId,
      projectRecordId: TEST_IDS.projectRecordId,
      projectPlanId: request.projectPlanId,
      confirmedPlanRevision: request.confirmedPlanRevision,
      acceptedResultSubmissionIds: request.acceptedResultSubmissionIds,
      summary: request.summary,
      createdByUserId: TEST_IDS.userId,
      createdByCoordinatorAgentId: TEST_IDS.agentId,
      completedAt: TEST_LATER_TIMESTAMP,
      revision: 1,
      createdAt: TEST_LATER_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    }]
  })
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
    previousTaskOfferId: TEST_IDS.taskOfferId,
    expectedPreviousOfferRevision: 1,
    expectedProjectRevision: 1,
    expectedTaskRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    workerUserId: TEST_IDS.secondUserId,
    offerExpiresAt: TEST_LATER_TIMESTAMP,
    nextFileIntent: null
  }
}

function coordinatorOfferCollection(request: RestRequest): RestResponse {
  const taskRevision = request.type === 'task.offer.reassign'
    ? request.expectedTaskRevision + 1
    : 1
  const taskId = request.type === 'task.offer.create'
    ? canonicalTaskIdForPlanItem(request.projectPlanId, request.planItemId)
    : TEST_IDS.taskId
  const workerUserId = request.type === 'task.offer.reassign'
    ? request.workerUserId
    : TEST_IDS.secondUserId
  const offer = taskOfferSchema.parse({
    schemaVersion: 1,
    type: 'task_offer',
    taskOfferId: TEST_IDS.taskOfferId,
    projectId: TEST_IDS.projectId,
    taskId,
    executionId: null,
    workerUserId,
    offeredByCoordinatorAgentId: TEST_IDS.agentId,
    state: 'pending',
    offeredAt: TEST_TIMESTAMP,
    expiresAt: TEST_LATER_TIMESTAMP,
    respondedAt: null,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  })
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: request.requestId,
    items: [{
      ...taskFixture,
      taskId,
      revision: taskRevision,
      updatedAt: taskRevision === 1 ? TEST_TIMESTAMP : TEST_LATER_TIMESTAMP
    }, offer]
  })
}

function coordinatorWithdrawCollection(request: RestRequest): RestResponse {
  const created = coordinatorOfferCollection(request)
  assert.equal(created.type, 'rest.collection')
  const task = created.items.find((item) => item.type === 'task')
  const offer = created.items.find((item) => item.type === 'task_offer')
  assert.ok(task && offer)
  return restResponseSchema.parse({
    ...created,
    items: [
      {
        ...task,
        status: 'revision_requested',
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
  const offer = created.items.find((item) => item.type === 'task_offer')
  assert.ok(task && offer)
  return restResponseSchema.parse({
    ...created,
    items: [task, { ...offer, taskOfferId: 'ofr_Offer00000002' }]
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
        generation: agentNodeFixture.credentialVersion,
        runtimeId: 'codex',
        capabilityTags: ['agent-runtime.codex', 'model-access.api']
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
