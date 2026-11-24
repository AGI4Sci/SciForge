import {
  taskExecutionSchema,
  taskSchema
} from '@sciforge/collaboration-contracts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { publishedResultDrive } from '../cloud-test-fixtures.js'

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
  assert.match(result.items[0]?.content ?? '', /canonical requirements workflow/u)
  assert.match(result.items[0]?.content ?? '', /expand its opaque operationRef/u)
  assert.match(result.items[0]?.content ?? '', /Never use an opaque reference as capabilityId/u)
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
  assert.match(content, /res_ComposerWorker01/u)
  assert.match(content, /Exact accepted record/u)
  assert.match(content, /Exact HumanNeeded prompt/u)
  assert.doesNotMatch(
    content,
    /tsk_ComposerSibling1|Sibling secret task|res_ComposerSibling1|Sibling accepted record|Sibling HumanNeeded prompt/u
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

test('composer context reports trusted read failures without leaking errors and keeps aborts empty', async () => {
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
  const unavailable = await workspaceFailure.provide(requestFixture({ runtimeId, sessionId: threadId }))
  assert.equal(unavailable.items.length, 1)
  assert.match(unavailable.items[0]!.content, /unavailable/u)
  assert.doesNotMatch(unavailable.items[0]!.content, /Project read timed out/u)
  assert.equal((unavailable.items[0]!.metadata as Record<string, unknown>).access, undefined)

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
      schemaVersion: 2,
      observedAt: at,
      bindings: [],
      suppressedSessions: [],
      pendingActivations: []
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
    schemaVersion: 2,
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
    }],
    suppressedSessions: [],
    pendingActivations: []
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
      pendingHumanNeeded: [],
      records: [],
      finalSummary: null,
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
      deliveryDrive: null
    }]
  })
}

function workerProjectFixture() {
  const base = workspaceFixture().projects[0]!
  const own = publishedResultDrive(projectId, 'tsk_ComposerWorker01', 'exe_ComposerWorker01', 'ComposerWorker01')
  const sibling = publishedResultDrive(projectId, 'tsk_ComposerSibling1', 'exe_ComposerSibling1', 'ComposerSibling1')
  return projectCoordinatorWorkspaceSchema.parse({
    ...workspaceFixture(),
    projects: [{
      ...base,
      deliveryDrive: { ...own, taskDeliveries: [...own.taskDeliveries, ...sibling.taskDeliveries], projectResults: [...own.projectResults, ...sibling.projectResults] },
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
    interaction: { kind: 'clarification' as const },
    deferred: null,
    confirmableAction: null,
    status: 'pending' as const,
    expiresAt: at,
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
    state: taskId === 'tsk_ComposerWorker01' ? 'result_submitted' : 'running',
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

      status: taskId === 'tsk_ComposerWorker01' ? 'fenced' : 'open',
      reason: taskId === 'tsk_ComposerWorker01' ? 'result_submitted' : null,
      fencedAt: taskId === 'tsk_ComposerWorker01' ? at : null
    },
    fileIntent: null,
    currentResultSubmissionId: taskId === 'tsk_ComposerWorker01' ? 'rsu_ComposerWorker01' : null,
    offeredAt: at,
    acceptedAt: at,
    startedAt: at,
    terminalAt: taskId === 'tsk_ComposerWorker01' ? at : null,
    revision: 3,
    createdAt: at,
    updatedAt: at
  })
  return { delivery: null, task, executions: [execution] }
}


test('late active task, human question and dependency displace old terminal prefixes with exact coverage', () => {
  const project = workerProjectFixture()
  const tasks = Array.from({ length: 20 }, (_, i) => {
    const view = workerTaskView(`tsk_ComposerTask${String(i).padStart(4, '0')}`, `exe_ComposerTask${String(i).padStart(4, '0')}`, `Task ${i}`)
    return { ...view, task: { ...view.task, status: 'completed' as const } }
  })
  const active = workerTaskView('tsk_ComposerActive01', 'exe_ComposerActive01', 'Late active task')
  const withDependencies = { ...active, task: { ...active.task, dependencyTaskIds: [tasks[19]!.task.taskId] } }
  const records = Array.from({ length: 15 }, (_, i) => workerRecord(
    `rec_ComposerRecord${String(i).padStart(4, '0')}`, tasks[0]!.task.taskId, `rsu_ComposerRecord${String(i).padStart(4, '0')}`, `Old record ${i}`))
  const negative = workerRecord('rec_ComposerNegative', active.task.taskId, 'rsu_ComposerNegative', 'No improvement under the matched control.')
  const recent = publishedResultDrive(projectId, active.task.taskId, active.task.currentExecutionId!, 'ComposerLatest01')
  const older = Array.from({ length: 12 }, (_, i) => publishedResultDrive(projectId, tasks[0]!.task.taskId,
    tasks[0]!.task.currentExecutionId!, `ComposerOld${String(i).padStart(4, '0')}`))
  const data = { ...project, tasks: [...tasks, withDependencies], records: [...records, negative],
    pendingHumanNeeded: [workerHumanNeeded('hrq_ComposerLate001', active.task.taskId, active.task.currentExecutionId!, 'Pending late question')],
    deliveryDrive: { ...recent, taskDeliveries: [...older.flatMap((d) => d.taskDeliveries), ...recent.taskDeliveries],
      projectResults: [...older.flatMap((d) => d.projectResults), ...recent.projectResults] } }
  const content = renderProjectSessionContext(data, projectionFixture().bindings[0]!)
  const parsed = JSON.parse(content)
  assert.equal(parsed.tasks[0].taskId, active.task.taskId)
  assert.ok(parsed.tasks.some((t: { taskId: string }) => t.taskId === tasks[19]!.task.taskId))
  assert.equal(parsed.acceptedDecisionsAndRecords[0].body, negative.body)
  assert.equal(parsed.acceptedDecisionsAndRecords[0].kind, 'observation')
  assert.equal(parsed.evidenceAndReview[0].projectResultId, recent.projectResults[0]!.projectResultId)
  assert.deepEqual(parsed.coverage.tasks, { total: 21, included: 12, omitted: 9 })
  assert.deepEqual(parsed.coverage.acceptedDecisionsAndRecords, { total: 16, included: 8, omitted: 8 })
  assert.deepEqual(parsed.coverage.evidenceAndReview, { total: 13, included: 8, omitted: 5 })
  assert.equal(renderProjectSessionContext({ ...data, tasks: [...data.tasks].reverse(), records: [...data.records].reverse() }, projectionFixture().bindings[0]!), content)
})

test('not-ready and missing trusted Project return generic unavailable; stale access never becomes authority', async () => {
  for (const workspace of [
    { ...workspaceFixture(), connection: { state: 'offline', privateMessage: 'PRIVATE_DETAIL' } },
    { ...workspaceFixture(), projects: [] }
  ]) {
    const provider = createProjectCoordinatorComposerContextProvider({
      readSessionProjection: async () => projectionFixture(), readWorkspace: async () => workspace
    } as unknown as ProjectCoordinatorRendererClient)
    const result = await provider.provide(requestFixture({ runtimeId, sessionId: threadId }))
    assert.match(result.items[0]!.content, /unavailable/u)
    assert.doesNotMatch(result.items[0]!.content, /PRIVATE_DETAIL/u)
    assert.equal((result.items[0]!.metadata as Record<string, unknown>).access, undefined)
  }
  const content = renderProjectSessionContext(workspaceFixture().projects[0]!, { ...projectionFixture().bindings[0]!, fenceReason: 'authority_changed' })
  assert.match(content, /grants no authority/u)
  assert.match(content, /authority_changed/u)
})

test('worker records and results from another attempt of the same task stay absent', () => {
  const project = workerProjectFixture()
  const other = publishedResultDrive(projectId, 'tsk_ComposerWorker01', 'exe_ComposerOther01', 'ComposerOther01')
  const binding = projectCoordinatorWorkerSessionBindingSchema.parse({
    schemaVersion: 1, role: 'worker', projectId, taskId: 'tsk_ComposerWorker01', executionId: 'exe_ComposerWorker01',
    principalUserId: 'usr_ComposerWorker01', assigneeAgentId: 'agt_ComposerWorker01', assigneeDeviceId: 'dev_ComposerWorker01',
    runtimeId, threadId, taskRevision: 2, executionRevision: 3, projectExecutionAuthorityEpoch: 1,
    userTaskAuthorityEpoch: 1, access: 'worker', fenceReason: null, updatedAt: at
  })
  const content = renderProjectSessionContext({ ...project,
    deliveryDrive: { ...project.deliveryDrive!, taskDeliveries: [...project.deliveryDrive!.taskDeliveries, ...other.taskDeliveries],
      projectResults: [...project.deliveryDrive!.projectResults, ...other.projectResults] },
    records: [...project.records, workerRecord('rec_ComposerOther01', binding.taskId, 'rsu_ComposerOther01', 'OTHER_ATTEMPT_SECRET')]
  }, binding)
  assert.doesNotMatch(content, /ComposerOther01|OTHER_ATTEMPT_SECRET/u)
  assert.deepEqual(JSON.parse(content).coverage.associatedRecords, { total: 1, included: 1, omitted: 0 })
})


test('pending questions beyond the old prefix and a separate active late task remain selected', () => {
  const base = workerProjectFixture()
  const oldTasks = Array.from({ length: 16 }, (_, i) => {
    const view = workerTaskView(`tsk_QuestionOld${String(i).padStart(4, '0')}`, `exe_QuestionOld${String(i).padStart(4, '0')}`, `Old ${i}`)
    return { ...view, task: { ...view.task, status: 'completed' as const } }
  })
  const active = workerTaskView('tsk_SeparateActive01', 'exe_SeparateActive01', 'Separate current task')
  const questions = Array.from({ length: 12 }, (_, i) => workerHumanNeeded(
    `hrq_OldQuestion${String(i).padStart(4, '0')}`, oldTasks[0]!.task.taskId,
    oldTasks[0]!.task.currentExecutionId!, `Old question ${i}`))
  const latest = { ...workerHumanNeeded('hrq_LatestQuestion01', oldTasks[15]!.task.taskId,
    oldTasks[15]!.task.currentExecutionId!, 'Latest pending question'), updatedAt: '2026-09-01T00:00:00.000Z' }
  const data = { ...base, tasks: [...oldTasks, active], pendingHumanNeeded: [...questions, latest] }
  const parsed = JSON.parse(renderProjectSessionContext(data, projectionFixture().bindings[0]!))
  assert.equal(parsed.pendingHumanNeeded[0].humanRequestId, latest.humanRequestId)
  assert.ok(parsed.tasks.some((t: { taskId: string }) => t.taskId === active.task.taskId))
  assert.ok(parsed.tasks.some((t: { taskId: string }) => t.taskId === latest.context.taskId))
  assert.deepEqual(parsed.coverage.pendingHumanNeeded, { total: 13, included: 8, omitted: 5 })
})

test('a worker binding to an old execution produces unavailable without current attempt facts', async () => {
  const base = workerProjectFixture()
  const worker = projectCoordinatorWorkerSessionBindingSchema.parse({
    schemaVersion: 1, role: 'worker', projectId, taskId: 'tsk_ComposerWorker01', executionId: 'exe_ComposerOld001',
    principalUserId: 'usr_ComposerWorker01', assigneeAgentId: 'agt_ComposerWorker01', assigneeDeviceId: 'dev_ComposerWorker01',
    runtimeId, threadId, taskRevision: 2, executionRevision: 3, projectExecutionAuthorityEpoch: 1,
    userTaskAuthorityEpoch: 1, access: 'worker', fenceReason: null, updatedAt: at
  })
  const provider = createProjectCoordinatorComposerContextProvider({
    readSessionProjection: async () => ({ ...projectionFixture(), bindings: [worker] }),
    readWorkspace: async () => ({ ...workspaceFixture(), projects: [base] })
  } as unknown as ProjectCoordinatorRendererClient)
  const result = await provider.provide(requestFixture({ runtimeId, sessionId: threadId }))
  assert.match(result.items[0]!.content, /unavailable/u)
  assert.doesNotMatch(result.items[0]!.content, /Exact Worker task|exe_ComposerWorker01/u)
  assert.equal((result.items[0]!.metadata as Record<string, unknown>).access, undefined)
})

test('abort while reading a resolved workspace remains empty, including a failed read', async () => {
  for (const fails of [false, true]) {
    const controller = new AbortController()
    const provider = createProjectCoordinatorComposerContextProvider({
      readSessionProjection: async () => projectionFixture(),
      readWorkspace: async () => {
        controller.abort()
        if (fails) throw new Error('PRIVATE_READ_ERROR')
        return workspaceFixture()
      }
    } as unknown as ProjectCoordinatorRendererClient)
    assert.deepEqual(await provider.provide({ ...requestFixture({ runtimeId, sessionId: threadId }), signal: controller.signal }), { items: [] })
  }
})


test('production provider returns a partial budgeted snapshot rather than dropping a large Project', async () => {
  const base = workerProjectFixture()
  const tasks = Array.from({ length: 20 }, (_, i) => {
    const view = workerTaskView(`tsk_BudgetTask${String(i).padStart(4, '0')}`, `exe_BudgetTask${String(i).padStart(4, '0')}`, 'title')
    return { ...view, task: { ...view.task, title: '\u0000'.repeat(1000) } }
  })
  const project = { ...base, project: { ...base.project, goal: '\u0000'.repeat(200_000) }, tasks,
    records: Array.from({ length: 20 }, (_, i) => workerRecord(`rec_BudgetFact${String(i).padStart(4, '0')}`,
      tasks[0]!.task.taskId, `rsu_BudgetFact${String(i).padStart(4, '0')}`, '\u0000'.repeat(10_000))),
    pendingHumanNeeded: Array.from({ length: 20 }, (_, i) => workerHumanNeeded(`hrq_BudgetHuman${String(i).padStart(4, '0')}`,
      tasks[0]!.task.taskId, tasks[0]!.task.currentExecutionId!, '\u0000'.repeat(10_000))) }
  const provider = createProjectCoordinatorComposerContextProvider({
    readSessionProjection: async () => projectionFixture(),
    readWorkspace: async () => ({ ...workspaceFixture(), projects: [project] })
  } as unknown as ProjectCoordinatorRendererClient)
  const result = await provider.provide(requestFixture({ runtimeId, sessionId: threadId }))
  assert.equal(result.items.length, 1)
  assert.ok(result.items[0]!.content.length <= PROJECT_COORDINATOR_COMPOSER_CONTEXT_MAX_CHARS)
  const data = JSON.parse(result.items[0]!.content)
  assert.equal(data.project.projectId, projectId)
  assert.equal(data.contextCoverage.budgetReduced, true)
  for (const section of ['tasks', 'acceptedDecisionsAndRecords', 'pendingHumanNeeded']) {
    assert.deepEqual(data.coverage[section], { total: 20, included: data[section].length, omitted: 20 - data[section].length })
  }
})

test('large completed dependency sets cannot crowd out the active experiment or its current execution', () => {
  const base = workerProjectFixture()
  const dependencies = Array.from({ length: 20 }, (_, i) => {
    const view = workerTaskView(`tsk_Dependency${String(i).padStart(4, '0')}`, `exe_Dependency${String(i).padStart(4, '0')}`, `Dependency ${i}`)
    return { ...view, task: { ...view.task, status: 'completed' as const } }
  })
  const active = workerTaskView('tsk_CurrentExperiment01', 'exe_CurrentExperiment01', 'Current experiment')
  const data = { ...base, tasks: [...dependencies, {
    ...active,
    task: { ...active.task, dependencyTaskIds: dependencies.map(({ task }) => task.taskId) },
    executions: [...active.executions, ...Array.from({ length: 10 }, (_, i) => ({
      ...active.executions[0]!, executionId: `exe_OtherAttempt${String(i).padStart(4, '0')}`, revision: 100 + i
    }))]
  }], pendingHumanNeeded: [] }
  const parsed = JSON.parse(renderProjectSessionContext(data, projectionFixture().bindings[0]!))
  assert.equal(parsed.tasks[0].taskId, active.task.taskId)
  assert.equal(parsed.tasks[0].executions[0].executionId, active.task.currentExecutionId)
  assert.deepEqual(parsed.coverage.tasks, { total: 21, included: 12, omitted: 9 })
  assert.deepEqual(parsed.contextCoverage.clippedLists['tasks[0].dependencyTaskIds'], { total: 20, included: 8, omitted: 12 })
  assert.deepEqual(parsed.contextCoverage.clippedLists['tasks[0].executions'], { total: 11, included: 8, omitted: 3 })
})

test('production task-chat injection without an association preserves unavailable Project snapshots', async () => {
  const provider = createProjectCoordinatorComposerContextProvider({
    readSessionProjection: async () => projectionFixture(),
    readWorkspace: async () => { throw new Error('PRIVATE_CLOUD_FAILURE') }
  } as unknown as ProjectCoordinatorRendererClient, async () => ({ associations: [], activeTaskId: null }))
  const result = await provider.provide(requestFixture({ runtimeId, sessionId: threadId }))
  assert.equal(result.items[0]?.id, 'collaboration.context.unavailable')
  assert.doesNotMatch(result.items[0]?.content ?? '', /PRIVATE_CLOUD_FAILURE/u)
})

test('failure to resolve a persisted task association still blocks context-free sending', async () => {
  const provider = createProjectCoordinatorComposerContextProvider({} as ProjectCoordinatorRendererClient,
    async () => { throw new Error('Task association read failed') })
  await assert.rejects(async () => provider.provide(requestFixture({ runtimeId, sessionId: threadId })), /Task association read failed/u)
})

test('arbitrary chat resolves pasted task ID without acquiring worker authority', async () => {
  const workspace = { ...workspaceFixture(), projects: [workerProjectFixture()] }
  const provider = createProjectCoordinatorComposerContextProvider({
    readWorkspace: async () => workspace,
    readSessionProjection: async () => { throw new Error('No binding should be acquired') }
  } as unknown as ProjectCoordinatorRendererClient)
  const pending = await provider.resolveDraft!(requestFixture({ draftText: '讨论 tsk_ComposerWorker01' }))
  assert.equal(pending.items[0]?.content, 'tsk_ComposerWorker01')
  assert.match(pending.items[0]?.title ?? '', /Exact Worker task/u)
  const result = await provider.provide(requestFixture({ sessionId: 'unrelated-chat', draftText: '讨论 tsk_ComposerWorker01' }))
  assert.equal(result.items.length, 1)
  assert.match(result.items[0]!.content, /\[\[sciforge-task:tsk_ComposerWorker01\]\]/u)
  assert.match(result.items[0]!.content, /does not authorize execution/u)
  assert.doesNotMatch(result.items[0]!.content, /Sibling secret task/u)
  await assert.rejects(() => Promise.resolve(provider.provide(requestFixture({ draftText: 'tsk_UnknownWorker001' }))), /不存在或无权访问/u)
  await assert.rejects(() => Promise.resolve(provider.provide(requestFixture({ draftText: 'tsk_ComposerWorker01 tsk_ComposerSibling1' }))), /只能关联一个任务/u)
})

test('task context inherits only persisted association and can explicitly end it', async () => {
  const workspace = { ...workspaceFixture(), projects: [workerProjectFixture()] }
  const provider = createProjectCoordinatorComposerContextProvider({ readWorkspace: async () => workspace } as unknown as ProjectCoordinatorRendererClient,
    async () => ({ associations: [], activeTaskId: 'tsk_ComposerWorker01' }))
  const result = await provider.provide(requestFixture({ runtimeId, sessionId: threadId, draftText: '继续讨论' }))
  assert.equal(result.items.length, 1)
  const active = await provider.active!(requestFixture({ runtimeId, sessionId: threadId }))
  assert.equal(active.items[0]?.content, '[结束任务关联]')
  assert.deepEqual(await provider.provide(requestFixture({ draftText: '[结束任务关联] 聊点别的' })), { items: [] })
})

test('task references hydrate authorized project details from a multi-project directory in any workspace', async () => {
  const base = workspaceFixture()
  const workerId = 'usr_ComposerWorker01'
  const full = workerProjectFixture()
  const project = { ...full, memberships: [{ ...full.memberships[0]!, userId: workerId, state: 'active' as const }] }
  const invited = { ...project, project: { ...project.project, projectId: 'prj_InvitedProject01' }, memberships: [{ ...project.memberships[0]!, projectId: 'prj_InvitedProject01', state: 'invited' as const }], tasks: [] }
  const connection = { ...base.connection, state: 'ready' as const, userId: workerId, deviceId: 'dev_ComposerWorker01' }
  const directory = { ...base, connection, focusedProjectId: undefined, projects: [{ ...project, tasks: [] }, invited] }
  const reads: Array<string | undefined> = []
  const client = { readWorkspace: async (input: { projectId?: string }) => {
    reads.push(input.projectId)
    if (!input.projectId) return directory
    assert.equal(input.projectId, projectId, 'pending invitation must not be treated as task access')
    return { ...directory, focusedProjectId: projectId, projects: [project, invited] }
  } } as unknown as ProjectCoordinatorRendererClient
  const provider = createProjectCoordinatorComposerContextProvider(client, async () => ({ associations: [], activeTaskId: 'tsk_ComposerWorker01' }))
  const request = { ...requestFixture({ runtimeId, sessionId: 'new-unbound-chat', draftText: 'tsk_ComposerWorker01 写入草稿' }), workspaceRoot: '/unrelated/worker-workspace' }
  const pending = await provider.resolveDraft!(request)
  assert.equal(pending.items[0]?.content, 'tsk_ComposerWorker01')
  const context = await provider.provide(request)
  assert.match(context.items[0]?.content ?? '', /Exact Worker task/u)
  const choices = await provider.search!({ ...request, query: 'Exact Worker' })
  assert.equal(choices.items[0]?.content, 'tsk_ComposerWorker01')
  const active = await provider.active!(request)
  assert.match(active.items[0]?.title ?? '', /Exact Worker task/u)
  assert.deepEqual(reads, [undefined, projectId, undefined, projectId, undefined, projectId, undefined, projectId])
})

test('project detail hydration fails closed on membership revocation and identity changes', async () => {
  const base = workspaceFixture()
  const project = workerProjectFixture()
  const directory = { ...base, focusedProjectId: undefined, projects: [{ ...project, tasks: [] }] }
  let changedIdentity = false
  const provider = createProjectCoordinatorComposerContextProvider({ readWorkspace: async (input: { projectId?: string }) => {
    if (!input.projectId) return directory
    return changedIdentity
      ? { ...base, connection: { state: 'ready', userId: 'usr_AnotherUser0001', deviceId: 'dev_AnotherDevice01' }, projects: [project] }
      : { ...base, projects: [] }
  } } as unknown as ProjectCoordinatorRendererClient)
  const request = requestFixture({ draftText: 'tsk_ComposerWorker01' })
  await assert.rejects(() => Promise.resolve(provider.provide(request)), /不存在或无权访问/u)
  changedIdentity = true
  await assert.rejects(() => Promise.resolve(provider.provide(request)), /账户已变化/u)
})
