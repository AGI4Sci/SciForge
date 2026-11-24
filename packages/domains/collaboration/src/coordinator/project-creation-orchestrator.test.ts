import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'

import type {
  ProjectCoordinatorProjectCreateReceipt,
  ProjectCoordinatorWorkspace
} from './contract.js'
import { ProjectCreationOrchestrator } from './project-creation-orchestrator.js'
import { ProjectCoordinatorStateStore } from './state.js'

const now = '2026-08-29T01:00:00.000Z'
const ownerUserId = 'usr_ProjectOwner001'
const projectId = 'prj_CreatedProject01'
const createInput = {
  createIntentId: 'pct_CreateProject001',
  displayName: 'Created Project',
  goal: 'Create one Project with a fresh reviewable Coordinator Session.',
  budget: {
    maxTasks: 4,
    maxTasksPerRound: 2,
    maxTaskRetries: 1,
    maxCoordinationRounds: 2
  }
}

test('canonical creation atomically returns, persists, and replays one fresh Coordinator Session', async () => {
  const state = new ProjectCoordinatorStateStore(memorySettings())
  const receipt = projectReceipt()
  const prepareRequests: unknown[] = []
  let createCalls = 0
  let workspaceReads = 0
  let principalAssertions = 0
  const orchestrator = new ProjectCreationOrchestrator({
    state,
    workspace: {
      createProject: async (input) => {
        createCalls += 1
        assert.equal(input.createIntentId, createInput.createIntentId)
        return receipt
      },
      readWorkspace: async ({ projectId: requestedProjectId }) => {
        workspaceReads += 1
        assert.equal(requestedProjectId, projectId)
        return receipt.workspace
      }
    },
    getAgentExecution: () => ({
      prepareSession: async (request) => {
        prepareRequests.push(request)
        return {
          runtimeId: 'codex-runtime',
          threadId: 'thread-created-project'
        }
      },
      run: async () => { throw new Error('Project creation must not dispatch a Runtime turn.') }
    }),
    currentPrincipalUserId: () => ownerUserId,
    now: () => new Date(now),
    activationRequestId: () => 'pca_CreatedProject01'
  })
  const context = {
    preferredRuntimeId: 'codex-runtime',
    assertPrincipalCurrent: () => { principalAssertions += 1 }
  }

  const created = await orchestrator.create(createInput, context)

  assert.ok(created.initializationState === 'ready')
  assert.deepEqual(created, {
    ...receipt,
    initializationState: 'ready',
    coordinatorSession: {
      projectId,
      runtimeId: 'codex-runtime',
      threadId: 'thread-created-project'
    },
    activationRequestId: 'pca_CreatedProject01'
  })
  assert.deepEqual(prepareRequests, [{
    runtimeId: 'codex-runtime',
    title: 'Created Project · 项目协调',
    interaction: 'reviewable',
    mode: 'agent'
  }])
  assert.deepEqual(await state.readPendingProjectActivations(), [{
    activationRequestId: 'pca_CreatedProject01',
    projectId,
    coordinatorSession: {
      runtimeId: 'codex-runtime',
      threadId: 'thread-created-project'
    },
    requestedAt: now
  }])

  const replayed = await orchestrator.create(createInput, context)
  assert.deepEqual(replayed, created)
  assert.equal(createCalls, 1)
  assert.equal(workspaceReads, 1)
  assert.equal(prepareRequests.length, 1)
  assert.ok(principalAssertions >= 6)

  await orchestrator.acknowledgeActivation(
    created.activationRequestId,
    context.assertPrincipalCurrent
  )
  assert.deepEqual(await state.readPendingProjectActivations(), [])
})

test('pending creation joins concurrent identical and canonical-equivalent intents before Cloud or Session work', async (context) => {
  for (const scenario of [{
    name: 'identical intent',
    secondInput: createInput
  }, {
    name: 'different intent for the same pending business command',
    secondInput: {
      ...createInput,
      createIntentId: 'pct_CreateProject002'
    }
  }]) {
    await context.test(scenario.name, async () => {
      let successfulWrites = 0
      let createCalls = 0
      let prepareCalls = 0
      let activationCalls = 0
      let releaseCloudCreate!: () => void
      let observeCloudCreate!: () => void
      const cloudCreateStarted = new Promise<void>((resolve) => {
        observeCloudCreate = resolve
      })
      const cloudCreateGate = new Promise<void>((resolve) => {
        releaseCloudCreate = resolve
      })
      const state = new ProjectCoordinatorStateStore(memorySettings(() => {
        successfulWrites += 1
      }))
      const orchestrator = new ProjectCreationOrchestrator({
        state,
        workspace: {
          createProject: async () => {
            createCalls += 1
            observeCloudCreate()
            await cloudCreateGate
            return projectReceipt()
          },
          readWorkspace: async () => projectWorkspace()
        },
        getAgentExecution: () => ({
          prepareSession: async () => {
            prepareCalls += 1
            return {
              runtimeId: 'codex-runtime',
              threadId: 'thread-pending-creation'
            }
          },
          run: async () => { throw new Error('Project creation must not dispatch a Runtime turn.') }
        }),
        currentPrincipalUserId: () => ownerUserId,
        now: () => new Date(now),
        activationRequestId: () => {
          activationCalls += 1
          return 'pca_PendingCreate001'
        }
      })
      const requestContext = { assertPrincipalCurrent: () => undefined }

      const first = orchestrator.create(createInput, requestContext)
      const second = orchestrator.create(scenario.secondInput, requestContext)
      await cloudCreateStarted
      assert.equal(createCalls, 1)
      releaseCloudCreate()
      const [firstResult, secondResult] = await Promise.all([first, second])

      assert.deepEqual(secondResult, firstResult)
      assert.equal(firstResult.createIntentId, createInput.createIntentId)
      assert.equal(createCalls, 1)
      assert.equal(prepareCalls, 1)
      assert.equal(activationCalls, 1)
      assert.equal(successfulWrites, 4)
      assert.deepEqual((await state.readCoordinatorSessionBindings()).map((binding) => ({
        runtimeId: binding.runtimeId,
        threadId: binding.threadId
      })), [{
        runtimeId: 'codex-runtime',
        threadId: 'thread-pending-creation'
      }])
      assert.equal((await state.readPendingProjectActivations()).length, 1)
    })
  }
})

test('duplicate intent with differently prepared Sessions returns the single CAS winner', async () => {
  let successfulWrites = 0
  let createCalls = 0
  let preparedSessions = 0
  let releaseCloudCreates!: () => void
  const cloudCreatesReady = new Promise<void>((resolve) => {
    releaseCloudCreates = resolve
  })
  const state = new ProjectCoordinatorStateStore(memorySettings(() => {
    successfulWrites += 1
  }))
  const workspace = {
    createProject: async () => {
      createCalls += 1
      if (createCalls === 2) releaseCloudCreates()
      await cloudCreatesReady
      return projectReceipt()
    },
    readWorkspace: async () => projectWorkspace()
  }
  const orchestrator = (suffix: 'a' | 'b') => new ProjectCreationOrchestrator({
    state,
    workspace,
    getAgentExecution: () => ({
      prepareSession: async () => {
        preparedSessions += 1
        return {
          runtimeId: `codex-runtime-${suffix}`,
          threadId: `thread-duplicate-${suffix}`
        }
      },
      run: async () => { throw new Error('Project creation must not dispatch a Runtime turn.') }
    }),
    currentPrincipalUserId: () => ownerUserId,
    now: () => new Date(now),
    activationRequestId: () => `pca_DuplicateSess${suffix.toUpperCase()}01`
  })
  const requestContext = { assertPrincipalCurrent: () => undefined }

  const [first, second] = await Promise.all([
    orchestrator('a').create(createInput, requestContext),
    orchestrator('b').create(createInput, requestContext)
  ])

  assert.ok(first.initializationState === 'ready')
  assert.deepEqual(second, first)
  assert.equal(createCalls, 2)
  assert.equal(preparedSessions, 2)
  assert.equal(successfulWrites, 4)
  assert.equal((await state.readCoordinatorSessionBindings()).length, 1)
  assert.deepEqual(await state.readPendingProjectActivations(), [{
    activationRequestId: first.activationRequestId,
    projectId,
    coordinatorSession: {
      runtimeId: first.coordinatorSession.runtimeId,
      threadId: first.coordinatorSession.threadId
    },
    requestedAt: now
  }])
})

test('reuses a durably persisted Coordinator Session preparation after a retry', async () => {
  const state = new ProjectCoordinatorStateStore(memorySettings())
  await state.resolveProjectCreateIntent(ownerUserId, createInput)
  await state.persistProjectCreationPreparation(
    ownerUserId,
    createInput,
    projectReceipt(),
    {
      runtimeId: 'codex-runtime',
      threadId: 'thread-prepared-project'
    },
    'pca_PreparedProject01'
  )
  let prepareCalls = 0
  const orchestrator = new ProjectCreationOrchestrator({
    state,
    workspace: {
      createProject: async () => projectReceipt(),
      readWorkspace: async () => projectWorkspace()
    },
    getAgentExecution: () => ({
      prepareSession: async () => {
        prepareCalls += 1
        return {
          runtimeId: 'codex-runtime',
          threadId: 'thread-unexpected-retry'
        }
      },
      run: async () => { throw new Error('Project creation must not dispatch a Runtime turn.') }
    }),
    currentPrincipalUserId: () => ownerUserId,
    now: () => new Date(now),
    activationRequestId: () => {
      throw new Error('A retry must reuse the persisted activation request.')
    }
  })

  const result = await orchestrator.create(createInput, {
    assertPrincipalCurrent: () => undefined
  })

  assert.equal(prepareCalls, 0)
  assert.ok(result.initializationState === 'ready')
  assert.equal(result.coordinatorSession.threadId, 'thread-prepared-project')
  assert.equal(result.activationRequestId, 'pca_PreparedProject01')
})

test('missing reviewable Session preparation preserves an explicit pending Cloud draft', async () => {
  let createCalls = 0
  const receipt = projectReceipt()
  const orchestrator = new ProjectCreationOrchestrator({
    state: new ProjectCoordinatorStateStore(memorySettings()),
    workspace: {
      createProject: async () => {
        createCalls += 1
        return receipt
      },
      readWorkspace: async () => receipt.workspace
    },
    getAgentExecution: () => undefined,
    currentPrincipalUserId: () => ownerUserId
  })

  assert.deepEqual(await orchestrator.create(createInput, { assertPrincipalCurrent: () => undefined }), {
    ...receipt,
    initializationState: 'session_pending',
    reason: 'session_preparation_unavailable'
  })
  assert.equal(createCalls, 1)
})

test('known preparation failure survives restart and resumes the same intent without another Cloud create', async () => {
  const settings = memorySettings()
  let createCalls = 0
  let prepareCalls = 0
  let hostRestored = false
  const workspace = {
    createProject: async () => { createCalls += 1; return projectReceipt() },
    readWorkspace: async ({ projectId: id }: { projectId?: string }) => {
      assert.equal(id, projectId)
      return projectWorkspace()
    }
  }
  const orchestrator = () => new ProjectCreationOrchestrator({
    state: new ProjectCoordinatorStateStore(settings), workspace,
    currentPrincipalUserId: () => ownerUserId,
    getAgentExecution: () => ({
      prepareSession: async () => {
        prepareCalls += 1
        if (!hostRestored) throw Object.assign(new Error('private diagnostic'), { name: 'runtime_not_found' })
        return { runtimeId: 'restored-runtime', threadId: 'thread-restored-project' }
      },
      run: async () => { throw new Error('Creation never dispatches a turn.') }
    }),
    activationRequestId: () => 'pca_RestoredProject01'
  })
  const context = { assertPrincipalCurrent: () => undefined }
  const pending = await orchestrator().create(createInput, context)
  assert.deepEqual(pending, { ...projectReceipt(), initializationState: 'session_pending', reason: 'runtime_not_found' })
  const persisted = new ProjectCoordinatorStateStore(settings)
  assert.equal((await persisted.readProjectCreationPreparation(ownerUserId, createInput))?.createdProjectId, projectId)
  assert.deepEqual(await persisted.readCoordinatorSessionBindings(), [])
  assert.deepEqual(await persisted.readPendingProjectActivations(), [])
  // A new orchestrator/store instance proves recovery does not depend on an in-memory receipt.
  assert.equal((await orchestrator().create(createInput, context)).initializationState, 'session_pending')
  hostRestored = true
  const ready = await orchestrator().create(createInput, context)
  assert.ok(ready.initializationState === 'ready')
  assert.equal(ready.createdProjectId, projectId)
  assert.equal(ready.createIntentId, createInput.createIntentId)
  assert.equal(ready.coordinatorSession.threadId, 'thread-restored-project')
  assert.equal(createCalls, 1)
  assert.equal(prepareCalls, 3)
  assert.equal((await persisted.readCoordinatorSessionBindings()).length, 1)
  assert.equal((await persisted.readPendingProjectActivations()).length, 1)
})

test('unrelated Cloud and unknown preparation failures are never converted to pending success', async () => {
  for (const phase of ['cloud', 'session'] as const) {
    const failure = phase === 'cloud'
      ? Object.assign(new Error('Cloud operation rejected'), { code: 'runtime_not_found' })
      : new Error('Handler failed: {"code":"runtime_not_found"}')
    const orchestrator = new ProjectCreationOrchestrator({
      state: new ProjectCoordinatorStateStore(memorySettings()),
      workspace: {
        createProject: async () => { if (phase === 'cloud') throw failure; return projectReceipt() },
        readWorkspace: async () => projectWorkspace()
      },
      currentPrincipalUserId: () => ownerUserId,
      getAgentExecution: () => ({
        prepareSession: async () => { throw failure },
        run: async () => { throw new Error('Creation never dispatches a turn.') }
      })
    })
    await assert.rejects(orchestrator.create(createInput, { assertPrincipalCurrent: () => undefined }), (error) => error === failure)
  }
})

test('Principal changes during failed preparation fail closed and cannot replay the previous Owner intent', async () => {
  const state = new ProjectCoordinatorStateStore(memorySettings())
  let principal = ownerUserId
  const orchestrator = new ProjectCreationOrchestrator({
    state,
    workspace: { createProject: async () => projectReceipt(), readWorkspace: async () => projectWorkspace() },
    currentPrincipalUserId: () => principal,
    getAgentExecution: () => ({
      prepareSession: async () => {
        principal = 'usr_DifferentOwner001'
        throw Object.assign(new Error('private runtime detail'), { code: 'runtime_not_ready' })
      },
      run: async () => { throw new Error('Creation never dispatches a turn.') }
    })
  })
  const assertPrincipalCurrent = () => { if (principal !== ownerUserId) throw new Error('Principal changed') }
  await assert.rejects(orchestrator.create(createInput, { assertPrincipalCurrent }), /Principal changed/u)
  await assert.rejects(orchestrator.create(createInput, { assertPrincipalCurrent: () => undefined }), /different Owner/u)
  assert.deepEqual(await state.readCoordinatorSessionBindings(), [])
  assert.deepEqual(await state.readPendingProjectActivations(), [])
})

test('Cloud receipt CAS rejects a different Project, principal, or business command for the same intent', async () => {
  const state = new ProjectCoordinatorStateStore(memorySettings())
  await state.resolveProjectCreateIntent(ownerUserId, createInput)
  await state.persistProjectCreationReceipt(ownerUserId, createInput, projectReceipt())
  await assert.rejects(state.persistProjectCreationReceipt('usr_DifferentOwner001', createInput, projectReceipt()), /durable Project create intent/u)
  await assert.rejects(state.persistProjectCreationReceipt(ownerUserId, { ...createInput, goal: 'Different command.' }, projectReceipt()), /durable Project create intent/u)
  const other = 'prj_DifferentProject01'
  const otherWorkspace = projectWorkspace()
  await assert.rejects(state.persistProjectCreationReceipt(ownerUserId, createInput, {
    ...projectReceipt(), createdProjectId: other,
    workspace: { ...otherWorkspace, focusedProjectId: other, projects: otherWorkspace.projects.map((entry) => ({ ...entry, project: { ...entry.project, projectId: other }, memberships: entry.memberships.map((membership) => ({ ...membership, projectId: other })) })) }
  }), /different Cloud Project/u)
})

function projectReceipt(): ProjectCoordinatorProjectCreateReceipt {
  return {
    createIntentId: createInput.createIntentId,
    createdProjectId: projectId,
    workspace: projectWorkspace()
  }
}

function projectWorkspace(): ProjectCoordinatorWorkspace {
  return {
    connection: {
      state: 'ready',
      userId: ownerUserId,
      deviceId: 'dev_ProjectOwner001'
    },
    observedAt: now,
    focusedProjectId: projectId,
    availableWorkerUsers: [],
    projects: [{
      project: {
        schemaVersion: 1,
        type: 'project',
        executionMode: 'manual' as const,
        dispatchAuthorization: null,
        projectId,
        ownerUserId,
        displayName: createInput.displayName,
        goal: createInput.goal,
        coordinatorAgentId: 'agt_ProjectOwner001',
        coordinatorAuthorityEpoch: 1,
        executionAuthorityEpoch: 1,
        status: 'draft',
        budget: createInput.budget,
        revision: 1,
        createdAt: now,
        updatedAt: now
      },
      coordinatorTransferFeedback: null,
      requirementsDraft: null, confirmedRequirements: null,
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
          projectMembershipId: 'pmb_ProjectOwner001',
          projectId,
          userId: ownerUserId,
          state: 'active',
          authorityEpoch: 1,
          activatedAt: now,
          removalRequestedAt: null,
          removalRequestedByUserId: null,
          removedAt: null,
          revision: 1,
          createdAt: now,
          updatedAt: now
        }],
      legacyHistory: { readOnly: true as const, plans: [], tasks: [], executions: [] },
      deliveryDrive: null
    }]
  }
}

function memorySettings(onWrite?: () => void): DomainMainPackageSettingsHost {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
  return {
    read: async () => ({ revision, value }),
    write: async (next, expectedRevision) => {
      assert.equal(expectedRevision, revision)
      value = next
      revision += 1
      onWrite?.()
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
