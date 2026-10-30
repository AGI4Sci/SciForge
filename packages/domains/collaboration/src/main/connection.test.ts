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
  projectFixture,
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

test('automatically reconnects and resumes the outbox after OIDC authority returns', async (context) => {
  const store = await localStore([agentNodeFixture])
  let identityReady = true
  let authorityReady = true
  let heartbeatCount = 0
  let readySweepCount = 0
  let outboxStarts = 0
  const authenticatedCloudTransport = defineAuthenticatedCloudTransport({
    status: () => identityReady
      ? { state: 'ready' as const, baseUrl: BASE_URL, userId: TEST_IDS.userId,
        deviceId: TEST_IDS.deviceId, deviceRevision: 1 }
      : { state: 'identity_required' as const, baseUrl: BASE_URL },
    execute: async (input) => {
      assert.equal(identityReady, true)
      const request = restRequestSchema.parse(input.payload)
      if (request.type === 'endpoint.catalog.get') {
        return { contractVersion: 1, status: 200, body: endpointCatalogResponse(request.requestId) }
      }
      if (request.type === 'participant.get') {
        return { contractVersion: 1, status: 200, body: {
          protocolVersion: '1.0', type: 'participant.snapshot', requestId: request.requestId,
          user: userPrincipalFixture, participant: participantProfileFixture,
          humanEndpoints: [], agents: [agentNodeFixture]
        } }
      }
      if (request.type === 'project.list') {
        return { contractVersion: 1, status: 200, body: {
          protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId,
          limit: 250, projects: [], observedAt: TEST_LATER_TIMESTAMP
        } }
      }
      throw new Error(`Unexpected authenticated request ${request.type}`)
    },
    stageObject: async () => { throw new Error('Object staging is unused.') },
    readObject: async () => { throw new Error('Object reads are unused.') }
  })
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: {
      start: () => { outboxStarts += 1 },
      wake: () => undefined,
      stop: () => undefined
    } as unknown as DurableCloudOutbox,
    authenticatedCloudTransport,
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => authorityReady
        ? readyAuthority(agentId)
        : { state: 'agent_required' as const, agentId },
      ensureAgent: async () => agentNodeFixture,
      execute: async (_agentId, request) => {
        assert.equal(request.type, 'agent.heartbeat')
        heartbeatCount += 1
        return {
          protocolVersion: '1.0', type: 'rest.entity', requestId: request.requestId,
          entity: { ...agentNodeFixture, connectionStatus: 'online', revision: agentNodeFixture.revision + heartbeatCount }
        }
      }
    }),
    inboxHandler: { handle: async () => undefined },
    afterHeartbeat: async () => { readySweepCount += 1 }
  })

  await connection.activate()
  assert.equal(connection.state().state, 'connected')
  assert.equal(readySweepCount, 1)
  await connection.disconnect()
  context.mock.timers.enable({ apis: ['setTimeout'] })
  identityReady = false
  authorityReady = false
  await assert.rejects(connection.connect(), /Register this Device as an Agent/u)
  assert.equal(connection.state().state, 'error')
  assert.equal(readySweepCount, 1, 'unready authority must not trigger a sweep')
  identityReady = true
  authorityReady = true
  try {
    context.mock.timers.tick(1_000)
    await drainMicrotasks()
    assert.equal(connection.state().state, 'connected')
    assert.equal(heartbeatCount > 0, true)
    assert.equal(outboxStarts > 0, true)
    assert.equal(readySweepCount, 2)
  } finally {
    await connection.dispose()
  }
})

test('a configured Desktop joins once Identity recovers after startup', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const store = await localStore([])
  let identityReady = false
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: defineAuthenticatedCloudTransport({
      status: () => identityReady
        ? { state: 'ready' as const, baseUrl: BASE_URL, userId: TEST_IDS.userId,
          deviceId: TEST_IDS.deviceId, deviceRevision: 1 }
        : { state: 'identity_required' as const, baseUrl: BASE_URL },
      execute: async (input) => {
        assert.equal(identityReady, true)
        const request = restRequestSchema.parse(input.payload)
        if (request.type === 'endpoint.catalog.get') {
          return { contractVersion: 1, status: 200, body: endpointCatalogResponse(request.requestId) }
        }
        if (request.type === 'participant.get') {
          return { contractVersion: 1, status: 200, body: {
            protocolVersion: '1.0', type: 'participant.snapshot', requestId: request.requestId,
            user: userPrincipalFixture, participant: participantProfileFixture,
            humanEndpoints: [], agents: [agentNodeFixture]
          } }
        }
        if (request.type === 'project.list') {
          return { contractVersion: 1, status: 200, body: {
            protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId,
            limit: 250, projects: [], observedAt: TEST_LATER_TIMESTAMP
          } }
        }
        throw new Error(`Unexpected authenticated request ${request.type}`)
      },
      stageObject: async () => { throw new Error('Object staging is unused.') },
      readObject: async () => { throw new Error('Object reads are unused.') }
    }),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: async (agentId) => identityReady
        ? readyAuthority(agentId)
        : { state: 'unavailable' as const, reason: 'Identity is not ready.' },
      ensureAgent: async () => agentNodeFixture,
      execute: async (_agentId, request) => ({
        protocolVersion: '1.0', type: 'rest.entity', requestId: request.requestId,
        entity: { ...agentNodeFixture, connectionStatus: 'online', revision: agentNodeFixture.revision + 1 }
      })
    }),
    inboxHandler: { handle: async () => undefined }
  })

  try {
    await connection.activate()
    assert.equal(connection.state().state, 'disconnected')
    assert.equal(await connection.localAgentId(), undefined)
    identityReady = true
    context.mock.timers.tick(1_000)
    await drainMicrotasks()
    await drainMicrotasks()
    assert.equal(connection.state().state, 'connected')
    assert.equal(await connection.localAgentId(), agentNodeFixture.agentId)
  } finally {
    await connection.dispose()
  }
})

test('an explicit reconnect replaces a live poller left by a failed connection', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const store = await localStore([agentNodeFixture])
  let inboxFails = false
  let heartbeats = 0
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request) => {
      if (request.type === 'endpoint.catalog.get') return endpointCatalogResponse(request.requestId)
      if (request.type === 'participant.get') return {
        protocolVersion: '1.0', type: 'participant.snapshot', requestId: request.requestId,
        user: userPrincipalFixture, participant: participantProfileFixture,
        humanEndpoints: [humanEndpointBindingFixture], agents: [agentNodeFixture]
      }
      if (request.type === 'project.list') return {
        protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId,
        limit: 250, projects: [], observedAt: TEST_LATER_TIMESTAMP
      }
      if (request.type === 'endpoint.locator.list') return {
        protocolVersion: '1.0', type: 'endpoint.locator_page', requestId: request.requestId, locators: []
      }
      throw new Error(`Unexpected authenticated request ${request.type}`)
    }),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      ensureAgent: async () => agentNodeFixture,
      execute: async (_agentId, request) => {
        heartbeats += 1
        return {
          protocolVersion: '1.0', type: 'rest.entity', requestId: request.requestId,
          entity: { ...agentNodeFixture, connectionStatus: 'online', revision: agentNodeFixture.revision + heartbeats }
        }
      },
      pullAgentInbox: async () => {
        if (inboxFails) throw new Error('Inbox unavailable')
        return { messages: [], nextSequence: 0 }
      }
    }),
    inboxHandler: { handle: async () => undefined }
  })

  try {
    await connection.connect()
    assert.equal(connection.state().state, 'connected')
    assert.equal(heartbeats, 1)
    inboxFails = true
    context.mock.timers.tick(15_000)
    await drainMicrotasks()
    assert.equal(connection.state().state, 'error')
    inboxFails = false
    await connection.applyConnectionAction({ action: 'recover' })
    assert.equal(connection.state().state, 'connected')
    assert.ok(heartbeats >= 2, 'the explicit reconnect must start a fresh connection')
  } finally {
    await connection.dispose()
  }
})

test('Device authority loss stops delivery and fences local executions before reconnect', async () => {
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
          'device_required',
          'Enroll an active Device before connecting collaboration.'
        )
      }
    }),
    inboxHandler: { handle: async () => undefined },
    onAuthorityLost: async (agentId, reason) => { fenced = { agentId, reason } },
    afterHeartbeat: async () => { heartbeatProjectionAttempts += 1 }
  })

  await assert.rejects(connection.connect(), /Enroll an active Device/u)

  assert.deepEqual(fenced, {
    agentId: TEST_IDS.agentId,
    reason: 'Enroll an active Device before connecting collaboration.'
  })
  assert.equal(stopped, true)
  assert.equal(heartbeatProjectionAttempts, 0)
  assert.equal(connection.state().state, 'error')
})

test('successful connection removes resolved connection diagnostics only', async () => {
  const store = await localStore([agentNodeFixture])
  await store.transact((draft) => {
    draft.diagnostics = [{
      code: 'collaboration.connection_error',
      severity: 'error',
      message: 'SciForge Cloud is unavailable.',
      occurredAt: '2026-09-16T07:41:47.053Z',
      recoverable: true
    }, {
      code: 'collaboration.projection_error',
      severity: 'error',
      message: 'Projection recovery still requires attention.',
      occurredAt: '2026-09-16T07:42:24.419Z',
      recoverable: true
    }]
  })
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: unusedUserTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        assert.equal(request.type, 'agent.heartbeat')
        if (request.type !== 'agent.heartbeat') throw new Error('Expected the exact Agent heartbeat command.')
        return {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: request.requestId,
          entity: {
            ...agentNodeFixture,
            capabilities: request.capabilities,
            connectionStatus: 'online',
            revision: agentNodeFixture.revision + 1
          }
        }
      }
    }),
    inboxHandler: { handle: async () => undefined }
  })

  await connection.connect()
  await connection.disconnect()

  assert.deepEqual(store.snapshot().diagnostics.map(({ code }) => code), [
    'collaboration.projection_error'
  ])
})

test('temporary Device revalidation outage preserves durable Worker intents for recovery', async () => {
  const store = await localStore([agentNodeFixture])
  let fenced = false
  let stopped = false
  let online = false
  const connection = new CollaborationConnection({
    store, settings: new CollaborationSettingsService(settingsHost()),
    outbox: { start: () => undefined, wake: () => undefined,
      stop: () => { stopped = true } } as unknown as DurableCloudOutbox,
    authenticatedCloudTransport: unusedUserTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        if (!online) throw new AgentCloudRuntimeError('runtime_unavailable',
          'SciForge Cloud could not confirm this Desktop Device.')
        return { protocolVersion: '1.0', type: 'rest.entity', requestId: request.requestId,
          entity: { ...agentNodeFixture, connectionStatus: 'online', revision: agentNodeFixture.revision + 1 } }
      },
      pullAgentInbox: async () => ({ messages: [], nextSequence: 0 })
    }),
    inboxHandler: { handle: async () => undefined },
    onAuthorityLost: async () => { fenced = true }
  })
  await assert.rejects(connection.connect(), /could not confirm/u)
  assert.equal(fenced, false)
  assert.equal(stopped, false)
  online = true
  await connection.connect()
  assert.equal(connection.state().state, 'connected')
  assert.equal(fenced, false)
  await connection.disconnect()
})

test('polling clears connection failures only after heartbeat and inbox recover', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const store = await localStore([agentNodeFixture])
  await store.transact((draft) => {
    draft.diagnostics.push({
      code: 'collaboration.cloud_sync_error', severity: 'error',
      message: 'Cloud state remains unsynchronized', occurredAt: TEST_LATER_TIMESTAMP, recoverable: true
    })
  })
  let inboxFails = false
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: unusedUserTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => ({
        protocolVersion: '1.0', type: 'rest.entity', requestId: request.requestId,
        entity: { ...agentNodeFixture, connectionStatus: 'online', revision: agentNodeFixture.revision + 1 }
      }),
      pullAgentInbox: async () => {
        if (inboxFails) throw new Error('Inbox unavailable')
        return { messages: [], nextSequence: 0 }
      }
    }),
    inboxHandler: { handle: async () => undefined }
  })
  const poll = async () => {
    context.mock.timers.tick(15_000)
    // Drain async store/transport work without advancing the next heartbeat timer.
    for (let turn = 0; turn < 20; turn += 1) {
      await new Promise<void>(resolve => setImmediate(resolve))
    }
  }
  try {
    await connection.connect()
    inboxFails = true
    await poll()
    assert.equal(connection.state().state, 'error')
    assert.ok(store.snapshot().diagnostics.some(({ code }) => code === 'collaboration.connection_error'))
    await poll()
    assert.ok(store.snapshot().diagnostics.some(({ code }) => code === 'collaboration.connection_error'))
    inboxFails = false
    await poll()
    assert.equal(connection.state().state, 'connected')
    assert.deepEqual(store.snapshot().diagnostics.map(({ code }) => code), ['collaboration.cloud_sync_error'])
  } finally {
    await connection.disconnect()
  }
})

for (const failedOperation of [
  'endpoint.catalog.get', 'participant.get', 'endpoint.locator.list', 'managed_container.list'
] as const) {
  test(`heartbeat preserves unresolved ${failedOperation} errors until explicit recovery synchronizes Cloud state`, async () => {
    const store = await localStore([agentNodeFixture])
    await store.transact((draft) => {
      draft.diagnostics.push({
        code: 'collaboration.projection_error', severity: 'error',
        message: 'Unresolved projection', occurredAt: TEST_LATER_TIMESTAMP, recoverable: true
      })
    })
    let failing = true
    const requests: string[] = []
    const connection = new CollaborationConnection({
      store,
      settings: new CollaborationSettingsService(settingsHost()),
      outbox: lifecycleOutbox(),
      authenticatedCloudTransport: userTransport(BASE_URL, async (request) => {
        requests.push(request.type)
        if (failing && request.type === failedOperation) throw new Error(`${failedOperation} unavailable`)
        if (request.type === 'endpoint.catalog.get') {
          const catalog = endpointCatalogResponse(request.requestId)
          assert.equal(catalog.type, 'endpoint.catalog')
          if (catalog.type !== 'endpoint.catalog') throw new Error('Expected provider catalog')
          return { ...catalog, providers: catalog.providers.map(provider => ({
            ...provider, capabilities: { ...provider.capabilities, managedContainers: true }
          })) }
        }
        if (request.type === 'participant.get') return {
          protocolVersion: '1.0', type: 'participant.snapshot', requestId: request.requestId,
          user: userPrincipalFixture, participant: participantProfileFixture,
          humanEndpoints: [humanEndpointBindingFixture], agents: [agentNodeFixture]
        }
        if (request.type === 'endpoint.locator.list') return {
          protocolVersion: '1.0', type: 'endpoint.locator_page', requestId: request.requestId,
          locators: [chineseProviderLocatorFixture]
        }
        if (request.type === 'project.list') return {
          protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId,
          limit: 250, projects: [], observedAt: TEST_LATER_TIMESTAMP
        }
        assert.equal(request.type, 'managed_container.list')
        return { protocolVersion: '1.0', type: 'rest.collection', requestId: request.requestId, items: [] }
      }),
      agentCloudRuntime: createTestAgentCloudRuntime({
        authorityStatus: readyAuthority,
        ensureAgent: async () => agentNodeFixture,
        execute: async (_agentId, request) => ({
          protocolVersion: '1.0', type: 'rest.entity', requestId: request.requestId,
          entity: { ...agentNodeFixture, connectionStatus: 'online', revision: agentNodeFixture.revision + 1 }
        })
      }),
      inboxHandler: { handle: async () => undefined }
    })
    try {
      await connection.activate()
      assert.equal(connection.state().state, 'connected')
      assert.ok(store.snapshot().diagnostics.some(diagnostic => (
        diagnostic.code === 'collaboration.cloud_sync_error' &&
        diagnostic.message === `${failedOperation} unavailable`
      )))
      await assert.rejects(connection.applyConnectionAction({ action: 'recover' }), /unavailable/u)
      assert.ok(store.snapshot().diagnostics.some(({ code }) => code === 'collaboration.cloud_sync_error'))
      failing = false
      requests.length = 0
      await connection.applyConnectionAction({ action: 'recover' })
      assert.equal(connection.state().state, 'connected')
      assert.deepEqual(requests, [
        'endpoint.catalog.get', 'participant.get', 'project.list', 'endpoint.locator.list', 'managed_container.list'
      ])
      assert.deepEqual(connection.providers().map(({ providerKey }) => providerKey), ['zulip'])
      assert.equal(store.snapshot().endpointLocators.length, 1)
      assert.deepEqual(store.snapshot().diagnostics.map(({ code }) => code), ['collaboration.projection_error'])
    } finally {
      await connection.disconnect()
    }
  })
}

test('configuration loads the provider catalog and reconnects through Agent authority', async () => {
  const store = await localStore([])
  const requests: RestRequest[] = []
  const agentRequests: string[] = []
  const challengeId = `chl_${'c'.repeat(32)}`
  const challengeCode = 'z'.repeat(12)
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(emptySettingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request) => {
      requests.push(request)
      if (request.type === 'endpoint.locator.list') {
        return { protocolVersion: '1.0', type: 'endpoint.locator_page', requestId: request.requestId, locators: [] }
      }
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
      if (request.type === 'project.list') return {
        protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId,
        limit: 250, projects: [], observedAt: TEST_LATER_TIMESTAMP
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
      authorityStatus: readyAuthority,
      ensureAgent: async () => agentNodeFixture,
      execute: async (agentId, request) => {
        assert.equal(agentId, TEST_IDS.agentId)
        agentRequests.push(request.type)
        assert.equal(request.type, 'agent.heartbeat')
        if (request.type !== 'agent.heartbeat') throw new Error('Expected the exact Agent heartbeat command.')
        return {
          protocolVersion: '1.0',
          type: 'rest.entity',
          requestId: request.requestId,
          entity: {
            ...agentNodeFixture,
            capabilities: request.capabilities,
            connectionStatus: 'online',
            revision: agentNodeFixture.revision + 1
          }
        }
      }
    }),
    inboxHandler: { handle: async () => undefined }
  })

  await connection.configure(BASE_URL)
  assert.equal(connection.state().state, 'connected')
  assert.deepEqual(connection.providers().map(({ providerKey }) => providerKey), ['zulip'])
  await connection.configure(BASE_URL)
  assert.equal(connection.state().state, 'connected')
  // Without an explicit URL the connection binds to the signed-in identity's Cloud.
  await connection.configure()
  assert.equal(connection.state().state, 'connected')
  await assert.rejects(
    connection.configure('https://another-cloud.example.test'),
    /must use the active Identity Cloud endpoint/u
  )
  assert.equal(connection.state().state, 'connected')
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
    'project.list',
    'endpoint.locator.list',
    'endpoint.catalog.get',
    'participant.get',
    'project.list',
    'endpoint.locator.list',
    'endpoint.catalog.get',
    'participant.get',
    'project.list',
    'endpoint.locator.list',
    'endpoint.challenge.create',
    'endpoint.challenge.get'
  ])
  assert.deepEqual(agentRequests, ['agent.heartbeat', 'agent.heartbeat', 'agent.heartbeat'])
  await connection.dispose()
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
      if (request.type === 'project.list') return {
        protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId,
        limit: 250, projects: [], observedAt: TEST_LATER_TIMESTAMP
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
    'project.list',
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

test('a signed-in Desktop that never configured Collaboration binds to its identity Cloud on activation', async () => {
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
  const settings = new CollaborationSettingsService(emptySettingsHost())
  const connection = new CollaborationConnection({
    store,
    settings,
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
      if (request.type === 'project.list') return {
        protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId,
        limit: 250, projects: [], observedAt: TEST_LATER_TIMESTAMP
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

  assert.equal(connection.state().state, 'connected')
  assert.equal((await settings.read()).settings?.baseUrl, BASE_URL)
  assert.equal(store.snapshot().participant?.revision, 2)
  assert.equal(ensureCalls, 1)
  assert.deepEqual(userRequests, [
    'endpoint.catalog.get',
    'participant.get',
    'project.list',
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

test('a WebSocket wake starts Dashboard refresh without waiting for a blocked Inbox pull', async () => {
  const store = await localStore([agentNodeFixture])
  let pulls = 0
  let dashboardReads = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const connection = new CollaborationConnection({
    store, settings: new CollaborationSettingsService(settingsHost()), outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request) => {
      assert.equal(request.type, 'project.list')
      dashboardReads += 1
      return { protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId,
        limit: 250, projects: [], observedAt: TEST_LATER_TIMESTAMP }
    }),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => ({ protocolVersion: '1.0', type: 'rest.entity',
        requestId: request.requestId, entity: { ...agentNodeFixture, revision: agentNodeFixture.revision + 1 } }),
      pullAgentInbox: async ({ afterSequence }) => {
        pulls += 1
        if (pulls > 1) await gate
        return { messages: [], nextSequence: afterSequence }
      },
      observeAgentInbox: async function* (_agentId, signal) {
        yield { protocolVersion: '1.0', type: 'inbox.available', recipientType: 'agent', highestSequence: 1 }
        await waitForAbort(signal)
      }
    }),
    inboxHandler: { handle: async () => undefined }
  })
  try {
    await connection.connect()
    await waitForCondition(() => pulls === 2)
    await waitForCondition(() => dashboardReads === 1)
    assert.equal(dashboardReads, 1)
  } finally { release(); await connection.dispose() }
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

function dashboardProjection(project: typeof projectFixture) {
  return {
    schemaVersion: 1 as const,
    revision: 1,
    createdAt: TEST_LATER_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP,
    type: 'cloud_project_dashboard' as const,
    projectId: project.projectId,
    projectName: project.displayName,
    role: 'owner' as const,
    view: 'board' as const,
    tasks: [],
    activity: [],
    activityCursor: null,
    mentionableUsers: [],
    materialConflicts: [],
    stale: false,
    offline: false,
    revoked: false
  }
}

test('Dashboard reads make bounded parallel progress and publish projects in list order', async () => {
  const store = await localStore([agentNodeFixture])
  const projects = Array.from({ length: 9 }, (_, index) => ({
    ...projectFixture, projectId: `prj_ParallelProject${String(index).padStart(4, '0')}`
  }))
  let active = 0
  let maximum = 0
  let started = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const connection = new CollaborationConnection({
    store, settings: new CollaborationSettingsService(settingsHost()), outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request) => {
      if (request.type === 'project.list') return {
        protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId,
        limit: 250, projects, observedAt: TEST_LATER_TIMESTAMP
      }
      assert.equal(request.type, 'project.coordination.read')
      if (request.type !== 'project.coordination.read') throw new Error('Unexpected request')
      const project = projects.find(({ projectId }) => projectId === request.projectId)!
      started += 1; active += 1; maximum = Math.max(maximum, active)
      try { await gate } finally { active -= 1 }
      return {
        protocolVersion: '1.0', type: 'rest.project_coordination', requestId: request.requestId,
        project, observedAt: TEST_LATER_TIMESTAMP,
        pages: [{ collection: 'project_records', limit: 250, items: [] }],
        finalSummary: null, dashboard: dashboardProjection(project)
      }
    }),
    agentCloudRuntime: createTestAgentCloudRuntime({}), inboxHandler: { handle: async () => undefined }
  })
  const refresh = connection.refreshDashboardsForPage()
  try {
    await waitForCondition(() => started >= 4)
    assert.equal(maximum, 4, 'one bounded pool, not one request per project at once')
    assert.deepEqual(connection.cloudDashboards(), [], 'a partial pool must not publish')
    release()
    await refresh
    assert.equal(maximum, 4)
    assert.deepEqual(connection.cloudDashboards().map(({ projectId }) => projectId), projects.map(({ projectId }) => projectId))
  } finally { release(); await refresh; await connection.dispose() }
})

test('Dashboard timeout aborts transport and a late response cannot overwrite a recovered refresh', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const store = await localStore([agentNodeFixture])
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let first = true
  let signal: AbortSignal | undefined
  const connection = new CollaborationConnection({
    store, settings: new CollaborationSettingsService(settingsHost()), outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request, options) => {
      if (first) { first = false; signal = options?.signal; await gate }
      return { protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId,
        limit: 250, projects: [], observedAt: TEST_LATER_TIMESTAMP }
    }),
    agentCloudRuntime: createTestAgentCloudRuntime({}), inboxHandler: { handle: async () => undefined }
  })
  try {
    const stalled = connection.refreshDashboardsForPage()
    await drainMicrotasks()
    context.mock.timers.tick(30_000)
    await stalled
    assert.equal(signal?.aborted, true)
    assert.equal(store.snapshot().diagnostics[0]?.code, 'collaboration.dashboard_sync_error')
    await connection.refreshDashboardsForPage()
    assert.deepEqual(store.snapshot().diagnostics, [])
    release()
    await drainMicrotasks()
    assert.deepEqual(connection.cloudDashboards(), [])
    assert.deepEqual(store.snapshot().diagnostics, [], 'late failed work cannot restore an old diagnostic')
  } finally { release(); await connection.dispose() }
})

test('disconnect fences a pending Dashboard even if its transport ignores abort', async () => {
  const store = await localStore([agentNodeFixture])
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let signal: AbortSignal | undefined
  const connection = new CollaborationConnection({
    store, settings: new CollaborationSettingsService(settingsHost()), outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request, options) => {
      signal = options?.signal
      await gate
      return { protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId,
        limit: 250, projects: [projectFixture], observedAt: TEST_LATER_TIMESTAMP }
    }),
    agentCloudRuntime: createTestAgentCloudRuntime({}), inboxHandler: { handle: async () => undefined }
  })
  const refresh = connection.refreshDashboardsForPage()
  try {
    await drainMicrotasks()
    await connection.disconnect()
    await refresh
    assert.equal(signal?.aborted, true)
    release()
    await drainMicrotasks()
    assert.deepEqual(connection.cloudDashboards(), [])
    assert.deepEqual(store.snapshot().diagnostics, [], 'a prior connection cannot publish diagnostics into the next generation')
  } finally { release(); await connection.dispose() }
})

test('foreground Dashboard refreshes are single-flight and coalesce rapid triggers', async () => {
  const store = await localStore([agentNodeFixture])
  let listCalls = 0
  let releaseFirstList!: () => void
  const firstListGate = new Promise<void>((resolve) => { releaseFirstList = resolve })
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request) => {
      if (request.type === 'project.list') {
        listCalls += 1
        if (listCalls === 1) await firstListGate
        return {
          protocolVersion: '1.0',
          type: 'rest.project_page',
          requestId: request.requestId,
          limit: 250,
          projects: [projectFixture],
          observedAt: TEST_LATER_TIMESTAMP
        }
      }
      if (request.type === 'project.coordination.read') {
        return {
          protocolVersion: '1.0',
          type: 'rest.project_coordination',
          requestId: request.requestId,
          project: projectFixture,
          observedAt: TEST_LATER_TIMESTAMP,
          pages: [
            {
              collection: 'user_label_facts',
              limit: 250,
              items: [{
                schemaVersion: 1,
                type: 'project_user_label_fact',
                projectId: projectFixture.projectId,
                userId: TEST_IDS.userId,
                displayName: 'Project Owner',
                status: 'active',
                revision: 1,
                observedAt: TEST_LATER_TIMESTAMP
              }]
            },
            {
              collection: 'memberships',
              limit: 250,
              items: [{
                schemaVersion: 1,
                revision: 1,
                createdAt: TEST_LATER_TIMESTAMP,
                updatedAt: TEST_LATER_TIMESTAMP,
                type: 'project_membership',
                projectMembershipId: 'pmb_OwnerMembership0001',
                projectId: projectFixture.projectId,
                userId: TEST_IDS.userId,
                state: 'active',
                authorityEpoch: 1,
                activatedAt: TEST_LATER_TIMESTAMP,
                removalRequestedAt: null,
                removalRequestedByUserId: null,
                removedAt: null
              }]
            },
            {
              collection: 'agent_label_facts',
              limit: 250,
              items: [{
                schemaVersion: 1,
                type: 'project_agent_label_fact',
                projectId: projectFixture.projectId,
                agentId: TEST_IDS.agentId,
                ownerUserId: TEST_IDS.userId,
                deviceId: TEST_IDS.deviceId,
                displayName: 'Desktop Agent',
                nodeType: 'desktop',
                lifecycleStatus: 'active',
                revision: 1,
                observedAt: TEST_LATER_TIMESTAMP
              }]
            }
          ],
          finalSummary: null,
          dashboard: dashboardProjection(projectFixture)
        }
      }
      throw new Error(`Unexpected authenticated request ${request.type}`)
    }),
    agentCloudRuntime: createTestAgentCloudRuntime({}),
    inboxHandler: { handle: async () => undefined }
  })

  try {
    const refreshes = [
      connection.refreshDashboardsForPage(),
      connection.refreshDashboardsForPage(),
      connection.refreshDashboardsForPage()
    ]
    await waitForCondition(() => listCalls === 1)
    releaseFirstList()
    await Promise.all(refreshes)

    assert.equal(listCalls, 1, 'page triggers join the current read without queuing another')
    assert.deepEqual(
      connection.cloudDashboards().map(({ projectId }) => projectId),
      [projectFixture.projectId]
    )
  } finally {
    await connection.dispose()
  }
})

test('a failed foreground Dashboard refresh records the existing diagnostic and a later success clears it', async () => {
  const store = await localStore([agentNodeFixture])
  let fail = true
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request) => {
      if (request.type !== 'project.list') {
        throw new Error(`Unexpected authenticated request ${request.type}`)
      }
      if (fail) throw new Error('Dashboard read failed.')
      return {
        protocolVersion: '1.0',
        type: 'rest.project_page',
        requestId: request.requestId,
        limit: 250,
        projects: [],
        observedAt: TEST_LATER_TIMESTAMP
      }
    }),
    agentCloudRuntime: createTestAgentCloudRuntime({}),
    inboxHandler: { handle: async () => undefined }
  })

  try {
    await connection.refreshDashboardsForPage()
    await drainMicrotasks()
    assert.deepEqual(
      store.snapshot().diagnostics.map(({ code }) => code),
      ['collaboration.dashboard_sync_error']
    )

    fail = false
    await connection.refreshDashboardsForPage()
    await drainMicrotasks()
    assert.deepEqual(store.snapshot().diagnostics, [])
  } finally {
    await connection.dispose()
  }
})

function userTransport(
  baseUrl: string,
  execute: (request: RestRequest, options?: Readonly<{ signal?: AbortSignal }>) => Promise<RestResponse>
) {
  return defineAuthenticatedCloudTransport({
    status: () => ({
      state: 'ready',
      baseUrl,
      userId: TEST_IDS.userId,
      deviceId: TEST_IDS.deviceId,
      deviceRevision: 1
    }),
    execute: async (input, options) => {
      assert.equal(input.operationId, AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID)
      const request = restRequestSchema.parse(input.payload)
      return { contractVersion: 1, status: 200, body: await execute(request, options) as never }
    },
    stageObject: async () => { throw new Error('Object staging is unused.') },
    readObject: async () => { throw new Error('Object reads are unused.') }
  })
}
function unusedUserTransport() {
  return userTransport(BASE_URL, async () => { throw new Error('User transport is unused.') })
}

test('connect reuses the in-flight attempt while it is still connecting', async () => {
  const store = await localStore([agentNodeFixture])
  let heartbeatCalls = 0
  let outboxStarts = 0
  let releaseHeartbeat!: () => void
  const heartbeatGate = new Promise<void>((resolve) => { releaseHeartbeat = resolve })
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: {
      start: () => { outboxStarts += 1 },
      wake: () => undefined,
      stop: () => undefined
    } as unknown as DurableCloudOutbox,
    authenticatedCloudTransport: unusedUserTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        heartbeatCalls += 1
        await heartbeatGate
        return {
          protocolVersion: '1.0', type: 'rest.entity', requestId: request.requestId,
          entity: { ...agentNodeFixture, connectionStatus: 'online', revision: agentNodeFixture.revision + 1 }
        }
      },
      pullAgentInbox: async () => ({ messages: [], nextSequence: 0 })
    }),
    inboxHandler: { handle: async () => undefined }
  })

  try {
    const first = connection.connect()
    await waitForCondition(() => heartbeatCalls === 1)
    const second = connection.connect()
    assert.equal(second, first, 'a concurrent connect must join the in-flight attempt')

    releaseHeartbeat()
    await Promise.all([first, second])
    assert.equal(connection.state().state, 'connected')
    assert.equal(heartbeatCalls, 1)
    assert.equal(outboxStarts, 1)
  } finally {
    await connection.dispose()
  }
})

test('a late failure from a cancelled attempt cannot clear the current connection', async () => {
  const store = await localStore([agentNodeFixture])
  let heartbeatCalls = 0
  let releaseFirstHeartbeat!: () => void
  const firstHeartbeat = new Promise<void>((resolve) => { releaseFirstHeartbeat = resolve })
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: unusedUserTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        heartbeatCalls += 1
        if (heartbeatCalls === 1) {
          await firstHeartbeat
          throw new Error('The cancelled attempt failed late.')
        }
        return {
          protocolVersion: '1.0', type: 'rest.entity', requestId: request.requestId,
          entity: { ...agentNodeFixture, connectionStatus: 'online', revision: agentNodeFixture.revision + heartbeatCalls }
        }
      },
      pullAgentInbox: async () => ({ messages: [], nextSequence: 0 })
    }),
    inboxHandler: { handle: async () => undefined }
  })

  try {
    const cancelled = connection.connect()
    await waitForCondition(() => heartbeatCalls === 1)
    await connection.disconnect()

    const current = connection.connect()
    await waitForCondition(() => connection.state().state === 'connected')
    releaseFirstHeartbeat()

    await cancelled
    assert.equal(connection.state().state, 'connected')
    await current
    assert.equal(connection.state().state, 'connected')

    await connection.disconnect()
    assert.equal(connection.state().state, 'disconnected')
  } finally {
    await connection.dispose()
  }
})

test('disconnect cancels an in-flight connection attempt', async () => {
  const store = await localStore([agentNodeFixture])
  let heartbeatCalls = 0
  let releaseHeartbeat!: () => void
  const heartbeatGate = new Promise<void>((resolve) => { releaseHeartbeat = resolve })
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: unusedUserTransport(),
    agentCloudRuntime: createTestAgentCloudRuntime({
      authorityStatus: readyAuthority,
      execute: async (_agentId, request) => {
        heartbeatCalls += 1
        await heartbeatGate
        return {
          protocolVersion: '1.0', type: 'rest.entity', requestId: request.requestId,
          entity: { ...agentNodeFixture, connectionStatus: 'online', revision: agentNodeFixture.revision + 1 }
        }
      },
      pullAgentInbox: async () => ({ messages: [], nextSequence: 0 })
    }),
    inboxHandler: { handle: async () => undefined }
  })

  try {
    const pending = connection.connect()
    await waitForCondition(() => heartbeatCalls === 1)
    await connection.disconnect()
    assert.equal(connection.state().state, 'disconnected')

    releaseHeartbeat()
    await pending
    assert.equal(connection.state().state, 'disconnected')
    assert.equal(heartbeatCalls, 1)
  } finally {
    await connection.dispose()
  }
})

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
    providers: [{
      protocolVersion: '1.0',
      type: 'human_endpoint_provider_contract',
      provider: 'zulip',
      displayName: 'Zulip',
      capabilities: {
        textMessages: true,
        stableLocators: true,
        eventCursor: true,
        locatorRename: true,
        locatorMove: true,
        locatorDiscovery: true,
        identityChallenge: true,
        directMessages: true,
        managedContainers: false,
        privateContainerDiscovery: true,
        messageUpdates: true,
        messageActions: true
      },
      onboarding: {
        realmLabel: 'Zulip server URL',
        accountLabel: 'Zulip user ID',
        containerLabel: 'Stream',
        topicLabel: 'Topic'
      },
      limits: {
        maxTextLength: 10_000,
        maxLocatorDisplayLength: 200
      }
    }]
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
    schemaVersion: 4,
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

async function waitForCondition(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const expiresAt = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() >= expiresAt) throw new Error('Timed out waiting for test condition.')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function drainMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

function dashboardTestConnection(store: CollaborationLocalStore, read: () => Promise<void>) {
  return new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    outbox: lifecycleOutbox(),
    authenticatedCloudTransport: userTransport(BASE_URL, async (request) => {
      assert.equal(request.type, 'project.list')
      await read()
      return { protocolVersion: '1.0', type: 'rest.project_page', requestId: request.requestId, limit: 250, projects: [], observedAt: TEST_LATER_TIMESTAMP }
    }),
    agentCloudRuntime: createTestAgentCloudRuntime({}),
    inboxHandler: { handle: async () => undefined }
  })
}

test('commands during a page refresh queue one re-read that observes the command changes', async () => {
  const store = await localStore([agentNodeFixture])
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const observed: number[] = []
  let cloudRevision = 1
  const connection = dashboardTestConnection(store, async () => {
    observed.push(cloudRevision)
    if (observed.length === 1) await gate
  })
  try {
    const page = connection.refreshDashboardsForPage()
    await waitForCondition(() => observed.length === 1)
    cloudRevision = 2
    const command = connection.refreshDashboards()
    const secondCommand = connection.refreshDashboards()
    const joinedPage = connection.refreshDashboardsForPage()
    release()
    await Promise.all([page, command, secondCommand, joinedPage])
    assert.deepEqual(observed, [1, 2])
  } finally { release(); await connection.dispose() }
})

test('joining a command refresh records its failure once and awaits diagnostic persistence before recovery clears it', async () => {
  const initial = await localStore([agentNodeFixture])
  let releaseRead!: () => void
  let releaseWrite!: () => void
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
  const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
  let writes = 0
  let fail = true
  let reads = 0
  const store = new CollaborationLocalStore({
    read: async () => initial.snapshot(),
    write: async (state) => {
      if (state.diagnostics.some(({ code }) => code === 'collaboration.dashboard_sync_error')) {
        writes += 1
        await writeGate
      }
    }
  })
  await store.open()
  const connection = dashboardTestConnection(store, async () => {
    reads += 1
    if (fail) { await readGate; throw new Error('Joined Dashboard failure') }
  })
  try {
    const command = assert.rejects(connection.refreshDashboards(), /Joined Dashboard failure/u)
    await waitForCondition(() => reads === 1)
    let settled = false
    const page = connection.refreshDashboardsForPage().then(() => { settled = true })
    const secondPage = connection.refreshDashboardsForPage()
    releaseRead()
    await waitForCondition(() => writes === 1)
    assert.equal(settled, false, 'status must wait for the diagnostic write')
    releaseWrite()
    await Promise.all([command, page, secondPage])
    assert.equal(writes, 1, 'the shared refresh owns a single diagnostic')
    assert.deepEqual(store.snapshot().diagnostics.map(({ code }) => code), ['collaboration.dashboard_sync_error'])
    fail = false
    await connection.refreshDashboardsForPage()
    assert.deepEqual(store.snapshot().diagnostics, [])
    assert.equal(reads, 2)
  } finally { releaseRead(); releaseWrite(); await connection.dispose() }
})
