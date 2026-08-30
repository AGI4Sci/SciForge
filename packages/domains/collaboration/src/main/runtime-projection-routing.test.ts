import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentInboxMessageSchema,
  remoteSessionProjectionSchema,
  taskExecutionSchema,
  taskSchema,
  type AgentInboxMessage,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import {
  agentInboxMessageFixture,
  agentNodeFixture,
  humanAnswerFixture,
  humanEndpointBindingFixture,
  projectFixture,
  remoteSessionProjectionFixture,
  taskFixture,
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP
} from '@sciforge/collaboration-contracts/testing'
import type {
  DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { localProjectionFromRemote } from './projection-coordinator.js'
import {
  CollaborationRuntime,
  activeProjectionBindingsForSession,
  isCoordinatorProjectInboxPayload,
  isWorkerTaskInboxPayload
} from './runtime.js'
import {
  EMPTY_COLLABORATION_LOCAL_STATE,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'
import { createTestAgentCloudRuntime } from './test-agent-cloud-runtime.js'

test('a closed Topic history does not block outbound mirroring for the active Topic on the same Session', () => {
  const active = localProjectionFromRemote(remoteSessionProjectionFixture, {
    runtimeId: 'codex',
    threadId: 'fixed-thread-1',
    bindingMode: 'existing'
  })
  const closed = localProjectionFromRemote(remoteSessionProjectionSchema.parse({
    ...remoteSessionProjectionFixture,
    projectionId: 'rsp_123456789012',
    status: 'closed',
    revision: 2
  }), {
    runtimeId: 'codex',
    threadId: 'fixed-thread-1',
    bindingMode: 'existing'
  })

  assert.deepEqual(
    activeProjectionBindingsForSession([closed, active], 'codex', 'fixed-thread-1'),
    [active]
  )
})

test('runtime routes Worker recovery and offer-closure fanout only to its exact audience owner', () => {
  for (const type of ['task.recovery.output_linked', 'task.recovery.abandoned'] as const) {
    assert.equal(isWorkerTaskInboxPayload({ type } as AgentInboxMessage['payload']), true)
  }
  const workerClosure = {
    type: 'task.offer.closed',
    audience: 'worker'
  } as AgentInboxMessage['payload']
  const coordinatorClosure = {
    type: 'task.offer.closed',
    audience: 'coordinator'
  } as AgentInboxMessage['payload']
  assert.equal(isWorkerTaskInboxPayload(workerClosure), true)
  assert.equal(isCoordinatorProjectInboxPayload(workerClosure), false)
  assert.equal(isWorkerTaskInboxPayload(coordinatorClosure), false)
  assert.equal(isCoordinatorProjectInboxPayload(coordinatorClosure), true)
  assert.equal(isWorkerTaskInboxPayload({
    type: 'human.answer.received'
  } as AgentInboxMessage['payload']), false)
  const projectDeletion = { type: 'project.deleted' } as AgentInboxMessage['payload']
  assert.equal(isWorkerTaskInboxPayload(projectDeletion), false)
  assert.equal(isCoordinatorProjectInboxPayload(projectDeletion), false)
})

test('runtime reserves Project lifecycle and Coordinator feedback for the single Project Coordinator Inbox owner', () => {
  assert.equal(isCoordinatorProjectInboxPayload({
    type: 'project.started'
  } as AgentInboxMessage['payload']), true)
  assert.equal(isCoordinatorProjectInboxPayload({
    type: 'project.plan.confirmed'
  } as AgentInboxMessage['payload']), true)
  assert.equal(isCoordinatorProjectInboxPayload({
    type: 'task.result.submitted'
  } as AgentInboxMessage['payload']), true)
  assert.equal(isCoordinatorProjectInboxPayload({
    type: 'project_record.submitted'
  } as AgentInboxMessage['payload']), true)
  assert.equal(isWorkerTaskInboxPayload({
    type: 'project_record.submitted'
  } as AgentInboxMessage['payload']), false)
  assert.equal(isCoordinatorProjectInboxPayload({
    type: 'coordinator.transferred'
  } as AgentInboxMessage['payload']), true)
  assert.equal(isCoordinatorProjectInboxPayload({
    type: 'human.answer.received',
    answer: { context: { scope: 'coordinator_project' } }
  } as AgentInboxMessage['payload']), true)
  assert.equal(isCoordinatorProjectInboxPayload({
    type: 'human.answer.received',
    answer: { context: { scope: 'worker_execution' } }
  } as AgentInboxMessage['payload']), false)
})

test('a stale Coordinator-only Project event is ACKed before the following deletion cleanup', async () => {
  const startedMessage = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_CoordinatorStale01',
    payload: {
      protocolVersion: '1.0',
      type: 'project.started',
      projectId: TEST_IDS.projectId,
      revision: 2
    }
  })
  const deletedMessage = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_CoordinatorStale02',
    sequence: startedMessage.sequence + 2,
    payload: {
      protocolVersion: '1.0',
      type: 'project.deleted',
      projectId: TEST_IDS.projectId,
      deletedAt: TEST_LATER_TIMESTAMP
    }
  })
  const staleNestedAnswer = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_CoordinatorStale03',
    sequence: startedMessage.sequence + 1,
    payload: {
      protocolVersion: '1.0',
      type: 'human.answer.received',
      answer: {
        ...humanAnswerFixture,
        context: {
          scope: 'coordinator_project',
          coordinatorAuthorityEpoch: 1
        }
      }
    }
  })
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture]
  })
  const handled: string[] = []
  let projectReadCount = 0
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        if (request.type === 'project.get') {
          projectReadCount += 1
          return missingProjectResponse(request)
        }
        return workerCloudResponse(request)
      },
      pullAgentInbox: async ({ afterSequence }) => {
        const messages = [startedMessage, staleNestedAnswer, deletedMessage].filter(({ sequence }) => (
          sequence > afterSequence
        ))
        return { messages, nextSequence: messages.at(-1)?.sequence ?? afterSequence }
      }
    }),
    coordinatorInboxHandler: () => async (message) => { handled.push(message.payload.type) },
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))

  try {
    const state = backend.snapshot()
    assert.equal(state.lastInboxSequence, deletedMessage.sequence)
    assert.deepEqual(handled, ['project.deleted'])
    assert.equal(projectReadCount, 1)
    assert.deepEqual(state.projectUnavailableFences.map(({ kind }) => kind), ['permanent'])
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('a transient Project gate failure retains the unACKed Coordinator Inbox message', async () => {
  const startedMessage = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_CoordinatorRetry01',
    payload: {
      protocolVersion: '1.0',
      type: 'project.started',
      projectId: TEST_IDS.projectId,
      revision: 2
    }
  })
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture]
  })
  let coordinatorCalls = 0
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => request.type === 'project.get'
        ? transientProjectErrorResponse(request)
        : workerCloudResponse(request),
      pullAgentInbox: async ({ afterSequence }) => ({
        messages: afterSequence < startedMessage.sequence ? [startedMessage] : [],
        nextSequence: startedMessage.sequence
      })
    }),
    coordinatorInboxHandler: () => async () => { coordinatorCalls += 1 },
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))

  try {
    const state = backend.snapshot()
    assert.equal(state.lastInboxSequence, 0)
    assert.equal(coordinatorCalls, 0)
    assert.deepEqual(state.projectUnavailableFences, [])
    assert.equal((await runtime.status()).connection.state, 'error')
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('Project deletion fences work, hides Workbench projections, and ACKs stale Project Inbox messages', async () => {
  const backend = new MemoryBackend(cachedRunningProjectState())
  const deletedMessage = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_ProjectDeleted001',
    payload: {
      protocolVersion: '1.0',
      type: 'project.deleted',
      projectId: TEST_IDS.projectId,
      deletedAt: TEST_LATER_TIMESTAMP
    }
  })
  const staleTaskMessage = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_ProjectDeleted002',
    sequence: deletedMessage.sequence + 1,
    payload: {
      protocolVersion: '1.0',
      type: 'task.updated',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      revision: 3,
      status: 'in_progress'
    }
  })
  let projectReadCount = 0
  const coordinatorObservations: Array<Readonly<{
    projectCount: number
    runState: string | undefined
  }>> = []
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        if (request.type === 'project.get') {
          projectReadCount += 1
          return transientProjectErrorResponse(request)
        }
        return workerCloudResponse(request)
      },
      pullAgentInbox: async ({ afterSequence }) => {
        const messages = [deletedMessage, staleTaskMessage].filter(({ sequence }) => (
          sequence > afterSequence
        ))
        return {
          messages,
          nextSequence: messages.at(-1)?.sequence ?? afterSequence
        }
      }
    }),
    coordinatorInboxHandler: () => async () => {
      const state = backend.snapshot()
      coordinatorObservations.push({
        projectCount: state.projects.length,
        runState: state.taskRuns[0]?.state
      })
    },
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))

  try {
    const status = await runtime.status()
    const state = backend.snapshot()
    assert.deepEqual(status.projects, [])
    assert.deepEqual(runtime.listTasks({}), [])
    assert.deepEqual(runtime.listWorkerSessionBindings(), [])
    assert.equal(state.pendingTaskOffers[0]?.state, 'closed')
    assert.equal(state.taskRuns[0]?.state, 'fenced')
    assert.equal(state.taskRuns[0]?.runtimeId, 'codex', 'ordinary local Session history remains')
    assert.equal(state.tasks[0]?.taskId, TEST_IDS.taskId, 'durable Task history remains')
    assert.deepEqual(state.projectUnavailableFences.map(({ kind }) => kind), ['permanent'])
    assert.equal(state.lastInboxSequence, staleTaskMessage.sequence)
    assert.equal(projectReadCount, 1, 'the permanent fence suppresses stale-message refreshes')
    assert.deepEqual(coordinatorObservations, [{ projectCount: 0, runState: 'fenced' }])
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('restart evicts a cached deleted Project and hides its retained Task and Session projections', async () => {
  const backend = new MemoryBackend(cachedRunningProjectState())
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        if (request.type === 'project.get') return missingProjectResponse(request)
        return workerCloudResponse(request)
      }
    }),
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))

  try {
    const state = backend.snapshot()
    assert.deepEqual((await runtime.status()).projects, [])
    assert.deepEqual(runtime.listTasks({}), [])
    assert.deepEqual(runtime.listWorkerSessionBindings(), [])
    assert.equal(state.projects.length, 0)
    assert.deepEqual(state.projectUnavailableFences.map(({ kind }) => kind), ['permanent'])
    assert.equal(state.pendingTaskOffers[0]?.state, 'closed')
    assert.equal(state.taskRuns[0]?.state, 'fenced')
    assert.equal(state.taskRuns[0]?.threadId, 'worker-deleted-project-thread')
    assert.equal(state.tasks[0]?.taskId, TEST_IDS.taskId)
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('restart evicts a cached Project after final membership visibility is revoked', async () => {
  const backend = new MemoryBackend(cachedRunningProjectState())
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        if (request.type === 'project.get') return permissionDeniedProjectResponse(request)
        return workerCloudResponse(request)
      }
    }),
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))

  try {
    const state = backend.snapshot()
    assert.deepEqual((await runtime.status()).projects, [])
    assert.deepEqual(runtime.listTasks({}), [])
    assert.deepEqual(runtime.listWorkerSessionBindings(), [])
    assert.equal(state.projects.length, 0)
    assert.deepEqual(state.projectUnavailableFences.map(({ kind }) => kind), ['permission-denied'])
    assert.equal(state.pendingTaskOffers[0]?.state, 'closed')
    assert.equal(state.taskRuns[0]?.state, 'fenced')
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('a successful reconnect clears a recoverable permission fence and restores the Project fact', async () => {
  const initial = cachedRunningProjectState()
  initial.projects = []
  initial.projectUnavailableFences = [{
    projectId: TEST_IDS.projectId,
    kind: 'permission-denied',
    reason: 'Cloud revoked visibility for this Project; local execution was fenced.',
    observedAt: TEST_TIMESTAMP
  }]
  initial.pendingTaskOffers[0]!.state = 'closed'
  initial.pendingTaskOffers[0]!.completedAt = TEST_TIMESTAMP
  initial.pendingTaskOffers[0]!.error = 'Visibility was revoked.'
  initial.taskRuns[0]!.state = 'fenced'
  initial.taskRuns[0]!.completedAt = TEST_TIMESTAMP
  initial.taskRuns[0]!.error = 'Visibility was revoked.'
  const backend = new MemoryBackend(initial)
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => workerCloudResponse(request)
    }),
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))

  try {
    const state = backend.snapshot()
    assert.deepEqual(state.projects.map(({ projectId }) => projectId), [TEST_IDS.projectId])
    assert.deepEqual(state.projectUnavailableFences, [])
    assert.equal(state.taskRuns[0]?.state, 'fenced', 'revalidation never resurrects historical work')
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('a transient Project refresh error fails closed without evicting the cached Project', async () => {
  const secondProjectId = 'prj_Proj00000002'
  const initial = cachedRunningProjectState()
  initial.projects.push({
    ...projectFixture,
    projectId: secondProjectId,
    displayName: 'Deleted cached Project'
  })
  const backend = new MemoryBackend(initial)
  const projectLookups: string[] = []
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        if (request.type === 'project.get') {
          projectLookups.push(request.projectId)
          return request.projectId === TEST_IDS.projectId
            ? transientProjectErrorResponse(request)
            : missingProjectResponse(request, request.projectId)
        }
        return workerCloudResponse(request)
      }
    }),
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))

  try {
    const state = backend.snapshot()
    assert.deepEqual(state.projects.map(({ projectId }) => projectId), [TEST_IDS.projectId])
    assert.deepEqual(new Set(projectLookups), new Set([TEST_IDS.projectId, secondProjectId]))
    assert.deepEqual(state.projectUnavailableFences.map(({ projectId, kind }) => ({ projectId, kind })), [{
      projectId: secondProjectId,
      kind: 'permanent'
    }])
    assert.equal(state.pendingTaskOffers[0]?.state, 'awaiting-manual')
    assert.equal(state.taskRuns[0]?.state, 'running')
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('automatic connection recovery revalidates cached Projects once without rescanning every heartbeat', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const backend = new MemoryBackend(cachedRunningProjectState())
  let heartbeatCount = 0
  let projectReadCount = 0
  let inboxPullCount = 0
  let inboxSubscriptionCount = 0
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        if (request.type === 'agent.heartbeat') heartbeatCount += 1
        if (request.type === 'project.get') {
          projectReadCount += 1
          return projectReadCount === 1
            ? workerCloudResponse(request)
            : missingProjectResponse(request)
        }
        return workerCloudResponse(request)
      },
      pullAgentInbox: async () => {
        inboxPullCount += 1
        if (inboxPullCount === 2) {
          throw new Error('Inbox sequence gap requires another recovery poll.')
        }
        return { messages: [], nextSequence: 0 }
      },
      observeAgentInbox: async function* (_agentId, signal) {
        inboxSubscriptionCount += 1
        if (inboxSubscriptionCount === 1) {
          throw new Error('The live Inbox connection was interrupted.')
        }
        await waitForAbort(signal)
        yield* [] as never[]
      }
    }),
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))

  try {
    await waitForImmediateCondition(async () => (
      (await runtime.status()).connection.state === 'recovering'
    ))
    assert.equal(projectReadCount, 1)
    assert.equal(backend.snapshot().projects.length, 1)

    context.mock.timers.tick(15_000)
    await waitForImmediateCondition(async () => (
      (await runtime.status()).connection.state === 'error' &&
      backend.snapshot().projects.length === 0
    ))
    assert.equal(projectReadCount, 2)
    assert.equal(inboxPullCount, 2, 'Project reconciliation precedes the failed Inbox pull')
    assert.equal(backend.snapshot().taskRuns[0]?.state, 'fenced')
    assert.deepEqual(backend.snapshot().projectUnavailableFences.map(({ kind }) => kind), ['permanent'])

    context.mock.timers.tick(15_000)
    await waitForImmediateCondition(async () => (
      (await runtime.status()).connection.state === 'connected'
    ))
    assert.equal(projectReadCount, 2, 'the permanent fence prevents repeated Project reads')

    context.mock.timers.tick(15_000)
    await waitForImmediateCondition(() => heartbeatCount >= 4)
    assert.equal(projectReadCount, 2, 'an ordinary connected heartbeat does not rescan Projects')
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('a Worker Task offer hydrates its Project into the public collaboration status', async () => {
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture]
  })
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    payload: {
      protocolVersion: '1.0',
      type: 'task.offered',
      projectId: projectFixture.projectId,
      taskId: taskFixture.taskId,
      taskOfferId: TEST_IDS.taskOfferId,
      workerUserId: TEST_IDS.userId,
      currentTaskRevision: taskFixture.revision,
      offerRevision: 1
    }
  })
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => workerCloudResponse(request),
      pullAgentInbox: async ({ afterSequence }) => ({
        messages: afterSequence < message.sequence ? [message] : [],
        nextSequence: message.sequence
      })
    }),
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))

  try {
    const status = await runtime.status()
    assert.deepEqual(status.projects.map(({ projectId }) => projectId), [projectFixture.projectId])
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('restart hydrates Projects referenced by durable Worker Task journals', async () => {
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture],
    pendingTaskOffers: [{
      projectId: projectFixture.projectId,
      taskId: taskFixture.taskId,
      taskOfferId: TEST_IDS.taskOfferId,
      workerUserId: TEST_IDS.userId,
      currentTaskRevision: taskFixture.revision,
      offerRevision: 1,
      recipientAgentId: agentNodeFixture.agentId,
      receivedAt: agentInboxMessageFixture.createdAt,
      preflightReasons: [],
      state: 'closed',
      updatedAt: agentInboxMessageFixture.createdAt,
      completedAt: agentInboxMessageFixture.createdAt,
      error: 'The Task offer timed out.'
    }]
  })
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => workerCloudResponse(request),
      pullAgentInbox: async ({ afterSequence }) => ({
        messages: [],
        nextSequence: afterSequence
      })
    }),
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))

  try {
    const status = await runtime.status()
    assert.deepEqual(status.projects.map(({ projectId }) => projectId), [projectFixture.projectId])
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('the active runtime mirrors completed assistant progress before after-turn finalization', async () => {
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture],
    projections: [localProjectionFromRemote(remoteSessionProjectionFixture, {
      runtimeId: 'codex',
      threadId: 'fixed-thread-1',
      bindingMode: 'existing'
    })]
  })
  const settings: DomainMainPackageSettingsHost = {
    read: async () => ({ revision: 0, value: null }),
    write: async () => { throw new Error('Settings writes are not expected.') },
    clear: async () => { throw new Error('Settings writes are not expected.') }
  }
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: settings,
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({}),
    stateBackend: backend
  })
  const abortController = new AbortController()
  const context = {
    agentExecution: {
      prepareSession: async () => ({ runtimeId: 'codex', threadId: 'unused-worker-thread' }),
      run: async () => { throw new Error('Transcript mirroring must not execute an Agent turn.') }
    },
    agentThreads: {
      read: async () => ({
        runtimeId: 'codex',
        threadId: 'fixed-thread-1',
        title: 'Fixed Session',
        updatedAt: '2026-08-21T00:00:00.000Z',
        watermark: '0',
        turns: [],
        artifacts: []
      }),
      subscribeMessages: async function* (input: Readonly<{ signal?: AbortSignal }>) {
        yield {
          runtimeId: 'codex',
          threadId: 'fixed-thread-1',
          turnId: 'turn-live-progress',
          sequence: 1,
          itemId: 'assistant-progress-live',
          kind: 'assistant-progress' as const,
          text: '已完成第一阶段核查。'
        }
        await waitForAbort(input.signal)
      },
      list: async () => [],
      hasActiveTurns: () => false
    },
    turnEvents: {
      subscribe: () => async () => undefined,
      subscribeRequiredBeforeTurn: () => async () => undefined,
      readDurableTurnBoundarySnapshot: async () => ({ issuerEpoch: 'test', boundaries: [] })
    },
    signal: abortController.signal
  } as unknown as DomainMainRuntimeLifecycleContext

  const dispose = await runtime.activate(context)
  try {
    await waitFor(() => {
      const state = backend.snapshot()
      return state.queue.length === 1 && state.outbox.some((entry) => (
        entry.body.type === 'projection.message.publish'
      ))
    })
    const state = backend.snapshot()
    const projectionOutbox = state.outbox.filter((entry) => (
      entry.body.type === 'projection.message.publish'
    ))
    assert.equal(state.queue[0]?.kind, 'assistant-progress')
    assert.equal(state.queue[0]?.text, '已完成第一阶段核查。')
    assert.equal(projectionOutbox.length, 1)
    assert.equal(projectionOutbox[0]?.body.kind, 'assistant_progress')
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('startup reconciles only completed remote turns without an existing final reply', async () => {
  const timestamp = '2026-08-22T11:00:00.000Z'
  const projection = {
    ...localProjectionFromRemote(remoteSessionProjectionFixture, {
      runtimeId: 'codex',
      threadId: 'fixed-thread-1',
      bindingMode: 'existing'
    }),
    nextSequence: 5
  }
  const inbound = (
    queueItemId: string,
    sequence: number,
    turnId: string,
    state: 'completed' | 'failed'
  ) => ({
    queueItemId,
    projectionId: projection.projection.projectionId,
    sequence,
    direction: 'inbound' as const,
    origin: 'human-endpoint' as const,
    kind: 'user-message' as const,
    senderUserId: projection.projection.ownerUserId,
    senderHumanEndpointId: humanEndpointBindingFixture.humanEndpointId,
    providerMessageId: `provider-${sequence}`,
    clientDirectiveId: `directive-${sequence}`,
    contentHash: String(sequence).repeat(64),
    text: `remote message ${sequence}`,
    state,
    attempts: 1,
    turnId,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    ...(state === 'failed' ? { error: 'Agent turn ended in failed.' } : {})
  })
  const completedWithFinal = inbound(
    'lqi_completedold01',
    1,
    'turn-completed-with-final',
    'completed'
  )
  const existingFinal = {
    queueItemId: 'lqi_existingfinal01',
    projectionId: projection.projection.projectionId,
    sequence: 2,
    direction: 'outbound' as const,
    origin: 'agent' as const,
    kind: 'assistant-reply' as const,
    localItemId: 'existing-final-item',
    contentHash: 'a'.repeat(64),
    text: 'already delivered final',
    state: 'completed' as const,
    attempts: 0,
    turnId: completedWithFinal.turnId,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp
  }
  const failed = inbound('lqi_failedremote01', 3, 'turn-failed', 'failed')
  const recoverable = inbound('lqi_recoverable01', 4, 'turn-recoverable', 'completed')
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture],
    projections: [projection],
    queue: [completedWithFinal, existingFinal, failed, recoverable],
    receipts: []
  })
  const settings: DomainMainPackageSettingsHost = {
    read: async () => ({ revision: 0, value: null }),
    write: async () => { throw new Error('Settings writes are not expected.') },
    clear: async () => { throw new Error('Settings writes are not expected.') }
  }
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: settings,
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({}),
    stateBackend: backend
  })
  const abortController = new AbortController()
  const context = {
    agentExecution: {
      prepareSession: async () => ({ runtimeId: 'codex', threadId: 'unused-worker-thread' }),
      run: async () => { throw new Error('Startup reconciliation must not execute an Agent turn.') }
    },
    agentThreads: {
      read: async () => ({
        runtimeId: 'codex',
        threadId: 'fixed-thread-1',
        title: 'Fixed Session',
        updatedAt: timestamp,
        watermark: '0',
        turns: [
          canonicalTurn(completedWithFinal.turnId, 'late completed output'),
          canonicalTurn(failed.turnId, 'late failed output'),
          canonicalTurn(recoverable.turnId, 'recoverable final output')
        ],
        artifacts: []
      }),
      subscribeMessages: async function* (input: Readonly<{ signal?: AbortSignal }>) {
        yield* []
        await waitForAbort(input.signal)
      },
      list: async () => [],
      hasActiveTurns: () => false
    },
    turnEvents: {
      subscribe: () => async () => undefined,
      subscribeRequiredBeforeTurn: () => async () => undefined,
      readDurableTurnBoundarySnapshot: async () => ({ issuerEpoch: 'test', boundaries: [] })
    },
    signal: abortController.signal
  } as unknown as DomainMainRuntimeLifecycleContext

  const dispose = await runtime.activate(context)
  try {
    await waitFor(() => backend.snapshot().queue.some((item) => (
      item.direction === 'outbound' && item.turnId === recoverable.turnId
    )))
    const reconciledFinals = backend.snapshot().queue.filter((item) => (
      item.direction === 'outbound' && item.kind === 'assistant-reply'
    ))
    assert.deepEqual(
      reconciledFinals.map((item) => item.turnId).sort(),
      [completedWithFinal.turnId, recoverable.turnId].sort()
    )
  } finally {
    abortController.abort()
    await dispose()
  }
})

function cachedRunningProjectState(): CollaborationLocalState {
  const runningTask = taskSchema.parse({
    ...taskFixture,
    currentExecutionId: TEST_IDS.executionId,
    currentExecutionState: 'running',
    status: 'in_progress',
    executionCount: 1,
    revision: 2,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const execution = taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    attempt: 1,
    offeredByCoordinatorAgentId: TEST_IDS.secondAgentId,
    assigneeUserId: TEST_IDS.userId,
    assigneeAgentId: TEST_IDS.agentId,
    assigneeDeviceId: TEST_IDS.deviceId,
    state: 'running',
    stateRevision: 2,
    fence: {
      schemaVersion: 1,
      executionId: TEST_IDS.executionId,
      assigneeUserId: TEST_IDS.userId,
      assigneeAgentId: TEST_IDS.agentId,
      assigneeDeviceId: TEST_IDS.deviceId,
      assignmentTaskRevision: runningTask.revision,
      projectExecutionAuthorityEpoch: projectFixture.executionAuthorityEpoch,
      userTaskAuthorityEpoch: 1,
      bindingRevision: null,
      status: 'open',
      reason: null,
      fencedAt: null
    },
    fileIntent: null,
    currentResultSubmissionId: null,
    offeredAt: TEST_TIMESTAMP,
    acceptedAt: TEST_TIMESTAMP,
    startedAt: TEST_TIMESTAMP,
    terminalAt: null,
    revision: 2,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  return {
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture],
    projects: [projectFixture],
    tasks: [runningTask],
    pendingTaskOffers: [{
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      taskOfferId: 'ofr_DeletePending001',
      workerUserId: TEST_IDS.userId,
      currentTaskRevision: runningTask.revision,
      offerRevision: 1,
      recipientAgentId: TEST_IDS.agentId,
      receivedAt: TEST_TIMESTAMP,
      preflightReasons: [],
      state: 'awaiting-manual',
      updatedAt: TEST_TIMESTAMP,
      completedAt: null,
      error: null
    }],
    taskRuns: [{
      offer: {
        projectId: TEST_IDS.projectId,
        taskId: TEST_IDS.taskId,
        executionId: TEST_IDS.executionId,
        taskOfferId: TEST_IDS.taskOfferId,
        currentTaskRevision: runningTask.revision,
        currentExecutionRevision: execution.revision,
        offerRevision: 2,
        recipientAgentId: TEST_IDS.agentId,
        receivedAt: TEST_TIMESTAMP
      },
      task: runningTask,
      execution,
      latestPreflight: null,
      decision: { decision: 'accept', decidedAt: TEST_TIMESTAMP },
      expectedTaskRevision: runningTask.revision,
      expectedExecutionRevision: execution.revision,
      state: 'running',
      workspaceRoot: '/tmp/sciforge-deleted-project-worker',
      runtimeId: 'codex',
      threadId: 'worker-deleted-project-thread',
      humanRequestId: null,
      humanAnswer: null,
      resources: [],
      agentJournal: [],
      externalJournal: [],
      outputs: [],
      recoveryJournalEntryIds: [],
      resultSummary: null,
      lateOutcomes: [],
      startedAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP,
      completedAt: null,
      error: null
    }]
  }
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: CollaborationLocalState) {}

  async read(): Promise<unknown> {
    return structuredClone(this.value)
  }

  async write(value: CollaborationLocalState): Promise<void> {
    this.value = structuredClone(value)
  }

  snapshot(): CollaborationLocalState {
    return structuredClone(this.value)
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMilliseconds = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for live transcript mirroring.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

async function waitForImmediateCondition(
  condition: () => boolean | Promise<boolean>,
  attempts = 100
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await condition()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('Timed out waiting for the expected asynchronous condition.')
}

function unusedAuthenticatedCloudTransport(): AuthenticatedCloudTransport {
  return {
    status: () => ({ state: 'unavailable', reason: 'Collaboration is not configured in this test.' }),
    execute: async () => {
      throw new Error('Authenticated Cloud transport is not expected in this test.')
    }
  }
}

function configuredSettings(): DomainMainPackageSettingsHost {
  return {
    read: async () => ({
      revision: 1,
      value: { schemaVersion: 2, baseUrl: 'https://collaboration.example.test' }
    }),
    write: async () => { throw new Error('Settings writes are not expected.') },
    clear: async () => { throw new Error('Settings writes are not expected.') }
  }
}

async function readyAuthority(agentId: string) {
  return {
    state: 'ready' as const,
    agentId,
    userId: TEST_IDS.userId,
    deviceId: TEST_IDS.deviceId,
    generation: agentNodeFixture.credentialVersion,
    runtimeId: 'codex',
    capabilityTags: ['agent-runtime.codex', 'model-access.api']
  }
}

function workerCloudResponse(request: RestRequest): RestResponse {
  if (request.type === 'agent.heartbeat') {
    return {
      protocolVersion: '1.0',
      type: 'rest.entity',
      requestId: request.requestId,
      entity: {
        ...agentNodeFixture,
        connectionStatus: request.connectionStatus,
        revision: agentNodeFixture.revision + 1
      }
    }
  }
  if (request.type === 'project.get') {
    return {
      protocolVersion: '1.0',
      type: 'rest.entity',
      requestId: request.requestId,
      entity: projectFixture
    }
  }
  if (request.type === 'task.get') {
    return {
      protocolVersion: '1.0',
      type: 'rest.entity',
      requestId: request.requestId,
      entity: taskFixture
    }
  }
  return {
    protocolVersion: '1.0',
    type: 'rest.entity',
    requestId: request.requestId,
    entity: projectFixture
  }
}

function missingProjectResponse(
  request: RestRequest,
  projectId: string = TEST_IDS.projectId
): RestResponse {
  return {
    protocolVersion: '1.0',
    type: 'rest.error',
    requestId: request.requestId,
    error: {
      protocolVersion: '1.0',
      type: 'error',
      requestId: request.requestId,
      code: 'not_found',
      category: 'validation',
      httpStatus: 404,
      retryable: false,
      message: 'Project was not found.',
      resourceType: 'project',
      resourceId: projectId
    }
  }
}

function transientProjectErrorResponse(request: RestRequest): RestResponse {
  return {
    protocolVersion: '1.0',
    type: 'rest.error',
    requestId: request.requestId,
    error: {
      protocolVersion: '1.0',
      type: 'error',
      requestId: request.requestId,
      code: 'provider_unavailable',
      category: 'provider',
      httpStatus: 503,
      retryable: true,
      message: 'Project lookup is temporarily unavailable.',
      resourceType: 'project',
      resourceId: TEST_IDS.projectId
    }
  }
}

function permissionDeniedProjectResponse(request: RestRequest): RestResponse {
  return {
    protocolVersion: '1.0',
    type: 'rest.error',
    requestId: request.requestId,
    error: {
      protocolVersion: '1.0',
      type: 'error',
      requestId: request.requestId,
      code: 'permission_denied',
      category: 'authorization',
      httpStatus: 403,
      retryable: false,
      message: 'Project membership no longer grants visibility.',
      resourceType: 'project',
      resourceId: TEST_IDS.projectId
    }
  }
}

function runtimeContext(signal: AbortSignal): DomainMainRuntimeLifecycleContext {
  return {
    agentExecution: {
      prepareSession: async () => ({ runtimeId: 'codex', threadId: 'unused-worker-thread' }),
      run: async () => { throw new Error('The manual Worker offer must not execute an Agent turn.') }
    },
    agentThreads: {
      read: async () => ({
        runtimeId: 'codex',
        threadId: 'unused-worker-thread',
        title: 'Unused Worker Session',
        updatedAt: '2026-08-21T00:00:00.000Z',
        watermark: '0',
        turns: [],
        artifacts: []
      }),
      subscribeMessages: async function* (input: Readonly<{ signal?: AbortSignal }>) {
        yield* []
        await waitForAbort(input.signal)
      },
      list: async () => [],
      hasActiveTurns: () => false
    },
    turnEvents: {
      subscribe: () => async () => undefined,
      subscribeRequiredBeforeTurn: () => async () => undefined,
      readDurableTurnBoundarySnapshot: async () => ({ issuerEpoch: 'test', boundaries: [] })
    },
    signal
  } as unknown as DomainMainRuntimeLifecycleContext
}

function canonicalTurn(turnId: string, text: string) {
  return {
    id: turnId,
    status: 'completed',
    completedAt: '2026-08-22T11:00:00.000Z',
    messages: [{
      itemId: `${turnId}-final`,
      turnId,
      kind: 'assistant-final' as const,
      text,
      occurredAt: '2026-08-22T11:00:00.000Z'
    }],
    artifacts: []
  }
}
