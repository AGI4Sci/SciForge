import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { CoordinatorCloudCommandService } from '@sciforge/domain-collaboration/coordinator-cloud-command'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type {
  DomainMainAgentExecutionHost,
  DomainMainAgentExecutionRequest
} from '@sciforge/domain-sdk/agent-execution'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import {
  restResponseSchema,
  taskExecutionSchema,
  taskOfferSchema,
  taskSchema,
  type ProjectPlan,
  type RestResponse
} from '@sciforge/collaboration-contracts'

import {
  createProjectCoordinatorPlanPort,
  defineProjectCoordinatorWorkspacePort,
  ProjectCoordinatorPlanGenerationError
} from './ports.js'
import { ProjectCoordinatorStateStore } from './state.js'

test('local Coordinator Runtime creates an editable durable Plan draft with exact Agent assignment', async () => {
  const settings = inMemorySettings()
  const prompts: string[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
  const agentExecution: DomainMainAgentExecutionHost = {
    run: async (request) => {
      requests.push(request)
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
          rationale: 'One ready Worker Agent can synthesize the meeting.'
        })
      }
    }
  }
  const options = {
    settings,
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspaceFixture()
    }),
    getAgentExecution: () => agentExecution,
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
  assert.equal(generated.assignments[0]?.selectedAgentId, null)
  assert.match(prompts[0] ?? '', /Created meeting.*meeting\.review/su)
  assert.match(prompts[0] ?? '', /Do not emit id, description, assignee, dependencies, status/u)
  assert.equal(requests[0]?.clientDirectiveId, 'project-plan:v2:prj_ProjectCreated01:1')
  assert.equal(requests[0]?.outputSchema?.type, 'object')
  assert.match(JSON.stringify(requests[0]?.outputSchema), /"planItemId"/u)
  assert.match(JSON.stringify(requests[0]?.outputSchema), /"completionCriteria"/u)
  assert.match(JSON.stringify(requests[0]?.outputSchema), /"dependencyPlanItemIds"/u)
  assert.doesNotMatch(JSON.stringify(requests[0]?.outputSchema), /"assignee"/u)
  assert.doesNotMatch(JSON.stringify(requests[0]?.outputSchema), /"propertyNames"/u)
  assert.doesNotMatch(JSON.stringify(requests[0]?.outputSchema), /"\$ref"/u)
  assert.doesNotMatch(JSON.stringify(requests[0]?.outputSchema), /"definitions"/u)

  const edited = await port.editDraft({
    projectId: generated.projectId,
    draftId: generated.draftId,
    expectedDraftRevision: generated.draftRevision,
    tasks: generated.tasks,
    rationale: generated.rationale,
    assignments: [{
      planItemId: 'item_meeting_summary',
      selectedAgentId: 'agt_WorkerAgent001',
      recommendationReason: 'Owner selected the exact ready Desktop Agent.'
    }]
  })
  assert.equal(edited.draftRevision, 2)
  assert.equal(edited.assignments[0]?.selectedAgentId, 'agt_WorkerAgent001')

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
      selectedAgentId: 'agt_NotAProjectAgent',
      recommendationReason: 'An invented candidate must be rejected.'
    }]
  }), /active Project member/u)
})

test('generic task JSON is rejected without persisting a Plan draft', async () => {
  const settings = inMemorySettings()
  const port = createProjectCoordinatorPlanPort({
    settings,
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspaceFixture()
    }),
    getAgentExecution: () => ({
      run: async () => ({
        runtimeId: 'codex-runtime',
        threadId: 'thread-plan-invalid-1',
        turnId: 'turn-plan-invalid-1',
        state: 'completed',
        text: JSON.stringify({
          tasks: [{
            id: 'task-1',
            title: 'Summarize decisions',
            description: 'Produce a summary.',
            assignee: 'agt_WorkerAgent001',
            dependencies: [],
            status: 'pending'
          }],
          rationale: 'Assign the available Worker.'
        })
      })
    }),
    now: () => new Date('2026-08-25T01:06:00.000Z')
  })

  await assert.rejects(
    port.generateDraft({
      projectId: 'prj_ProjectCreated01',
      instruction: 'Split the meeting into independently reviewable work.',
      sourceInputLocators: [],
      modelId: null
    }),
    (error: unknown) => (
      error instanceof ProjectCoordinatorPlanGenerationError &&
      error.reason === 'invalid_structured_output'
    )
  )
  assert.equal(await port.readDraft({ projectId: 'prj_ProjectCreated01' }), null)
})

test('file selections bind only exact supplied locators and the Cloud provisioning revision', async () => {
  const settings = inMemorySettings()
  const sourceLocator = {
    contractVersion: 1 as const,
    kind: 'content-space.file-reference' as const,
    authority: 'opencontent.test',
    identity: { fileId: 'agenda-1' }
  }
  let request: DomainMainAgentExecutionRequest | undefined
  const port = createProjectCoordinatorPlanPort({
    settings,
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => fileWorkspaceFixture()
    }),
    getAgentExecution: () => ({
      run: async (input) => {
        request = input
        return {
          runtimeId: 'codex-runtime',
          threadId: 'thread-plan-file-1',
          turnId: 'turn-plan-file-1',
          state: 'completed',
          text: JSON.stringify({
            tasks: [{
              planItemId: 'item_file_summary',
              title: 'Write summary',
              objective: 'Read the agenda and write a reviewable summary.',
              completionCriteria: ['One Markdown summary is uploaded.'],
              dependencyPlanItemIds: [],
              requiredCapabilityTags: ['meeting.review'],
              fileIntent: {
                inputs: [{
                  sourceInputIndex: 0,
                  destinationName: 'agenda.md',
                  expectedSemanticRevision: null,
                  expectedMediaType: 'text/markdown'
                }],
                output: {
                  fileName: 'summary.md',
                  mediaType: 'text/markdown',
                  maxBytes: 100_000
                }
              }
            }],
            rationale: 'The supplied agenda is the exact source for the summary.'
          })
        }
      }
    }),
    now: () => new Date('2026-08-25T01:06:00.000Z')
  })

  const draft = await port.generateDraft({
    projectId: 'prj_ProjectCreated01',
    instruction: 'Create one file-backed summary task.',
    sourceInputLocators: [sourceLocator],
    modelId: null
  })

  assert.deepEqual(draft.tasks[0]?.fileIntent, {
    schemaVersion: 1,
    bindingRevision: 2,
    inputs: [{
      kind: 'content-space.input-file',
      locator: sourceLocator,
      destinationName: 'agenda.md',
      expectedSemanticRevision: null,
      expectedMediaType: 'text/markdown'
    }],
    output: {
      kind: 'content-space.output-new',
      target: 'project-binding-root',
      mode: 'upload-new',
      fileName: 'summary.md',
      mediaType: 'text/markdown',
      maxBytes: 100_000
    }
  })
  assert.match(JSON.stringify(request?.outputSchema), /"sourceInputIndex"/u)
  assert.doesNotMatch(JSON.stringify(request?.outputSchema), /"identity"/u)
  assert.match(request?.prompt ?? '', /Never copy or invent a locator identity/u)
})

test('immutable Plan submit uses Coordinator Agent authority before Owner confirmation and activation', async () => {
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
      assert.equal(command.expectedAvailabilityRevision, 11)
      assert.equal(command.assigneeAgentId, 'agt_WorkerAgent001')
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
  const port = createProjectCoordinatorPlanPort({
    settings,
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workflowWorkspace(phase, submittedPlan, offeredBundle)
    }),
    getAgentExecution: () => planAgentExecution(),
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
      selectedAgentId: 'agt_WorkerAgent001',
      recommendationReason: 'Owner selected the ready meeting reviewer.'
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

  const activated = await port.confirmAndActivate({
    projectId: assigned.projectId,
    projectPlanId: submitted.plan.projectPlanId,
    expectedProjectRevision: 2,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedPlanRevision: submitted.plan.revision,
    planDigest: submitted.plan.planDigest
  }, 'idem_PlanConfirmTracer01')
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
    availableWorkerGroups: [],
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

function fileWorkspaceFixture() {
  const base = workspaceFixture()
  const now = base.observedAt
  return {
    ...base,
    projects: base.projects.map((project) => ({
      ...project,
      project: {
        ...project.project,
        contentMode: 'required' as const
      },
      provisioning: {
        ...project.provisioning,
        binding: {
          schemaVersion: 1 as const,
          revision: 3,
          createdAt: now,
          updatedAt: now,
          type: 'project_content_space_binding' as const,
          projectContentBindingId: 'pcb_PlanFileBinding01',
          projectId: project.project.projectId,
          contentOwnerUserId: 'usr_Owner0000001',
          providerInstance: {
            schemaVersion: 1 as const,
            type: 'provider_instance_reference' as const,
            providerInstanceRef: 'opencontent.test'
          },
          rootLocator: {
            contractVersion: 1 as const,
            kind: 'content-space.container-reference' as const,
            authority: 'opencontent.test',
            identity: { containerId: 'project-root-1' }
          },
          rootLocatorDigest: 'a'.repeat(64),
          provisioningIntentId: 'pci_PlanFileIntent01',
          provisioningRevision: 2,
          attestationId: 'pca_PlanFileAttest01',
          attestationDigest: 'b'.repeat(64),
          status: 'active' as const,
          statusReason: null,
          activatedAt: now,
          degradedAt: null,
          closedAt: null
        }
      }
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
  const offeredExecution = offeredBundle?.items.find((item) => item.type === 'task_execution')
  return {
    ...base,
    projects: [{
      ...base.projects[0]!,
      project: {
        ...base.projects[0]!.project,
        revision: projectRevision,
        status: phase === 'active' ? 'active' as const : 'paused' as const
      },
      plan: plan ? {
        plan,
        assignments: [{
          planItemId: 'item_meeting_summary',
          selectedAgentId: 'agt_WorkerAgent001',
          recommendationReason: 'Owner selected the ready meeting reviewer.'
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
        ...(offeredTask && offeredExecution
          ? [{ task: offeredTask, executions: [offeredExecution] }]
          : [])
      ]
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
      fileIntent: null,
      currentExecutionId: executionId,
      currentExecutionState: 'offered',
      status: 'offered',
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
      state: 'offered',
      stateRevision: 1,
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
      acceptedAt: null,
      startedAt: null,
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
  const taskId = 'tsk_MeetingSummary01'
  const executionId = 'exe_MeetingSummary01'
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
    fileIntent: null,
    currentExecutionId: executionId,
    currentExecutionState: 'offered',
    status: 'offered',
    executionCount: 1,
    maxRetries: 2,
    completedAt: null,
    revision: 1,
    createdAt: at,
    updatedAt: at
  })
  const execution = taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId: command.projectId,
    taskId,
    executionId,
    attempt: 1,
    offeredByCoordinatorAgentId: 'agt_Coordinator01',
    assigneeUserId: 'usr_Worker000001',
    assigneeAgentId: command.assigneeAgentId,
    assigneeDeviceId: 'dev_WorkerDevice01',
    state: 'offered',
    stateRevision: 1,
    fence: {
      schemaVersion: 1,
      executionId,
      assigneeUserId: 'usr_Worker000001',
      assigneeAgentId: command.assigneeAgentId,
      assigneeDeviceId: 'dev_WorkerDevice01',
      assignmentTaskRevision: 1,
      projectExecutionAuthorityEpoch: command.expectedExecutionAuthorityEpoch,
      userTaskAuthorityEpoch: 1,
      bindingRevision: null,
      status: 'open',
      reason: null,
      fencedAt: null
    },
    fileIntent: null,
    currentResultSubmissionId: null,
    offeredAt: at,
    acceptedAt: null,
    startedAt: null,
    terminalAt: null,
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
    executionId,
    assigneeUserId: 'usr_Worker000001',
    assigneeAgentId: command.assigneeAgentId,
    assigneeDeviceId: 'dev_WorkerDevice01',
    state: 'pending',
    offeredAt: at,
    expiresAt: command.offerExpiresAt,
    respondedAt: null,
    rejectionReason: null,
    safeReasonDetail: null,
    revision: 1,
    createdAt: at,
    updatedAt: at
  })
  return restResponseSchema.parse({
    protocolVersion: '1.0',
    type: 'rest.collection',
    requestId: command.requestId,
    items: [task, execution, offer]
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
        rationale: 'One ready Worker Agent can synthesize the meeting.'
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
