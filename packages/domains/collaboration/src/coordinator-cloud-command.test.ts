import {
  agentInboxMessageSchema,
  createCollaborationError,
  projectCompletionHumanActionFactDigest,
  projectCompletionTargetDigest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import {
  TEST_HASH,
  TEST_IDS,
  TEST_TIMESTAMP,
  agentInboxMessageFixture,
  humanAnswerFixture
} from '@sciforge/collaboration-contracts/testing'
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
  COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
  coordinatorCloudCommandSchema,
  coordinatorUserCloudCommandSchema,
  defineCoordinatorCloudCommandService,
  type CoordinatorAgentInboxHandler
} from './coordinator-cloud-command.js'

const envelope = {
  protocolVersion: '1.0' as const,
  requestId: TEST_IDS.requestId
}

const commands = [
  {
    ...envelope,
    idempotencyKey: 'idem_project.create-01',
    type: 'project.create' as const,
    createIntentId: 'pct_CommandCreateIntent1',
    displayName: 'Agent-owned Project',
    goal: 'Bind the current Device Agent as Coordinator.',
    budget: {
      maxTasks: 5,
      maxTasksPerRound: 5,
      maxTaskRetries: 1,
      maxCoordinationRounds: 2
    }
  },
  {
    ...envelope,
    idempotencyKey: 'idem_task.offer.create-01',
    type: 'task.offer.create' as const,
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    requirementsDocumentId: 'rqd_CommandFixture00000001',
    requirementsDocumentRevision: 1,
    requirementsContentDigest: TEST_HASH,
    workerUserId: TEST_IDS.secondUserId,
    planItemId: 'item_Plan00000001',
    offerExpiresAt: TEST_TIMESTAMP
  },
  {
    ...envelope,
    idempotencyKey: 'idem_task.offer.withdraw-01',
    type: 'task.offer.withdraw' as const,
    taskOfferId: TEST_IDS.taskOfferId,
    taskId: TEST_IDS.taskId,
    expectedTaskRevision: 1,
    expectedOfferRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    reason: 'Coordinator changed the synthetic assignment.'
  },
  {
    ...envelope,
    idempotencyKey: 'idem_task.offer.extend-01',
    type: 'task.offer.extend' as const,
    taskOfferId: TEST_IDS.taskOfferId,
    taskId: TEST_IDS.taskId,
    expectedTaskRevision: 1,
    expectedOfferRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    offerExpiresAt: TEST_TIMESTAMP
  },
  {
    ...envelope,
    idempotencyKey: 'idem_task.offer.reassign-01',
    type: 'task.offer.reassign' as const,
    taskId: TEST_IDS.taskId,
    previousTaskOfferId: TEST_IDS.taskOfferId,
    expectedPreviousOfferRevision: 1,
    expectedProjectRevision: 1,
    expectedTaskRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    workerUserId: TEST_IDS.secondUserId,
    offerExpiresAt: TEST_TIMESTAMP,
    nextFileIntent: null
  },
  {
    ...envelope,
    idempotencyKey: 'idem_human.needed.create-allowlist-01',
    type: 'human.needed.create' as const,
    projectId: TEST_IDS.projectId,
    targetUserId: TEST_IDS.secondUserId,
    context: {
      scope: 'coordinator_project' as const,
      expectedProjectRevision: 5,
      expectedCoordinatorAuthorityEpoch: 2
    },
    requiredAssurance: 'verified' as const,
    prompt: 'Which confirmed direction should the Coordinator record?',
    confirmableAction: null,
    expiresAt: TEST_TIMESTAMP
  },
  {
    ...envelope,
    idempotencyKey: 'idem_project.decision.submit-allowlist-01',
    type: 'project.decision.submit' as const,
    projectId: TEST_IDS.projectId,
    humanRequestId: TEST_IDS.humanRequestId,
    humanAnswerId: TEST_IDS.humanAnswerId,
    expectedProjectRevision: 6,
    expectedCoordinatorAuthorityEpoch: 2,
    expectedHumanRequestRevision: 2,
    expectedHumanAnswerRevision: 1,
    decision: 'Proceed with the Owner-confirmed direction.'
  }
] as const

test('Coordinator Cloud command service exposes one closed Agent-command allowlist', () => {
  assert.equal(COORDINATOR_CLOUD_COMMAND_SERVICE_ID, 'sciforge.collaboration.coordinator-cloud-command')
  assert.equal(COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION, '8.0.0')
  assert.deepEqual(commands.map((command) => coordinatorCloudCommandSchema.parse(command).type), [
    'project.create',
    'task.offer.create',
    'task.offer.withdraw',
    'task.offer.extend',
    'task.offer.reassign',
    'human.needed.create',
    'project.decision.submit'
  ])

  for (const forbiddenType of [
    'project.plan.confirm',
    'task.offer.accept',
    'task.result.submit',
    'task.result.review',
    'project.final_summary.submit',
    'delivery.adoption.record',
    'delivery.revision.request',
    'project.result.publish',
    'human.answer',
    'project.transfer_coordinator'
  ]) {
    assert.equal(coordinatorCloudCommandSchema.safeParse({
      ...commands[2],
      type: forbiddenType
    }).success, false, `${forbiddenType} must not enter the Coordinator Agent service`)
  }
  assert.equal(coordinatorCloudCommandSchema.safeParse({
    ...commands[2],
    agentId: TEST_IDS.agentId
  }).success, false)
})

test('human Delivery and completion decisions use one closed User-command schema', () => {
  const completionTarget = {
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: 7,
    expectedCoordinatorAuthorityEpoch: 2,
    expectedExecutionAuthorityEpoch: 1,
    projectPlanId: TEST_IDS.projectPlanId,
    confirmedPlanRevision: 2,
    projectResultIds: ['res_Result000001'],
    summary: 'The adopted and published results complete the Project.'
  }
  const completionAction = {
    actionId: 'act_Complete0001',
    interaction: 'explicit_click' as const,
    occurredAt: TEST_TIMESTAMP,
    confirmedInputDigest: projectCompletionTargetDigest(completionTarget),
    sourceMessageDigest: null
  }
  const userWrites = [{
    ...envelope,
    idempotencyKey: 'idem_human.needed.create-01',
    type: 'human.needed.create' as const,
    projectId: TEST_IDS.projectId,
    targetUserId: TEST_IDS.secondUserId,
    context: {
      scope: 'coordinator_project' as const,
      expectedProjectRevision: 5,
      expectedCoordinatorAuthorityEpoch: 2
    },
    requiredAssurance: 'verified' as const,
    prompt: 'Which confirmed direction should the Coordinator record?',
    confirmableAction: null,
    expiresAt: TEST_TIMESTAMP
  }, {
    ...envelope,
    idempotencyKey: 'idem_project.decision.submit-01',
    type: 'project.decision.submit' as const,
    projectId: TEST_IDS.projectId,
    humanRequestId: TEST_IDS.humanRequestId,
    humanAnswerId: TEST_IDS.humanAnswerId,
    expectedProjectRevision: 6,
    expectedCoordinatorAuthorityEpoch: 2,
    expectedHumanRequestRevision: 2,
    expectedHumanAnswerRevision: 1,
    decision: 'Proceed with the Owner-confirmed direction.'
  }]

  assert.deepEqual(userWrites.map((command) => (
    coordinatorCloudCommandSchema.parse(command).type
  )), [
    'human.needed.create',
    'project.decision.submit'
  ])

  const completionCommand = {
    ...envelope,
    idempotencyKey: 'idem_project.final_summary.submit-01',
    type: 'project.final_summary.submit' as const,
    ...completionTarget,
    ownerApproval: {
      ...completionAction,
      deviceSignature: {
        purpose: 'project-completion-approval' as const,
        userId: TEST_IDS.userId,
        deviceId: TEST_IDS.deviceId,
        deviceKeyId: 'key_Device000001',
        deviceKeyRevision: 1,
        signatureAlgorithm: 'Ed25519' as const,
        canonicalPayloadDigest: projectCompletionHumanActionFactDigest(completionTarget, completionAction),
        factRevision: completionTarget.confirmedPlanRevision,
        observedAt: TEST_TIMESTAMP,
        issuedAt: TEST_TIMESTAMP,
        signature: Buffer.alloc(64, 7).toString('base64url')
      }
    }
  }
  const userDecisions = [{
    ...envelope,
    idempotencyKey: 'idem_delivery.adoption.record-01',
    type: 'delivery.adoption.record' as const,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    deliveryManifestId: 'mft_Manifest0001',
    integrationRevision: 1,
    validationEvidence: ['Cloud validation evidence is complete.'],
    operationId: 'cop_Adopt00000001',
    disposition: 'adopted' as const
  }, {
    ...envelope,
    idempotencyKey: 'idem_delivery.revision.request-01',
    type: 'delivery.revision.request' as const,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    deliveryManifestId: 'mft_Manifest0001',
    instruction: 'Address the missing evidence and resubmit in the same Execution.'
  }, {
    ...envelope,
    idempotencyKey: 'idem_project.result.publish-01',
    type: 'project.result.publish' as const,
    integrationReceiptId: 'irc_Receipt00001',
    projectVersion: 3
  },
    completionCommand
  ]

  assert.deepEqual(userDecisions.map((command) => (
    coordinatorUserCloudCommandSchema.parse(command).type
  )), [
    'delivery.adoption.record',
    'delivery.revision.request',
    'project.result.publish',
    'project.final_summary.submit'
  ])
  assert.equal(coordinatorUserCloudCommandSchema.safeParse({
    ...userDecisions[0],
    type: 'project.create'
  }).success, false, 'Agent orchestration commands must not enter the User decision schema')
  assert.equal(coordinatorUserCloudCommandSchema.safeParse({
    ...completionCommand,
    ownerApproval: {
      ...completionCommand.ownerApproval,
      actionId: 'act_Complete0002'
    }
  }).success, false, 'A replayed approval with a mismatched digest must be rejected')
  assert.equal(coordinatorCloudCommandSchema.safeParse({
    ...userWrites[0],
    type: 'human.answer',
    humanRequestId: TEST_IDS.humanRequestId,
    requestRevision: 1,
    answer: 'Target-member OIDC answer.'
  }).success, false)
})

test('service parses both commands and Cloud responses at the public boundary', async () => {
  const response: RestResponse = {
    protocolVersion: '1.0',
    type: 'rest.error',
    requestId: TEST_IDS.requestId,
    error: createCollaborationError('revision_conflict', 'Execution fence changed.', {
      requestId: TEST_IDS.requestId,
      expectedRevision: 1,
      currentRevision: 2
    })
  }
  let received: unknown
  let resumedIdempotencyKey: string | undefined
  const service = defineCoordinatorCloudCommandService({
    localAgentId: () => TEST_IDS.agentId,
    execute: async (command) => {
      received = command
      return response
    },
    resume: async (idempotencyKey, validateCommand) => {
      resumedIdempotencyKey = idempotencyKey
      validateCommand(commands[2])
      return { command: commands[2], response }
    },
    executeUser: async () => { throw new Error('unused') },
    resumeUser: async () => null,
    subscribe: () => () => undefined
  })

  assert.equal(service.localAgentId(), TEST_IDS.agentId)
  assert.deepEqual(await service.execute(commands[2]), response)
  assert.deepEqual(received, commands[2])
  let validatedReplay: unknown
  assert.deepEqual(await service.resume(commands[2].idempotencyKey, (command) => {
    validatedReplay = command
  }), {
    command: commands[2],
    response
  })
  assert.equal(resumedIdempotencyKey, commands[2].idempotencyKey)
  assert.deepEqual(validatedReplay, commands[2])
  const invalidLocalIdentity = defineCoordinatorCloudCommandService({
    localAgentId: () => 'not-an-agent-id',
    execute: async () => response,
    resume: async () => null,
    executeUser: async () => { throw new Error('unused') },
    resumeUser: async () => null,
    subscribe: () => () => undefined
  })
  assert.throws(() => invalidLocalIdentity.localAgentId())
  await assert.rejects(
    service.execute({ ...commands[2], route: '/v1/internal/write' } as never)
  )
  await assert.rejects(service.resume('retry', () => undefined))

  const invalidResponseService = defineCoordinatorCloudCommandService({
    localAgentId: () => TEST_IDS.agentId,
    execute: async () => ({
      ...response,
      rawUpstreamBody: { internalDebug: 'must-not-be-retained' }
    } as never),
    resume: async () => null,
    executeUser: async () => { throw new Error('unused') },
    resumeUser: async () => null,
    subscribe: () => () => undefined
  })
  await assert.rejects(invalidResponseService.execute(commands[2]))

  const invalidReplayService = defineCoordinatorCloudCommandService({
    localAgentId: () => TEST_IDS.agentId,
    execute: async () => response,
    resume: async (_idempotencyKey, validateCommand) => {
      validateCommand(commands[2])
      return {
        command: commands[2],
        response: { ...response, requestId: 'req_Reque0000002' }
      }
    },
    executeUser: async () => { throw new Error('unused') },
    resumeUser: async () => null,
    subscribe: () => () => undefined
  })
  await assert.rejects(
    invalidReplayService.resume(commands[2].idempotencyKey, () => undefined)
  )

  const unvalidatedReplayService = defineCoordinatorCloudCommandService({
    localAgentId: () => TEST_IDS.agentId,
    execute: async () => response,
    resume: async () => ({ command: commands[2], response }),
    executeUser: async () => { throw new Error('unused') },
    resumeUser: async () => null,
    subscribe: () => () => undefined
  })
  await assert.rejects(
    unvalidatedReplayService.resume(commands[2].idempotencyKey, () => undefined),
    /was not validated before resumption/u
  )
})

test('service exposes one strict Coordinator Agent Inbox subscription boundary', async () => {
  let upstreamHandler: CoordinatorAgentInboxHandler | undefined
  let disposed = false
  const service = defineCoordinatorCloudCommandService({
    localAgentId: () => TEST_IDS.agentId,
    execute: async () => { throw new Error('unused') },
    resume: async () => null,
    executeUser: async () => { throw new Error('unused') },
    resumeUser: async () => null,
    subscribe: (handler) => {
      upstreamHandler = handler
      return () => { disposed = true }
    }
  })
  const received: unknown[] = []
  const dispose = service.subscribe(async (message) => { received.push(message) })
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    payload: {
      protocolVersion: '1.0',
      type: 'human.answer.received',
      answer: {
        ...humanAnswerFixture,
        context: {
          scope: 'coordinator_project',
          coordinatorAuthorityEpoch: 2
        }
      }
    }
  })

  await upstreamHandler?.(message)
  assert.deepEqual(received, [message])
  await assert.rejects(
    upstreamHandler?.({ ...message, rawCredential: 'forbidden' } as never) ?? Promise.resolve()
  )
  dispose()
  assert.equal(disposed, true)
})
