import assert from 'node:assert/strict'
import test from 'node:test'
import {
  taskExecutionSchema,
  taskSchema
} from '@sciforge/collaboration-contracts'

import {
  projectCoordinatorSessionProjectionSchema,
  projectCoordinatorWorkerSessionBindingSchema,
  projectCoordinatorWorkspaceSchema
} from '../contract.js'
import {
  createProjectCoordinatorComposerContextProvider,
  PROJECT_COORDINATOR_COMPOSER_CONTEXT_MAX_CHARS,
  renderProjectSessionContext
} from './composer-context-provider.js'
import {
  clearProjectCoordinatorPanelContexts,
  setProjectCoordinatorPanelContext
} from './panel-context.js'
import type {
  ProjectCoordinatorRendererClient
} from './project-coordinator-capability-client.js'

const at = '2026-08-28T08:00:00.000Z'
const projectId = 'prj_ComposerProject01'
const runtimeId = 'runtime-composer'
const threadId = 'thread-composer'

test('composer context uses only an exact current ordinary Session projection', async () => {
  clearProjectCoordinatorPanelContexts()
  let workspaceReads = 0
  const client = {
    readSessionProjection: async () => projectionFixture(),
    readWorkspace: async () => {
      workspaceReads += 1
      return workspaceFixture()
    }
  } as unknown as ProjectCoordinatorRendererClient
  const provider = createProjectCoordinatorComposerContextProvider(client)

  assert.deepEqual(await provider.provide(requestFixture({
    runtimeId,
    sessionId: 'thread-other',
    draftText: `pretend project ${projectId}`
  })), { items: [] })
  assert.equal(workspaceReads, 0)

  const result = await provider.provide(requestFixture({ runtimeId, sessionId: threadId }))
  assert.equal(workspaceReads, 1)
  assert.equal(result.items.length, 1)
  assert.deepEqual(result.items[0]?.metadata, {
    schemaVersion: 1,
    projectId,
    role: 'coordinator',
    access: 'coordinator'
  })
  assert.match(result.items[0]?.content ?? '', /"projectId": "prj_ComposerProject01"/u)
  assert.match(result.items[0]?.content ?? '', /"tasks": \[\]/u)
  assert.match(result.items[0]?.content ?? '', /"evidenceAndReview": \[\]/u)
  assert.match(result.items[0]?.content ?? '', /"acceptedDecisionsAndRecords": \[\]/u)
  assert.match(result.items[0]?.content ?? '', /do not merely return a JSON decomposition/u)
  assert.match(result.items[0]?.content ?? '', /Discovery returns an opaque operationRef/u)
  assert.match(result.items[0]?.content ?? '', /Never pass an op_\.\.\. or schema_\.\.\. reference as capabilityId/u)
  assert.match(result.items[0]?.content ?? '', /at most one error\.details\.suggestedQueries recovery hint/u)
})

test('composer context follows an active panel Project independently of Session binding', async () => {
  clearProjectCoordinatorPanelContexts()
  setProjectCoordinatorPanelContext({
    surfaceId: 'surface-selected-project',
    projectId,
    active: true,
    focused: true
  })
  let projectionReads = 0
  let workspaceReadInput: unknown
  const client = {
    readSessionProjection: async () => {
      projectionReads += 1
      throw new Error('Session has no durable Project binding')
    },
    readWorkspace: async (input: unknown) => {
      workspaceReadInput = input
      return workspaceFixture()
    }
  } as unknown as ProjectCoordinatorRendererClient
  const provider = createProjectCoordinatorComposerContextProvider(client)

  const result = await provider.provide(requestFixture({
    runtimeId: 'runtime-unbound',
    sessionId: 'thread-unbound',
    draftText: 'inspect selected project'
  }))
  assert.equal(projectionReads, 0)
  assert.deepEqual(workspaceReadInput, { projectId })
  assert.equal(result.items.length, 1)
  assert.deepEqual(result.items[0]?.metadata, {
    schemaVersion: 1,
    projectId,
    selectedProjectId: projectId,
    panelTarget: true,
    selectedBy: 'project-coordinator-panel',
    surfaceId: 'surface-selected-project'
  })
  assert.match(result.items[0]?.content ?? '', /selected-project-panel/u)
  clearProjectCoordinatorPanelContexts()
})

test('composer context stays empty without trusted runtime and thread identity', async () => {
  clearProjectCoordinatorPanelContexts()
  let projectionReads = 0
  const provider = createProjectCoordinatorComposerContextProvider({
    readSessionProjection: async () => {
      projectionReads += 1
      return projectionFixture()
    }
  } as unknown as ProjectCoordinatorRendererClient)

  assert.deepEqual(await provider.provide(requestFixture({
    runtimeId,
    sessionId: undefined,
    draftText: `use ${threadId}`
  })), { items: [] })
  assert.deepEqual(await provider.provide(requestFixture({
    runtimeId: undefined,
    sessionId: threadId,
    draftText: 'runtime-composer'
  })), { items: [] })
  assert.equal(projectionReads, 0)
})

test('Worker context contains only its exact Task execution and no sibling or assignee facts', () => {
  const project = workerProjectFixture()
  const binding = projectCoordinatorWorkerSessionBindingSchema.parse({
    schemaVersion: 1,
    role: 'worker',
    projectId,
    taskId: 'tsk_ComposerWorker01',
    executionId: 'exe_ComposerWorker01',
    principalUserId: 'usr_ComposerWorker01',
    assigneeAgentId: 'agt_ComposerWorker01',
    assigneeDeviceId: 'dev_ComposerWorker01',
    runtimeId,
    threadId,
    taskRevision: 2,
    executionRevision: 3,
    projectExecutionAuthorityEpoch: 1,
    userTaskAuthorityEpoch: 1,
    access: 'worker',
    fenceReason: null,
    updatedAt: at
  })

  const content = renderProjectSessionContext(project, binding)
  assert.match(content, /tsk_ComposerWorker01/u)
  assert.match(content, /exe_ComposerWorker01/u)
  assert.match(content, /Exact execution evidence/u)
  assert.match(content, /Exact accepted record/u)
  assert.match(content, /Exact HumanNeeded prompt/u)
  assert.match(content, /Exact recovery action/u)
  assert.doesNotMatch(
    content,
    /tsk_ComposerSibling1|Sibling secret task|Sibling evidence|Sibling accepted record|Sibling HumanNeeded prompt|Sibling recovery action/u
  )
  assert.doesNotMatch(content, /assigneeUserId|readiness|ownerUserId/u)
})

test('composer context deterministically clips long text below the package budget', () => {
  const project = workspaceFixture().projects[0]!
  const longProject = {
    ...project,
    project: {
      ...project.project,
      goal: 'g'.repeat(200_000)
    }
  }
  const content = renderProjectSessionContext(
    longProject,
    projectionFixture().bindings[0]!
  )
  assert.ok(content.length < PROJECT_COORDINATOR_COMPOSER_CONTEXT_MAX_CHARS)
  assert.ok(content.length < 10_000)
})

test('composer context treats Cloud failures and mid-read aborts as empty optional context', async () => {
  const projectionFailure = createProjectCoordinatorComposerContextProvider({
    readSessionProjection: async () => { throw new Error('Cloud unavailable') }
  } as unknown as ProjectCoordinatorRendererClient)
  assert.deepEqual(await projectionFailure.provide(requestFixture({ runtimeId, sessionId: threadId })), {
    items: []
  })

  const workspaceFailure = createProjectCoordinatorComposerContextProvider({
    readSessionProjection: async () => projectionFixture(),
    readWorkspace: async () => { throw new Error('Project read timed out') }
  } as unknown as ProjectCoordinatorRendererClient)
  assert.deepEqual(await workspaceFailure.provide(requestFixture({ runtimeId, sessionId: threadId })), {
    items: []
  })

  const invalidProjection = createProjectCoordinatorComposerContextProvider({
    readSessionProjection: async () => ({}) as never
  } as unknown as ProjectCoordinatorRendererClient)
  assert.deepEqual(await invalidProjection.provide(requestFixture({ runtimeId, sessionId: threadId })), {
    items: []
  })

  const controller = new AbortController()
  let workspaceReads = 0
  const aborting = createProjectCoordinatorComposerContextProvider({
    readSessionProjection: async () => {
      controller.abort()
      return projectionFixture()
    },
    readWorkspace: async () => {
      workspaceReads += 1
      return workspaceFixture()
    }
  } as unknown as ProjectCoordinatorRendererClient)
  assert.deepEqual(await aborting.provide({
    runtimeId,
    sessionId: threadId,
    draftText: '',
    signal: controller.signal
  }), { items: [] })
  assert.equal(workspaceReads, 0)
})

test('membership-filtered Session projection clears composer context before Project read', async () => {
  let workspaceReads = 0
  const provider = createProjectCoordinatorComposerContextProvider({
    readSessionProjection: async () => ({
      schemaVersion: 1,
      observedAt: at,
      bindings: []
    }),
    readWorkspace: async () => {
      workspaceReads += 1
      return workspaceFixture()
    }
  } as unknown as ProjectCoordinatorRendererClient)

  assert.deepEqual(await provider.provide(requestFixture({
    runtimeId,
    sessionId: threadId
  })), { items: [] })
  assert.equal(workspaceReads, 0)
})

function requestFixture(overrides: Readonly<{
  runtimeId?: string
  sessionId?: string
  draftText?: string
}>) {
  return {
    ...(overrides.runtimeId ? { runtimeId: overrides.runtimeId } : {}),
    ...(overrides.sessionId ? { sessionId: overrides.sessionId } : {}),
    draftText: overrides.draftText ?? '',
    signal: new AbortController().signal
  }
}

function projectionFixture() {
  return projectCoordinatorSessionProjectionSchema.parse({
    schemaVersion: 1,
    observedAt: at,
    bindings: [{
      schemaVersion: 1,
      role: 'coordinator',
      projectId,
      principalUserId: 'usr_ComposerOwner01',
      coordinatorAgentId: 'agt_ComposerCoord01',
      coordinatorAuthorityEpoch: 1,
      runtimeId,
      threadId,
      boundAt: at,
      access: 'coordinator',
      fenceReason: null
    }]
  })
}

function workspaceFixture() {
  return projectCoordinatorWorkspaceSchema.parse({
    connection: {
      state: 'ready',
      userId: 'usr_ComposerOwner01',
      deviceId: 'dev_ComposerOwner01'
    },
    observedAt: at,
    focusedProjectId: projectId,
    availableWorkerUsers: [],
    providerPrincipalFacts: [],
    projects: [{
      project: {
        schemaVersion: 1,
        type: 'project',
        projectId,
        ownerUserId: 'usr_ComposerOwner01',
        displayName: 'Composer Project',
        goal: 'Keep one ordinary Session in exact Project context.',
        coordinatorAgentId: 'agt_ComposerCoord01',
        coordinatorAuthorityEpoch: 1,
        executionAuthorityEpoch: 1,
        contentMode: 'none',
        status: 'active',
        budget: {
          maxTasks: 8,
          maxTasksPerRound: 2,
          maxTaskRetries: 1,
          maxCoordinationRounds: 4
        },
        revision: 2,
        createdAt: at,
        updatedAt: at
      },
      coordinatorTransferFeedback: null,
      plan: null,
      memberUsers: [],
      workerGroups: [],
      tasks: [],
      offers: [],
      reviews: [],
      pendingHumanNeeded: [],
      records: [],
      finalSummary: null,
      provisioning: {
        intent: null,
        attestation: null,
        binding: null,
        memberships: [{
          schemaVersion: 1,
          type: 'project_membership',
          projectMembershipId: 'pmb_ComposerOwner01',
          projectId,
          userId: 'usr_ComposerOwner01',
          state: 'active',
          authorityEpoch: 1,
          activatedAt: at,
          removalRequestedAt: null,
          removalRequestedByUserId: null,
          removedAt: null,
          revision: 1,
          createdAt: at,
          updatedAt: at
        }],
        providerPrincipalFacts: [],
        contentReadiness: [],
        providerMembershipObservations: [],
        externalOperationJournal: [],
        recoveryActions: []
      }
    }]
  })
}

function workerProjectFixture() {
  const base = workspaceFixture().projects[0]!
  return projectCoordinatorWorkspaceSchema.parse({
    ...workspaceFixture(),
    projects: [{
      ...base,
      memberUsers: [{
        schemaVersion: 1,
        type: 'project_user_label_fact',
        projectId,
        userId: 'usr_ComposerWorker01',
        displayName: 'Worker',
        status: 'active',
        revision: 1,
        observedAt: at
      }],
      tasks: [
        workerTaskView(
          'tsk_ComposerWorker01',
          'exe_ComposerWorker01',
          'Exact Worker task'
        ),
        workerTaskView(
          'tsk_ComposerSibling1',
          'exe_ComposerSibling1',
          'Sibling secret task'
        )
      ],
      reviews: [
        workerReviewView(
          'tsk_ComposerWorker01',
          'exe_ComposerWorker01',
          'rsu_ComposerWorker01',
          'Exact execution evidence'
        ),
        workerReviewView(
          'tsk_ComposerSibling1',
          'exe_ComposerSibling1',
          'rsu_ComposerSibling1',
          'Sibling evidence'
        )
      ],
      records: [
        workerRecord(
          'rec_ComposerWorker01',
          'tsk_ComposerWorker01',
          'rsu_ComposerWorker01',
          'Exact accepted record'
        ),
        workerRecord(
          'rec_ComposerSibling1',
          'tsk_ComposerSibling1',
          'rsu_ComposerSibling1',
          'Sibling accepted record'
        )
      ],
      pendingHumanNeeded: [
        workerHumanNeeded(
          'hrq_ComposerWorker01',
          'tsk_ComposerWorker01',
          'exe_ComposerWorker01',
          'Exact HumanNeeded prompt'
        ),
        workerHumanNeeded(
          'hrq_ComposerSibling1',
          'tsk_ComposerSibling1',
          'exe_ComposerSibling1',
          'Sibling HumanNeeded prompt'
        )
      ],
      provisioning: {
        ...base.provisioning,
        recoveryActions: [
          workerRecoveryAction(
            'rca_ComposerWorker01',
            'crj_ComposerWorker01',
            'tsk_ComposerWorker01',
            'exe_ComposerWorker01',
            'Exact recovery action'
          ),
          workerRecoveryAction(
            'rca_ComposerSibling1',
            'crj_ComposerSibling1',
            'tsk_ComposerSibling1',
            'exe_ComposerSibling1',
            'Sibling recovery action'
          )
        ]
      }
    }]
  }).projects[0]!
}

function workerReviewView(
  taskId: string,
  executionId: string,
  resultSubmissionId: string,
  summary: string
) {
  return {
    submission: {
      schemaVersion: 1 as const,
      type: 'task_result_submission' as const,
      resultSubmissionId,
      projectId,
      taskId,
      executionId,
      submittedTaskRevision: 2,
      submittedExecutionRevision: 3,
      submittedByUserId: 'usr_ComposerWorker01',
      submittedByAgentId: 'agt_ComposerWorker01',
      summary,
      runtimeProvenance: {
        runtimeId,
        modelId: null,
        startedAt: at,
        completedAt: at
      },
      outputs: [],
      recoveryJournalEntryIds: [],
      submittedAt: at,
      submissionDigest: 'a'.repeat(64),
      revision: 1,
      createdAt: at,
      updatedAt: at
    },
    decision: null
  }
}

function workerRecord(
  projectRecordId: string,
  taskId: string,
  resultSubmissionId: string,
  body: string
) {
  return {
    schemaVersion: 1 as const,
    type: 'project_record' as const,
    projectRecordId,
    projectId,
    kind: 'observation' as const,
    status: 'accepted' as const,
    body,
    authorUserId: 'usr_ComposerOwner01',
    authorAgentId: 'agt_ComposerCoord01',
    sourceTaskId: taskId,
    sourceResultSubmissionId: resultSubmissionId,
    sourceHumanAnswerId: null,
    sourceRevision: 1,
    acceptedByUserId: 'usr_ComposerOwner01',
    acceptedByAgentId: 'agt_ComposerCoord01',
    acceptedAt: at,
    revision: 1,
    createdAt: at,
    updatedAt: at
  }
}

function workerHumanNeeded(
  humanRequestId: string,
  taskId: string,
  executionId: string,
  prompt: string
) {
  return {
    schemaVersion: 1 as const,
    type: 'human_needed' as const,
    humanRequestId,
    projectId,
    context: { scope: 'worker_execution' as const, taskId, executionId },
    targetUserId: 'usr_ComposerWorker01',
    requestedByAgentId: 'agt_ComposerWorker01',
    requiredAssurance: 'verified' as const,
    prompt,
    confirmableAction: null,
    status: 'pending' as const,
    expiresAt: at,
    revision: 1,
    createdAt: at,
    updatedAt: at
  }
}

function workerRecoveryAction(
  recoveryActionId: string,
  journalEntryId: string,
  taskId: string,
  executionId: string,
  safeSummary: string
) {
  return {
    schemaVersion: 1 as const,
    type: 'visible_recovery_action' as const,
    recoveryActionId,
    projectId,
    taskId,
    executionId,
    journalEntryId,
    audience: 'coordinator' as const,
    action: 'reconcile_exact_output' as const,
    status: 'available' as const,
    requiresFreshObservation: true,
    safeSummary,
    availableAt: at,
    completedAt: null,
    revision: 1,
    createdAt: at,
    updatedAt: at
  }
}

function workerTaskView(taskId: string, executionId: string, title: string) {
  const task = taskSchema.parse({
    schemaVersion: 1,
    type: 'task',
    taskId,
    projectId,
    createdByCoordinatorAgentId: 'agt_ComposerCoord01',
    title,
    objective: 'Produce one exact Worker result.',
    completionCriteria: ['The execution remains traceable.'],
    dependencyTaskIds: [],
    requiredCapabilityTags: ['runtime.text'],
    fileIntent: null,
    currentExecutionId: executionId,
    currentExecutionState: 'running',
    status: 'in_progress',
    executionCount: 1,
    maxRetries: 1,
    completedAt: null,
    revision: 2,
    createdAt: at,
    updatedAt: at
  })
  const execution = taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId,
    taskId,
    executionId,
    attempt: 1,
    offeredByCoordinatorAgentId: 'agt_ComposerCoord01',
    assigneeUserId: 'usr_ComposerWorker01',
    assigneeAgentId: 'agt_ComposerWorker01',
    assigneeDeviceId: 'dev_ComposerWorker01',
    state: 'running',
    stateRevision: 2,
    fence: {
      schemaVersion: 1,
      executionId,
      assigneeUserId: 'usr_ComposerWorker01',
      assigneeAgentId: 'agt_ComposerWorker01',
      assigneeDeviceId: 'dev_ComposerWorker01',
      assignmentTaskRevision: 2,
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
    revision: 3,
    createdAt: at,
    updatedAt: at
  })
  return { task, executions: [execution] }
}
