import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCollaborationError } from '@sciforge/collaboration-contracts'
import {
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
  COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION
} from './definition.js'
import {
  COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
  COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
  type CoordinatorCloudCommandService
} from './coordinator-cloud-command.js'
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
    queue: [],
    diagnostics: []
  }
  const runtime = {
    configureConnection: async () => connection,
    changeConnection: async () => connection,
    startChallenge: async () => ({
      challengeId: TEST_IDS.challengeId,
      pairingCode: `/bind SF1.${'a'.repeat(32)}.Abc_123-xYz0`,
      expiresAt: '2026-08-15T09:00:00.000Z',
      instruction: 'Send the command.'
    }),
    registerAgent: async () => ({
      agentId: TEST_IDS.agentId,
      ownerUserId: TEST_IDS.userId,
      displayName: 'Desktop',
      nodeType: 'desktop',
      status: 'offline',
      capabilities: [],
      primary: false
    }),
    selectPrimaryAgent: async () => participant,
    linkProjection: async () => projection,
    updateProjection: async () => projection,
    shareProjection: async () => projection,
    retrySynchronization: async () => undefined,
    updateWorkerAcceptancePolicy: async () => ({
      agentId: TEST_IDS.agentId,
      mode: 'automatic' as const
    }),
    decideTaskOffer: async () => undefined,
    manageContainer: async () => ({ managedContainer: null }),
    status: async () => status
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
    [COLLABORATION_CAPABILITY_IDS.agentRegister]: {
      displayName: 'Desktop',
      nodeType: 'desktop',
      capabilities: []
    },
    [COLLABORATION_CAPABILITY_IDS.primaryAgentSelect]: {
      agentId: TEST_IDS.agentId,
      expectedParticipantRevision: 1
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
    [COLLABORATION_CAPABILITY_IDS.workerAcceptanceUpdate]: {
      agentId: TEST_IDS.agentId,
      mode: 'automatic'
    },
    [COLLABORATION_CAPABILITY_IDS.taskOfferDecide]: {
      executionId: TEST_IDS.executionId,
      decision: 'reject',
      reason: 'human_rejected'
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

  assert.equal(mutations.length, 12)
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
})

test('the Collaboration entry publishes one Coordinator command service backed by its active runtime', async () => {
  const transport: AuthenticatedCloudTransport = {
    status: () => ({
      state: 'ready',
      baseUrl: 'https://collaboration.example.test',
      userId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId
    }),
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
  const runtime = {
    activate: async () => async () => { deactivationCount += 1 },
    executeCoordinatorCloudCommand: async (command: unknown) => {
      coordinatorCommand = command
      return fenceResponse
    }
  } as unknown as CollaborationRuntime
  let registration: DomainMainInternalServiceRegistration | undefined

  const entry = createDomainMainEntry<CollaborationCapabilityOptions>({
    getUserDataDir: () => '/unused',
    defineCapability: (definition) => definition,
    packageSettings,
    internalServices: {
      register: (value) => { registration = value },
      acquire: ((serviceId: string, contractVersion: string) => {
        acquisitions.push({ serviceId, contractVersion })
        return serviceId === AGENT_CLOUD_RUNTIME_SERVICE_ID ? agentCloudRuntime : transport
      }) as never
    },
    createCollaborationRuntime: (options) => {
      runtimeOptions = options
      return runtime
    }
  })

  assert.deepEqual(acquisitions, [])
  assert.equal(registration?.serviceId, COORDINATOR_CLOUD_COMMAND_SERVICE_ID)
  assert.equal(registration?.contractVersion, COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION)
  assert.deepEqual(registration?.allowedConsumerModuleIds, ['sciforge.project-coordinator'])
  const coordinatorService = registration?.service as CoordinatorCloudCommandService
  const command = {
    protocolVersion: '1.0' as const,
    requestId: TEST_IDS.requestId,
    idempotencyKey: 'idem_task.offer.withdraw-main-service-01',
    type: 'task.offer.withdraw' as const,
    taskOfferId: TEST_IDS.taskOfferId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    expectedTaskRevision: 1,
    expectedExecutionRevision: 1,
    expectedOfferRevision: 1,
    expectedCoordinatorAuthorityEpoch: 1,
    reason: 'Coordinator changed the synthetic assignment.'
  }
  await assert.rejects(coordinatorService.execute(command), /runtime is not active/u)

  const descriptorContribution = entry.contributions.find(({ id }) => (
    id === COLLABORATION_COORDINATOR_CLOUD_COMMAND_CONTRIBUTION.id
  ))
  assert.deepEqual(descriptorContribution?.value, {
    location: 'main.internal-service-descriptor',
    serviceId: COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
    contractVersion: COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
    allowedConsumerModuleIds: ['sciforge.project-coordinator']
  })

  const lifecycleContribution = entry.contributions.find(({ id }) => (
    id === COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION.id
  )) as Readonly<{
    value: DomainMainRuntimeLifecycleContribution
    onDispose?: () => void | Promise<void>
  }> | undefined
  assert.ok(lifecycleContribution)
  const userDataDir = '/profiles/meeting-owner'
  const deactivate = await lifecycleContribution.value.activate({ userDataDir } as never)

  assert.deepEqual(acquisitions, [
    {
      serviceId: AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
      contractVersion: AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION
    },
    {
      serviceId: AGENT_CLOUD_RUNTIME_SERVICE_ID,
      contractVersion: AGENT_CLOUD_RUNTIME_CONTRACT_VERSION
    }
  ])

  assert.equal(runtimeOptions?.authenticatedCloudTransport, transport)
  assert.equal(runtimeOptions?.packageSettings, packageSettings)
  assert.equal(runtimeOptions?.agentCloudRuntime, agentCloudRuntime)
  assert.equal(runtimeOptions?.statePath, collaborationStatePath(userDataDir))
  assert.deepEqual(await coordinatorService.execute(command), fenceResponse)
  assert.deepEqual(coordinatorCommand, command)
  assert.equal(typeof deactivate, 'function')
  await deactivate?.()
  assert.equal(deactivationCount, 1)
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
