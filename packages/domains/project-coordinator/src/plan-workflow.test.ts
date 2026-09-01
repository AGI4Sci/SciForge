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
import { canonicalTaskIdForPlanItem } from '@sciforge/collaboration-contracts/node'

import {
  createProjectCoordinatorPlanPort,
  defineProjectCoordinatorWorkspacePort,
  ProjectCoordinatorPlanGenerationError
} from './ports.js'
import { createProjectCoordinatorContinuationPort } from './continuation.js'
import { projectCoordinatorWorkspaceSchema } from './contract.js'

test('local Coordinator Runtime creates an editable durable draft with structured output and Worker User assignment', async () => {
  const settings = inMemorySettings()
  const prompts: string[] = []
  const requests: DomainMainAgentExecutionRequest[] = []
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
  assert.match(prompts[0] ?? '', /Budget values as hard Cloud upper bounds.*do not fill the budget/iu)
  assert.match(
    prompts[0] ?? '',
    /logical Plan declaration selection.*Never include a schemaVersion or bindingRevision/su
  )
  assert.doesNotMatch(prompts[0] ?? '', /declare bindingRevision 1/u)
  assert.doesNotMatch(prompts[0] ?? '', /runtimeCapabilityTags/u)
  assert.match(prompts[0] ?? '', /Do not emit id, description, assignee, dependencies, status/u)
  assert.match(prompts[0] ?? '', /role|sub.?topic/iu)
  assert.match(prompts[0] ?? '', /human-reviewable draft/iu)
  assert.match(prompts[0] ?? '', /recommend.*Task.*role|sub.?question/isu)
  assert.match(prompts[0] ?? '', /supporting deliverables.*completionCriteria or rationale.*separate ownership/isu)
  assert.match(prompts[0] ?? '', /not a fixed expert or task count.*cardinality limit/isu)
  assert.match(prompts[0] ?? '', /Human Coordinator.*Plan Draft.*before submission.*add.*remove.*combine.*split.*reassign/isu)
  assert.match(prompts[0] ?? '', /bounded.*decomposition.*Human review/isu)
  assert.doesNotMatch(prompts[0] ?? '', /keep the total at 3.?5|never exceed 5/isu)
  assert.doesNotMatch(prompts[0] ?? '', /exactly one Task per explicitly listed Worker role/iu)
  assert.doesNotMatch(prompts[0] ?? '', /Never create separate Tasks for deliverables, metrics, risks, actions, phases, or report sections/iu)
  assert.doesNotMatch(prompts[0] ?? '', /emit exactly one bounded Task/iu)
  assert.match(prompts[0] ?? '', /Conclusion.*Evidence.*Recommendation/isu)
  assert.match(prompts[0] ?? '', /design-analysis-only|does not execute.*experiment/isu)
  assert.match(prompts[0] ?? '', /Coordinator final summary.*overall design.*quantitative success metrics.*Hard constraints.*Risks.*Human confirmation/isu)
  assert.match(prompts[0] ?? '', /proposed design sequence.*unexecuted|simulation.*experiment.*feedback.*completed/isu)
  const generatedRequest = requests[0] as DomainMainAgentExecutionRequest & {
    outputSchema?: Readonly<Record<string, unknown>>
  }
  assert.equal(generatedRequest.clientDirectiveId, 'project-plan:v2:prj_ProjectCreated01:1')
  assert.equal(generatedRequest.outputSchema?.type, 'object')
  assert.match(JSON.stringify(generatedRequest.outputSchema), /"planItemId"/u)
  assert.match(JSON.stringify(generatedRequest.outputSchema), /"completionCriteria"/u)
  assert.match(JSON.stringify(generatedRequest.outputSchema), /"dependencyPlanItemIds"/u)
  assert.doesNotMatch(JSON.stringify(generatedRequest.outputSchema), /"assignee"/u)
  assert.doesNotMatch(JSON.stringify(generatedRequest.outputSchema), /"propertyNames"/u)
  assert.doesNotMatch(JSON.stringify(generatedRequest.outputSchema), /"\$ref"/u)
  assert.doesNotMatch(JSON.stringify(generatedRequest.outputSchema), /"definitions"/u)

  const edited = await port.editDraft({
    projectId: generated.projectId,
    draftId: generated.draftId,
    expectedDraftRevision: generated.draftRevision,
    // Read projections expose these CAS guards and agents may safely echo them
    // back when editing the draft.
    expectedProjectRevision: generated.expectedProjectRevision,
    expectedCoordinatorAuthorityEpoch: generated.expectedCoordinatorAuthorityEpoch,
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
    expectedProjectRevision: edited.expectedProjectRevision + 1,
    expectedCoordinatorAuthorityEpoch: edited.expectedCoordinatorAuthorityEpoch,
    tasks: edited.tasks,
    rationale: edited.rationale,
    assignments: edited.assignments
  }), /Project revision conflict/u)

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

test('repeated Plan generation keeps the latest successful task decomposition', async () => {
  const settings = inMemorySettings()
  const workspace = planningWorkspaceFixture('draft')
  let runCount = 0
  let firstStarted!: () => void
  const firstStartedPromise = new Promise<void>((resolve) => { firstStarted = resolve })
  let releaseFirst!: () => void
  const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve })
  const execution: DomainMainAgentExecutionHost = {
    run: async () => {
      runCount += 1
      if (runCount === 1) {
        firstStarted()
        await firstResponse
        return planGenerationResponse('Older decomposition')
      }
      return planGenerationResponse('Latest decomposition')
    }
  }
  const port = createProjectCoordinatorPlanPort({
    settings,
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspace
    }),
    getAgentExecution: () => execution,
    continuation: {
      reconcileProject: async () => workspace,
      reconcileVisibleProjects: async () => undefined
    },
    now: () => new Date('2026-08-25T01:06:00.000Z')
  })
  const request = {
    projectId: 'prj_ProjectCreated01',
    instruction: 'Split the current goal into reviewable tasks.',
    sourceInputLocators: [],
    modelId: null
  }

  const older = port.generateDraft(request)
  await firstStartedPromise
  const latest = await port.generateDraft(request)
  releaseFirst()
  const olderResult = await older

  assert.equal(latest.tasks[0]?.title, 'Latest decomposition')
  assert.deepEqual(olderResult, latest)
  assert.deepEqual(await port.readDraft({ projectId: request.projectId }), latest)
  assert.equal(latest.draftRevision, 1)
})

test('an invalid retry never removes an existing valid Plan draft', async () => {
  const settings = inMemorySettings()
  const workspace = planningWorkspaceFixture('draft')
  let runCount = 0
  const execution: DomainMainAgentExecutionHost = {
    run: async () => {
      runCount += 1
      return runCount === 1
        ? planGenerationResponse('Valid decomposition')
        : {
            runtimeId: 'codex-runtime',
            threadId: 'thread-plan-draft-invalid',
            turnId: 'turn-plan-draft-invalid',
            state: 'completed' as const,
            text: '{not-json'
          }
    }
  }
  const port = createProjectCoordinatorPlanPort({
    settings,
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspace
    }),
    getAgentExecution: () => execution,
    continuation: {
      reconcileProject: async () => workspace,
      reconcileVisibleProjects: async () => undefined
    },
    now: () => new Date('2026-08-25T01:06:00.000Z')
  })
  const request = {
    projectId: 'prj_ProjectCreated01',
    instruction: 'Split the current goal into reviewable tasks.',
    sourceInputLocators: [],
    modelId: null
  }

  const valid = await port.generateDraft(request)
  await assert.rejects(
    () => port.generateDraft(request),
    (error: unknown) => error instanceof ProjectCoordinatorPlanGenerationError &&
      error.reason === 'invalid_structured_output'
  )
  assert.deepEqual(await port.readDraft({ projectId: request.projectId }), valid)
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
    (error: unknown) => error instanceof ProjectCoordinatorPlanGenerationError &&
      error.reason === 'planning_candidates_unavailable'
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
    (error: unknown) => error instanceof ProjectCoordinatorPlanGenerationError &&
      error.reason === 'planning_candidates_unavailable'
  )
  assert.equal(runtimeRuns, 0)
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
            assignee: 'usr_Worker000001',
            dependencies: [],
            status: 'pending'
          }],
          rationale: 'Assign the available Worker User.'
        })
      })
    }),
    continuation: {
      reconcileProject: async () => workspaceFixture(),
      reconcileVisibleProjects: async () => undefined
    },
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

test('file Plan output selects an exact caller locator without predicting a binding revision', async () => {
  const settings = inMemorySettings()
  const workspace = fileReadyWorkspaceFixture()
  const sourceLocator = {
    contractVersion: 1 as const,
    kind: 'content-space.file-reference' as const,
    authority: 'opencontent.run0',
    identity: { fileId: 'source-file-001' }
  }
  let request: DomainMainAgentExecutionRequest | undefined
  const port = createProjectCoordinatorPlanPort({
    settings,
    workspace: defineProjectCoordinatorWorkspacePort({
      readWorkspace: async () => workspace
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
              planItemId: 'item_review_file',
              title: 'Review source file',
              objective: 'Read the exact shared input and write a bounded review.',
              completionCriteria: ['One review file is uploaded to the Project root.'],
              dependencyPlanItemIds: [],
              requiredCapabilityTags: ['meeting.review'],
              fileIntent: {
                inputs: [{
                  sourceInputIndex: 0,
                  destinationName: 'source.md',
                  expectedSemanticRevision: 'revision-7',
                  expectedMediaType: 'text/markdown'
                }],
                dependencyInputs: [],
                output: {
                  fileName: 'review.md',
                  mediaType: 'text/markdown',
                  maxBytes: 65_536
                }
              }
            }],
            rationale: 'The file-ready Worker Runtime can review the exact shared input.'
          })
        }
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
    instruction: 'Review the shared source file.',
    sourceInputLocators: [sourceLocator],
    modelId: null
  })

  assert.equal('bindingRevision' in (draft.tasks[0]?.fileIntent ?? {}), false)
  assert.deepEqual(draft.tasks[0]?.fileIntent?.inputs[0]?.locator, sourceLocator)
  assert.match(
    request?.prompt ?? '',
    /logical Plan declaration selection.*Never include a schemaVersion or bindingRevision/su
  )
  assert.match(request?.prompt ?? '', /Never copy or invent a locator identity/u)
  const outputSchema = JSON.stringify(request?.outputSchema)
  assert.match(outputSchema, /"sourceInputIndex"/u)
  assert.doesNotMatch(outputSchema, /"identity"/u)
})

test('Plan confirmation keeps the Project paused until the canonical workflow activates and reconciles', async () => {
  const settings = inMemorySettings()
  let phase: 'draft' | 'submitted' | 'confirmed' | 'active' = 'draft'
  let submittedPlan: ProjectPlan | undefined
  let offeredBundle: Extract<RestResponse, { type: 'rest.collection' }> | undefined
  const coordinatorCommands: unknown[] = []
  const userCommands: unknown[] = []
  const coordinatorCloudCommands: CoordinatorCloudCommandService = {
    resume: async () => null,
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
      assert.equal('workerUserId' in command, false)
      offeredBundle = taskOfferResponse(command, submittedPlan!)
      return offeredBundle
    },
    subscribe: () => () => undefined
  }
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.run0.invalid/',
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001',
      deviceRevision: 1
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
    submitted.workspace.projects[0]?.plan?.plan.tasks,
    submitted.plan.tasks
  )
  assert.deepEqual(submitted.plan.tasks.map(({ planItemId, workerUserId }) => ({
    planItemId,
    workerUserId
  })), assigned.assignments.map(({ planItemId, workerUserId }) => ({
    planItemId,
    workerUserId
  })))
  assert.equal(submitCommand.planDigest, stableDigest({
    projectId: assigned.projectId,
    expectedProjectRevision: assigned.expectedProjectRevision,
    expectedCoordinatorAuthorityEpoch: assigned.expectedCoordinatorAuthorityEpoch,
    supersedesProjectPlanId: assigned.supersedesProjectPlanId,
    sourceInputLocators: assigned.sourceInputLocators,
    tasks: assigned.tasks.map((task) => ({
      ...task,
      workerUserId: assigned.assignments.find(({ planItemId }) => (
        planItemId === task.planItemId
      ))!.workerUserId
    })),
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
              state: 'suspended' as const,
              authorityEpoch: 1,
              reason: 'project_paused' as const,
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

function fileReadyWorkspaceFixture() {
  const base = workspaceFixture()
  const project = base.projects[0]!
  const agent = project.workerGroups[0]!.agents[0]!
  const createdAt = project.project.createdAt
  const updatedAt = project.project.updatedAt
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
    principalId: 'worker-principal-001'
  }
  const providerPrincipalFact = {
    schemaVersion: 1 as const,
    revision: 2,
    createdAt,
    updatedAt,
    type: 'provider_directory_principal_fact' as const,
    providerPrincipalFactId: 'ppf_WorkerFile0001',
    userId: 'usr_Worker000001',
    providerPrincipal,
    principalIdentityRevision: 1,
    providerBindingAttestationDigest: 'a'.repeat(64),
    publishedByDeviceId: 'dev_WorkerDevice01',
    readiness: 'ready' as const,
    readinessReason: null,
    observedAt: updatedAt
  }
  const contentReadiness = {
    schemaVersion: 1 as const,
    revision: 4,
    createdAt,
    updatedAt,
    type: 'project_content_readiness' as const,
    projectId: 'prj_ProjectCreated01',
    userId: 'usr_Worker000001',
    providerInstance,
    state: 'ready' as const,
    reason: null,
    providerPrincipalFactId: providerPrincipalFact.providerPrincipalFactId,
    snapshottedFactRevision: providerPrincipalFact.revision,
    providerPrincipal,
    bindingRevision: 3,
    lastObservationId: 'pob_WorkerFile0001',
    effectiveAt: updatedAt
  }
  const binding = {
    schemaVersion: 1 as const,
    revision: 3,
    createdAt,
    updatedAt,
    type: 'project_content_space_binding' as const,
    projectContentBindingId: 'pcb_WorkerFile0001',
    projectId: 'prj_ProjectCreated01',
    contentOwnerUserId: 'usr_Owner0000001',
    providerInstance,
    rootLocator: {
      contractVersion: 1 as const,
      kind: 'content-space.container-reference' as const,
      authority: 'opencontent.run0',
      identity: { folderId: 'project-root-001' }
    },
    rootLocatorDigest: 'b'.repeat(64),
    provisioningIntentId: 'pci_WorkerFile0001',
    provisioningRevision: 2,
    attestationId: 'pca_WorkerFile0001',
    attestationDigest: 'c'.repeat(64),
    status: 'active' as const,
    statusReason: null,
    activatedAt: createdAt,
    degradedAt: null,
    closedAt: null
  }
  const fileAuthority = {
    ...agent.projectAvailability.taskAuthorities[0]!,
    taskAuthorityId: 'tau_WorkerFile0001',
    scope: 'file_tasks' as const
  }

  return projectCoordinatorWorkspaceSchema.parse({
    ...base,
    projects: [{
      ...project,
      project: {
        ...project.project,
        contentMode: 'required'
      },
      workerGroups: [{
        ...project.workerGroups[0]!,
        agents: [{
          ...agent,
          projectAvailability: {
            ...agent.projectAvailability,
            taskAuthorities: [
              ...agent.projectAvailability.taskAuthorities,
              fileAuthority
            ],
            providerPrincipalFact,
            providerPrincipalSnapshotStatus: 'match',
            contentReadiness
          }
        }]
      }],
      provisioning: {
        ...project.provisioning,
        binding,
        providerPrincipalFacts: [providerPrincipalFact],
        contentReadiness: [contentReadiness]
      }
    }]
  })
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
        plan
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
>, plan: ProjectPlan): Extract<RestResponse, { type: 'rest.collection' }> {
  const at = '2026-08-25T01:06:00.000Z'
  const taskId = canonicalTaskIdForPlanItem(command.projectPlanId, command.planItemId)
  const planItem = plan.tasks.find(({ planItemId }) => planItemId === command.planItemId)
  if (!planItem) throw new Error('Unknown Plan item.')
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
    workerUserId: planItem.workerUserId,
    offeredByCoordinatorAgentId: 'agt_Coordinator01',
    state: 'pending',
    reassignmentTaskRevision: null,
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

function planGenerationResponse(title: string): Awaited<ReturnType<DomainMainAgentExecutionHost['run']>> {
  return {
    runtimeId: 'codex-runtime',
    threadId: `thread-plan-draft-${title.replace(/[^A-Za-z0-9]+/gu, '-').toLowerCase()}`,
    turnId: `turn-plan-draft-${title.replace(/[^A-Za-z0-9]+/gu, '-').toLowerCase()}`,
    state: 'completed',
    text: JSON.stringify({
      tasks: [{
        planItemId: 'item_generated',
        title,
        objective: 'Produce a bounded decomposition for review.',
        completionCriteria: ['Owner can review the generated task.'],
        dependencyPlanItemIds: [],
        requiredCapabilityTags: ['meeting.review'],
        fileIntent: null
      }],
      rationale: 'The current Worker User can review this decomposition.'
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
