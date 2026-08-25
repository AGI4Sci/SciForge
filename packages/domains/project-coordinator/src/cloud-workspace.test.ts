import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AuthenticatedCloudRequest,
  AuthenticatedCloudResponse,
  AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'

import {
  createProjectCoordinatorCloudWorkspacePort
} from './ports.js'

const createdAt = '2026-08-25T01:00:00.000Z'
const updatedAt = '2026-08-25T01:05:00.000Z'

test('OIDC Project create returns a workspace focused on the exact new Project after paginated Cloud reads', async () => {
  const requests: AuthenticatedCloudRequest[] = []
  const project = projectFixture('prj_ProjectCreated01', 'Created meeting')
  const existing = projectFixture('prj_ProjectExisting1', 'Existing meeting')
  const responses = [
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_created',
      requestId: 'req_CreateProject0001',
      project,
      memberships: [membershipFixture(project.projectId)],
      provisioningIntent: null
    }),
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
    requestId: () => `req_TracerRequest${String(++requestOrdinal).padStart(4, '0')}`
  })

  const result = await port.createProject({
    displayName: 'Created meeting',
    goal: 'Run one realistic multi-user meeting.',
    coordinatorAgentId: 'agt_Coordinator01',
    expectedCoordinatorAgentRevision: 3,
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
  assert.deepEqual(
    result.workspace.projects.map(({ project }) => project.projectId),
    [existing.projectId, project.projectId]
  )
  assert.deepEqual(
    requests.map(({ payload }) => payload.type),
    [
      'project.create',
      'project.list',
      'project.list',
      'project.coordination.read',
      'project.coordination.read'
    ]
  )
  assert.deepEqual(
    requests.slice(3).map(({ payload }) => (
      payload.type === 'project.coordination.read' ? payload.collections : []
    )),
    [
      expectAllCollections(),
      [{ collection: 'user_label_facts', cursor: 'cursor-user-page-2', limit: 250 }]
    ]
  )
})

test('Cloud flat availability facts are grouped by dynamic User while preserving exact Agent choice', async () => {
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
      type: 'rest.project_coordination',
      requestId: 'req_ReadCandidates001',
      project,
      observedAt: updatedAt,
      pages: [{
        collection: 'user_label_facts',
        limit: 250,
        items: [userLabelFixture('usr_Worker000001', 'Worker User')]
      }, {
        collection: 'agent_label_facts',
        limit: 250,
        items: [
          agentLabelFixture('agt_WorkerAgent001', 'Worker Desktop A'),
          agentLabelFixture('agt_WorkerAgent002', 'Worker Desktop B')
        ]
      }, {
        collection: 'worker_availability',
        limit: 250,
        items: [
          availabilityFixture('agt_WorkerAgent001', true, 7),
          availabilityFixture('agt_WorkerAgent002', false, 8)
        ]
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

  assert.deepEqual(workspace.projects[0]?.workerGroups.map((group) => ({
    userId: group.userId,
    displayName: group.displayName,
    agents: group.agents.map(({ displayName, projectAvailability }) => ({
      displayName,
      agentId: projectAvailability.agentId,
      acceptsNewOffers: projectAvailability.availability.acceptsNewOffers
    }))
  })), [{
    userId: 'usr_Worker000001',
    displayName: 'Worker User',
    agents: [{
      displayName: 'Worker Desktop A',
      agentId: 'agt_WorkerAgent001',
      acceptsNewOffers: true
    }, {
      displayName: 'Worker Desktop B',
      agentId: 'agt_WorkerAgent002',
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

function response(
  status: number,
  body: AuthenticatedCloudResponse['body']
): AuthenticatedCloudResponse {
  return { contractVersion: 1 as const, status, body }
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

function expectAllCollections() {
  return [
    'user_label_facts',
    'agent_label_facts',
    'memberships',
    'task_authorities',
    'worker_availability',
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
