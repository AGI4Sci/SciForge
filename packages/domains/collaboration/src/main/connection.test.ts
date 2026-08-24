import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import {
  AgentCloudRuntimeError
} from '@sciforge/domain-identity-access/agent-cloud-runtime'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  defineAuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  restRequestSchema,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import {
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  agentNodeFixture,
  chineseProviderLocatorFixture,
  humanEndpointBindingFixture,
  participantProfileFixture,
  userPrincipalFixture
} from '@sciforge/collaboration-contracts/testing'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'

import { CollaborationConnection } from './connection.js'
import type { DurableCloudOutbox } from './outbox.js'
import { CollaborationSettingsService } from './settings.js'
import {
  CollaborationLocalStore,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'
import { createTestAgentCloudRuntime } from './test-agent-cloud-runtime.js'

const BASE_URL = 'https://collaboration.example.test'

test('Agent revocation fences Identity authority before stopping local delivery', async () => {
  const store = await localStore([agentNodeFixture])
  let fenced: string | undefined
  let stopped = false
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: { stop: () => { stopped = true } } as unknown as DurableCloudOutbox,
    authenticatedCloudTransport: unusedUserTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      fenceAgent: async (agentId) => { fenced = agentId }
    }),
    inboxHandler: { handle: async () => undefined }
  })

  await connection.acceptAgentRevocation(TEST_IDS.agentId, TEST_LATER_TIMESTAMP)

  assert.equal(fenced, TEST_IDS.agentId)
  assert.equal(stopped, true)
  assert.equal(store.snapshot().agents[0]?.lifecycleStatus, 'revoked')
  assert.equal(store.snapshot().agents[0]?.connectionStatus, 'offline')
  assert.equal(connection.state().state, 'error')
})

test('activation fails closed when Collaboration and Identity endpoints differ', async () => {
  const store = await localStore([])
  let userCalls = 0
  let agentCalls = 0
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(
      'https://another-cloud.example.test',
      async () => { userCalls += 1; throw new Error('must not execute') }
    ),
    agentCloudRuntime: createTestAgentCloudRuntime({
      execute: async () => { agentCalls += 1; throw new Error('must not execute') }
    }),
    inboxHandler: { handle: async () => undefined }
  })

  await assert.rejects(connection.activate(), /do not match the active Identity Cloud endpoint/u)
  assert.equal(userCalls, 0)
  assert.equal(agentCalls, 0)
})

test('configuration and endpoint challenge use only OIDC User transport', async () => {
  const store = await localStore([])
  const requests: RestRequest[] = []
  const challengeId = `chl_${'c'.repeat(32)}`
  const challengeCode = 'z'.repeat(12)
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(emptySettingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request) => {
      requests.push(request)
      if (request.type === 'endpoint.catalog.get') return endpointCatalogResponse(request.requestId)
      if (request.type === 'endpoint.challenge.get') {
        return {
          protocolVersion: '1.0',
          type: 'endpoint.challenge.pending',
          requestId: request.requestId,
          challengeId,
          expiresAt: '2099-08-15T09:00:00.000Z',
          retryAfterSeconds: 7
        }
      }
      assert.equal(request.type, 'endpoint.challenge.create')
      return {
        protocolVersion: '1.0',
        type: 'endpoint.challenge.created',
        requestId: request.requestId,
        challengeId,
        challengeCode,
        expiresAt: '2099-08-15T09:00:00.000Z'
      }
    }),
    agentCloudRuntime: createTestAgentCloudRuntime({
      execute: async () => { throw new Error('Agent runtime must not execute User commands.') }
    }),
    inboxHandler: { handle: async () => undefined }
  })

  await connection.configure(BASE_URL)
  const started = await connection.startChallenge({
    providerKey: 'zulip',
    locator: { realmId: 'research-lab', providerUserId: 'zulip-user-42' }
  })
  const polled = await connection.pollChallenge({ challengeId })

  assert.equal(started.pairingCode, `/bind SF1.${'c'.repeat(32)}.${challengeCode}`)
  assert.deepEqual(polled, {
    status: 'pending',
    expiresAt: '2099-08-15T09:00:00.000Z',
    retryAfterSeconds: 7
  })
  assert.deepEqual(requests.map(({ type }) => type), [
    'endpoint.catalog.get',
    'endpoint.challenge.create',
    'endpoint.challenge.get'
  ])
})

test('registration delegates bootstrap and authority storage to Identity then refreshes participant', async () => {
  const initialParticipant = {
    ...participantProfileFixture,
    primaryAgentId: null,
    status: 'incomplete' as const,
    revision: 1
  }
  const refreshedParticipant = {
    ...participantProfileFixture,
    primaryAgentId: TEST_IDS.agentId,
    status: 'active' as const,
    revision: 2,
    updatedAt: TEST_LATER_TIMESTAMP
  }
  const store = await localStore([], initialParticipant)
  const userRequests: string[] = []
  const registerInputs: unknown[] = []
  const agentRequests: string[] = []
  const agentRuntime = createTestAgentCloudRuntime({
    authorityStatus: readyAuthority,
    registerAgent: async (input) => {
      registerInputs.push(input)
      return agentNodeFixture
    },
    execute: async (agentId, request) => {
      assert.equal(agentId, TEST_IDS.agentId)
      agentRequests.push(request.type)
      assert.equal(request.type, 'agent.heartbeat')
      return {
        protocolVersion: '1.0',
        type: 'rest.entity',
        requestId: request.requestId,
        entity: { ...agentNodeFixture, connectionStatus: 'online', revision: 2 }
      }
    }
  })
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request) => {
      userRequests.push(request.type)
      if (request.type === 'endpoint.catalog.get') return endpointCatalogResponse(request.requestId)
      assert.equal(request.type, 'participant.get')
      return {
        protocolVersion: '1.0',
        type: 'participant.snapshot',
        requestId: request.requestId,
        user: userPrincipalFixture,
        participant: refreshedParticipant,
        humanEndpoints: [humanEndpointBindingFixture],
        agents: [agentNodeFixture]
      }
    }),
    agentCloudRuntime: agentRuntime,
    inboxHandler: { handle: async () => undefined }
  })
  await connection.configure(BASE_URL)

  const agent = await connection.registerAgent({
    displayName: 'Desktop',
    nodeType: 'desktop',
    capabilities: []
  })

  assert.equal(agent.agentId, TEST_IDS.agentId)
  assert.equal(store.snapshot().participant?.revision, 2)
  assert.deepEqual(userRequests, ['endpoint.catalog.get', 'participant.get'])
  assert.deepEqual(agentRequests, ['agent.heartbeat'])
  assert.deepEqual(registerInputs, [{
    displayName: 'Desktop',
    nodeType: 'desktop',
    capabilities: [],
    idempotencyKey: `idem_agent.register.${createHash('sha256')
      .update(JSON.stringify({
        deviceId: TEST_IDS.deviceId,
        ownerUserId: TEST_IDS.userId,
        displayName: 'Desktop',
        nodeType: 'desktop',
        capabilities: []
      }))
      .digest('hex')
      .slice(0, 48)}`
  }])
  await connection.dispose()
})

test('registration conflict rotates through the bounded Identity lifecycle method', async () => {
  const rotatedAgent = {
    ...agentNodeFixture,
    credentialVersion: 2,
    revision: 2,
    updatedAt: TEST_LATER_TIMESTAMP
  }
  const store = await localStore([agentNodeFixture])
  let participantReads = 0
  const lifecycleCalls: string[] = []
  const agentRuntime = createTestAgentCloudRuntime({
    authorityStatus: readyAuthority,
    registerAgent: async () => {
      lifecycleCalls.push('register')
      throw new AgentCloudRuntimeError(
        'conflict',
        'registration was already consumed',
        'idempotency_conflict'
      )
    },
    rotateAgent: async (input) => {
      lifecycleCalls.push('rotate')
      assert.equal(input.agentId, TEST_IDS.agentId)
      assert.equal(input.expectedRevision, 1)
      return rotatedAgent
    },
    execute: async (_agentId, request) => ({
      protocolVersion: '1.0',
      type: 'rest.entity',
      requestId: request.requestId,
      entity: { ...rotatedAgent, connectionStatus: 'online', revision: 3 }
    })
  })
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request) => {
      if (request.type === 'endpoint.catalog.get') return endpointCatalogResponse(request.requestId)
      assert.equal(request.type, 'participant.get')
      participantReads += 1
      return {
        protocolVersion: '1.0',
        type: 'participant.snapshot',
        requestId: request.requestId,
        user: userPrincipalFixture,
        participant: participantProfileFixture,
        humanEndpoints: [humanEndpointBindingFixture],
        agents: [participantReads === 1 ? agentNodeFixture : rotatedAgent]
      }
    }),
    agentCloudRuntime: agentRuntime,
    inboxHandler: { handle: async () => undefined }
  })
  await connection.configure(BASE_URL)

  const result = await connection.registerAgent({
    displayName: 'Desktop',
    nodeType: 'desktop',
    capabilities: []
  })

  assert.equal(result.credentialVersion, 2)
  assert.deepEqual(lifecycleCalls, ['register', 'rotate'])
  assert.equal(participantReads, 2)
  await connection.dispose()
})

test('restart activation repairs participant and locators before connecting Agent runtime', async () => {
  const staleParticipant = {
    ...participantProfileFixture,
    primaryAgentId: null,
    status: 'incomplete' as const,
    revision: 1
  }
  const refreshedParticipant = {
    ...participantProfileFixture,
    primaryAgentId: TEST_IDS.agentId,
    status: 'active' as const,
    revision: 2,
    updatedAt: TEST_LATER_TIMESTAMP
  }
  const store = await localStore([agentNodeFixture], staleParticipant)
  const agentRequests: string[] = []
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request) => {
      if (request.type === 'endpoint.catalog.get') return endpointCatalogResponse(request.requestId)
      if (request.type === 'participant.get') {
        return {
          protocolVersion: '1.0',
          type: 'participant.snapshot',
          requestId: request.requestId,
          user: userPrincipalFixture,
          participant: refreshedParticipant,
          humanEndpoints: [humanEndpointBindingFixture],
          agents: [agentNodeFixture]
        }
      }
      assert.equal(request.type, 'endpoint.locator.list')
      return {
        protocolVersion: '1.0',
        type: 'endpoint.locator_page',
        requestId: request.requestId,
        locators: [request.cursor
          ? { ...chineseProviderLocatorFixture, topicId: 'topic-second', topicDisplayName: '第二项目' }
          : chineseProviderLocatorFixture],
        ...(request.cursor ? {} : { nextCursor: 'NTAw' })
      }
    }),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        agentRequests.push(request.type)
        return {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: request.requestId,
          entity: { ...agentNodeFixture, connectionStatus: 'online', revision: 2 }
        }
      }
    }),
    inboxHandler: { handle: async () => undefined }
  })

  await connection.activate()

  assert.equal(store.snapshot().participant?.revision, 2)
  assert.equal(store.snapshot().endpointLocators.length, 2)
  assert.deepEqual(agentRequests, ['agent.heartbeat'])
  await connection.dispose()
})

function userTransport(
  baseUrl: string,
  execute: (request: RestRequest) => Promise<RestResponse>
) {
  return defineAuthenticatedCloudTransport({
    status: () => ({
      state: 'ready',
      baseUrl,
      userId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId
    }),
    execute: async (input) => {
      assert.equal(input.operationId, AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID)
      const request = restRequestSchema.parse(input.payload)
      return { contractVersion: 1, status: 200, body: await execute(request) as never }
    }
  })
}
function unusedUserTransport() {
  return userTransport(BASE_URL, async () => { throw new Error('User transport is unused.') })
}

async function readyAuthority(agentId: string) {
  return {
    state: 'ready' as const,
    agentId,
    userId: TEST_IDS.userId,
    deviceId: TEST_IDS.deviceId,
    generation: agentNodeFixture.credentialVersion
  }
}

function endpointCatalogResponse(requestId: string): RestResponse {
  return {
    protocolVersion: '1.0',
    type: 'endpoint.catalog',
    requestId,
    providers: []
  }
}

function settingsHost(): DomainMainPackageSettingsHost {
  let revision = 1
  let value: DomainPackageJsonValue | null = { schemaVersion: 2, baseUrl: BASE_URL }
  return settingsBackend(() => ({ revision, value }), (next) => {
    revision += 1
    value = next
    return { revision, value }
  })
}

function emptySettingsHost(): DomainMainPackageSettingsHost {
  let revision = 0
  let value: DomainPackageJsonValue | null = null
  return settingsBackend(() => ({ revision, value }), (next) => {
    revision += 1
    value = next
    return { revision, value }
  })
}

function settingsBackend(
  readValue: () => Readonly<{ revision: number; value: DomainPackageJsonValue | null }>,
  writeValue: (value: DomainPackageJsonValue | null) => Readonly<{
    revision: number
    value: DomainPackageJsonValue | null
  }>
): DomainMainPackageSettingsHost {
  return {
    read: async () => readValue() as never,
    write: async (value, expectedRevision) => {
      assert.equal(expectedRevision, readValue().revision)
      return writeValue(value) as never
    },
    clear: async (expectedRevision) => {
      assert.equal(expectedRevision, readValue().revision)
      return writeValue(null) as never
    }
  }
}

function lifecycleOutbox(): DurableCloudOutbox {
  return {
    start: () => undefined,
    wake: () => undefined,
    stop: () => undefined
  } as unknown as DurableCloudOutbox
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> { this.value = structuredClone(value) }
}

async function localStore(
  agents: CollaborationLocalState['agents'],
  participant = participantProfileFixture
): Promise<CollaborationLocalStore> {
  const store = new CollaborationLocalStore(new MemoryBackend({
    schemaVersion: 1,
    revision: 1,
    lastInboxSequence: 0,
    user: userPrincipalFixture,
    participant,
    endpoints: [humanEndpointBindingFixture],
    endpointLocators: [],
    agents,
    projections: [],
    projects: [],
    tasks: [],
    taskRuns: [],
    queue: [],
    receipts: [],
    outbox: [],
    diagnostics: []
  }))
  await store.open()
  return store
}
