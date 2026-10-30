import assert from 'node:assert/strict'
import test from 'node:test'
import { collaborationActivationSchema } from '../contract.js'

import {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  projectCoordinatorActivationAcknowledgeInputSchema,
  projectCoordinatorMembershipAddInputSchema,
  projectCoordinatorMembershipRemoveInputSchema,
  projectCoordinatorProjectCreateResultSchema,
  projectCoordinatorProjectDeleteInputSchema,
  projectCoordinatorSessionProjectionSchema,
  projectCoordinatorTaskOfferReassignInputSchema,
  projectCoordinatorTransferInputSchema,
  projectCoordinatorWorkspaceSchema
} from './contract.js'

const createdAt = '2026-08-24T08:00:00.000Z'
const updatedAt = '2026-08-24T09:00:00.000Z'

test('Session projection v2 requires an explicit suppression fence set', () => {
  const session = {
    runtimeId: 'runtime-contract-session',
    threadId: 'thread-contract-session'
  }
  const projection = {
    schemaVersion: 2,
    observedAt: updatedAt,
    bindings: [],
    suppressedSessions: [],
    pendingActivations: []
  }
  assert.equal(projectCoordinatorSessionProjectionSchema.safeParse(projection).success, true)
  assert.equal(projectCoordinatorSessionProjectionSchema.safeParse({
    ...projection,
    schemaVersion: 1
  }).success, false)
  const { suppressedSessions: _omitted, ...withoutSuppressionFenceSet } = projection
  assert.equal(projectCoordinatorSessionProjectionSchema.safeParse(
    withoutSuppressionFenceSet
  ).success, false)
  assert.equal(projectCoordinatorSessionProjectionSchema.safeParse({
    ...projection,
    bindings: [{
      schemaVersion: 1,
      role: 'coordinator',
      projectId: 'prj_Project000001',
      principalUserId: 'usr_Owner0000001',
      coordinatorAgentId: 'agt_Coordinator01',
      coordinatorAuthorityEpoch: 2,
      ...session,
      boundAt: updatedAt,
      access: 'coordinator',
      fenceReason: null
    }],
    suppressedSessions: [session]
  }).success, false)
})

const fixture = {
  connection: {
    state: 'ready' as const,
    userId: 'usr_Owner0000001',
    deviceId: 'dev_Device0000001',
    localAgentId: 'agt_Coordinator01'
  },
  observedAt: updatedAt,
  focusedProjectId: 'prj_Project000001',
  availableWorkerUsers: [],
  projects: [{
    project: {
      schemaVersion: 1 as const,
      revision: 3,
      createdAt,
      updatedAt,
      type: 'project' as const,
      projectId: 'prj_Project000001',
      ownerUserId: 'usr_Owner0000001',
      displayName: 'Multi-user review',
      goal: 'Review a synthetic collaboration design.',
      coordinatorAgentId: 'agt_Coordinator01',
      coordinatorAuthorityEpoch: 2,
      executionAuthorityEpoch: 2,
      status: 'active' as const,
      budget: {
        maxTasks: 12,
        maxTasksPerRound: 4,
        maxCoordinationRounds: 4,
        maxTaskRetries: 2
      }
    },
    plan: {
      plan: {
        schemaVersion: 1 as const,
        revision: 2,
        createdAt,
        updatedAt,
        type: 'project_plan' as const,
        projectPlanId: 'pln_ProjectPlan01',
        projectId: 'prj_Project000001',
        state: 'awaiting_confirmation' as const,
        planRevision: 1,
        sourceInputLocators: [],
        tasks: [{
          workerUserId: 'usr_Worker000001',
          planItemId: 'item_architecture01',
          title: 'Architecture review',
          objective: 'Review the proposed boundaries.',
          completionCriteria: ['One bounded report is submitted.'],
          dependencyPlanItemIds: [],
          requiredCapabilityTags: ['document.review'],
          fileIntent: null
        }],
        rationale: 'The work is independent and bounded.',
        runtimeProvenance: {
          runtimeId: 'codex-runtime',
          modelId: 'configured-model',
          generatedByCoordinatorAgentId: 'agt_Coordinator01',
          generatedAt: '2026-08-24T08:55:00.000Z'
        },
        planDigest: '0'.repeat(64),
        submittedAt: '2026-08-24T08:56:00.000Z',
        confirmedByUserId: null,
        confirmedAt: null,
        supersededAt: null
      }
    },
    memberUsers: [],
    workerGroups: [{
      userId: 'usr_Worker000001',
      displayName: 'Worker User',
      agents: [{
        displayName: 'Worker Desktop A',
        projectAvailability: {
          schemaVersion: 1 as const,
          type: 'project_worker_availability_view' as const,
          projectId: 'prj_Project000001',
          userId: 'usr_Worker000001',
          agentId: 'agt_WorkerAgent001',
          revision: 7,
          availability: {
            schemaVersion: 1 as const,
            revision: 7,
            createdAt,
            updatedAt,
            type: 'worker_availability_projection' as const,
            userId: 'usr_Worker000001',
            agentId: 'agt_WorkerAgent001',
            deviceId: 'dev_WorkerDevice01',
            agentActive: true,
            deviceActive: true,
            connectionStatus: 'online' as const,
            lastHeartbeatAt: '2026-08-24T08:59:58.000Z',
            runtimeReadiness: 'ready' as const,
            runtimeCapabilityTags: ['document.review'],
            acceptsNewOffers: true,
            activeTaskCount: 0,
            observedAt: '2026-08-24T08:59:59.000Z',
            expiresAt: '2026-08-24T09:01:59.000Z'
          },
          membership: null,
          taskAuthorities: [],
          observedAt: '2026-08-24T08:59:59.000Z'
        }
      }, {
        displayName: 'Worker Desktop B',
        projectAvailability: {
          schemaVersion: 1 as const,
          type: 'project_worker_availability_view' as const,
          projectId: 'prj_Project000001',
          userId: 'usr_Worker000001',
          agentId: 'agt_WorkerAgent002',
          revision: 4,
          availability: {
            schemaVersion: 1 as const,
            revision: 4,
            createdAt,
            updatedAt,
            type: 'worker_availability_projection' as const,
            userId: 'usr_Worker000001',
            agentId: 'agt_WorkerAgent002',
            deviceId: 'dev_WorkerDevice02',
            agentActive: true,
            deviceActive: true,
            connectionStatus: 'offline' as const,
            lastHeartbeatAt: null,
            runtimeReadiness: 'ready' as const,
            runtimeCapabilityTags: ['document.review'],
            acceptsNewOffers: false,
            activeTaskCount: 1,
            observedAt: '2026-08-24T08:58:00.000Z',
            expiresAt: '2026-08-24T09:00:30.000Z'
          },
          membership: null,
          taskAuthorities: [],
          observedAt: '2026-08-24T08:58:00.000Z'
        }
      }]
    }],
    tasks: [],
    offers: [],
    pendingHumanNeeded: [],
    records: [],
    finalSummary: null,
    memberships: [],
      legacyHistory: { readOnly: true as const, plans: [], tasks: [], executions: [] },
      deliveryDrive: null
  }]
}

test('workspace composes canonical Cloud facts while selecting a Worker User from grouped runtime evidence', () => {
  const parsed = projectCoordinatorWorkspaceSchema.parse(fixture)
  assert.equal(parsed.connection.state === 'ready' && parsed.connection.localAgentId,
    'agt_Coordinator01')
  assert.equal(parsed.projects[0]?.workerGroups[0]?.agents.length, 2)
  assert.equal(
    parsed.projects[0]?.plan?.plan.tasks[0]?.workerUserId,
    'usr_Worker000001'
  )
  assert.equal(parsed.projects[0]?.plan?.plan.type, 'project_plan')
})

test('workspace retains a Cloud Plan assignment when the Worker has no current availability row', () => {
  const offline = structuredClone(fixture)
  offline.projects[0]!.workerGroups = []
  const parsed = projectCoordinatorWorkspaceSchema.parse(offline)
  assert.equal(parsed.projects[0]!.plan!.plan.tasks[0]!.workerUserId, 'usr_Worker000001')
})

test('unavailable state cannot claim Project data or secret material', () => {
  assert.throws(() => projectCoordinatorWorkspaceSchema.parse({
    ...fixture,
    connection: { state: 'identity_required' }
  }), /cannot claim Project data/u)
  assert.throws(() => projectCoordinatorWorkspaceSchema.parse({
    ...fixture,
    connection: {
      state: 'ready',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001',
      accessToken: 'forbidden'
    }
  }))
})

test('the one Collaboration activation accepts only an exact Project focus and a shell route', () => {
  assert.deepEqual(collaborationActivationSchema.parse({
    projectId: 'prj_Project000001',
    route: 'members',
    view: 'gantt'
  }), { projectId: 'prj_Project000001', route: 'members', view: 'gantt' })
  assert.deepEqual(collaborationActivationSchema.parse({ route: 'create' }), { route: 'create' })
  assert.throws(() => collaborationActivationSchema.parse({
    projectId: 'prj_Project000001',
    latest: true
  }))
  assert.throws(() => collaborationActivationSchema.parse({ route: 'tasks' }))
  assert.throws(() => collaborationActivationSchema.parse({ view: 'admin' }))
})

test('Project create result binds one fresh ordinary Session and explicit UI activation', () => {
  const result = {
    createIntentId: 'pct_ProjectCreate001',
    createdProjectId: 'prj_Project000001',
    workspace: fixture,
    coordinatorSession: {
      projectId: 'prj_Project000001',
      runtimeId: 'codex-runtime',
      threadId: 'thread-project-create-1'
    },
    activationRequestId: 'pca_Activation0001'
  }
  const parsed = projectCoordinatorProjectCreateResultSchema.parse(result)
  assert.equal(parsed.createdProjectId, result.createdProjectId)
  assert.deepEqual(parsed.coordinatorSession, result.coordinatorSession)
  assert.equal(parsed.activationRequestId, result.activationRequestId)
  assert.deepEqual(projectCoordinatorActivationAcknowledgeInputSchema.parse({
    activationRequestId: result.activationRequestId
  }), {
    activationRequestId: result.activationRequestId
  })
  assert.throws(() => projectCoordinatorProjectCreateResultSchema.parse({
    ...result,
    coordinatorSession: {
      ...result.coordinatorSession,
      projectId: 'prj_OtherProject001'
    }
  }), /bind the exact new Project/u)
})

test('Project delete HCI selects only one Project identity and cannot claim Cloud authority facts', () => {
  const input = { projectId: 'prj_Project000001' }
  assert.deepEqual(projectCoordinatorProjectDeleteInputSchema.parse(input), input)
  for (const callerClaim of [
    { ownerUserId: 'usr_Owner0000001' },
    { expectedRevision: 3 },
    { expectedCoordinatorAuthorityEpoch: 2 },
    { expectedExecutionAuthorityEpoch: 2 }
  ]) {
    assert.throws(() => projectCoordinatorProjectDeleteInputSchema.parse({
      ...input,
      ...callerClaim
    }))
  }
  assert.equal(
    PROJECT_COORDINATOR_CAPABILITY_IDS.projectDelete,
    'collaboration.project.delete'
  )
})

test('Coordinator transfer HCI selects only a successor identity and cannot claim Cloud authority facts', () => {
  const input = {
    projectId: 'prj_Project000001',
    coordinatorAgentId: 'agt_OwnerSuccessor1'
  }
  assert.deepEqual(projectCoordinatorTransferInputSchema.parse(input), input)
  for (const callerClaim of [
    { expectedRevision: 3 },
    { expectedCoordinatorAuthorityEpoch: 2 },
    { expectedCoordinatorAvailabilityRevision: 7 },
    { ownerUserId: 'usr_Owner0000001' }
  ]) {
    assert.throws(() => projectCoordinatorTransferInputSchema.parse({ ...input, ...callerClaim }))
  }
  assert.equal(
    PROJECT_COORDINATOR_CAPABILITY_IDS.coordinatorTransfer,
    'collaboration.coordinator.transfer'
  )
})

test('dynamic member writes carry exact Cloud identities and never Provider credentials', () => {
  const add = {
    projectId: 'prj_Project000001',
    expectedProjectRevision: 3,
    userId: 'usr_Worker000001',
  }
  assert.deepEqual(projectCoordinatorMembershipAddInputSchema.parse(add), add)
  assert.throws(() => projectCoordinatorMembershipAddInputSchema.parse({
    ...add,
    providerToken: 'forbidden'
  }))
  const remove = {
    projectId: 'prj_Project000001',
    projectMembershipId: 'pmb_WorkerMember01',
    expectedProjectRevision: 4,
    expectedMembershipRevision: 2
  }
  assert.deepEqual(projectCoordinatorMembershipRemoveInputSchema.parse(remove), remove)
  assert.throws(() => projectCoordinatorMembershipRemoveInputSchema.parse({
    ...remove,
    providerPrincipalId: 'caller-must-not-supply'
  }))
})

test('Task offer reassignment is the only successor-offer capability', () => {
  const reassign = {
    projectId: 'prj_Project000001',
    taskId: 'tsk_RecoveryTask001',
    previousTaskOfferId: 'ofr_RecoveryOffer001',
    workerUserId: 'usr_Worker000001',
    nextOutputFileName: 'architecture-review.recovery-2.md',
    offerExpiresAt: '2026-08-27T09:00:00.000Z'
  }
  assert.deepEqual(projectCoordinatorTaskOfferReassignInputSchema.parse(reassign), reassign)
  const { nextOutputFileName: _omittedOutputFileName, ...textReassign } = reassign
  assert.deepEqual(
    projectCoordinatorTaskOfferReassignInputSchema.parse(textReassign),
    textReassign
  )
  assert.equal(
    'nextOutputFileName' in projectCoordinatorTaskOfferReassignInputSchema.parse(textReassign),
    false
  )
  assert.throws(() => projectCoordinatorTaskOfferReassignInputSchema.parse({
    ...reassign,
    recoveryActionId: 'rca_TaskRecovery001'
  }))
  assert.throws(() => projectCoordinatorTaskOfferReassignInputSchema.parse({
    ...reassign,
    previousExecutionId: 'exe_CallerChosen001'
  }))
  assert.throws(() => projectCoordinatorTaskOfferReassignInputSchema.parse({
    ...reassign,
    expectedTaskRevision: 7
  }))
  assert.equal(
    PROJECT_COORDINATOR_CAPABILITY_IDS.taskOfferReassign,
    'collaboration.task-offer.reassign'
  )
  assert.deepEqual(
    Object.values(PROJECT_COORDINATOR_CAPABILITY_IDS).filter((id) => id.includes('reassign')),
    ['collaboration.task-offer.reassign']
  )
})
