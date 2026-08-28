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
  agentInboxMessageSchema,
  restRequestSchema,
  type AgentInboxMessage,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import {
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  agentInboxMessageFixture,
  agentNodeFixture,
  chineseProviderLocatorFixture,
  humanEndpointBindingFixture,
  participantProfileFixture,
  userPrincipalFixture,
  webSocketMessageFixture
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

test('Runtime authority loss stops delivery and fences local executions before reconnect', async () => {
  const store = await localStore([agentNodeFixture])
  let fenced: Readonly<{ agentId: string; reason: string }> | undefined
  let stopped = false
  let heartbeatProjectionAttempts = 0
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: {
      start: () => undefined,
      wake: () => undefined,
      stop: () => { stopped = true }
    } as unknown as DurableCloudOutbox,
    authenticatedCloudTransport: unusedUserTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async () => {
        throw new AgentCloudRuntimeError(
          'runtime_required',
          'Configure an AgentRuntime before connecting collaboration.'
        )
      }
    }),
    inboxHandler: { handle: async () => undefined },
    onAuthorityLost: async (agentId, reason) => { fenced = { agentId, reason } },
    afterHeartbeat: async () => { heartbeatProjectionAttempts += 1 }
  })

  await assert.rejects(connection.connect(), /Configure an AgentRuntime/u)

  assert.deepEqual(fenced, {
    agentId: TEST_IDS.agentId,
    reason: 'Configure an AgentRuntime before connecting collaboration.'
  })
  assert.equal(stopped, true)
  assert.equal(heartbeatProjectionAttempts, 0)
  assert.equal(connection.state().state, 'error')
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
      if (request.type === 'participant.get') {
        return {
          protocolVersion: '1.0',
          type: 'participant.snapshot',
          requestId: request.requestId,
          user: userPrincipalFixture,
          participant: participantProfileFixture,
          humanEndpoints: [humanEndpointBindingFixture],
          agents: [agentNodeFixture]
        }
      }
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
      ensureAgent: async () => agentNodeFixture,
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
    'participant.get',
    'endpoint.challenge.create',
    'endpoint.challenge.get'
  ])
})

test('activation automatically ensures the current Device Agent then connects it', async () => {
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
  let ensureCalls = 0
  const agentRequests: string[] = []
  const heartbeatStatuses: string[] = []
  const agentRuntime = createTestAgentCloudRuntime({
    authorityStatus: readyAuthority,
    ensureAgent: async () => {
      ensureCalls += 1
      return agentNodeFixture
    },
    execute: async (agentId, request) => {
      assert.equal(agentId, TEST_IDS.agentId)
      agentRequests.push(request.type)
      assert.equal(request.type, 'agent.heartbeat')
      if (request.type !== 'agent.heartbeat') throw new Error('Expected the exact Agent heartbeat command.')
      assert.deepEqual(request.capabilities, [
        'agent-runtime.codex',
        'model-access.api'
      ])
      return {
        protocolVersion: '1.0',
        type: 'rest.entity',
        requestId: request.requestId,
        entity: {
          ...agentNodeFixture,
          capabilities: request.capabilities,
          connectionStatus: 'online',
          revision: 2
        }
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
      if (request.type === 'endpoint.locator.list') {
        return {
          protocolVersion: '1.0',
          type: 'endpoint.locator_page',
          requestId: request.requestId,
          locators: []
        }
      }
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
    inboxHandler: { handle: async () => undefined },
    afterHeartbeat: async (status) => { heartbeatStatuses.push(status) }
  })
  await connection.activate()

  assert.equal(store.snapshot().participant?.revision, 2)
  assert.equal(ensureCalls, 1)
  assert.deepEqual(userRequests, [
    'endpoint.catalog.get',
    'participant.get',
    'endpoint.locator.list'
  ])
  assert.deepEqual(agentRequests, ['agent.heartbeat'])
  assert.deepEqual(heartbeatStatuses, ['online'])
  assert.deepEqual(store.snapshot().agents[0]?.capabilities, [
    'agent-runtime.codex',
    'model-access.api'
  ])
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
      ensureAgent: async () => agentNodeFixture,
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

test('WSS is only a refill hint and reconnect durably handles and ACKs each inbox sequence once', async () => {
  const store = await localStore([agentNodeFixture])
  const messages: AgentInboxMessage[] = [agentInboxMessageFixture]
  const handled: string[] = []
  let heartbeatRevision = agentNodeFixture.revision
  let pullCalls = 0
  let notificationSubscriptions = 0
  let wakes = 0
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: {
      start: () => undefined,
      wake: () => { wakes += 1 },
      stop: () => undefined
    } as unknown as DurableCloudOutbox,
    authenticatedCloudTransport: unusedUserTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        assert.equal(request.type, 'agent.heartbeat')
        heartbeatRevision += 1
        return {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: request.requestId,
          entity: {
            ...agentNodeFixture,
            revision: heartbeatRevision,
            connectionStatus: 'online',
            lastSeenAt: TEST_LATER_TIMESTAMP,
            updatedAt: TEST_LATER_TIMESTAMP
          }
        }
      },
      pullAgentInbox: async ({ afterSequence }) => {
        pullCalls += 1
        const duplicateProbe = pullCalls === 2 || pullCalls === 4
        const page = duplicateProbe
          ? messages
          : messages.filter(({ sequence }) => sequence > afterSequence)
        return {
          messages: page,
          nextSequence: messages.at(-1)?.sequence ?? afterSequence
        }
      },
      observeAgentInbox: async function* (_agentId, signal) {
        notificationSubscriptions += 1
        yield webSocketMessageFixture
        await waitForAbort(signal)
      }
    }),
    inboxHandler: {
      handle: async (message) => { handled.push(message.inboxMessageId) }
    }
  })

  await connection.connect()
  await waitForCondition(() => pullCalls >= 2)
  await connection.disconnect()

  messages.push(agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: 'ibx_Inbox0000002',
    sequence: 2
  }))
  await connection.connect()
  await waitForCondition(() => pullCalls >= 4)
  await connection.disconnect()

  assert.equal(notificationSubscriptions, 2)
  assert.deepEqual(handled, ['ibx_Inbox0000001', 'ibx_Inbox0000002'])
  assert.equal(store.snapshot().lastInboxSequence, 2)
  assert.equal(wakes, 2)
  assert.deepEqual(store.snapshot().outbox.map(({ kind, body }) => ({
    kind,
    type: body.type,
    sequence: body.type === 'inbox.ack' ? body.sequence : null
  })), [
    { kind: 'inbox.ack', type: 'inbox.ack', sequence: 1 },
    { kind: 'inbox.ack', type: 'inbox.ack', sequence: 2 }
  ])
})

test('connect drains every durable inbox page before relying on another WSS hint', async () => {
  const store = await localStore([agentNodeFixture])
  const messages = Array.from({ length: 101 }, (_, index) => agentInboxMessageSchema.parse({
    ...agentInboxMessageFixture,
    inboxMessageId: `ibx_Refill${String(index + 1).padStart(8, '0')}`,
    sequence: index + 1
  }))
  const afterSequences: number[] = []
  const handled: number[] = []
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: unusedUserTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => ({
        protocolVersion: '1.0',
        type: 'rest.entity',
        requestId: request.requestId,
        entity: {
          ...agentNodeFixture,
          revision: agentNodeFixture.revision + 1,
          connectionStatus: 'online',
          lastSeenAt: TEST_LATER_TIMESTAMP,
          updatedAt: TEST_LATER_TIMESTAMP
        }
      }),
      pullAgentInbox: async ({ afterSequence, limit = 100 }) => {
        afterSequences.push(afterSequence)
        const page = messages
          .filter(({ sequence }) => sequence > afterSequence)
          .slice(0, limit)
        return {
          messages: page,
          nextSequence: page.at(-1)?.sequence ?? afterSequence
        }
      }
    }),
    inboxHandler: { handle: async (message) => { handled.push(message.sequence) } }
  })

  await connection.connect()
  await connection.disconnect()
  assert.deepEqual(afterSequences, [0, 100])
  assert.equal(handled.length, 101)
  assert.equal(store.snapshot().lastInboxSequence, 101)
  assert.equal(store.snapshot().outbox.filter(({ kind }) => kind === 'inbox.ack').length, 101)
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
    generation: agentNodeFixture.credentialVersion,
    runtimeId: 'codex',
    capabilityTags: ['agent-runtime.codex', 'model-access.api']
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
    schemaVersion: 2,
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

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  const expiresAt = Date.now() + 1_000
  while (!condition()) {
    if (Date.now() >= expiresAt) throw new Error('Timed out waiting for test condition.')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
