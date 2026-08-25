import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentInboxMessageSchema,
  projectFinalSummarySchema,
  projectRecordSchema,
  taskReviewDecisionSchema,
  type ProjectFinalSummary,
  type ProjectRecord,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import {
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP,
  agentInboxMessageFixture,
  humanAnswerFixture,
  humanNeededFixture,
  projectFixture
} from '@sciforge/collaboration-contracts/testing'
import type { CoordinatorCloudCommandService } from '@sciforge/domain-collaboration/coordinator-cloud-command'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'

import { projectCoordinatorWorkspaceSchema } from './contract.js'
import {
  createProjectCoordinatorActionPort,
  defineProjectCoordinatorWorkspacePort
} from './ports.js'
import { ProjectCoordinatorStateStore } from './state.js'

test('Coordinator creates Project-scoped HumanNeeded while only the OIDC Owner answers it', async () => {
  const workspace = workspaceFixture()
  const coordinatorCommands: RestRequest[] = []
  const userCommands: RestRequest[] = []
  const needed = {
    ...humanNeededFixture,
    projectId: TEST_IDS.projectId,
    context: {
      scope: 'coordinator_project' as const,
      coordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch
    },
    targetUserId: projectFixture.ownerUserId,
    requestedByAgentId: projectFixture.coordinatorAgentId
  }
  const answer = {
    ...humanAnswerFixture,
    projectId: TEST_IDS.projectId,
    humanRequestId: needed.humanRequestId,
    context: needed.context,
    answeredByUserId: projectFixture.ownerUserId
  }
  const coordinatorCloudCommands: CoordinatorCloudCommandService = {
    execute: async (command) => {
      coordinatorCommands.push(command)
      return entityResponse(command.requestId, needed)
    },
    subscribe: () => () => undefined
  }
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: projectFixture.ownerUserId,
      deviceId: TEST_IDS.deviceId
    }),
    execute: async ({ payload }) => {
      const command = payload as RestRequest
      userCommands.push(command)
      return { contractVersion: 1, status: 200, body: entityResponse(command.requestId, answer) }
    }
  }
  let requestOrdinal = 0
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspace
    }),
    coordinatorCloudCommands,
    transport,
    state: coordinatorState(),
    requestId: () => `req_CoordinatorAction${String(++requestOrdinal).padStart(3, '0')}`
  })

  await port.createHumanNeeded({
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: projectFixture.revision,
    expectedCoordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch,
    requiredAssurance: 'verified',
    prompt: 'Which accepted direction should become the official Project decision?',
    expiresAt: TEST_LATER_TIMESTAMP
  }, 'idem_CoordinatorHuman01')
  await port.answerHumanNeeded({
    projectId: TEST_IDS.projectId,
    humanRequestId: needed.humanRequestId,
    requestRevision: needed.revision,
    answer: 'Proceed with the lower-risk training plan.'
  }, 'idem_OwnerHumanAnswer01')

  assert.deepEqual(coordinatorCommands, [{
    protocolVersion: '1.0',
    requestId: 'req_CoordinatorAction001',
    type: 'human.needed.create',
    idempotencyKey: 'idem_CoordinatorHuman01',
    projectId: TEST_IDS.projectId,
    context: {
      scope: 'coordinator_project',
      expectedProjectRevision: projectFixture.revision,
      expectedCoordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch
    },
    requiredAssurance: 'verified',
    prompt: 'Which accepted direction should become the official Project decision?',
    confirmableAction: null,
    expiresAt: TEST_LATER_TIMESTAMP
  }])
  assert.equal(Object.hasOwn(coordinatorCommands[0]!, 'targetUserId'), false)
  assert.equal(Object.hasOwn(coordinatorCommands[0]!, 'executionId'), false)
  assert.deepEqual(userCommands, [{
    protocolVersion: '1.0',
    requestId: 'req_CoordinatorAction002',
    type: 'human.answer',
    idempotencyKey: 'idem_OwnerHumanAnswer01',
    humanRequestId: needed.humanRequestId,
    requestRevision: needed.revision,
    answer: 'Proceed with the lower-risk training plan.'
  }])
})

test('Coordinator accepts or requests revision through the exact immutable result submission', async () => {
  const commands: RestRequest[] = []
  const coordinatorCloudCommands: CoordinatorCloudCommandService = {
    execute: async (command) => {
      commands.push(command)
      if (command.type !== 'task.result.review') throw new Error(`Unexpected ${command.type}.`)
      const review = taskReviewDecisionSchema.parse({
        schemaVersion: 1,
        type: 'task_review_decision',
        reviewDecisionId: command.decision === 'accept' ? 'rvw_AcceptReview001' : 'rvw_ReviseReview001',
        projectId: command.projectId,
        taskId: command.taskId,
        executionId: command.executionId,
        resultSubmissionId: command.resultSubmissionId,
        reviewedResultRevision: command.expectedResultRevision,
        decidedByUserId: projectFixture.ownerUserId,
        decidedByCoordinatorAgentId: projectFixture.coordinatorAgentId,
        decision: command.decision,
        instruction: command.instruction,
        acceptedProjectRecordId: command.decision === 'accept' ? TEST_IDS.projectRecordId : null,
        nextExecutionId: command.decision === 'request_revision' ? 'exe_NextRevision001' : null,
        decidedAt: TEST_TIMESTAMP,
        revision: 1,
        createdAt: TEST_TIMESTAMP,
        updatedAt: TEST_TIMESTAMP
      })
      return {
        protocolVersion: '1.0',
        type: 'rest.collection',
        requestId: command.requestId,
        items: [review]
      }
    },
    subscribe: () => () => undefined
  }
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspaceFixture()
    }),
    coordinatorCloudCommands,
    transport: unusedTransport(),
    state: coordinatorState(),
    requestId: (() => {
      let ordinal = 0
      return () => `req_ResultReview${String(++ordinal).padStart(4, '0')}`
    })()
  })
  const common = {
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    resultSubmissionId: TEST_IDS.resultSubmissionId,
    expectedProjectRevision: 5,
    expectedTaskRevision: 4,
    expectedExecutionRevision: 4,
    expectedResultRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1
  }

  await port.reviewResult({
    ...common,
    decision: 'accept',
    instruction: null,
    nextAssigneeAgentId: null,
    expectedNextAssigneeAvailabilityRevision: null,
    nextOfferExpiresAt: null,
    nextFileIntent: null
  }, 'idem_ResultAccept0001')
  await port.reviewResult({
    ...common,
    decision: 'request_revision',
    instruction: 'Re-run with the Owner-confirmed cost assumptions.',
    nextAssigneeAgentId: TEST_IDS.secondAgentId,
    expectedNextAssigneeAvailabilityRevision: 7,
    nextOfferExpiresAt: TEST_LATER_TIMESTAMP,
    nextFileIntent: null
  }, 'idem_ResultRevision01')

  assert.deepEqual(commands.map((command) => command.type), [
    'task.result.review',
    'task.result.review'
  ])
  assert.deepEqual(commands.map((command) => (
    command.type === 'task.result.review'
      ? {
          decision: command.decision,
          instruction: command.instruction,
          nextAssigneeAgentId: command.nextAssigneeAgentId,
          availabilityRevision: command.expectedNextAssigneeAvailabilityRevision
        }
      : null
  )), [{
    decision: 'accept',
    instruction: null,
    nextAssigneeAgentId: null,
    availabilityRevision: null
  }, {
    decision: 'request_revision',
    instruction: 'Re-run with the Owner-confirmed cost assumptions.',
    nextAssigneeAgentId: TEST_IDS.secondAgentId,
    availabilityRevision: 7
  }])
})

test('Coordinator final summary atomically completes the Project through accepted results', async () => {
  const finalSummary = projectFinalSummarySchema.parse({
    schemaVersion: 1,
    type: 'project_final_summary',
    projectId: TEST_IDS.projectId,
    projectRecordId: 'rec_FinalSummary001',
    projectPlanId: TEST_IDS.projectPlanId,
    confirmedPlanRevision: 2,
    acceptedResultSubmissionIds: [TEST_IDS.resultSubmissionId],
    summary: 'Resolved the analysis, recorded the Owner decision, and assigned the next validation step.',
    createdByUserId: projectFixture.ownerUserId,
    createdByCoordinatorAgentId: projectFixture.coordinatorAgentId,
    completedAt: TEST_LATER_TIMESTAMP,
    revision: 1,
    createdAt: TEST_LATER_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const summaryRecord = projectRecordSchema.parse({
    schemaVersion: 1,
    type: 'project_record',
    projectRecordId: finalSummary.projectRecordId,
    projectId: TEST_IDS.projectId,
    kind: 'summary',
    status: 'accepted',
    body: finalSummary.summary,
    authorUserId: projectFixture.ownerUserId,
    authorAgentId: projectFixture.coordinatorAgentId,
    sourceTaskId: null,
    sourceResultSubmissionId: null,
    sourceHumanAnswerId: null,
    sourceRevision: 1,
    acceptedByUserId: projectFixture.ownerUserId,
    acceptedByAgentId: projectFixture.coordinatorAgentId,
    acceptedAt: TEST_LATER_TIMESTAMP,
    revision: 1,
    createdAt: TEST_LATER_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const completedProject = {
    ...projectFixture,
    status: 'completed' as const,
    executionAuthorityEpoch: projectFixture.executionAuthorityEpoch + 1,
    revision: projectFixture.revision + 1,
    updatedAt: TEST_LATER_TIMESTAMP
  }
  const completedWorkspace = workspaceFixture(completedProject, {
    finalSummary,
    records: [summaryRecord]
  })
  const commands: RestRequest[] = []
  const coordinatorCloudCommands: CoordinatorCloudCommandService = {
    execute: async (command) => {
      commands.push(command)
      return {
        protocolVersion: '1.0',
        type: 'rest.collection',
        requestId: command.requestId,
        items: [completedProject, summaryRecord, finalSummary]
      }
    },
    subscribe: () => () => undefined
  }
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => completedWorkspace
    }),
    coordinatorCloudCommands,
    transport: unusedTransport(),
    state: coordinatorState(),
    requestId: () => 'req_FinalSummary0001'
  })

  const result = await port.completeProject({
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: projectFixture.revision,
    expectedCoordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: projectFixture.executionAuthorityEpoch,
    projectPlanId: TEST_IDS.projectPlanId,
    confirmedPlanRevision: 2,
    acceptedResultSubmissionIds: [TEST_IDS.resultSubmissionId],
    summary: finalSummary.summary
  }, 'idem_FinalSummary0001')

  assert.equal(result.projects[0]?.project.status, 'completed')
  assert.deepEqual(result.projects[0]?.finalSummary, finalSummary)
  assert.deepEqual(commands, [{
    protocolVersion: '1.0',
    requestId: 'req_FinalSummary0001',
    type: 'project.final_summary.submit',
    idempotencyKey: 'idem_FinalSummary0001',
    projectId: TEST_IDS.projectId,
    expectedProjectRevision: projectFixture.revision,
    expectedCoordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: projectFixture.executionAuthorityEpoch,
    projectPlanId: TEST_IDS.projectPlanId,
    confirmedPlanRevision: 2,
    acceptedResultSubmissionIds: [TEST_IDS.resultSubmissionId],
    summary: finalSummary.summary
  }])
})

test('durable Coordinator Inbox turns the exact Owner HumanAnswer into one official decision', async () => {
  const answer = {
    ...humanAnswerFixture,
    context: {
      scope: 'coordinator_project' as const,
      coordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch
    },
    answer: 'Use the lower-risk plan and keep the cost cap.',
    decision: null,
    confirmationId: null
  }
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    recipientAgentId: projectFixture.coordinatorAgentId,
    payload: {
      protocolVersion: '1.0',
      type: 'human.answer.received',
      answer
    }
  })
  const decisionRecord = projectRecordSchema.parse({
    schemaVersion: 1,
    type: 'project_record',
    projectRecordId: 'rec_OwnerDecision001',
    projectId: TEST_IDS.projectId,
    kind: 'decision',
    status: 'accepted',
    body: answer.answer,
    authorUserId: projectFixture.ownerUserId,
    authorAgentId: projectFixture.coordinatorAgentId,
    sourceTaskId: null,
    sourceResultSubmissionId: null,
    sourceHumanAnswerId: answer.humanAnswerId,
    sourceRevision: answer.revision,
    acceptedByUserId: projectFixture.ownerUserId,
    acceptedByAgentId: projectFixture.coordinatorAgentId,
    acceptedAt: TEST_LATER_TIMESTAMP,
    revision: 1,
    createdAt: TEST_LATER_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const commands: RestRequest[] = []
  const coordinatorCloudCommands: CoordinatorCloudCommandService = {
    execute: async (command) => {
      commands.push(command)
      return {
        protocolVersion: '1.0',
        type: 'rest.collection',
        requestId: command.requestId,
        items: [{ ...projectFixture, revision: projectFixture.revision + 1 }, decisionRecord]
      }
    },
    subscribe: () => () => undefined
  }
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => commands.length === 0
        ? workspaceFixture()
        : workspaceFixture(
            { ...projectFixture, revision: projectFixture.revision + 1 },
            { records: [decisionRecord] }
          )
    }),
    coordinatorCloudCommands,
    transport: unusedTransport(),
    state: coordinatorState(),
    requestId: () => 'req_ProjectDecision001'
  })

  await port.handleInbox(message)
  await port.handleInbox(message)

  assert.equal(commands.length, 1)
  assert.deepEqual(commands[0]?.type === 'project.decision.submit' ? {
    type: commands[0].type,
    idempotencyKey: commands[0].idempotencyKey,
    projectId: commands[0].projectId,
    humanRequestId: commands[0].humanRequestId,
    humanAnswerId: commands[0].humanAnswerId,
    expectedProjectRevision: commands[0].expectedProjectRevision,
    expectedCoordinatorAuthorityEpoch: commands[0].expectedCoordinatorAuthorityEpoch,
    expectedHumanRequestRevision: commands[0].expectedHumanRequestRevision,
    expectedHumanAnswerRevision: commands[0].expectedHumanAnswerRevision,
    decision: commands[0].decision
  } : null, {
    type: 'project.decision.submit',
    idempotencyKey: commands[0]!.type === 'project.decision.submit'
      ? commands[0]!.idempotencyKey
      : '',
    projectId: TEST_IDS.projectId,
    humanRequestId: answer.humanRequestId,
    humanAnswerId: answer.humanAnswerId,
    expectedProjectRevision: projectFixture.revision,
    expectedCoordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch,
    expectedHumanRequestRevision: answer.requestRevision + 1,
    expectedHumanAnswerRevision: answer.revision,
    decision: answer.answer
  })
  assert.match(
    commands[0]!.type === 'project.decision.submit' ? commands[0]!.idempotencyKey : '',
    /^idem_project-decision\.[a-f0-9]{48}$/u
  )
})

function workspaceFixture(
  project = projectFixture,
  facts: Readonly<{
    finalSummary?: ProjectFinalSummary
    records?: ProjectRecord[]
  }> = {}
) {
  return projectCoordinatorWorkspaceSchema.parse({
    connection: {
      state: 'ready',
      userId: project.ownerUserId,
      deviceId: TEST_IDS.deviceId
    },
    observedAt: TEST_TIMESTAMP,
    focusedProjectId: TEST_IDS.projectId,
    projects: [{
      project,
      plan: null,
      workerGroups: [],
      tasks: [],
      reviews: [],
      pendingHumanNeeded: [],
      records: facts.records ?? [],
      finalSummary: facts.finalSummary ?? null,
      provisioning: {
        intent: null,
        attestation: null,
        binding: null,
        memberships: [],
        providerPrincipalFacts: [],
        contentReadiness: [],
        providerMembershipObservations: [],
        externalOperationJournal: [],
        recoveryActions: []
      }
    }]
  })
}

function entityResponse(requestId: string, entity: unknown): RestResponse {
  return {
    protocolVersion: '1.0',
    type: 'rest.entity',
    requestId,
    entity
  } as RestResponse
}

function unusedTransport(): AuthenticatedCloudTransport {
  return {
    status: () => ({ state: 'unavailable', reason: 'OIDC transport is unused.' }),
    execute: async () => { throw new Error('OIDC transport is unused.') }
  }
}

function coordinatorState(): ProjectCoordinatorStateStore {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
  return new ProjectCoordinatorStateStore({
    read: async () => ({ revision, value }),
    write: async (next, expectedRevision) => {
      assert.equal(expectedRevision, revision)
      value = next
      revision += 1
      return { revision, value }
    },
    clear: async (expectedRevision) => {
      assert.equal(expectedRevision, revision)
      value = null
      revision += 1
      return { revision, value }
    }
  })
}
