import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TEST_HASH,
  TEST_IDS,
  TEST_TIMESTAMP,
  agentInboxMessageFixture,
  humanAnswerFixture
} from '@sciforge/collaboration-contracts/testing'
import {
  agentInboxMessageSchema,
  createCollaborationError,
  type RestResponse
} from '@sciforge/collaboration-contracts'

import {
  COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
  COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
  coordinatorCloudCommandSchema,
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
    idempotencyKey: 'idem_project.plan.submit-01',
    type: 'project.plan.submit' as const,
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    supersedesProjectPlanId: null,
    sourceInputLocators: [],
    tasks: [{
      workerUserId: TEST_IDS.secondUserId,
      planItemId: 'item_Plan00000001',
      title: 'Analyze the synthetic meeting input',
      objective: 'Produce one bounded synthetic result.',
      completionCriteria: ['The result is ready for Coordinator review.'],
      dependencyPlanItemIds: [],
      requiredCapabilityTags: ['agent.execute'],
      fileIntent: null
    }],
    rationale: 'This is the smallest complete synthetic meeting plan.',
    runtimeProvenance: {
      runtimeId: 'codex',
      modelId: null,
      generatedByCoordinatorAgentId: TEST_IDS.agentId,
      generatedAt: TEST_TIMESTAMP
    },
    planDigest: TEST_HASH
  },
  {
    ...envelope,
    idempotencyKey: 'idem_task.offer.create-01',
    type: 'task.offer.create' as const,
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    projectPlanId: TEST_IDS.projectPlanId,
    expectedPlanRevision: 1,
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
  }
] as const

test('Coordinator Cloud command service exposes one closed Agent-command allowlist', () => {
  assert.equal(COORDINATOR_CLOUD_COMMAND_SERVICE_ID, 'sciforge.collaboration.coordinator-cloud-command')
  assert.equal(COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION, '6.2.0')
  assert.deepEqual(commands.map((command) => coordinatorCloudCommandSchema.parse(command).type), [
    'project.create',
    'project.plan.submit',
    'task.offer.create',
    'task.offer.withdraw',
    'task.offer.reassign'
  ])

  for (const forbiddenType of [
    'project.plan.confirm',
    'task.offer.accept',
    'task.result.submit',
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

test('Coordinator Agent allowlist owns HumanNeeded, review, decision, and final completion writes', () => {
  const coordinatorWrites = [{
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
    idempotencyKey: 'idem_task.result.review-01',
    type: 'task.result.review' as const,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    resultSubmissionId: TEST_IDS.resultSubmissionId,
    expectedProjectRevision: 5,
    expectedTaskRevision: 4,
    expectedExecutionRevision: 4,
    expectedResultRevision: 1,
    expectedCoordinatorAuthorityEpoch: 2,
    decision: 'accept' as const,
    instruction: null,
    nextWorkerUserId: null,
    nextOfferExpiresAt: null,
    nextFileIntent: null
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
  }, {
    ...envelope,
    idempotencyKey: 'idem_project.final_summary.submit-01',
    type: 'project.final_summary.submit' as const,
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: 7,
    expectedCoordinatorAuthorityEpoch: 2,
    expectedExecutionAuthorityEpoch: 1,
    projectPlanId: TEST_IDS.projectPlanId,
    confirmedPlanRevision: 2,
    acceptedResultSubmissionIds: [TEST_IDS.resultSubmissionId],
    summary: 'The accepted results and Owner decision complete the Project.'
  }]

  assert.deepEqual(coordinatorWrites.map((command) => (
    coordinatorCloudCommandSchema.parse(command).type
  )), [
    'human.needed.create',
    'task.result.review',
    'project.decision.submit',
    'project.final_summary.submit'
  ])
  assert.equal(coordinatorCloudCommandSchema.safeParse({
    ...coordinatorWrites[0],
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
    subscribe: () => () => undefined
  })
  await assert.rejects(
    invalidReplayService.resume(commands[2].idempotencyKey, () => undefined)
  )

  const unvalidatedReplayService = defineCoordinatorCloudCommandService({
    localAgentId: () => TEST_IDS.agentId,
    execute: async () => response,
    resume: async () => ({ command: commands[2], response }),
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
