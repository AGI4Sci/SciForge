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
import {
  projectRequirementsDocumentSchema,
  projectRequirementsDocumentSummarySchema
} from '@sciforge/collaboration-contracts'
import type { CoordinatorCloudCommand } from '../coordinator-cloud-command.js'

import {
  createProjectCoordinatorCloudWorkspacePort
} from './ports.js'

const createdAt = '2026-08-25T01:00:00.000Z'
const updatedAt = '2026-08-25T01:05:00.000Z'

test('workspace cancellation reaches the canonical Cloud request and prevents further reads', async () => {
  const controller = new AbortController()
  let requests = 0
  let dispatched!: () => void
  const started = new Promise<void>((resolve) => { dispatched = resolve })
  const transport: AuthenticatedCloudTransport = {
    stageObject: async () => { throw new Error('unused') },
    readObject: async () => { throw new Error('unused') },
    status: () => ({ state: 'ready', baseUrl: 'https://cloud.run0.invalid/',
      userId: 'usr_Owner0000001', deviceId: 'dev_Device0000001', deviceRevision: 1 }),
    execute: async (_request, options) => {
      requests += 1
      assert.equal(options?.signal, controller.signal)
      dispatched()
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
      })
    }
  }
  const read = createProjectCoordinatorCloudWorkspacePort({ transport }).readWorkspace({}, { signal: controller.signal })
  const rejected = assert.rejects(read, /cancelled by page/u)
  await started
  controller.abort(new Error('cancelled by page'))
  await rejected
  assert.equal(requests, 1)
})

test('current Device Agent Project create returns a workspace focused on the exact new Project after paginated Cloud reads', async () => {
  const requests: AuthenticatedCloudRequest[] = []
  const coordinatorRequests: CoordinatorCloudCommand[] = []
  const project = {
    ...projectFixture('prj_ProjectCreated01', 'Created meeting'),
    status: 'draft' as const
  }
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
        items: [userLabelFixture('usr_Owner0000001', 'Owner')]
      }],
      finalSummary: null
    })
  ]
  const transport: AuthenticatedCloudTransport = {
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001',
      deviceRevision: 1
    }),
    execute: async (request) => {
      requests.push(request)
      if (request.payload.type === 'delivery.drive.list') return emptyDriveResponse(request.payload)
      const next = responses.shift()
      if (!next) throw new Error('Unexpected Cloud request.')
      return next
    }
  }
  let requestOrdinal = 0
  const port = createProjectCoordinatorCloudWorkspacePort({
    transport,
    coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
      localAgentId: () => TEST_IDS.agentId,
      resume: async () => null,
      execute: async (command) => {
        coordinatorRequests.push(command)
        return response(200, {
          protocolVersion: '1.0',
          type: 'rest.project_created',
          requestId: command.requestId,
          project,
          memberships: [membershipFixture(project.projectId)],
        }).body
      },
      subscribe: () => () => undefined
    },
    requestId: () => `req_TracerRequest${String(++requestOrdinal).padStart(4, '0')}`
  })

  const result = await port.createProject({
    createIntentId: 'pct_CloudWorkspaceCreate01',
    displayName: 'Created meeting',
    goal: 'Run one realistic multi-user meeting.',
    budget: {
      maxTasks: 8,
      maxTasksPerRound: 4,
      maxTaskRetries: 2,
      maxCoordinationRounds: 3
    }
  })

  assert.equal(result.createdProjectId, project.projectId)
  assert.equal(result.workspace.connection.state, 'ready')
  assert.equal(
    result.workspace.connection.state === 'ready'
      ? result.workspace.connection.localAgentId
      : undefined,
    TEST_IDS.agentId
  )
  assert.equal(result.workspace.focusedProjectId, project.projectId)
  assert.deepEqual(result.workspace.projects[1]?.memberUsers.map(({ userId }) => userId), [
    'usr_Owner0000001'
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
      'delivery.drive.list'
    ]
  )
  assert.deepEqual(coordinatorRequests, [{
    protocolVersion: '1.0',
    requestId: 'req_TracerRequest0001',
    type: 'project.create',
    idempotencyKey: coordinatorRequests[0]!.idempotencyKey,
    createIntentId: 'pct_CloudWorkspaceCreate01',
    displayName: 'Created meeting',
    goal: 'Run one realistic multi-user meeting.',
    budget: {
      maxTasks: 8,
      maxTasksPerRound: 4,
      maxTaskRetries: 2,
      maxCoordinationRounds: 3
    }
  }])
  assert.match(
    coordinatorRequests[0]!.idempotencyKey,
    /^idem_project\.create\.[a-f0-9]{48}$/u
  )
  assert.deepEqual(
    requests.filter(({ payload }) => payload.type === 'project.coordination.read').map(({ payload }) => (
      payload.type === 'project.coordination.read' ? payload.collections : []
    )),
    [expectProjectCollections()]
  )
})

test('Agent-authored Project create rejects a Cloud response that changes the creator Owner', async () => {
  const project = {
    ...projectFixture('prj_ProjectWrongOwner1', 'Wrong owner'),
    ownerUserId: 'usr_OtherOwner0001',
    status: 'draft' as const
  }
  const transport: AuthenticatedCloudTransport = {
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001',
      deviceRevision: 1
    }),
    execute: async () => { throw new Error('User transport must not create Projects.') }
  }

  await assert.rejects(
    createProjectCoordinatorCloudWorkspacePort({
      transport,
      coordinatorCloudCommands: {
      executeUser: async () => { throw new Error('Unexpected User command.') },
      resumeUser: async () => null,
        localAgentId: () => TEST_IDS.agentId,
        resume: async () => null,
        execute: async (command) => response(200, {
          protocolVersion: '1.0',
          type: 'rest.project_created',
          requestId: command.requestId,
          project,
          memberships: [membershipFixture(project.projectId)],
        }).body,
        subscribe: () => () => undefined
      }
    }).createProject({
      createIntentId: 'pct_CloudWorkspaceWrong01',
      displayName: project.displayName,
      goal: project.goal,
      budget: project.budget
    }),
    /current Agent owner authority/
  )
})

test('invited User workspace reads only the bounded invitation fact collections', async () => {
  const project = projectFixture('prj_ProjectCreated01', 'Invitation review')
  const invitation = {
    ...membershipFixture(project.projectId),
    projectMembershipId: 'pmb_InvitedMember01',
    userId: 'usr_Worker000001',
    state: 'invited' as const,
    activatedAt: null
  }
  const plan = {
    ...planFixture({
      projectPlanId: 'pln_CurrentMeeting01',
      state: 'awaiting_confirmation',
      planRevision: 1
    }),
    state: 'confirmed' as const,
    confirmedByUserId: project.ownerUserId,
    confirmedAt: updatedAt,
    revision: 2
  }
  const requests: AuthenticatedCloudRequest[] = []
  const responses = [
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_page',
      requestId: 'req_ListInvitations01',
      limit: 250,
      projects: [project],
      observedAt: updatedAt
    }),
    emptyWorkerDirectoryResponse('req_ListInvitationWorkers'),
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_coordination',
      requestId: 'req_ReadInvitation01',
      project,
      observedAt: updatedAt,
      pages: [
        {
          collection: 'user_label_facts',
          limit: 250,
          items: [userLabelFixture('usr_Worker000001', 'Invited Worker')]
        },
        { collection: 'memberships', limit: 250, items: [invitation] },
        { collection: 'plans', limit: 250, items: [plan] },
        { collection: 'requirements_documents', limit: 250, items: [] }
      ],
      finalSummary: null
    })
  ]
  const transport: AuthenticatedCloudTransport = {
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: invitation.userId,
      deviceId: 'dev_WorkerDevice01',
      deviceRevision: 1
    }),
    execute: async (request) => {
      requests.push(request)
      if (request.payload.type === 'delivery.drive.list') return emptyDriveResponse(request.payload)
      const next = responses.shift()
      if (!next) throw new Error('Unexpected Cloud request.')
      return next
    }
  }

  const workspace = await createProjectCoordinatorCloudWorkspacePort({ transport })
    .readWorkspace({ projectId: project.projectId })

  assert.equal(workspace.projects[0]?.plan?.plan.projectPlanId, plan.projectPlanId)
  assert.equal(workspace.projects[0]?.memberships[0]?.state, 'invited')
  assert.deepEqual(workspace.projects[0]?.tasks, [])
  const invitationRead = requests.at(-1)?.payload
  assert.deepEqual(
    invitationRead?.type === 'project.coordination.read'
      ? invitationRead.collections
      : null,
    [
      { collection: 'user_label_facts', limit: 250 },
      { collection: 'memberships', limit: 250 },
      { collection: 'plans', limit: 250 },
      { collection: 'requirements_documents', limit: 250 }
    ]
  )
})

test('workspace reads every listed Project\'s own Membership so an unselected invitation stays visible', async () => {
  const workerId = 'usr_Worker000001'
  const currentProject = { ...projectFixture('prj_Current0000001', 'Current project'), ownerUserId: workerId }
  const invitedProject = { ...projectFixture('prj_Invited0000001', 'Invited project') }
  const invitation = {
    ...membershipFixture(invitedProject.projectId),
    projectMembershipId: 'pmb_InvitedMember09',
    projectId: invitedProject.projectId,
    userId: workerId,
    state: 'invited' as const,
    activatedAt: null
  }
  const requests: AuthenticatedCloudRequest[] = []
  const transport: AuthenticatedCloudTransport = {
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: workerId,
      deviceId: 'dev_WorkerDevice01',
      deviceRevision: 1
    }),
    execute: async (request) => {
      requests.push(request)
      const payload = request.payload
      if (payload.type === 'project.list') {
        return response(200, {
          protocolVersion: '1.0',
          type: 'rest.project_page',
          requestId: payload.requestId,
          limit: 250,
          projects: [currentProject, invitedProject],
          observedAt: updatedAt
        })
      }
      if (payload.type === 'worker.availability.list') {
        return emptyWorkerDirectoryResponse(payload.requestId as `req_${string}`)
      }
      if (payload.type === 'delivery.drive.list') return emptyDriveResponse(payload)
      if (payload.type !== 'project.coordination.read') {
        throw new Error(`Unexpected ${payload.type} request.`)
      }
      if (payload.projectId === invitedProject.projectId) {
        return response(200, {
          protocolVersion: '1.0',
          type: 'rest.project_coordination',
          requestId: payload.requestId,
          project: invitedProject,
          observedAt: updatedAt,
          pages: [
            {
              collection: 'user_label_facts',
              limit: 250,
              items: [{
                schemaVersion: 1,
                type: 'project_user_label_fact',
                projectId: invitedProject.projectId,
                userId: workerId,
                displayName: 'Invited Worker',
                status: 'active',
                revision: 1,
                observedAt: updatedAt
              }]
            },
            { collection: 'memberships', limit: 250, items: [invitation] },
            { collection: 'plans', limit: 250, items: [] },
            { collection: 'requirements_documents', limit: 250, items: [] }
          ],
          finalSummary: null
        })
      }
      return response(200, {
        protocolVersion: '1.0',
        type: 'rest.project_coordination',
        requestId: payload.requestId,
        project: currentProject,
        observedAt: updatedAt,
        pages: payload.collections.map(({ collection, limit }) => ({ collection, limit, items: [] })),
        finalSummary: null
      })
    }
  }

  const workspace = await createProjectCoordinatorCloudWorkspacePort({ transport })
    .readWorkspace({ projectId: currentProject.projectId })

  const invited = workspace.projects.find(({ project }) => project.projectId === invitedProject.projectId)
  assert.ok(invited)
  assert.deepEqual(invited.memberships.map(({ userId, state }) => ({ userId, state })), [
    { userId: workerId, state: 'invited' }
  ])
  assert.deepEqual(invited.memberUsers.map(({ userId, displayName }) => ({ userId, displayName })), [
    { userId: workerId, displayName: 'Invited Worker' }
  ])
  assert.deepEqual(invited.tasks, [])
  assert.deepEqual(
    requests
      .filter(({ payload }) => payload.type === 'project.coordination.read' &&
        payload.projectId === invitedProject.projectId)
      .map(({ payload }) => payload.type === 'project.coordination.read'
        ? payload.collections.map(({ collection }) => collection)
        : []),
    [['user_label_facts', 'memberships', 'plans', 'requirements_documents']]
  )
  assert.equal(requests.filter(({ payload }) => payload.type === 'delivery.drive.list').length, 1)
})

test('invited User workspace maps the requirements draft summary beside confirmed requirements', async () => {
  const project = projectFixture('prj_ProjectRequirements01', 'Requirements review')
  const invitation = {
    ...membershipFixture(project.projectId),
    projectMembershipId: 'pmb_InvitedMember02',
    userId: 'usr_Worker000001',
    state: 'invited' as const,
    activatedAt: null
  }
  const confirmed = projectRequirementsDocumentSchema.parse({
    schemaVersion: 1,
    revision: 3,
    createdAt,
    updatedAt,
    type: 'project_requirements_document',
    requirementsDocumentId: 'rqd_ConfirmedRequirements0001',
    projectId: project.projectId,
    documentRevision: 2,
    state: 'confirmed',
    goalsDeliverables: 'Deliver the confirmed result.',
    inputsBoundaries: 'Use only the confirmed inputs.',
    inputReferences: [],
    workModules: [{
      planItemId: 'item_requirements_01',
      title: 'Confirmed module',
      objective: 'Complete the confirmed module.',
      dependencyPlanItemIds: [],
      requiredCapabilityTags: []
    }],
    acceptanceCriteria: [{
      target: '$project',
      criteria: 'The confirmed result is reviewable.',
      evidenceMethod: 'Owner review'
    }],
    contentDigest: 'a'.repeat(64),
    confirmedByUserId: project.ownerUserId,
    confirmedAt: updatedAt,
    supersededAt: null
  })
  const draft = projectRequirementsDocumentSchema.parse({
    schemaVersion: 1,
    revision: 4,
    createdAt,
    updatedAt,
    type: 'project_requirements_document',
    requirementsDocumentId: 'rqd_DraftRequirements0001',
    projectId: project.projectId,
    documentRevision: 3,
    state: 'draft',
    goalsDeliverables: 'Private draft goals.',
    inputsBoundaries: 'Private draft boundaries.',
    inputReferences: [],
    workModules: [{
      planItemId: 'item_draft_01',
      title: 'Private draft module',
      objective: 'Complete the private draft module.',
      dependencyPlanItemIds: [],
      requiredCapabilityTags: []
    }],
    acceptanceCriteria: [],
    contentDigest: 'b'.repeat(64),
    confirmedByUserId: null,
    confirmedAt: null,
    supersededAt: null
  })
  const draftSummary = projectRequirementsDocumentSummarySchema.parse({
    schemaVersion: draft.schemaVersion,
    revision: draft.revision,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    type: draft.type,
    requirementsDocumentId: draft.requirementsDocumentId,
    projectId: draft.projectId,
    documentRevision: draft.documentRevision,
    state: draft.state,
    contentDigest: draft.contentDigest
  })
  const responses = [
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_page',
      requestId: 'req_ListRequirementsInvitation01',
      limit: 250,
      projects: [project],
      observedAt: updatedAt
    }),
    emptyWorkerDirectoryResponse('req_ListRequirementsWorkers'),
    response(200, {
      protocolVersion: '1.0',
      type: 'rest.project_coordination',
      requestId: 'req_ReadRequirementsInvitation01',
      project,
      observedAt: updatedAt,
      pages: [
        { collection: 'user_label_facts', limit: 250, items: [] },
        { collection: 'memberships', limit: 250, items: [invitation] },
        { collection: 'plans', limit: 250, items: [] },
        { collection: 'requirements_documents', limit: 250, items: [confirmed, draftSummary] }
      ],
      finalSummary: null
    })
  ]
  const transport: AuthenticatedCloudTransport = {
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: invitation.userId,
      deviceId: 'dev_WorkerDevice01',
      deviceRevision: 1
    }),
    execute: async (request) => {
      if (request.payload.type === 'delivery.drive.list') return emptyDriveResponse(request.payload)
      const next = responses.shift()
      if (!next) throw new Error('Unexpected Cloud request.')
      return next
    }
  }

  const workspace = await createProjectCoordinatorCloudWorkspacePort({ transport })
    .readWorkspace({ projectId: project.projectId })
  const projected = workspace.projects[0]

  assert.equal(projected?.confirmedRequirements?.requirementsDocumentId, confirmed.requirementsDocumentId)
  assert.equal(projected?.requirementsDraft, null)
  assert.equal(projected?.requirementsDraftSummary?.requirementsDocumentId, draft.requirementsDocumentId)
  assert.equal(projected?.requirementsDraftSummary?.documentRevision, draft.documentRevision)
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
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001',
      deviceRevision: 1
    }),
    execute: async (request) => {
      if (request.payload.type === 'delivery.drive.list') return emptyDriveResponse(request.payload)
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
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001',
      deviceRevision: 1
    }),
    execute: async (request) => {
      if (request.payload.type === 'delivery.drive.list') return emptyDriveResponse(request.payload)
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
  assert.deepEqual(workspace.projects[0]?.legacyHistory.plans, [supersededPlan],
    'retained superseded Plans remain available for read-only Inbox fact validation')
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
    stageObject: async () => { throw new Error('Unexpected object staging.') },
    readObject: async () => { throw new Error('Unexpected object read.') },
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: project.ownerUserId,
      deviceId: 'dev_Device0000001',
      deviceRevision: 1
    }),
    execute: async (request) => {
      if (request.payload.type === 'delivery.drive.list') return emptyDriveResponse(request.payload)
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
      workerUserId: 'usr_Worker000001',
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
    'plans',
    'tasks',
    'executions',
    'offers',
    'requirements_documents',
    'pending_human_needed',
    'project_records'
  ].map((collection) => ({ collection, limit: 250 }))
}

function emptyDriveResponse(request: Extract<AuthenticatedCloudRequest['payload'], { type: 'delivery.drive.list' }>): AuthenticatedCloudResponse {
  return response(200, { protocolVersion: '1.0', type: 'rest.delivery.drive', requestId: request.requestId,
    drive: { projectId: request.projectId, sharedMaterials: [], taskDeliveries: [], projectResults: [] } })
}

for (const reasonCode of ['authority_unverified', 'authority_rejected'] as const) {
  test(`workspace preserves structured ${reasonCode} without reading or authorizing Projects`, async () => {
    const transport: AuthenticatedCloudTransport = {
      status: () => ({ state: 'unavailable', reasonCode, reason: 'Device check status' }),
      execute: async () => { throw new Error('No read while authority is unavailable') },
      stageObject: async () => { throw new Error('No upload') },
      readObject: async () => { throw new Error('No file read') }
    }
    const workspace = await createProjectCoordinatorCloudWorkspacePort({ transport }).readWorkspace({})
    assert.deepEqual(workspace.connection, { state: 'cloud_unavailable', reasonCode, reason: 'Device check status' })
    assert.deepEqual(workspace.projects, [])
  })
}
