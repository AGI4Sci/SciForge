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
  projectCoordinatorCompletionInput,
  projectCoordinatorCreatedSelection,
  projectCoordinatorResultReviewInput
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

test('panel surface is limited to Plan, Worker selection, Task, review, and provisioning HCI', () => {
  assert.deepEqual(PROJECT_COORDINATOR_PANEL_SECTION_IDS, [
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
      createHumanNeeded: async () => { throw new Error('unused') },
      answerHumanNeeded: async () => { throw new Error('unused') },
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
    { instruction: '', nextAssigneeAgentId: '', nextOfferExpiresAt: '' }
  )
  const revised = projectCoordinatorResultReviewInput(
    {
      ...reviewProject,
      workerGroups: [{
        agents: [{
          projectAvailability: {
            agentId: 'agt_Worker0000002',
            availability: { revision: 7 }
          }
        }]
      }]
    } as never,
    'rsu_MeetingResult01',
    'request_revision',
    {
      instruction: 'Re-run with the confirmed assumptions.',
      nextAssigneeAgentId: 'agt_Worker0000002',
      nextOfferExpiresAt: '2026-08-26T01:08:00.000Z'
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
    provisioning: {
      intent: null,
      attestation: null,
      binding: null,
      recoveryActions: []
    }
  }
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
