import {
  agentInboxMessageSchema,
  createCollaborationError,
  projectRecordSchema,
  taskDeliveryFactsSchema,
  taskExecutionSchema,
  taskHistorySchema,
  taskOfferSchema,
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
  operationReceiptFixture,
  projectFixture,
  taskFixture
} from '@sciforge/collaboration-contracts/testing'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { CoordinatorCloudCommandService } from '../coordinator-cloud-command.js'

import { historicalPlanFixture, publishedResultDrive } from './cloud-test-fixtures.js'
import {
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorProject
} from './contract.js'
import {
  createProjectCoordinatorActionPort,
  defineProjectCoordinatorWorkspacePort
} from './ports.js'
import { ProjectCoordinatorStateStore } from './state.js'

test('Owner delete derives Cloud CAS once and replays the same durable command after an absent Project', async () => {
  const current = workspaceFixture()
  const absent = projectCoordinatorWorkspaceSchema.parse({
    connection: current.connection,
    observedAt: TEST_LATER_TIMESTAMP,
    availableWorkerUsers: [],
    projects: []
  })
  const workspaceReads: unknown[] = []
  const commands: RestRequest[] = []
  let cloudAttempt = 0
  let authorizationCalls = 0
  const initialIdempotencyKey = 'idem_ProjectDeleteReplay01'
  const retryIdempotencyKey = 'idem_ProjectDeleteRetry002'
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async (input) => {
        workspaceReads.push(input)
        return workspaceReads.length === 1 ? current : absent
      }
    }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: {
      stageObject: async () => { throw new Error('Unexpected object staging.') },
      readObject: async () => { throw new Error('Unexpected object read.') },
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.run0.invalid/',
        userId: projectFixture.ownerUserId,
        deviceId: TEST_IDS.deviceId,
        deviceRevision: 1
      }),
      execute: async ({ payload }) => {
        const command = payload as RestRequest
        commands.push(command)
        cloudAttempt += 1
        if (cloudAttempt === 1) throw new Error('Delete response was lost after Cloud commit.')
        return {
          contractVersion: 1,
          status: 200,
          body: {
            protocolVersion: '1.0',
            type: 'rest.receipt',
            requestId: command.requestId,
            receipt: {
              ...operationReceiptFixture,
              actor: {
                actorType: 'user',
                userId: projectFixture.ownerUserId,
                assurance: 'strong'
              },
              idempotencyKey: initialIdempotencyKey,
              status: 'succeeded'
            }
          }
        }
      }
    },
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => undefined },
    requestId: (() => {
      let ordinal = 0
      return () => `req_ProjectDelete${String(++ordinal).padStart(4, '0')}`
    })()
  })

  await assert.rejects(
    port.deleteProject(
      { projectId: TEST_IDS.projectId },
      initialIdempotencyKey,
      async () => { authorizationCalls += 1 }
    ),
    /response was lost/u
  )
  assert.deepEqual(await port.deleteProject(
    { projectId: TEST_IDS.projectId },
    retryIdempotencyKey,
    async () => { authorizationCalls += 1 }
  ), {
    projectId: TEST_IDS.projectId,
    deleted: true
  })

  assert.equal(commands.length, 2)
  assert.deepEqual(commands.map((command) => command.type === 'project.delete' ? {
    type: command.type,
    idempotencyKey: command.idempotencyKey,
    projectId: command.projectId,
    expectedRevision: command.expectedRevision,
    expectedCoordinatorAuthorityEpoch: command.expectedCoordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: command.expectedExecutionAuthorityEpoch
  } : null), [{
    type: 'project.delete',
    idempotencyKey: initialIdempotencyKey,
    projectId: projectFixture.projectId,
    expectedRevision: projectFixture.revision,
    expectedCoordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: projectFixture.executionAuthorityEpoch
  }, {
    type: 'project.delete',
    idempotencyKey: initialIdempotencyKey,
    projectId: projectFixture.projectId,
    expectedRevision: projectFixture.revision,
    expectedCoordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: projectFixture.executionAuthorityEpoch
  }])
  assert.equal(authorizationCalls, 1)
  assert.deepEqual(workspaceReads, [{ projectId: TEST_IDS.projectId }])
})

test('Project delete does not infer Owner success from not_found on its first attempt', async () => {
  const idempotencyKey = 'idem_ProjectDeleteFirst404'
  const state = coordinatorState()
  let authorizationCalls = 0
  let cloudCalls = 0
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspaceFixture()
    }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: {
      stageObject: async () => { throw new Error('Unexpected object staging.') },
      readObject: async () => { throw new Error('Unexpected object read.') },
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.run0.invalid/',
        userId: projectFixture.ownerUserId,
        deviceId: TEST_IDS.deviceId,
        deviceRevision: 1
      }),
      execute: async ({ payload }) => {
        cloudCalls += 1
        return {
          contractVersion: 1,
          status: 404,
          body: {
            protocolVersion: '1.0',
            type: 'rest.error',
            requestId: payload.requestId,
            error: createCollaborationError(
              'not_found',
              'The Project does not exist.',
              { requestId: payload.requestId }
            )
          }
        }
      }
    },
    state,
    requirementsDispatch: { reconcileProject: async () => undefined }
  })

  await assert.rejects(
    port.deleteProject(
      { projectId: TEST_IDS.projectId },
      idempotencyKey,
      async () => { authorizationCalls += 1 }
    ),
    /not_found/u
  )

  assert.equal(cloudCalls, 1)
  assert.equal(authorizationCalls, 1)
  assert.equal(await state.readProjectDeleteIntent(
    projectFixture.ownerUserId,
    TEST_IDS.projectId,
    idempotencyKey
  ), null)
})

test('Project delete converges with a new invocation after its local completion write fails', async () => {
  const initialIdempotencyKey = 'idem_ProjectDeleteCommit01'
  const retryIdempotencyKey = 'idem_ProjectDeleteCommit02'
  const commands: RestRequest[] = []
  let authorizationCalls = 0
  let workspaceReads = 0
  const state = coordinatorStateWithWriteFailures(new Set([2, 3, 4]))
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => {
        workspaceReads += 1
        return workspaceFixture()
      }
    }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: {
      stageObject: async () => { throw new Error('Unexpected object staging.') },
      readObject: async () => { throw new Error('Unexpected object read.') },
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.run0.invalid/',
        userId: projectFixture.ownerUserId,
        deviceId: TEST_IDS.deviceId,
        deviceRevision: 1
      }),
      execute: async ({ payload }) => {
        const command = payload as RestRequest
        commands.push(command)
        return {
          contractVersion: 1,
          status: 200,
          body: {
            protocolVersion: '1.0',
            type: 'rest.receipt',
            requestId: command.requestId,
            receipt: {
              ...operationReceiptFixture,
              actor: {
                actorType: 'user',
                userId: projectFixture.ownerUserId,
                assurance: 'strong'
              },
              idempotencyKey: initialIdempotencyKey,
              status: 'succeeded'
            }
          }
        }
      }
    },
    state,
    requirementsDispatch: { reconcileProject: async () => undefined }
  })

  await assert.rejects(
    port.deleteProject(
      { projectId: TEST_IDS.projectId },
      initialIdempotencyKey,
      async () => { authorizationCalls += 1 }
    ),
    /Injected Project delete completion write failure/u
  )
  assert.deepEqual(await port.deleteProject(
    { projectId: TEST_IDS.projectId },
    retryIdempotencyKey,
    async () => { authorizationCalls += 1 }
  ), {
    projectId: TEST_IDS.projectId,
    deleted: true
  })

  assert.equal(workspaceReads, 1)
  assert.equal(authorizationCalls, 1)
  assert.deepEqual(commands.map((command) => (
    command.type === 'project.delete' ? command.idempotencyKey : null
  )), [initialIdempotencyKey, initialIdempotencyKey])
})

test('Project delete rejects a non-Owner and a mismatched receipt before local success', async () => {
  const ownerWorkspace = workspaceFixture()
  const memberWorkspace = projectCoordinatorWorkspaceSchema.parse({
    ...ownerWorkspace,
    connection: {
      state: 'ready',
      userId: TEST_IDS.secondUserId,
      deviceId: 'dev_ProjectMember01'
    }
  })
  let nonOwnerCloudCalls = 0
  const nonOwner = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => memberWorkspace }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: {
      stageObject: async () => { throw new Error('Unexpected object staging.') },
      readObject: async () => { throw new Error('Unexpected object read.') },
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.run0.invalid/',
        userId: TEST_IDS.secondUserId,
        deviceId: 'dev_ProjectMember01',
        deviceRevision: 1
      }),
      execute: async () => {
        nonOwnerCloudCalls += 1
        throw new Error('must not execute')
      }
    },
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => undefined },
  })
  await assert.rejects(
    nonOwner.deleteProject(
      { projectId: TEST_IDS.projectId },
      'idem_ProjectDeleteMember01',
      async () => undefined
    ),
    /Only the current Project Owner may delete/u
  )
  assert.equal(nonOwnerCloudCalls, 0)

  const wrongReceipt = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => ownerWorkspace }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: {
      stageObject: async () => { throw new Error('Unexpected object staging.') },
      readObject: async () => { throw new Error('Unexpected object read.') },
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.run0.invalid/',
        userId: projectFixture.ownerUserId,
        deviceId: TEST_IDS.deviceId,
        deviceRevision: 1
      }),
      execute: async ({ payload }) => ({
        contractVersion: 1,
        status: 200,
        body: {
          protocolVersion: '1.0',
          type: 'rest.receipt',
          requestId: payload.requestId,
          receipt: {
            ...operationReceiptFixture,
            idempotencyKey: 'idem_DifferentDeleteReceipt01',
            status: 'succeeded'
          }
        }
      })
    },
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => undefined },
  })
  await assert.rejects(
    wrongReceipt.deleteProject(
      { projectId: TEST_IDS.projectId },
      'idem_ProjectDeleteExpected01',
      async () => undefined
    ),
    /Project delete/u
  )
})

test('Project delete abandons its pending intent after a definitive 4xx rejection', async () => {
  const state = coordinatorState()
  const idempotencyKey = 'idem_ProjectDeleteRejected01'
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspaceFixture()
    }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: {
      stageObject: async () => { throw new Error('Unexpected object staging.') },
      readObject: async () => { throw new Error('Unexpected object read.') },
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.run0.invalid/',
        userId: projectFixture.ownerUserId,
        deviceId: TEST_IDS.deviceId,
        deviceRevision: 1
      }),
      execute: async ({ payload }) => ({
        contractVersion: 1,
        status: 400,
        body: {
          protocolVersion: '1.0',
          type: 'rest.error',
          requestId: payload.requestId,
          error: createCollaborationError(
            'validation_error',
            'The delete command was rejected definitively.',
            { requestId: payload.requestId }
          )
        }
      })
    },
    state,
    requirementsDispatch: { reconcileProject: async () => undefined }
  })

  await assert.rejects(
    port.deleteProject(
      { projectId: TEST_IDS.projectId },
      idempotencyKey,
      async () => undefined
    ),
    /validation_error/u
  )
  assert.equal(await state.readProjectDeleteIntent(
    projectFixture.ownerUserId,
    TEST_IDS.projectId,
    idempotencyKey
  ), null)
})

test('project.deleted Inbox cleanup is local, idempotent, and never rereads deleted Cloud facts', async () => {
  let workspaceReads = 0
  let continuationCalls = 0
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => {
        workspaceReads += 1
        throw new Error('Deleted Project facts must not be reread.')
      }
    }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => undefined },
  })
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    payload: {
      protocolVersion: '1.0',
      type: 'project.deleted',
      projectId: TEST_IDS.projectId,
      deletedAt: TEST_LATER_TIMESTAMP
    }
  })

  await port.handleInbox(message)
  await port.handleInbox(message)

  assert.equal(workspaceReads, 0)
  assert.equal(continuationCalls, 0)
})

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
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async () => { throw new Error('Project start consumption must not write to Cloud.') },
      subscribe: () => () => undefined
    },
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => undefined },
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

  await handling

  assert.equal(reads, 1)
  assert.equal(continuations, 0)
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
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async () => { throw new Error('An observation wake must not write before reconcile.') },
      subscribe: () => () => undefined
    },
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => undefined },
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

  assert.equal(continuations, 0)
})

test('sealed and adopted Delivery notifications consume exact fresh facts and only adoption reconciles', async () => {
  const drive = publishedResultDrive(TEST_IDS.projectId, TEST_IDS.taskId, TEST_IDS.executionId, 'InboxDelivery01')
  const manifest = drive.taskDeliveries[0]!
  const receipt = {
    schemaVersion: 1 as const,
    revision: 1,
    type: 'integration_receipt' as const,
    integrationReceiptId: 'irc_InboxDelivery0001',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    deliveryManifestId: manifest.deliveryManifestId,
    integrationRevision: 1,
    validationEvidence: ['Owner verified the exact sealed Delivery.'],
    operationId: 'adopt-InboxDelivery01',
    disposition: 'adopted' as const,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  }
  const sealedTask = taskSchema.parse({
    ...taskFixture,
    status: 'revision_requested',
    revision: 2,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const adoptedTask = taskSchema.parse({
    ...taskFixture,
    currentExecutionId: TEST_IDS.executionId,
    currentExecutionState: 'completed',
    status: 'completed',
    executionCount: 1,
    completedAt: TEST_LATER_TIMESTAMP,
    revision: 3,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const sealedFacts = taskDeliveryFactsSchema.parse({
    taskId: TEST_IDS.taskId,
    candidate: null,
    manifest,
    receipt: null,
    result: null,
    revisionRequest: null
  })
  const adoptedFacts = taskDeliveryFactsSchema.parse({
    taskId: TEST_IDS.taskId,
    candidate: null,
    manifest,
    receipt,
    result: drive.projectResults[0],
    revisionRequest: null
  })
  let currentWorkspace = workspaceFixture(projectFixture, {
    tasks: [{ delivery: sealedFacts, task: sealedTask, executions: [] }]
  })
  let reconciles = 0
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => currentWorkspace
    }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => undefined },
  })
  const envelope = {
    ...agentInboxMessageFixture,
    recipientAgentId: projectFixture.coordinatorAgentId
  }
  await port.handleInbox(agentInboxMessageSchema.parse({
    ...envelope,
    payload: {
      protocolVersion: '1.0',
      type: 'task.delivery.sealed',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      deliveryManifestId: manifest.deliveryManifestId,
      resultRevision: manifest.resultRevision
    }
  }))
  currentWorkspace = workspaceFixture(projectFixture, {
    tasks: [{ delivery: adoptedFacts, task: adoptedTask, executions: [completedExecutionFixture(3)] }]
  })
  await port.handleInbox(agentInboxMessageSchema.parse({
    ...envelope,
    payload: {
      protocolVersion: '1.0',
      type: 'task.delivery.adopted',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      deliveryManifestId: manifest.deliveryManifestId,
      disposition: 'adopted'
    }
  }))
  assert.equal(reconciles, 0)
})

test('Delivery Inbox messages ignore non-Coordinator recipients, reject sealed mismatches, and treat adoption as a wake-up', async () => {
  const drive = publishedResultDrive(TEST_IDS.projectId, TEST_IDS.taskId, TEST_IDS.executionId, 'InboxDelivery02')
  const manifest = drive.taskDeliveries[0]!
  const task = taskSchema.parse({ ...taskFixture, status: 'revision_requested', revision: 2, updatedAt: TEST_LATER_TIMESTAMP })
  const workspace = workspaceFixture(projectFixture, {
    tasks: [{
      task,
      executions: [],
      delivery: taskDeliveryFactsSchema.parse({ taskId: TEST_IDS.taskId, candidate: null, manifest, receipt: null, result: null, revisionRequest: null })
    }]
  })
  let reconciles = 0
  const logs: Array<{ level: string; message: string }> = []
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => undefined },
    log: (entry) => { logs.push({ level: entry.level, message: entry.message }) }
  })
  const base = { ...agentInboxMessageFixture, recipientAgentId: projectFixture.coordinatorAgentId }
  await port.handleInbox(agentInboxMessageSchema.parse({
    ...base,
    recipientAgentId: TEST_IDS.secondAgentId,
    payload: { protocolVersion: '1.0', type: 'task.delivery.sealed', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, deliveryManifestId: manifest.deliveryManifestId, resultRevision: manifest.resultRevision }
  }))
  await assert.rejects(port.handleInbox(agentInboxMessageSchema.parse({
    ...base,
    payload: { protocolVersion: '1.0', type: 'task.delivery.sealed', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, deliveryManifestId: manifest.deliveryManifestId, resultRevision: manifest.resultRevision! + 1 }
  })), /Sealed Task Delivery does not match fresh Cloud facts/u)
  // The same mismatch in an adoption notification is a wake-up signal, not a
  // contradiction, because the Task itself is still current and open.
  await port.handleInbox(agentInboxMessageSchema.parse({
    ...base,
    payload: { protocolVersion: '1.0', type: 'task.delivery.adopted', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, deliveryManifestId: manifest.deliveryManifestId, disposition: 'adopted' }
  }))
  assert.equal(reconciles, 0)
  assert.deepEqual(logs.map(({ level }) => level), ['info'])
})

test('Delivery and offer-closed messages stay unACKed when a ready read omits their Project', async () => {
  // Runtime ACKs a Project that Cloud reports deleted before this port runs;
  // an omission here is a transient read contradiction, never an expiry.
  const current = workspaceFixture()
  const absent = projectCoordinatorWorkspaceSchema.parse({
    connection: current.connection,
    observedAt: TEST_LATER_TIMESTAMP,
    availableWorkerUsers: [],
    projects: []
  })
  let reconciles = 0
  let dispatches = 0
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => absent }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => { dispatches += 1 } },
  })
  const base = { ...agentInboxMessageFixture, recipientAgentId: projectFixture.coordinatorAgentId }
  const payloads = [
    { protocolVersion: '1.0', type: 'task.delivery.sealed', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, deliveryManifestId: 'mft_AbsentProject0001', resultRevision: 1 },
    { protocolVersion: '1.0', type: 'task.delivery.adopted', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, deliveryManifestId: 'mft_AbsentProject0001', disposition: 'adopted' },
    { protocolVersion: '1.0', type: 'task.offer.closed', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, taskOfferId: TEST_IDS.taskOfferId, audience: 'coordinator', outcome: 'rejected', taskRevision: 2, offerRevision: 2 }
  ]
  for (const payload of payloads) {
    await assert.rejects(
      port.handleInbox(agentInboxMessageSchema.parse({ ...base, payload })),
      /exact Project is not visible/u
    )
  }
  assert.equal(reconciles, 0)
  assert.equal(dispatches, 0)
})

test('expired sealed and offer-closed messages are acknowledged while exact adoption reconciles once', async () => {
  const drive = publishedResultDrive(TEST_IDS.projectId, TEST_IDS.taskId, TEST_IDS.executionId, 'InboxDelivery03')
  const manifest = drive.taskDeliveries[0]!
  const receipt = {
    schemaVersion: 1 as const,
    revision: 1,
    type: 'integration_receipt' as const,
    integrationReceiptId: 'irc_InboxDelivery0003',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    deliveryManifestId: manifest.deliveryManifestId,
    integrationRevision: 1,
    validationEvidence: ['Verified.'],
    operationId: 'adopt-InboxDelivery03',
    disposition: 'adopted' as const,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  }
  const advancedTask = taskSchema.parse({
    ...taskFixture,
    currentExecutionId: TEST_IDS.executionId,
    currentExecutionState: 'completed',
    status: 'completed',
    executionCount: 1,
    completedAt: TEST_LATER_TIMESTAMP,
    revision: 4,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const advancedFacts = taskDeliveryFactsSchema.parse({ taskId: TEST_IDS.taskId, candidate: null, manifest, receipt, result: drive.projectResults[0], revisionRequest: null })
  const advancedOffer = taskOfferSchema.parse({
    ...closedOfferWorkspaceFixture().projects[0]!.offers[0]!,
    revision: 3,
    updatedAt: TEST_LATER_TIMESTAMP,
    state: 'withdrawn'
  })
  const workspace = workspaceFixture(projectFixture, {
    tasks: [{ task: advancedTask, executions: [completedExecutionFixture(4)], delivery: advancedFacts }],
    offers: [advancedOffer]
  })
  let continuations = 0
  let dispatches = 0
  const logs: Array<{ level: string; message: string }> = []
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => { dispatches += 1 } },
    log: (entry) => { logs.push({ level: entry.level, message: entry.message }) }
  })
  const base = { ...agentInboxMessageFixture, recipientAgentId: projectFixture.coordinatorAgentId }
  // A stale sealed wake-up is expired once the Task is already completed.
  await port.handleInbox(agentInboxMessageSchema.parse({ ...base, payload: { protocolVersion: '1.0', type: 'task.delivery.sealed', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, deliveryManifestId: 'mft_StaleSealedDelivery01', resultRevision: manifest.resultRevision! + 1 } }))
  assert.equal(continuations, 0)
  // The exact adoption is the only message that runs the reconciler.
  await port.handleInbox(agentInboxMessageSchema.parse({ ...base, payload: { protocolVersion: '1.0', type: 'task.delivery.adopted', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, deliveryManifestId: manifest.deliveryManifestId, disposition: 'adopted' } }))
  // The offer closure is expired because the Cloud Offer revision advanced.
  await port.handleInbox(agentInboxMessageSchema.parse({ ...base, payload: { protocolVersion: '1.0', type: 'task.offer.closed', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, taskOfferId: TEST_IDS.taskOfferId, audience: 'coordinator', outcome: 'rejected', taskRevision: 2, offerRevision: 2 } }))
  assert.equal(continuations, 0)
  assert.equal(dispatches, 0)
  assert.deepEqual(logs, [])
})

test('an adoption naming a stale Delivery on a completed Task logs once and still reconciles', async () => {
  const drive = publishedResultDrive(TEST_IDS.projectId, TEST_IDS.taskId, TEST_IDS.executionId, 'InboxDelivery04')
  const manifest = drive.taskDeliveries[0]!
  const mismatchedReceipt = {
    schemaVersion: 1 as const,
    revision: 1,
    type: 'integration_receipt' as const,
    integrationReceiptId: 'irc_InboxDelivery0004',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    deliveryManifestId: 'mft_AdvancedDelivery0004',
    integrationRevision: 1,
    validationEvidence: ['Verified.'],
    operationId: 'adopt-InboxDelivery04',
    disposition: 'adopted' as const,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  }
  const completedTask = taskSchema.parse({
    ...taskFixture,
    currentExecutionId: TEST_IDS.executionId,
    currentExecutionState: 'completed',
    status: 'completed',
    executionCount: 1,
    completedAt: TEST_LATER_TIMESTAMP,
    revision: 4,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const workspace = workspaceFixture(projectFixture, {
    tasks: [{
      task: completedTask,
      executions: [completedExecutionFixture(4)],
      delivery: taskDeliveryFactsSchema.parse({
        taskId: TEST_IDS.taskId,
        candidate: null,
        manifest,
        receipt: mismatchedReceipt,
        result: drive.projectResults[0],
        revisionRequest: null
      })
    }]
  })
  let reconciles = 0
  const logs: Array<{ level: string; message: string }> = []
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => undefined },
    log: (entry) => { logs.push({ level: entry.level, message: entry.message }) }
  })

  await port.handleInbox(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    recipientAgentId: projectFixture.coordinatorAgentId,
    payload: {
      protocolVersion: '1.0',
      type: 'task.delivery.adopted',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      deliveryManifestId: manifest.deliveryManifestId,
      disposition: 'adopted'
    }
  }))

  assert.equal(reconciles, 0)
  assert.equal(logs.length, 1)
  assert.equal(logs[0]?.level, 'info')
  assert.match(logs[0]?.message ?? '', /mft_AdvancedDelivery0004/u)
})

test('an adoption for a Task absent from Cloud facts rejects unless it is legacy history', async () => {
  const adoptedPayload = {
    protocolVersion: '1.0',
    type: 'task.delivery.adopted',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    deliveryManifestId: 'mft_AbsentTaskDelivery01',
    disposition: 'adopted'
  }
  const base = { ...agentInboxMessageFixture, recipientAgentId: projectFixture.coordinatorAgentId }
  let reconciles = 0
  const currentOnly = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspaceFixture()
    }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => undefined },
  })
  await assert.rejects(
    currentOnly.handleInbox(agentInboxMessageSchema.parse({ ...base, payload: adoptedPayload })),
    /Task Delivery adoption does not match fresh Cloud facts/u
  )
  assert.equal(reconciles, 0)

  const legacyTask = taskHistorySchema.parse({
    ...taskFixture,
    currentExecutionId: TEST_IDS.executionId,
    currentExecutionState: 'completed',
    status: 'completed',
    executionCount: 1,
    completedAt: TEST_LATER_TIMESTAMP,
    revision: 4,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const legacyLogs: Array<{ level: string; message: string }> = []
  const legacyOnly = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspaceFixture(projectFixture, { legacyTasks: [legacyTask] })
    }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => undefined },
    log: (entry) => { legacyLogs.push({ level: entry.level, message: entry.message }) }
  })
  await legacyOnly.handleInbox(agentInboxMessageSchema.parse({ ...base, payload: adoptedPayload }))
  assert.equal(reconciles, 0)
  assert.equal(legacyLogs.length, 1)
  assert.equal(legacyLogs[0]?.level, 'info')
})

test('task.offer.closed reconciles exact fresh Coordinator facts and rejects stale or Worker facts', async () => {
  const workspace = closedOfferWorkspaceFixture()
  let reads = 0
  let continuations = 0
  let commands = 0
  let dispatches = 0
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => {
        reads += 1
        return workspace
      }
    }),
    coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async () => {
        commands += 1
        throw new Error('A closed offer notification must not automatically re-offer the Task.')
      },
      subscribe: () => () => undefined
    },
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => { dispatches += 1 } },
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
  assert.equal(dispatches, 1)
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
  assert.equal(dispatches, 1)
})

test('task.execution.failed reconciles requirements dispatch only for exact fenced facts and rejects stale or open facts', async () => {
  let workspace = executionWorkspaceFixture('failed', 3)
  let dispatches = 0
  let continuations = 0
  let commands = 0
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspace
    }),
    coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async () => {
        commands += 1
        throw new Error('Execution failures use the requirements dispatch port.')
      },
      subscribe: () => () => undefined
    },
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => { dispatches += 1 } },
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
  assert.equal(dispatches, 1)
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
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async () => { throw new Error('Execution start consumption must not write to Cloud.') },
      subscribe: () => () => undefined
    },
    transport: unusedTransport(),
    state: coordinatorState(),
    requirementsDispatch: { reconcileProject: async () => undefined },
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

  assert.equal(continuations, 0)
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
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
    localAgentId: () => undefined,
    resume: async () => null,
    execute: async (command) => {
      coordinatorCommands.push(command)
      return entityResponse(command.requestId, needed)
    },
    subscribe: () => () => undefined
  }
  const transport: AuthenticatedCloudTransport = {
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
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
    requirementsDispatch: { reconcileProject: async () => undefined },
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
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
    localAgentId: () => undefined,
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
    requirementsDispatch: { reconcileProject: async () => undefined },
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
    tasks: [{ delivery: null, task, executions: [] }],
    offers: [offer]
  })
}

function completedExecutionFixture(revision: number) {
  return taskExecutionSchema.parse({
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
    state: 'completed',
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
      status: 'fenced',
      reason: 'result_submitted',
      fencedAt: TEST_LATER_TIMESTAMP
    },
    fileIntent: null,
    currentResultSubmissionId: null,
    offeredAt: TEST_TIMESTAMP,
    acceptedAt: TEST_TIMESTAMP,
    startedAt: TEST_TIMESTAMP,
    terminalAt: TEST_LATER_TIMESTAMP,
    revision,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
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
    tasks: [{ delivery: null, task, executions: [execution] }]
  })
}

function workspaceFixture(
  project = projectFixture,
  facts: Readonly<{
    finalSummary?: ProjectFinalSummary
    records?: ProjectRecord[]
    tasks?: ProjectCoordinatorProject['tasks']
    offers?: ProjectCoordinatorProject['offers']
    legacyTasks?: ProjectCoordinatorProject['legacyHistory']['tasks']
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
      pendingHumanNeeded: [],
      records: facts.records ?? [],
      finalSummary: facts.finalSummary ?? null,
      memberships: [projectMembership(project, project.ownerUserId, 'pmb_ProjectOwner01'),
          projectMembership(project, TEST_IDS.secondUserId, 'pmb_ProjectMember01')],
      legacyHistory: {
        readOnly: true as const,
        plans: [],
        tasks: facts.legacyTasks ?? [],
        executions: []
      },
      deliveryDrive: null
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

function unusedCoordinatorCloudCommands(): CoordinatorCloudCommandService {
  return {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
    localAgentId: () => undefined,
    execute: async () => { throw new Error('Coordinator Cloud commands are unused.') },
    resume: async () => null,
    subscribe: () => () => undefined
  }
}

function unusedTransport(): AuthenticatedCloudTransport {
  return {
      stageObject: async () => { throw new Error('Unexpected object staging.') },
      readObject: async () => { throw new Error('Unexpected object read.') },
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

function coordinatorStateWithWriteFailures(
  failedWriteAttempts: ReadonlySet<number>
): ProjectCoordinatorStateStore {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
  let writeAttempt = 0
  return new ProjectCoordinatorStateStore({
    read: async () => ({ revision, value }),
    write: async (next, expectedRevision) => {
      assert.equal(expectedRevision, revision)
      writeAttempt += 1
      if (failedWriteAttempts.has(writeAttempt)) {
        throw new Error('Injected Project delete completion write failure.')
      }
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


test('Project delete completes a matching durable replay after Cloud reports the Project absent', async () => {
  const initialIdempotencyKey = 'idem_ProjectDeleteAbsent01'
  const retryIdempotencyKey = 'idem_ProjectDeleteAbsent02'
  const state = coordinatorState()
  let cloudAttempts = 0
  let authorizationCalls = 0
  let workspaceReads = 0
  const port = createProjectCoordinatorActionPort({
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => {
        workspaceReads += 1
        return workspaceFixture()
      }
    }),
    coordinatorCloudCommands: unusedCoordinatorCloudCommands(),
    transport: {
      stageObject: async () => { throw new Error('Unexpected object staging.') },
      readObject: async () => { throw new Error('Unexpected object read.') },
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.run0.invalid/',
        userId: projectFixture.ownerUserId,
        deviceId: TEST_IDS.deviceId,
        deviceRevision: 1
      }),
      execute: async ({ payload }) => {
        cloudAttempts += 1
        if (cloudAttempts === 1) {
          throw new Error('Delete response was lost after Cloud commit.')
        }
        return {
          contractVersion: 1,
          status: 404,
          body: {
            protocolVersion: '1.0',
            type: 'rest.error',
            requestId: payload.requestId,
            error: createCollaborationError(
              'not_found',
              'The Project no longer exists.',
              { requestId: payload.requestId }
            )
          }
        }
      }
    },
    state,
    requirementsDispatch: { reconcileProject: async () => undefined }
  })

  await assert.rejects(
    port.deleteProject(
      { projectId: TEST_IDS.projectId },
      initialIdempotencyKey,
      async () => { authorizationCalls += 1 }
    ),
    /response was lost/u
  )
  assert.deepEqual(await port.deleteProject(
    { projectId: TEST_IDS.projectId },
    retryIdempotencyKey,
    async () => { authorizationCalls += 1 }
  ), {
    projectId: TEST_IDS.projectId,
    deleted: true
  })

  assert.equal(cloudAttempts, 2)
  assert.equal(authorizationCalls, 1)
  assert.equal(workspaceReads, 1)
  assert.deepEqual(await state.readProjectDeleteIntent(
    projectFixture.ownerUserId,
    TEST_IDS.projectId,
    retryIdempotencyKey
  ), {
    projectId: TEST_IDS.projectId,
    principalUserId: projectFixture.ownerUserId,
    idempotencyKey: initialIdempotencyKey,
    expectedRevision: projectFixture.revision,
    expectedCoordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch,
    expectedExecutionAuthorityEpoch: projectFixture.executionAuthorityEpoch,
    state: 'succeeded'
  })
})

for (const legacy of [false, true]) {
  for (const superseded of [false, true]) {
    test(`Plan confirmation consumes exact retained facts without writes (legacy=${legacy}, superseded=${superseded})`, async () => {
      const retained = historicalPlanFixture(projectFixture, { legacy, superseded })
      const base = workspaceFixture()
      let workspace = projectCoordinatorWorkspaceSchema.parse({ ...base, projects: [{
        ...base.projects[0], plan: legacy || superseded ? null : { plan: retained },
        legacyHistory: { readOnly: true, plans: legacy || superseded ? [retained] : [], tasks: [], executions: [] }
      }] })
      let writes = 0
      let dispatches = 0
      const port = createProjectCoordinatorActionPort({
        workspace: defineProjectCoordinatorWorkspacePort({ readWorkspace: async () => workspace }),
        coordinatorCloudCommands: { ...unusedCoordinatorCloudCommands(), execute: async () => { writes += 1; throw new Error('Unexpected write.') } },
        transport: unusedTransport(), state: coordinatorState(),
        requirementsDispatch: { reconcileProject: async () => { dispatches += 1 } }
      })
      const message = agentInboxMessageSchema.parse({ ...agentInboxMessageFixture,
        recipientAgentId: projectFixture.coordinatorAgentId,
        payload: { protocolVersion: '1.0', type: 'project.plan.confirmed', projectId: retained.projectId,
          projectPlanId: retained.projectPlanId, revision: 2, planDigest: retained.planDigest }
      })
      await port.handleInbox(message)
      await port.handleInbox(message)
      await port.handleInbox(agentInboxMessageSchema.parse({ ...message,
        payload: { protocolVersion: '1.0', type: 'project.started', projectId: retained.projectId, revision: projectFixture.revision }
      }))
      for (const payload of [{ ...message.payload, planDigest: 'b'.repeat(64) },
        { ...message.payload, revision: retained.revision + 1 },
        { ...message.payload, projectPlanId: 'pln_AbsentHistory0001' }]) {
        await assert.rejects(port.handleInbox(agentInboxMessageSchema.parse({ ...message, payload })),
          /Plan confirmation notification does not match retained Cloud facts/u)
      }
      workspace = projectCoordinatorWorkspaceSchema.parse({ ...base, projects: [{ ...base.projects[0],
        legacyHistory: { readOnly: true, tasks: [], executions: [], plans: [{ ...retained,
          state: 'awaiting_confirmation', confirmedByUserId: null, confirmedAt: null, supersededAt: null }] }
      }] })
      await assert.rejects(port.handleInbox(message), /Plan confirmation notification does not match retained Cloud facts/u)
      workspace = projectCoordinatorWorkspaceSchema.parse({ observedAt: base.observedAt,
        availableWorkerUsers: [], projects: [], connection: { state: 'cloud_unavailable', reason: 'Read failed.' } })
      await assert.rejects(port.handleInbox(message), /Project coordination is cloud_unavailable/u)
      assert.equal(writes, 0)
      assert.equal(dispatches, 0)
    })
  }
}
