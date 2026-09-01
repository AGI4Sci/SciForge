import assert from 'node:assert/strict'
import test from 'node:test'
import {
  taskExecutionSchema,
  taskSchema
} from '@sciforge/collaboration-contracts'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import type { WorkerSessionProjectionService } from '@sciforge/domain-collaboration/worker-session-projection'

import {
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorCoordinatorSessionBindingRecord,
  type ProjectCoordinatorWorkspace
} from './contract.js'
import type { ProjectCoordinatorWorkspacePort } from './ports.js'
import { createProjectCoordinatorSessionProjectionPort } from './session-projection.js'
import { ProjectCoordinatorStateStore } from './state.js'

const now = '2026-08-28T08:00:00.000Z'
const projectId = 'prj_ProjectSession001'
const ownerUserId = 'usr_ProjectOwner001'
const workerUserId = 'usr_ProjectWorker01'
const coordinatorAgentId = 'agt_ProjectCoord0001'
const workerAgentId = 'agt_ProjectWorker01'
const workerDeviceId = 'dev_ProjectWorker01'
const taskId = 'tsk_ProjectTask0001'
const executionId = 'exe_ProjectExec0001'

test('state commit permits only one Coordinator Session per Project authority and projection filters stale Principals', async () => {
  const settings = memorySettings()
  const state = new ProjectCoordinatorStateStore(settings)
  await commitCoordinatorSession(state, 'runtime-a', 'thread-a')
  await assert.rejects(
    commitCoordinatorSession(state, 'runtime-b', 'thread-b'),
    /already has a Coordinator Session binding/u
  )
  await commitCoordinatorSession(
    state,
    'runtime-old',
    'thread-old',
    'usr_PreviousOwner01',
    2
  )
  assert.deepEqual((await state.readCoordinatorSessionBindings()).map((binding) => ({
    coordinatorAuthorityEpoch: binding.coordinatorAuthorityEpoch,
    runtimeId: binding.runtimeId,
    threadId: binding.threadId
  })), [{
    coordinatorAuthorityEpoch: 1,
    runtimeId: 'runtime-a',
    threadId: 'thread-a'
  }, {
    coordinatorAuthorityEpoch: 2,
    runtimeId: 'runtime-old',
    threadId: 'thread-old'
  }])
  const port = createProjectCoordinatorSessionProjectionPort({
    state,
    workspace: workspacePort(() => workspaceFixture({ principalUserId: ownerUserId })),
    workers: workerProjection([]),
    localAgentId: () => coordinatorAgentId,
    now: () => new Date(now)
  })

  const uiProjection = await port.readProjection()
  assert.deepEqual(uiProjection.bindings.map(({ runtimeId, threadId }) => (
    `${runtimeId}/${threadId}`
  )), ['runtime-a/thread-a'])
  assert.deepEqual(uiProjection.suppressedSessions, [{
    runtimeId: 'runtime-old',
    threadId: 'thread-old'
  }])
  assert.deepEqual(uiProjection.pendingActivations.map(({ coordinatorSession }) => (
    `${coordinatorSession.runtimeId}/${coordinatorSession.threadId}`
  )), ['runtime-a/thread-a'])
  assert.equal(JSON.stringify(uiProjection).includes('usr_PreviousOwner01'), false)

  const agentProjection = await port.readProjection({
    runtimeId: 'runtime-a',
    threadId: 'thread-a'
  })
  assert.deepEqual(agentProjection.bindings.map(({ runtimeId, threadId }) => (
    `${runtimeId}/${threadId}`
  )), ['runtime-a/thread-a'])
  assert.deepEqual(await port.readProjection({
    runtimeId: 'runtime-unbound',
    threadId: 'thread-unbound'
  }), {
    schemaVersion: 2,
    observedAt: now,
    bindings: [],
    suppressedSessions: [],
    pendingActivations: []
  })
})

test('identity projection read errors propagate instead of becoming a known-unbound Session', async () => {
  const workspace = workspaceFixture({ principalUserId: ownerUserId })
  const port = createProjectCoordinatorSessionProjectionPort({
    state: new ProjectCoordinatorStateStore(memorySettings()),
    workspace: {
      readWorkspace: async (input) => {
        if (!input.projectId) throw new Error('Identity workspace unavailable.')
        return workspace
      }
    },
    workers: workerProjection([]),
    localAgentId: () => coordinatorAgentId,
    now: () => new Date(now)
  })

  await assert.rejects(port.readProjection(), /Identity workspace unavailable/u)
  assert.equal((await port.authorize(
    projectId,
    { runtimeId: 'runtime-unbound', threadId: 'thread-unbound' },
    'coordinator'
  )).access, 'coordinator')
})

test('explicit Project reads are Principal-scoped and Coordinator authority epoch fences every write', async () => {
  const settings = memorySettings()
  const state = new ProjectCoordinatorStateStore(settings)
  let workspace = workspaceFixture({ principalUserId: ownerUserId })
  const port = createProjectCoordinatorSessionProjectionPort({
    state,
    workspace: workspacePort(() => workspace),
    workers: workerProjection([]),
    localAgentId: () => coordinatorAgentId,
    now: () => new Date(now)
  })
  const session = { runtimeId: 'runtime-owner', threadId: 'thread-owner' }

  // Session bindings are not the source of the selected Project.  An
  // otherwise unbound Session may enumerate the current Principal's visible
  // workspace, and may target an exact Project explicitly.
  assert.deepEqual(await port.scopeWorkspaceRead({}, session), {})
  assert.deepEqual(await port.scopeWorkspaceRead({ projectId }, session), { projectId })
  assert.equal(
    (await port.authorize(projectId, session, 'coordinator')).access,
    'coordinator'
  )
  for (const localAgentId of [workerAgentId, undefined]) {
    const withoutCoordinatorAgent = createProjectCoordinatorSessionProjectionPort({
      state,
      workspace: workspacePort(() => workspace),
      workers: workerProjection([]),
      localAgentId: () => localAgentId,
      now: () => new Date(now)
    })
    assert.equal(
      (await withoutCoordinatorAgent.authorize(projectId, session, 'member')).access,
      'member'
    )
    await assert.rejects(
      withoutCoordinatorAgent.authorize(projectId, session, 'coordinator'),
      /does not hold current Coordinator authority/u
    )
  }
  await commitCoordinatorSession(state, session.runtimeId, session.threadId)
  assert.deepEqual(await port.scopeWorkspaceRead({}, session), {})
  assert.deepEqual(await port.scopeWorkspaceRead({ projectId }, session), { projectId })
  assert.equal((await port.authorize(projectId, session, 'coordinator')).access, 'coordinator')
  const reboundToAnotherLocalAgent = createProjectCoordinatorSessionProjectionPort({
    state,
    workspace: workspacePort(() => workspace),
    workers: workerProjection([]),
    localAgentId: () => workerAgentId,
    now: () => new Date(now)
  })
  const reboundProjection = await reboundToAnotherLocalAgent.readProjection(session)
  assert.equal(reboundProjection.bindings[0]?.access, 'read_only')
  assert.equal(reboundProjection.bindings[0]?.fenceReason, 'authority_changed')
  await assert.rejects(
    reboundToAnotherLocalAgent.authorize(projectId, session, 'coordinator'),
    /does not hold current Coordinator authority/u
  )
  const restarted = createProjectCoordinatorSessionProjectionPort({
    state: new ProjectCoordinatorStateStore(settings),
    workspace: workspacePort(() => workspace),
    workers: workerProjection([]),
    localAgentId: () => coordinatorAgentId,
    now: () => new Date(now)
  })
  assert.equal((await restarted.readProjection(session)).bindings[0]?.access, 'coordinator')

  workspace = workspaceFixture({
    principalUserId: ownerUserId,
    coordinatorAuthorityEpoch: 2
  })
  const projection = await port.readProjection(session)
  assert.equal(projection.bindings[0]?.access, 'read_only')
  assert.equal(projection.bindings[0]?.fenceReason, 'authority_changed')
  await assert.rejects(
    port.authorize(projectId, session, 'coordinator'),
    /does not hold current Coordinator authority/u
  )
})

test('Worker projection requires the exact current execution fence', async () => {
  let workspace = workspaceFixture({
    principalUserId: workerUserId,
    includeWorkerExecution: true
  })
  const binding = workerBinding()
  const port = createProjectCoordinatorSessionProjectionPort({
    state: new ProjectCoordinatorStateStore(memorySettings()),
    workspace: workspacePort(() => workspace),
    workers: workerProjection([binding]),
    localAgentId: () => workerAgentId,
    now: () => new Date(now)
  })
  const session = { runtimeId: binding.runtimeId, threadId: binding.threadId }

  const current = await port.readProjection(session)
  assert.equal(current.bindings[0]?.role, 'worker')
  assert.equal(current.bindings[0]?.access, 'worker')
  assert.equal((await port.authorize(projectId, session, 'member')).access, 'worker')

  const reboundToAnotherLocalAgent = createProjectCoordinatorSessionProjectionPort({
    state: new ProjectCoordinatorStateStore(memorySettings()),
    workspace: workspacePort(() => workspace),
    workers: workerProjection([binding]),
    localAgentId: () => coordinatorAgentId,
    now: () => new Date(now)
  })
  const reboundProjection = await reboundToAnotherLocalAgent.readProjection(session)
  assert.equal(reboundProjection.bindings[0]?.access, 'read_only')
  assert.equal(reboundProjection.bindings[0]?.fenceReason, 'authority_changed')
  await assert.rejects(
    reboundToAnotherLocalAgent.authorize(projectId, session, 'member'),
    /ordinary Session is fenced: authority_changed/u
  )

  const unboundSession = { runtimeId: 'runtime-unbound-worker', threadId: 'thread-unbound-worker' }
  assert.deepEqual(
    await port.scopeWorkspaceRead({ projectId }, unboundSession),
    { projectId }
  )
  assert.equal(
    (await port.authorize(projectId, unboundSession, 'member')).access,
    'member'
  )
  await assert.rejects(
    port.authorize(projectId, unboundSession, 'coordinator'),
    /does not hold current Coordinator authority/u
  )

  workspace = workspaceFixture({
    principalUserId: workerUserId,
    includeWorkerExecution: true,
    executionFenceStatus: 'fenced'
  })
  const fenced = await port.readProjection(session)
  assert.equal(fenced.bindings[0]?.access, 'read_only')
  assert.equal(fenced.bindings[0]?.fenceReason, 'execution_fenced')
  await assert.rejects(
    port.authorize(projectId, session, 'member'),
    /ordinary Session is fenced: execution_fenced/u
  )
})

test('membership removal clears Coordinator and Worker public scope and rejects authorization', async () => {
  const coordinatorState = new ProjectCoordinatorStateStore(memorySettings())
  const coordinatorSession = {
    runtimeId: 'runtime-removed-owner',
    threadId: 'thread-removed-owner'
  }
  await commitCoordinatorSession(coordinatorState,
    coordinatorSession.runtimeId,
    coordinatorSession.threadId
  )
  const coordinator = createProjectCoordinatorSessionProjectionPort({
    state: coordinatorState,
    workspace: workspacePort(() => workspaceFixture({
      principalUserId: ownerUserId,
      ownerMembershipState: 'membership_removal_pending'
    })),
    workers: workerProjection([]),
    localAgentId: () => coordinatorAgentId,
    now: () => new Date(now)
  })

  assert.deepEqual((await coordinator.readProjection(coordinatorSession)).bindings, [])
  assert.deepEqual(
    (await coordinator.readProjection(coordinatorSession)).suppressedSessions,
    [coordinatorSession]
  )
  await assert.rejects(
    coordinator.authorize(projectId, coordinatorSession, 'coordinator'),
    /does not hold current Coordinator authority/u
  )

  const workerSessionBinding = workerBinding()
  const workerSession = {
    runtimeId: workerSessionBinding.runtimeId,
    threadId: workerSessionBinding.threadId
  }
  const worker = createProjectCoordinatorSessionProjectionPort({
    state: new ProjectCoordinatorStateStore(memorySettings()),
    workspace: workspacePort(() => workspaceFixture({
      principalUserId: workerUserId,
      includeWorkerExecution: true,
      workerMembershipState: 'removed'
    })),
    workers: workerProjection([workerSessionBinding]),
    localAgentId: () => workerAgentId,
    now: () => new Date(now)
  })

  assert.deepEqual((await worker.readProjection(workerSession)).bindings, [])
  assert.deepEqual(
    (await worker.readProjection(workerSession)).suppressedSessions,
    [workerSession]
  )
  await assert.rejects(
    worker.authorize(projectId, workerSession, 'member'),
    /ordinary Session is fenced: membership_inactive/u
  )
})

test('duplicate historical Worker journals deterministically suppress the conflicted Session', async () => {
  const first = workerBinding()
  const second = {
    ...first,
    taskId: 'tsk_ConflictingTask01',
    executionId: 'exe_ConflictingExec1'
  }
  const port = createProjectCoordinatorSessionProjectionPort({
    state: new ProjectCoordinatorStateStore(memorySettings()),
    workspace: workspacePort(() => workspaceFixture({
      principalUserId: workerUserId,
      includeWorkerExecution: true
    })),
    workers: workerProjection([first, second]),
    localAgentId: () => workerAgentId,
    now: () => new Date(now)
  })
  const session = { runtimeId: first.runtimeId, threadId: first.threadId }

  assert.deepEqual((await port.readProjection()).bindings, [])
  assert.deepEqual((await port.readProjection(session)).bindings, [])
  assert.deepEqual((await port.readProjection(session)).suppressedSessions, [session])
  await assert.rejects(
    port.authorize(projectId, session, 'member'),
    /conflicting Project bindings/u
  )
})

test('cross-Project double bindings fail closed before explicit Project write authorization', async () => {
  const targetBinding = workerBinding()
  const otherProjectBinding = {
    ...targetBinding,
    projectId: 'prj_OtherProject001',
    taskId: 'tsk_OtherProjectTask1',
    executionId: 'exe_OtherProjectExec1'
  }
  const session = {
    runtimeId: targetBinding.runtimeId,
    threadId: targetBinding.threadId
  }
  const sharedOptions = {
    state: new ProjectCoordinatorStateStore(memorySettings()),
    workspace: workspacePort(() => workspaceFixture({
      principalUserId: workerUserId,
      includeWorkerExecution: true
    })),
    localAgentId: () => workerAgentId,
    now: () => new Date(now)
  }

  const singlyBound = createProjectCoordinatorSessionProjectionPort({
    ...sharedOptions,
    workers: workerProjection([otherProjectBinding])
  })
  assert.equal(
    (await singlyBound.authorize(projectId, session, 'member')).access,
    'member'
  )

  const conflicted = createProjectCoordinatorSessionProjectionPort({
    ...sharedOptions,
    workers: workerProjection([targetBinding, otherProjectBinding])
  })
  assert.deepEqual((await conflicted.readProjection(session)).bindings, [])
  assert.deepEqual((await conflicted.readProjection(session)).suppressedSessions, [session])
  await assert.rejects(
    conflicted.authorize(projectId, session, 'member'),
    /conflicting Project bindings/u
  )
})

function coordinatorBinding(
  runtimeId: string,
  threadId: string
): ProjectCoordinatorCoordinatorSessionBindingRecord {
  return {
    schemaVersion: 1,
    role: 'coordinator',
    projectId,
    principalUserId: ownerUserId,
    coordinatorAgentId,
    coordinatorAuthorityEpoch: 1,
    runtimeId,
    threadId,
    boundAt: now
  }
}

async function commitCoordinatorSession(
  state: ProjectCoordinatorStateStore,
  runtimeId: string,
  threadId: string,
  principalUserId: string = ownerUserId,
  coordinatorAuthorityEpoch: number = 1
): Promise<void> {
  const token = `${runtimeId}${threadId}`
    .replaceAll(/[^A-Za-z0-9]/gu, '')
    .slice(0, 24)
    .padEnd(12, '0')
  const createInput = {
    createIntentId: `pct_${token}`,
    displayName: 'Bound Project',
    goal: 'Bind one fresh ordinary Coordinator Session.',
    budget: {
      maxTasks: 4,
      maxTasksPerRound: 4,
      maxTaskRetries: 1,
      maxCoordinationRounds: 2
    }
  }
  const createIntentId = await state.resolveProjectCreateIntent(
    principalUserId,
    createInput
  )
  const receipt = {
    createIntentId,
    createdProjectId: projectId,
    workspace: workspaceFixture({ principalUserId: ownerUserId })
  }
  const binding = {
    ...coordinatorBinding(runtimeId, threadId),
    principalUserId,
    coordinatorAuthorityEpoch
  }
  await state.commitProjectCreation(
    principalUserId,
    { ...createInput, createIntentId },
    receipt,
    binding,
    {
      activationRequestId: `pca_${token}`,
      projectId,
      coordinatorSession: { runtimeId, threadId },
      requestedAt: now
    }
  )
}

function workerBinding() {
  return {
    schemaVersion: 1 as const,
    projectId,
    taskId,
    executionId,
    runtimeId: 'runtime-worker',
    threadId: 'thread-worker',
    workerUserId,
    assigneeAgentId: workerAgentId,
    assigneeDeviceId: workerDeviceId,
    taskRevision: 3,
    executionRevision: 4,
    executionState: 'running' as const,
    fenceStatus: 'open' as const,
    projectExecutionAuthorityEpoch: 2,
    userTaskAuthorityEpoch: 3,
    updatedAt: now
  }
}

function workerProjection(
  bindings: ReturnType<typeof workerBinding>[]
): WorkerSessionProjectionService {
  return { listBindings: () => bindings }
}

function workspacePort(
  read: () => ProjectCoordinatorWorkspace
): ProjectCoordinatorWorkspacePort {
  return {
    readWorkspace: async () => read()
  }
}

function workspaceFixture(input: Readonly<{
  principalUserId: string
  coordinatorAuthorityEpoch?: number
  includeWorkerExecution?: boolean
  executionFenceStatus?: 'open' | 'fenced'
  ownerMembershipState?: 'active' | 'membership_removal_pending' | 'removed'
  workerMembershipState?: 'active' | 'membership_removal_pending' | 'removed'
}>): ProjectCoordinatorWorkspace {
  const includeWorkerExecution = input.includeWorkerExecution ?? false
  const fenceStatus = input.executionFenceStatus ?? 'open'
  const task = taskSchema.parse({
    schemaVersion: 1,
    type: 'task',
    taskId,
    projectId,
    createdByCoordinatorAgentId: coordinatorAgentId,
    title: 'Process one Project input',
    objective: 'Produce one reviewable result.',
    completionCriteria: ['The result is traceable to this execution.'],
    dependencyTaskIds: [],
    requiredCapabilityTags: ['runtime.text'],
    fileIntent: null,
    currentExecutionId: executionId,
    currentExecutionState: fenceStatus === 'open' ? 'running' : 'cancelled',
    status: fenceStatus === 'open' ? 'in_progress' : 'revision_requested',
    executionCount: 1,
    maxRetries: 2,
    completedAt: null,
    revision: 3,
    createdAt: now,
    updatedAt: now
  })
  const execution = taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId,
    taskId,
    executionId,
    attempt: 1,
    offeredByCoordinatorAgentId: coordinatorAgentId,
    assigneeUserId: workerUserId,
    assigneeAgentId: workerAgentId,
    assigneeDeviceId: workerDeviceId,
    state: fenceStatus === 'open' ? 'running' : 'cancelled',
    stateRevision: 3,
    fence: {
      schemaVersion: 1,
      executionId,
      assigneeUserId: workerUserId,
      assigneeAgentId: workerAgentId,
      assigneeDeviceId: workerDeviceId,
      assignmentTaskRevision: 3,
      projectExecutionAuthorityEpoch: 2,
      userTaskAuthorityEpoch: 3,
      bindingRevision: null,
      status: fenceStatus,
      reason: fenceStatus === 'open' ? null : 'membership_removed',
      fencedAt: fenceStatus === 'open' ? null : now
    },
    fileIntent: null,
    currentResultSubmissionId: null,
    offeredAt: now,
    acceptedAt: now,
    startedAt: now,
    terminalAt: fenceStatus === 'open' ? null : now,
    revision: 4,
    createdAt: now,
    updatedAt: now
  })
  return projectCoordinatorWorkspaceSchema.parse({
    connection: {
      state: 'ready',
      userId: input.principalUserId,
      deviceId: input.principalUserId === ownerUserId
        ? 'dev_ProjectOwner001'
        : workerDeviceId
    },
    observedAt: now,
    focusedProjectId: projectId,
    availableWorkerUsers: [],
    providerPrincipalFacts: [],
    projects: [{
      project: {
        schemaVersion: 1,
        type: 'project',
        projectId,
        ownerUserId,
        displayName: 'Project Session test',
        goal: 'Verify ordinary Session authority projection.',
        coordinatorAgentId,
        coordinatorAuthorityEpoch: input.coordinatorAuthorityEpoch ?? 1,
        executionAuthorityEpoch: 2,
        contentMode: 'none',
        status: 'active',
        budget: {
          maxTasks: 8,
          maxTasksPerRound: 2,
          maxTaskRetries: 2,
          maxCoordinationRounds: 4
        },
        revision: 5,
        createdAt: now,
        updatedAt: now
      },
      coordinatorTransferFeedback: null,
      plan: null,
      memberUsers: [],
      workerGroups: [],
      tasks: includeWorkerExecution ? [{ task, executions: [execution] }] : [],
      offers: [],
      reviews: [],
      pendingHumanNeeded: [],
      records: [],
      finalSummary: null,
      provisioning: {
        intent: null,
        attestation: null,
        binding: null,
        memberships: [
          membership(
            ownerUserId,
            'pmb_ProjectOwner001',
            input.ownerMembershipState ?? 'active'
          ),
          membership(
            workerUserId,
            'pmb_ProjectWorker01',
            input.workerMembershipState ?? 'active'
          )
        ],
        providerPrincipalFacts: [],
        contentReadiness: [],
        providerMembershipObservations: [],
        externalOperationJournal: [],
        recoveryActions: []
      }
    }]
  })
}

function membership(
  userId: string,
  projectMembershipId: string,
  state: 'active' | 'membership_removal_pending' | 'removed'
) {
  const removing = state !== 'active'
  return {
    schemaVersion: 1 as const,
    type: 'project_membership' as const,
    projectMembershipId,
    projectId,
    userId,
    state,
    authorityEpoch: (userId === ownerUserId ? 1 : 3) + (removing ? 1 : 0),
    activatedAt: now,
    removalRequestedAt: removing ? now : null,
    removalRequestedByUserId: removing ? ownerUserId : null,
    removedAt: state === 'removed' ? now : null,
    revision: 1,
    createdAt: now,
    updatedAt: now
  }
}

function memorySettings(): DomainMainPackageSettingsHost {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
  return {
    read: async () => ({ revision, value }),
    write: async (next, expectedRevision) => {
      assert.equal(expectedRevision, revision)
      value = next
      revision += 1
      return { revision, value }
    },
    clear: async (expectedRevision) => {
      assert.equal(expectedRevision, revision)
      value = null
      revision += 1
      return { revision, value }
    }
  }
}
