import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import type { ProjectCoordinatorProject } from '../contract.js'

import {
  PROJECT_COORDINATOR_I18N_CONTRIBUTION,
  PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION,
  PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION,
  PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION
} from '../definition.js'
import {
  PROJECT_COORDINATOR_PANEL_SECTION_IDS,
  ProjectCoordinatorDecisionSection,
  ProjectCoordinatorPanel,
  ProjectCoordinatorPlanSection,
  ProjectCoordinatorProvisioningSection,
  ProjectCoordinatorTransferSection,
  projectCoordinatorCompletionInput,
  projectCoordinatorCreatedSelection,
  projectCoordinatorProvisioningApplyInput,
  projectCoordinatorResultReviewInput,
  projectCoordinatorTransferCandidates
} from './ProjectCoordinatorPanel.js'
import { createProjectCoordinatorRendererClient } from './project-coordinator-capability-client.js'
import {
  createDomainRendererEntry,
  createProjectCoordinatorOpenCommand
} from './index.js'

test('renderer entry owns one generic Workbench surface without Identity UI contributions', () => {
  const host = rendererHost([])
  const entry = createDomainRendererEntry(host)
  assert.equal(entry.process, 'renderer')
  assert.deepEqual(
    entry.contributions.map(({ id }) => id),
    [
      PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      PROJECT_COORDINATOR_OPEN_COMMAND_CONTRIBUTION.id,
      PROJECT_COORDINATOR_TOOLBAR_ACTION_CONTRIBUTION.id,
      PROJECT_COORDINATOR_I18N_CONTRIBUTION.id
    ]
  )
  const panelContribution = entry.contributions.find(
    ({ id }) => id === PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id
  )!
  const panel = panelContribution.value as Readonly<{
    render(input: {
      active: boolean
      focused: boolean
      surfaceId: string
      className: string
      onCollapse(): void
      session: { id: string }
      activation: {
        contributionId: string
        revision: number
        payload: { projectId: string }
      }
    }): ReactElement<Record<string, unknown>>
  }>
  const rendered = panel.render({
    active: true,
    focused: true,
    surfaceId: 'surface-1',
    className: 'fixture-panel',
    onCollapse: () => undefined,
    session: { id: 'session-1' },
    activation: {
      contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      revision: 1,
      payload: { projectId: 'prj_Project000001' }
    }
  })
  assert.equal(rendered.props.initialProjectId, 'prj_Project000001')
  assert.equal(rendered.props.className, 'fixture-panel')
})

test('panel surface is limited to Coordinator, Plan, Worker, Task, review, and provisioning HCI', () => {
  assert.deepEqual(PROJECT_COORDINATOR_PANEL_SECTION_IDS, [
    'coordinator',
    'plan',
    'workers',
    'tasks',
    'reviews',
    'provisioning'
  ])
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorPanel, {
    client: {
      readWorkspace: async () => ({
        connection: { state: 'identity_required' as const },
        observedAt: '2026-08-24T09:00:00.000Z',
        projects: []
      }),
      createProject: async () => { throw new Error('unused') },
      readPlanDraft: async () => null,
      generatePlanDraft: async () => { throw new Error('unused') },
      editPlanDraft: async () => { throw new Error('unused') },
      submitPlanDraft: async () => { throw new Error('unused') },
      confirmPlanAndActivate: async () => { throw new Error('unused') },
      previewProvisioning: async () => { throw new Error('unused') },
      applyProvisioning: async () => { throw new Error('unused') },
      addMember: async () => { throw new Error('unused') },
      removeMember: async () => { throw new Error('unused') },
      observeAndLinkRecovery: async () => { throw new Error('unused') },
      abandonRecovery: async () => { throw new Error('unused') },
      retryRecoverySuccessor: async () => { throw new Error('unused') },
      createHumanNeeded: async () => { throw new Error('unused') },
      answerHumanNeeded: async () => { throw new Error('unused') },
      transferCoordinator: async () => { throw new Error('unused') },
      reviewResult: async () => { throw new Error('unused') },
      completeProject: async () => { throw new Error('unused') }
    },
    session: { id: 'session-1' }
  }))
  for (const sectionId of PROJECT_COORDINATOR_PANEL_SECTION_IDS) {
    assert.match(markup, new RegExp(`data-coordinator-section="${sectionId}"`, 'u'))
  }
  assert.doesNotMatch(markup, /password|access token|refresh token|register agent|enroll device/iu)
})

test('Coordinator transfer HCI is Owner-only, exact-Agent, and shows the old authority fence', () => {
  const project = coordinatorTransferProjectFixture()
  assert.deepEqual(
    projectCoordinatorTransferCandidates(project).map(({ projectAvailability }) => (
      projectAvailability.agentId
    )),
    ['agt_OwnerSuccessor1']
  )
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorTransferSection, {
    project,
    canTransfer: true,
    busy: false,
    onTransfer: () => undefined
  }))
  assert.match(markup, /projectCoordinatorTransferTitle/u)
  assert.match(markup, /agt_OwnerSuccessor1/u)
  assert.match(markup, /projectCoordinatorAuthorityTransferredOut/u)
  assert.doesNotMatch(markup, /agt_MemberAgent001/u)
})

test('command focuses an exact Project through the generic panel activation contract', () => {
  const opened: unknown[] = []
  const command = createProjectCoordinatorOpenCommand(rendererHost(opened))
  command.execute({
    sessionId: 'session-1',
    payload: { projectId: 'prj_Project000001' }
  })
  assert.deepEqual(opened, [{
    contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
    sessionId: 'session-1',
    activation: {
      contributionId: PROJECT_COORDINATOR_RIGHT_PANEL_CONTRIBUTION.id,
      revision: 1,
      payload: { projectId: 'prj_Project000001' }
    }
  }])
})

test('renderer Project create applies the exact Cloud-returned workspace focus without guessing latest', async () => {
  const invoked: unknown[] = []
  const returnedWorkspace = {
    connection: {
      state: 'ready' as const,
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001'
    },
    observedAt: '2026-08-25T01:08:00.000Z',
    focusedProjectId: 'prj_ProjectCreated01',
    projects: [awaitingConfirmationProjectFixture()]
  }
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input) => {
      invoked.push({ actionId: contract.actionId, effect: contract.effect, input })
      return {
        createdProjectId: 'prj_ProjectCreated01',
        workspace: returnedWorkspace
      } as never
    }
  })
  const result = await client.createProject({
    displayName: 'Meeting',
    goal: 'Run a realistic meeting.',
    coordinatorAgentId: 'agt_Coordinator01',
    expectedCoordinatorAgentRevision: 1,
    budget: {
      maxTasks: 4,
      maxTasksPerRound: 4,
      maxTaskRetries: 1,
      maxCoordinationRounds: 2
    },
    content: { mode: 'none', members: [{ userId: 'usr_Owner0000001' }] }
  })

  assert.deepEqual(projectCoordinatorCreatedSelection(result), {
    workspace: result.workspace,
    selectedProjectId: 'prj_ProjectCreated01'
  })
  assert.deepEqual(invoked, [{
    actionId: 'project-coordinator.project.create',
    effect: 'external-write',
    input: {
      displayName: 'Meeting',
      goal: 'Run a realistic meeting.',
      coordinatorAgentId: 'agt_Coordinator01',
      expectedCoordinatorAgentRevision: 1,
      budget: {
        maxTasks: 4,
        maxTasksPerRound: 4,
        maxTaskRetries: 1,
        maxCoordinationRounds: 2
      },
      content: { mode: 'none', members: [{ userId: 'usr_Owner0000001' }] }
    }
  }])
})

test('renderer Coordinator transfer invokes one governed Owner command without caller-authored CAS facts', async () => {
  const invoked: unknown[] = []
  const workspace = {
    connection: {
      state: 'ready' as const,
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001'
    },
    observedAt: '2026-08-25T01:08:00.000Z',
    focusedProjectId: 'prj_ProjectCreated01',
    projects: [awaitingConfirmationProjectFixture()]
  }
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input) => {
      invoked.push({ actionId: contract.actionId, effect: contract.effect, input })
      return workspace as never
    }
  })

  await client.transferCoordinator({
    projectId: 'prj_ProjectCreated01',
    coordinatorAgentId: 'agt_OwnerSuccessor1'
  })

  assert.deepEqual(invoked, [{
    actionId: 'project-coordinator.coordinator.transfer',
    effect: 'external-write',
    input: {
      projectId: 'prj_ProjectCreated01',
      coordinatorAgentId: 'agt_OwnerSuccessor1'
    }
  }])
})

test('renderer decision HCI invokes only the four governed canonical actions', async () => {
  const invoked: unknown[] = []
  const workspace = {
    connection: { state: 'ready' as const, userId: 'usr_Owner0000001', deviceId: 'dev_Device0000001' },
    observedAt: '2026-08-25T01:08:00.000Z',
    focusedProjectId: 'prj_ProjectCreated01',
    projects: [awaitingConfirmationProjectFixture()]
  }
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input) => {
      invoked.push({ actionId: contract.actionId, effect: contract.effect, input })
      return workspace as never
    }
  })

  await client.createHumanNeeded({
    projectId: 'prj_ProjectCreated01',
    expectedProjectRevision: 2,
    expectedCoordinatorAuthorityEpoch: 1,
    requiredAssurance: 'verified',
    prompt: 'Choose the lower-risk training direction.',
    expiresAt: '2026-08-26T01:08:00.000Z'
  })
  await client.answerHumanNeeded({
    projectId: 'prj_ProjectCreated01',
    humanRequestId: 'hrq_OwnerDecision01',
    requestRevision: 1,
    answer: 'Use the lower-risk direction.'
  })
  await client.reviewResult({
    projectId: 'prj_ProjectCreated01',
    taskId: 'tsk_MeetingTask001',
    executionId: 'exe_MeetingExec001',
    resultSubmissionId: 'rsu_MeetingResult01',
    expectedProjectRevision: 2,
    expectedTaskRevision: 3,
    expectedExecutionRevision: 4,
    expectedResultRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    decision: 'accept',
    instruction: null,
    nextAssigneeAgentId: null,
    expectedNextAssigneeAvailabilityRevision: null,
    nextOfferExpiresAt: null,
    nextFileIntent: null
  })
  await client.completeProject({
    projectId: 'prj_ProjectCreated01',
    expectedProjectRevision: 3,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    projectPlanId: 'pln_MeetingPlan001',
    confirmedPlanRevision: 2,
    acceptedResultSubmissionIds: ['rsu_MeetingResult01'],
    summary: 'Resolved the work, recorded the decision, and assigned the next step.'
  })

  assert.deepEqual(invoked.map((entry) => (
    entry as { actionId: string; effect: string }
  )).map(({ actionId, effect }) => ({ actionId, effect })), [
    { actionId: 'project-coordinator.human-needed.create', effect: 'external-write' },
    { actionId: 'project-coordinator.human-needed.answer', effect: 'external-write' },
    { actionId: 'project-coordinator.result.review', effect: 'external-write' },
    { actionId: 'project-coordinator.project.complete', effect: 'external-write' }
  ])
})

test('renderer provisioning client keeps the reviewed full plan behind its confirmed digest', async () => {
  const invoked: unknown[] = []
  const plan = provisioningPlanFixture()
  const workspace = {
    connection: { state: 'ready' as const, userId: 'usr_Owner0000001', deviceId: 'dev_Device0000001' },
    observedAt: '2026-08-25T01:08:00.000Z',
    focusedProjectId: 'prj_ProjectCreated01',
    projects: [contentProvisioningProjectFixture()]
  }
  const client = createProjectCoordinatorRendererClient({
    observe: async () => { throw new Error('not observed') },
    invoke: async (contract, input) => {
      invoked.push({ actionId: contract.actionId, effect: contract.effect, input })
      return (contract.actionId === 'project-coordinator.content-provisioning.plan'
        ? plan
        : workspace) as never
    }
  })

  const reviewed = await client.previewProvisioning({ projectId: plan.projectId })
  await client.applyProvisioning(projectCoordinatorProvisioningApplyInput(reviewed))
  await client.addMember({
    projectId: plan.projectId,
    expectedProjectRevision: 3,
    userId: 'usr_NewWorker00001',
    providerPrincipalFactId: 'ppf_NewWorker00001',
    expectedProviderPrincipalFactRevision: 2
  })
  await client.removeMember({
    projectId: plan.projectId,
    projectMembershipId: 'pmb_WorkerMember01',
    expectedProjectRevision: 4,
    expectedMembershipRevision: 2
  })
  await client.observeAndLinkRecovery({
    projectId: plan.projectId,
    recoveryActionId: 'rca_TaskRecovery001'
  })
  await client.abandonRecovery({
    projectId: plan.projectId,
    recoveryActionId: 'rca_TaskRecovery001',
    reason: 'The exact output cannot be verified.'
  })
  await client.retryRecoverySuccessor({
    projectId: plan.projectId,
    recoveryActionId: 'rca_TaskRecovery001',
    assigneeAgentId: 'agt_WorkerAgent001',
    nextOutputFileName: 'meeting-summary.recovery-2.md',
    offerExpiresAt: '2026-08-27T01:08:00.000Z'
  })

  assert.deepEqual(invoked, [
    {
      actionId: 'project-coordinator.content-provisioning.plan',
      effect: 'read',
      input: { projectId: plan.projectId }
    },
    {
      actionId: 'project-coordinator.content-provisioning.apply',
      effect: 'external-write',
      input: {
        projectId: plan.projectId,
        provisioningIntentId: plan.provisioningIntentId,
        expectedProjectRevision: plan.expectedProjectRevision,
        expectedProvisioningRevision: plan.expectedProvisioningRevision,
        expectedProvisioningIntentRevision: plan.expectedProvisioningIntentRevision,
        intentDigest: plan.intentDigest,
        attemptId: plan.attemptId,
        confirmedPlanDigest: plan.confirmedPlanDigest
      }
    },
    {
      actionId: 'project-coordinator.membership.add',
      effect: 'external-write',
      input: {
        projectId: plan.projectId,
        expectedProjectRevision: 3,
        userId: 'usr_NewWorker00001',
        providerPrincipalFactId: 'ppf_NewWorker00001',
        expectedProviderPrincipalFactRevision: 2
      }
    },
    {
      actionId: 'project-coordinator.membership.remove',
      effect: 'destructive',
      input: {
        projectId: plan.projectId,
        projectMembershipId: 'pmb_WorkerMember01',
        expectedProjectRevision: 4,
        expectedMembershipRevision: 2
      }
    },
    {
      actionId: 'project-coordinator.content-recovery.observe-link',
      effect: 'external-write',
      input: {
        projectId: plan.projectId,
        recoveryActionId: 'rca_TaskRecovery001'
      }
    },
    {
      actionId: 'project-coordinator.content-recovery.abandon',
      effect: 'destructive',
      input: {
        projectId: plan.projectId,
        recoveryActionId: 'rca_TaskRecovery001',
        reason: 'The exact output cannot be verified.'
      }
    },
    {
      actionId: 'project-coordinator.content-recovery.retry-successor',
      effect: 'external-write',
      input: {
        projectId: plan.projectId,
        recoveryActionId: 'rca_TaskRecovery001',
        assigneeAgentId: 'agt_WorkerAgent001',
        nextOutputFileName: 'meeting-summary.recovery-2.md',
        offerExpiresAt: '2026-08-27T01:08:00.000Z'
      }
    }
  ])
  assert.equal('operations' in (invoked[1] as { input: object }).input, false)
})

test('content-required provisioning, membership fences, and root recovery are default-visible HCI', () => {
  const project = contentProvisioningProjectFixture()
  const pendingMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorProvisioningSection, {
    project,
    plan: null,
    busy: false,
    onPreview: () => undefined,
    onApply: () => undefined,
    onAddMember: () => undefined,
    onRemoveMember: () => undefined,
    onObserveAndLinkRecovery: () => undefined,
    onAbandonRecovery: () => undefined,
    onRetryRecoverySuccessor: () => undefined
  }))
  assert.match(pendingMarkup, /data-default-visible-card="content-provisioning"/u)
  assert.match(pendingMarkup, /projectCoordinatorPreviewProvisioning/u)
  assert.match(pendingMarkup, /pending_membership/u)
  assert.match(pendingMarkup, /membership_removal_pending/u)
  assert.match(pendingMarkup, /projectCoordinatorTaskAuthoritySuspended/u)
  assert.match(pendingMarkup, /projectCoordinatorAddMember/u)
  assert.match(pendingMarkup, /projectCoordinatorRemoveMember/u)

  const reviewedMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorProvisioningSection, {
    project,
    plan: provisioningPlanFixture(),
    busy: false,
    onPreview: () => undefined,
    onApply: () => undefined,
    onAddMember: () => undefined,
    onRemoveMember: () => undefined,
    onObserveAndLinkRecovery: () => undefined,
    onAbandonRecovery: () => undefined,
    onRetryRecoverySuccessor: () => undefined
  }))
  assert.match(reviewedMarkup, /data-default-visible-card="content-provisioning-confirmation"/u)
  assert.match(reviewedMarkup, /content-space\.authorize-provider-administration/u)
  assert.match(reviewedMarkup, /content-space\.agent-admin-add-member/u)
  assert.match(reviewedMarkup, /projectCoordinatorApplyProvisioning/u)
  assert.match(reviewedMarkup, new RegExp(provisioningPlanFixture().confirmedPlanDigest, 'u'))

  const degraded = {
    ...project,
    provisioning: {
      ...project.provisioning,
      binding: {
        provisioningRevision: 1,
        status: 'degraded',
        statusReason: 'owner_access_lost'
      },
      recoveryActions: [{
        recoveryActionId: 'rca_RootRecovery001',
        projectId: project.project.projectId,
        taskId: null,
        executionId: null,
        journalEntryId: 'crj_RootRecovery001',
        audience: 'owner',
        action: 'rebind_content_root',
        status: 'available',
        requiresFreshObservation: true,
        safeSummary: 'Re-authorize the exact shared root before retrying membership changes.'
      }]
    }
  } as never
  const recoveryMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorProvisioningSection, {
    project: degraded,
    plan: null,
    busy: false,
    onPreview: () => undefined,
    onApply: () => undefined,
    onAddMember: () => undefined,
    onRemoveMember: () => undefined,
    onObserveAndLinkRecovery: () => undefined,
    onAbandonRecovery: () => undefined,
    onRetryRecoverySuccessor: () => undefined
  }))
  assert.match(recoveryMarkup, /data-default-visible-card="content-recovery"/u)
  assert.match(recoveryMarkup, /owner_access_lost/u)
  assert.match(recoveryMarkup, /Re-authorize the exact shared root/u)
  assert.match(recoveryMarkup, /projectCoordinatorPreviewReconcile/u)

  const taskRecovery = {
    ...project,
    provisioning: {
      ...project.provisioning,
      recoveryActions: [{
        recoveryActionId: 'rca_TaskRecovery001',
        projectId: project.project.projectId,
        taskId: 'tsk_RecoveryTask001',
        executionId: 'exe_RecoveryExec001',
        journalEntryId: 'crj_TaskRecovery001',
        audience: 'coordinator',
        action: 'link_observed_output',
        status: 'available',
        requiresFreshObservation: true,
        safeSummary: 'Observe the exact output or abandon this execution.'
      }]
    }
  } as never
  const taskRecoveryMarkup = renderToStaticMarkup(createElement(
    ProjectCoordinatorProvisioningSection,
    {
      project: taskRecovery,
      plan: null,
      busy: false,
      onPreview: () => undefined,
      onApply: () => undefined,
      onAddMember: () => undefined,
      onRemoveMember: () => undefined,
      onObserveAndLinkRecovery: () => undefined,
      onAbandonRecovery: () => undefined,
      onRetryRecoverySuccessor: () => undefined
    }
  ))
  assert.match(taskRecoveryMarkup, /data-task-recovery-action="rca_TaskRecovery001"/u)
  assert.match(taskRecoveryMarkup, /projectCoordinatorObserveAndLinkOutput/u)
  assert.match(taskRecoveryMarkup, /projectCoordinatorAbandonExecution/u)
  assert.match(taskRecoveryMarkup, /projectCoordinatorAbandonReason/u)

  const abandonedTaskRecovery = {
    ...project,
    workerGroups: [{
      userId: 'usr_Worker00000001',
      displayName: 'Worker User',
      agents: [{
        displayName: 'Worker Desktop',
        projectAvailability: {
          agentId: 'agt_WorkerAgent001',
          availability: { revision: 7 }
        }
      }]
    }],
    tasks: [{
      task: {
        taskId: 'tsk_RecoveryTask001',
        currentExecutionId: 'exe_RecoveryExec001',
        status: 'revision_requested',
        fileIntent: {
          schemaVersion: 1,
          bindingRevision: 3,
          inputs: [],
          output: {
            kind: 'content-space.output-new',
            target: 'project-binding-root',
            mode: 'upload-new',
            fileName: 'meeting-summary.recovery-1.md',
            mediaType: 'text/markdown',
            maxBytes: 65_536
          }
        }
      },
      executions: [{
        executionId: 'exe_RecoveryExec001',
        state: 'cancelled',
        fence: { reason: 'manual_recovery_abandoned' }
      }]
    }],
    provisioning: {
      ...project.provisioning,
      recoveryActions: [{
        recoveryActionId: 'rca_TaskRecovery001',
        projectId: project.project.projectId,
        taskId: 'tsk_RecoveryTask001',
        executionId: 'exe_RecoveryExec001',
        journalEntryId: 'crj_TaskRecovery001',
        audience: 'coordinator',
        action: 'link_observed_output',
        status: 'completed',
        requiresFreshObservation: true,
        safeSummary: 'The uncertain execution was abandoned and requires a fresh successor.'
      }]
    }
  } as never
  const successorMarkup = renderToStaticMarkup(createElement(
    ProjectCoordinatorProvisioningSection,
    {
      project: abandonedTaskRecovery,
      plan: null,
      busy: false,
      onPreview: () => undefined,
      onApply: () => undefined,
      onAddMember: () => undefined,
      onRemoveMember: () => undefined,
      onObserveAndLinkRecovery: () => undefined,
      onAbandonRecovery: () => undefined,
      onRetryRecoverySuccessor: () => undefined
    }
  ))
  assert.match(successorMarkup, /data-default-visible-card="content-recovery-successor"/u)
  assert.match(successorMarkup, /name="next-output-file-name"/u)
  assert.match(successorMarkup, /projectCoordinatorApproveRecoveryRetry/u)
})

test('an awaiting-confirmation Plan renders its Owner action as a default-visible card', () => {
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorPlanSection, {
    project: awaitingConfirmationProjectFixture(),
    draft: null,
    busy: false,
    onGenerate: () => undefined,
    onEditDraft: () => undefined,
    onSubmitDraft: () => undefined,
    onConfirmActivate: () => undefined
  }))

  assert.match(markup, /data-default-visible-card="plan-confirmation"/u)
  assert.match(markup, /projectCoordinatorConfirmActivate/u)
})

test('a local Plan draft exposes full content editing before immutable submit', () => {
  const project = awaitingConfirmationProjectFixture()
  const task = project.plan.plan.tasks[0]!
  const markup = renderToStaticMarkup(createElement(ProjectCoordinatorPlanSection, {
    project: { ...project, plan: null },
    draft: {
      draftId: 'draft_MeetingPlan01',
      draftRevision: 1,
      projectId: project.project.projectId,
      expectedProjectRevision: project.project.revision,
      expectedCoordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
      supersedesProjectPlanId: null,
      sourceInputLocators: [],
      tasks: [task],
      rationale: project.plan.plan.rationale,
      runtimeProvenance: project.plan.plan.runtimeProvenance,
      assignments: [{
        planItemId: task.planItemId,
        selectedAgentId: null,
        recommendationReason: null
      }],
      createdAt: project.project.createdAt,
      updatedAt: project.project.updatedAt
    },
    busy: false,
    onGenerate: () => undefined,
    onEditDraft: () => undefined,
    onSubmitDraft: () => undefined,
    onConfirmActivate: () => undefined
  }))

  assert.match(markup, /name="plan-rationale"/u)
  assert.match(markup, /name="plan-item-title-item_meeting_summary"/u)
  assert.match(markup, /name="plan-item-objective-item_meeting_summary"/u)
  assert.match(markup, /name="plan-item-criteria-item_meeting_summary"/u)
  assert.match(markup, /name="plan-item-capabilities-item_meeting_summary"/u)
  assert.match(markup, /name="plan-item-agent-item_meeting_summary"/u)
  assert.match(markup, /projectCoordinatorSavePlanEdits/u)
})

test('pending HumanNeeded, result review, and eligible completion are default-visible decision cards', () => {
  const pendingMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorDecisionSection, {
    project: decisionProjectFixture('pending-human'),
    canAnswer: true,
    busy: false,
    onCreateHumanNeeded: () => undefined,
    onAnswerHumanNeeded: () => undefined,
    onReviewResult: () => undefined,
    onComplete: () => undefined
  }))
  assert.match(pendingMarkup, /data-default-visible-card="human-needed"/u)
  assert.match(pendingMarkup, /projectCoordinatorSubmitHumanAnswer/u)

  const reviewMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorDecisionSection, {
    project: decisionProjectFixture('review'),
    canAnswer: true,
    busy: false,
    onCreateHumanNeeded: () => undefined,
    onAnswerHumanNeeded: () => undefined,
    onReviewResult: () => undefined,
    onComplete: () => undefined
  }))
  assert.match(reviewMarkup, /data-default-visible-card="result-review"/u)
  assert.match(reviewMarkup, /projectCoordinatorAcceptResult/u)
  assert.match(reviewMarkup, /projectCoordinatorRequestRevision/u)

  const askMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorDecisionSection, {
    project: {
      ...decisionProjectFixture('completion'),
      records: []
    } as never,
    canAnswer: true,
    busy: false,
    onCreateHumanNeeded: () => undefined,
    onAnswerHumanNeeded: () => undefined,
    onReviewResult: () => undefined,
    onComplete: () => undefined
  }))
  assert.match(askMarkup, /data-default-visible-card="human-needed-create"/u)
  assert.match(askMarkup, /projectCoordinatorAskOwner/u)

  const completionMarkup = renderToStaticMarkup(createElement(ProjectCoordinatorDecisionSection, {
    project: decisionProjectFixture('completion'),
    canAnswer: true,
    busy: false,
    onCreateHumanNeeded: () => undefined,
    onAnswerHumanNeeded: () => undefined,
    onReviewResult: () => undefined,
    onComplete: () => undefined
  }))
  assert.match(completionMarkup, /data-default-visible-card="project-completion"/u)
  assert.match(completionMarkup, /projectCoordinatorCompleteProject/u)
})

test('decision HCI derives exact review and completion CAS facts from the visible Cloud snapshot', () => {
  const reviewProject = decisionProjectFixture('review')
  const accepted = projectCoordinatorResultReviewInput(
    reviewProject,
    'rsu_MeetingResult01',
    'accept',
    {
      instruction: '',
      nextAssigneeAgentId: '',
      nextOfferExpiresAt: '',
      nextOutputFileName: ''
    }
  )
  const fileIntent = {
    schemaVersion: 1 as const,
    bindingRevision: 3,
    inputs: [],
    output: {
      kind: 'content-space.output-new' as const,
      target: 'project-binding-root' as const,
      mode: 'upload-new' as const,
      fileName: 'training-plan-comparison.revision-1.md',
      mediaType: 'text/markdown',
      maxBytes: 65_536
    }
  }
  const fileReviewProject = {
    ...reviewProject,
    tasks: [{
      ...reviewProject.tasks[0],
      task: { ...reviewProject.tasks[0]!.task, fileIntent }
    }],
    workerGroups: [{
      agents: [{
        projectAvailability: {
          agentId: 'agt_Worker0000002',
          availability: { revision: 7 }
        }
      }]
    }]
  } as never
  const revised = projectCoordinatorResultReviewInput(
    fileReviewProject,
    'rsu_MeetingResult01',
    'request_revision',
    {
      instruction: 'Re-run with the confirmed assumptions.',
      nextAssigneeAgentId: 'agt_Worker0000002',
      nextOfferExpiresAt: '2026-08-26T01:08:00.000Z',
      nextOutputFileName: 'training-plan-comparison.revision-2.md'
    }
  )
  assert.deepEqual(accepted, {
    projectId: 'prj_ProjectCreated01',
    taskId: 'tsk_MeetingTask001',
    executionId: 'exe_MeetingExec001',
    resultSubmissionId: 'rsu_MeetingResult01',
    expectedProjectRevision: 8,
    expectedTaskRevision: 3,
    expectedExecutionRevision: 4,
    expectedResultRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    decision: 'accept',
    instruction: null,
    nextAssigneeAgentId: null,
    expectedNextAssigneeAvailabilityRevision: null,
    nextOfferExpiresAt: null,
    nextFileIntent: null
  })
  assert.equal(revised?.expectedNextAssigneeAvailabilityRevision, 7)
  assert.deepEqual(revised?.nextFileIntent, {
    ...fileIntent,
    output: {
      ...fileIntent.output,
      fileName: 'training-plan-comparison.revision-2.md'
    }
  })
  assert.equal(projectCoordinatorResultReviewInput(
    fileReviewProject,
    'rsu_MeetingResult01',
    'request_revision',
    {
      instruction: 'Re-run with the confirmed assumptions.',
      nextAssigneeAgentId: 'agt_Worker0000002',
      nextOfferExpiresAt: '2026-08-26T01:08:00.000Z',
      nextOutputFileName: fileIntent.output.fileName
    }
  ), null)

  const completionProject = decisionProjectFixture('completion')
  assert.deepEqual(projectCoordinatorCompletionInput(completionProject, 'Final bounded summary.'), {
    projectId: 'prj_ProjectCreated01',
    expectedProjectRevision: 8,
    expectedCoordinatorAuthorityEpoch: 1,
    expectedExecutionAuthorityEpoch: 1,
    projectPlanId: 'pln_MeetingPlan001',
    confirmedPlanRevision: 2,
    acceptedResultSubmissionIds: ['rsu_MeetingResult01'],
    summary: 'Final bounded summary.'
  })
  assert.equal(projectCoordinatorCompletionInput({
    ...completionProject,
    records: []
  } as never, 'Final bounded summary.'), null)
})

function rendererHost(opened: unknown[]): DomainRendererHost {
  return {
    capabilityInvoker: {
      observe: async () => { throw new Error('not observed') },
      invoke: async () => { throw new Error('not invoked') }
    },
    openExternal: () => undefined,
    workbench: {
      openRightPanel: (input) => opened.push(input)
    }
  }
}

function coordinatorTransferProjectFixture(): ProjectCoordinatorProject {
  const base = awaitingConfirmationProjectFixture()
  const availability = (userId: string, agentId: string, revision: number) => ({
    schemaVersion: 1 as const,
    type: 'project_worker_availability_view' as const,
    projectId: base.project.projectId,
    userId,
    agentId,
    revision,
    availability: {
      schemaVersion: 1 as const,
      type: 'worker_availability_projection' as const,
      userId,
      agentId,
      deviceId: `dev_${agentId.slice(4)}`,
      agentActive: true,
      deviceActive: true,
      connectionStatus: 'online' as const,
      lastHeartbeatAt: base.project.updatedAt,
      runtimeReadiness: 'ready' as const,
      runtimeCapabilityTags: ['research.execute'],
      acceptsNewOffers: true,
      activeTaskCount: 0,
      observedAt: base.project.updatedAt,
      expiresAt: '2026-08-25T02:08:00.000Z',
      revision,
      createdAt: base.project.createdAt,
      updatedAt: base.project.updatedAt
    },
    membership: {
      schemaVersion: 1 as const,
      type: 'project_membership' as const,
      projectMembershipId: userId === base.project.ownerUserId
        ? 'pmb_OwnerMember001'
        : 'pmb_OtherMember001',
      projectId: base.project.projectId,
      userId,
      state: 'active' as const,
      authorityEpoch: 1,
      activatedAt: base.project.createdAt,
      removalRequestedAt: null,
      removalRequestedByUserId: null,
      removedAt: null,
      revision: 1,
      createdAt: base.project.createdAt,
      updatedAt: base.project.updatedAt
    },
    taskAuthorities: [],
    providerPrincipalFact: null,
    providerPrincipalSnapshotStatus: 'not_applicable' as const,
    contentReadiness: null,
    observedAt: base.project.updatedAt
  })
  return {
    ...base,
    coordinatorTransferFeedback: {
      projectId: base.project.projectId,
      inboxMessageId: 'ibx_TransferInbox01',
      recipientAgentId: 'agt_PreviousCoord01',
      previousCoordinatorAgentId: 'agt_PreviousCoord01',
      coordinatorAgentId: base.project.coordinatorAgentId,
      coordinatorAuthorityEpoch: base.project.coordinatorAuthorityEpoch,
      projectRevision: 1,
      disposition: 'authority_transferred_out',
      observedAt: base.project.updatedAt
    },
    workerGroups: [{
      userId: base.project.ownerUserId,
      displayName: 'Project Owner',
      agents: [{
        displayName: 'Current Coordinator Desktop',
        projectAvailability: availability(
          base.project.ownerUserId,
          base.project.coordinatorAgentId,
          6
        )
      }, {
        displayName: 'Owner Successor Desktop',
        projectAvailability: availability(
          base.project.ownerUserId,
          'agt_OwnerSuccessor1',
          7
        )
      }]
    }, {
      userId: 'usr_ProjectMember01',
      displayName: 'Project Member',
      agents: [{
        displayName: 'Member Desktop',
        projectAvailability: availability(
          'usr_ProjectMember01',
          'agt_MemberAgent001',
          9
        )
      }]
    }]
  } as ProjectCoordinatorProject
}

function awaitingConfirmationProjectFixture() {
  const createdAt = '2026-08-25T01:00:00.000Z'
  const updatedAt = '2026-08-25T01:08:00.000Z'
  return {
    project: {
      schemaVersion: 1 as const,
      revision: 2,
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
        maxTasks: 4,
        maxTasksPerRound: 4,
        maxTaskRetries: 1,
        maxCoordinationRounds: 2
      }
    },
    plan: {
      plan: {
        schemaVersion: 1 as const,
        revision: 1,
        createdAt,
        updatedAt,
        type: 'project_plan' as const,
        projectPlanId: 'pln_MeetingPlan001',
        projectId: 'prj_ProjectCreated01',
        state: 'awaiting_confirmation' as const,
        planRevision: 1,
        sourceInputLocators: [],
        tasks: [{
          planItemId: 'item_meeting_summary',
          title: 'Summarize decisions',
          objective: 'Produce a bounded meeting summary.',
          completionCriteria: ['Owner can review it.'],
          dependencyPlanItemIds: [],
          requiredCapabilityTags: ['meeting.review'],
          fileIntent: null
        }],
        rationale: 'One Worker can synthesize the meeting.',
        runtimeProvenance: {
          runtimeId: 'codex-runtime',
          modelId: null,
          generatedByCoordinatorAgentId: 'agt_Coordinator01',
          generatedAt: createdAt
        },
        planDigest: 'a'.repeat(64),
        submittedAt: updatedAt,
        confirmedByUserId: null,
        confirmedAt: null,
        supersededAt: null
      },
      assignments: []
    },
    workerGroups: [],
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
  }
}

function provisioningPlanFixture() {
  return {
    projectId: 'prj_ProjectCreated01',
    provisioningIntentId: 'pvi_ContentIntent001',
    expectedProjectRevision: 3,
    expectedProvisioningRevision: 2,
    expectedProvisioningIntentRevision: 1,
    intentDigest: 'c'.repeat(64),
    attemptId: 'attempt_Provisioning001',
    rootStrategy: 'create' as const,
    providerInstance: {
      schemaVersion: 1 as const,
      type: 'provider_instance_reference' as const,
      providerInstanceRef: 'opencontent.run0'
    },
    containerDisplayName: 'Meeting Project',
    currentRootLocator: null,
    operations: [{
      operationId: 'authorize-provider',
      actionId: 'content-space.authorize-provider-administration',
      kind: 'authorize_provider' as const,
      userId: null
    }, {
      operationId: 'add-member-worker',
      actionId: 'content-space.agent-admin-add-member',
      kind: 'add_member' as const,
      userId: 'usr_Worker00000001'
    }],
    confirmedPlanDigest: 'd'.repeat(64)
  }
}

function contentProvisioningProjectFixture(): ProjectCoordinatorProject {
  const base = awaitingConfirmationProjectFixture()
  const timestamp = base.project.updatedAt
  const membership = (
    userId: string,
    projectMembershipId: string,
    state: 'active' | 'pending_membership' | 'membership_removal_pending'
  ) => ({
    schemaVersion: 1 as const,
    type: 'project_membership' as const,
    projectMembershipId,
    projectId: base.project.projectId,
    userId,
    state,
    authorityEpoch: 1,
    activatedAt: state === 'pending_membership' ? null : timestamp,
    removalRequestedAt: state === 'membership_removal_pending' ? timestamp : null,
    removalRequestedByUserId: state === 'membership_removal_pending'
      ? base.project.ownerUserId
      : null,
    removedAt: null,
    revision: 2,
    createdAt: timestamp,
    updatedAt: timestamp
  })
  const principalFact = (userId: string, providerPrincipalFactId: string) => ({
    schemaVersion: 1 as const,
    type: 'provider_directory_principal_fact' as const,
    providerPrincipalFactId,
    userId,
    providerPrincipal: {
      schemaVersion: 1 as const,
      type: 'provider_directory_principal_reference' as const,
      providerInstance: 'opencent-run0',
      principalKind: 'user' as const,
      principalId: `principal-${userId}`
    },
    principalIdentityRevision: 1,
    providerBindingAttestationDigest: 'e'.repeat(64),
    publishedByDeviceId: 'dev_Device0000001',
    readiness: 'ready' as const,
    readinessReason: null,
    observedAt: timestamp,
    revision: 2,
    createdAt: timestamp,
    updatedAt: timestamp
  })
  return {
    ...base,
    project: {
      ...base.project,
      contentMode: 'required',
      revision: 3
    },
    provisioning: {
      intent: {
        state: 'pending',
        provisioningRevision: 2
      },
      attestation: null,
      binding: null,
      memberships: [
        membership(base.project.ownerUserId, 'pmb_OwnerMember001', 'active'),
        membership('usr_Worker00000001', 'pmb_WorkerMember01', 'pending_membership'),
        membership('usr_RemoveWorker001', 'pmb_RemoveMember001', 'membership_removal_pending')
      ],
      providerPrincipalFacts: [
        principalFact(base.project.ownerUserId, 'ppf_OwnerFact00001'),
        principalFact('usr_Worker00000001', 'ppf_WorkerFact0001'),
        principalFact('usr_NewWorker00001', 'ppf_NewWorker00001')
      ],
      contentReadiness: [],
      providerMembershipObservations: [],
      externalOperationJournal: [],
      recoveryActions: []
    }
  } as never
}

function decisionProjectFixture(
  state: 'pending-human' | 'review' | 'completion'
): ProjectCoordinatorProject {
  const base = awaitingConfirmationProjectFixture()
  const timestamp = base.project.updatedAt
  const task = {
    schemaVersion: 1 as const,
    revision: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
    type: 'task' as const,
    taskId: 'tsk_MeetingTask001',
    projectId: base.project.projectId,
    createdByCoordinatorAgentId: base.project.coordinatorAgentId,
    title: 'Compare training plans',
    objective: 'Compare cost and risk.',
    completionCriteria: ['Provide a bounded comparison.'],
    dependencyTaskIds: [],
    fileIntent: null,
    currentExecutionId: 'exe_MeetingExec001',
    currentExecutionState: state === 'completion' ? 'completed' as const : 'result_submitted' as const,
    status: state === 'completion' ? 'completed' as const : 'awaiting_review' as const,
    executionCount: 1,
    maxRetries: 2,
    completedAt: state === 'completion' ? timestamp : null
  }
  const execution = {
    schemaVersion: 1 as const,
    revision: 4,
    createdAt: timestamp,
    updatedAt: timestamp,
    type: 'task_execution' as const,
    projectId: base.project.projectId,
    taskId: task.taskId,
    executionId: task.currentExecutionId,
    attempt: 1,
    offeredByCoordinatorAgentId: base.project.coordinatorAgentId,
    assigneeUserId: 'usr_Worker00000001',
    assigneeAgentId: 'agt_Worker0000001',
    assigneeDeviceId: 'dev_Worker0000001',
    state: task.currentExecutionState,
    stateRevision: 4,
    fence: {},
    fileIntent: null,
    currentResultSubmissionId: 'rsu_MeetingResult01',
    offeredAt: timestamp,
    acceptedAt: timestamp,
    startedAt: timestamp,
    terminalAt: timestamp
  }
  const submission = {
    schemaVersion: 1 as const,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    type: 'task_result_submission' as const,
    resultSubmissionId: 'rsu_MeetingResult01',
    projectId: base.project.projectId,
    taskId: task.taskId,
    executionId: task.currentExecutionId,
    submittedTaskRevision: 3,
    submittedExecutionRevision: 4,
    submittedByUserId: execution.assigneeUserId,
    submittedByAgentId: execution.assigneeAgentId,
    summary: 'The lower-cost plan has bounded operational risk.',
    runtimeProvenance: {},
    outputs: [],
    recoveryJournalEntryIds: [],
    submittedAt: timestamp,
    submissionDigest: 'b'.repeat(64)
  }
  const acceptedDecision = state === 'completion' ? {
    schemaVersion: 1 as const,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    type: 'task_review_decision' as const,
    reviewDecisionId: 'rvw_MeetingReview01',
    projectId: base.project.projectId,
    taskId: task.taskId,
    executionId: task.currentExecutionId,
    resultSubmissionId: submission.resultSubmissionId,
    reviewedResultRevision: 1,
    decidedByUserId: base.project.ownerUserId,
    decidedByCoordinatorAgentId: base.project.coordinatorAgentId,
    decision: 'accept' as const,
    instruction: null,
    acceptedProjectRecordId: 'rec_Observation0001',
    nextExecutionId: null,
    decidedAt: timestamp
  } : null
  return {
    ...base,
    project: { ...base.project, status: 'active' as const, revision: 8 },
    plan: {
      ...base.plan,
      plan: {
        ...base.plan.plan,
        state: 'confirmed' as const,
        revision: 2,
        confirmedByUserId: base.project.ownerUserId,
        confirmedAt: timestamp
      }
    },
    tasks: state === 'pending-human' ? [] : [{ task, executions: [execution] }],
    reviews: state === 'pending-human' ? [] : [{ submission, decision: acceptedDecision }],
    pendingHumanNeeded: state === 'pending-human' ? [{
      schemaVersion: 1 as const,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      type: 'human_needed' as const,
      humanRequestId: 'hrq_OwnerDecision01',
      projectId: base.project.projectId,
      context: { scope: 'coordinator_project' as const, coordinatorAuthorityEpoch: 1 },
      targetUserId: base.project.ownerUserId,
      requestedByAgentId: base.project.coordinatorAgentId,
      requiredAssurance: 'verified' as const,
      prompt: 'Choose the lower-risk direction.',
      confirmableAction: null,
      status: 'pending' as const,
      expiresAt: '2026-08-26T01:08:00.000Z'
    }] : [],
    records: state === 'completion' ? [{
      kind: 'decision' as const,
      projectId: base.project.projectId
    }] : []
  } as unknown as ProjectCoordinatorProject
}
