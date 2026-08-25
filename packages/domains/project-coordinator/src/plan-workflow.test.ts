import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { CoordinatorCloudCommandService } from '@sciforge/domain-collaboration/coordinator-cloud-command'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/agent-execution'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import type { ProjectPlan } from '@sciforge/collaboration-contracts'

import {
  createProjectCoordinatorPlanPort,
  defineProjectCoordinatorWorkspacePort
} from './ports.js'
import { ProjectCoordinatorStateStore } from './state.js'

test('local Coordinator Runtime creates an editable durable Plan draft with exact Agent assignment', async () => {
  const settings = inMemorySettings()
  const prompts: string[] = []
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
  }), /exact visible Agent/u)
})

test('immutable Plan submit uses Coordinator Agent authority before Owner confirmation and activation', async () => {
  const settings = inMemorySettings()
  let phase: 'draft' | 'submitted' | 'confirmed' | 'active' = 'draft'
  let submittedPlan: ProjectPlan | undefined
  const coordinatorCommands: unknown[] = []
  const userCommands: unknown[] = []
  const coordinatorCloudCommands: CoordinatorCloudCommandService = {
    execute: async (command) => {
      coordinatorCommands.push(command)
      assert.equal(command.type, 'project.plan.submit')
      if (command.type !== 'project.plan.submit') throw new Error('Unexpected command.')
      submittedPlan = submittedPlanFixture(command)
      phase = 'submitted'
      return {
        protocolVersion: '1.0',
        type: 'rest.entity',
        requestId: command.requestId,
        entity: submittedPlan
      }
    }
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
      readWorkspace: async () => workflowWorkspace(phase, submittedPlan)
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
  assert.deepEqual((userCommands as Array<{ type: string }>).map(({ type }) => type), [
    'project.plan.confirm',
    'project.transition'
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
            membership: null,
            taskAuthorities: [],
            providerPrincipalFact: null,
            providerPrincipalSnapshotStatus: 'not_applicable' as const,
            contentReadiness: null,
            observedAt: updatedAt
          }
        }]
      }],
      tasks: [],
      reviews: [],
      provisioning: {
        intent: null,
        attestation: null,
        binding: null,
        recoveryActions: []
      }
    }]
  }
}

function workflowWorkspace(
  phase: 'draft' | 'submitted' | 'confirmed' | 'active',
  plan: ProjectPlan | undefined
) {
  const base = workspaceFixture()
  const projectRevision = phase === 'draft' ? 1 : phase === 'submitted' ? 2 : phase === 'confirmed' ? 3 : 4
  return {
    ...base,
    projects: [{
      ...base.projects[0]!,
      project: {
        ...base.projects[0]!.project,
        revision: projectRevision,
        status: phase === 'active' ? 'active' as const : 'paused' as const
      },
      plan: plan ? { plan, assignments: [] } : null
    }]
  }
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
