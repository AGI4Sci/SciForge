import assert from 'node:assert/strict'
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
const REGISTER_INPUT = {
  displayName: 'Recovery Desktop',
  nodeType: 'desktop' as const,
  capabilities: ['task.execute']
}

test('a private-vault registration failure leaves Collaboration facts unchanged and is retryable', async () => {
  const harness = await createHarness()
  let attempts = 0
  harness.setAgentRuntime(createTestAgentCloudRuntime({
    authorityStatus: readyAuthority,
    registerAgent: async () => {
      attempts += 1
      if (attempts === 1) {
        throw new AgentCloudRuntimeError(
          'runtime_unavailable',
          'Identity private vault is unavailable.'
        )
      }
      return agentNodeFixture
    },
    execute: heartbeatResponse
  }))

  await assert.rejects(
    harness.connection().registerAgent(REGISTER_INPUT),
    /private vault is unavailable/u
  )
  assert.equal(harness.store.snapshot().agents.length, 0)

  const recovered = await harness.connection().registerAgent(REGISTER_INPUT)
  assert.equal(recovered.agentId, TEST_IDS.agentId)
  assert.equal(harness.store.snapshot().agents.length, 1)
  assert.equal(attempts, 2)
  await harness.connection().dispose()
})

test('a local state failure after Identity commit recovers by exact rotate without a second bootstrap path', async () => {
  const backend = new FailingBackend(baseState())
  const harness = await createHarness(backend)
  let registerCalls = 0
  let rotateCalls = 0
  let authorityCommitted = false
  harness.setAgentRuntime(createTestAgentCloudRuntime({
    authorityStatus: readyAuthority,
    registerAgent: async () => {
      registerCalls += 1
      if (authorityCommitted) {
        throw new AgentCloudRuntimeError(
          'conflict',
          'One-time registration was already committed.',
          'idempotency_conflict'
        )
      }
      authorityCommitted = true
      return agentNodeFixture
    },
    rotateAgent: async () => {
      rotateCalls += 1
      return {
        ...agentNodeFixture,
        credentialVersion: 2,
        revision: 2,
        updatedAt: TEST_LATER_TIMESTAMP
      }
    },
    execute: heartbeatResponse
  }))

  backend.failNextWrite = true
  await assert.rejects(
    harness.connection().registerAgent(REGISTER_INPUT),
    /temporary state write failure/u
  )
  assert.equal(harness.store.snapshot().agents.length, 0)

  const recovered = await harness.connection().registerAgent(REGISTER_INPUT)
  assert.equal(recovered.credentialVersion, 2)
  assert.equal(registerCalls, 2)
  assert.equal(rotateCalls, 1)
  await harness.connection().dispose()
})

test('idempotency conflict fails closed when current Device has no recoverable active Agent', async () => {
  const harness = await createHarness()
  let rotateCalls = 0
  harness.setAgentRuntime(createTestAgentCloudRuntime({
    registerAgent: async () => {
      throw new AgentCloudRuntimeError(
        'conflict',
        'One-time registration was already consumed.',
        'idempotency_conflict'
      )
    },
    rotateAgent: async () => {
      rotateCalls += 1
      return agentNodeFixture
    }
  }))
  harness.setParticipantAgents([])

  await assert.rejects(
    harness.connection().registerAgent(REGISTER_INPUT),
    /could not find an active Agent/u
  )
  assert.equal(rotateCalls, 0)
  assert.equal(harness.store.snapshot().agents.length, 0)
})

async function createHarness(backend: FailingBackend = new FailingBackend(baseState())) {
  const store = new CollaborationLocalStore(backend)
  await store.open()
  let runtime = createTestAgentCloudRuntime({})
  let participantAgents = [agentNodeFixture]
  const userTransport = defineAuthenticatedCloudTransport({
    status: () => ({
      state: 'ready',
      baseUrl: BASE_URL,
      userId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId
    }),
    execute: async (input) => {
      assert.equal(input.operationId, AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID)
      const request = restRequestSchema.parse(input.payload)
      const response = userResponse(request, participantAgents)
      return { contractVersion: 1, status: 200, body: response as never }
    }
  })
  let connection = buildConnection()

  function buildConnection() {
    return new CollaborationConnection({
      store,
      settings: new CollaborationSettingsService(settingsHost()),
      outbox: lifecycleOutbox(),
      authenticatedCloudTransport: userTransport,
      agentCloudRuntime: new Proxy({} as typeof runtime, {
        get: (_target, property) => runtime[property as keyof typeof runtime]
      }),
      inboxHandler: { handle: async () => undefined }
    })
  }

  return {
    store,
    connection: () => connection,
    setAgentRuntime(next: typeof runtime) {
      runtime = next
      connection = buildConnection()
    },
    setParticipantAgents(next: typeof participantAgents) {
      participantAgents = next
    }
  }
}

function userResponse(request: RestRequest, agents: readonly typeof agentNodeFixture[]): RestResponse {
  if (request.type === 'endpoint.catalog.get') {
    return { protocolVersion: '1.0', type: 'endpoint.catalog', requestId: request.requestId, providers: [] }
  }
  assert.equal(request.type, 'participant.get')
  return {
    protocolVersion: '1.0',
    type: 'participant.snapshot',
    requestId: request.requestId,
    user: userPrincipalFixture,
    participant: participantProfileFixture,
    humanEndpoints: [humanEndpointBindingFixture],
    agents: [...agents]
  }
}

async function heartbeatResponse(_agentId: string, request: RestRequest): Promise<RestResponse> {
  assert.equal(request.type, 'agent.heartbeat')
  return {
    protocolVersion: '1.0',
    type: 'rest.entity',
    requestId: request.requestId,
    entity: { ...agentNodeFixture, connectionStatus: 'online', revision: 2 }
  }
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

function lifecycleOutbox(): DurableCloudOutbox {
  return {
    start: () => undefined,
    wake: () => undefined,
    stop: () => undefined
  } as unknown as DurableCloudOutbox
}

function settingsHost(): DomainMainPackageSettingsHost {
  let revision = 1
  let value: DomainPackageJsonValue | null = { schemaVersion: 2, baseUrl: BASE_URL }
  return {
    read: async () => ({ revision, value }) as never,
    write: async (next, expectedRevision) => {
      assert.equal(expectedRevision, revision)
      revision += 1
      value = next
      return { revision, value } as never
    },
    clear: async (expectedRevision) => {
      assert.equal(expectedRevision, revision)
      revision += 1
      value = null
      return { revision, value: null } as never
    }
  }
}

class FailingBackend implements CollaborationStateBackend {
  failNextWrite = false
  constructor(private value: unknown) {}
  async read(): Promise<unknown> { return structuredClone(this.value) }
  async write(value: CollaborationLocalState): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false
      throw new Error('temporary state write failure')
    }
    this.value = structuredClone(value)
  }
}

function baseState(): CollaborationLocalState {
  return {
    schemaVersion: 1,
    revision: 1,
    lastInboxSequence: 0,
    user: userPrincipalFixture,
    participant: participantProfileFixture,
    endpoints: [humanEndpointBindingFixture],
    endpointLocators: [],
    managedContainers: [],
    agents: [],
    projections: [],
    projects: [],
    tasks: [],
    taskRuns: [],
    queue: [],
    receipts: [],
    outbox: [],
    workerAcceptancePolicies: [],
    remoteApprovals: [],
    diagnostics: []
  }
}
