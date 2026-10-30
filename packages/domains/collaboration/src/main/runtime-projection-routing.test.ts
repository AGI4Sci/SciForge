import {
  agentInboxMessageSchema,
  humanNeededSchema,
  projectRequirementsDocumentSchema,
  remoteSessionProjectionSchema,
  taskExecutionSchema,
  taskOfferSchema,
  taskSchema,
  type AgentInboxMessage,
  type RestRequest,
  type RestResponse,
  type TaskOffer
} from '@sciforge/collaboration-contracts'
import { canonicalTaskIdForRequirementsModule } from '@sciforge/collaboration-contracts/node'
import {
  agentInboxMessageFixture,
  agentNodeFixture,
  humanAnswerFixture,
  humanEndpointBindingFixture,
  participantProfileFixture,
  projectFixture,
  remoteSessionProjectionFixture,
  taskFixture,
  TEST_HASH,
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP,
  userPrincipalFixture
} from '@sciforge/collaboration-contracts/testing'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type {
  DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import assert from 'node:assert/strict'
import test from 'node:test'
import { historicalPlanFixture } from '../coordinator/cloud-test-fixtures.js'
import type {
  ProjectCoordinatorProject,
  ProjectCoordinatorWorkspace
} from '../coordinator/contract.js'
import {
  createProjectCoordinatorActionPort
} from '../coordinator/ports.js'
import { createProjectCoordinatorRequirementsDispatchPort } from '../coordinator/requirements-dispatch.js'
import { ProjectCoordinatorStateStore } from '../coordinator/state.js'
import { localProjectionFromRemote } from './projection-coordinator.js'
import {
  activeProjectionBindingsForSession,
  CollaborationRuntime,
  isCoordinatorProjectInboxPayload,
  isWorkerTaskInboxPayload,
  type CollaborationRuntimeOptions
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

test('runtime routes Worker delivery and offer-closure fanout only to its exact audience owner', () => {
  assert.equal(isWorkerTaskInboxPayload({
    type: 'task.delivery.revision_requested'
  } as AgentInboxMessage['payload']), true)
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
    type: 'project.membership.changed'
  } as AgentInboxMessage['payload']), true)
  assert.equal(isCoordinatorProjectInboxPayload({
    type: 'task.delivery.sealed'
  } as AgentInboxMessage['payload']), true)
  assert.equal(isCoordinatorProjectInboxPayload({
    type: 'project.result.published'
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

test('runtime routes requirements confirmation through the Coordinator Inbox owner', async () => {
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_RequirementsRoute01',
    recipientAgentId: TEST_IDS.agentId,
    payload: {
      protocolVersion: '1.0',
      type: 'project.requirements.confirmed',
      projectId: TEST_IDS.projectId,
      requirementsDocumentId: 'rqd_RequirementsRoute0001',
      documentRevision: 1,
      contentDigest: TEST_HASH
    }
  })
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture]
  })
  const handled: string[] = []
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => workerCloudResponse(request),
      pullAgentInbox: async ({ afterSequence }) => ({
        messages: afterSequence < message.sequence ? [message] : [],
        nextSequence: message.sequence
      })
    }),
    coordinatorInboxHandler: () => async (received) => {
      handled.push(received.payload.type)
    },
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))
  try {
    await waitForImmediateCondition(() => handled.length === 1)
    assert.deepEqual(handled, ['project.requirements.confirmed'])
    assert.equal(backend.snapshot().lastInboxSequence, message.sequence)
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('startup defers a Coordinator message until the Coordinator owner subscribes', async () => {
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_CoordinatorStartupDeferred01',
    recipientAgentId: TEST_IDS.agentId,
    payload: {
      protocolVersion: '1.0',
      type: 'project.started',
      projectId: TEST_IDS.projectId,
      revision: projectFixture.revision
    }
  })
  // A later message in the same page must not be ACKed past the deferred one.
  const later = agentInboxMessageSchema.parse({
    ...message,
    inboxMessageId: 'ibx_CoordinatorStartupDeferred02',
    sequence: message.sequence + 1
  })
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture]
  })
  let owner: ((received: AgentInboxMessage) => Promise<void>) | null = null
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => workerCloudResponse(request),
      pullAgentInbox: async ({ afterSequence }) => ({
        messages: [message, later].filter(({ sequence }) => sequence > afterSequence),
        nextSequence: later.sequence
      })
    }),
    coordinatorInboxHandler: () => owner,
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))
  const deferredDiagnostic = () => backend.snapshot().diagnostics.some(
    ({ code }) => code === 'collaboration.inbox_deferred'
  )
  try {
    await waitForImmediateCondition(deferredDiagnostic)
    assert.equal(backend.snapshot().lastInboxSequence, 0)
    assert.equal((await runtime.status()).connection.state, 'connected')
    const handled: string[] = []
    owner = async (received) => { handled.push(received.inboxMessageId) }
    runtime.resumeInbox()
    await waitForImmediateCondition(() => handled.length === 2)
    assert.deepEqual(handled, [message.inboxMessageId, later.inboxMessageId])
    await waitForImmediateCondition(() => backend.snapshot().lastInboxSequence === later.sequence)
    assert.equal(deferredDiagnostic(), false)
    assert.equal((await runtime.status()).connection.state, 'connected')
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('runtime routes membership changes to the Coordinator dispatch wakeup', async () => {
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_MembershipRoute01',
    recipientAgentId: TEST_IDS.agentId,
    payload: {
      protocolVersion: '1.0',
      type: 'project.membership.changed',
      projectId: TEST_IDS.projectId,
      projectMembershipId: TEST_IDS.projectMembershipId,
      userId: TEST_IDS.secondUserId,
      state: 'active',
      revision: 2,
      authorityEpoch: 2
    }
  })
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture]
  })
  const dispatchProjects: string[] = []
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => workerCloudResponse(request),
      pullAgentInbox: async ({ afterSequence }) => ({
        messages: afterSequence < message.sequence ? [message] : [],
        nextSequence: message.sequence
      })
    }),
    coordinatorInboxHandler: () => async (received) => {
      if (received.payload.type === 'project.membership.changed') {
        dispatchProjects.push(received.payload.projectId)
      }
    },
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))
  try {
    await waitForImmediateCondition(() => dispatchProjects.length === 1)
    assert.deepEqual(dispatchProjects, [TEST_IDS.projectId])
    assert.equal(backend.snapshot().lastInboxSequence, message.sequence)
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('runtime mounts and disposes the required Worker Session admission and output observers', async () => {
  const fixture = createOfferClosureRuntimeFixture({ outcome: 'rejected' })
  const controller = new AbortController()
  const context = runtimeContext(controller.signal)
  const admissions: Parameters<NonNullable<NonNullable<typeof context.turnEvents>['subscribeRequiredAdmission']>>[0][] = []
  const outputs: Parameters<NonNullable<NonNullable<typeof context.turnEvents>['subscribeRequiredOutput']>>[0][] = []
  let disposed = 0
  const dispose = await fixture.runtime.activate({ ...context, turnEvents: { ...context.turnEvents!,
    subscribeRequiredAdmission: (listener) => { admissions.push(listener); return () => { disposed += 1 } },
    subscribeRequiredOutput: (listener) => { outputs.push(listener); return () => { disposed += 1 } }
  } })
  try {
    assert.equal(admissions.length, 1)
    assert.equal(outputs.length, 1)
    await admissions[0]!({ runtimeId: 'codex', threadId: 'unbound-session', kind: 'direct', revision: 0 })
    await outputs[0]!({ runtimeId: 'codex', threadId: 'unbound-session', turnId: 'unbound-turn', revision: 1, state: 'completed' })
  } finally {
    controller.abort()
    await dispose()
  }
  assert.equal(disposed, 2)
})

test('runtime routes rejected, timed-out, and withdrawn Coordinator offers into requirements re-dispatch', async () => {
  for (const outcome of ['rejected', 'timed_out', 'withdrawn'] as const) {
    const fixture = createOfferClosureRuntimeFixture({ outcome })
    const abortController = new AbortController()
    const dispose = await fixture.runtime.activate(runtimeContext(abortController.signal))
    try {
      await waitForImmediateCondition(() => {
        if (fixture.handlerError) throw fixture.handlerError
        return fixture.handlerCalls === 1
      })
      assert.equal(fixture.reassignedWorkers.length, 1)
      await waitForImmediateCondition(() => fixture.backend.snapshot().lastInboxSequence === 1)
      assert.deepEqual(fixture.reassignedWorkers, [TEST_IDS.secondUserId])
      assert.equal(fixture.state.offers.at(-1)?.state, 'pending')
      assert.equal(
        fixture.state.offers.at(-1)?.workerUserId,
        TEST_IDS.secondUserId
      )
    } finally {
      abortController.abort()
      await dispose()
    }
  }
})

test('runtime offer-closure dispatch excludes the failed Worker, raises one Owner todo without an alternate, and is idempotent', async () => {
  const fixture = createOfferClosureRuntimeFixture({
    outcome: 'rejected',
    includeAlternateWorker: false,
    duplicateMessage: true
  })
  const abortController = new AbortController()
  const dispose = await fixture.runtime.activate(runtimeContext(abortController.signal))
  try {
    await waitForImmediateCondition(() => {
      if (fixture.handlerError) throw fixture.handlerError
      return fixture.handlerCalls === 2
    })
    assert.equal(fixture.backend.snapshot().lastInboxSequence, 2)
    assert.deepEqual(fixture.reassignedWorkers, [])
    assert.equal(fixture.ownerTodoCount, 1)
    assert.equal(fixture.state.pendingHumanNeeded.length, 1)
  } finally {
    abortController.abort()
    await dispose()
  }
})

test('Plan-era offer closures remain a requirements-dispatch no-op through runtime routing', async () => {
  const fixture = createOfferClosureRuntimeFixture({ outcome: 'rejected', planEra: true })
  const abortController = new AbortController()
  const dispose = await fixture.runtime.activate(runtimeContext(abortController.signal))
  try {
    await waitForImmediateCondition(() => {
      if (fixture.handlerError) throw fixture.handlerError
      return fixture.handlerCalls === 1
    })
    assert.equal(fixture.backend.snapshot().lastInboxSequence, 1)
    assert.deepEqual(fixture.reassignedWorkers, [])
    assert.equal(fixture.ownerTodoCount, 0)
  } finally {
    abortController.abort()
    await dispose()
  }
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
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
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
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
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
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
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
    assert.deepEqual((await runtime.listWorkerSessionBindings()).map(({ runtimeId, threadId }) => ({ runtimeId, threadId })), [{
      runtimeId: backend.snapshot().taskRuns[0]!.runtimeId,
      threadId: backend.snapshot().taskRuns[0]!.threadId
    }], 'durable Session ownership remains even when the Project is unavailable')
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
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
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
    assert.deepEqual((await runtime.listWorkerSessionBindings()).map(({ runtimeId, threadId }) => ({ runtimeId, threadId })), [{
      runtimeId: backend.snapshot().taskRuns[0]!.runtimeId,
      threadId: backend.snapshot().taskRuns[0]!.threadId
    }], 'durable Session ownership remains even when the Project is unavailable')
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
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
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
    assert.deepEqual((await runtime.listWorkerSessionBindings()).map(({ runtimeId, threadId }) => ({ runtimeId, threadId })), [{
      runtimeId: backend.snapshot().taskRuns[0]!.runtimeId,
      threadId: backend.snapshot().taskRuns[0]!.threadId
    }], 'durable Session ownership remains even when the Project is unavailable')
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
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
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
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
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
  let readySweepCount = 0
  let inboxPullCount = 0
  let inboxSubscriptionCount = 0
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
    onConnectionReady: async () => { readySweepCount += 1 },
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
    assert.equal(readySweepCount, 1)
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
    assert.equal(readySweepCount >= 2, true)
    const readySweepCountAfterReconnect = readySweepCount
    assert.equal(projectReadCount, 2, 'the permanent fence prevents repeated Project reads')

    context.mock.timers.tick(15_000)
    await waitForImmediateCondition(() => heartbeatCount >= 4)
    assert.equal(projectReadCount, 2, 'an ordinary connected heartbeat does not rescan Projects')
    assert.equal(readySweepCount, readySweepCountAfterReconnect,
      'an ordinary connected heartbeat does not repeat the ready sweep')
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
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
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
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
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
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
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
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
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

function createOfferClosureRuntimeFixture(input: Readonly<{
  outcome: 'rejected' | 'timed_out' | 'withdrawn'
  includeAlternateWorker?: boolean
  duplicateMessage?: boolean
  planEra?: boolean
}>) {
  const planItemId = 'item_runtime_closed'
  const taskId = canonicalTaskIdForRequirementsModule('rqd_RuntimeClosureRequirements01', planItemId)
  const task = taskSchema.parse({
    ...taskFixture,
    taskId,
    projectId: TEST_IDS.projectId,
    status: 'revision_requested',
    revision: 2,
    requiredCapabilityTags: [],
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const offer = taskOfferSchema.parse({
    schemaVersion: 1,
    type: 'task_offer',
    taskOfferId: 'ofr_RuntimeClosureOffer0001',
    projectId: TEST_IDS.projectId,
    taskId,
    executionId: null,
    workerUserId: TEST_IDS.userId,
    offeredByCoordinatorAgentId: projectFixture.coordinatorAgentId,
    state: input.outcome,
    reassignmentTaskRevision: task.revision,
    offeredAt: TEST_TIMESTAMP,
    expiresAt: TEST_LATER_TIMESTAMP,
    respondedAt: TEST_LATER_TIMESTAMP,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
  const confirmedRequirements = projectRequirementsDocumentSchema.parse({
    schemaVersion: 1,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP,
    type: 'project_requirements_document',
    requirementsDocumentId: 'rqd_RuntimeClosureRequirements01',
    projectId: TEST_IDS.projectId,
    documentRevision: 1,
    state: 'confirmed',
    goalsDeliverables: 'Dispatch the module.',
    inputsBoundaries: 'Use the exact confirmed input.',
    inputReferences: [],
    workModules: [{
      planItemId,
      title: 'Runtime closure module',
      objective: 'Complete the module after an offer closes.',
      dependencyPlanItemIds: [],
      requiredCapabilityTags: []
    }],
    acceptanceCriteria: [{
      target: planItemId,
      criteria: 'The module is complete.',
      evidenceMethod: 'Owner review'
    }, {
      target: '$project',
      criteria: 'The project result is complete.',
      evidenceMethod: 'Owner review'
    }],
    contentDigest: TEST_HASH,
    confirmedByUserId: projectFixture.ownerUserId,
    confirmedAt: TEST_LATER_TIMESTAMP,
    supersededAt: null
  })
  const state: {
    project: typeof projectFixture
    task: typeof task
    offers: TaskOffer[]
    pendingHumanNeeded: ProjectCoordinatorProject['pendingHumanNeeded']
  } = {
    project: projectFixture,
    task,
    offers: [offer],
    pendingHumanNeeded: []
  }
  const workerGroups = [
    runtimeWorkerGroup(TEST_IDS.userId),
    ...(input.includeAlternateWorker === false ? [] : [runtimeWorkerGroup(TEST_IDS.secondUserId)])
  ]
  const workspace = (): ProjectCoordinatorWorkspace => ({
    connection: {
      state: 'ready',
      userId: projectFixture.ownerUserId,
      deviceId: TEST_IDS.deviceId
    },
    observedAt: TEST_LATER_TIMESTAMP,
    availableWorkerUsers: [],
    projects: [{
      project: state.project,
      coordinatorTransferFeedback: null,
      plan: null,
      requirementsDraft: null,
      requirementsDraftSummary: null,
      confirmedRequirements: input.planEra ? null : confirmedRequirements,
      memberUsers: [],
      workerGroups,
      tasks: [{ task: state.task, delivery: null, executions: [] }],
      offers: state.offers,
      deliveryDrive: null,
      pendingHumanNeeded: state.pendingHumanNeeded,
      records: [],
      finalSummary: null,
      memberships: [],
      legacyHistory: { readOnly: true, plans: [], tasks: [], executions: [] }
    } as unknown as ProjectCoordinatorProject]
  })
  const reassignedWorkers: string[] = []
  let ownerTodoCount = 0
  const coordinatorCloudCommands = {
    localAgentId: () => projectFixture.coordinatorAgentId,
    executeUser: async () => { throw new Error('Unexpected User command.') },
    resumeUser: async () => null,
    resume: async () => null,
    subscribe: () => () => undefined,
    execute: async (command: import('../coordinator-cloud-command.js').CoordinatorCloudCommand): Promise<RestResponse> => {
      if (command.type === 'task.offer.reassign') {
        reassignedWorkers.push(command.workerUserId)
        state.task = taskSchema.parse({
          ...state.task,
          status: 'offered',
          revision: state.task.revision + 1,
          updatedAt: TEST_LATER_TIMESTAMP
        })
        const reassigned = taskOfferSchema.parse({
          ...offer,
          taskOfferId: 'ofr_RuntimeClosureOffer0002',
          workerUserId: command.workerUserId,
          state: 'pending',
          reassignmentTaskRevision: null,
          respondedAt: null,
          offeredAt: TEST_LATER_TIMESTAMP,
          expiresAt: command.offerExpiresAt,
          revision: 1,
          updatedAt: TEST_LATER_TIMESTAMP
        })
        state.offers.push(reassigned)
        return {
          protocolVersion: '1.0',
          type: 'rest.collection',
          requestId: command.requestId,
          items: [state.task, reassigned]
        }
      }
      if (command.type === 'human.needed.create') {
        if (command.context.scope !== 'coordinator_project') {
          throw new Error('Unexpected Worker HumanNeeded command.')
        }
        ownerTodoCount += 1
        const request = humanNeededSchema.parse({
          schemaVersion: 1,
          type: 'human_needed',
          humanRequestId: 'hrq_RuntimeClosureTodo0001',
          projectId: TEST_IDS.projectId,
          context: {
            scope: 'coordinator_project',
            coordinatorAuthorityEpoch: projectFixture.coordinatorAuthorityEpoch,
            requirementsDocumentId: command.context.requirementsDocumentId,
            planItemId: command.context.planItemId,
            dedupReason: command.context.dedupReason
          },
          targetUserId: command.targetUserId,
          requestedByAgentId: projectFixture.coordinatorAgentId,
          requiredAssurance: command.requiredAssurance,
          prompt: command.prompt,
          confirmableAction: null,
          status: 'pending',
          expiresAt: command.expiresAt,
          revision: 1,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_LATER_TIMESTAMP
        })
        state.pendingHumanNeeded.push(request)
        return {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: command.requestId,
          entity: request
        }
      }
      throw new Error(`Unexpected Coordinator command ${command.type}.`)
    }
  }
  const transport = unusedAuthenticatedCloudTransport()
  const requirementsDispatch = createProjectCoordinatorRequirementsDispatchPort({
    workspace: { readWorkspace: async () => workspace() },
    coordinatorCloudCommands,
    transport
  })
  const actionPort = createProjectCoordinatorActionPort({
    workspace: { readWorkspace: async () => workspace() },
    coordinatorCloudCommands,
    transport,
    state: emptyCoordinatorState(),
    requirementsDispatch
  })
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_RuntimeClosureOffer0001',
    sequence: 1,
    recipientAgentId: projectFixture.coordinatorAgentId,
    payload: {
      protocolVersion: '1.0',
      type: 'task.offer.closed',
      projectId: TEST_IDS.projectId,
      taskId,
      taskOfferId: offer.taskOfferId,
      audience: 'coordinator',
      outcome: input.outcome,
      taskRevision: task.revision,
      offerRevision: offer.revision
    }
  })
  const duplicate = agentInboxMessageSchema.parse({
    ...message,
    inboxMessageId: 'ibx_RuntimeClosureOffer0002',
    sequence: 2
  })
  const messages = input.duplicateMessage ? [message, duplicate] : [message]
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    agents: [agentNodeFixture]
  })
  let handlerError: unknown = null
  let handlerCalls = 0
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => workerCloudResponse(request),
      pullAgentInbox: async ({ afterSequence }) => {
        const pending = messages.filter(({ sequence }) => sequence > afterSequence)
        return {
          messages: pending,
          nextSequence: pending.at(-1)?.sequence ?? afterSequence
        }
      }
    }),
    coordinatorInboxHandler: () => async (received) => {
      try {
        handlerCalls += 1
        await actionPort.handleInbox(received)
      } catch (error) {
        handlerError = error
        throw error
      }
    },
    stateBackend: backend
  })
  return {
    runtime,
    backend,
    state,
    reassignedWorkers,
    get ownerTodoCount() { return ownerTodoCount },
    get handlerCalls() { return handlerCalls },
    get handlerError() { return handlerError }
  }
}

function runtimeWorkerGroup(userId: string) {
  return {
    userId,
    displayName: `Worker ${userId}`,
    agents: [{
      displayName: `Agent ${userId}`,
      projectAvailability: {
        membership: { state: 'active' },
        availability: {
          connectionStatus: 'online',
          acceptsNewOffers: true,
          runtimeCapabilityTags: [],
          activeTaskCount: 0
        }
      }
    }]
  }
}

function emptyCoordinatorState(): ProjectCoordinatorStateStore {
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
  return new ProjectCoordinatorStateStore({
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
  })
}

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
      frozenCandidate: null,
      deliveryDraft: null,
      deliveryHistory: [],
      deliverySaga: null,
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
    },
    stageObject: async () => {
      throw new Error('Object staging is not expected in this test.')
    },
    readObject: async () => {
      throw new Error('Object reads are not expected in this test.')
    }
  }
}

function unusedHumanActions(): CollaborationRuntimeOptions['humanActions'] {
  return {
    capture: () => {
      throw new Error('Human actions are not expected in this test.')
    },
    validate: () => {
      throw new Error('Human actions are not expected in this test.')
    }
  }
}

function unusedSigning(): CollaborationRuntimeOptions['signing'] {
  return {
    signDeviceFact: async () => {
      throw new Error('Device fact signing is not expected in this test.')
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


test('Worker ownership loads from the local journal before network activation and retains fenced history', async () => {
  const state = cachedRunningProjectState()
  state.projects = []
  const backend = new MemoryBackend(state)
  const runtime = new CollaborationRuntime({
    statePath: 'unused', packageSettings: configuredSettings(),
    authenticatedCloudTransport: unusedAuthenticatedCloudTransport(),
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
    agentCloudRuntime: createTestAgentCloudRuntime({}), stateBackend: backend
  })
  const [first, concurrent] = await Promise.all([
    runtime.listWorkerSessionBindings(), runtime.listWorkerSessionBindings()
  ])
  assert.equal(first.length, 1)
  assert.equal(first[0]?.threadId, state.taskRuns[0]?.threadId)
  assert.deepEqual(first, concurrent)
})

for (const legacy of [false, true]) {
  for (const valid of [false, true]) {
    test(`retained Plan notifications advance the durable Inbox into the next message without dispatch (legacy=${legacy}, valid=${valid})`, async () => {
      const retained = historicalPlanFixture(projectFixture, { legacy, superseded: true })
      const first = agentInboxMessageSchema.parse({ ...agentInboxMessageFixture,
        inboxMessageId: 'ibx_HistoricalPlanAck01', recipientAgentId: projectFixture.coordinatorAgentId,
        payload: { protocolVersion: '1.0', type: 'project.plan.confirmed', projectId: TEST_IDS.projectId,
          projectPlanId: retained.projectPlanId, planDigest: valid ? retained.planDigest : 'b'.repeat(64), revision: 2 }
      })
      const second = agentInboxMessageSchema.parse({ ...first, sequence: first.sequence + 1,
        inboxMessageId: 'ibx_HistoricalPlanAck02', payload: { protocolVersion: '1.0',
          type: 'project.started', projectId: TEST_IDS.projectId, revision: projectFixture.revision }
      })
      const backend = new MemoryBackend({ ...EMPTY_COLLABORATION_LOCAL_STATE, revision: 1, agents: [agentNodeFixture] })
      const commandTypes: string[] = []
      const handled: string[] = []
      let handlerError: unknown = null
      const workspace: ProjectCoordinatorWorkspace = { connection: { state: 'ready',
        userId: projectFixture.ownerUserId, deviceId: TEST_IDS.deviceId }, observedAt: TEST_TIMESTAMP,
        availableWorkerUsers: [], projects: [{ project: projectFixture,
          coordinatorTransferFeedback: null, plan: null, requirementsDraft: null, confirmedRequirements: null,
          memberUsers: [], workerGroups: [], tasks: [], offers: [], pendingHumanNeeded: [], records: [],
          finalSummary: null, memberships: [], deliveryDrive: null,
          legacyHistory: { readOnly: true, plans: [retained], tasks: [], executions: [] } }]
      }
      const actionPort = createProjectCoordinatorActionPort({
        workspace: { readWorkspace: async () => workspace },
        coordinatorCloudCommands: { executeUser: async () => { throw new Error('Unexpected User write.') },
          resumeUser: async () => null, resume: async () => null, subscribe: () => () => undefined,
          execute: async () => { throw new Error('Unexpected Coordinator write.') } },
        transport: unusedAuthenticatedCloudTransport(), state: emptyCoordinatorState(),
        requirementsDispatch: { reconcileProject: async () => { throw new Error('Historical facts cannot dispatch.') } }
      })
      const runtime = new CollaborationRuntime({ statePath: 'unused', packageSettings: configuredSettings(),
        authenticatedCloudTransport: unusedAuthenticatedCloudTransport(), humanActions: unusedHumanActions(), signing: unusedSigning(),
        agentCloudRuntime: createTestAgentCloudRuntime({ authorityStatus: readyAuthority,
          execute: async (_agentId, request) => { commandTypes.push(request.type); return workerCloudResponse(request) },
          pullAgentInbox: async ({ afterSequence }) => ({
            messages: [first, second].filter(({ sequence }) => sequence > afterSequence), nextSequence: second.sequence
          }) }),
        coordinatorInboxHandler: () => async (received) => {
          try { await actionPort.handleInbox(received); handled.push(received.payload.type) }
          catch (error) { handlerError = error; throw error }
        },
        stateBackend: backend
      })
      const abort = new AbortController()
      const dispose = await runtime.activate(runtimeContext(abort.signal))
      try {
        if (valid) {
          await waitForImmediateCondition(() => backend.snapshot().lastInboxSequence === second.sequence)
          assert.deepEqual(handled, ['project.plan.confirmed', 'project.started'])
          const acks = backend.snapshot().outbox.filter(({ body }) => body.type === 'inbox.ack')
          assert.deepEqual(acks.map(({ body }) => body.sequence), [first.sequence, second.sequence])
        } else {
          await waitForImmediateCondition(() => handlerError !== null)
          assert.match(String(handlerError), /Plan confirmation notification does not match retained Cloud facts/u)
          assert.equal(backend.snapshot().lastInboxSequence, 0)
          assert.deepEqual(handled, [])
          assert.equal(backend.snapshot().outbox.some(({ body }) => body.type === 'inbox.ack'), false)
        }
        assert.equal(commandTypes.some((type) => ['task.offer.create', 'project.transition'].includes(type)), false)
      } finally {
        abort.abort()
        await dispose()
      }
    })
  }
}

test('a Cloud sign-in after startup binds the current Agent for Offer intake and outbound commands without a restart', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  // An installation re-enrolled on a new Device keeps its superseded Agent in
  // the participant snapshot, so the identity cannot be inferred offline.
  const supersededAgent = { ...agentNodeFixture, agentId: TEST_IDS.secondAgentId, deviceId: 'dev_Device000002',
    connectionStatus: 'offline' as const }
  const backend = new MemoryBackend({
    ...EMPTY_COLLABORATION_LOCAL_STATE,
    revision: 1,
    user: userPrincipalFixture,
    agents: [supersededAgent, agentNodeFixture]
  })
  const message = agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    payload: {
      protocolVersion: '1.0', type: 'task.offered', projectId: projectFixture.projectId, taskId: taskFixture.taskId,
      taskOfferId: TEST_IDS.taskOfferId, workerUserId: TEST_IDS.userId,
      currentTaskRevision: taskFixture.revision, offerRevision: 1
    }
  })
  const baseUrl = 'https://collaboration.example.test'
  let identity: ReturnType<AuthenticatedCloudTransport['status']> = { state: 'identity_required', baseUrl }
  const userResponse = (request: RestRequest): RestResponse => {
    if (request.type === 'endpoint.catalog.get') {
      return { protocolVersion: '1.0', type: 'endpoint.catalog', requestId: request.requestId, providers: [] }
    }
    if (request.type === 'participant.get') {
      return { protocolVersion: '1.0', type: 'participant.snapshot', requestId: request.requestId, user: userPrincipalFixture,
        participant: participantProfileFixture, humanEndpoints: [], agents: [supersededAgent, agentNodeFixture] }
    }
    if (request.type === 'project.list') {
      return { protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId, limit: 250, projects: [],
        observedAt: TEST_LATER_TIMESTAMP }
    }
    throw new Error(`Unexpected User command ${request.type}.`)
  }
  const runtime = new CollaborationRuntime({
    statePath: 'unused',
    packageSettings: configuredSettings(),
    authenticatedCloudTransport: {
      ...unusedAuthenticatedCloudTransport(),
      status: () => identity,
      execute: async ({ payload }) => ({ contractVersion: 1, status: 200, body: userResponse(payload as RestRequest) })
    },
    humanActions: unusedHumanActions(),
    signing: unusedSigning(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      ensureAgent: async () => agentNodeFixture,
      execute: async (agentId, request) => {
        assert.equal(agentId, agentNodeFixture.agentId, 'only the current Agent authority sends commands')
        return workerCloudResponse(request)
      },
      pullAgentInbox: async ({ agentId, afterSequence }) => {
        assert.equal(agentId, agentNodeFixture.agentId)
        return { messages: afterSequence < message.sequence ? [message] : [], nextSequence: message.sequence }
      }
    }),
    stateBackend: backend
  })
  const abortController = new AbortController()
  const dispose = await runtime.activate(runtimeContext(abortController.signal))
  try {
    assert.equal((await runtime.status()).connection.state, 'disconnected')
    identity = { state: 'ready', baseUrl, userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId, deviceRevision: 1 }
    // Automatic authority recovery, not an explicit reconnect, joins the Cloud.
    context.mock.timers.tick(1_000)
    await waitForImmediateCondition(() => (
      backend.snapshot().lastInboxSequence === message.sequence || backend.snapshot().diagnostics.length > 0
    ), 1_000)
    const state = backend.snapshot()
    assert.deepEqual(state.diagnostics.map(({ message: text }) => text), [])
    assert.equal(state.lastInboxSequence, message.sequence)
    assert.equal(runtime.localAgentId(), agentNodeFixture.agentId)
    assert.deepEqual(state.pendingTaskOffers.map(({ taskOfferId }) => taskOfferId), [TEST_IDS.taskOfferId])
    await waitForImmediateCondition(() => ['inbox.ack', 'worker.availability'].every((kind) => (
      backend.snapshot().outbox.some((entry) => entry.kind === kind && entry.state === 'delivered')
    )), 1_000)
    assert.equal(backend.snapshot().outboxWait, null)
  } finally {
    abortController.abort()
    await dispose()
  }
})
