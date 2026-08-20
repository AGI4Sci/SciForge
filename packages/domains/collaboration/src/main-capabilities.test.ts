import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TEST_IDS,
  chineseProviderLocatorFixture
} from '@sciforge/collaboration-contracts/testing'
import {
  COLLABORATION_CAPABILITY_IDS,
  collaborationConnectionViewSchema,
  collaborationParticipantViewSchema,
  type CollaborationProjectionView,
  type CollaborationStatusSnapshot
} from './contract.js'
import {
  createCollaborationCapabilityFactory,
  type CollaborationCapabilityOptions
} from './main.js'
import type { CollaborationRuntime } from './main/runtime.js'

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
      requestedDisplayName: 'Researcher',
      locator: { realmId: 'research-lab' }
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
    [COLLABORATION_CAPABILITY_IDS.managedContainerManage]: { action: 'refresh-status' }
  }
  const mutations = definitions.filter((definition) => definition.effect === 'external-write')

  assert.equal(mutations.length, 10)
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
})
