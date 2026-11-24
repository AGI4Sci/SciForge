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
  mode?: 'manual' | 'ai_leader'
  grant?: ProjectCoordinatorProject['project']['dispatchAuthorization']
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
      status: state.status, executionMode: state.mode ?? 'manual', dispatchAuthorization: state.grant ?? null,
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
    lookupDocumentShare: async () => { throw new Error('Document sharing is not used by this fixture.') },
    createDocumentShare: async () => { throw new Error('Document sharing is not used by this fixture.') },
    revokeDocumentShare: async () => { throw new Error('Document sharing is not used by this fixture.') },
    readDocumentComments: async () => { throw new Error('Document sharing is not used by this fixture.') },
    mutateDocumentComments: async () => { throw new Error('Document sharing is not used by this fixture.') },
    listCloudSpaces: async () => { throw new Error('Cloud space operations are not used by this fixture.') },
    ensureCloudSpace: async () => { throw new Error('Cloud space operations are not used by this fixture.') },
    createCloudSpaceSession: async () => { throw new Error('Cloud space operations are not used by this fixture.') },
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
    transport, now: () => new Date(updatedAt)
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


const grant = { requirementsDocumentId: document.requirementsDocumentId, requirementsDocumentRevision: document.documentRevision,
  requirementsContentDigest: document.contentDigest, assignments: [{ planItemId: 'item_qc', workerUserId }],
  expiresAt: '2026-10-18T00:00:00.000Z', approvedByUserId: ownerUserId, approvedAt: updatedAt,
  coordinatorAuthorityEpoch: 1, executionAuthorityEpoch: 1 }

test('manual mode performs no background writes, even with an old grant', async () => {
  const fixture = harness(baseState({ grant }))
  await fixture.port.reconcileVisibleProjects()
  await fixture.port.reconcileProject(projectId)
  assert.equal(fixture.commands.length, 0)
  assert.equal(fixture.userCommands.length, 0)
})

for (const invalid of [null, { ...grant, expiresAt: createdAt }, { ...grant, requirementsContentDigest: 'd'.repeat(64) },
  { ...grant, executionAuthorityEpoch: 2 }, { ...grant, approvedByUserId: alternateWorkerUserId }]) {
  test(`AI leader does not dispatch absent or stale authorization ${JSON.stringify(invalid)}`, async () => {
    const fixture = harness(baseState({ mode: 'ai_leader', grant: invalid }))
    await fixture.port.reconcileProject(projectId)
    assert.equal(fixture.commands.length, 0)
    assert.equal(fixture.userCommands.length, 0)
  })
}

test('approved batch activates and creates exact offer once across repeated sweeps', async () => {
  const fixture = harness(baseState({ mode: 'ai_leader', grant }))
  await fixture.port.reconcileProject(projectId)
  await fixture.port.reconcileVisibleProjects()
  assert.deepEqual(fixture.userCommands, [{ type: 'project.transition', status: 'active' }])
  const commands = fixture.commands.filter(command => command.type === 'task.offer.create')
  assert.equal(commands.length, 1)
  assert.equal(commands[0]!.workerUserId, workerUserId)
})

test('rejected offer never automatically reassigns an existing task', async () => {
  const task = promotedTask()
  const fixture = harness(baseState({ status: 'active', mode: 'ai_leader', grant, tasks: [task],
    offers: [terminalOffer(task, workerUserId, 'rejected', 2)] }))
  await fixture.port.reconcileProject(projectId)
  assert.equal(fixture.commands.length, 0)
})

test('pending membership postpones approved dispatch', async () => {
  const fixture = harness(baseState({ mode: 'ai_leader', grant, invitedMember: true }))
  await fixture.port.reconcileProject(projectId)
  assert.equal(fixture.commands.length, 0)
  assert.equal(fixture.userCommands.length, 0)
})
