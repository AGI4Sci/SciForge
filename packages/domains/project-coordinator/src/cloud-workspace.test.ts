import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AuthenticatedCloudRequest,
  AuthenticatedCloudResponse,
  AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  TEST_IDS,
  humanNeededFixture,
  projectRecordFixture
} from '@sciforge/collaboration-contracts/testing'
import type { CoordinatorCloudCommand } from '@sciforge/domain-collaboration/coordinator-cloud-command'

import {
  createProjectCoordinatorCloudWorkspacePort
} from './ports.js'

const createdAt = '2026-08-25T01:00:00.000Z'
const updatedAt = '2026-08-25T01:05:00.000Z'

test('current Device Agent Project create returns a workspace focused on the exact new Project after paginated Cloud reads', async () => {
  const requests: AuthenticatedCloudRequest[] = []
  const coordinatorRequests: CoordinatorCloudCommand[] = []
  const project = projectFixture('prj_ProjectCreated01', 'Created meeting')
  const existing = projectFixture('prj_ProjectExisting1', 'Existing meeting')
  const responses = [
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_page',
      requestId: 'req_ListProjects00001',
      limit: 250,
      projects: [existing],
      nextCursor: 'cursor-project-page-2',
      observedAt: updatedAt
    }),
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_page',
      requestId: 'req_ListProjects00002',
      cursor: 'cursor-project-page-2',
      limit: 250,
      projects: [project],
      observedAt: updatedAt
    }),
    emptyWorkerDirectoryResponse('req_ListWorkers00001'),
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_coordination',
      requestId: 'req_ReadProject00001',
      project,
      observedAt: updatedAt,
      pages: [{
        collection: 'user_label_facts',
        limit: 250,
        items: [userLabelFixture('usr_Owner0000001', 'Owner')],
        nextCursor: 'cursor-user-page-2'
      }],
      finalSummary: null
    }),
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_coordination',
      requestId: 'req_ReadProject00002',
      project,
      observedAt: updatedAt,
      pages: [{
        collection: 'user_label_facts',
        cursor: 'cursor-user-page-2',
        limit: 250,
        items: [userLabelFixture('usr_Worker000001', 'Worker')]
      }],
      finalSummary: null
    })
  ]
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001'
    }),
    execute: async (request) => {
      requests.push(request)
      const next = responses.shift()
      if (!next) throw new Error('Unexpected Cloud request.')
      return next
    }
  }
  let requestOrdinal = 0
  const port = createProjectCoordinatorCloudWorkspacePort({
    transport,
    coordinatorCloudCommands: {
      execute: async (command) => {
        coordinatorRequests.push(command)
        return response(200, {
          protocolVersion: '1.0',
          type: 'rest.project_created',
          requestId: command.requestId,
          project,
          memberships: [membershipFixture(project.projectId)],
          provisioningIntent: null
        }).body
      },
      subscribe: () => () => undefined
    },
    requestId: () => `req_TracerRequest${String(++requestOrdinal).padStart(4, '0')}`
  })

  const result = await port.createProject({
    displayName: 'Created meeting',
    goal: 'Run one realistic multi-user meeting.',
    budget: {
      maxTasks: 8,
      maxTasksPerRound: 4,
      maxTaskRetries: 2,
      maxCoordinationRounds: 3
    },
    content: {
      mode: 'none',
      members: [
        { userId: 'usr_Owner0000001' },
        { userId: 'usr_Worker000001' }
      ]
    }
  }, 'idem_CreateProjectTracer01')

  assert.equal(result.createdProjectId, project.projectId)
  assert.equal(result.workspace.focusedProjectId, project.projectId)
  assert.deepEqual(result.workspace.projects[1]?.memberUsers.map(({ userId }) => userId), [
    'usr_Owner0000001',
    'usr_Worker000001'
  ])
  assert.deepEqual(
    result.workspace.projects.map(({ project }) => project.projectId),
    [existing.projectId, project.projectId]
  )
  assert.deepEqual(
    requests.map(({ payload }) => payload.type),
    [
      'project.list',
      'project.list',
      'worker.availability.list',
      'project.coordination.read',
      'project.coordination.read'
    ]
  )
  assert.deepEqual(coordinatorRequests, [{
    protocolVersion: '1.0',
    requestId: 'req_TracerRequest0001',
    type: 'project.create',
    idempotencyKey: 'idem_CreateProjectTracer01',
    displayName: 'Created meeting',
    goal: 'Run one realistic multi-user meeting.',
    budget: {
      maxTasks: 8,
      maxTasksPerRound: 4,
      maxTaskRetries: 2,
      maxCoordinationRounds: 3
    },
    content: {
      mode: 'none',
      members: [
        { userId: 'usr_Owner0000001' },
        { userId: 'usr_Worker000001' }
      ]
    }
  }])
  assert.deepEqual(
    requests.slice(3).map(({ payload }) => (
      payload.type === 'project.coordination.read' ? payload.collections : []
    )),
    [
      expectProjectCollections(),
      [{ collection: 'user_label_facts', cursor: 'cursor-user-page-2', limit: 250 }]
    ]
  )
})

test('Agent-authored Project create rejects a Cloud response that changes the creator Owner', async () => {
  const project = {
    ...projectFixture('prj_ProjectWrongOwner1', 'Wrong owner'),
    ownerUserId: 'usr_OtherOwner0001'
  }
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001'
    }),
    execute: async () => { throw new Error('User transport must not create Projects.') }
  }

  await assert.rejects(
    createProjectCoordinatorCloudWorkspacePort({
      transport,
      coordinatorCloudCommands: {
        execute: async (command) => response(200, {
          protocolVersion: '1.0',
          type: 'rest.project_created',
          requestId: command.requestId,
          project,
          memberships: [membershipFixture(project.projectId)],
          provisioningIntent: null
        }).body,
        subscribe: () => () => undefined
      }
    }).createProject({
      displayName: project.displayName,
      goal: project.goal,
      budget: project.budget,
      content: {
        mode: 'none',
        members: [{ userId: 'usr_Owner0000001' }]
      }
    }, `idem_${project.projectId}`),
    /current Agent owner authority/
  )
})

test('Cloud-global online Worker Users stay visible outside current Project membership with grouped Agent evidence', async () => {
  const project = projectFixture('prj_ProjectCreated01', 'Created meeting')
  const responses = [
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_page',
      requestId: 'req_ListCandidates001',
      limit: 250,
      projects: [project],
      observedAt: updatedAt
    }),
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.worker_availability_page',
      requestId: 'req_ListGlobalWorkers1',
      observedAt: updatedAt,
      items: [
        availabilityFixture('agt_WorkerAgent001', true, 7),
        availabilityFixture('agt_WorkerAgent002', false, 8)
      ],
      userLabels: [{
        userId: 'usr_Worker000001',
        displayName: 'Worker User',
        status: 'active',
        revision: 1
      }],
      agentLabels: [{
        agentId: 'agt_WorkerAgent001',
        ownerUserId: 'usr_Worker000001',
        deviceId: 'dev_WorkerDevice01',
        displayName: 'Worker Desktop A',
        nodeType: 'desktop',
        lifecycleStatus: 'active',
        revision: 1
      }, {
        agentId: 'agt_WorkerAgent002',
        ownerUserId: 'usr_Worker000001',
        deviceId: 'dev_WorkerDevice02',
        displayName: 'Worker Desktop B',
        nodeType: 'desktop',
        lifecycleStatus: 'active',
        revision: 1
      }]
    }),
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_coordination',
      requestId: 'req_ReadCandidates001',
      project,
      observedAt: updatedAt,
      pages: [{
        collection: 'memberships',
        limit: 250,
        items: []
      }],
      finalSummary: null
    })
  ]
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001'
    }),
    execute: async () => {
      const next = responses.shift()
      if (!next) throw new Error('Unexpected Cloud request.')
      return next
    }
  }
  let requestOrdinal = 0
  const port = createProjectCoordinatorCloudWorkspacePort({
    transport,
    requestId: () => `req_CandidateRead${String(++requestOrdinal).padStart(4, '0')}`
  })

  const workspace = await port.readWorkspace({ projectId: project.projectId })

  assert.deepEqual(workspace.availableWorkerUsers, [{
    userId: 'usr_Worker000001',
    displayName: 'Worker User'
  }])
  assert.deepEqual(workspace.projects[0]?.workerGroups.map((group) => ({
    userId: group.userId,
    displayName: group.displayName,
    agents: group.agents.map(({ displayName, projectAvailability }) => ({
      displayName,
      agentId: projectAvailability.agentId,
      membership: projectAvailability.membership,
      acceptsNewOffers: projectAvailability.availability.acceptsNewOffers
    }))
  })), [{
    userId: 'usr_Worker000001',
    displayName: 'Worker User',
    agents: [{
      displayName: 'Worker Desktop A',
      agentId: 'agt_WorkerAgent001',
      membership: null,
      acceptsNewOffers: true
    }, {
      displayName: 'Worker Desktop B',
      agentId: 'agt_WorkerAgent002',
      membership: null,
      acceptsNewOffers: false
    }]
  }])
})

test('Project read selects the one non-superseded Plan instead of relying on page order', async () => {
  const project = projectFixture('prj_ProjectCreated01', 'Created meeting')
  const currentPlan = planFixture({
    projectPlanId: 'pln_CurrentMeeting01',
    state: 'awaiting_confirmation',
    planRevision: 2
  })
  const supersededPlan = planFixture({
    projectPlanId: 'pln_OldMeetingPlan01',
    state: 'superseded',
    planRevision: 1
  })
  const responses = [
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_page',
      requestId: 'req_ListPlans0000001',
      limit: 250,
      projects: [project],
      observedAt: updatedAt
    }),
    emptyWorkerDirectoryResponse('req_ListHumanWorkers1'),
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_coordination',
      requestId: 'req_ReadPlans0000001',
      project,
      observedAt: updatedAt,
      pages: [{
        collection: 'plans',
        limit: 250,
        items: [currentPlan, supersededPlan]
      }],
      finalSummary: null
    })
  ]
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001'
    }),
    execute: async () => {
      const next = responses.shift()
      if (!next) throw new Error('Unexpected Cloud request.')
      return next
    }
  }
  let requestOrdinal = 0
  const port = createProjectCoordinatorCloudWorkspacePort({
    transport,
    requestId: () => `req_CurrentPlan${String(++requestOrdinal).padStart(4, '0')}`
  })

  const workspace = await port.readWorkspace({ projectId: project.projectId })

  assert.equal(workspace.projects[0]?.plan?.plan.projectPlanId, currentPlan.projectPlanId)
})

test('Project read projects pending member-targeted HumanNeeded and accepted Coordinator decisions', async () => {
  const project = {
    ...projectFixture('prj_ProjectCreated01', 'Created meeting'),
    status: 'active' as const
  }
  const humanNeeded = {
    ...humanNeededFixture,
    projectId: project.projectId,
    context: {
      scope: 'coordinator_project' as const,
      coordinatorAuthorityEpoch: project.coordinatorAuthorityEpoch
    },
    targetUserId: project.ownerUserId,
    requestedByAgentId: project.coordinatorAgentId
  }
  const decision = {
    ...projectRecordFixture,
    projectId: project.projectId,
    kind: 'decision' as const,
    body: 'Proceed with the Owner-confirmed direction.',
    authorUserId: project.ownerUserId,
    authorAgentId: project.coordinatorAgentId,
    sourceTaskId: null,
    sourceResultSubmissionId: null,
    sourceHumanAnswerId: TEST_IDS.humanAnswerId,
    acceptedByUserId: project.ownerUserId,
    acceptedByAgentId: project.coordinatorAgentId
  }
  const responses = [
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_page',
      requestId: 'req_ListHumanFacts01',
      limit: 250,
      projects: [project],
      observedAt: updatedAt
    }),
    emptyWorkerDirectoryResponse('req_ListContentWorkers'),
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_coordination',
      requestId: 'req_ReadHumanFacts01',
      project,
      observedAt: updatedAt,
      pages: [{
        collection: 'user_label_facts',
        limit: 250,
        items: [userLabelFixture(project.ownerUserId, 'Project Owner')]
      }, {
        collection: 'pending_human_needed',
        limit: 250,
        items: [humanNeeded]
      }, {
        collection: 'project_records',
        limit: 250,
        items: [decision]
      }],
      finalSummary: null
    })
  ]
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: project.ownerUserId,
      deviceId: 'dev_Device0000001'
    }),
    execute: async () => {
      const next = responses.shift()
      if (!next) throw new Error('Unexpected Cloud request.')
      return next
    }
  }
  const port = createProjectCoordinatorCloudWorkspacePort({ transport })

  const workspace = await port.readWorkspace({ projectId: project.projectId })
  const projected = workspace.projects[0] as unknown as Record<string, unknown>

  assert.deepEqual(projected.pendingHumanNeeded, [humanNeeded])
  assert.deepEqual(projected.records, [decision])
})

test('Project read keeps membership, Provider observation, readiness, and recovery as independent facts', async () => {
  const project = {
    ...projectFixture('prj_ProjectCreated01', 'Content meeting'),
    contentMode: 'required' as const
  }
  const providerInstance = {
    schemaVersion: 1 as const,
    type: 'provider_instance_reference' as const,
    providerInstanceRef: 'opencontent.run0'
  }
  const providerPrincipal = {
    schemaVersion: 1 as const,
    type: 'provider_directory_principal_reference' as const,
    providerInstance,
    principalKind: 'user' as const,
    principalId: 'principal-owner'
  }
  const membership = membershipFixture(project.projectId)
  const principalFact = {
    schemaVersion: 1 as const,
    type: 'provider_directory_principal_fact' as const,
    providerPrincipalFactId: 'ppf_OwnerFact00001',
    userId: project.ownerUserId,
    providerPrincipal,
    principalIdentityRevision: 1,
    providerBindingAttestationDigest: 'a'.repeat(64),
    publishedByDeviceId: 'dev_Device0000001',
    readiness: 'ready' as const,
    readinessReason: null,
    observedAt: updatedAt,
    revision: 1,
    createdAt,
    updatedAt
  }
  const observation = {
    schemaVersion: 1 as const,
    type: 'project_provider_membership_observation' as const,
    providerObservationId: 'pob_OwnerObserve001',
    projectId: project.projectId,
    userId: project.ownerUserId,
    providerPrincipalFactId: principalFact.providerPrincipalFactId,
    snapshottedFactRevision: principalFact.revision,
    providerPrincipal,
    bindingRevision: 1,
    provisioningRevision: 2,
    source: 'explicit_reconcile' as const,
    outcome: 'present' as const,
    observerUserId: project.ownerUserId,
    observerDeviceId: 'dev_Device0000001',
    observerAgentId: null,
    provisioningAttestationId: null,
    evidenceDigest: 'b'.repeat(64),
    observedAt: updatedAt,
    revision: 1,
    createdAt,
    updatedAt
  }
  const readiness = {
    schemaVersion: 1 as const,
    type: 'project_content_readiness' as const,
    projectId: project.projectId,
    userId: project.ownerUserId,
    providerInstance,
    state: 'ready' as const,
    reason: null,
    providerPrincipalFactId: principalFact.providerPrincipalFactId,
    snapshottedFactRevision: principalFact.revision,
    providerPrincipal,
    bindingRevision: 1,
    lastObservationId: observation.providerObservationId,
    effectiveAt: updatedAt,
    revision: 2,
    createdAt,
    updatedAt
  }
  const journal = {
    schemaVersion: 1 as const,
    type: 'external_operation_recovery_journal_entry' as const,
    contentRecoveryJournalEntryId: 'crj_OwnerRootLoss01',
    scope: 'project_provisioning' as const,
    projectId: project.projectId,
    taskId: null,
    executionId: null,
    preparedTaskRevision: null,
    preparedExecutionRevision: null,
    provisioningIntentId: 'pci_ContentIntent001',
    provisioningRevision: 2,
    logicalInvocationId: 'root-authorize-attempt-001',
    operation: 'observe_root' as const,
    state: 'observed_failure' as const,
    requestDigest: 'c'.repeat(64),
    receiptDigest: null,
    observationDigest: null,
    safeFailureCode: 'unauthorized',
    preparedAt: createdAt,
    dispatchedAt: updatedAt,
    resolvedAt: updatedAt,
    revision: 3,
    createdAt,
    updatedAt
  }
  const recoveryAction = {
    schemaVersion: 1 as const,
    type: 'visible_recovery_action' as const,
    recoveryActionId: 'rca_OwnerRootLoss01',
    projectId: project.projectId,
    taskId: null,
    executionId: null,
    journalEntryId: journal.contentRecoveryJournalEntryId,
    audience: 'owner' as const,
    action: 'reconcile_provider_membership' as const,
    status: 'available' as const,
    requiresFreshObservation: true,
    safeSummary: 'Re-authorize the exact shared root and reconcile Provider membership.',
    availableAt: updatedAt,
    completedAt: null,
    revision: 1,
    createdAt,
    updatedAt
  }
  const responses = [
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_page',
      requestId: 'req_ListContentFacts1',
      limit: 250,
      projects: [project],
      observedAt: updatedAt
    }),
    emptyWorkerDirectoryResponse('req_ListContentFactsWorkers'),
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_coordination',
      requestId: 'req_ReadContentFacts1',
      project,
      observedAt: updatedAt,
      pages: [{ collection: 'memberships', limit: 250, items: [membership] },
        { collection: 'provider_principal_facts', limit: 250, items: [principalFact] },
        { collection: 'provider_membership_observations', limit: 250, items: [observation] },
        { collection: 'content_readiness', limit: 250, items: [readiness] },
        { collection: 'external_operation_journal', limit: 250, items: [journal] },
        { collection: 'visible_recovery_actions', limit: 250, items: [recoveryAction] }],
      finalSummary: null
    })
  ]
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: project.ownerUserId,
      deviceId: 'dev_Device0000001'
    }),
    execute: async () => {
      const next = responses.shift()
      if (!next) throw new Error('Unexpected Cloud request.')
      return next
    }
  }

  const workspace = await createProjectCoordinatorCloudWorkspacePort({ transport })
    .readWorkspace({ projectId: project.projectId })
  const provisioning = workspace.projects[0]?.provisioning

  assert.deepEqual(provisioning?.memberships, [membership])
  assert.deepEqual(provisioning?.providerPrincipalFacts, [principalFact])
  assert.deepEqual(provisioning?.providerMembershipObservations, [observation])
  assert.deepEqual(provisioning?.contentReadiness, [readiness])
  assert.deepEqual(provisioning?.externalOperationJournal, [journal])
  assert.deepEqual(provisioning?.recoveryActions, [recoveryAction])
})

function response(
  status: number,
  body: AuthenticatedCloudResponse['body']
): AuthenticatedCloudResponse {
  return { contractVersion: 1 as const, status, body }
}

function emptyWorkerDirectoryResponse(requestId: `req_${string}`): AuthenticatedCloudResponse {
  return response(200, {
    protocolVersion: '1.0',
    type: 'rest.worker_availability_page',
    requestId,
    observedAt: updatedAt,
    items: [],
    userLabels: [],
    agentLabels: []
  })
}

function projectFixture(projectId: string, displayName: string) {
  return {
    schemaVersion: 1 as const,
    revision: 1,
    createdAt,
    updatedAt,
    type: 'project' as const,
    projectId,
    ownerUserId: 'usr_Owner0000001',
    displayName,
    goal: 'Run one realistic multi-user meeting.',
    coordinatorAgentId: 'agt_Coordinator01',
    coordinatorAuthorityEpoch: 1,
    executionAuthorityEpoch: 1,
    contentMode: 'none' as const,
    status: 'paused' as const,
    budget: {
      maxTasks: 8,
      maxTasksPerRound: 4,
      maxTaskRetries: 2,
      maxCoordinationRounds: 3
    }
  }
}

function membershipFixture(projectId: string) {
  return {
    schemaVersion: 1 as const,
    revision: 1,
    createdAt,
    updatedAt,
    type: 'project_membership' as const,
    projectMembershipId: 'pmb_OwnerMember001',
    projectId,
    userId: 'usr_Owner0000001',
    state: 'active' as const,
    authorityEpoch: 1,
    activatedAt: createdAt,
    removalRequestedAt: null,
    removalRequestedByUserId: null,
    removedAt: null
  }
}

function userLabelFixture(userId: string, displayName: string) {
  return {
    schemaVersion: 1 as const,
    type: 'project_user_label_fact' as const,
    projectId: 'prj_ProjectCreated01',
    userId,
    displayName,
    status: 'active' as const,
    revision: 1,
    observedAt: updatedAt
  }
}

function agentLabelFixture(agentId: string, displayName: string) {
  return {
    schemaVersion: 1 as const,
    type: 'project_agent_label_fact' as const,
    projectId: 'prj_ProjectCreated01',
    agentId,
    ownerUserId: 'usr_Worker000001',
    deviceId: agentId.endsWith('1') ? 'dev_WorkerDevice01' : 'dev_WorkerDevice02',
    displayName,
    nodeType: 'desktop' as const,
    lifecycleStatus: 'active' as const,
    revision: 2,
    observedAt: updatedAt
  }
}

function availabilityFixture(agentId: string, acceptsNewOffers: boolean, revision: number) {
  return {
    schemaVersion: 1 as const,
    revision,
    createdAt,
    updatedAt,
    type: 'worker_availability_projection' as const,
    userId: 'usr_Worker000001',
    agentId,
    deviceId: agentId.endsWith('1') ? 'dev_WorkerDevice01' : 'dev_WorkerDevice02',
    agentActive: true,
    deviceActive: true,
    connectionStatus: 'online' as const,
    lastHeartbeatAt: updatedAt,
    runtimeReadiness: 'ready' as const,
    runtimeCapabilityTags: ['meeting.review'],
    acceptsNewOffers,
    activeTaskCount: acceptsNewOffers ? 0 : 1,
    observedAt: updatedAt,
    expiresAt: '2026-08-25T01:10:00.000Z'
  }
}

function planFixture(input: Readonly<{
  projectPlanId: string
  state: 'awaiting_confirmation' | 'superseded'
  planRevision: number
}>) {
  return {
    schemaVersion: 1 as const,
    revision: input.state === 'superseded' ? 2 : 1,
    createdAt,
    updatedAt,
    type: 'project_plan' as const,
    projectPlanId: input.projectPlanId,
    projectId: 'prj_ProjectCreated01',
    state: input.state,
    planRevision: input.planRevision,
    sourceInputLocators: [],
    tasks: [{
      planItemId: `item_meeting_${input.planRevision}`,
      title: 'Summarize meeting',
      objective: 'Produce one bounded meeting summary.',
      completionCriteria: ['Owner can review the summary.'],
      dependencyPlanItemIds: [],
      requiredCapabilityTags: ['meeting.review'],
      fileIntent: null
    }],
    rationale: 'One ready Worker can synthesize the meeting.',
    runtimeProvenance: {
      runtimeId: 'codex-runtime',
      modelId: null,
      generatedByCoordinatorAgentId: 'agt_Coordinator01',
      generatedAt: createdAt
    },
    planDigest: String(input.planRevision).repeat(64),
    submittedAt: createdAt,
    confirmedByUserId: null,
    confirmedAt: null,
    supersededAt: input.state === 'superseded' ? updatedAt : null
  }
}

function expectProjectCollections() {
  return [
    'user_label_facts',
    'memberships',
    'task_authorities',
    'provider_principal_facts',
    'content_readiness',
    'provider_membership_observations',
    'plans',
    'tasks',
    'executions',
    'offers',
    'result_submissions',
    'review_decisions',
    'pending_human_needed',
    'provisioning_intents',
    'provisioning_attestations',
    'content_bindings',
    'external_operation_journal',
    'visible_recovery_actions',
    'project_records'
  ].map((collection) => ({ collection, limit: 250 }))
}
