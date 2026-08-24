import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TEST_HASH,
  TEST_IDS,
  TEST_TIMESTAMP
} from '@sciforge/collaboration-contracts/testing'
import {
  createCollaborationError,
  type RestResponse
} from '@sciforge/collaboration-contracts'

import {
  COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
  COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
  coordinatorCloudCommandSchema,
  defineCoordinatorCloudCommandService
} from './coordinator-cloud-command.js'

const envelope = {
  protocolVersion: '1.0' as const,
  requestId: TEST_IDS.requestId
}

const commands = [
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
    assigneeAgentId: TEST_IDS.secondAgentId,
    expectedAvailabilityRevision: 1,
    offerExpiresAt: TEST_TIMESTAMP
  },
  {
    ...envelope,
    idempotencyKey: 'idem_task.offer.withdraw-01',
    type: 'task.offer.withdraw' as const,
    taskOfferId: TEST_IDS.taskOfferId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    expectedTaskRevision: 1,
    expectedExecutionRevision: 1,
    expectedOfferRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    reason: 'Coordinator changed the synthetic assignment.'
  },
  {
    ...envelope,
    idempotencyKey: 'idem_task.offer.reassign-01',
    type: 'task.offer.reassign' as const,
    taskId: TEST_IDS.taskId,
    previousExecutionId: TEST_IDS.executionId,
    expectedTaskRevision: 1,
    expectedExecutionRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    assigneeAgentId: TEST_IDS.secondAgentId,
    expectedAvailabilityRevision: 1,
    offerExpiresAt: TEST_TIMESTAMP
  }
] as const

test('Coordinator Cloud command service exposes one closed Agent-command allowlist', () => {
  assert.equal(COORDINATOR_CLOUD_COMMAND_SERVICE_ID, 'sciforge.collaboration.coordinator-cloud-command')
  assert.equal(COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION, '1.0.0')
  assert.deepEqual(commands.map((command) => coordinatorCloudCommandSchema.parse(command).type), [
    'project.plan.submit',
    'task.offer.create',
    'task.offer.withdraw',
    'task.offer.reassign'
  ])

  for (const forbiddenType of [
    'project.create',
    'project.plan.confirm',
    'task.offer.accept',
    'task.result.submit',
    'task.result.review',
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
  const service = defineCoordinatorCloudCommandService({
    execute: async (command) => {
      received = command
      return response
    }
  })

  assert.deepEqual(await service.execute(commands[2]), response)
  assert.deepEqual(received, commands[2])
  await assert.rejects(
    service.execute({ ...commands[2], route: '/v1/internal/write' } as never)
  )

  const invalidResponseService = defineCoordinatorCloudCommandService({
    execute: async () => ({
      ...response,
      rawUpstreamBody: { internalDebug: 'must-not-be-retained' }
    } as never)
  })
  await assert.rejects(invalidResponseService.execute(commands[2]))
})
