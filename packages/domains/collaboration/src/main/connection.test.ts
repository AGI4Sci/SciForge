import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  agentNodeFixture,
  chineseProviderLocatorFixture,
  humanEndpointBindingFixture,
  participantProfileFixture,
  userPrincipalFixture
} from '@sciforge/collaboration-contracts/testing'
import type {
  DomainMainPackageSecretStoreHost,
  DomainMainPackageSettingsHost
} from '@sciforge/domain-sdk/package-storage'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type { DurableCloudOutbox } from './outbox.js'
import {
  CloudProtocolError,
  HttpCollaborationCloudClient,
  type CollaborationCloudClient
} from './cloud-client.js'
import { CollaborationConnection } from './connection.js'
import { CollaborationSettingsService } from './settings.js'
import {
  CollaborationLocalStore,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'

test('an Agent revocation immediately removes the device credential and stops local delivery', async () => {
  const store = new CollaborationLocalStore(new MemoryBackend({
    schemaVersion: 1,
    revision: 1,
    lastInboxSequence: 0,
    endpoints: [],
    endpointLocators: [],
    agents: [agentNodeFixture],
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
  const secrets = new Map([['device-credential', 'x'.repeat(32)]])
  const secretHost: DomainMainPackageSecretStoreHost = {
    has: async (key) => secrets.has(key),
    read: async (key) => secrets.get(key) ?? null,
    write: async (key, value) => { secrets.set(key, value) },
    remove: async (key) => { secrets.delete(key) }
  }
  let stopped = false
  const outbox = {
    stop: () => { stopped = true }
  } as unknown as DurableCloudOutbox
  const settingsHost: DomainMainPackageSettingsHost = {
    read: async () => ({
      revision: 1,
      value: {
        schemaVersion: 1,
        baseUrl: 'https://collaboration.example.test',
        installationId: TEST_IDS.installationId
      }
    }),
    write: async (value) => ({ revision: 2, value }),
    clear: async () => ({ revision: 2, value: null })
  }
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost),
    packageSecrets: secretHost,
    outbox,
    createCloudClient: () => { throw new Error('Cloud client is not used by revocation handling.') },
    inboxHandler: { handle: async () => undefined }
  })

  await connection.acceptAgentRevocation(TEST_IDS.agentId, TEST_LATER_TIMESTAMP)

  assert.equal(secrets.has('device-credential'), false)
  assert.equal(stopped, true)
  const agent = store.snapshot().agents[0]
  assert.equal(agent?.lifecycleStatus, 'revoked')
  assert.equal(agent?.connectionStatus, 'offline')
  assert.equal(agent?.revokedAt, TEST_LATER_TIMESTAMP)
  assert.equal(connection.state().state, 'error')
})

test('pairing exposes the complete bounded provider command but keeps the poll secret main-only', async () => {
  const store = new CollaborationLocalStore(new MemoryBackend({
    schemaVersion: 1,
    revision: 0,
    lastInboxSequence: 0,
    endpoints: [],
    endpointLocators: [],
    agents: [],
    projections: [],
    projects: [],
    tasks: [],
    taskRuns: [],
    queue: [],
    receipts: [],
    outbox: [],
    diagnostics: []
  }))
  const secrets = new Map<string, string>()
  const pollSecret = 'p'.repeat(32)
  const challengeId = `chl_${'c'.repeat(32)}`
  const challengeCode = 'z'.repeat(12)
  const cloudClient: CollaborationCloudClient = {
    execute: async (request) => {
      if (request.type === 'endpoint.catalog.get') {
        return {
          protocolVersion: '1.0',
          type: 'endpoint.catalog',
          requestId: request.requestId,
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
              managedContainers: false
            },
            onboarding: {
              realmLabel: 'Realm',
              accountLabel: 'Account',
              containerLabel: 'Stream',
              topicLabel: 'Topic'
            },
            limits: { maxTextLength: 10_000, maxLocatorDisplayLength: 200 }
          }]
        }
      }
      if (request.type === 'pairing.redeem') {
        return {
          protocolVersion: '1.0',
          type: 'pairing.pending',
          requestId: request.requestId,
          challengeId,
          retryAfterSeconds: 7
        }
      }
      assert.equal(request.type, 'pairing.begin')
      return {
        protocolVersion: '1.0',
        type: 'pairing.begun',
        requestId: request.requestId,
        challengeId,
        challengeCode,
        pollSecret,
        expiresAt: '2099-08-15T09:00:00.000Z'
      }
    },
    pullAgentInbox: async () => ({ messages: [], nextSequence: 0 }),
    observeAgentInbox: () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true as const, value: undefined })
      })
    })
  }
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService({
      read: async () => ({
        revision: 1,
        value: {
          schemaVersion: 1,
          baseUrl: 'https://collaboration.example.test',
          installationId: TEST_IDS.installationId
        }
      }),
      write: async (value) => ({ revision: 2, value }),
      clear: async () => ({ revision: 2, value: null })
    }),
    packageSecrets: {
      has: async (key) => secrets.has(key),
      read: async (key) => secrets.get(key) ?? null,
      write: async (key, value) => { secrets.set(key, value) },
      remove: async (key) => { secrets.delete(key) }
    },
    outbox: { stop: () => undefined } as unknown as DurableCloudOutbox,
    createCloudClient: () => cloudClient,
    inboxHandler: { handle: async () => undefined }
  })
  await store.open()
  await connection.activate()

  const result = await connection.startChallenge({
    providerKey: 'zulip',
    requestedDisplayName: 'Mobile endpoint',
    locator: { realmId: 'research-lab' }
  })

  assert.equal(result.pairingCode, `/bind SF1.${'c'.repeat(32)}.${challengeCode}`)
  assert.equal(result.pairingCode.length, 55)
  assert.match(result.instruction, /private message.*zulip.*bot/iu)
  assert.equal(JSON.stringify(result).includes(pollSecret), false)
  assert.equal(secrets.get('pairing-poll')?.includes(pollSecret), true)
  assert.deepEqual(await connection.pollChallenge({ challengeId }), {
    status: 'pending',
    expiresAt: '2099-08-15T09:00:00.000Z',
    retryAfterSeconds: 7
  })
})

test('first configuration loads the anonymous catalog and sends pairing idempotency in body and header', async () => {
  const store = new CollaborationLocalStore(new MemoryBackend({
    schemaVersion: 1,
    revision: 0,
    lastInboxSequence: 0,
    endpoints: [],
    endpointLocators: [],
    agents: [],
    projections: [],
    projects: [],
    tasks: [],
    taskRuns: [],
    queue: [],
    receipts: [],
    outbox: [],
    diagnostics: []
  }))
  let settingsRevision = 0
  let settingsValue: DomainPackageJsonValue | null = null
  const settingsHost: DomainMainPackageSettingsHost = {
    read: async () => ({ revision: settingsRevision, value: settingsValue }),
    write: async (value, expectedRevision) => {
      assert.equal(expectedRevision, settingsRevision)
      settingsRevision += 1
      settingsValue = value
      return { revision: settingsRevision, value }
    },
    clear: async (expectedRevision) => {
      assert.equal(expectedRevision, settingsRevision)
      settingsRevision += 1
      settingsValue = null
      return { revision: settingsRevision, value: null }
    }
  }
  const requests: Array<Readonly<{
    authorization?: string
    idempotencyKey?: string
    bodyIdempotencyKey?: string
    type: string
  }>> = []
  const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { type: string; requestId: string; idempotencyKey?: string }
    const headers = new Headers(init?.headers)
    requests.push({
      type: body.type,
      ...(headers.get('authorization') ? { authorization: headers.get('authorization')! } : {}),
      ...(headers.get('idempotency-key') ? { idempotencyKey: headers.get('idempotency-key')! } : {}),
      ...(body.idempotencyKey ? { bodyIdempotencyKey: body.idempotencyKey } : {})
    })
    if (body.type === 'endpoint.catalog.get') {
      return new Response(JSON.stringify({
        protocolVersion: '1.0',
        type: 'endpoint.catalog',
        requestId: body.requestId,
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
            managedContainers: false
          },
          onboarding: {
            realmLabel: 'Realm',
            accountLabel: 'Account',
            containerLabel: 'Stream',
            topicLabel: 'Topic'
          },
          limits: { maxTextLength: 10_000, maxLocatorDisplayLength: 200 }
        }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    assert.equal(body.type, 'pairing.begin')
    return new Response(JSON.stringify({
      protocolVersion: '1.0',
      type: 'pairing.begun',
      requestId: body.requestId,
      challengeId: `chl_${'a'.repeat(32)}`,
      challengeCode: 'b'.repeat(12),
      pollSecret: 'q'.repeat(32),
      expiresAt: '2026-08-15T09:00:00.000Z'
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost),
    packageSecrets: {
      has: async () => false,
      read: async () => null,
      write: async () => undefined,
      remove: async () => undefined
    },
    outbox: { stop: () => undefined } as unknown as DurableCloudOutbox,
    createCloudClient: (baseUrl) => new HttpCollaborationCloudClient({
      baseUrl,
      fetch: fetchImpl
    }),
    inboxHandler: { handle: async () => undefined }
  })

  await connection.configure('https://chat.sciforge.cn/collaboration')
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.type, 'endpoint.catalog.get')
  assert.equal(requests[0]?.authorization, undefined)
  assert.equal(requests[0]?.idempotencyKey, undefined)
  assert.equal(requests[0]?.bodyIdempotencyKey, undefined)
  await connection.startChallenge({
    providerKey: 'zulip',
    requestedDisplayName: 'Mobile endpoint',
    locator: { realmId: 'research-lab' }
  })

  assert.equal(requests.length, 2)
  assert.equal(requests[1]?.type, 'pairing.begin')
  assert.equal(requests[1]?.authorization, undefined)
  assert.match(requests[1]?.idempotencyKey ?? '', /^idem_pairing\.begin\./u)
  assert.equal(requests[1]?.idempotencyKey, requests[1]?.bodyIdempotencyKey)
})

test('registration refreshes the participant revision and primary Agent with the user credential before device connect', async () => {
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
  const store = new CollaborationLocalStore(new MemoryBackend({
    schemaVersion: 1,
    revision: 1,
    lastInboxSequence: 0,
    user: userPrincipalFixture,
    participant: initialParticipant,
    endpoints: [humanEndpointBindingFixture],
    endpointLocators: [],
    agents: [],
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
  const userCredential = 'u'.repeat(32)
  const deviceCredential = 'd'.repeat(32)
  const secrets = new Map([['user-credential', userCredential]])
  const credentialUse: Array<Readonly<{ type: string; value?: string }>> = []
  const registrationIdempotencyKeys: string[] = []
  const cloudClient = collaborationLifecycleClient({
    execute: async (request, credential) => {
      credentialUse.push({ type: request.type, ...(credential ? { value: credential.value } : {}) })
      if (request.type === 'endpoint.catalog.get') return endpointCatalogResponse(request.requestId)
      if (request.type === 'agent.register') {
        registrationIdempotencyKeys.push(request.idempotencyKey)
        return {
          protocolVersion: '1.0',
          type: 'agent.registered',
          requestId: request.requestId,
          agent: agentNodeFixture,
          deviceCredential
        }
      }
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
      assert.equal(request.type, 'agent.heartbeat')
      return {
        protocolVersion: '1.0',
        type: 'rest.entity',
        requestId: request.requestId,
        entity: {
          ...agentNodeFixture,
          connectionStatus: 'online',
          revision: agentNodeFixture.revision + 1,
          updatedAt: TEST_LATER_TIMESTAMP
        }
      }
    }
  })
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    packageSecrets: secretStore(secrets),
    outbox: lifecycleOutbox(),
    createCloudClient: () => cloudClient,
    inboxHandler: { handle: async () => undefined }
  })
  await connection.configure('https://collaboration.example.test')

  await connection.registerAgent({
    displayName: 'Desktop',
    nodeType: 'desktop',
    capabilities: []
  })

  const participant = store.snapshot().participant
  assert.equal(participant?.revision, 2)
  assert.equal(participant?.primaryAgentId, TEST_IDS.agentId)
  assert.equal(participant?.status, 'active')
  assert.equal(secrets.get('device-credential'), deviceCredential)
  assert.deepEqual(credentialUse.filter(({ type }) => type === 'agent.register'), [
    { type: 'agent.register', value: userCredential }
  ])
  assert.deepEqual(registrationIdempotencyKeys, [
    `idem_agent.register.${createHash('sha256')
      .update(JSON.stringify({
        installationId: TEST_IDS.installationId,
        ownerUserId: userPrincipalFixture.userId,
        displayName: 'Desktop',
        nodeType: 'desktop',
        capabilities: []
      }))
      .digest('hex')
      .slice(0, 48)}`
  ])
  assert.deepEqual(credentialUse.filter(({ type }) => type === 'participant.get'), [
    { type: 'participant.get', value: userCredential }
  ])
  assert.deepEqual(credentialUse.filter(({ type }) => type === 'agent.heartbeat'), [
    { type: 'agent.heartbeat', value: deviceCredential }
  ])
  await connection.dispose()
})

test('registration recovers an existing installation by rotating its one-time device credential', async () => {
  const store = new CollaborationLocalStore(new MemoryBackend({
    schemaVersion: 1,
    revision: 1,
    lastInboxSequence: 0,
    user: userPrincipalFixture,
    participant: participantProfileFixture,
    endpoints: [humanEndpointBindingFixture],
    endpointLocators: [],
    agents: [agentNodeFixture],
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
  const userCredential = 'u'.repeat(32)
  const staleDeviceCredential = 's'.repeat(32)
  const rotatedDeviceCredential = 'r'.repeat(32)
  const secrets = new Map([
    ['user-credential', userCredential],
    ['device-credential', staleDeviceCredential]
  ])
  const rotatedAgent = {
    ...agentNodeFixture,
    credentialVersion: agentNodeFixture.credentialVersion + 1,
    revision: agentNodeFixture.revision + 1,
    updatedAt: TEST_LATER_TIMESTAMP
  }
  const requestTypes: string[] = []
  const heartbeatCredentials: string[] = []
  let participantReads = 0
  const cloudClient = collaborationLifecycleClient({
    execute: async (request, credential) => {
      requestTypes.push(request.type)
      if (request.type === 'endpoint.catalog.get') return endpointCatalogResponse(request.requestId)
      if (request.type === 'agent.register') {
        assert.equal(credential?.value, userCredential)
        throw new CloudProtocolError(
          'The one-time Agent credential was already returned.',
          'idempotency_conflict'
        )
      }
      if (request.type === 'participant.get') {
        participantReads += 1
        assert.equal(credential?.value, userCredential)
        return {
          protocolVersion: '1.0',
          type: 'participant.snapshot',
          requestId: request.requestId,
          user: userPrincipalFixture,
          participant: participantProfileFixture,
          humanEndpoints: [humanEndpointBindingFixture],
          agents: [participantReads === 1 ? agentNodeFixture : rotatedAgent]
        }
      }
      if (request.type === 'agent.rotate_credential') {
        assert.equal(credential?.value, userCredential)
        assert.equal(request.agentId, agentNodeFixture.agentId)
        assert.equal(request.expectedRevision, agentNodeFixture.revision)
        return {
          protocolVersion: '1.0',
          type: 'agent.credential_rotated',
          requestId: request.requestId,
          agent: rotatedAgent,
          deviceCredential: rotatedDeviceCredential
        }
      }
      assert.equal(request.type, 'agent.heartbeat')
      assert.ok(credential)
      assert.ok(
        credential.value === staleDeviceCredential
        || credential.value === rotatedDeviceCredential
      )
      heartbeatCredentials.push(credential.value)
      const heartbeatAgent = credential.value === staleDeviceCredential
        ? agentNodeFixture
        : rotatedAgent
      return {
        protocolVersion: '1.0',
        type: 'rest.entity',
        requestId: request.requestId,
        entity: {
          ...heartbeatAgent,
          connectionStatus: 'online',
          revision: heartbeatAgent.revision + 1
        }
      }
    }
  })
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    packageSecrets: secretStore(secrets),
    outbox: lifecycleOutbox(),
    createCloudClient: () => cloudClient,
    inboxHandler: { handle: async () => undefined }
  })
  await connection.configure('https://collaboration.example.test')
  await connection.connect()

  const agent = await connection.registerAgent({
    displayName: 'Desktop',
    nodeType: 'desktop',
    capabilities: []
  })

  assert.equal(agent.agentId, agentNodeFixture.agentId)
  assert.equal(secrets.get('device-credential'), rotatedDeviceCredential)
  assert.deepEqual(requestTypes, [
    'endpoint.catalog.get',
    'agent.heartbeat',
    'agent.register',
    'participant.get',
    'agent.rotate_credential',
    'participant.get',
    'agent.heartbeat'
  ])
  assert.deepEqual(heartbeatCredentials, [staleDeviceCredential, rotatedDeviceCredential])
  await connection.dispose()
})

test('restart activation repairs participant state and atomically follows every locator page', async () => {
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
  const store = new CollaborationLocalStore(new MemoryBackend({
    schemaVersion: 1,
    revision: 1,
    lastInboxSequence: 0,
    user: userPrincipalFixture,
    participant: staleParticipant,
    endpoints: [humanEndpointBindingFixture],
    endpointLocators: [],
    agents: [agentNodeFixture],
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
  const userCredential = 'u'.repeat(32)
  const deviceCredential = 'd'.repeat(32)
  const cloudClient = collaborationLifecycleClient({
    execute: async (request, credential) => {
      if (request.type === 'endpoint.catalog.get') return endpointCatalogResponse(request.requestId)
      if (request.type === 'participant.get') {
        assert.equal(credential?.value, userCredential)
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
      if (request.type === 'endpoint.locator.list') {
        assert.equal(credential?.value, userCredential)
        return {
          protocolVersion: '1.0',
          type: 'endpoint.locator_page',
          requestId: request.requestId,
          locators: [request.cursor
            ? { ...chineseProviderLocatorFixture, topicId: 'topic-second', topicDisplayName: '第二项目' }
            : chineseProviderLocatorFixture],
          ...(request.cursor ? {} : { nextCursor: 'NTAw' })
        }
      }
      assert.equal(request.type, 'agent.heartbeat')
      assert.equal(credential?.value, deviceCredential)
      return {
        protocolVersion: '1.0',
        type: 'rest.entity',
        requestId: request.requestId,
        entity: {
          ...agentNodeFixture,
          connectionStatus: 'online',
          revision: agentNodeFixture.revision + 1,
          updatedAt: TEST_LATER_TIMESTAMP
        }
      }
    }
  })
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settingsHost()),
    packageSecrets: secretStore(new Map([
      ['user-credential', userCredential],
      ['device-credential', deviceCredential]
    ])),
    outbox: lifecycleOutbox(),
    createCloudClient: () => cloudClient,
    inboxHandler: { handle: async () => undefined }
  })

  await connection.activate()

  assert.equal(store.snapshot().participant?.revision, 2)
  assert.equal(store.snapshot().participant?.primaryAgentId, TEST_IDS.agentId)
  assert.deepEqual(store.snapshot().endpointLocators, [
    { humanEndpointId: TEST_IDS.humanEndpointId, locator: chineseProviderLocatorFixture },
    { humanEndpointId: TEST_IDS.humanEndpointId,
      locator: { ...chineseProviderLocatorFixture, topicId: 'topic-second', topicDisplayName: '第二项目' } }
  ])
  await connection.dispose()
})

function endpointCatalogResponse(requestId: string) {
  return {
    protocolVersion: '1.0' as const,
    type: 'endpoint.catalog' as const,
    requestId: requestId as `req_${string}`,
    providers: []
  }
}

function collaborationLifecycleClient(
  input: Pick<CollaborationCloudClient, 'execute'>
): CollaborationCloudClient {
  return {
    execute: input.execute,
    pullAgentInbox: async () => ({ messages: [], nextSequence: 0 }),
    observeAgentInbox: (_credential, signal) => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise((resolve) => {
          if (signal.aborted) {
            resolve({ done: true as const, value: undefined })
            return
          }
          signal.addEventListener('abort', () => {
            resolve({ done: true as const, value: undefined })
          }, { once: true })
        })
      })
    })
  }
}

function settingsHost(): DomainMainPackageSettingsHost {
  let revision = 1
  let value: DomainPackageJsonValue | null = {
    schemaVersion: 1,
    baseUrl: 'https://collaboration.example.test',
    installationId: TEST_IDS.installationId
  }
  return {
    read: async () => ({ revision, value }),
    write: async (next, expectedRevision) => {
      assert.equal(expectedRevision, revision)
      revision += 1
      value = next
      return { revision, value }
    },
    clear: async (expectedRevision) => {
      assert.equal(expectedRevision, revision)
      revision += 1
      value = null
      return { revision, value }
    }
  }
}

function secretStore(secrets: Map<string, string>): DomainMainPackageSecretStoreHost {
  return {
    has: async (key) => secrets.has(key),
    read: async (key) => secrets.get(key) ?? null,
    write: async (key, value) => { secrets.set(key, value) },
    remove: async (key) => { secrets.delete(key) }
  }
}

function lifecycleOutbox(): DurableCloudOutbox {
  return {
    start: () => undefined,
    stop: () => undefined
  } as unknown as DurableCloudOutbox
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: unknown) {}

  async read(): Promise<unknown> {
    return structuredClone(this.value)
  }

  async write(value: CollaborationLocalState): Promise<void> {
    this.value = structuredClone(value)
  }
}
