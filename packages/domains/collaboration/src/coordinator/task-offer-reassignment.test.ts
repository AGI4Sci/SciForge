import { cloudInputLocator } from './cloud-test-fixtures.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  restResponseSchema,
  projectRequirementsDocumentSchema,
  taskExecutionSchema,
  taskOfferSchema,
  taskSchema
} from '@sciforge/collaboration-contracts'
import { canonicalTaskIdForRequirementsModule } from '@sciforge/collaboration-contracts/node'
import type {
  CoordinatorCloudCommand,
  CoordinatorCloudCommandReplay,
  CoordinatorCloudCommandService
} from '../coordinator-cloud-command.js'

import {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorWorkspace
} from './contract.js'
import {
  createProjectCoordinatorCapabilityFactory,
  type ProjectCoordinatorCapabilityOptions
} from './main.js'
import {
  createProjectCoordinatorTaskOfferReassignmentPort
} from './task-offer-reassignment.js'

const at = '2026-08-29T02:00:00.000Z'
const projectId = 'prj_ReassignProject01'
const taskId = 'tsk_ReassignTask001'
const executionId = 'exe_ReassignExec001'
const successorExecutionId = 'exe_ReassignExec002'
const previousTaskOfferId = 'ofr_ReassignOffer001'
const successorTaskOfferId = 'ofr_ReassignOffer002'
const previousOutputFileName = 'analysis.revision-1.md'
const successorOutputFileName = 'analysis.revision-2.md'

test('the real handler replays one exact reassignment after its first Cloud response is lost', async () => {
  const current = workspaceFixture('current', 'failed')
  const reassigned = workspaceFixture('reassigned', 'failed')
  const commands: unknown[] = []
  let cloudWorkspace = current
  let cloudTransitions = 0
  let committed: CoordinatorCloudCommandReplay | undefined
  const coordinatorCloudCommands: CoordinatorCloudCommandService = {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
    localAgentId: () => undefined,
    execute: async (command) => {
      commands.push(command)
      if (committed) {
        assert.deepEqual(command, committed.command)
        return committed.response
      }
      cloudTransitions += 1
      cloudWorkspace = reassigned
      const project = reassigned.projects[0]!
      committed = {
        command: structuredClone(command),
        response: restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.collection',
          requestId: command.requestId,
          items: [
            project.tasks[0]!.task,
            project.offers.find(({ taskOfferId }) => (
              taskOfferId === successorTaskOfferId
            ))!
          ]
        })
      }
      throw new Error('response lost after canonical Cloud commit')
    },
    resume: async (idempotencyKey, validateCommand) => {
      if (!committed || committed.command.idempotencyKey !== idempotencyKey) return null
      validateCommand(committed.command)
      commands.push(committed.command)
      return committed
    },
    subscribe: () => () => undefined
  }
  const createHandler = () => createProjectCoordinatorCapabilityFactory<
    ProjectCoordinatorCapabilityOptions
  >({
    defineCapability: (definition) => definition,
    ports: {
      workspace: { readWorkspace: async () => cloudWorkspace },
      coordinatorCloudCommands
    } as never,
    sessions: {} as never,
    projectCreation: {} as never
  }).createDefinitions().find(({ id }) => (
    id === PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign
  ))!.handler
  const input = {
    projectId,
    taskId,
    previousTaskOfferId,
    workerUserId: 'usr_ReassignWorker02',
    offerExpiresAt: '2026-08-29T02:05:00.000Z',
    nextOutputFileName: previousOutputFileName
  }
  const invocation = {
    caller: { audience: 'ui' as const },
    invocationId: 'invocation-reassign-response-loss-001',
    assertPrincipalCurrent: () => undefined
  }

  await assert.rejects(
    createHandler()(input, invocation),
    /response lost after canonical Cloud commit/u
  )
  const restartedHandler = createHandler()
  await assert.rejects(
    restartedHandler({ ...input, workerUserId: 'usr_ReassignWorker03' }, invocation),
    /does not match this invocation/u
  )
  assert.equal(cloudTransitions, 1)
  assert.equal(commands.length, 1)
  assert.deepEqual(await restartedHandler(input, invocation), { output: reassigned })
  assert.equal(cloudTransitions, 1)
  assert.equal(commands.length, 2)
  assert.deepEqual(commands[1], commands[0])
  assert.equal(reassigned.projects[0]!.offers.at(-1)?.taskOfferId, successorTaskOfferId)

  await assert.rejects(
    restartedHandler(input, { ...invocation, invocationId: 'invocation-reassign-new-002' }),
    /exact current revision-requested Task/u
  )
  assert.equal(commands.length, 2)
})

test('the real handler normalizes an omitted text output filename for exact replay', async () => {
  const current = textWorkspaceFixture('current')
  const reassigned = textWorkspaceFixture('reassigned')
  const commands: CoordinatorCloudCommand[] = []
  let cloudWorkspace = current
  let committed: CoordinatorCloudCommandReplay | undefined
  const coordinatorCloudCommands: CoordinatorCloudCommandService = {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
    localAgentId: () => undefined,
    execute: async (command) => {
      commands.push(command)
      cloudWorkspace = reassigned
      const project = reassigned.projects[0]!
      committed = {
        command: structuredClone(command),
        response: restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.collection',
          requestId: command.requestId,
          items: [
            project.tasks[0]!.task,
            project.offers.find(({ taskOfferId }) => (
              taskOfferId === successorTaskOfferId
            ))!
          ]
        })
      }
      throw new Error('response lost after text reassignment commit')
    },
    resume: async (idempotencyKey, validateCommand) => {
      if (!committed || committed.command.idempotencyKey !== idempotencyKey) return null
      validateCommand(committed.command)
      return committed
    },
    subscribe: () => () => undefined
  }
  const handler = createProjectCoordinatorCapabilityFactory<ProjectCoordinatorCapabilityOptions>({
    defineCapability: (definition) => definition,
    ports: {
      workspace: { readWorkspace: async () => cloudWorkspace },
      coordinatorCloudCommands
    } as never,
    sessions: {} as never,
    projectCreation: {} as never
  }).createDefinitions().find(({ id }) => (
    id === PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign
  ))!.handler
  const omittedInput = {
    projectId,
    taskId,
    previousTaskOfferId,
    workerUserId: 'usr_ReassignWorker02',
    offerExpiresAt: '2026-08-29T02:05:00.000Z'
  }
  const invocation = {
    caller: { audience: 'ui' as const },
    invocationId: 'invocation-reassign-omitted-output-001',
    assertPrincipalCurrent: () => undefined
  }

  await assert.rejects(
    handler(omittedInput, invocation),
    /response lost after text reassignment commit/u
  )
  assert.deepEqual(
    await handler({ ...omittedInput, nextOutputFileName: null }, invocation),
    { output: reassigned }
  )
  assert.equal(commands.length, 1)
  const command = commands[0]
  assert.ok(command && command.type === 'task.offer.reassign')
  assert.equal(command.nextFileIntent, null)
})

for (const terminalExecutionState of ['failed', 'cancelled'] as const) {
  test(`Task offer reassignment preserves the concrete file binding after an accepted ${
    terminalExecutionState
  } execution`, async () => {
    const current = workspaceFixture('current', terminalExecutionState)
    const fresh = workspaceFixture('reassigned', terminalExecutionState)
    let workspaceReads = 0
    const commands: unknown[] = []
    const port = createProjectCoordinatorTaskOfferReassignmentPort({
      workspace: {
        readWorkspace: async ({ projectId: requestedProjectId }) => {
          assert.equal(requestedProjectId, projectId)
          workspaceReads += 1
          return workspaceReads === 1 ? current : fresh
        }
      },
      coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
        resume: async () => null,
        execute: async (command) => {
          commands.push(command)
          const project = fresh.projects[0]!
          return restResponseSchema.parse({
            protocolVersion: '1.0',
            type: 'rest.collection',
            requestId: command.requestId,
            items: [
              project.tasks[0]!.task,
              project.offers.find(({ taskOfferId }) => (
                taskOfferId === successorTaskOfferId
              ))!
            ]
          })
        },
        subscribe: () => () => undefined
      },
      requestId: () => 'req_ReassignOffer001'
    })
    const input = {
      projectId,
      taskId,
      previousTaskOfferId,
      workerUserId: 'usr_ReassignWorker02',
      offerExpiresAt: '2026-08-29T02:05:00.000Z',
      nextOutputFileName: previousOutputFileName
    }
    const currentFileIntent = current.projects[0]!.tasks[0]!.task.fileIntent
    assert.ok(currentFileIntent)

    const result = await port.reassign(input, 'idem_ReassignOffer001')

    assert.deepEqual(result, fresh)
    assert.equal(workspaceReads, 2)
    assert.deepEqual(commands, [{
      protocolVersion: '1.0',
      requestId: 'req_ReassignOffer001',
      type: 'task.offer.reassign',
      idempotencyKey: 'idem_ReassignOffer001',
      taskId,
      previousTaskOfferId,
      expectedPreviousOfferRevision: 2,
      expectedProjectRevision: 4,
      expectedTaskRevision: 3,
      expectedCoordinatorAuthorityEpoch: 3,
      expectedExecutionAuthorityEpoch: 2,
      workerUserId: input.workerUserId,
      offerExpiresAt: input.offerExpiresAt,
      nextFileIntent: currentFileIntent
    }])
  })
}

test('post-read rejects a Task revision racing ahead while its successor offer remains pending', async () => {
  const current = workspaceFixture('current', 'failed')
  const committed = workspaceFixture('reassigned', 'failed')
  const raced = workspaceWithSuccessorState('pending', null)
  const task = raced.projects[0]!.tasks[0]!.task
  raced.projects[0]!.tasks[0] = {
    ...raced.projects[0]!.tasks[0]!,
    task: taskSchema.parse({ ...task, revision: task.revision + 1 })
  }
  const port = reassignmentPortForPostRead(current, raced, committed)

  await assert.rejects(
    port.reassign(reassignmentInput(), 'idem_ReassignPendingRace01'),
    /Fresh Cloud facts did not preserve the exact reassignment transition/u
  )
})

for (const state of ['rejected', 'withdrawn', 'timed_out'] as const) {
  test(`post-read accepts a raced-ahead ${state} successor only with its exact causal Task revision`, async () => {
    const current = workspaceFixture('current', 'failed')
    const committed = workspaceFixture('reassigned', 'failed')
    const causalRevision = committed.projects[0]!.tasks[0]!.task.revision + 1

    assert.deepEqual(
      await reassignmentPortForPostRead(
        current,
        workspaceWithSuccessorState(state, causalRevision),
        committed
      ).reassign(reassignmentInput(), `idem_ReassignCausal-${state}`),
      workspaceWithSuccessorState(state, causalRevision)
    )

    for (const reassignmentTaskRevision of [null, causalRevision + 1]) {
      await assert.rejects(
        reassignmentPortForPostRead(
          current,
          workspaceWithSuccessorState(state, reassignmentTaskRevision),
          committed
        ).reassign(
          reassignmentInput(),
          `idem_ReassignNoncausal-${state}-${reassignmentTaskRevision ?? 'null'}`
        ),
        /Fresh Cloud facts did not preserve the exact reassignment transition/u
      )
    }
  })
}

test('post-read accepts an automatically claimed successor with its exact new execution', async () => {
  const current = workspaceFixture('current', 'failed')
  const committed = workspaceFixture('reassigned', 'failed')
  const accepted = workspaceWithAcceptedSuccessor()

  assert.deepEqual(
    await reassignmentPortForPostRead(current, accepted, committed).reassign(
      reassignmentInput(),
      'idem_ReassignAcceptedRace01'
    ),
    accepted
  )
})

test('post-read rejects an accepted successor without its exact new execution progress', async () => {
  const current = workspaceFixture('current', 'failed')
  const committed = workspaceFixture('reassigned', 'failed')

  for (const drift of [
    'missing_execution',
    'wrong_assignee',
    'stale_execution_count'
  ] as const) {
    await assert.rejects(
      reassignmentPortForPostRead(
        current,
        workspaceWithAcceptedSuccessor(drift),
        committed
      ).reassign(reassignmentInput(), `idem_ReassignAccepted-${drift}`),
      /Fresh Cloud facts did not preserve the exact reassignment transition/u
    )
  }
})

test('Task offer reassignment rejects an output rename before a Cloud command', async () => {
  let commandCalls = 0
  const port = createProjectCoordinatorTaskOfferReassignmentPort({
    workspace: { readWorkspace: async () => workspaceFixture('current', 'failed') },
    coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async () => {
        commandCalls += 1
        throw new Error('renamed reassignment must not reach Cloud')
      },
      subscribe: () => () => undefined
    }
  })

  await assert.rejects(port.reassign({
    projectId,
    taskId,
    previousTaskOfferId,
    workerUserId: 'usr_ReassignWorker02',
    offerExpiresAt: '2026-08-29T02:05:00.000Z',
    nextOutputFileName: successorOutputFileName
  }, 'idem_ReassignOffer002'), /exact accepted output declaration/u)
  assert.equal(commandCalls, 0)
})

test('Task offer reassignment rejects a case-only output rename before a Cloud command', async () => {
  let commandCalls = 0
  const port = createProjectCoordinatorTaskOfferReassignmentPort({
    workspace: { readWorkspace: async () => workspaceFixture('current', 'failed') },
    coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async () => {
        commandCalls += 1
        throw new Error('case-colliding reassignment must not reach Cloud')
      },
      subscribe: () => () => undefined
    }
  })

  await assert.rejects(port.reassign({
    projectId,
    taskId,
    previousTaskOfferId,
    workerUserId: 'usr_ReassignWorker02',
    offerExpiresAt: '2026-08-29T02:05:00.000Z',
    nextOutputFileName: previousOutputFileName.toUpperCase()
  }, 'idem_ReassignOfferCaseCollision01'), /exact accepted output declaration/u)
  assert.equal(commandCalls, 0)
})

test('Task offer reassignment keeps the successor output distinct from its inputs', async () => {
  let commandCalls = 0
  const port = createProjectCoordinatorTaskOfferReassignmentPort({
    workspace: { readWorkspace: async () => workspaceFixture('current', 'failed') },
    coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async () => {
        commandCalls += 1
        throw new Error('input-colliding reassignment must not reach Cloud')
      },
      subscribe: () => () => undefined
    }
  })

  await assert.rejects(port.reassign({
    projectId,
    taskId,
    previousTaskOfferId,
    workerUserId: 'usr_ReassignWorker02',
    offerExpiresAt: '2026-08-29T02:05:00.000Z',
    nextOutputFileName: 'SOURCE-ANALYSIS.MD'
  }, 'idem_ReassignOfferInputCollision01'), /exact accepted output declaration/u)
  assert.equal(commandCalls, 0)
})

test('Task offer replay checks the current OIDC owner before resuming a durable write', async () => {
  const workspace = workspaceFixture('reassigned', 'failed')
  const unauthorized = projectCoordinatorWorkspaceSchema.parse({
    ...workspace,
    connection: {
      ...workspace.connection,
      userId: 'usr_ReassignOther001'
    }
  })
  let resumeCalls = 0
  const port = createProjectCoordinatorTaskOfferReassignmentPort({
    workspace: { readWorkspace: async () => unauthorized },
    coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      execute: async () => { throw new Error('unauthorized replay must not execute') },
      resume: async () => {
        resumeCalls += 1
        throw new Error('unauthorized replay must not resume')
      },
      subscribe: () => () => undefined
    }
  })

  await assert.rejects(
    port.reassign(reassignmentInput(), 'idem_ReassignUnauthorized01'),
    /Only the OIDC owner/u
  )
  assert.equal(resumeCalls, 0)
})

test('Task offer reassignment fails closed for every mismatched reassignment Task revision', async () => {
  let commandCalls = 0
  for (const reassignmentTaskRevision of [2, 4]) {
    const port = createProjectCoordinatorTaskOfferReassignmentPort({
      workspace: {
        readWorkspace: async () => unclaimedWorkspaceFixture(reassignmentTaskRevision)
      },
      coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
        resume: async () => null,
        execute: async () => {
          commandCalls += 1
          throw new Error('revision-mismatched reassignment must not reach Cloud')
        },
        subscribe: () => () => undefined
      }
    })

    await assert.rejects(port.reassign({
      projectId,
      taskId,
      previousTaskOfferId,
      workerUserId: 'usr_ReassignWorker02',
      offerExpiresAt: '2026-08-29T02:05:00.000Z',
      nextOutputFileName: successorOutputFileName
    }, `idem_ReassignMismatch00${reassignmentTaskRevision}`), /current terminal Task offer/u)
  }
  assert.equal(commandCalls, 0)
})

test('Owner manual assignment promotes a worker_missing requirements module through task.offer.create', async () => {
  const requirementsDocumentId = 'rqd_ReassignRequirements01'
  const planItemId = 'item_manual_assign'
  const assignedWorker = 'usr_ReassignWorker04'
  const requirements = projectRequirementsDocumentSchema.parse({
    schemaVersion: 1, revision: 1, createdAt: at, updatedAt: at,
    type: 'project_requirements_document', requirementsDocumentId, projectId,
    documentRevision: 1, state: 'confirmed', goalsDeliverables: 'Deliver one file.',
    inputsBoundaries: 'Use the provided input.', inputReferences: [],
    workModules: [{ planItemId, title: 'Manual assignment', objective: 'Produce the file.', dependencyPlanItemIds: [] }],
    acceptanceCriteria: [{ target: planItemId, criteria: 'The file exists.', evidenceMethod: 'Owner review.' }],
    contentDigest: 'b'.repeat(64), confirmedByUserId: 'usr_ReassignOwner01', confirmedAt: at, supersededAt: null
  })
  const observed = workspaceFixture('current', 'failed')
  const observedProject = observed.projects[0]!
  const manualTaskId = canonicalTaskIdForRequirementsModule(requirementsDocumentId, planItemId)
  const current = projectCoordinatorWorkspaceSchema.parse({
    ...observed,
    projects: [{ ...observedProject, requirementsDraft: null, confirmedRequirements: requirements,
      plan: null, tasks: [], offers: [] }]
  })
  const task = taskSchema.parse({
    schemaVersion: 1, type: 'task', taskId: manualTaskId, projectId,
    createdByCoordinatorAgentId: 'agt_ReassignCoord01', title: 'Manual assignment',
    objective: 'Produce the file.', completionCriteria: ['The file exists.'], dependencyTaskIds: [],
    requiredCapabilityTags: [], fileIntent: null, currentExecutionId: null,
    currentExecutionState: null, status: 'offered', executionCount: 0, maxRetries: 2,
    completedAt: null, revision: 1, createdAt: at, updatedAt: at
  })
  const offer = taskOfferSchema.parse({
    schemaVersion: 1, type: 'task_offer', taskOfferId: 'ofr_ReassignManual01', projectId,
    taskId: manualTaskId, executionId: null, workerUserId: assignedWorker,
    offeredByCoordinatorAgentId: 'agt_ReassignCoord01', state: 'pending',
    reassignmentTaskRevision: null, offeredAt: at, expiresAt: '2026-08-29T02:05:00.000Z',
    respondedAt: null, revision: 1, createdAt: at, updatedAt: at
  })
  const fresh = projectCoordinatorWorkspaceSchema.parse({
    ...current,
    projects: [{ ...current.projects[0]!, project: { ...current.projects[0]!.project, revision: 5 },
      tasks: [{ task, delivery: null, executions: [] }], offers: [offer] }]
  })
  const commands: CoordinatorCloudCommand[] = []
  const port = createProjectCoordinatorTaskOfferReassignmentPort({
    workspace: { readWorkspace: async () => commands.length === 0 ? current : fresh },
    coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async (command) => {
        commands.push(command)
        return restResponseSchema.parse({ protocolVersion: '1.0', type: 'rest.collection', requestId: command.requestId, items: [task, offer] })
      },
      subscribe: () => () => undefined
    },
    requestId: () => 'req_ReassignManual01'
  })
  const result = await port.reassign({
    projectId, taskId: manualTaskId, previousTaskOfferId: null, workerUserId: assignedWorker,
    offerExpiresAt: '2026-08-29T02:05:00.000Z', nextOutputFileName: null,
    requirementsDocumentId, planItemId
  }, 'idem_ReassignManual01')
  assert.equal(commands.length, 1)
  assert.equal(commands[0]!.type, 'task.offer.create')
  assert.deepEqual(result, fresh)
})

function reassignmentInput() {
  return {
    projectId,
    taskId,
    previousTaskOfferId,
    workerUserId: 'usr_ReassignWorker02',
    offerExpiresAt: '2026-08-29T02:05:00.000Z',
    nextOutputFileName: previousOutputFileName
  }
}

function reassignmentPortForPostRead(
  current: ProjectCoordinatorWorkspace,
  fresh: ProjectCoordinatorWorkspace,
  committed: ProjectCoordinatorWorkspace
) {
  let workspaceReads = 0
  return createProjectCoordinatorTaskOfferReassignmentPort({
    workspace: {
      readWorkspace: async () => {
        workspaceReads += 1
        return workspaceReads === 1 ? current : fresh
      }
    },
    coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async (command) => {
        const project = committed.projects[0]!
        return restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.collection',
          requestId: command.requestId,
          items: [
            project.tasks[0]!.task,
            project.offers.find(({ taskOfferId }) => (
              taskOfferId === successorTaskOfferId
            ))!
          ]
        })
      },
      subscribe: () => () => undefined
    }
  })
}

function workspaceWithSuccessorState(
  state: 'pending' | 'rejected' | 'withdrawn' | 'timed_out',
  reassignmentTaskRevision: number | null
): ProjectCoordinatorWorkspace {
  const workspace = workspaceFixture('reassigned', 'failed')
  const project = workspace.projects[0]!
  const taskView = project.tasks[0]!
  const successor = project.offers.find(({ taskOfferId }) => (
    taskOfferId === successorTaskOfferId
  ))!
  const pending = state === 'pending'
  const task = pending
    ? taskView.task
    : taskSchema.parse({
        ...taskView.task,
        status: 'revision_requested',
        revision: taskView.task.revision + 1
      })
  const offer = taskOfferSchema.parse({
    ...successor,
    state,
    reassignmentTaskRevision,
    respondedAt: pending ? null : at,
    revision: pending ? successor.revision : successor.revision + 1
  })
  return projectCoordinatorWorkspaceSchema.parse({
    ...workspace,
    projects: [{
      ...project,
      tasks: [{ ...taskView, task }],
      offers: project.offers.map((candidate) => (
        candidate.taskOfferId === successorTaskOfferId ? offer : candidate
      ))
    }]
  })
}

function workspaceWithAcceptedSuccessor(
  drift: 'none' | 'missing_execution' | 'wrong_assignee' | 'stale_execution_count' = 'none'
): ProjectCoordinatorWorkspace {
  const workspace = workspaceFixture('reassigned', 'failed')
  const project = workspace.projects[0]!
  const taskView = project.tasks[0]!
  const successor = project.offers.find(({ taskOfferId }) => (
    taskOfferId === successorTaskOfferId
  ))!
  const previousExecution = taskView.executions[0]!
  const assignmentTaskRevision = taskView.task.revision + 1
  const assigneeUserId = drift === 'wrong_assignee'
    ? 'usr_ReassignWorker03'
    : 'usr_ReassignWorker02'
  const assigneeAgentId = 'agt_ReassignWorker02'
  const assigneeDeviceId = 'dev_ReassignWorker02'
  const execution = taskExecutionSchema.parse({
    ...previousExecution,
    executionId: successorExecutionId,
    attempt: taskView.task.executionCount + 1,
    assigneeUserId,
    assigneeAgentId,
    assigneeDeviceId,
    state: 'accepted',
    stateRevision: 1,
    fence: {
      ...previousExecution.fence,
      executionId: successorExecutionId,
      assigneeUserId,
      assigneeAgentId,
      assigneeDeviceId,
      assignmentTaskRevision,
      status: 'open',
      reason: null,
      fencedAt: null
    },
    fileIntent: previousExecution.fileIntent && {
      ...previousExecution.fileIntent,
      executionId: successorExecutionId,
      assignmentTaskRevision
    },
    currentResultSubmissionId: null,
    acceptedAt: at,
    startedAt: null,
    terminalAt: null,
    revision: 1
  })
  const task = taskSchema.parse({
    ...taskView.task,
    currentExecutionId: drift === 'missing_execution' ? executionId : successorExecutionId,
    currentExecutionState: drift === 'missing_execution' ? 'failed' : 'accepted',
    status: drift === 'missing_execution' ? 'revision_requested' : 'in_progress',
    executionCount: drift === 'stale_execution_count'
      ? taskView.task.executionCount
      : taskView.task.executionCount + 1,
    revision: assignmentTaskRevision
  })
  const offer = taskOfferSchema.parse({
    ...successor,
    executionId: successorExecutionId,
    state: 'accepted',
    respondedAt: at,
    revision: successor.revision + 1
  })
  return projectCoordinatorWorkspaceSchema.parse({
    ...workspace,
    projects: [{
      ...project,
      tasks: [{
        ...taskView,
        task,
        executions: drift === 'missing_execution'
          ? taskView.executions
          : [...taskView.executions, execution]
      }],
      offers: project.offers.map((candidate) => (
        candidate.taskOfferId === successorTaskOfferId ? offer : candidate
      ))
    }]
  })
}

function workerGroup(userId: string, tags: readonly string[]) {
  const agentId = `agt_${userId.slice(4)}`
  const deviceId = `dev_${userId.slice(4)}`
  return {
    userId,
    displayName: `Worker ${userId}`,
    agents: [{
      displayName: `Agent ${userId}`,
      projectAvailability: {
        schemaVersion: 1 as const,
        type: 'project_worker_availability_view' as const,
        projectId,
        userId,
        agentId,
        revision: 1,
        membership: {
          schemaVersion: 1 as const, type: 'project_membership' as const,
          projectMembershipId: `pmb_${userId.slice(4)}`, projectId, userId,
          state: 'active' as const, authorityEpoch: 1, activatedAt: at,
          removalRequestedAt: null, removalRequestedByUserId: null, removedAt: null,
          revision: 1, createdAt: at, updatedAt: at
        },
        availability: {
          schemaVersion: 1 as const, type: 'worker_availability_projection' as const,
          revision: 1, createdAt: at, updatedAt: at, userId, agentId, deviceId,
          agentActive: true, deviceActive: true, connectionStatus: 'online' as const,
          lastHeartbeatAt: at, runtimeReadiness: 'ready' as const,
          runtimeCapabilityTags: [...tags], acceptsNewOffers: true,
          activeTaskCount: 0, observedAt: at, expiresAt: '2026-08-29T02:30:00.000Z'
        },
        taskAuthorities: [],
        observedAt: at
      }
    }]
  }
}

function requirementsWorkspace(workerTags: readonly string[]): ProjectCoordinatorWorkspace {
  const requirementsDocumentId = 'rqd_ReassignRequirements1'
  const document = projectRequirementsDocumentSchema.parse({
    schemaVersion: 1, revision: 1, createdAt: at, updatedAt: at,
    type: 'project_requirements_document', requirementsDocumentId, projectId,
    documentRevision: 1, state: 'confirmed',
    goalsDeliverables: 'Deliver the corrected analysis.',
    inputsBoundaries: 'Use only the exact shared input.',
    inputReferences: [],
    workModules: [{
      planItemId: 'item_analysis', title: 'Revise the analysis',
      objective: 'Produce one corrected file result from the concrete input.',
      dependencyPlanItemIds: [], requiredCapabilityTags: ['analysis', 'content.write']
    }],
    acceptanceCriteria: [
      { target: 'item_analysis', criteria: 'The corrected output file is reviewable.', evidenceMethod: 'Owner review.' },
      { target: '$project', criteria: 'Every module is accepted.', evidenceMethod: 'Owner review.' }
    ],
    contentDigest: 'c'.repeat(64), confirmedByUserId: 'usr_ReassignOwner01',
    confirmedAt: at, supersededAt: null
  })
  return projectCoordinatorWorkspaceSchema.parse({
    connection: { state: 'ready', userId: 'usr_ReassignOwner01', deviceId: 'dev_ReassignOwner01' },
    observedAt: at, focusedProjectId: projectId, availableWorkerUsers: [],
    projects: [{
      project: {
        schemaVersion: 1, type: 'project', projectId, ownerUserId: 'usr_ReassignOwner01',
        displayName: 'Reassignment Project', goal: 'Reassign one exact Task.',
        coordinatorAgentId: 'agt_ReassignCoord01', coordinatorAuthorityEpoch: 3,
        executionAuthorityEpoch: 2, status: 'active',
        budget: { maxTasks: 8, maxTasksPerRound: 2, maxTaskRetries: 2, maxCoordinationRounds: 4 },
        revision: 4, createdAt: at, updatedAt: at
      },
      coordinatorTransferFeedback: null, plan: null,
      requirementsDraft: null, confirmedRequirements: document,
      memberUsers: [],
      workerGroups: [workerGroup('usr_ReassignWorker02', workerTags)],
      tasks: [], offers: [], pendingHumanNeeded: [], records: [], finalSummary: null,
      memberships: [], legacyHistory: { readOnly: true, plans: [], tasks: [], executions: [] },
      deliveryDrive: null
    }]
  })
}

function workspaceFixture(
  phase: 'current' | 'reassigned',
  terminalExecutionState: 'failed' | 'cancelled'
): ProjectCoordinatorWorkspace {
  const current = phase === 'current'
  const outputFileName = previousOutputFileName
  const taskFileIntent = {
    schemaVersion: 1 as const,
    inputs: [{
      kind: 'collaboration.object-input' as const,
      locator: cloudInputLocator(projectId),
      destinationName: 'source-analysis.md',
    }],
    output: {
      kind: 'delivery.output' as const,
      fileName: outputFileName,
      mediaType: 'text/markdown',
      maxBytes: 65_536
    }
  }
  const task = taskSchema.parse({
    schemaVersion: 1,
    type: 'task',
    taskId,
    projectId,
    createdByCoordinatorAgentId: 'agt_ReassignCoord01',
    title: 'Revise the analysis',
    objective: 'Produce one corrected file result from the concrete input.',
    completionCriteria: ['The corrected output file is reviewable.'],
    dependencyTaskIds: [],
    requiredCapabilityTags: ['analysis', 'content.write'],
    fileIntent: taskFileIntent,
    currentExecutionId: current ? executionId : null,
    currentExecutionState: current ? terminalExecutionState : null,
    status: current ? 'revision_requested' : 'offered',
    executionCount: 1,
    maxRetries: 2,
    completedAt: null,
    revision: current ? 3 : 4,
    createdAt: at,
    updatedAt: at
  })
  const previousExecution = taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId,
    taskId,
    executionId,
    attempt: 1,
    offeredByCoordinatorAgentId: 'agt_ReassignCoord01',
    assigneeUserId: 'usr_ReassignWorker01',
    assigneeAgentId: 'agt_ReassignWorker01',
    assigneeDeviceId: 'dev_ReassignWorker01',
    state: terminalExecutionState,
    stateRevision: 4,
    fence: {
      schemaVersion: 1,
      executionId,
      assigneeUserId: 'usr_ReassignWorker01',
      assigneeAgentId: 'agt_ReassignWorker01',
      assigneeDeviceId: 'dev_ReassignWorker01',
      assignmentTaskRevision: 2,
      projectExecutionAuthorityEpoch: 2,
      userTaskAuthorityEpoch: 1,
      status: 'fenced',
      reason: terminalExecutionState === 'failed'
        ? 'execution_failed'
        : 'execution_cancelled',
      fencedAt: at
    },
    fileIntent: {
      schemaVersion: 1,
      type: 'task_execution_file_intent',
      projectId,
      taskId,
      executionId,
      assignmentTaskRevision: 2,
      declarationDigest: 'a'.repeat(64),
      inputs: [{
        resourceRefId: 'rrf_ReassignInput01',
        destinationName: 'source-analysis.md'
      }],
      output: {
      kind: 'delivery.output',
        fileName: previousOutputFileName,
        mediaType: 'text/markdown',
        maxBytes: 65_536
      }
    },
    currentResultSubmissionId: null,
    offeredAt: at,
    acceptedAt: at,
    startedAt: at,
    terminalAt: at,
    revision: 5,
    createdAt: at,
    updatedAt: at
  })
  const previousOffer = taskOfferSchema.parse({
    schemaVersion: 1,
    type: 'task_offer',
    taskOfferId: previousTaskOfferId,
    projectId,
    taskId,
    executionId,
    workerUserId: 'usr_ReassignWorker01',
    offeredByCoordinatorAgentId: 'agt_ReassignCoord01',
    state: 'accepted',
    reassignmentTaskRevision: null,
    offeredAt: at,
    expiresAt: '2026-08-29T02:03:00.000Z',
    respondedAt: at,
    revision: 2,
    createdAt: at,
    updatedAt: at
  })
  const successorOffer = taskOfferSchema.parse({
    schemaVersion: 1,
    type: 'task_offer',
    taskOfferId: successorTaskOfferId,
    projectId,
    taskId,
    executionId: null,
    workerUserId: 'usr_ReassignWorker02',
    offeredByCoordinatorAgentId: 'agt_ReassignCoord01',
    state: 'pending',
    reassignmentTaskRevision: null,
    offeredAt: at,
    expiresAt: '2026-08-29T02:05:00.000Z',
    respondedAt: null,
    revision: 1,
    createdAt: at,
    updatedAt: at
  })
  return projectCoordinatorWorkspaceSchema.parse({
    connection: {
      state: 'ready',
      userId: 'usr_ReassignOwner01',
      deviceId: 'dev_ReassignOwner01'
    },
    observedAt: at,
    focusedProjectId: projectId,
    availableWorkerUsers: [],
    projects: [{
      project: {
        schemaVersion: 1,
        type: 'project',
        projectId,
        ownerUserId: 'usr_ReassignOwner01',
        displayName: 'Reassignment Project',
        goal: 'Reassign one exact revision-requested Task.',
        coordinatorAgentId: 'agt_ReassignCoord01',
        coordinatorAuthorityEpoch: 3,
        executionAuthorityEpoch: 2,
        status: 'active',
        budget: {
          maxTasks: 8,
          maxTasksPerRound: 2,
          maxTaskRetries: 2,
          maxCoordinationRounds: 4
        },
        revision: 4,
        createdAt: at,
        updatedAt: at
      },
      coordinatorTransferFeedback: null,
      plan: null,
      memberUsers: [],
      workerGroups: [
        workerGroup('usr_ReassignWorker01', ['analysis', 'content.write']),
        workerGroup('usr_ReassignWorker02', ['analysis', 'content.write']),
        workerGroup('usr_ReassignWorker03', ['agent-runtime.codex'])
      ],
      tasks: [{ delivery: null, task, executions: [previousExecution] }],
      offers: current
        ? [previousOffer]
        : [previousOffer, successorOffer],
      pendingHumanNeeded: [],
      records: [],
      finalSummary: null,
      memberships: [],
      legacyHistory: { readOnly: true as const, plans: [], tasks: [], executions: [] },
      deliveryDrive: null
    }]
  })
}

function textWorkspaceFixture(
  phase: 'current' | 'reassigned'
): ProjectCoordinatorWorkspace {
  const workspace = workspaceFixture(phase, 'failed')
  const project = workspace.projects[0]!
  const taskView = project.tasks[0]!
  return projectCoordinatorWorkspaceSchema.parse({
    ...workspace,
    projects: [{
      ...project,
      tasks: [{
        ...taskView,
        task: taskSchema.parse({ ...taskView.task, fileIntent: null }),
        executions: taskView.executions.map((execution) => taskExecutionSchema.parse({
          ...execution,
          fence: { ...execution.fence, },
          fileIntent: null
        }))
      }]
    }]
  })
}

function unclaimedWorkspaceFixture(
  reassignmentTaskRevision: number
): ProjectCoordinatorWorkspace {
  const workspace = workspaceFixture('current', 'failed')
  const project = workspace.projects[0]!
  const taskView = project.tasks[0]!
  const task = taskSchema.parse({
    ...taskView.task,
    currentExecutionId: null,
    currentExecutionState: null
  })
  const previousOffer = taskOfferSchema.parse({
    ...project.offers[0]!,
    executionId: null,
    state: 'rejected',
    reassignmentTaskRevision
  })
  return projectCoordinatorWorkspaceSchema.parse({
    ...workspace,
    projects: [{
      ...project,
      tasks: [{ delivery: null, task, executions: [] }],
      offers: [previousOffer]
    }]
  })
}

test('a first requirements assignment refuses a Worker without the exact executable tags', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const coordinatorCloudCommands: CoordinatorCloudCommandService = {
    executeUser: async () => { throw new Error('Unexpected User command.') },
    resumeUser: async () => null,
    localAgentId: () => undefined,
    execute: async (command) => { commands.push(command); throw new Error('Must not reach Cloud.') },
    resume: async () => null,
    subscribe: () => () => undefined
  }
  const requirementsDocumentId = 'rqd_ReassignRequirements1'
  const port = createProjectCoordinatorTaskOfferReassignmentPort({
    workspace: { readWorkspace: async () => requirementsWorkspace(['agent-runtime.codex']) },
    coordinatorCloudCommands
  })

  await assert.rejects(
    () => port.reassign({
      projectId,
      taskId: canonicalTaskIdForRequirementsModule(requirementsDocumentId, 'item_analysis'),
      previousTaskOfferId: null,
      workerUserId: 'usr_ReassignWorker02',
      offerExpiresAt: '2026-08-29T02:05:00.000Z',
      nextOutputFileName: null,
      requirementsDocumentId,
      planItemId: 'item_analysis'
    }, 'idem_ReassignFirstCapability01'),
    /does not provide every executable capability tag/u
  )
  assert.equal(commands.length, 0)
})

test('a successor reassignment refuses a Worker without the exact executable tags', async () => {
  const commands: CoordinatorCloudCommand[] = []
  const coordinatorCloudCommands: CoordinatorCloudCommandService = {
    executeUser: async () => { throw new Error('Unexpected User command.') },
    resumeUser: async () => null,
    localAgentId: () => undefined,
    execute: async (command) => { commands.push(command); throw new Error('Must not reach Cloud.') },
    resume: async () => null,
    subscribe: () => () => undefined
  }
  const port = createProjectCoordinatorTaskOfferReassignmentPort({
    workspace: { readWorkspace: async () => workspaceFixture('current', 'failed') },
    coordinatorCloudCommands
  })

  await assert.rejects(
    () => port.reassign({
      ...reassignmentInput(),
      workerUserId: 'usr_ReassignWorker03'
    }, 'idem_ReassignSuccessorCapability01'),
    /does not provide every executable capability tag/u
  )
  assert.equal(commands.length, 0)
})
