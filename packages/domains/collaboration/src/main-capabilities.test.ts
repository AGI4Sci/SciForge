import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createCollaborationError,
  notificationProjectionSchema,
  publicActivityEventSchema
} from '@sciforge/collaboration-contracts'
import {
  TEST_HASH,
  TEST_IDS,
  chineseProviderLocatorFixture
} from '@sciforge/collaboration-contracts/testing'
import type { DomainMainInternalServiceRegistration } from '@sciforge/domain-sdk/host'
import {
  AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION,
  AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION,
  DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID
} from '@sciforge/domain-identity-access/device-fact-attestation-signing'
import {
  AGENT_CLOUD_RUNTIME_CONTRACT_VERSION,
  AGENT_CLOUD_RUNTIME_SERVICE_ID
} from '@sciforge/domain-identity-access/agent-cloud-runtime'
import type { DomainMainRuntimeLifecycleContribution } from '@sciforge/domain-sdk/host'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import {
  COLLABORATION_CAPABILITY_IDS,
  collaborationConnectionViewSchema,
  collaborationParticipantViewSchema,
  type CollaborationProjectionView,
  type CollaborationStatusSnapshot
} from './contract.js'
import {
  createDomainMainEntry,
  createCollaborationCapabilityFactory,
  type CollaborationCapabilityOptions
} from './main.js'
import {
  COLLABORATION_COORDINATOR_CLOUD_COMMAND_CONTRIBUTION,
  COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION,
  COLLABORATION_WORKER_SESSION_PROJECTION_CONTRIBUTION
} from './definition.js'
import {
  COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
  COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
  type CoordinatorCloudCommand,
  type CoordinatorCloudCommandReplayValidator,
  type CoordinatorCloudCommandService
} from './coordinator-cloud-command.js'
import {
  WORKER_SESSION_PROJECTION_CONTRACT_VERSION,
  WORKER_SESSION_PROJECTION_SERVICE_ID,
  type WorkerSessionProjectionService
} from './worker-session-projection.js'
import { workerSessionExecutionBindingSchema } from './worker-session-projection.js'
import {
  collaborationStatePath,
  type CollaborationRuntime,
  type CollaborationRuntimeOptions
} from './main/runtime.js'
import { createTestAgentCloudRuntime } from './main/test-agent-cloud-runtime.js'

test('global collaboration mutations satisfy the production broker contract without claiming a resource change', async () => {
  const connection = collaborationConnectionViewSchema.parse({
    configured: true,
    baseUrl: 'https://collaboration.example.test',
    state: 'disconnected',
    lastInboxSequence: 0,
    pendingOutboxCount: 0
  })
  const participant = collaborationParticipantViewSchema.parse({
    userId: TEST_IDS.userId,
    displayName: 'Researcher',
    status: 'active',
    revision: 1,
    complete: false,
    endpoints: [],
    agents: []
  })
  const projection: CollaborationProjectionView = {
    projectionId: TEST_IDS.projectionId,
    ownerUserId: TEST_IDS.userId,
    agentId: TEST_IDS.agentId,
    agentOwnerUserId: TEST_IDS.userId,
    humanEndpointId: TEST_IDS.humanEndpointId,
    runtimeId: 'codex',
    threadId: 'fixed-thread',
    displayName: 'Session',
    status: 'active',
    allowUserIds: [TEST_IDS.userId],
    revision: 1,
    queueDepth: 0
  }
  const status: CollaborationStatusSnapshot = {
    revision: 1,
    connection,
    providerOptions: [],
    managedContainers: [],
    participant,
    projections: [projection],
    projects: [],
    dashboards: [],
    queue: [],
    diagnostics: []
  }
  const publicEvent = publicActivityEventSchema.parse({
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    type: 'public_activity_event',
    projectId: TEST_IDS.projectId,
    sequence: 1,
    eventId: 'evt_capabilitytest0001',
    kind: 'comment',
    taskId: TEST_IDS.taskId,
    payload: { summary: 'Public progress note.' },
    occurredAt: '2026-10-15T00:00:00.000Z'
  })
  const notification = notificationProjectionSchema.parse({
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    type: 'notification_projection',
    notificationId: 'ntf_capabilitytest0001',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    recipientUserId: TEST_IDS.userId,
    kind: 'mention',
    summary: 'Please review the public candidate.',
    actionRequired: true,
    expiresAt: null,
    readAt: '2026-10-15T00:01:00.000Z',
    sourceEventId: 'evt_capabilitytest0001'
  })
  const statusReads: unknown[] = []
  const runtime = {
    configureConnection: async () => connection,
    changeConnection: async () => connection,
    startChallenge: async () => ({
      challengeId: TEST_IDS.challengeId,
      pairingCode: `/bind SF1.${'a'.repeat(32)}.Abc_123-xYz0`,
      expiresAt: '2026-08-15T09:00:00.000Z',
      instruction: 'Send the command.'
    }),
    linkProjection: async () => projection,
    updateProjection: async () => projection,
    shareProjection: async () => projection,
    retrySynchronization: async () => undefined,
    decideTaskOffer: async () => undefined,
    returnTask: async () => undefined,
    submitWorkerDelivery: async () => ({
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      state: 'submitting',
      draft: null, history: [], confirmationTarget: null,
      candidate: null,
      operationId: 'dop_capabilitytest01',
      deliveryManifestId: null,
      error: null,
      residuals: []
    }),
    publishActivityComment: async () => ({ event: publicEvent, mentionedUserIds: [] }),
    markNotificationRead: async () => notification,
    manageContainer: async () => ({ managedContainer: null }),
    status: async (input?: unknown) => {
      statusReads.push(input)
      return status
    }
  } as unknown as CollaborationRuntime
  const definitions = createCollaborationCapabilityFactory<CollaborationCapabilityOptions>({
    defineCapability: (definition) => definition,
    getRuntime: () => runtime
  }).createDefinitions()
  const inputs: Readonly<Record<string, unknown>> = {
    [COLLABORATION_CAPABILITY_IDS.connectionConfigure]: {
      baseUrl: 'https://collaboration.example.test'
    },
    [COLLABORATION_CAPABILITY_IDS.connectionConnect]: { action: 'connect' },
    [COLLABORATION_CAPABILITY_IDS.endpointChallengeStart]: {
      providerKey: 'zulip',
      locator: {
        realmId: 'research-lab',
        providerUserId: 'zulip-user-42'
      }
    },
    [COLLABORATION_CAPABILITY_IDS.projectionLink]: {
      mode: 'existing',
      agentId: TEST_IDS.agentId,
      humanEndpointId: TEST_IDS.humanEndpointId,
      locator: chineseProviderLocatorFixture,
      runtimeId: 'codex',
      threadId: 'fixed-thread',
      displayName: 'Session'
    },
    [COLLABORATION_CAPABILITY_IDS.projectionUpdate]: {
      action: 'pause',
      projectionId: TEST_IDS.projectionId,
      expectedRevision: 1
    },
    [COLLABORATION_CAPABILITY_IDS.projectionShare]: {
      projectionId: TEST_IDS.projectionId,
      allowUserIds: [TEST_IDS.userId],
      expectedRevision: 1
    },
    [COLLABORATION_CAPABILITY_IDS.synchronizationRetry]: { scope: 'connection' },
    [COLLABORATION_CAPABILITY_IDS.taskOfferDecide]: {
      taskOfferId: TEST_IDS.taskOfferId,
      decision: 'reject'
    },
    [COLLABORATION_CAPABILITY_IDS.taskReturn]: {
      projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId, reason: '模型服务不可用'
    },
    [COLLABORATION_CAPABILITY_IDS.deliverySubmit]: { target: { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
      contractRevision: 1, resultRevision: 1, bundleDigest: TEST_HASH, decision: 'approved' } },
    [COLLABORATION_CAPABILITY_IDS.activityComment]: {
      commentId: 'cmt_0123456789abcdef0123',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      text: 'Public progress note.',
      mentionedUserIds: []
    },
    [COLLABORATION_CAPABILITY_IDS.notificationMarkRead]: {
      notificationId: notification.notificationId,
      expectedRevision: notification.revision
    },
    [COLLABORATION_CAPABILITY_IDS.managedContainerInspect]: { action: 'refresh-status' },
    [COLLABORATION_CAPABILITY_IDS.managedContainerProvision]: {
      action: 'ensure', humanEndpointId: TEST_IDS.humanEndpointId
    },
    [COLLABORATION_CAPABILITY_IDS.managedContainerArchive]: {
      action: 'archive', managedContainerId: 'mco_123456789012', expectedRevision: 1
    }
  }
  const mutations = definitions.filter((definition) => definition.effect === 'external-write')

  assert.equal(mutations.length, 13)
  const returnTask = definitions.find(({ id }) => id === COLLABORATION_CAPABILITY_IDS.taskReturn)!
  assert.equal(returnTask.approval, 'confirmation')
  assert.deepEqual(returnTask.audiences, ['ui'])
  assert.equal(definitions.some(({ id }) => id === 'collaboration.agent.register'), false)
  assert.equal(definitions.some(({ id }) => (
    id === 'collaboration.participant.primary-agent.select'
  )), false)
  assert.equal(definitions.find(({ id }) => (
    id === COLLABORATION_CAPABILITY_IDS.taskOfferDecide
  ))?.version, '1.1.0')
  assert.equal(definitions.find(({ id }) => (
    id === COLLABORATION_CAPABILITY_IDS.statusRead
  ))?.version, '3.1.0')
  assert.equal(definitions.find(({ id }) => (
    id === COLLABORATION_CAPABILITY_IDS.taskList
  ))?.version, '2.0.0')
  for (const definition of mutations) {
    assert.equal(definition.scope, 'global')
    assert.equal(Object.hasOwn(inputs, definition.id), true, `missing input fixture for ${definition.id}`)
    const result = await definition.handler(inputs[definition.id])
    assert.notEqual(result.changed, true, `${definition.id} must not claim an app resource change`)
    assert.equal(
      definition.outputSchema.safeParse(result.output).success,
      true,
      `${definition.id} must still return its valid UI result`
    )
  }
  assert.equal(definitions.find(({ id }) => (
    id === COLLABORATION_CAPABILITY_IDS.managedContainerInspect
  ))?.effect, 'read')
  assert.equal(definitions.find(({ id }) => (
    id === COLLABORATION_CAPABILITY_IDS.managedContainerArchive
  ))?.effect, 'destructive')

  const statusRead = definitions.find(({ id }) => (
    id === COLLABORATION_CAPABILITY_IDS.statusRead
  ))
  assert.ok(statusRead)
  assert.equal(statusRead.effect, 'read')
  assert.equal(statusRead.approval, 'none', 'the foreground Dashboard refresh must never ask for approval')
  const readResult = await statusRead.handler({ refreshDashboards: true })
  assert.equal(statusRead.outputSchema.safeParse(readResult.output).success, true)
  assert.deepEqual(statusReads.at(-1), { refreshDashboards: true })
})

test('private Task Session capability resolves only the current exact Worker binding', async () => {
  const binding = workerSessionExecutionBindingSchema.parse({
    schemaVersion: 1,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    runtimeId: 'codex',
    threadId: 'worker-private-thread',
    workerUserId: TEST_IDS.userId,
    assigneeAgentId: TEST_IDS.agentId,
    assigneeDeviceId: TEST_IDS.deviceId,
    taskRevision: 2,
    executionRevision: 1,
    executionState: 'accepted',
    fenceStatus: 'open',
    projectExecutionAuthorityEpoch: 1,
    userTaskAuthorityEpoch: 1,
    updatedAt: '2026-10-14T00:00:00.000Z'
  })
  const runtime = {
    listWorkerSessionBindings: async () => [binding]
  } as unknown as CollaborationRuntime
  const definitions = createCollaborationCapabilityFactory<CollaborationCapabilityOptions>({
    defineCapability: (definition) => definition,
    getRuntime: () => runtime
  }).createDefinitions()
  const definition = definitions.find(({ id }) => id === COLLABORATION_CAPABILITY_IDS.taskSessionOpen)
  assert.ok(definition)
  const opened = await definition.handler({ projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId })
  assert.deepEqual(opened.output, {
    opened: true,
    sessionId: binding.threadId,
    runtimeId: binding.runtimeId,
    threadId: binding.threadId
  })
  await assert.rejects(
    definition.handler({ projectId: TEST_IDS.projectId, taskId: 'tsk_other_task_0001' }),
    /no private Session bound/u
  )
})

test('delivery materials list is one UI read capability bound to the exact local execution', async () => {
  const calls: unknown[] = []
  const runtime = { listWorkerDeliveryMaterials: async (input: unknown) => { calls.push(input); return { files: [], nextCursor: null, truncated: false } } } as unknown as CollaborationRuntime
  const definitions = createCollaborationCapabilityFactory<CollaborationCapabilityOptions>({
    defineCapability: (definition) => definition, getRuntime: () => runtime
  }).createDefinitions()
  const list = definitions.find(({ id }) => id === COLLABORATION_CAPABILITY_IDS.workerDeliveryMaterialsList)!
  assert.equal(list.effect, 'read')
  assert.deepEqual(list.audiences, ['ui'])
  const input = { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId, query: 'data', cursor: '100' }
  assert.deepEqual((await list.handler(input)).output, { files: [], nextCursor: null, truncated: false })
  assert.deepEqual(calls, [input])
  assert.throws(() => list.inputSchema.parse({ ...input, workspaceRoot: '/arbitrary/path' }))
})

test('local Worker draft autosave is UI-only workspace state and never asks for a confirmation', async () => {
  const calls: unknown[] = []
  const runtime = { saveWorkerDeliveryDraft: async (input: unknown) => { calls.push(input); return { saved: true } } } as unknown as CollaborationRuntime
  const definitions = createCollaborationCapabilityFactory<CollaborationCapabilityOptions>({
    defineCapability: (definition) => definition, getRuntime: () => runtime
  }).createDefinitions()
  const save = definitions.find(({ id }) => id === COLLABORATION_CAPABILITY_IDS.workerDeliveryDraftSave)!
  assert.equal(save.effect, 'workspace-write')
  assert.equal(save.approval, 'none')
  assert.deepEqual(save.audiences, ['ui'])
  const input = { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
    summary: '', expectedDraftRevision: 1 }
  await save.handler(input)
  assert.deepEqual(calls, [input])
  assert.throws(() => save.inputSchema.parse({ ...input, target: {} }))
  const submit = definitions.find(({ id }) => id === COLLABORATION_CAPABILITY_IDS.deliverySubmit)!
  const target = { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
    contractRevision: 1, resultRevision: 1, bundleDigest: TEST_HASH, decision: 'approved' }
  assert.deepEqual(submit.inputSchema.parse({ target }), { target })
  assert.throws(() => submit.inputSchema.parse({ target, summary: 'An unconfirmed sibling' }))
  assert.throws(() => submit.inputSchema.parse({ ...input, summary: 'A different input shape' }))
})

test('Agent Task interaction and Delivery capabilities fail closed without a Principal, Session, or owned execution', async () => {
  let authorizationCalls = 0
  const runtime = {
    authorizeTaskInteraction: () => {
      authorizationCalls += 1
      throw new Error('execution ownership mismatch')
    },
    submitWorkerDelivery: async () => {
      throw new Error('must not reach the runtime for an Agent caller')
    },
    workerDeliveryView: () => {
      throw new Error('unused')
    },
    taskInteractionView: () => ({
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      state: 'idle',
      pending: [],
      interactions: [],
      checkpoints: []
    })
  } as unknown as CollaborationRuntime
  const definitions = createCollaborationCapabilityFactory<CollaborationCapabilityOptions>({
    defineCapability: (definition) => definition,
    getRuntime: () => runtime
  }).createDefinitions()
  const submit = definitions.find(({ id }) => id === COLLABORATION_CAPABILITY_IDS.deliverySubmit)!
  assert.ok(definitions.find(({ id }) => id === COLLABORATION_CAPABILITY_IDS.workerDeliveryRead))
  assert.ok(definitions.find(({ id }) => id === COLLABORATION_CAPABILITY_IDS.workerResidualDispose))
  assert.equal(definitions.some(({ id }) => String(id).includes('task-interaction.submit')), false)
  const input = { target: { projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
    contractRevision: 1, resultRevision: 1, bundleDigest: TEST_HASH, decision: 'approved' } }
  const assertPrincipalCurrent = () => undefined
  await assert.rejects(
    submit.handler(input, {
      caller: { audience: 'agent' },
      assertPrincipalCurrent
    }),
    /fresh human action/u
  )
  await assert.rejects(
    submit.handler(input, {
      caller: {
        audience: 'agent',
        principal: {
          authority: 'test',
          subject: TEST_IDS.userId,
          assurance: 'cloud-authenticated',
          deviceId: 'device-test',
          identityVersion: 1
        }
      },
      ordinarySession: { runtimeId: 'runtime-test', threadId: 'thread-test' },
      assertPrincipalCurrent
    }),
    /fresh human action/u
  )

  const checkpoint = definitions.find(({ id }) => id === COLLABORATION_CAPABILITY_IDS.taskCheckpointAppend)!
  await assert.rejects(
    checkpoint.handler({
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      kind: 'progress',
      source: 'human',
      summary: 'forbidden source'
    }, {
      caller: {
        audience: 'agent',
        principal: {
          authority: 'test',
          subject: TEST_IDS.userId,
          assurance: 'cloud-authenticated',
          deviceId: 'device-test',
          identityVersion: 1
        }
      },
      ordinarySession: { runtimeId: 'runtime-test', threadId: 'thread-test' },
      assertPrincipalCurrent
    }),
    /agent source/
  )
})

test('the Collaboration entry publishes one Coordinator command service backed by its active runtime', async () => {
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://collaboration.example.test',
      userId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId,
      deviceRevision: 1
    }),
    stageObject: async () => { throw new Error('Object staging is unused.') },
    readObject: async () => { throw new Error('Object reads are unused.') },
    execute: async (request) => ({
      contractVersion: 1,
      status: 503,
      body: {
        protocolVersion: '1.0',
        type: 'rest.error',
        requestId: request.payload.requestId,
        error: createCollaborationError(
          'provider_unavailable',
          'Synthetic transport response.',
          { requestId: request.payload.requestId }
        )
      }
    })
  }
  const acquisitions: Array<Readonly<{ serviceId: string; contractVersion: string }>> = []
  const agentCloudRuntime = createTestAgentCloudRuntime({})
  const packageSettings: DomainMainPackageSettingsHost = {
    read: async () => ({ revision: 0, value: null }),
    write: async (value) => ({ revision: 1, value }),
    clear: async () => ({ revision: 1, value: null })
  }
  let runtimeOptions: CollaborationRuntimeOptions | undefined
  let deactivationCount = 0
  let coordinatorCommand: unknown
  const fenceResponse = {
    protocolVersion: '1.0' as const,
    type: 'rest.error' as const,
    requestId: TEST_IDS.requestId,
    error: createCollaborationError('revision_conflict', 'Coordinator fence changed.', {
      requestId: TEST_IDS.requestId,
      expectedRevision: 1,
      currentRevision: 2
    })
  }
  let finishActivation!: () => void
  const activationGate = new Promise<void>(resolve => { finishActivation = resolve })
  const runtime = {
    activate: async () => {
      await activationGate
      return async () => { deactivationCount += 1 }
    },
    localAgentId: () => TEST_IDS.agentId,
    executeCoordinatorCloudCommand: async (command: unknown) => {
      coordinatorCommand = command
      return fenceResponse
    },
    resumeCoordinatorCloudCommand: async (
      _idempotencyKey: string,
      validateCommand: CoordinatorCloudCommandReplayValidator
    ) => {
      if (!coordinatorCommand) return null
      validateCommand(coordinatorCommand as CoordinatorCloudCommand)
      return { command: coordinatorCommand, response: fenceResponse }
    },
    listWorkerSessionBindings: () => []
  } as unknown as CollaborationRuntime
  const registrations: DomainMainInternalServiceRegistration[] = []

  const entry = createDomainMainEntry<CollaborationCapabilityOptions>({
    getUserDataDir: () => '/unused',
    defineCapability: (definition) => definition,
    humanActions: {
      capture: () => { throw new Error('No human action is expected.') },
      validate: () => { throw new Error('No human action is expected.') }
    },
    packageSettings,
    portableResources: {
      materialize: async () => { throw new Error('No artifact review is expected.') },
      discard: async () => undefined,
      export: async () => { throw new Error('No portable export is expected.') }
    },
    internalServices: {
      register: (value) => { registrations.push(value) },
      acquire: ((serviceId: string, contractVersion: string) => {
        acquisitions.push({ serviceId, contractVersion })
        const registered = registrations.find((value) => (
          value.serviceId === serviceId && value.contractVersion === contractVersion
        ))
        if (registered) return registered.service
        return serviceId === AGENT_CLOUD_RUNTIME_SERVICE_ID ? agentCloudRuntime : transport
      }) as never
    },
    createCollaborationRuntime: (options) => {
      runtimeOptions = options
      return runtime
    }
  })

  assert.equal(acquisitions.length, 2)
  const coordinatorRegistration = registrations.find(({ serviceId }) => (
    serviceId === COORDINATOR_CLOUD_COMMAND_SERVICE_ID
  ))
  assert.equal(coordinatorRegistration?.contractVersion, COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION)
  assert.deepEqual(coordinatorRegistration?.allowedConsumerModuleIds, ['sciforge.collaboration'])
  const coordinatorService = coordinatorRegistration?.service as CoordinatorCloudCommandService
  assert.equal(coordinatorService.localAgentId(), undefined)
  const workerRegistration = registrations.find(({ serviceId }) => (
    serviceId === WORKER_SESSION_PROJECTION_SERVICE_ID
  ))
  assert.equal(workerRegistration?.contractVersion, WORKER_SESSION_PROJECTION_CONTRACT_VERSION)
  assert.deepEqual(workerRegistration?.allowedConsumerModuleIds, ['sciforge.collaboration'])
  const workerService = workerRegistration?.service as WorkerSessionProjectionService
  await assert.rejects(workerService.listBindings(), /local runtime is not initialized/u)
  const command = {
    protocolVersion: '1.0' as const,
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_task.offer.withdraw-main-service-01',
    type: 'task.offer.withdraw' as const,
    taskOfferId: TEST_IDS.taskOfferId,
    taskId: TEST_IDS.taskId,
    expectedTaskRevision: 1,
    expectedOfferRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    reason: 'Coordinator changed the synthetic assignment.'
  }
  await assert.rejects(coordinatorService.execute(command), /runtime is not active/u)
  await assert.rejects(
    coordinatorService.resume(command.idempotencyKey, () => undefined),
    /runtime is not active/u
  )
  const disposeCoordinatorInbox = coordinatorService.subscribe(async () => undefined)

  const descriptorContribution = entry.contributions.find(({ id }) => (
    id === COLLABORATION_COORDINATOR_CLOUD_COMMAND_CONTRIBUTION.id
  ))
  assert.deepEqual(descriptorContribution?.value, {
    location: 'main.internal-service-descriptor',
    serviceId: COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
    contractVersion: COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
    allowedConsumerModuleIds: ['sciforge.collaboration']
  })
  const workerDescriptorContribution = entry.contributions.find(({ id }) => (
    id === COLLABORATION_WORKER_SESSION_PROJECTION_CONTRIBUTION.id
  ))
  assert.deepEqual(workerDescriptorContribution?.value, {
    location: 'main.internal-service-descriptor',
    serviceId: WORKER_SESSION_PROJECTION_SERVICE_ID,
    contractVersion: WORKER_SESSION_PROJECTION_CONTRACT_VERSION,
    allowedConsumerModuleIds: ['sciforge.collaboration']
  })

  const lifecycleContribution = entry.contributions.find(({ id }) => (
    id === COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION.id
  )) as Readonly<{
    value: DomainMainRuntimeLifecycleContribution
    onDispose?: () => void | Promise<void>
  }> | undefined
  assert.ok(lifecycleContribution)
  const userDataDir = '/profiles/meeting-owner'
  const activating = lifecycleContribution.value.activate({ userDataDir } as never)
  assert.deepEqual(await workerService.listBindings(), [], 'local journal reads do not wait for Cloud activation')
  await assert.rejects(coordinatorService.execute(command), /runtime is not active/u)
  finishActivation()
  const deactivate = await activating

  assert.deepEqual(acquisitions.slice(-3), [
    {
      serviceId: AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
      contractVersion: AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION
    },
    {
      serviceId: AGENT_CLOUD_RUNTIME_SERVICE_ID,
      contractVersion: AGENT_CLOUD_RUNTIME_CONTRACT_VERSION
    },
    {
      serviceId: DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID,
      contractVersion: DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION
    }
  ])

  assert.equal(runtimeOptions?.authenticatedCloudTransport, transport)
  assert.equal(runtimeOptions?.packageSettings, packageSettings)
  assert.equal(runtimeOptions?.agentCloudRuntime, agentCloudRuntime)
  assert.equal(runtimeOptions?.statePath, collaborationStatePath(userDataDir))
  assert.equal(typeof runtimeOptions?.coordinatorInboxHandler?.(), 'function')
  assert.equal(coordinatorService.localAgentId(), TEST_IDS.agentId)
  assert.deepEqual(await coordinatorService.execute(command), fenceResponse)
  assert.deepEqual(coordinatorCommand, command)
  assert.deepEqual(await coordinatorService.resume(command.idempotencyKey, (replayed) => {
    assert.deepEqual(replayed, command)
  }), {
    command,
    response: fenceResponse
  })
  assert.deepEqual(await workerService.listBindings(), [])
  assert.equal(typeof deactivate, 'function')
  await deactivate?.()
  assert.equal(deactivationCount, 1)
  assert.equal(coordinatorService.localAgentId(), undefined)
  const coordinatorLifecycle = entry.contributions.find(({ id }) => (
    id === 'collaboration.coordinator.runtime-lifecycle'
  )) as Readonly<{ onDispose?: () => void | Promise<void> }> | undefined
  await coordinatorLifecycle?.onDispose?.()
  disposeCoordinatorInbox()
  assert.equal(runtimeOptions?.coordinatorInboxHandler?.(), null)
  await lifecycleContribution.onDispose?.()
  assert.equal(deactivationCount, 1)
})

test('the Collaboration entry fails closed without Identity service mediation', () => {
  assert.throws(() => createDomainMainEntry({
    getUserDataDir: () => '/unused',
    defineCapability: (definition) => definition,
    packageSettings: {
      read: async () => ({ revision: 0, value: null }),
      write: async (value) => ({ revision: 1, value }),
      clear: async () => ({ revision: 1, value: null })
    }
  }), /Identity Cloud service mediation/u)
})
