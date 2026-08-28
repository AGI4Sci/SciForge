import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { CoordinatorCloudCommandService } from '@sciforge/domain-collaboration/coordinator-cloud-command'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/agent-execution'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import {
  restResponseSchema,
  taskExecutionSchema,
  taskOfferSchema,
  taskSchema,
  type ProjectPlan,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import { canonicalTaskIdForPlanItem } from '@sciforge/collaboration-contracts/node'

import {
  createProjectCoordinatorPlanPort,
  defineProjectCoordinatorWorkspacePort
} from './ports.js'
import { createProjectCoordinatorContinuationPort } from './continuation.js'
import { ProjectCoordinatorPlanningError } from './plan-readiness.js'
import { ProjectCoordinatorStateStore } from './state.js'

test('local Coordinator Runtime creates an editable durable Plan draft with Worker User assignment', async () => {
  const settings = inMemorySettings()
  const prompts: string[] = []
  const workspace = planningWorkspaceFixture('draft')
  const firstAgent = workspace.projects[0]!.workerGroups[0]!.agents[0]!
  workspace.projects[0]!.workerGroups[0]!.agents.push({
    displayName: 'Worker Desktop B',
    projectAvailability: {
      ...firstAgent.projectAvailability,
      agentId: 'agt_WorkerAgent002',
      availability: {
        ...firstAgent.projectAvailability.availability,
        agentId: 'agt_WorkerAgent002',
        deviceId: 'dev_WorkerDevice02',
        runtimeCapabilityTags: ['document.write']
      }
    }
  })
  const agentExecution: DomainMainAgentExecutionHost = {
    run: async (request) => {
      prompts.push(request.prompt)
      return {
        runtimeId: 'codex-runtime',
        threadId: 'thread-plan-draft-1',
        turnId: 'turn-plan-draft-1',
        state: 'completed',
        text: JSON.stringify({
          tasks: [{
            planItemId: 'item_meeting_summary',
            title: 'Summarize decisions',
            objective: 'Produce a bounded meeting decision summary.',
            completionCriteria: ['Owner can review one concise summary.'],
            dependencyPlanItemIds: [],
            requiredCapabilityTags: ['meeting.review'],
            fileIntent: null
          }],
          rationale: 'One ready Worker User can synthesize the meeting.'
        })
      }
    }
  }
  const options = {
    settings,
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspace
    }),
    getAgentExecution: () => agentExecution,
    continuation: {
      reconcileProject: async () => workspace,
      reconcileVisibleProjects: async () => undefined
    },
    now: () => new Date('2026-08-25T01:06:00.000Z')
  }
  const port = createProjectCoordinatorPlanPort(options)

  const generated = await port.generateDraft({
    projectId: 'prj_ProjectCreated01',
    instruction: 'Split the meeting into independently reviewable work.',
    sourceInputLocators: [],
    modelId: null
  })
  assert.equal(generated.draftRevision, 1)
  assert.equal(generated.runtimeProvenance.generatedByCoordinatorAgentId, 'agt_Coordinator01')
  assert.equal(generated.assignments[0]?.workerUserId, null)
  assert.match(prompts[0] ?? '', /Created meeting.*runtimeProfiles.*eligibleTaskScopes.*text_tasks.*capabilityTags.*meeting\.review.*document\.write/su)
  assert.match(prompts[0] ?? '', /logical Plan declaration only.*Never include a bindingRevision/su)
  assert.doesNotMatch(prompts[0] ?? '', /declare bindingRevision 1/u)
  assert.doesNotMatch(prompts[0] ?? '', /runtimeCapabilityTags/u)

  const edited = await port.editDraft({
    projectId: generated.projectId,
    draftId: generated.draftId,
    expectedDraftRevision: generated.draftRevision,
    tasks: generated.tasks,
    rationale: generated.rationale,
    assignments: [{
      planItemId: 'item_meeting_summary',
      workerUserId: 'usr_Worker000001',
      recommendationReason: 'Owner selected the User with an eligible ready Runtime.'
    }]
  })
  assert.equal(edited.draftRevision, 2)
  assert.equal(edited.assignments[0]?.workerUserId, 'usr_Worker000001')

  await assert.rejects(() => port.editDraft({
    projectId: edited.projectId,
    draftId: edited.draftId,
    expectedDraftRevision: edited.draftRevision,
    tasks: edited.tasks.map((task) => ({
      ...task,
      requiredCapabilityTags: ['meeting.review', 'document.write']
    })),
    rationale: edited.rationale,
    assignments: edited.assignments
  }), /one planning-ready Runtime/u)

  const reloaded = createProjectCoordinatorPlanPort(options)
  assert.deepEqual(await reloaded.readDraft({ projectId: generated.projectId }), edited)
  await assert.rejects(() => reloaded.editDraft({
    projectId: edited.projectId,
    draftId: edited.draftId,
    expectedDraftRevision: edited.draftRevision,
    tasks: edited.tasks,
    rationale: edited.rationale,
    assignments: [{
      planItemId: 'item_meeting_summary',
      workerUserId: 'usr_NotAProjectUser',
      recommendationReason: 'An invented candidate must be rejected.'
    }]
  }), /visible Worker User/u)
})

test('paused planning accepts only active membership with project_paused prospective authority', async () => {
  const workspace = planningWorkspaceFixture('paused')
  let runtimeRuns = 0
  const port = createProjectCoordinatorPlanPort({
    settings: inMemorySettings(),
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspace
    }),
    getAgentExecution: () => ({
      run: async () => {
        runtimeRuns += 1
        return planAgentExecution().run({
          clientDirectiveId: 'project-plan:paused',
          prompt: 'paused',
          interaction: 'reviewable',
          mode: 'plan'
        })
      }
    }),
    continuation: {
      reconcileProject: async () => workspace,
      reconcileVisibleProjects: async () => undefined
    },
    now: () => new Date('2026-08-25T01:06:00.000Z')
  })

  const draft = await port.generateDraft({
    projectId: 'prj_ProjectCreated01',
    instruction: 'Replan while provisioning keeps execution paused.',
    sourceInputLocators: [],
    modelId: null
  })
  const edited = await port.editDraft({
    projectId: draft.projectId,
    draftId: draft.draftId,
    expectedDraftRevision: draft.draftRevision,
    tasks: draft.tasks,
    rationale: draft.rationale,
    assignments: [{
      planItemId: 'item_meeting_summary',
      workerUserId: 'usr_Worker000001',
      recommendationReason: 'The paused Project exposes prospective text scope.'
    }]
  })

  assert.equal(runtimeRuns, 1)
  assert.equal(edited.assignments[0]?.workerUserId, 'usr_Worker000001')

  const activeWithoutEligibleAuthority = planningWorkspaceFixture('active')
  activeWithoutEligibleAuthority.projects[0]!.workerGroups[0]!.agents[0]!
    .projectAvailability.taskAuthorities[0]!.state = 'suspended'
  activeWithoutEligibleAuthority.projects[0]!.workerGroups[0]!.agents[0]!
    .projectAvailability.taskAuthorities[0]!.reason = 'project_paused'
  let activeRuntimeRuns = 0
  const activePort = createProjectCoordinatorPlanPort({
    settings: inMemorySettings(),
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => activeWithoutEligibleAuthority
    }),
    getAgentExecution: () => ({
      run: async (request) => {
        activeRuntimeRuns += 1
        return planAgentExecution().run(request)
      }
    }),
    continuation: {
      reconcileProject: async () => activeWithoutEligibleAuthority,
      reconcileVisibleProjects: async () => undefined
    }
  })
  await assert.rejects(
    activePort.generateDraft({
      projectId: 'prj_ProjectCreated01',
      instruction: 'Do not plan with suspended authority after activation.',
      sourceInputLocators: [],
      modelId: null
    }),
    (error: unknown) => error instanceof ProjectCoordinatorPlanningError &&
      error.code === 'planning_candidates_unavailable'
  )
  assert.equal(activeRuntimeRuns, 0)
})

test('planning with no prospective Worker candidate fails before Runtime dispatch', async () => {
  const workspace = planningWorkspaceFixture('draft')
  Object.assign(
    workspace.projects[0]!.workerGroups[0]!.agents[0]!
      .projectAvailability.availability,
    { connectionStatus: 'offline', acceptsNewOffers: false }
  )
  let runtimeRuns = 0
  const port = createProjectCoordinatorPlanPort({
    settings: inMemorySettings(),
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspace
    }),
    getAgentExecution: () => ({
      run: async (request) => {
        runtimeRuns += 1
        return planAgentExecution().run(request)
      }
    }),
    continuation: {
      reconcileProject: async () => workspace,
      reconcileVisibleProjects: async () => undefined
    }
  })

  await assert.rejects(
    port.generateDraft({
      projectId: 'prj_ProjectCreated01',
      instruction: 'This must fail before provider dispatch.',
      sourceInputLocators: [],
      modelId: null
    }),
    (error: unknown) => error instanceof ProjectCoordinatorPlanningError &&
      error.code === 'planning_candidates_unavailable'
  )
  assert.equal(runtimeRuns, 0)
})

test('Plan confirmation keeps the Project paused until the canonical workflow activates and reconciles', async () => {
  const settings = inMemorySettings()
  let phase: 'draft' | 'submitted' | 'confirmed' | 'active' = 'draft'
  let submittedPlan: ProjectPlan | undefined
  let offeredBundle: Extract<RestResponse, { type: 'rest.collection' }> | undefined
  const coordinatorCommands: unknown[] = []
  const userCommands: unknown[] = []
  const coordinatorCloudCommands: CoordinatorCloudCommandService = {
    execute: async (command) => {
      coordinatorCommands.push(command)
      if (command.type === 'project.plan.submit') {
        submittedPlan = submittedPlanFixture(command)
        phase = 'submitted'
        return {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: command.requestId,
          entity: submittedPlan
        }
      }
      assert.equal(command.type, 'task.offer.create')
      if (command.type !== 'task.offer.create') throw new Error('Unexpected command.')
      assert.equal(phase, 'active')
      assert.equal(command.expectedProjectRevision, 4)
      assert.equal(command.expectedPlanRevision, 2)
      assert.equal(command.workerUserId, 'usr_Worker000001')
      offeredBundle = taskOfferResponse(command)
      return offeredBundle
    },
    subscribe: () => () => undefined
  }
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001'
    }),
    execute: async (request) => {
      userCommands.push(request.payload)
      if (request.payload.type === 'project.plan.confirm') {
        assert.equal(phase, 'submitted')
        submittedPlan = {
          ...submittedPlan!,
          state: 'confirmed',
          confirmedByUserId: 'usr_Owner0000001',
          confirmedAt: '2026-08-25T01:08:00.000Z',
          revision: 2,
          updatedAt: '2026-08-25T01:08:00.000Z'
        }
        phase = 'confirmed'
        return {
          contractVersion: 1,
          status: 200,
          body: {
            protocolVersion: '1.0',
            type: 'rest.entity',
            requestId: request.payload.requestId,
            entity: submittedPlan
          }
        }
      }
      if (request.payload.type === 'project.transition') {
        assert.equal(phase, 'confirmed')
        assert.equal(request.payload.expectedRevision, 3)
        phase = 'active'
        return {
          contractVersion: 1,
          status: 200,
          body: {
            protocolVersion: '1.0',
            type: 'rest.entity',
            requestId: request.payload.requestId,
            entity: workflowWorkspace(phase, submittedPlan).projects[0]!.project
          }
        }
      }
      throw new Error(`Unexpected User command ${request.payload.type}.`)
    }
  }
  let requestOrdinal = 0
  const workspacePort = defineProjectCoordinatorWorkspacePort({
    readWorkspace: async () => workflowWorkspace(phase, submittedPlan, offeredBundle)
  })
  const continuation = createProjectCoordinatorContinuationPort({
    workspace: workspacePort,
    coordinatorCloudCommands,
    requestId: () => `req_PlanWorkflow${String(++requestOrdinal).padStart(4, '0')}`,
    now: () => new Date('2026-08-25T01:06:00.000Z')
  })
  const port = createProjectCoordinatorPlanPort({
    settings,
    workspace: workspacePort,
    getAgentExecution: () => planAgentExecution(),
    continuation,
    coordinatorCloudCommands,
    transport,
    requestId: () => `req_PlanWorkflow${String(++requestOrdinal).padStart(4, '0')}`,
    now: () => new Date('2026-08-25T01:06:00.000Z')
  })
  const draft = await port.generateDraft({
    projectId: 'prj_ProjectCreated01',
    instruction: 'Split the meeting into independently reviewable work.',
    sourceInputLocators: [],
    modelId: null
  })
  const assigned = await port.editDraft({
    projectId: draft.projectId,
    draftId: draft.draftId,
    expectedDraftRevision: draft.draftRevision,
    tasks: draft.tasks,
    rationale: draft.rationale,
    assignments: [{
      planItemId: 'item_meeting_summary',
      workerUserId: 'usr_Worker000001',
      recommendationReason: 'Owner selected the User with a ready meeting-review Runtime.'
    }]
  })

  const submitted = await port.submitDraft({
    projectId: assigned.projectId,
    draftId: assigned.draftId,
    expectedDraftRevision: assigned.draftRevision
  }, 'idem_PlanSubmitTracer01')
  const submitCommand = coordinatorCommands[0] as Record<string, unknown>
  assert.equal(submitted.plan.state, 'awaiting_confirmation')
  assert.equal(await port.readDraft({ projectId: assigned.projectId }), null)
  assert.deepEqual(
    submitted.workspace.projects[0]?.plan?.assignments,
    assigned.assignments
  )
  assert.deepEqual(
    await new ProjectCoordinatorStateStore(settings).readPlanAssignments(
      submitted.plan.projectPlanId,
      submitted.plan.planDigest
    ),
    assigned.assignments
  )
  assert.equal(submitCommand.planDigest, stableDigest({
    projectId: assigned.projectId,
    expectedProjectRevision: assigned.expectedProjectRevision,
    expectedCoordinatorAuthorityEpoch: assigned.expectedCoordinatorAuthorityEpoch,
    supersedesProjectPlanId: assigned.supersedesProjectPlanId,
    sourceInputLocators: assigned.sourceInputLocators,
    tasks: assigned.tasks,
    rationale: assigned.rationale,
    runtimeProvenance: assigned.runtimeProvenance
  }))

  const confirmed = await port.confirm({
    projectId: assigned.projectId,
    projectPlanId: submitted.plan.projectPlanId,
    expectedProjectRevision: 2,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedPlanRevision: submitted.plan.revision,
    planDigest: submitted.plan.planDigest,
    initialTeam: null
  }, 'idem_PlanConfirmTracer01')
  assert.equal(confirmed.projects[0]?.project.status, 'paused')
  assert.equal(confirmed.projects[0]?.tasks.length, 0)
  assert.deepEqual((userCommands as Array<{ type: string }>).map(({ type }) => type), [
    'project.plan.confirm'
  ])
  assert.deepEqual((coordinatorCommands as Array<{ type: string }>).map(({ type }) => type), [
    'project.plan.submit'
  ])

  const activated = await port.activateAndReconcile({
    projectId: assigned.projectId,
    projectPlanId: submitted.plan.projectPlanId,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    expectedPlanRevision: submittedPlan!.revision,
    planDigest: submitted.plan.planDigest
  }, 'idem_ProjectWorkflowContinue01')
  assert.equal(activated.projects[0]?.project.status, 'active')
  assert.equal(activated.projects[0]?.tasks.length, 2)
  assert.deepEqual((userCommands as Array<{ type: string }>).map(({ type }) => type), [
    'project.plan.confirm',
    'project.transition'
  ])
  assert.deepEqual((coordinatorCommands as Array<{ type: string }>).map(({ type }) => type), [
    'project.plan.submit',
    'task.offer.create'
  ])
})

function workspaceFixture() {
  const createdAt = '2026-08-25T01:00:00.000Z'
  const updatedAt = '2026-08-25T01:05:00.000Z'
  const availability = {
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
    lastHeartbeatAt: updatedAt,
    runtimeReadiness: 'ready' as const,
    runtimeCapabilityTags: ['meeting.review'],
    acceptsNewOffers: true,
    activeTaskCount: 0,
    observedAt: updatedAt,
    expiresAt: '2026-08-25T01:10:00.000Z'
  }
  return {
    connection: {
      state: 'ready' as const,
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001'
    },
    observedAt: updatedAt,
    focusedProjectId: 'prj_ProjectCreated01',
    availableWorkerUsers: [],
    providerPrincipalFacts: [],
    projects: [{
      project: {
        schemaVersion: 1 as const,
        revision: 1,
        createdAt,
        updatedAt,
        type: 'project' as const,
        projectId: 'prj_ProjectCreated01',
        ownerUserId: 'usr_Owner0000001',
        displayName: 'Created meeting',
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
      },
      plan: null,
      memberUsers: [],
      workerGroups: [{
        userId: 'usr_Worker000001',
        displayName: 'Worker User',
        agents: [{
          displayName: 'Worker Desktop A',
          projectAvailability: {
            schemaVersion: 1 as const,
            type: 'project_worker_availability_view' as const,
            projectId: 'prj_ProjectCreated01',
            userId: 'usr_Worker000001',
            agentId: 'agt_WorkerAgent001',
            revision: 7,
            availability,
            membership: {
              schemaVersion: 1 as const,
              type: 'project_membership' as const,
              projectMembershipId: 'pmb_WorkerMember001',
              projectId: 'prj_ProjectCreated01',
              userId: 'usr_Worker000001',
              state: 'active' as const,
              authorityEpoch: 1,
              activatedAt: createdAt,
              removalRequestedAt: null,
              removalRequestedByUserId: null,
              removedAt: null,
              revision: 1,
              createdAt,
              updatedAt
            },
            taskAuthorities: [{
              schemaVersion: 1 as const,
              type: 'task_authority' as const,
              taskAuthorityId: 'tau_WorkerText001',
              projectId: 'prj_ProjectCreated01',
              userId: 'usr_Worker000001',
              scope: 'text_tasks' as const,
              state: 'eligible' as const,
              authorityEpoch: 1,
              reason: null,
              effectiveAt: createdAt,
              revision: 1,
              createdAt,
              updatedAt
            }],
            providerPrincipalFact: null,
            providerPrincipalSnapshotStatus: 'not_applicable' as const,
            contentReadiness: null,
            observedAt: updatedAt
          }
        }]
      }],
      tasks: [],
      offers: [],
      reviews: [],
      pendingHumanNeeded: [],
      records: [],
      finalSummary: null,
      coordinatorTransferFeedback: null,
      provisioning: {
        intent: null,
        attestation: null,
        binding: null,
        memberships: [],
        providerPrincipalFacts: [],
        contentReadiness: [],
        providerMembershipObservations: [],
        externalOperationJournal: [],
        recoveryActions: []
      }
    }]
  }
}

function planningWorkspaceFixture(status: 'draft' | 'paused' | 'active') {
  const base = workspaceFixture()
  return {
    ...base,
    projects: base.projects.map((project) => ({
      ...project,
      project: {
        ...project.project,
        status
      },
      workerGroups: project.workerGroups.map((group) => ({
        ...group,
        agents: group.agents.map((agent) => ({
          ...agent,
          projectAvailability: {
            ...agent.projectAvailability,
            membership: status === 'draft'
              ? null
              : agent.projectAvailability.membership,
            taskAuthorities: status === 'draft'
              ? []
              : agent.projectAvailability.taskAuthorities.map((authority) => ({
                  ...authority,
                  state: status === 'paused' ? 'suspended' as const : 'eligible' as const,
                  reason: status === 'paused' ? 'project_paused' as const : null
                }))
          }
        }))
      }))
    }))
  }
}

function workflowWorkspace(
  phase: 'draft' | 'submitted' | 'confirmed' | 'active',
  plan: ProjectPlan | undefined,
  offeredBundle?: Extract<RestResponse, { type: 'rest.collection' }>
) {
  const base = workspaceFixture()
  const projectRevision = phase === 'draft'
    ? 1
    : phase === 'submitted'
      ? 2
      : phase === 'confirmed'
        ? 3
        : offeredBundle
          ? 5
          : 4
  const offeredTask = offeredBundle?.items.find((item) => item.type === 'task')
  const offeredOffer = offeredBundle?.items.find((item) => item.type === 'task_offer')
  return {
    ...base,
    projects: [{
      ...base.projects[0]!,
      project: {
        ...base.projects[0]!.project,
        revision: projectRevision,
        status: phase === 'draft'
          ? 'draft' as const
          : phase === 'active'
            ? 'active' as const
            : 'paused' as const
      },
      plan: plan ? {
        plan,
        assignments: [{
          planItemId: 'item_meeting_summary',
          workerUserId: 'usr_Worker000001',
          recommendationReason: 'Owner selected the User with a ready meeting-review Runtime.'
        }]
      } : null,
      workerGroups: base.projects[0]!.workerGroups.map((group) => ({
        ...group,
        agents: group.agents.map((agent) => ({
          ...agent,
          projectAvailability: {
            ...agent.projectAvailability,
            revision: phase === 'active' ? 11 : agent.projectAvailability.revision,
            availability: {
              ...agent.projectAvailability.availability,
              revision: phase === 'active' ? 11 : agent.projectAvailability.availability.revision
            }
          }
        }))
      })),
      tasks: [
        ...(phase === 'active' ? [previousPlanTaskView()] : []),
        ...(offeredTask
          ? [{ task: offeredTask, executions: [] }]
          : [])
      ],
      offers: offeredOffer ? [offeredOffer] : []
    }]
  }
}

function previousPlanTaskView() {
  const at = '2026-08-24T23:00:00.000Z'
  const taskId = 'tsk_PreviousPlanTask01'
  const executionId = 'exe_PreviousPlanTask01'
  return {
    task: taskSchema.parse({
      schemaVersion: 1,
      type: 'task',
      taskId,
      projectId: 'prj_ProjectCreated01',
      createdByCoordinatorAgentId: 'agt_Coordinator01',
      title: 'Retained task from an earlier Plan',
      objective: 'Remain visible as immutable Project history.',
      completionCriteria: ['The historical Task remains distinct from the new Plan.'],
      dependencyTaskIds: [],
      requiredCapabilityTags: ['meeting.review'],
      fileIntent: null,
      currentExecutionId: executionId,
      currentExecutionState: 'running',
      status: 'in_progress',
      executionCount: 1,
      maxRetries: 2,
      completedAt: null,
      revision: 1,
      createdAt: at,
      updatedAt: at
    }),
    executions: [taskExecutionSchema.parse({
      schemaVersion: 1,
      type: 'task_execution',
      projectId: 'prj_ProjectCreated01',
      taskId,
      executionId,
      attempt: 1,
      offeredByCoordinatorAgentId: 'agt_Coordinator01',
      assigneeUserId: 'usr_Worker000001',
      assigneeAgentId: 'agt_WorkerAgent001',
      assigneeDeviceId: 'dev_WorkerDevice01',
      state: 'running',
      stateRevision: 2,
      fence: {
        schemaVersion: 1,
        executionId,
        assigneeUserId: 'usr_Worker000001',
        assigneeAgentId: 'agt_WorkerAgent001',
        assigneeDeviceId: 'dev_WorkerDevice01',
        assignmentTaskRevision: 1,
        projectExecutionAuthorityEpoch: 1,
        userTaskAuthorityEpoch: 1,
        bindingRevision: null,
        status: 'open',
        reason: null,
        fencedAt: null
      },
      fileIntent: null,
      currentResultSubmissionId: null,
      offeredAt: at,
      acceptedAt: at,
      startedAt: at,
      terminalAt: null,
      revision: 1,
      createdAt: at,
      updatedAt: at
    })]
  }
}

function taskOfferResponse(command: Extract<
  Parameters<CoordinatorCloudCommandService['execute']>[0],
  { type: 'task.offer.create' }
>): Extract<RestResponse, { type: 'rest.collection' }> {
  const at = '2026-08-25T01:06:00.000Z'
  const taskId = canonicalTaskIdForPlanItem(command.projectPlanId, command.planItemId)
  const task = taskSchema.parse({
    schemaVersion: 1,
    type: 'task',
    taskId,
    projectId: command.projectId,
    createdByCoordinatorAgentId: 'agt_Coordinator01',
    title: 'Summarize decisions',
    objective: 'Produce a bounded meeting decision summary.',
    completionCriteria: ['Owner can review one concise summary.'],
    dependencyTaskIds: [],
    requiredCapabilityTags: ['meeting.review'],
    fileIntent: null,
    currentExecutionId: null,
    currentExecutionState: null,
    status: 'offered',
    executionCount: 0,
    maxRetries: 2,
    completedAt: null,
    revision: 1,
    createdAt: at,
    updatedAt: at
  })
  const offer = taskOfferSchema.parse({
    schemaVersion: 1,
    type: 'task_offer',
    taskOfferId: 'ofr_MeetingSummary01',
    projectId: command.projectId,
    taskId,
    executionId: null,
    workerUserId: command.workerUserId,
    offeredByCoordinatorAgentId: 'agt_Coordinator01',
    state: 'pending',
    offeredAt: at,
    expiresAt: command.offerExpiresAt,
    respondedAt: null,
    revision: 1,
    createdAt: at,
    updatedAt: at
  })
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: command.requestId,
    items: [task, offer]
  }) as Extract<RestResponse, { type: 'rest.collection' }>
}

function planAgentExecution(): DomainMainAgentExecutionHost {
  return {
    run: async () => ({
      runtimeId: 'codex-runtime',
      threadId: 'thread-plan-draft-1',
      turnId: 'turn-plan-draft-1',
      state: 'completed',
      text: JSON.stringify({
        tasks: [{
          planItemId: 'item_meeting_summary',
          title: 'Summarize decisions',
          objective: 'Produce a bounded meeting decision summary.',
          completionCriteria: ['Owner can review one concise summary.'],
          dependencyPlanItemIds: [],
          requiredCapabilityTags: ['meeting.review'],
          fileIntent: null
        }],
        rationale: 'One ready Worker User can synthesize the meeting.'
      })
    })
  }
}

function submittedPlanFixture(command: Extract<
  Parameters<CoordinatorCloudCommandService['execute']>[0],
  { type: 'project.plan.submit' }
>): ProjectPlan {
  return {
    schemaVersion: 1 as const,
    type: 'project_plan' as const,
    projectPlanId: 'pln_MeetingPlan001',
    projectId: command.projectId,
    state: 'awaiting_confirmation' as const,
    planRevision: 1,
    sourceInputLocators: command.sourceInputLocators,
    tasks: command.tasks,
    rationale: command.rationale,
    runtimeProvenance: command.runtimeProvenance,
    planDigest: command.planDigest,
    submittedAt: '2026-08-25T01:07:00.000Z',
    confirmedByUserId: null,
    confirmedAt: null,
    supersededAt: null,
    revision: 1,
    createdAt: '2026-08-25T01:07:00.000Z',
    updatedAt: '2026-08-25T01:07:00.000Z'
  }
}

function stableDigest(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`
}

function inMemorySettings(): DomainMainPackageSettingsHost {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
  return {
    read: async () => ({ revision, value: structuredClone(value) }),
    write: async (next, expectedRevision) => {
      if (expectedRevision !== revision) throw new Error('settings revision conflict')
      value = structuredClone(next)
      revision += 1
      return { revision, value: structuredClone(value) }
    },
    clear: async (expectedRevision) => {
      if (expectedRevision !== revision) throw new Error('settings revision conflict')
      value = null
      revision += 1
      return { revision, value }
    }
  }
}
