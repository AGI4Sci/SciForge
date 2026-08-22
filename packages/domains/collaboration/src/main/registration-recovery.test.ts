import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  AgentNode,
  RestRequest,
  RestResponse,
  UserPrincipal
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
import type {
  DomainMainPackageSecretStoreHost,
  DomainMainPackageSettingsHost
} from '@sciforge/domain-sdk/package-storage'
import type { CollaborationAgentRegisterInput } from '../contract.js'
import {
  CloudProtocolError,
  type CollaborationCloudClient,
  type CollaborationCredential
} from './cloud-client.js'
import { CollaborationConnection } from './connection.js'
import type { DurableCloudOutbox } from './outbox.js'
import { CollaborationSettingsService } from './settings.js'
import {
  CollaborationLocalStore,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'

const USER_CREDENTIAL = 'u'.repeat(32)
const BASE_URL = 'https://collaboration.example.test'
const DEFAULT_INPUT: CollaborationAgentRegisterInput = {
  displayName: 'Desktop',
  nodeType: 'desktop',
  capabilities: ['workspace.read', 'agent.execute']
}

test('registration idempotency is stable for the same normalized intent and isolated for every field', async () => {
  const baseline = await captureRegistrationKey(DEFAULT_INPUT)
  const repeated = await captureRegistrationKey({ ...DEFAULT_INPUT })
  const normalized = await captureRegistrationKey({
    ...DEFAULT_INPUT,
    displayName: '  Desktop  ',
    capabilities: ['agent.execute', 'workspace.read']
  })

  assert.equal(repeated, baseline)
  assert.equal(normalized, baseline)
  assert.notEqual(await captureRegistrationKey({ ...DEFAULT_INPUT, displayName: 'Desktop Two' }), baseline)
  assert.notEqual(await captureRegistrationKey({ ...DEFAULT_INPUT, nodeType: 'server' }), baseline)
  assert.notEqual(await captureRegistrationKey({
    ...DEFAULT_INPUT,
    capabilities: ['workspace.read', 'agent.execute', 'project.read']
  }), baseline)
  assert.notEqual(await captureRegistrationKey(DEFAULT_INPUT, {
    ...userPrincipalFixture,
    userId: 'usr_ownerchange000000000000000000000001'
  }), baseline)
  assert.notEqual(await captureRegistrationKey(DEFAULT_INPUT, userPrincipalFixture,
    'ins_installchange000000000000000000001'), baseline)
})

test('register commit followed by temporary secret-store failure recovers through credential rotation', async () => {
  const server = new RegistrationServerModel()
  const secrets = new TemporarySecretStore([['user-credential', USER_CREDENTIAL]])
  const backend = new MemoryBackend(initialState())
  const settings = settingsHost()
  const first = await createConfiguredConnection(server, backend, secrets, settings)
  secrets.failNextWrite('device-credential')

  await assert.rejects(first.connection.registerAgent(DEFAULT_INPUT), /temporary secret write failure/u)
  assert.equal(server.agentCount, 1)
  assert.equal(await secrets.read('device-credential'), null)
  await first.connection.dispose()

  const restarted = await createActivatedConnection(server, backend, secrets, settings)
  assert.equal(restarted.connection.state().state, 'disconnected')
  assert.equal(server.rotateCount, 0)
  await restarted.connection.dispose()

  const recovery = await createConfiguredConnection(server, backend, secrets, settings)
  const recovered = await recovery.connection.registerAgent(DEFAULT_INPUT)

  assert.equal(recovered.agentId, server.agent?.agentId)
  assert.equal(server.agentCount, 1)
  assert.equal(server.rotateCount, 1)
  assert.equal(await secrets.read('device-credential'), server.currentDeviceCredential)
  assert.equal(recovery.connection.state().state, 'connected')
  await recovery.connection.dispose()
})

test('a lost register response converges on the existing Agent without duplicate registration', async () => {
  const server = new RegistrationServerModel()
  server.dropNextRegisterResponse = true
  const secrets = new TemporarySecretStore([['user-credential', USER_CREDENTIAL]])
  const backend = new MemoryBackend(initialState())
  const settings = settingsHost()
  const first = await createConfiguredConnection(server, backend, secrets, settings)

  await assert.rejects(first.connection.registerAgent(DEFAULT_INPUT), /register response lost/u)
  assert.equal(server.agentCount, 1)
  assert.equal(await secrets.read('device-credential'), null)
  await first.connection.dispose()

  const second = await createConfiguredConnection(server, backend, secrets, settings)
  await second.connection.registerAgent(DEFAULT_INPUT)

  assert.equal(server.agentCount, 1)
  assert.equal(server.registerAttempts, 2)
  assert.equal(server.rotateCount, 1)
  assert.equal(second.connection.state().state, 'connected')
  await second.connection.dispose()
})

test('rotate commit followed by secret-store failure rotates again and eventually converges', async () => {
  const server = new RegistrationServerModel()
  server.seedAgent(DEFAULT_INPUT)
  const secrets = new TemporarySecretStore([['user-credential', USER_CREDENTIAL]])
  const backend = new MemoryBackend(initialState())
  const settings = settingsHost()
  const first = await createConfiguredConnection(server, backend, secrets, settings)
  secrets.failNextWrite('device-credential')

  await assert.rejects(first.connection.registerAgent(DEFAULT_INPUT), /temporary secret write failure/u)
  assert.equal(server.rotateCount, 1)
  assert.equal(await secrets.read('device-credential'), null)
  await first.connection.dispose()

  const second = await createConfiguredConnection(server, backend, secrets, settings)
  await second.connection.registerAgent(DEFAULT_INPUT)

  assert.equal(server.agentCount, 1)
  assert.equal(server.rotateCount, 2)
  assert.equal(await secrets.read('device-credential'), server.currentDeviceCredential)
  assert.equal(second.connection.state().state, 'connected')
  await second.connection.dispose()
})

test('a lost rotate response is recovered by a later rotation without creating an Agent', async () => {
  const server = new RegistrationServerModel()
  server.seedAgent(DEFAULT_INPUT)
  server.dropNextRotateResponse = true
  const secrets = new TemporarySecretStore([['user-credential', USER_CREDENTIAL]])
  const backend = new MemoryBackend(initialState())
  const settings = settingsHost()
  const first = await createConfiguredConnection(server, backend, secrets, settings)

  await assert.rejects(first.connection.registerAgent(DEFAULT_INPUT), /rotate response lost/u)
  assert.equal(server.agentCount, 1)
  assert.equal(server.rotateCount, 1)
  await first.connection.dispose()

  const second = await createConfiguredConnection(server, backend, secrets, settings)
  await second.connection.registerAgent(DEFAULT_INPUT)

  assert.equal(server.agentCount, 1)
  assert.equal(server.rotateCount, 2)
  assert.equal(await secrets.read('device-credential'), server.currentDeviceCredential)
  assert.equal(second.connection.state().state, 'connected')
  await second.connection.dispose()
})

test('restart repairs a state commit failure after the device credential was saved', async () => {
  const server = new RegistrationServerModel()
  const secrets = new TemporarySecretStore([['user-credential', USER_CREDENTIAL]])
  const backend = new MemoryBackend(initialState())
  const settings = settingsHost()
  const first = await createConfiguredConnection(server, backend, secrets, settings)
  backend.failNextWrite()

  await assert.rejects(first.connection.registerAgent(DEFAULT_INPUT), /temporary state write failure/u)
  assert.equal(await secrets.read('device-credential'), server.currentDeviceCredential)
  assert.equal(first.store.snapshot().agents.length, 0)
  await first.connection.dispose()

  const second = await createActivatedConnection(server, backend, secrets, settings)

  assert.equal(second.store.snapshot().agents.length, 1)
  assert.equal(second.store.snapshot().agents[0]?.agentId, server.agent?.agentId)
  assert.equal(second.connection.state().state, 'connected')
  assert.equal(server.rotateCount, 0)
  await second.connection.dispose()
})

test('restart reconnects after a crash-equivalent heartbeat failure following local persistence', async () => {
  const server = new RegistrationServerModel()
  server.failNextHeartbeat = true
  const secrets = new TemporarySecretStore([['user-credential', USER_CREDENTIAL]])
  const backend = new MemoryBackend(initialState())
  const settings = settingsHost()
  const first = await createConfiguredConnection(server, backend, secrets, settings)

  await assert.rejects(first.connection.registerAgent(DEFAULT_INPUT), /heartbeat interrupted/u)
  assert.equal(first.store.snapshot().agents.length, 1)
  assert.equal(await secrets.read('device-credential'), server.currentDeviceCredential)
  await first.connection.dispose()

  const second = await createActivatedConnection(server, backend, secrets, settings)

  assert.equal(second.connection.state().state, 'connected')
  assert.equal(server.agentCount, 1)
  assert.equal(server.rotateCount, 0)
  await second.connection.dispose()
})

test('credential recovery fails closed without the verified user credential', async () => {
  const server = new RegistrationServerModel()
  server.seedAgent(DEFAULT_INPUT)
  const secrets = new TemporarySecretStore([])
  const backend = new MemoryBackend(initialState())
  const configured = await createConfiguredConnection(server, backend, secrets, settingsHost())

  await assert.rejects(
    configured.connection.registerAgent(DEFAULT_INPUT),
    /Verified collaboration user credential is unavailable/u
  )

  assert.equal(server.registerAttempts, 0)
  assert.equal(server.rotateCount, 0)
  assert.equal(await secrets.read('device-credential'), null)
  await configured.connection.dispose()
})

test('credential recovery never rotates a revoked Agent', async () => {
  const server = new RegistrationServerModel()
  server.seedAgent(DEFAULT_INPUT)
  assert.ok(server.agent)
  server.agent = {
    ...server.agent,
    lifecycleStatus: 'revoked',
    connectionStatus: 'offline',
    revokedAt: TEST_LATER_TIMESTAMP
  }
  const secrets = new TemporarySecretStore([['user-credential', USER_CREDENTIAL]])
  const backend = new MemoryBackend(initialState())
  const configured = await createConfiguredConnection(server, backend, secrets, settingsHost())

  await assert.rejects(
    configured.connection.registerAgent(DEFAULT_INPUT),
    /could not find this installation/u
  )

  assert.equal(server.registerAttempts, 1)
  assert.equal(server.rotateCount, 0)
  assert.equal(await secrets.read('device-credential'), null)
  await configured.connection.dispose()
})

async function captureRegistrationKey(
  input: CollaborationAgentRegisterInput,
  user: UserPrincipal = userPrincipalFixture,
  installationId: string = TEST_IDS.installationId
): Promise<string> {
  const server = new RegistrationServerModel(user, installationId)
  const backend = new MemoryBackend(initialState(user))
  const secrets = new TemporarySecretStore([['user-credential', USER_CREDENTIAL]])
  const configured = await createConfiguredConnection(server, backend, secrets, settingsHost(installationId))
  await configured.connection.registerAgent(input)
  await configured.connection.dispose()
  const key = server.registrationKeys[0]
  assert.ok(key)
  return key
}

async function createConfiguredConnection(
  server: RegistrationServerModel,
  backend: MemoryBackend,
  secrets: TemporarySecretStore,
  settings: DomainMainPackageSettingsHost
) {
  const created = await createConnection(server, backend, secrets, settings)
  await created.connection.configure(BASE_URL)
  return created
}

async function createActivatedConnection(
  server: RegistrationServerModel,
  backend: MemoryBackend,
  secrets: TemporarySecretStore,
  settings: DomainMainPackageSettingsHost
) {
  const created = await createConnection(server, backend, secrets, settings)
  await created.connection.activate()
  return created
}

async function createConnection(
  server: RegistrationServerModel,
  backend: MemoryBackend,
  secrets: TemporarySecretStore,
  settings: DomainMainPackageSettingsHost
) {
  const store = new CollaborationLocalStore(backend)
  await store.open()
  const connection = new CollaborationConnection({
    store,
    settings: new CollaborationSettingsService(settings),
    packageSecrets: secrets,
    outbox: lifecycleOutbox(),
    createCloudClient: () => server.client,
    inboxHandler: { handle: async () => undefined },
    now: () => new Date(TEST_LATER_TIMESTAMP)
  })
  return { connection, store }
}

class RegistrationServerModel {
  readonly registrationKeys: string[] = []
  registerAttempts = 0
  rotateCount = 0
  agentCount = 0
  agent: AgentNode | null = null
  currentDeviceCredential: string | null = null
  dropNextRegisterResponse = false
  dropNextRotateResponse = false
  failNextHeartbeat = false

  constructor(
    private readonly user: UserPrincipal = userPrincipalFixture,
    private readonly installationId: string = TEST_IDS.installationId
  ) {}

  readonly client: CollaborationCloudClient = {
    execute: (request, credential) => this.execute(request, credential),
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

  seedAgent(input: CollaborationAgentRegisterInput): void {
    this.agent = this.agentFor(input)
    this.agentCount = 1
    this.currentDeviceCredential = this.credentialFor(0)
  }

  private async execute(request: RestRequest, credential?: CollaborationCredential): Promise<RestResponse> {
    if (request.type === 'endpoint.catalog.get') {
      return {
        protocolVersion: '1.0',
        type: 'endpoint.catalog',
        requestId: request.requestId,
        providers: []
      }
    }
    if (request.type === 'agent.register') {
      assert.equal(credential?.value, USER_CREDENTIAL)
      this.registerAttempts += 1
      this.registrationKeys.push(request.idempotencyKey)
      if (this.agent) {
        throw new CloudProtocolError('The one-time Agent credential was already returned.', 'idempotency_conflict')
      }
      this.agent = this.agentFor(request)
      this.agentCount = 1
      this.currentDeviceCredential = this.credentialFor(0)
      if (this.dropNextRegisterResponse) {
        this.dropNextRegisterResponse = false
        throw new CloudProtocolError('register response lost')
      }
      return {
        protocolVersion: '1.0',
        type: 'agent.registered',
        requestId: request.requestId,
        agent: this.agent,
        deviceCredential: this.currentDeviceCredential
      }
    }
    if (request.type === 'participant.get') {
      assert.equal(credential?.value, USER_CREDENTIAL)
      return {
        protocolVersion: '1.0',
        type: 'participant.snapshot',
        requestId: request.requestId,
        user: this.user,
        participant: {
          ...participantProfileFixture,
          userId: this.user.userId,
          primaryAgentId: this.agent?.agentId ?? null,
          status: this.agent ? 'active' : 'incomplete'
        },
        humanEndpoints: [{ ...humanEndpointBindingFixture, userId: this.user.userId }],
        agents: this.agent ? [this.agent] : []
      }
    }
    if (request.type === 'endpoint.locator.list') {
      assert.equal(credential?.value, USER_CREDENTIAL)
      return {
        protocolVersion: '1.0',
        type: 'endpoint.locator_page',
        requestId: request.requestId,
        locators: []
      }
    }
    if (request.type === 'agent.rotate_credential') {
      assert.equal(credential?.value, USER_CREDENTIAL)
      assert.equal(request.agentId, this.agent?.agentId)
      assert.equal(request.expectedRevision, this.agent?.revision)
      this.rotateCount += 1
      this.agent = {
        ...this.requireAgent(),
        credentialVersion: this.requireAgent().credentialVersion + 1,
        revision: this.requireAgent().revision + 1,
        updatedAt: TEST_LATER_TIMESTAMP
      }
      this.currentDeviceCredential = this.credentialFor(this.rotateCount)
      if (this.dropNextRotateResponse) {
        this.dropNextRotateResponse = false
        throw new CloudProtocolError('rotate response lost')
      }
      return {
        protocolVersion: '1.0',
        type: 'agent.credential_rotated',
        requestId: request.requestId,
        agent: this.agent,
        deviceCredential: this.currentDeviceCredential
      }
    }
    assert.equal(request.type, 'agent.heartbeat')
    assert.equal(credential?.value, this.currentDeviceCredential)
    if (this.failNextHeartbeat) {
      this.failNextHeartbeat = false
      throw new CloudProtocolError('heartbeat interrupted')
    }
    this.agent = {
      ...this.requireAgent(),
      connectionStatus: request.connectionStatus,
      revision: this.requireAgent().revision + 1,
      updatedAt: TEST_LATER_TIMESTAMP
    }
    return {
      protocolVersion: '1.0',
      type: 'rest.entity',
      requestId: request.requestId,
      entity: this.agent
    }
  }

  private agentFor(input: CollaborationAgentRegisterInput): AgentNode {
    return {
      ...agentNodeFixture,
      ownerUserId: this.user.userId,
      installationId: this.installationId,
      displayName: input.displayName.trim(),
      nodeType: input.nodeType,
      capabilities: [...input.capabilities].sort(),
      connectionStatus: 'offline'
    }
  }

  private credentialFor(generation: number): string {
    return `device-${String(generation).padStart(2, '0')}-${'x'.repeat(24)}`
  }

  private requireAgent(): AgentNode {
    assert.ok(this.agent)
    return this.agent
  }
}

class TemporarySecretStore implements DomainMainPackageSecretStoreHost {
  private readonly values: Map<string, string>
  private readonly failingWrites = new Map<string, number>()

  constructor(entries: ReadonlyArray<readonly [string, string]>) {
    this.values = new Map(entries)
  }

  failNextWrite(key: string): void {
    this.failingWrites.set(key, (this.failingWrites.get(key) ?? 0) + 1)
  }

  async has(key: string): Promise<boolean> {
    return this.values.has(key)
  }

  async read(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async write(key: string, value: string): Promise<void> {
    const remaining = this.failingWrites.get(key) ?? 0
    if (remaining > 0) {
      this.failingWrites.set(key, remaining - 1)
      throw new Error('temporary secret write failure')
    }
    this.values.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key)
  }
}

class MemoryBackend implements CollaborationStateBackend {
  private failWrites = 0

  constructor(private value: unknown) {}

  failNextWrite(): void {
    this.failWrites += 1
  }

  async read(): Promise<unknown> {
    return structuredClone(this.value)
  }

  async write(value: CollaborationLocalState): Promise<void> {
    if (this.failWrites > 0) {
      this.failWrites -= 1
      throw new Error('temporary state write failure')
    }
    this.value = structuredClone(value)
  }
}

function initialState(user: UserPrincipal = userPrincipalFixture): CollaborationLocalState {
  return {
    schemaVersion: 1,
    revision: 1,
    lastInboxSequence: 0,
    user,
    participant: {
      ...participantProfileFixture,
      userId: user.userId,
      primaryAgentId: null,
      status: 'incomplete'
    },
    endpoints: [{ ...humanEndpointBindingFixture, userId: user.userId }],
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
    diagnostics: []
  }
}

function settingsHost(installationId: string = TEST_IDS.installationId): DomainMainPackageSettingsHost {
  let revision = 1
  let value: DomainPackageJsonValue | null = {
    schemaVersion: 1,
    baseUrl: BASE_URL,
    installationId
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

function lifecycleOutbox(): DurableCloudOutbox {
  return {
    start: () => undefined,
    stop: () => undefined,
    wake: () => undefined
  } as unknown as DurableCloudOutbox
}
