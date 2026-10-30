import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createCollaborationError,
  projectRequirementsDocumentSchema,
  restResponseSchema,
  type ProjectRequirementsDocument,
  type RestRequest,
  type RestResponse,
  type Task,
  type TaskOffer
} from '@sciforge/collaboration-contracts'
import { canonicalTaskIdForRequirementsModule } from '@sciforge/collaboration-contracts/node'
import type {
  AuthenticatedCloudResponse,
  AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'

import {
  coordinatorCloudCommandSchema,
  type CoordinatorCloudCommand
} from '../coordinator-cloud-command.js'
import { DurableCloudOutbox } from '../main/outbox.js'
import {
  CollaborationLocalStore,
  EMPTY_COLLABORATION_LOCAL_STATE,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from '../main/store.js'
import { createTestAgentCloudRuntime } from '../main/test-agent-cloud-runtime.js'
import type {
  ProjectCoordinatorProject,
  ProjectCoordinatorWorkspace
} from './contract.js'
import { createProjectCoordinatorActionPort } from './ports.js'
import { createProjectCoordinatorRequirementsDispatchPort } from './requirements-dispatch.js'
import { ProjectCoordinatorStateStore } from './state.js'

const createdAt = '2026-10-17T00:00:00.000Z'
const updatedAt = '2026-10-17T00:05:00.000Z'
const projectId = 'prj_RequirementsDispatch01'
const ownerUserId = 'usr_Owner0000001'
const coordinatorAgentId = 'agt_Coordinator01'
const workerUserId = 'usr_Worker000001'
const alternateWorkerUserId = 'usr_Worker000002'
const thirdWorkerUserId = 'usr_Worker000003'
const fourthWorkerUserId = 'usr_Worker000004'

const document: ProjectRequirementsDocument = projectRequirementsDocumentSchema.parse({
  schemaVersion: 1,
  revision: 2,
  createdAt,
  updatedAt,
  type: 'project_requirements_document',
  requirementsDocumentId: 'rqd_RequirementsDispatch01',
  projectId,
  documentRevision: 1,
  state: 'confirmed',
  goalsDeliverables: 'Goal: annotated cells.',
  inputsBoundaries: 'Input: the exact QC matrix.',
  inputReferences: [],
  workModules: [{
    planItemId: 'item_qc', title: 'Quality control',
    objective: 'Run the exact QC pipeline.', dependencyPlanItemIds: [],
    requiredCapabilityTags: ['qc']
  }],
  acceptanceCriteria: [
    { target: 'item_qc', criteria: 'The QC report exists.', evidenceMethod: 'Published Drive object.' },
    { target: '$project', criteria: 'Every module accepted.', evidenceMethod: 'Owner review.' }
  ],
  contentDigest: 'c'.repeat(64),
  confirmedByUserId: ownerUserId,
  confirmedAt: updatedAt,
  supersededAt: null
})

type FixtureState = {
  status: 'draft' | 'paused' | 'active'
  revision: number
  invitedMember?: boolean
  invitedMemberCount?: number
  eligibleWorkers: Array<Readonly<{ userId: string, tags: readonly string[], load: number }>>
  tasks: Task[]
  offers: TaskOffer[]
  pendingHumanNeeded: ProjectCoordinatorProject['pendingHumanNeeded']
  confirmedDocument?: ProjectRequirementsDocument
  deliveryDrive?: ProjectCoordinatorProject['deliveryDrive']
}

function availabilityView(userId: string, tags: readonly string[], load: number) {
  return {
    schemaVersion: 1,
    type: 'project_worker_availability_view',
    projectId,
    userId,
    agentId: `agt_${userId.slice(4)}`,
    revision: 1,
    membership: {
      schemaVersion: 1, type: 'project_membership', projectMembershipId: `pmb_${userId.slice(4)}`,
      projectId, userId, state: 'active', authorityEpoch: 1, activatedAt: createdAt,
      removalRequestedAt: null, removalRequestedByUserId: null, removedAt: null,
      revision: 1, createdAt, updatedAt
    },
    availability: {
      schemaVersion: 1, type: 'worker_availability_projection', revision: 1,
      createdAt, updatedAt, userId, agentId: `agt_${userId.slice(4)}`, deviceId: `dev_${userId.slice(4)}`,
      agentActive: true, deviceActive: true, connectionStatus: 'online',
      lastHeartbeatAt: updatedAt, runtimeReadiness: 'ready',
      runtimeCapabilityTags: tags, acceptsNewOffers: true, activeTaskCount: load,
      observedAt: updatedAt, expiresAt: '2026-10-17T01:00:00.000Z'
    },
    taskAuthorities: [],
    observedAt: updatedAt
  }
}

function workspaceFixture(state: FixtureState): ProjectCoordinatorWorkspace {
  const projectView = {
    project: {
      schemaVersion: 1, revision: state.revision, createdAt, updatedAt,
      type: 'project', projectId, ownerUserId,
      displayName: 'Requirements dispatch', goal: 'Dispatch modules.',
      coordinatorAgentId, coordinatorAuthorityEpoch: 1, executionAuthorityEpoch: 1,
      status: state.status,
      budget: { maxTasks: 8, maxTasksPerRound: 4, maxTaskRetries: 2, maxCoordinationRounds: 4 }
    },
    coordinatorTransferFeedback: null,
    plan: null,
    requirementsDraft: null,
    confirmedRequirements: state.confirmedDocument ?? document,
    memberUsers: [],
    workerGroups: state.eligibleWorkers.map(({ userId, tags, load }) => ({
      userId,
      displayName: `Worker ${userId}`,
      agents: [{ displayName: `Agent ${userId}`, projectAvailability: availabilityView(userId, tags, load) }]
    })),
    tasks: state.tasks.map((task) => {
      const manifest = state.deliveryDrive?.taskDeliveries.find(({ taskId }) => taskId === task.taskId)
      const result = manifest && state.deliveryDrive?.projectResults.find(({ deliveryManifestId }) => (
        deliveryManifestId === manifest.deliveryManifestId
      ))
      return {
        task,
        delivery: manifest ? {
          taskId: task.taskId, candidate: null, manifest, receipt: result
            ? { disposition: result.disposition } : null, result: null, revisionRequest: null
        } : null,
        executions: []
      }
    }),
    offers: state.offers,
    deliveryDrive: state.deliveryDrive ?? null,
    pendingHumanNeeded: state.pendingHumanNeeded,
    records: [],
    finalSummary: null,
    memberships: Array.from({
      length: state.invitedMemberCount ?? (state.invitedMember ? 1 : 0)
    }, (_, index) => ({ state: 'invited', userId: `usr_Invited${index + 1}` })),
    legacyHistory: { readOnly: true, plans: [], tasks: [], executions: [] }
  } as unknown as ProjectCoordinatorProject
  return {
    connection: { state: 'ready', userId: ownerUserId, deviceId: 'dev_Owner0000001' },
    observedAt: updatedAt,
    availableWorkerUsers: [],
    projects: [projectView]
  } as unknown as ProjectCoordinatorWorkspace
}

function restResponse(body: AuthenticatedCloudResponse['body']): AuthenticatedCloudResponse {
  return { contractVersion: 1, status: 200, body }
}

type HarnessOverrides = Readonly<{
  /** Rest.error responses injected before the next successful promotions. */
  offerCreateErrors?: ReadonlyArray<Readonly<{
    code: 'revision_conflict' | 'internal_error' | 'permission_denied' | 'invalid_state_transition'
    message?: string
  }>>
}>

function harness(initial: FixtureState, overrides: HarnessOverrides = {}) {
  const state = initial
  const commands: CoordinatorCloudCommand[] = []
  const userCommands: Array<Readonly<{ type: string, status: string }>> = []
  const humanNeededBodies = new Map<string, string>()
  const offerCreateErrors = [...(overrides.offerCreateErrors ?? [])]
  const transport: AuthenticatedCloudTransport = {
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready', baseUrl: 'https://cloud.run0.invalid/',
      userId: ownerUserId, deviceId: 'dev_Owner0000001', deviceRevision: 1
    }),
    execute: async (request) => {
      const payload = request.payload as { type: string, status?: string }
      if (payload.type === 'project.transition') {
        userCommands.push({ type: payload.type, status: payload.status! })
        state.status = payload.status as FixtureState['status']
        state.revision += 1
        return restResponse({
          protocolVersion: '1.0', type: 'rest.entity', requestId: 'req_Transition01',
          entity: { projectId, status: payload.status! } as never
        })
      }
      throw new Error(`Unexpected User Cloud request ${payload.type}.`)
    }
  }
  const coordinatorCloudCommands = {
    executeUser: async () => { throw new Error('Unexpected User command.') },
    resumeUser: async () => null,
    resume: async () => null,
    subscribe: () => () => undefined,
    execute: async (command: CoordinatorCloudCommand) => {
      if (command.type === 'human.needed.create') {
        const body = JSON.stringify(command)
        const existingBody = humanNeededBodies.get(command.idempotencyKey)
        if (existingBody !== undefined && existingBody !== body) {
          throw new Error('Outbox idempotency key was reused for a different command.')
        }
        humanNeededBodies.set(command.idempotencyKey, body)
      }
      commands.push(command)
      if (command.type === 'task.offer.create' && 'requirementsDocumentId' in command) {
        const injected = offerCreateErrors.shift()
        if (injected) {
          return restResponse({
            protocolVersion: '1.0',
            type: 'rest.error',
            requestId: command.requestId,
            error: createCollaborationError(
              injected.code,
              injected.message ?? `The Cloud rejected ${command.planItemId}.`
            )
          }).body
        }
        const taskId = canonicalTaskIdForRequirementsModule(
          command.requirementsDocumentId, command.planItemId
        )
        const task = {
          schemaVersion: 1, revision: 1, createdAt, updatedAt, type: 'task', taskId, projectId,
          createdByCoordinatorAgentId: coordinatorAgentId,
          title: 'Quality control', objective: 'Run the exact QC pipeline.',
          completionCriteria: ['The QC report exists.'], dependencyTaskIds: [],
          requiredCapabilityTags: ['qc'], fileIntent: null,
          currentExecutionId: null, currentExecutionState: null,
          status: 'offered', executionCount: 0, maxRetries: 2, completedAt: null
        } as unknown as Task
        const offer = {
          schemaVersion: 1, revision: 1, createdAt, updatedAt, type: 'task_offer',
          taskOfferId: 'ofr_RequirementsDispatch01', projectId, taskId,
          executionId: null, workerUserId: command.workerUserId,
          offeredByCoordinatorAgentId: coordinatorAgentId,
          state: 'pending', reassignmentTaskRevision: null,
          offeredAt: updatedAt, expiresAt: command.offerExpiresAt, respondedAt: null
        } as unknown as TaskOffer
        state.tasks.push(task)
        state.offers.push(offer)
        state.revision += 1
        return restResponse({
          protocolVersion: '1.0', type: 'rest.collection', requestId: command.requestId,
          items: [task, offer]
        }).body
      }
      if (command.type === 'task.offer.reassign') {
        const task = state.tasks.find(({ taskId }) => taskId === command.taskId)!
        const updatedTask = { ...task, status: 'offered' as const, revision: task.revision + 1 }
        state.tasks[state.tasks.findIndex(({ taskId }) => taskId === command.taskId)] = updatedTask
        const offer = {
          schemaVersion: 1, revision: 1, createdAt, updatedAt, type: 'task_offer',
          taskOfferId: `ofr_${task.taskId.slice(4, 12)}02`, projectId, taskId: task.taskId,
          executionId: null, workerUserId: command.workerUserId,
          offeredByCoordinatorAgentId: coordinatorAgentId,
          state: 'pending', reassignmentTaskRevision: null,
          offeredAt: updatedAt, expiresAt: command.offerExpiresAt, respondedAt: null
        } as unknown as TaskOffer
        state.offers.push(offer)
        state.revision += 1
        return restResponse({
          protocolVersion: '1.0', type: 'rest.collection', requestId: command.requestId,
          items: [updatedTask, offer]
        }).body
      }
      if (command.type === 'human.needed.create' && command.context.scope === 'coordinator_project') {
        const context = command.context
        const existing = state.pendingHumanNeeded.find((candidate) => (
          candidate.status === 'pending' &&
          candidate.context.scope === 'coordinator_project' &&
          candidate.context.requirementsDocumentId === context.requirementsDocumentId &&
          candidate.context.planItemId === context.planItemId &&
          candidate.context.dedupReason === context.dedupReason
        ))
        if (existing) {
          return restResponse({
            protocolVersion: '1.0', type: 'rest.entity', requestId: command.requestId,
            entity: existing
          }).body
        }
        const request = {
          schemaVersion: 1, revision: 1, createdAt, updatedAt, type: 'human_needed',
          humanRequestId: `hrq_${String(state.pendingHumanNeeded.length + 1).padStart(4, '0')}todo01`,
          projectId,
          context: {
            scope: 'coordinator_project',
            coordinatorAuthorityEpoch: 1,
            requirementsDocumentId: context.requirementsDocumentId,
            planItemId: context.planItemId,
            dedupReason: context.dedupReason
          },
          targetUserId: command.targetUserId, requestedByAgentId: coordinatorAgentId,
          requiredAssurance: command.requiredAssurance, prompt: command.prompt,
          confirmableAction: null, status: 'pending',
          expiresAt: command.expiresAt
        } as unknown as FixtureState['pendingHumanNeeded'][number]
        state.pendingHumanNeeded.push(request)
        return restResponse({
          protocolVersion: '1.0', type: 'rest.entity', requestId: command.requestId,
          entity: request
        }).body
      }
      throw new Error(`Unexpected Coordinator command ${command.type}.`)
    }
  }
  const port = createProjectCoordinatorRequirementsDispatchPort({
    workspace: { readWorkspace: async () => workspaceFixture(state) },
    coordinatorCloudCommands,
    transport
  })
  return { state, commands, userCommands, port, coordinatorCloudCommands, transport }
}

function baseState(overrides?: Partial<FixtureState>): FixtureState {
  return {
    status: 'paused',
    revision: 4,
    eligibleWorkers: [{ userId: workerUserId, tags: ['qc'], load: 0 }],
    tasks: [],
    offers: [],
    pendingHumanNeeded: [],
    ...overrides
  }
}

function promotedTask(revision = 1): Task {
  return {
    schemaVersion: 1, revision, createdAt, updatedAt, type: 'task',
    taskId: canonicalTaskIdForRequirementsModule(document.requirementsDocumentId, 'item_qc'),
    projectId, createdByCoordinatorAgentId: coordinatorAgentId,
    title: 'Quality control', objective: 'Run the exact QC pipeline.',
    completionCriteria: ['The QC report exists.'], dependencyTaskIds: [],
    requiredCapabilityTags: ['qc'], fileIntent: null,
    currentExecutionId: null, currentExecutionState: null,
    status: 'revision_requested', executionCount: 0, maxRetries: 2, completedAt: null
  } as unknown as Task
}

function terminalOffer(task: Task, worker: string, state_: 'rejected' | 'timed_out' | 'withdrawn', revision: number): TaskOffer {
  return {
    schemaVersion: 1, revision, createdAt, updatedAt, type: 'task_offer',
    taskOfferId: `ofr_${task.taskId.slice(4, 12)}0${revision}`, projectId, taskId: task.taskId,
    executionId: null, workerUserId: worker,
    offeredByCoordinatorAgentId: coordinatorAgentId,
    state: state_, reassignmentTaskRevision: task.revision,
    offeredAt: createdAt, expiresAt: updatedAt, respondedAt: updatedAt
  } as unknown as TaskOffer
}

test('activates and promotes the ready module to the selected Worker, then converges', async () => {
  const { state, commands, userCommands, port } = harness(baseState())
  await port.reconcileProject(projectId)
  assert.deepEqual(userCommands, [{ type: 'project.transition', status: 'active' }])
  const creations = commands.filter((command) => command.type === 'task.offer.create')
  assert.equal(creations.length, 1)
  assert.equal('requirementsDocumentId' in creations[0]!, true)
  assert.equal((creations[0] as { workerUserId: string }).workerUserId, workerUserId)
  assert.equal(state.tasks.length, 1)
  assert.equal(state.offers.length, 1)

  await port.reconcileProject(projectId)
  assert.equal(commands.filter((command) => command.type === 'task.offer.create').length, 1)
  assert.equal(commands.filter((command) => command.type === 'human.needed.create').length, 0)
})

test('first dispatch after activation prefers a member over an equally loaded Owner with a smaller userId', async () => {
  const { commands, userCommands, port } = harness(baseState({
    eligibleWorkers: [
      { userId: ownerUserId, tags: ['qc'], load: 0 },
      { userId: workerUserId, tags: ['qc'], load: 0 }
    ]
  }))
  await port.reconcileProject(projectId)
  assert.deepEqual(userCommands, [{ type: 'project.transition', status: 'active' }])
  const creations = commands.filter((command) => command.type === 'task.offer.create')
  assert.equal(creations.length, 1)
  assert.ok(creations[0] && 'workerUserId' in creations[0])
  assert.equal(creations[0].workerUserId, workerUserId)
})

test('waits for an invited member before activation, then dispatches after acceptance', async () => {
  const fixture = baseState({ status: 'draft', invitedMember: true })
  const { state, commands, userCommands, port } = harness(fixture)
  await port.reconcileProject(projectId)
  assert.deepEqual(userCommands, [])
  assert.equal(commands.filter((command) => command.type === 'task.offer.create').length, 0)

  // Requirements confirmation moves the draft to paused while the invited
  // Worker is still pending; confirmation alone must not activate or dispatch.
  state.status = 'paused'
  state.revision += 1
  await port.reconcileProject(projectId)
  assert.deepEqual(userCommands, [])
  assert.equal(commands.filter((command) => command.type === 'task.offer.create').length, 0)

  // The membership.changed wakeup arrives after acceptance, so the next
  // Coordinator sweep may activate and promote the module to that Worker.
  state.invitedMember = false
  await port.reconcileProject(projectId)
  assert.deepEqual(userCommands, [{ type: 'project.transition', status: 'active' }])
  assert.equal(commands.filter((command) => command.type === 'task.offer.create').length, 1)
})

test('waits for every invited member before activating and dispatching to the eligible Worker', async () => {
  const fixture = baseState({ invitedMemberCount: 2 })
  const { state, commands, userCommands, port } = harness(fixture)

  await port.reconcileProject(projectId)
  assert.deepEqual(userCommands, [])
  assert.equal(commands.filter((command) => command.type === 'task.offer.create').length, 0)

  state.invitedMemberCount = 1
  await port.reconcileProject(projectId)
  assert.deepEqual(userCommands, [])
  assert.equal(commands.filter((command) => command.type === 'task.offer.create').length, 0)

  state.invitedMemberCount = 0
  await port.reconcileProject(projectId)
  assert.deepEqual(userCommands, [{ type: 'project.transition', status: 'active' }])
  const offer = commands.find((command) => command.type === 'task.offer.create')
  assert.ok(offer && 'workerUserId' in offer)
  assert.equal(offer.workerUserId, workerUserId)
})

test('keeps dependent modules unpromoted until completion and adoption are both visible', async () => {
  const confirmedDocument = projectRequirementsDocumentSchema.parse({
    ...document,
    requirementsDocumentId: 'rqd_RequirementsDispatchDeps01',
    workModules: [
      { planItemId: 'item_input', title: 'Input', objective: 'Prepare input.', dependencyPlanItemIds: [] },
      { planItemId: 'item_qc', title: 'Quality control', objective: 'Run QC.', dependencyPlanItemIds: ['item_input'] }
    ],
    acceptanceCriteria: [
      { target: 'item_input', criteria: 'Input exists.', evidenceMethod: 'Drive object.' },
      { target: 'item_qc', criteria: 'QC exists.', evidenceMethod: 'Drive object.' },
      { target: '$project', criteria: 'All accepted.', evidenceMethod: 'Owner review.' }
    ]
  })
  const { state, commands, port } = harness(baseState({ confirmedDocument }))
  await port.reconcileProject(projectId)
  assert.deepEqual(
    commands.filter((command) => command.type === 'task.offer.create')
      .map((command) => command.planItemId),
    ['item_input']
  )

  const dependencyTask = state.tasks[0]!
  state.tasks[0] = { ...dependencyTask, status: 'completed' }
  await port.reconcileProject(projectId)
  assert.equal(commands.filter((command) => command.type === 'task.offer.create').length, 1)

  state.deliveryDrive = {
    taskDeliveries: [{ deliveryManifestId: 'mft_RequirementsDispatchDeps01', taskId: dependencyTask.taskId }],
    projectResults: [{ deliveryManifestId: 'mft_RequirementsDispatchDeps01', disposition: 'adopted' }]
  } as unknown as ProjectCoordinatorProject['deliveryDrive']
  await port.reconcileProject(projectId)
  assert.deepEqual(
    commands.filter((command) => command.type === 'task.offer.create')
      .map((command) => command.planItemId),
    ['item_input', 'item_qc']
  )
})

test('task.delivery.adopted Inbox unlocks a module only after every dependency is adopted', async () => {
  const { agentInboxMessageSchema } = await import('@sciforge/collaboration-contracts')
  const { agentInboxMessageFixture } = await import('@sciforge/collaboration-contracts/testing')
  const confirmedDocument = projectRequirementsDocumentSchema.parse({
    ...document,
    requirementsDocumentId: 'rqd_RequirementsAdoptUnlock01',
    workModules: [
      { planItemId: 'item_m1', title: 'M1', objective: 'Module one.', dependencyPlanItemIds: [], requiredCapabilityTags: ['qc'] },
      { planItemId: 'item_m2', title: 'M2', objective: 'Module two.', dependencyPlanItemIds: [], requiredCapabilityTags: ['qc'] },
      { planItemId: 'item_m4', title: 'M4', objective: 'Module four.', dependencyPlanItemIds: ['item_m1', 'item_m2'], requiredCapabilityTags: ['qc'] }
    ],
    acceptanceCriteria: [
      { target: 'item_m1', criteria: 'M1 exists.', evidenceMethod: 'Drive object.' },
      { target: 'item_m2', criteria: 'M2 exists.', evidenceMethod: 'Drive object.' },
      { target: 'item_m4', criteria: 'M4 exists.', evidenceMethod: 'Drive object.' },
      { target: '$project', criteria: 'All accepted.', evidenceMethod: 'Owner review.' }
    ]
  })
  const fixture = harness(baseState({
    confirmedDocument,
    eligibleWorkers: [
      { userId: workerUserId, tags: ['qc'], load: 0 },
      { userId: alternateWorkerUserId, tags: ['qc'], load: 0 }
    ]
  }))
  // The Cloud read model exposes the exact adopted receipt for each Delivery.
  const readWorkspace = async () => {
    const workspace = workspaceFixture(fixture.state)
    for (const taskView of workspace.projects[0]!.tasks) {
      const delivery = taskView.delivery as unknown as {
        manifest: { deliveryManifestId: string }
        receipt: Record<string, unknown> | null
      } | null
      if (delivery?.receipt) {
        delivery.receipt = {
          ...delivery.receipt,
          projectId,
          taskId: taskView.task.taskId,
          deliveryManifestId: delivery.manifest.deliveryManifestId
        }
      }
    }
    return workspace
  }
  const actionPort = createProjectCoordinatorActionPort({
    workspace: { readWorkspace },
    coordinatorCloudCommands: fixture.coordinatorCloudCommands,
    transport: fixture.transport,
    state: new ProjectCoordinatorStateStore({
      read: async () => ({ revision: 0, value: null }),
      write: async (value, expectedRevision) => ({ revision: expectedRevision + 1, value }),
      clear: async (expectedRevision) => ({ revision: expectedRevision + 1, value: null })
    }),
    requirementsDispatch: fixture.port
  })
  const offeredModules = () => fixture.commands
    .filter((command) => command.type === 'task.offer.create')
    .map((command) => command.planItemId)
  const taskIdFor = (planItemId: string) => canonicalTaskIdForRequirementsModule(
    confirmedDocument.requirementsDocumentId, planItemId
  )
  const manifests: Array<{ deliveryManifestId: string, taskId: string, projectId: string }> = []
  const results: Array<{ deliveryManifestId: string, disposition: 'adopted' }> = []
  const adopt = async (planItemId: string, deliveryManifestId: string) => {
    const index = fixture.state.tasks.findIndex(({ taskId }) => taskId === taskIdFor(planItemId))
    fixture.state.tasks[index] = { ...fixture.state.tasks[index]!, status: 'completed' }
    manifests.push({ deliveryManifestId, taskId: taskIdFor(planItemId), projectId })
    results.push({ deliveryManifestId, disposition: 'adopted' })
    fixture.state.deliveryDrive = {
      taskDeliveries: manifests,
      projectResults: results
    } as unknown as ProjectCoordinatorProject['deliveryDrive']
    await actionPort.handleInbox(agentInboxMessageSchema.parse({
      ...agentInboxMessageFixture,
      recipientAgentId: coordinatorAgentId,
      payload: {
        protocolVersion: '1.0',
        type: 'task.delivery.adopted',
        projectId,
        taskId: taskIdFor(planItemId),
        deliveryManifestId,
        disposition: 'adopted'
      }
    }))
  }

  await actionPort.handleInbox(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    recipientAgentId: coordinatorAgentId,
    payload: {
      protocolVersion: '1.0', type: 'project.requirements.confirmed', projectId,
      requirementsDocumentId: confirmedDocument.requirementsDocumentId,
      documentRevision: confirmedDocument.documentRevision,
      contentDigest: confirmedDocument.contentDigest
    }
  }))
  assert.deepEqual(offeredModules().sort(), ['item_m1', 'item_m2'])

  await adopt('item_m1', 'mft_RequirementsAdoptM1')
  assert.deepEqual(offeredModules().sort(), ['item_m1', 'item_m2'])

  await adopt('item_m2', 'mft_RequirementsAdoptM2')
  assert.deepEqual(offeredModules().sort(), ['item_m1', 'item_m2', 'item_m4'])
})

test('startup and repeated visibility sweeps do not duplicate activation, offers, or todos', async () => {
  const withWorker = harness(baseState())
  await withWorker.port.reconcileVisibleProjects()
  await withWorker.port.reconcileVisibleProjects()
  assert.equal(withWorker.userCommands.filter(({ type }) => type === 'project.transition').length, 1)
  assert.equal(withWorker.commands.filter((command) => command.type === 'task.offer.create').length, 1)
  assert.equal(withWorker.commands.filter((command) => command.type === 'human.needed.create').length, 0)

  const withoutWorker = harness(baseState({ eligibleWorkers: [] }))
  await withoutWorker.port.reconcileVisibleProjects()
  await withoutWorker.port.reconcileVisibleProjects()
  assert.equal(withoutWorker.userCommands.filter(({ type }) => type === 'project.transition').length, 1)
  assert.equal(withoutWorker.commands.filter((command) => command.type === 'task.offer.create').length, 0)
  assert.equal(withoutWorker.commands.filter((command) => command.type === 'human.needed.create').length, 1)
})

test('balances four independent modules across four Workers in one sweep', async () => {
  const confirmedDocument = projectRequirementsDocumentSchema.parse({
    ...document,
    requirementsDocumentId: 'rqd_RequirementsDispatchBalance01',
    workModules: [
      { planItemId: 'item_one', title: 'One', objective: 'One.', dependencyPlanItemIds: [], requiredCapabilityTags: ['qc'] },
      { planItemId: 'item_two', title: 'Two', objective: 'Two.', dependencyPlanItemIds: [], requiredCapabilityTags: ['qc'] },
      { planItemId: 'item_three', title: 'Three', objective: 'Three.', dependencyPlanItemIds: [], requiredCapabilityTags: ['qc'] },
      { planItemId: 'item_four', title: 'Four', objective: 'Four.', dependencyPlanItemIds: [], requiredCapabilityTags: ['qc'] }
    ],
    acceptanceCriteria: []
  })
  const fixture = harness(baseState({
    confirmedDocument,
    eligibleWorkers: [workerUserId, alternateWorkerUserId, thirdWorkerUserId, fourthWorkerUserId]
      .map((userId) => ({ userId, tags: ['qc'], load: 0 }))
  }))
  await fixture.port.reconcileProject(projectId)
  const creations = fixture.commands.filter((command) => command.type === 'task.offer.create')
  assert.equal(creations.length, 4)
  const requirementsCreations = creations.filter((command): command is Extract<typeof command, {
    type: 'task.offer.create'
    requirementsDocumentId: string
  }> => 'requirementsDocumentId' in command)
  assert.equal(requirementsCreations.length, 4)
  assert.deepEqual(
    requirementsCreations.map((command) => command.workerUserId).sort(),
    [workerUserId, alternateWorkerUserId, thirdWorkerUserId, fourthWorkerUserId].sort()
  )
})

test('raises one dedup-keyed worker_missing todo when no Worker is eligible', async () => {
  const { state, commands, port } = harness(baseState({ eligibleWorkers: [] }))
  await port.reconcileProject(projectId)
  await port.reconcileProject(projectId)
  const todos = commands.filter((command) => command.type === 'human.needed.create')
  assert.equal(todos.length, 1)
  const pending = state.pendingHumanNeeded.filter((request) => (
    request.context.scope === 'coordinator_project' &&
    request.context.dedupReason === 'worker_missing'
  ))
  assert.equal(pending.length, 1)
})

test('does not dispatch a module to a Worker who lacks its executable capability tags', async () => {
  const { state, commands, port } = harness(baseState({
    eligibleWorkers: [{ userId: workerUserId, tags: ['agent-runtime.codex'], load: 0 }]
  }))
  await port.reconcileProject(projectId)

  assert.equal(commands.filter((command) => command.type === 'task.offer.create').length, 0)
  assert.equal(state.tasks.length, 0)
  const todos = commands.filter((command) => command.type === 'human.needed.create')
  assert.equal(todos.length, 1)
  const todo = todos[0]!
  assert.equal(
    todo.type === 'human.needed.create' && todo.context.scope === 'coordinator_project'
      ? todo.context.dedupReason
      : undefined,
    'worker_missing'
  )
})

test('worker_missing promotes automatically when an eligible Worker later appears', async () => {
  const fixture = harness(baseState({ eligibleWorkers: [] }))
  await fixture.port.reconcileProject(projectId)
  fixture.state.eligibleWorkers = [{ userId: workerUserId, tags: ['qc'], load: 0 }]

  await fixture.port.reconcileProject(projectId)
  assert.equal(fixture.commands.filter((command) => command.type === 'task.offer.create').length, 1)
  assert.equal(fixture.state.tasks.length, 1)
})

test('repeated sweep after an answered worker_missing todo treats the outbox key as already handled', async () => {
  const fixture = harness(baseState({ eligibleWorkers: [] }))
  await fixture.port.reconcileProject(projectId)
  fixture.state.pendingHumanNeeded[0] = {
    ...fixture.state.pendingHumanNeeded[0]!, status: 'answered'
  }

  await assert.doesNotReject(fixture.port.reconcileProject(projectId))
  assert.equal(fixture.commands.filter((command) => command.type === 'human.needed.create').length, 1)
  assert.equal(fixture.state.pendingHumanNeeded.length, 1)
})

test('single-Worker rejection becomes an Owner todo instead of a same-User re-dispatch', async () => {
  const task = promotedTask(2)
  const { state, commands, port } = harness(baseState({
    status: 'active',
    tasks: [task],
    offers: [terminalOffer(task, workerUserId, 'rejected', 1)]
  }))
  await port.reconcileProject(projectId)
  assert.equal(commands.filter((command) => command.type === 'task.offer.reassign').length, 0)
  const todos = commands.filter((command) => command.type === 'human.needed.create')
  assert.equal(todos.length, 1)
  assert.equal(state.pendingHumanNeeded[0]?.context.scope, 'coordinator_project')
  assert.equal(
    (state.pendingHumanNeeded[0]?.context as { dedupReason?: string }).dedupReason,
    'dispatch_failed'
  )

  state.eligibleWorkers.push({ userId: alternateWorkerUserId, tags: ['qc'], load: 1 })
  await port.reconcileProject(projectId)
  assert.equal(commands.filter((command) => command.type === 'task.offer.reassign').length, 0)
  assert.equal(commands.filter((command) => command.type === 'human.needed.create').length, 1)
})

test('a withdrawn offer after Project pause re-dispatches to the same eligible Worker without a failure', async () => {
  const task = promotedTask(2)
  const { commands, port } = harness(baseState({
    status: 'active',
    eligibleWorkers: [
      { userId: workerUserId, tags: ['qc'], load: 0 },
      { userId: alternateWorkerUserId, tags: ['qc'], load: 1 },
      { userId: thirdWorkerUserId, tags: ['qc'], load: 2 }
    ],
    tasks: [task],
    offers: [terminalOffer(task, workerUserId, 'withdrawn', 1)]
  }))
  await port.reconcileProject(projectId)
  const reassigns = commands.filter((command) => command.type === 'task.offer.reassign')
  assert.equal(reassigns.length, 1)
  assert.equal((reassigns[0] as { workerUserId: string }).workerUserId, workerUserId)
})

for (const hasEligibleMember of [true, false]) {
  test(`a withdrawn Owner offer ${hasEligibleMember ? 're-dispatches to another eligible member' : 'falls back to the eligible Owner when alone'}`, async () => {
    const task = promotedTask(2)
    const { commands, port } = harness(baseState({
      status: 'active',
      eligibleWorkers: [
        { userId: ownerUserId, tags: ['qc'], load: 0 },
        ...(hasEligibleMember ? [{ userId: workerUserId, tags: ['qc'], load: 1 }] : [])
      ],
      tasks: [task],
      offers: [terminalOffer(task, ownerUserId, 'withdrawn', 1)]
    }))
    await port.reconcileProject(projectId)
    const reassigns = commands.filter((command) => command.type === 'task.offer.reassign')
    assert.equal(reassigns.length, 1)
    assert.equal(reassigns[0]?.workerUserId, hasEligibleMember ? workerUserId : ownerUserId)
  })
}

test('a timed-out offer re-dispatches to the next eligible Worker', async () => {
  const task = promotedTask(2)
  const { commands, port } = harness(baseState({
    status: 'active',
    eligibleWorkers: [
      { userId: ownerUserId, tags: ['qc'], load: 0 },
      { userId: workerUserId, tags: ['qc'], load: 0 },
      { userId: alternateWorkerUserId, tags: ['qc'], load: 1 },
      { userId: thirdWorkerUserId, tags: ['qc'], load: 2 }
    ],
    tasks: [task],
    offers: [terminalOffer(task, workerUserId, 'timed_out', 1)]
  }))
  await port.reconcileProject(projectId)
  const reassigns = commands.filter((command) => command.type === 'task.offer.reassign')
  assert.equal(reassigns.length, 1)
  assert.equal((reassigns[0] as { workerUserId: string }).workerUserId, alternateWorkerUserId)
})

test('re-dispatch selects the terminal offer for the current Task revision', async () => {
  const task = promotedTask(3)
  const stale = { ...terminalOffer(task, alternateWorkerUserId, 'withdrawn', 2), reassignmentTaskRevision: 2 }
  const current = terminalOffer(task, workerUserId, 'rejected', 1)
  const { commands, port } = harness(baseState({
    status: 'active',
    eligibleWorkers: [
      { userId: workerUserId, tags: ['qc'], load: 0 },
      { userId: alternateWorkerUserId, tags: ['qc'], load: 1 },
      { userId: thirdWorkerUserId, tags: ['qc'], load: 2 }
    ],
    tasks: [task],
    offers: [current, stale]
  }))
  await port.reconcileProject(projectId)
  const reassign = commands.find((command) => command.type === 'task.offer.reassign')
  assert.equal(reassign?.previousTaskOfferId, current.taskOfferId)
})

test('Cloud close revisions still yield one reassign then one dispatch_failed todo', async () => {
  const task = promotedTask(2)
  const { state, commands, port } = harness(baseState({
    status: 'active',
    eligibleWorkers: [
      { userId: workerUserId, tags: ['qc'], load: 0 },
      { userId: alternateWorkerUserId, tags: ['qc'], load: 1 }
    ],
    tasks: [task],
    offers: [terminalOffer(task, workerUserId, 'rejected', 1)]
  }))
  await port.reconcileProject(projectId)
  const reassigns = commands.filter((command) => command.type === 'task.offer.reassign')
  assert.equal(reassigns.length, 1)
  assert.equal((reassigns[0] as { workerUserId: string }).workerUserId, alternateWorkerUserId)
  assert.equal(commands.filter((command) => command.type === 'human.needed.create').length, 0)

  // Second failure: the alternate's pending offer is rejected too.
  const lastOffer = state.offers.at(-1)!
  const currentTask = state.tasks.find(({ taskId }) => taskId === task.taskId)!
  const closedTask = { ...currentTask, status: 'revision_requested' as const, revision: currentTask.revision + 1 }
  state.tasks[state.tasks.findIndex(({ taskId }) => taskId === task.taskId)] = closedTask
  state.offers[state.offers.length - 1] = {
    ...lastOffer, state: 'rejected', reassignmentTaskRevision: closedTask.revision, respondedAt: updatedAt
  }
  await port.reconcileProject(projectId)
  const todos = commands.filter((command) => command.type === 'human.needed.create')
  assert.equal(todos.length, 1)
  assert.equal(
    (state.pendingHumanNeeded[0]?.context as { dedupReason?: string }).dedupReason,
    'dispatch_failed'
  )
  assert.equal(commands.filter((command) => command.type === 'task.offer.reassign').length, 1)
})

test('Owner takeover ends automatic re-dispatch and answered todos get a fresh idempotency key', async () => {
  const task = promotedTask(2)
  const { state, commands, port } = harness(baseState({
    status: 'active',
    eligibleWorkers: [
      { userId: workerUserId, tags: ['qc'], load: 0 },
      { userId: alternateWorkerUserId, tags: ['qc'], load: 1 },
      { userId: thirdWorkerUserId, tags: ['qc'], load: 2 }
    ],
    tasks: [task],
    offers: [terminalOffer(task, workerUserId, 'rejected', 1)]
  }))

  await port.reconcileProject(projectId)
  const reassigns = commands.filter((command) => command.type === 'task.offer.reassign')
  assert.equal(reassigns.length, 1)

  const reassignedOffer = state.offers.at(-1)!
  const reassignedTask = state.tasks.find(({ taskId }) => taskId === task.taskId)!
  const failedTask = { ...reassignedTask, status: 'revision_requested' as const,
    revision: reassignedTask.revision + 1 }
  state.tasks[state.tasks.findIndex(({ taskId }) => taskId === task.taskId)] = failedTask
  state.offers[state.offers.length - 1] = {
    ...reassignedOffer, state: 'rejected', reassignmentTaskRevision: failedTask.revision,
    respondedAt: updatedAt
  }
  await port.reconcileProject(projectId)
  assert.equal(commands.filter((command) => command.type === 'task.offer.reassign').length, 1)
  assert.equal(state.pendingHumanNeeded.length, 1)

  // The Owner answers the first escalation, then manually assigns a new offer.
  state.pendingHumanNeeded[0] = { ...state.pendingHumanNeeded[0]!, status: 'answered' }
  const manualOffer = terminalOffer(
    { ...failedTask, revision: failedTask.revision + 1 }, thirdWorkerUserId, 'timed_out', 4
  )
  state.tasks[state.tasks.findIndex(({ taskId }) => taskId === task.taskId)] = {
    ...failedTask, status: 'revision_requested', revision: failedTask.revision + 1
  }
  state.offers.push(manualOffer)

  await port.reconcileProject(projectId)
  const todos = commands.filter((command) => command.type === 'human.needed.create')
  assert.equal(commands.filter((command) => command.type === 'task.offer.reassign').length, 1)
  assert.equal(todos.length, 2)
  assert.notEqual(todos[0]!.idempotencyKey, todos[1]!.idempotencyKey)
  assert.equal(state.pendingHumanNeeded[1]?.status, 'pending')
})

test('repeated sweep after an answered dispatch_failed todo does not create another todo without a new failure', async () => {
  const task = promotedTask(3)
  const fixture = harness(baseState({
    status: 'active',
    eligibleWorkers: [{ userId: workerUserId, tags: ['qc'], load: 0 }],
    tasks: [task],
    offers: [
      terminalOffer(task, workerUserId, 'rejected', 1),
      terminalOffer(task, alternateWorkerUserId, 'timed_out', 2)
    ]
  }))
  await fixture.port.reconcileProject(projectId)
  fixture.state.pendingHumanNeeded[0] = {
    ...fixture.state.pendingHumanNeeded[0]!, status: 'answered'
  }

  await assert.doesNotReject(fixture.port.reconcileProject(projectId))
  assert.equal(fixture.commands.filter((command) => command.type === 'human.needed.create').length, 1)
  assert.equal(fixture.state.pendingHumanNeeded.length, 1)
})

test('a withdrawn revision does not change the failure identity or create a new todo', async () => {
  const task = promotedTask(3)
  const fixture = harness(baseState({
    status: 'active',
    eligibleWorkers: [{ userId: workerUserId, tags: ['qc'], load: 0 }],
    tasks: [task],
    offers: [
      terminalOffer(task, workerUserId, 'rejected', 1),
      terminalOffer(task, alternateWorkerUserId, 'timed_out', 2)
    ]
  }))
  await fixture.port.reconcileProject(projectId)
  fixture.state.pendingHumanNeeded[0] = {
    ...fixture.state.pendingHumanNeeded[0]!, status: 'answered'
  }
  const withdrawnTask = { ...task, status: 'revision_requested' as const, revision: task.revision + 1 }
  fixture.state.tasks[0] = withdrawnTask
  fixture.state.offers.push(terminalOffer(withdrawnTask, workerUserId, 'withdrawn', 3))

  await assert.doesNotReject(fixture.port.reconcileProject(projectId))
  assert.equal(fixture.commands.filter((command) => command.type === 'human.needed.create').length, 1)
  assert.equal(fixture.state.pendingHumanNeeded.length, 1)
})

test('repeated consumption of one requirements.confirmed fact converges to one dispatch result', async () => {
  const fixture = harness(baseState())
  const actionPort = createProjectCoordinatorActionPort({
    workspace: { readWorkspace: async () => workspaceFixture(fixture.state) },
    coordinatorCloudCommands: fixture.coordinatorCloudCommands,
    transport: fixture.transport,
    state: new ProjectCoordinatorStateStore({
      read: async () => ({ revision: 0, value: null }),
      write: async (value, expectedRevision) => ({ revision: expectedRevision + 1, value }),
      clear: async (expectedRevision) => ({ revision: expectedRevision + 1, value: null })
    }),
    requirementsDispatch: fixture.port
  })
  const message = (await import('@sciforge/collaboration-contracts')).agentInboxMessageSchema.parse({
    ...(await import('@sciforge/collaboration-contracts/testing')).agentInboxMessageFixture,
    recipientAgentId: coordinatorAgentId,
    payload: {
      protocolVersion: '1.0', type: 'project.requirements.confirmed', projectId,
      requirementsDocumentId: document.requirementsDocumentId,
      documentRevision: document.documentRevision, contentDigest: document.contentDigest
    }
  })
  await actionPort.handleInbox(message)
  await actionPort.handleInbox(message)
  assert.equal(fixture.userCommands.filter(({ type }) => type === 'project.transition').length, 1)
  assert.equal(fixture.commands.filter((command) => command.type === 'task.offer.create').length, 1)
  assert.equal(fixture.state.tasks.length, 1)
  assert.equal(fixture.state.offers.length, 1)
})

test('the requirements.confirmed inbox skips superseded facts but rejects a same-revision mismatch', async () => {
  const { agentInboxMessageSchema } = await import('@sciforge/collaboration-contracts')
  const { agentInboxMessageFixture } = await import('@sciforge/collaboration-contracts/testing')
  const state = baseState()
  const dispatched: string[] = []
  const actionPort = createProjectCoordinatorActionPort({
    workspace: { readWorkspace: async () => workspaceFixture(state) },
    coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      resume: async () => null,
      execute: async () => { throw new Error('Unexpected Coordinator command.') },
      subscribe: () => () => undefined
    },
    transport: {
      stageObject: async () => { throw new Error('Unexpected object staging.') },
      readObject: async () => { throw new Error('Unexpected object read.') },
      status: () => ({
        state: 'ready', baseUrl: 'https://cloud.run0.invalid/',
        userId: ownerUserId, deviceId: 'dev_Owner0000001', deviceRevision: 1
      }),
      execute: async () => { throw new Error('Unexpected User Cloud request.') }
    },
    state: new ProjectCoordinatorStateStore({
      read: async () => ({ revision: 0, value: null }),
      write: async (value, expectedRevision) => ({ revision: expectedRevision + 1, value }),
      clear: async (expectedRevision) => ({ revision: expectedRevision + 1, value: null })
    }),
    requirementsDispatch: {
      reconcileProject: async (projectId: string) => { dispatched.push(projectId) }
    }
  })
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    recipientAgentId: coordinatorAgentId,
    payload: {
      protocolVersion: '1.0',
      type: 'project.requirements.confirmed',
      projectId,
      requirementsDocumentId: document.requirementsDocumentId,
      documentRevision: document.documentRevision,
      contentDigest: document.contentDigest
    }
  })

  await actionPort.handleInbox(message)
  assert.deepEqual(dispatched, [projectId])

  const membershipChanged = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    recipientAgentId: coordinatorAgentId,
    payload: {
      protocolVersion: '1.0',
      type: 'project.membership.changed',
      projectId,
      projectMembershipId: 'pmb_RequirementsDispatch01',
      userId: alternateWorkerUserId,
      state: 'active',
      revision: 2,
      authorityEpoch: 2
    }
  })
  await actionPort.handleInbox(membershipChanged)
  assert.deepEqual(dispatched, [projectId, projectId])

  state.confirmedDocument = projectRequirementsDocumentSchema.parse({
    ...document,
    requirementsDocumentId: 'rqd_RequirementsDispatch02',
    documentRevision: document.documentRevision + 1,
    contentDigest: 'd'.repeat(64)
  })
  // A superseded event is already covered by the fresh newer confirmation and
  // must not block ordered inbox consumption.
  await actionPort.handleInbox(message)
  assert.deepEqual(dispatched, [projectId, projectId])

  // A same-revision fabricated event still rejects: the handler failure keeps
  // the inbox message un-acked so the next pull retries with fresh facts.
  const stale = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    recipientAgentId: coordinatorAgentId,
    payload: {
      protocolVersion: '1.0',
      type: 'project.requirements.confirmed',
      projectId,
      requirementsDocumentId: document.requirementsDocumentId,
      documentRevision: document.documentRevision,
      contentDigest: '0'.repeat(64)
    }
  })
  state.confirmedDocument = document
  await assert.rejects(() => actionPort.handleInbox(stale), /does not match fresh Cloud facts/u)
  assert.deepEqual(dispatched, [projectId, projectId])
})

test('first dispatch re-reads and retries after a revision conflict', async () => {
  const fixture = harness(baseState(), {
    offerCreateErrors: [{ code: 'revision_conflict' }]
  })

  await fixture.port.reconcileProject(projectId)

  const creations = fixture.commands.filter((command) => command.type === 'task.offer.create')
  assert.equal(creations.length, 2)
  assert.equal(fixture.state.tasks.length, 1)
  assert.equal(fixture.state.offers.length, 1)
  assert.equal(fixture.commands.filter((command) => command.type === 'human.needed.create').length, 0)
})

test('first dispatch keeps a retryable Cloud rejection unacknowledged', async () => {
  const fixture = harness(baseState(), {
    offerCreateErrors: [{ code: 'internal_error' }]
  })

  await assert.rejects(
    fixture.port.reconcileProject(projectId),
    /Module promotion failed: internal_error: The Cloud rejected item_qc\./u
  )
  assert.equal(fixture.state.tasks.length, 0)
  assert.equal(fixture.commands.filter((command) => command.type === 'human.needed.create').length, 0)
})

test('first dispatch turns a durable Cloud rejection into one dedup-keyed Owner todo', async () => {
  const fixture = harness(baseState(), {
    offerCreateErrors: [{ code: 'permission_denied' }]
  })

  await fixture.port.reconcileProject(projectId)
  assert.equal(fixture.state.tasks.length, 0)
  const todos = fixture.commands.filter((command) => command.type === 'human.needed.create')
  assert.equal(todos.length, 1)
  assert.equal(
    (fixture.state.pendingHumanNeeded[0]?.context as { dedupReason?: string }).dedupReason,
    'dispatch_failed'
  )
  assert.match(
    (todos[0] as { prompt: string }).prompt,
    /^模块 item_qc 派单被云端拒绝（permission_denied），请人工处理。$/u
  )

  // While the escalation stays pending, the module is not retried and no
  // second todo is created.
  await fixture.port.reconcileProject(projectId)
  assert.equal(fixture.commands.filter((command) => command.type === 'human.needed.create').length, 1)
  assert.equal(fixture.state.tasks.length, 0)
})

type OutboxDispatchOverrides = Readonly<{
  /** The first promotion races another Project revision change. */
  conflictOnce?: boolean
  /** The first promotion gets a retryable Cloud rejection. */
  retryableOnce?: boolean
  /** Cloud commits, then the response is lost before the outbox records it. */
  dropResponseOnce?: boolean
}>

/**
 * Drives the real production DurableCloudOutbox behind the requirements
 * dispatch port. The fake Cloud only replaces the remote service; command
 * identity, durability, replay and cached-response behavior stay real.
 */
async function outboxDispatchHarness(
  initial: FixtureState,
  overrides: OutboxDispatchOverrides = {}
) {
  const state = initial
  const calls: Array<Readonly<{
    idempotencyKey: string
    expectedProjectRevision: number
    offerExpiresAt: string
  }>> = []
  const committed = new Map<string, RestResponse>()
  let conflictPending = overrides.conflictOnce === true
  let retryablePending = overrides.retryableOnce === true
  let dropResponse = overrides.dropResponseOnce === true
  let currentTime = Date.parse('2026-10-17T02:00:00.000Z')
  const now = () => new Date(currentTime)
  const advance = (milliseconds = 1_000) => { currentTime += milliseconds }

  const runtime = createTestAgentCloudRuntime({
    authorityStatus: async (agentId) => ({
      state: 'ready',
      agentId,
      userId: ownerUserId,
      deviceId: 'dev_Owner0000001',
      generation: 1,
      runtimeId: 'codex',
      capabilityTags: ['agent-runtime.codex', 'model-access.api']
    }),
    execute: async (_agentId, rawRequest: RestRequest) => {
      if (rawRequest.type !== 'task.offer.create' || !('requirementsDocumentId' in rawRequest)) {
        throw new Error(`Unexpected Cloud command ${rawRequest.type}.`)
      }
      const request = rawRequest
      calls.push({
        idempotencyKey: request.idempotencyKey,
        expectedProjectRevision: request.expectedProjectRevision,
        offerExpiresAt: request.offerExpiresAt
      })
      const replayed = committed.get(request.idempotencyKey)
      if (replayed) return replayed
      if (conflictPending) {
        conflictPending = false
        state.revision += 1
        return restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.error',
          requestId: request.requestId,
          error: createCollaborationError('revision_conflict', 'Project revision moved.')
        })
      }
      if (retryablePending) {
        retryablePending = false
        return restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.error',
          requestId: request.requestId,
          error: createCollaborationError('internal_error', 'The Cloud is temporarily unavailable.')
        })
      }
      if (request.expectedProjectRevision !== state.revision) {
        return restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.error',
          requestId: request.requestId,
          error: createCollaborationError('revision_conflict', 'Project revision moved.')
        })
      }
      const taskId = canonicalTaskIdForRequirementsModule(
        request.requirementsDocumentId, request.planItemId
      )
      const existingTask = state.tasks.find((candidate) => candidate.taskId === taskId)
      if (existingTask) {
        const existingOffer = state.offers
          .filter((candidate) => candidate.taskId === taskId)
          .sort((left, right) => right.revision - left.revision)[0]
        if (!existingOffer) throw new Error('The canonical Task has no Offer.')
        const response = restResponseSchema.parse({
          protocolVersion: '1.0',
          type: 'rest.collection',
          requestId: request.requestId,
          items: [existingTask, existingOffer]
        })
        committed.set(request.idempotencyKey, response)
        return response
      }
      const at = now().toISOString()
      const task = {
        schemaVersion: 1, revision: 1, createdAt: at, updatedAt: at, type: 'task', taskId,
        projectId, createdByCoordinatorAgentId: coordinatorAgentId,
        title: 'Quality control', objective: 'Run the exact QC pipeline.',
        completionCriteria: ['The QC report exists.'], dependencyTaskIds: [],
        requiredCapabilityTags: ['qc'], fileIntent: null,
        currentExecutionId: null, currentExecutionState: null,
        status: 'offered', executionCount: 0, maxRetries: 2, completedAt: null
      } as unknown as Task
      const offer = {
        schemaVersion: 1, revision: 1, createdAt: at, updatedAt: at, type: 'task_offer',
        taskOfferId: 'ofr_RequirementsDispatch01', projectId, taskId,
        executionId: null, workerUserId: request.workerUserId,
        offeredByCoordinatorAgentId: coordinatorAgentId,
        state: 'pending', reassignmentTaskRevision: null,
        offeredAt: at, expiresAt: request.offerExpiresAt, respondedAt: null
      } as unknown as TaskOffer
      state.tasks.push(task)
      state.offers.push(offer)
      state.revision += 1
      const response = restResponseSchema.parse({
        protocolVersion: '1.0',
        type: 'rest.collection',
        requestId: request.requestId,
        items: [task, offer]
      })
      committed.set(request.idempotencyKey, response)
      if (dropResponse) {
        dropResponse = false
        throw new Error('Cloud committed but the response was lost.')
      }
      return response
    }
  })

  const store = await outboxLocalStore()
  const outbox = new DurableCloudOutbox({
    store,
    agentCloudRuntime: runtime,
    localAgentId: () => coordinatorAgentId,
    now
  })
  outbox.start()

  const coordinatorCloudCommands = {
    localAgentId: () => coordinatorAgentId,
    execute: async (command: CoordinatorCloudCommand) => outbox.enqueueAndWait(
      'coordinator.command',
      coordinatorCloudCommandSchema.parse(command)
    ),
    executeUser: async () => { throw new Error('Unexpected User command.') },
    resume: async () => null,
    resumeUser: async () => null,
    subscribe: () => () => undefined
  }
  const workspace = { readWorkspace: async () => workspaceFixture(state) }
  const transport: AuthenticatedCloudTransport = {
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready', baseUrl: 'https://cloud.run0.invalid/',
      userId: ownerUserId, deviceId: 'dev_Owner0000001', deviceRevision: 1
    }),
    execute: async () => { throw new Error('Unexpected User Cloud request.') }
  }
  const port = createProjectCoordinatorRequirementsDispatchPort({
    workspace,
    coordinatorCloudCommands,
    transport,
    now
  })
  const actions = createProjectCoordinatorActionPort({
    workspace,
    coordinatorCloudCommands,
    transport,
    state: new ProjectCoordinatorStateStore({
      read: async () => ({ revision: 0, value: null }),
      write: async (value, expectedRevision) => ({ revision: expectedRevision + 1, value }),
      clear: async (expectedRevision) => ({ revision: expectedRevision + 1, value: null })
    }),
    requirementsDispatch: port
  })
  const handleInbox = async () => {
    const { agentInboxMessageSchema } = await import('@sciforge/collaboration-contracts')
    const { agentInboxMessageFixture } = await import('@sciforge/collaboration-contracts/testing')
    await actions.handleInbox(agentInboxMessageSchema.parse({
      ...agentInboxMessageFixture,
      recipientAgentId: coordinatorAgentId,
      payload: {
        protocolVersion: '1.0',
        type: 'project.requirements.confirmed',
        projectId,
        requirementsDocumentId: document.requirementsDocumentId,
        documentRevision: document.documentRevision,
        contentDigest: document.contentDigest
      }
    }))
  }
  return { state, calls, store, outbox, port, handleInbox, advance }
}

test('real outbox re-dispatches on fresh facts after revision_conflict and ACKs the confirmation', async () => {
  const fixture = await outboxDispatchHarness(
    baseState({ status: 'active' }),
    { conflictOnce: true }
  )

  await fixture.handleInbox()

  assert.equal(fixture.calls.length, 2)
  assert.notEqual(fixture.calls[0]!.idempotencyKey, fixture.calls[1]!.idempotencyKey)
  assert.deepEqual(
    fixture.calls.map((call) => call.expectedProjectRevision),
    [4, 5]
  )
  assert.equal(fixture.state.tasks.length, 1)
  assert.equal(fixture.state.offers.length, 1)
  assert.deepEqual(
    fixture.store.snapshot().outbox.map((entry) => entry.state),
    ['delivered', 'delivered']
  )
})

test('real outbox retries a retryable Cloud rejection with a new attempt identity', async () => {
  const fixture = await outboxDispatchHarness(
    baseState({ status: 'active' }),
    { retryableOnce: true }
  )

  await assert.rejects(
    fixture.handleInbox(),
    /Module promotion failed: internal_error: The Cloud is temporarily unavailable\./u
  )
  assert.equal(fixture.state.tasks.length, 0)

  fixture.advance()
  await fixture.handleInbox()

  assert.equal(fixture.calls.length, 2)
  assert.notEqual(fixture.calls[0]!.idempotencyKey, fixture.calls[1]!.idempotencyKey)
  assert.equal(fixture.state.tasks.length, 1)
  assert.equal(fixture.state.offers.length, 1)
})

test('replaying one attempt through the real outbox creates no duplicate offer', async () => {
  const fixture = await outboxDispatchHarness(
    baseState({ status: 'active' }),
    { dropResponseOnce: true }
  )

  await assert.rejects(
    fixture.handleInbox(),
    /Cloud committed but the response was lost\./u
  )
  const failed = fixture.store.snapshot().outbox[0]!
  assert.equal(failed.state, 'failed')
  const original = fixture.calls[0]!

  await fixture.outbox.retry(failed.outboxId)
  await fixture.outbox.waitForIdle()

  assert.equal(fixture.store.snapshot().outbox[0]?.state, 'delivered')
  assert.equal(fixture.calls.length, 2)
  assert.equal(fixture.calls[1]!.idempotencyKey, original.idempotencyKey)
  assert.equal(fixture.calls[1]!.offerExpiresAt, original.offerExpiresAt)
  assert.equal(fixture.state.tasks.length, 1)
  assert.equal(fixture.state.offers.length, 1)

  await fixture.handleInbox()
  assert.equal(fixture.calls.length, 2)
  assert.equal(fixture.state.tasks.length, 1)
  assert.equal(fixture.state.offers.length, 1)
})

class OutboxMemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}

async function outboxLocalStore(): Promise<CollaborationLocalStore> {
  const store = new CollaborationLocalStore(
    new OutboxMemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
  )
  await store.open()
  return store
}
