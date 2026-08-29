import assert from 'node:assert/strict'
import test from 'node:test'
import {
  restResponseSchema,
  taskExecutionSchema,
  taskOfferSchema,
  taskSchema
} from '@sciforge/collaboration-contracts'
import type {
  CoordinatorCloudCommand,
  CoordinatorCloudCommandReplay,
  CoordinatorCloudCommandService
} from '@sciforge/domain-collaboration/coordinator-cloud-command'

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
    nextOutputFileName: successorOutputFileName
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
      nextOutputFileName: successorOutputFileName
    }
    const currentFileIntent = current.projects[0]!.tasks[0]!.task.fileIntent
    assert.ok(currentFileIntent)
    const nextFileIntent = {
      ...currentFileIntent,
      output: {
        ...currentFileIntent.output,
        fileName: successorOutputFileName
      }
    }

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
      nextFileIntent
    }])
    assert.deepEqual(nextFileIntent.inputs, currentFileIntent.inputs)
    assert.equal(nextFileIntent.bindingRevision, currentFileIntent.bindingRevision)
    assert.deepEqual({
      ...nextFileIntent,
      output: {
        ...nextFileIntent.output,
        fileName: previousOutputFileName
      }
    }, currentFileIntent)
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

test('Task offer reassignment requires a new output name before a Cloud command', async () => {
  let commandCalls = 0
  const port = createProjectCoordinatorTaskOfferReassignmentPort({
    workspace: { readWorkspace: async () => workspaceFixture('current', 'failed') },
    coordinatorCloudCommands: {
      resume: async () => null,
      execute: async () => {
        commandCalls += 1
        throw new Error('invalid reassignment must not reach Cloud')
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
    nextOutputFileName: previousOutputFileName
  }, 'idem_ReassignOffer002'), /new no-overwrite output filename/u)
  assert.equal(commandCalls, 0)
})

test('Task offer reassignment rejects a case-only output rename before a Cloud command', async () => {
  let commandCalls = 0
  const port = createProjectCoordinatorTaskOfferReassignmentPort({
    workspace: { readWorkspace: async () => workspaceFixture('current', 'failed') },
    coordinatorCloudCommands: {
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
  }, 'idem_ReassignOfferCaseCollision01'), /new no-overwrite output filename/u)
  assert.equal(commandCalls, 0)
})

test('Task offer reassignment keeps the successor output distinct from its inputs', async () => {
  let commandCalls = 0
  const port = createProjectCoordinatorTaskOfferReassignmentPort({
    workspace: { readWorkspace: async () => workspaceFixture('current', 'failed') },
    coordinatorCloudCommands: {
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
  }, 'idem_ReassignOfferInputCollision01'), /distinct from every input destination/u)
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

function reassignmentInput() {
  return {
    projectId,
    taskId,
    previousTaskOfferId,
    workerUserId: 'usr_ReassignWorker02',
    offerExpiresAt: '2026-08-29T02:05:00.000Z',
    nextOutputFileName: successorOutputFileName
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
      assignmentTaskRevision,
      output: {
        ...previousExecution.fileIntent.output,
        fileName: successorOutputFileName
      }
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

function workspaceFixture(
  phase: 'current' | 'reassigned',
  terminalExecutionState: 'failed' | 'cancelled'
): ProjectCoordinatorWorkspace {
  const current = phase === 'current'
  const outputFileName = current ? previousOutputFileName : successorOutputFileName
  const taskFileIntent = {
    schemaVersion: 1 as const,
    bindingRevision: 3,
    inputs: [{
      kind: 'content-space.input-file' as const,
      locator: {
        contractVersion: 1 as const,
        kind: 'content-space.file-reference' as const,
        authority: 'opencontent.run0',
        identity: { fileId: 'provider-input-analysis-001' }
      },
      destinationName: 'source-analysis.md',
      expectedSemanticRevision: 'provider-semantic-revision-7',
      expectedMediaType: 'text/markdown'
    }],
    output: {
      kind: 'content-space.output-new' as const,
      target: 'project-binding-root' as const,
      mode: 'upload-new' as const,
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
      bindingRevision: 3,
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
      bindingRevision: 3,
      declarationDigest: 'a'.repeat(64),
      inputs: [{
        resourceRefId: 'rrf_ReassignInput01',
        destinationName: 'source-analysis.md'
      }],
      output: {
        rootResourceRefId: 'rrf_ReassignRoot001',
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
    providerPrincipalFacts: [],
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
        contentMode: 'required',
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
      workerGroups: [],
      tasks: [{ task, executions: [previousExecution] }],
      offers: current
        ? [previousOffer]
        : [previousOffer, successorOffer],
      reviews: [],
      pendingHumanNeeded: [],
      records: [],
      finalSummary: null,
      provisioning: {
        intent: null,
        attestation: null,
        binding: {
          schemaVersion: 1,
          type: 'project_content_space_binding',
          projectContentBindingId: 'pcb_ReassignBinding01',
          projectId,
          contentOwnerUserId: 'usr_ReassignOwner01',
          providerInstance: {
            schemaVersion: 1,
            type: 'provider_instance_reference',
            providerInstanceRef: 'opencontent.run0'
          },
          rootLocator: {
            contractVersion: 1,
            kind: 'content-space.container-reference',
            authority: 'opencontent.run0',
            identity: { containerId: 'provider-project-root-001' }
          },
          rootLocatorDigest: 'b'.repeat(64),
          provisioningIntentId: 'pci_ReassignIntent001',
          provisioningRevision: 2,
          attestationId: 'pca_ReassignAttest01',
          attestationDigest: 'c'.repeat(64),
          status: 'active',
          statusReason: null,
          activatedAt: at,
          degradedAt: null,
          closedAt: null,
          revision: 3,
          createdAt: at,
          updatedAt: at
        },
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
          fence: { ...execution.fence, bindingRevision: null },
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
      tasks: [{ task, executions: [] }],
      offers: [previousOffer]
    }]
  })
}
