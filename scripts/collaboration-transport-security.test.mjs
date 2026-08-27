import assert from 'node:assert/strict'
import test from 'node:test'

import { WebSocket } from 'ws'

import {
  CollaborationService,
  CollaborationWebSocketHub,
  createCollaborationHttpServer
} from '../packages/collaboration-server/src/index.ts'
import {
  createAgentCredentialBootstrap,
  seedOidcUserDevice
} from '../packages/collaboration-server/src/test-fixtures/collaboration-identity.ts'
import {
  FakeClock,
  FakeCollaborationRepository,
  FakeCollaborationRequestActorResolver
} from '../test-fixtures/collaboration/fake-adapters.mjs'

const BASE_PATH = '/collaboration'

function invalidTestOnlyValue(label) {
  return ['INVALID', 'TEST', 'ONLY', label].join('_')
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}${BASE_PATH}`
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

function commandBody(index) {
  return {
    protocolVersion: '1.0',
    requestId: `req_Transport${String(index).padStart(5, '0')}`,
    type: 'endpoint.challenge.create',
    idempotencyKey: `idem_transport_endpoint_${String(index).padStart(2, '0')}`,
    expectedIdentity: {
      provider: 'fake-im',
      realmId: 'fake-realm',
      providerUserId: `transport-provider-user-${index}`
    }
  }
}

async function postCommand(baseUrl, body, headers = {}) {
  return fetch(`${baseUrl}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': body.idempotencyKey ?? '', ...headers },
    body: JSON.stringify(body)
  })
}

function oidcToken(slot) {
  return `header.${Buffer.from(`transport-${slot}`, 'utf8').toString('base64url')}.signature`
}

function oidcAuthentication(repository, clock, identities) {
  return new FakeCollaborationRequestActorResolver({
    repository,
    now: clock.now,
    oidcActors: identities
  })
}

function resolveToken(authentication, token) {
  return authentication.resolveRequestActor({ headers: { authorization: `Bearer ${token}` } })
}

async function seedTransportIdentity(repository, clock, slot) {
  const identity = await seedOidcUserDevice(repository, `${slot} 测试用户`, clock.now())
  return { ...identity, token: oidcToken(slot) }
}

function nextMessage(webSocket) {
  return new Promise((resolve, reject) => {
    webSocket.once('message', (data) => {
      try { resolve(JSON.parse(data.toString())) } catch (error) { reject(error) }
    })
    webSocket.once('error', reject)
  })
}

function opened(webSocket) {
  return new Promise((resolve, reject) => {
    webSocket.once('open', resolve)
    webSocket.once('error', reject)
  })
}

function closed(webSocket) {
  return new Promise((resolve) => webSocket.once('close', (code) => resolve(code)))
}

test('8.4 production HTTP boundary bounds OIDC-only commands and never echoes authorization material', async (t) => {
  const clock = new FakeClock()
  const repository = new FakeCollaborationRepository()
  const identity = await seedTransportIdentity(repository, clock, 'http')
  const authentication = oidcAuthentication(repository, clock, new Map([[identity.token, identity.user]]))
  const service = new CollaborationService({ repository, now: clock.now })
  const server = createCollaborationHttpServer({
    service,
    authentication,
    readiness: async () => true,
    maxBodyBytes: 1_024,
    now: clock.now,
    basePath: BASE_PATH
  })
  t.after(() => closeServer(server))
  const baseUrl = await listen(server)
  const authorization = { authorization: `${['Bear', 'er'].join('')} ${identity.token}` }

  const oversized = commandBody(90)
  oversized.expectedIdentity.providerUserId = 'x'.repeat(1_200)
  const oversizedResponse = await postCommand(baseUrl, oversized, authorization)
  assert.equal(oversizedResponse.status, 413)
  const oversizedText = await oversizedResponse.text()
  assert.equal(oversizedText.includes('x'.repeat(64)), false)
  assert.equal(JSON.parse(oversizedText).error.code, 'payload_too_large')

  const authenticated = await postCommand(baseUrl, commandBody(1), authorization)
  assert.equal(authenticated.status, 200)
  assert.equal((await authenticated.json()).type, 'endpoint.challenge.created')

  const unauthenticated = await postCommand(baseUrl, commandBody(2))
  assert.equal(unauthenticated.status, 401)
  assert.equal((await unauthenticated.json()).error.code, 'authentication_required')

  const authorizationMaterial = invalidTestOnlyValue('AUTHORIZATION')
  const protectedResponse = await postCommand(baseUrl, {
    protocolVersion: '1.0',
    requestId: 'req_TransportAuth1',
    type: 'user.get',
    userId: 'usr_TransportUsr1'
  }, { authorization: `${['Bear', 'er'].join('')} ${authorizationMaterial}` })
  assert.equal(protectedResponse.status, 401)
  assert.equal((await protectedResponse.text()).includes(authorizationMaterial), false)
})

test('8.4 production WebSocket boundary enforces origin, authenticated routing, bounded frames and minimal notifications', async (t) => {
  const clock = new FakeClock()
  const repository = new FakeCollaborationRepository()
  const identity = await seedTransportIdentity(repository, clock, 'websocket')
  const authentication = oidcAuthentication(repository, clock, new Map([[identity.token, identity.user]]))
  const hub = new CollaborationWebSocketHub()
  const service = new CollaborationService({ repository, notifier: hub, now: clock.now })
  const bootstrap = createAgentCredentialBootstrap()
  const registered = await service.registerAgent(identity.user, {
    deviceId: identity.deviceId,
    displayName: 'WebSocket Device Agent',
    nodeType: 'desktop',
    capabilities: ['agent-runtime'],
    credentialBootstrapPublicKey: bootstrap.publicKey,
    idempotencyKey: 'idem_websocket_agent_register'
  })
  const agentCredential = bootstrap.open(registered.sealedCredential)
  const server = createCollaborationHttpServer({
    service,
    authentication,
    readiness: async () => true,
    now: clock.now,
    basePath: BASE_PATH
  })
  hub.attach(server, {
    authentication,
    basePath: BASE_PATH,
    allowedOrigins: ['https://desktop.invalid'],
    now: clock.now
  })
  t.after(async () => {
    await hub.close()
    await closeServer(server)
  })
  const baseUrl = await listen(server)
  const webSocketUrl = baseUrl.replace(/^http:/u, 'ws:')

  const webSocket = new WebSocket(`${webSocketUrl}/v1/events`, {
    origin: 'https://desktop.invalid',
    headers: { authorization: `${['Bear', 'er'].join('')} ${agentCredential}` }
  })
  const readyMessage = nextMessage(webSocket)
  await opened(webSocket)
  assert.equal((await readyMessage).type, 'connection.ready')

  const pongMessage = nextMessage(webSocket)
  webSocket.send(JSON.stringify({
    protocolVersion: '1.0',
    type: 'connection.ping',
    nonce: 'bounded-ping',
    sentAt: clock.now().toISOString()
  }))
  const pong = await pongMessage
  assert.equal(pong.type, 'connection.pong')
  assert.equal(pong.nonce, 'bounded-ping')

  const availabilityMessage = nextMessage(webSocket)
  hub.notifyInboxAvailable({ kind: 'agent', id: registered.agent.agentId }, 7)
  assert.deepEqual(await availabilityMessage, {
    protocolVersion: '1.0',
    type: 'inbox.available',
    recipientType: 'agent',
    highestSequence: 7
  })

  const closeCode = closed(webSocket)
  webSocket.send('x'.repeat(8 * 1_024 + 1))
  assert.equal(await closeCode, 1009)

  const blocked = new WebSocket(`${webSocketUrl}/v1/events`, {
    origin: 'https://untrusted.invalid',
    headers: { authorization: `${['Bear', 'er'].join('')} ${agentCredential}` }
  })
  const blockedStatus = await new Promise((resolve) => {
    blocked.once('unexpected-response', (_request, response) => {
      response.resume()
      resolve(response.statusCode)
    })
    blocked.once('error', () => resolve(0))
  })
  assert.equal(blockedStatus, 403)
})

test('2.5 production HTTP keeps Agent credentials sealed, Device-bound and rotatable only by its OIDC User', async (t) => {
  const clock = new FakeClock()
  const repository = new FakeCollaborationRepository()
  const a = await seedTransportIdentity(repository, clock, 'agent-a')
  const b = await seedTransportIdentity(repository, clock, 'agent-b')
  const authentication = oidcAuthentication(repository, clock, new Map([
    [a.token, a.user],
    [b.token, b.user]
  ]))
  const service = new CollaborationService({ repository, now: clock.now })
  const server = createCollaborationHttpServer({
    service,
    authentication,
    readiness: async () => true,
    now: clock.now,
    basePath: BASE_PATH
  })
  t.after(() => closeServer(server))
  const baseUrl = await listen(server)
  const authorizationA = { authorization: `${['Bear', 'er'].join('')} ${a.token}` }
  const registrationBootstrap = createAgentCredentialBootstrap()
  const registration = {
    protocolVersion: '1.0',
    requestId: 'req_RegisterAgent001',
    type: 'agent.register',
    idempotencyKey: 'idem_transport_register_agent',
    deviceId: a.deviceId,
    displayName: 'Device-bound Agent',
    nodeType: 'desktop',
    capabilities: ['agent-runtime'],
    credentialBootstrapPublicKey: registrationBootstrap.publicKey
  }
  const response = await postCommand(baseUrl, registration, authorizationA)
  assert.equal(response.status, 200)
  const registrationText = await response.text()
  const registered = JSON.parse(registrationText)
  assert.equal(registered.type, 'agent.registered')
  assert.equal(registered.agent.ownerUserId, a.userId)
  assert.equal(registered.agent.deviceId, a.deviceId)
  const initialCredential = registrationBootstrap.open(registered.sealedCredential)
  assert.equal(registrationText.includes(initialCredential), false)
  const agentActor = await resolveToken(authentication, initialCredential)
  assert.equal(agentActor.userId, a.userId)
  assert.equal(agentActor.deviceId, a.deviceId)

  const replay = await postCommand(baseUrl, registration, authorizationA)
  assert.equal(replay.status, 409)
  const replayText = await replay.text()
  assert.equal(replayText.includes(initialCredential), false)
  assert.equal(replayText.includes(registered.sealedCredential.ciphertext), false)

  const rotationBootstrap = createAgentCredentialBootstrap()
  const rotation = {
    protocolVersion: '1.0',
    requestId: 'req_RotateAgent0001',
    type: 'agent.rotate_credential',
    idempotencyKey: 'idem_transport_rotate_agent',
    agentId: registered.agent.agentId,
    expectedRevision: registered.agent.revision,
    credentialBootstrapPublicKey: rotationBootstrap.publicKey
  }
  const rotatedResponse = await postCommand(baseUrl, rotation, authorizationA)
  assert.equal(rotatedResponse.status, 200)
  const rotatedText = await rotatedResponse.text()
  const rotated = JSON.parse(rotatedText)
  assert.equal(rotated.type, 'agent.credential_rotated')
  const rotatedCredential = rotationBootstrap.open(rotated.sealedCredential)
  assert.equal(rotatedText.includes(rotatedCredential), false)
  await assert.rejects(() => resolveToken(authentication, initialCredential), { code: 'credential_revoked' })
  assert.equal((await resolveToken(authentication, rotatedCredential)).deviceId, a.deviceId)

  const otherUserAttempt = await postCommand(baseUrl, {
    ...rotation,
    requestId: 'req_RotateAgent0002',
    idempotencyKey: 'idem_transport_other_user_rotate',
    expectedRevision: rotated.agent.revision,
    credentialBootstrapPublicKey: createAgentCredentialBootstrap().publicKey
  }, { authorization: `${['Bear', 'er'].join('')} ${b.token}` })
  assert.equal(otherUserAttempt.status, 403)
  assert.ok(repository.state.auditEvents.some((event) => (
    event.action === 'agent.credential.rotate' &&
    event.actorUserId === b.userId &&
    event.outcome === 'rejected' &&
    event.metadata.errorCode === 'permission_denied'
  )))
})
