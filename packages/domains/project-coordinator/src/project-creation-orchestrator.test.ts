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

  assert.deepEqual(created, {
    ...receipt,
    coordinatorSession: {
      projectId,
      runtimeId: 'codex-runtime',
      threadId: 'thread-created-project'
    },
    activationRequestId: 'pca_CreatedProject01'
  })
  assert.deepEqual(prepareRequests, [{
    runtimeId: 'codex-runtime',
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

test('v2 succeeded creation replays its existing Coordinator Session without preparing another', async () => {
  const settings = memorySettings()
  await settings.write({
    schemaVersion: 2,
    planDrafts: [],
    coordinatorSessionBindings: [{
      schemaVersion: 1,
      role: 'coordinator',
      projectId,
      principalUserId: ownerUserId,
      coordinatorAgentId: 'agt_ProjectOwner001',
      runtimeId: 'codex-runtime-legacy',
      threadId: 'thread-legacy-created-project',
      coordinatorAuthorityEpoch: 1,
      boundAt: now
    }],
    coordinatorTransferFeedback: [],
    projectCreateIntents: [{
      createIntentId: createInput.createIntentId,
      principalUserId: ownerUserId,
      commandDigest: '6caf1ebe924739811259532f77829f4a54ca1adb097f914d082225e6daeec077',
      state: 'succeeded',
      createdProjectId: projectId
    }]
  }, 0)
  const state = new ProjectCoordinatorStateStore(settings)
  let createCalls = 0
  let workspaceReads = 0
  let prepareCalls = 0
  let activationCalls = 0
  const createOrchestrator = () => new ProjectCreationOrchestrator({
    state,
    workspace: {
      createProject: async () => {
        createCalls += 1
        throw new Error('A succeeded v2 create intent must not create another Cloud Project.')
      },
      readWorkspace: async () => {
        workspaceReads += 1
        return projectWorkspace()
      }
    },
    getAgentExecution: () => ({
      prepareSession: async () => {
        prepareCalls += 1
        throw new Error('A succeeded v2 create intent must reuse its bound Coordinator Session.')
      },
      run: async () => { throw new Error('Project creation must not dispatch a Runtime turn.') }
    }),
    currentPrincipalUserId: () => ownerUserId,
    activationRequestId: () => {
      activationCalls += 1
      return 'pca_MustNotBeGenerated01'
    }
  })
  const requestContext = { assertPrincipalCurrent: () => undefined }

  const first = await createOrchestrator().create(createInput, requestContext)
  const replayedAfterRestart = await createOrchestrator().create(createInput, requestContext)

  assert.deepEqual(first.coordinatorSession, {
    projectId,
    runtimeId: 'codex-runtime-legacy',
    threadId: 'thread-legacy-created-project'
  })
  assert.equal(replayedAfterRestart.activationRequestId, first.activationRequestId)
  assert.match(first.activationRequestId, /^pca_[A-Za-z0-9]{12,64}$/u)
  assert.equal(createCalls, 0)
  assert.equal(prepareCalls, 0)
  assert.equal(activationCalls, 0)
  assert.equal(workspaceReads, 2)
  assert.deepEqual(await state.readPendingProjectActivations(), [{
    activationRequestId: first.activationRequestId,
    projectId,
    coordinatorSession: {
      runtimeId: 'codex-runtime-legacy',
      threadId: 'thread-legacy-created-project'
    },
    requestedAt: now
  }])
  await createOrchestrator().acknowledgeActivation(
    first.activationRequestId,
    requestContext.assertPrincipalCurrent
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
      assert.equal(successfulWrites, 2)
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

  assert.deepEqual(second, first)
  assert.equal(createCalls, 2)
  assert.equal(preparedSessions, 2)
  assert.equal(successfulWrites, 2)
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

test('canonical creation fails closed when reviewable Session preparation is unavailable', async () => {
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

  await assert.rejects(
    orchestrator.create(createInput, { assertPrincipalCurrent: () => undefined }),
    /requires reviewable Agent Session preparation/u
  )
  assert.equal(createCalls, 1)
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
    providerPrincipalFacts: [],
    projects: [{
      project: {
        schemaVersion: 1,
        type: 'project',
        projectId,
        ownerUserId,
        displayName: createInput.displayName,
        goal: createInput.goal,
        coordinatorAgentId: 'agt_ProjectOwner001',
        coordinatorAuthorityEpoch: 1,
        executionAuthorityEpoch: 1,
        contentMode: 'none',
        status: 'draft',
        budget: createInput.budget,
        revision: 1,
        createdAt: now,
        updatedAt: now
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
        providerPrincipalFacts: [],
        contentReadiness: [],
        providerMembershipObservations: [],
        externalOperationJournal: [],
        recoveryActions: []
      }
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
