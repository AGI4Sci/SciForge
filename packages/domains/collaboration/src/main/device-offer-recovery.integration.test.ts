import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'
import { deviceSchema, restRequestSchema, restResponseSchema, taskOfferSchema, type RestRequest } from '@sciforge/collaboration-contracts'
import {
  TEST_HASH, TEST_IDS, TEST_TIMESTAMP, agentNodeFixture, participantProfileFixture,
  projectFixture, taskFixture, userPrincipalFixture
} from '@sciforge/collaboration-contracts/testing'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  defineAuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { createIdentityAgentCloudRuntime, type IdentityAgentCloudRuntimeOptions } from '../../../identity-access/src/main/agent-cloud-runtime.js'
import { CloudIdentityRuntime } from '../../../identity-access/src/main/cloud-runtime.js'
import { cloudInstallationId } from '../../../identity-access/src/main/device-service.js'
import type { IdentityPrivateSecretRef } from '../../../identity-access/src/main/private-vault.js'
import { CollaborationConnection } from './connection.js'
import { DurableCloudOutbox } from './outbox.js'
import { CollaborationSettingsService } from './settings.js'
import { CollaborationLocalStore, type CollaborationLocalState } from './store.js'
import { CollaborationTaskAdapter } from './task-adapter.js'

const BASE_URL = 'https://offer-recovery.example.test'
const ISSUER = `${BASE_URL}/realms/SciForge`
const OFFER_ID = 'ofr_RecoveryOffer001'

test('real Device timeout cancels an in-flight Agent heartbeat without permanently failing a manual Offer', async () => {
  const fixture = await createFixture()
  try {
    await fixture.adapter.acceptOffer(fixture.offerPayload, TEST_IDS.agentId)
    await fixture.adapter.waitForIdle()
    assert.equal(fixture.store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')

    fixture.stallHeartbeat = true
    const connecting = fixture.connection.connect().catch((error: unknown) => error)
    await fixture.heartbeatStarted.promise
    fixture.deviceMode = 'timeout'
    const failedRefresh = await fixture.identity.refreshDevices()
    assert.equal(failedRefresh.device.state, 'error')
    await connecting
    assert.equal(fixture.heartbeatAborted, true, 'Identity must cancel the actual in-flight fetch')
    assert.equal(fixture.store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual',
      'temporary Device revalidation failure must not manufacture an Offer business terminal')
    assert.equal(fixture.permanentFences, 0)
    assert.equal(fixture.store.snapshot().taskRuns.length, 0)

    const sendsBeforeUnverified = fixture.commands.length
    await assert.rejects(fixture.agentRuntime.execute({ agentId: TEST_IDS.agentId, request: {
      protocolVersion: '1.0', type: 'task.get', requestId: 'req_UnverifiedRead001', taskId: TEST_IDS.taskId
    } }))
    assert.equal(fixture.commands.length, sendsBeforeUnverified, 'unverified Device cannot use saved Agent credentials')

    fixture.deviceMode = 'active'
    fixture.stallHeartbeat = false
    assert.equal((await fixture.identity.refreshDevices()).device.state, 'active')
    await waitUntil(() => fixture.connection.state().state === 'connected')
    await Promise.all([fixture.connection.connect(), fixture.connection.connect()])
    for (let reconnect = 0; reconnect < 3; reconnect += 1) {
      await fixture.connection.disconnect()
      await fixture.connection.connect()
    }
    await fixture.adapter.acceptOffer(fixture.offerPayload, TEST_IDS.agentId)
    await fixture.adapter.waitForIdle()
    assert.equal(fixture.connection.state().state, 'connected')
    assert.equal(fixture.store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')
    assert.equal(fixture.commands.some(({ type }) => type === 'task.offer.accept'), false)
    assert.equal(fixture.store.snapshot().taskRuns.length, 0)
    assert.deepEqual(fixture.invalidResponses, [])
    assert.equal(fixture.adapter.offerAvailability(OFFER_ID).canDismiss, true,
      JSON.stringify(fixture.store.snapshot().pendingTaskOffers[0]))
    await fixture.adapter.decideOffer(OFFER_ID, { decision: 'dismiss' })
    assert.equal(fixture.store.snapshot().pendingTaskOffers[0]?.state, 'dismissed')
  } finally {
    await fixture.close()
  }
})

test('real revalidation before a request is sent has the same recoverable authority classification', async () => {
  const fixture = await createFixture()
  try {
    await fixture.adapter.acceptOffer(fixture.offerPayload, TEST_IDS.agentId)
    await fixture.adapter.waitForIdle()
    fixture.deviceMode = 'timeout'
    await assert.rejects(fixture.connection.connect(), { code: 'authority_unverified' })
    assert.equal(fixture.commands.some(({ type }) => type === 'agent.heartbeat'), false)
    assert.equal(fixture.permanentFences, 0)
    assert.equal(fixture.temporarySuspensions, 1)
    assert.equal(fixture.store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')
  } finally {
    await fixture.close()
  }
})

for (const change of ['revoked', 'signed-out'] as const) {
  test(`real ${change} cancels in-flight authority and preserves the exact permanent fence boundary`, async () => {
    const fixture = await createFixture()
    try {
      await fixture.adapter.acceptOffer(fixture.offerPayload, TEST_IDS.agentId)
      await fixture.adapter.waitForIdle()
      fixture.stallHeartbeat = true
      const connecting = fixture.connection.connect().catch((error: unknown) => error)
      await fixture.heartbeatStarted.promise
      if (change === 'revoked') {
        fixture.deviceMode = 'revoked'
        assert.equal((await fixture.identity.refreshDevices()).device.state, 'revoked')
      } else {
        assert.equal((await fixture.identity.logout()).identity.state, 'signed-out')
      }
      const error = await connecting
      assert.equal((error as { code?: string }).code, 'agent_authority_invalid')
      assert.equal((error as { cloudCode?: string }).cloudCode,
        change === 'revoked' ? 'device_revoked' : 'identity_changed')
      assert.equal(fixture.heartbeatAborted, true)
      assert.equal(fixture.permanentFences, 1)
      assert.equal(fixture.temporarySuspensions, 0)
      assert.equal(fixture.store.snapshot().pendingTaskOffers[0]?.state,
        change === 'revoked' ? 'failed' : 'awaiting-manual')
      assert.equal(fixture.store.snapshot().taskRuns.length, 0)
      if (change === 'signed-out') {
        assert.equal(fixture.adapter.offerAvailability(OFFER_ID).canAccept, false)
        fixture.stallHeartbeat = false
        assert.equal((await fixture.restoreSession('original')).device.state, 'active')
        await fixture.connection.connect()
        await fixture.adapter.waitForIdle()
        assert.equal(fixture.adapter.offerAvailability(OFFER_ID).canAccept, true)
        assert.equal(fixture.commands.some(({ type }) => type === 'task.offer.accept'), false)
      } else {
        assert.ok(fixture.store.snapshot().pendingTaskOffers[0]?.authorityFencedAt)
      }
    } finally {
      await fixture.close()
    }
  })
}

test('restart during a real Device outage retains the original manual Offer and revalidates before recovery', async () => {
  const original = await createFixture()
  let persisted: CollaborationLocalState
  try {
    await original.adapter.acceptOffer(original.offerPayload, TEST_IDS.agentId)
    await original.adapter.waitForIdle()
    original.deviceMode = 'timeout'
    await assert.rejects(original.connection.connect(), { code: 'authority_unverified' })
    persisted = original.store.snapshot()
  } finally {
    await original.close()
  }
  const restarted = await createFixture({ persisted, deviceMode: 'timeout' })
  try {
    await assert.rejects(restarted.connection.connect(), { code: 'authority_unverified' })
    assert.equal(restarted.commands.length, 0)
    restarted.deviceMode = 'active'
    assert.equal((await restarted.identity.refreshDevices()).device.state, 'active')
    await restarted.connection.connect()
    await restarted.adapter.acceptOffer(restarted.offerPayload, TEST_IDS.agentId)
    await restarted.adapter.waitForIdle()
    assert.equal(restarted.store.snapshot().pendingTaskOffers.length, 1)
    assert.equal(restarted.store.snapshot().pendingTaskOffers[0]?.state, 'awaiting-manual')
    assert.deepEqual(restarted.invalidResponses, [])
    assert.equal(restarted.adapter.offerAvailability(OFFER_ID).canAccept, true,
      JSON.stringify(restarted.store.snapshot().pendingTaskOffers[0]))
    assert.equal(restarted.store.snapshot().taskRuns.length, 0)
    assert.equal(restarted.commands.some(({ type }) => type === 'task.offer.accept'), false)
  } finally {
    await restarted.close()
  }
})

test('an actual OIDC account switch cannot accept the previous User manual Offer', async () => {
  const fixture = await createFixture()
  try {
    await fixture.adapter.acceptOffer(fixture.offerPayload, TEST_IDS.agentId)
    await fixture.adapter.waitForIdle()
    fixture.stallHeartbeat = true
    const connecting = fixture.connection.connect().catch((error: unknown) => error)
    await fixture.heartbeatStarted.promise
    await fixture.identity.logout()
    await connecting
    const switched = await fixture.restoreSession('another')
    assert.equal(switched.identity.state, 'signed-in')
    if (switched.identity.state === 'signed-in') assert.equal(switched.identity.user.userId, TEST_IDS.secondUserId)
    fixture.adapter.wake()
    await fixture.adapter.waitForIdle()
    assert.equal(fixture.adapter.offerAvailability(OFFER_ID).canAccept, false)
    await assert.rejects(fixture.adapter.decideOffer(OFFER_ID, { decision: 'accept' }))
    assert.equal(fixture.commands.some(({ type }) => type === 'task.offer.accept'), false)
    assert.equal(fixture.store.snapshot().taskRuns.length, 0)
  } finally {
    await fixture.close()
  }
})

for (const type of ['task.offer.accept', 'project.coordination.read'] as const) {
  for (const change of ['timeout', 'signed-out'] as const) {
    test(`human transport cancels stalled ${type} on real Device ${change} and rejects a late success`, async () => {
      const fixture = await createFixture()
      try {
        fixture.stallHumanType = type
        const request = type === 'task.offer.accept' ? fixture.acceptRequest : {
          protocolVersion: '1.0' as const, requestId: 'req_HumanReadRecovery01', type,
          projectId: TEST_IDS.projectId, collections: [{ collection: 'offers' as const, limit: 250 }]
        }
        const outcome = fixture.transport.execute({ contractVersion: 1,
          operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID, payload: request
        }).catch((error: unknown) => error)
        await fixture.humanStarted.promise
        if (change === 'timeout') {
          fixture.deviceMode = 'timeout'
          await fixture.identity.refreshDevices()
          fixture.deviceMode = 'active'
          assert.equal((await fixture.identity.refreshDevices()).device.state, 'active')
        } else {
          assert.equal((await fixture.identity.logout()).identity.state, 'signed-out')
        }
        fixture.humanRelease.resolve()
        const error = await outcome
        assert.equal(fixture.humanAborted, true, 'actual User command AbortSignal must be cancelled')
        assert.equal((error as { code?: string }).code,
          change === 'timeout' ? 'authority_unverified' : 'identity_required')
      } finally {
        await fixture.close()
      }
    })
  }
}

test('human transport cancels response-body reads when Device verification is lost', async () => {
  const fixture = await createFixture()
  try {
    fixture.stallHumanType = 'task.offer.accept'
    fixture.stallHumanBody = true
    const outcome = fixture.transport.execute({ contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID, payload: fixture.acceptRequest
    }).catch((error: unknown) => error)
    await fixture.humanStarted.promise
    fixture.deviceMode = 'timeout'
    await fixture.identity.refreshDevices()
    const error = await outcome
    assert.equal(fixture.humanAborted, true)
    assert.equal((error as { code?: string }).code, 'authority_unverified')
  } finally {
    await fixture.close()
  }
})

test('human transport interruption preserves the exact accepted Outbox intent as an unknown outcome', async () => {
  const fixture = await createFixture()
  try {
    await fixture.adapter.acceptOffer(fixture.offerPayload, TEST_IDS.agentId)
    await fixture.adapter.waitForIdle()
    fixture.stallHumanType = 'task.offer.accept'
    await fixture.adapter.decideOffer(OFFER_ID, { decision: 'accept' })
    await fixture.humanStarted.promise
    const original = fixture.store.snapshot().outbox.find(({ kind }) => kind === 'task.offer-decision')
    assert.ok(original)
    fixture.deviceMode = 'timeout'
    await fixture.identity.refreshDevices()
    await fixture.outbox.waitForIdle()
    await fixture.adapter.waitForIdle()
    const saved = fixture.store.snapshot().outbox.find(({ idempotencyKey }) => idempotencyKey === original.idempotencyKey)
    assert.equal(fixture.humanAborted, true)
    assert.equal(saved?.failureReason, 'authority_unverified')
    assert.deepEqual(saved?.body, original.body)
    assert.equal(saved?.outboxId, original.outboxId)
    assert.equal(fixture.store.snapshot().pendingTaskOffers[0]?.state, 'claiming')
    assert.equal(fixture.commands.filter(({ type }) => type === 'task.offer.accept').length, 1)
    assert.equal(fixture.store.snapshot().taskRuns.length, 0)
  } finally {
    fixture.humanRelease.resolve()
    await fixture.close()
  }
})

async function createFixture(options: Readonly<{
  persisted?: CollaborationLocalState
  deviceMode?: 'active' | 'timeout'
}> = {}) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-offer-identity-'))
  const installationSeed = 'device-offer-identity-recovery'
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'offer-recovery-rsa', alg: 'RS256', use: 'sig' }
  const deviceKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' })
  const device = deviceSchema.parse({
    schemaVersion: 1, type: 'device', deviceId: TEST_IDS.deviceId, userId: TEST_IDS.userId,
    installationId: cloudInstallationId(installationSeed), displayName: 'Recovery Device',
    platform: { os: 'macos', arch: 'arm64', appVersion: '0.1.0', osVersion: 'test' },
    publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig', kid: 'recovery-device-key', x: deviceKey.x },
    capabilitySummary: ['analysis'], status: 'active', revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP
  })
  const offer = taskOfferSchema.parse({
    schemaVersion: 1, type: 'task_offer', taskOfferId: OFFER_ID, projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId, executionId: null, workerUserId: TEST_IDS.userId,
    offeredByCoordinatorAgentId: TEST_IDS.agentId, contractRevision: 1, contractDigest: TEST_HASH,
    state: 'pending', reassignmentTaskRevision: null, offeredAt: TEST_TIMESTAMP,
    expiresAt: '2099-01-01T00:00:00.000Z', respondedAt: null, revision: 1,
    createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP
  })
  const fixture = {
    deviceMode: (options.deviceMode ?? 'active') as 'active' | 'timeout' | 'revoked', stallHeartbeat: false,
    heartbeatStarted: deferred<void>(), heartbeatAborted: false, permanentFences: 0,
    temporarySuspensions: 0,
    invalidResponses: [] as string[],
    stallHumanType: null as 'task.offer.accept' | 'project.coordination.read' | null,
    stallHumanBody: false, humanStarted: deferred<void>(), humanRelease: deferred<void>(), humanAborted: false,
    actor: 'original' as 'original' | 'another',
    commands: [] as RestRequest[]
  }
  const values = new Map<string, string>([
    ['oidc-session:', JSON.stringify({ version: 1, issuer: ISSUER, clientId: 'sciforge-desktop', refreshToken: 'test-refresh-token' })],
    [`agent-credential:${TEST_IDS.agentId}`, JSON.stringify({ version: 1, agentId: TEST_IDS.agentId,
      userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId, generation: 1, authority: `agent.${'A'.repeat(32)}` })]
  ])
  const key = (ref: IdentityPrivateSecretRef) => `${ref.kind}:${'agentId' in ref ? ref.agentId : ''}`
  const vault = {
    has: async (ref: IdentityPrivateSecretRef) => values.has(key(ref)),
    read: async (ref: IdentityPrivateSecretRef) => values.get(key(ref)) ?? null,
    write: async (ref: IdentityPrivateSecretRef, value: string) => { values.set(key(ref), value) },
    remove: async (ref: IdentityPrivateSecretRef) => { values.delete(key(ref)) }
  }
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  const token = (aud: string) => {
    const now = Math.floor(Date.now() / 1_000)
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const unsigned = `${encode({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })}.${encode({ iss: ISSUER,
      sub: fixture.actor === 'original' ? 'recovery-oidc-user' : 'another-oidc-user',
      aud, azp: 'sciforge-desktop', exp: now + 300, iat: now, nbf: now, auth_time: now })}`
    return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), pair.privateKey).toString('base64url')}`
  }
  const fetchImpl: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname
    if (path.endsWith('/.well-known/openid-configuration')) return json({ issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/certs` })
    if (path.endsWith('/certs')) return json({ keys: [jwk] })
    if (path.endsWith('/token')) return json({ access_token: token('sciforge-cloud-api'),
      id_token: token('sciforge-desktop'), refresh_token: 'test-refresh-token-rotated' })
    if (path === '/v1/me') return json({ schemaVersion: 1, type: 'me',
      userId: fixture.actor === 'original' ? TEST_IDS.userId : TEST_IDS.secondUserId,
      displayName: 'Recovery User', status: 'active',
      oidcIdentityId: fixture.actor === 'original' ? 'oid_RecoveryIdent001' : 'oid_RecoveryIdent002', issuer: ISSUER,
      revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP })
    if (path === '/v1/me/devices') {
      if (fixture.deviceMode === 'timeout') throw new DOMException('Controlled external Device deadline', 'TimeoutError')
      return json({ devices: [{ ...device, status: fixture.deviceMode,
        ...(fixture.actor === 'another' ? { userId: TEST_IDS.secondUserId, deviceId: 'dev_AnotherDevice001' } : {}),
        ...(fixture.deviceMode === 'revoked' ? { revision: 2, revokedAt: TEST_TIMESTAMP } : {}) }] })
    }
    assert.equal(path, '/v1/commands')
    const request = restRequestSchema.parse(JSON.parse(String(init?.body)))
    fixture.commands.push(request)
    const envelope = { protocolVersion: '1.0', requestId: request.requestId }
    if (request.type === fixture.stallHumanType) {
      const response = json({ ...envelope, type: 'rest.entity', entity: taskFixture })
      if (fixture.stallHumanBody) {
        return new Response(new ReadableStream<Uint8Array>({ start: (controller) => {
          init?.signal?.addEventListener('abort', () => {
            fixture.humanAborted = true
            controller.error(init.signal?.reason)
          }, { once: true })
          fixture.humanStarted.resolve()
        } }), { headers: { 'content-type': 'application/json' } })
      }
      init?.signal?.addEventListener('abort', () => { fixture.humanAborted = true }, { once: true })
      fixture.humanStarted.resolve()
      // Deliberately return a normal body after cancellation: restoration of
      // the same User/Device must not validate this former permission lease.
      await fixture.humanRelease.promise
      return response
    }
    if (request.type === 'endpoint.catalog.get') return json({ ...envelope, type: 'endpoint.catalog', providers: [] })
    if (request.type === 'agent.ensure') return json({ ...envelope, type: 'agent.ensured', agent: agentNodeFixture })
    if (request.type === 'agent.heartbeat') {
      if (fixture.stallHeartbeat) {
        fixture.heartbeatStarted.resolve()
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            fixture.heartbeatAborted = true
            reject(init.signal?.reason)
          }, { once: true })
        })
      }
      return json({ ...envelope, type: 'rest.entity', entity: agentNodeFixture })
    }
    if (request.type === 'inbox.pull') return json({ ...envelope, type: 'rest.inbox_page', messages: [], nextSequence: 0 })
    const task = { ...taskFixture, contractRevision: 1, contractDigest: TEST_HASH }
    if (request.type === 'task.get') return json({ ...envelope, type: 'rest.entity', entity: task })
    if (request.type === 'project.coordination.read') {
      const parsed = restResponseSchema.safeParse({ ...envelope, type: 'rest.project_coordination',
      project: projectFixture, finalSummary: null,
      pages: request.collections.map(({ collection, limit }) => ({ collection, limit,
        items: collection === 'tasks' ? [task] : collection === 'offers' ? [offer] :
          collection === 'task_authorities' ? ['text_tasks', 'file_tasks'].map((scope, index) => ({
            schemaVersion: 1, type: 'task_authority', taskAuthorityId: `tau_RecoveryAuth00${index}`,
            projectId: TEST_IDS.projectId, userId: TEST_IDS.userId, scope, state: 'eligible', authorityEpoch: 1,
            reason: null, effectiveAt: TEST_TIMESTAMP, revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP
          })) :
          collection === 'memberships' ? [{ schemaVersion: 1, type: 'project_membership', projectMembershipId: 'pmb_RecoveryMember1',
        projectId: TEST_IDS.projectId, userId: TEST_IDS.userId, state: 'active', authorityEpoch: 1,
        activatedAt: TEST_TIMESTAMP, removalRequestedAt: null, removalRequestedByUserId: null,
        removedAt: null, revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP }] : [] })),
      observedAt: new Date().toISOString() })
      if (!parsed.success) { fixture.invalidResponses.push(parsed.error.message); throw parsed.error }
      return json(parsed.data)
    }
    if (request.type === 'participant.get') return json({ ...envelope, type: 'participant.snapshot',
      user: userPrincipalFixture, participant: participantProfileFixture, humanEndpoints: [], agents: [agentNodeFixture] })
    if (request.type === 'project.list') return json({ ...envelope, type: 'rest.project_page', projects: [], limit: 250,
      observedAt: new Date().toISOString() })
    throw new Error(`Unexpected external command ${request.type}`)
  }
  let invalidate: Parameters<NonNullable<IdentityAgentCloudRuntimeOptions['bindAuthorityInvalidator']>>[0] = () => undefined
  const identity = await CloudIdentityRuntime.create({ userDataDir, appRoot: userDataDir,
    installationId: installationSeed, privateVault: vault, fetchImpl, appVersion: '0.1.0',
    environment: { SCIFORGE_OIDC_ISSUER: ISSUER, SCIFORGE_CLOUD_BASE_URL: BASE_URL },
    externalNavigation: { issueTarget: () => { throw new Error('No interactive login expected') } } as never,
    onAuthorityInvalidated: (reason) => invalidate(reason) })
  const initialized = await identity.initialize()
  assert.equal(initialized.device.state, options.deviceMode === 'timeout' ? 'error' : 'active', JSON.stringify(initialized))
  const agentRuntime = createIdentityAgentCloudRuntime({ getRuntime: () => identity, vault, fetchImpl,
    getRuntimeReadiness: async () => ({ state: 'unavailable', reason: 'No execution before manual acceptance' }),
    bindAuthorityInvalidator: (bound) => { invalidate = bound },
    webSocketFactory: () => {
      const socket = new EventEmitter() as WebSocket
      Object.assign(socket, { readyState: WebSocket.OPEN, close: () => {
        Object.assign(socket, { readyState: WebSocket.CLOSED })
        socket.emit('close')
      } })
      queueMicrotask(() => socket.emit('open'))
      return socket
    } })
  const transport = defineAuthenticatedCloudTransport({
    status: () => identity.authenticatedCloudTransportStatus(),
    execute: (request, options) => identity.executeAuthenticatedCloud(request, options),
    readObject: (input, options) => identity.readAuthenticatedCloudObject(input, options),
    stageObject: (input, options) => identity.stageAuthenticatedCloudObject(input, options)
  })
  const store = new CollaborationLocalStore({ read: async () => options.persisted, write: async () => undefined })
  await store.open()
  await store.transact((draft) => { draft.agents = [agentNodeFixture] })
  const outbox = new DurableCloudOutbox({ store, agentCloudRuntime: agentRuntime,
    authenticatedCloudTransport: transport, localAgentId: () => TEST_IDS.agentId })
  let adapter!: CollaborationTaskAdapter
  const connection = new CollaborationConnection({ store, outbox, agentCloudRuntime: agentRuntime,
    authenticatedCloudTransport: transport,
    settings: new CollaborationSettingsService({ read: async () => ({ revision: 0, value: null }) } as never),
    inboxHandler: { handle: (message) => adapter.handleInbox(message) },
    afterHeartbeat: () => adapter.wake(),
    onAuthorityUnverified: async (agentId, reason) => {
      fixture.temporarySuspensions += 1
      await adapter.suspendLocalAgent(agentId, reason)
    },
    onAuthorityLost: async (agentId, reason, cause) => {
      fixture.permanentFences += 1
      await adapter.fenceLocalAgent(agentId, reason, cause)
    } })
  adapter = new CollaborationTaskAdapter({ store, outbox, connection, authenticatedCloudTransport: transport,
    localAgentId: () => TEST_IDS.agentId, workspaceRootForExecution: () => userDataDir,
    agentExecution: { run: () => { throw new Error('Manual Offer must never execute') } } as never,
    humanActions: {} as never, signing: {} as never })
  return Object.assign(fixture, { identity, agentRuntime, transport, outbox, store, adapter, connection,
    restoreSession: async (actor: 'original' | 'another') => {
      fixture.actor = actor
      await vault.write({ kind: 'oidc-session' }, JSON.stringify({ version: 1, issuer: ISSUER,
        clientId: 'sciforge-desktop', refreshToken: 'test-refresh-token-restored' }))
      return identity.initialize()
    },
    acceptRequest: restRequestSchema.parse({ protocolVersion: '1.0', type: 'task.offer.accept',
      requestId: 'req_HumanAcceptRecover01', idempotencyKey: 'idem_HumanAcceptRecover01',
      taskOfferId: OFFER_ID, taskId: TEST_IDS.taskId, agentId: TEST_IDS.agentId, interaction: 'explicit_click',
      expectedTaskRevision: 1, expectedOfferRevision: 1, expectedContractRevision: 1, expectedContractDigest: TEST_HASH }),
    offerPayload: { protocolVersion: '1.0' as const, type: 'task.offered' as const, taskOfferId: OFFER_ID, taskId: TEST_IDS.taskId,
      projectId: TEST_IDS.projectId, workerUserId: TEST_IDS.userId, currentTaskRevision: 1,
      offerRevision: 1, contractRevision: 1, contractDigest: TEST_HASH },
    close: async () => { adapter.stop(); await connection.dispose(); identity.close(); await rm(userDataDir, { recursive: true, force: true }) }
  })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'The existing Connection recovery lifecycle must reconnect automatically')
    await delay(10)
  }
}
