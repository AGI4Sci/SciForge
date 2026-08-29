import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentInboxMessageSchema,
  projectFinalSummarySchema,
  projectRecordSchema,
  taskExecutionSchema,
  taskOfferSchema,
  taskReviewDecisionSchema,
  taskSchema,
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
  projectFixture,
  taskFixture
} from '@sciforge/collaboration-contracts/testing'
import type { CoordinatorCloudCommandService } from '@sciforge/domain-collaboration/coordinator-cloud-command'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'

import {
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorProject
} from './contract.js'
import {
  createProjectCoordinatorActionPort,
  defineProjectCoordinatorWorkspacePort
} from './ports.js'
import { ProjectCoordinatorStateStore } from './state.js'

test('Coordinator consumes the canonical project.started Inbox notification from fresh Cloud facts', async () => {
  const workspace = workspaceFixture()
  let reads = 0
  let continuations = 0
  let releaseContinuation!: () => void
  const continuationGate = new Promise<void>((resolve) => {
    releaseContinuation = resolve
  })
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => {
        reads += 1
        return workspace
      }
    }),
    coordinatorCloudCommands: {
      resume: async () => null,
      execute: async () => { throw new Error('Project start consumption must not write to Cloud.') },
      subscribe: () => () => undefined
    },
    transport: unusedTransport(),
    state: coordinatorState(),
    continuation: {
      reconcileProject: async () => {
        continuations += 1
        await continuationGate
        return workspace
      }
    }
  })

  let handled = false
  const handling = port.handleInbox(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    recipientAgentId: projectFixture.coordinatorAgentId,
    payload: {
      protocolVersion: '1.0',
      type: 'project.started',
      projectId: projectFixture.projectId,
      revision: projectFixture.revision
    }
  })).then(() => { handled = true })

  await Promise.resolve()
  assert.equal(handled, false)
  releaseContinuation()
  await handling

  assert.equal(reads, 1)
  assert.equal(continuations, 1)
})

test('accepted observation Inbox durably wakes the same Cloud-facts continuation', async () => {
  const observation = projectRecordSchema.parse({
    schemaVersion: 1,
    type: 'project_record',
    projectRecordId: TEST_IDS.projectRecordId,
    projectId: TEST_IDS.projectId,
    kind: 'observation',
    status: 'accepted',
    body: 'The accepted Worker result is ready for dependent continuation.',
    authorUserId: projectFixture.ownerUserId,
    authorAgentId: projectFixture.coordinatorAgentId,
    sourceTaskId: TEST_IDS.taskId,
    sourceResultSubmissionId: TEST_IDS.resultSubmissionId,
    sourceHumanAnswerId: null,
    sourceRevision: 1,
    acceptedByUserId: projectFixture.ownerUserId,
    acceptedByAgentId: projectFixture.coordinatorAgentId,
    acceptedAt: TEST_TIMESTAMP,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP
  })
  const base = workspaceFixture()
  const workspace = {
    ...base,
    projects: [{ ...base.projects[0]!, records: [observation] }]
  }
  let continuations = 0
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspace
    }),
    coordinatorCloudCommands: {
      resume: async () => null,
      execute: async () => { throw new Error('An observation wake must not write before reconcile.') },
      subscribe: () => () => undefined
    },
    transport: unusedTransport(),
    state: coordinatorState(),
    continuation: {
      reconcileProject: async () => {
        continuations += 1
        return workspace
      }
    }
  })

  await port.handleInbox(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    recipientAgentId: projectFixture.coordinatorAgentId,
    payload: {
      protocolVersion: '1.0',
      type: 'project_record.submitted',
      projectId: projectFixture.projectId,
      projectRecordId: observation.projectRecordId,
      revision: observation.revision
    }
  }))

  assert.equal(continuations, 1)
})

test('task.offer.closed is attention-only for exact fresh facts and rejects stale or Worker facts', async () => {
  const workspace = closedOfferWorkspaceFixture()
  let reads = 0
  let continuations = 0
  let commands = 0
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => {
        reads += 1
        return workspace
      }
    }),
    coordinatorCloudCommands: {
      resume: async () => null,
      execute: async () => {
        commands += 1
        throw new Error('A closed offer notification must not automatically re-offer the Task.')
      },
      subscribe: () => () => undefined
    },
    transport: unusedTransport(),
    state: coordinatorState(),
    continuation: {
      reconcileProject: async () => {
        continuations += 1
        return workspace
      }
    }
  })
  const exact = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    recipientAgentId: projectFixture.coordinatorAgentId,
    payload: {
      protocolVersion: '1.0',
      type: 'task.offer.closed',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      taskOfferId: TEST_IDS.taskOfferId,
      audience: 'coordinator',
      outcome: 'rejected',
      taskRevision: 2,
      offerRevision: 2
    }
  })

  await port.handleInbox(exact)
  for (const payload of [{ ...exact.payload, taskRevision: 3 },
    { ...exact.payload, offerRevision: 3 }]) {
    await assert.rejects(port.handleInbox(agentInboxMessageSchema.parse({
      ...exact,
      payload
    })), /Task offer closure does not match fresh Cloud Task facts\./u)
  }
  await assert.rejects(port.handleInbox(agentInboxMessageSchema.parse({
    ...exact,
    payload: {
      ...exact.payload,
      audience: 'worker'
    }
  })), /Project Coordinator received a Worker-only Task offer closure\./u)

  assert.equal(reads, 3)
  assert.equal(continuations, 0)
  assert.equal(commands, 0)
})

test('task.execution.failed is attention-only for exact fenced facts and rejects stale or open facts', async () => {
  let workspace = executionWorkspaceFixture('failed', 3)
  let continuations = 0
  let commands = 0
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspace
    }),
    coordinatorCloudCommands: {
      resume: async () => null,
      execute: async () => {
        commands += 1
        throw new Error('A failed execution notification must not automatically re-offer the Task.')
      },
      subscribe: () => () => undefined
    },
    transport: unusedTransport(),
    state: coordinatorState(),
    continuation: {
      reconcileProject: async () => {
        continuations += 1
        return workspace
      }
    }
  })
  const exact = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    recipientAgentId: projectFixture.coordinatorAgentId,
    payload: {
      protocolVersion: '1.0',
      type: 'task.execution.failed',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      taskRevision: 3,
      executionRevision: 3,
      taskStatus: 'revision_requested',
      retryable: true,
      safeFailureCode: 'runtime.failed',
      safeMessage: 'The Worker execution failed before producing a result.'
    }
  })

  await port.handleInbox(exact)
  for (const payload of [{ ...exact.payload, taskRevision: 4 },
    { ...exact.payload, executionRevision: 4 }]) {
    await assert.rejects(port.handleInbox(agentInboxMessageSchema.parse({
      ...exact,
      payload
    })), /Task execution failure does not match fresh fenced Cloud facts\./u)
  }
  workspace = executionWorkspaceFixture('running', 3)
  await assert.rejects(port.handleInbox(exact),
    /Task execution failure does not match fresh fenced Cloud facts\./u)

  assert.equal(continuations, 0)
  assert.equal(commands, 0)
})

test('task.execution.started triggers continuation only for exact fresh running facts', async () => {
  const workspace = executionWorkspaceFixture('running', 2)
  let continuations = 0
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspace
    }),
    coordinatorCloudCommands: {
      resume: async () => null,
      execute: async () => { throw new Error('Execution start consumption must not write to Cloud.') },
      subscribe: () => () => undefined
    },
    transport: unusedTransport(),
    state: coordinatorState(),
    continuation: {
      reconcileProject: async () => {
        continuations += 1
        return workspace
      }
    }
  })
  const exact = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    recipientAgentId: projectFixture.coordinatorAgentId,
    payload: {
      protocolVersion: '1.0',
      type: 'task.execution.started',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      taskRevision: 2,
      executionRevision: 2
    }
  })

  await port.handleInbox(exact)
  for (const payload of [{ ...exact.payload, taskRevision: 3 },
    { ...exact.payload, executionRevision: 3 }]) {
    await assert.rejects(port.handleInbox(agentInboxMessageSchema.parse({
      ...exact,
      payload
    })), /Task execution start does not match fresh Cloud Task facts\./u)
  }
  await assert.rejects(port.handleInbox(agentInboxMessageSchema.parse({
    ...exact,
    payload: {
      ...exact.payload,
      executionId: 'exe_Exec00000002'
    }
  })), /Task execution start does not match fresh Cloud Task facts\./u)

  assert.equal(continuations, 1)
})

test('Coordinator creates Project-scoped HumanNeeded for one explicit Project member User', async () => {
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
    targetUserId: TEST_IDS.secondUserId,
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
    resume: async () => null,
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
      deviceId: TEST_IDS.deviceId,
      deviceRevision: 1
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
    continuation: { reconcileProject: async () => workspace },
    requestId: () => `req_CoordinatorAction${String(++requestOrdinal).padStart(3, '0')}`
  })

  await port.createHumanNeeded({
    projectId: TEST_IDS.projectId,
    targetUserId: TEST_IDS.secondUserId,
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
    targetUserId: TEST_IDS.secondUserId,
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
    resume: async () => null,
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
        nextTaskOfferId: command.decision === 'request_revision' ? 'ofr_NextRevision001' : null,
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
  const continuedProjects: string[] = []
  const continuationFailures: string[] = []
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspaceFixture()
    }),
    coordinatorCloudCommands,
    transport: unusedTransport(),
    state: coordinatorState(),
    continuation: {
      reconcileProject: async (projectId) => {
        continuedProjects.push(projectId)
        throw new Error('Injected continuation failure after the committed review.')
      }
    },
    onBackgroundContinuationFailure: (projectId, error) => {
      continuationFailures.push(`${projectId}:${error instanceof Error ? error.message : String(error)}`)
    },
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
    nextWorkerUserId: null,
    nextOfferExpiresAt: null,
    nextFileIntent: null
  }, 'idem_ResultAccept0001')
  await port.reviewResult({
    ...common,
    decision: 'request_revision',
    instruction: 'Re-run with the Owner-confirmed cost assumptions.',
    nextWorkerUserId: TEST_IDS.secondUserId,
    nextOfferExpiresAt: TEST_LATER_TIMESTAMP,
    nextFileIntent: null
  }, 'idem_ResultRevision01')
  await Promise.resolve()

  assert.deepEqual(commands.map((command) => command.type), [
    'task.result.review',
    'task.result.review'
  ])
  assert.deepEqual(continuedProjects, [TEST_IDS.projectId])
  assert.deepEqual(continuationFailures, [
    `${TEST_IDS.projectId}:Injected continuation failure after the committed review.`
  ])
  assert.deepEqual(commands.map((command) => (
    command.type === 'task.result.review'
      ? {
          decision: command.decision,
          instruction: command.instruction,
          nextWorkerUserId: command.nextWorkerUserId
        }
      : null
  )), [{
    decision: 'accept',
    instruction: null,
    nextWorkerUserId: null
  }, {
    decision: 'request_revision',
    instruction: 'Re-run with the Owner-confirmed cost assumptions.',
    nextWorkerUserId: TEST_IDS.secondUserId
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
    resume: async () => null,
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
    continuation: { reconcileProject: async () => completedWorkspace },
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

test('durable Coordinator Inbox turns the exact target member HumanAnswer into one official decision', async () => {
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
    resume: async () => null,
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
    continuation: { reconcileProject: async () => workspaceFixture() },
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

function closedOfferWorkspaceFixture() {
  const task = taskSchema.parse({
    ...taskFixture,
    status: 'revision_requested',
    revision: 2,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const offer = taskOfferSchema.parse({
    schemaVersion: 1,
    type: 'task_offer',
    taskOfferId: TEST_IDS.taskOfferId,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: null,
    workerUserId: TEST_IDS.secondUserId,
    offeredByCoordinatorAgentId: projectFixture.coordinatorAgentId,
    state: 'rejected',
    reassignmentTaskRevision: task.revision,
    offeredAt: TEST_TIMESTAMP,
    expiresAt: TEST_LATER_TIMESTAMP,
    respondedAt: TEST_LATER_TIMESTAMP,
    revision: 2,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  return workspaceFixture(projectFixture, {
    tasks: [{ task, executions: [] }],
    offers: [offer]
  })
}

function executionWorkspaceFixture(state: 'running' | 'failed', revision: number) {
  const failed = state === 'failed'
  const task = taskSchema.parse({
    ...taskFixture,
    currentExecutionId: TEST_IDS.executionId,
    currentExecutionState: state,
    status: failed ? 'revision_requested' : 'in_progress',
    executionCount: 1,
    revision,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const execution = taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    attempt: 1,
    offeredByCoordinatorAgentId: projectFixture.coordinatorAgentId,
    assigneeUserId: TEST_IDS.secondUserId,
    assigneeAgentId: TEST_IDS.secondAgentId,
    assigneeDeviceId: TEST_IDS.deviceId,
    state,
    stateRevision: revision,
    fence: {
      schemaVersion: 1,
      executionId: TEST_IDS.executionId,
      assigneeUserId: TEST_IDS.secondUserId,
      assigneeAgentId: TEST_IDS.secondAgentId,
      assigneeDeviceId: TEST_IDS.deviceId,
      assignmentTaskRevision: 1,
      projectExecutionAuthorityEpoch: projectFixture.executionAuthorityEpoch,
      userTaskAuthorityEpoch: 1,
      bindingRevision: null,
      status: failed ? 'fenced' : 'open',
      reason: failed ? 'execution_failed' : null,
      fencedAt: failed ? TEST_LATER_TIMESTAMP : null
    },
    fileIntent: null,
    currentResultSubmissionId: null,
    offeredAt: TEST_TIMESTAMP,
    acceptedAt: TEST_TIMESTAMP,
    startedAt: TEST_TIMESTAMP,
    terminalAt: failed ? TEST_LATER_TIMESTAMP : null,
    revision,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  return workspaceFixture(projectFixture, {
    tasks: [{ task, executions: [execution] }]
  })
}

function workspaceFixture(
  project = projectFixture,
  facts: Readonly<{
    finalSummary?: ProjectFinalSummary
    records?: ProjectRecord[]
    tasks?: ProjectCoordinatorProject['tasks']
    offers?: ProjectCoordinatorProject['offers']
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
    availableWorkerUsers: [],
    providerPrincipalFacts: [],
    projects: [{
      project,
      plan: null,
      memberUsers: [{
        schemaVersion: 1,
        type: 'project_user_label_fact',
        projectId: project.projectId,
        userId: project.ownerUserId,
        displayName: 'Project Owner',
        status: 'active',
        revision: 1,
        observedAt: TEST_TIMESTAMP
      }, {
        schemaVersion: 1,
        type: 'project_user_label_fact',
        projectId: project.projectId,
        userId: TEST_IDS.secondUserId,
        displayName: 'Project Member',
        status: 'active',
        revision: 1,
        observedAt: TEST_TIMESTAMP
      }],
      workerGroups: [],
      tasks: facts.tasks ?? [],
      offers: facts.offers ?? [],
      reviews: [],
      pendingHumanNeeded: [],
      records: facts.records ?? [],
      finalSummary: facts.finalSummary ?? null,
      provisioning: {
        intent: null,
        attestation: null,
        binding: null,
        memberships: [projectMembership(project, project.ownerUserId, 'pmb_ProjectOwner01'),
          projectMembership(project, TEST_IDS.secondUserId, 'pmb_ProjectMember01')],
        providerPrincipalFacts: [],
        contentReadiness: [],
        providerMembershipObservations: [],
        externalOperationJournal: [],
        recoveryActions: []
      }
    }]
  })
}

function projectMembership(project: typeof projectFixture, userId: string, projectMembershipId: string) {
  return {
    schemaVersion: 1 as const,
    type: 'project_membership' as const,
    projectMembershipId,
    projectId: project.projectId,
    userId,
    state: 'active' as const,
    authorityEpoch: 1,
    activatedAt: project.createdAt,
    removalRequestedAt: null,
    removalRequestedByUserId: null,
    removedAt: null,
    revision: 1,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  }
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
