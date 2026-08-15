import assert from 'node:assert/strict'
import test from 'node:test'

import { WebSocket } from 'ws'

import {
  AuthenticationService,
  CollaborationService,
  CollaborationWebSocketHub,
  createCollaborationHttpServer
} from '../packages/collaboration-server/src/index.ts'
import {
  FakeClock,
  FakeCollaborationRepository
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
    type: 'pairing.begin',
    idempotencyKey: `idem_transport_pairing_${String(index).padStart(2, '0')}`,
    provider: 'fake-im',
    realmId: 'fake-realm',
    requestedDisplayName: `传输测试用户 ${index}`
  }
}

async function postCommand(baseUrl, body, headers = {}) {
  return fetch(`${baseUrl}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': body.idempotencyKey ?? '', ...headers },
    body: JSON.stringify(body)
  })
}

async function bindUser(service, slot = 'websocket') {
  const begun = await service.beginPairing({
    provider: 'fake-im',
    realmId: 'fake-realm',
    requestedDisplayName: `${slot} 测试用户`,
    idempotencyKey: `idem_${slot}_begin_user`
  })
  await service.verifyPairingFromProvider({
    provider: 'fake-im',
    realmId: 'fake-realm',
    providerUserId: `provider-${slot}-user`,
    providerEventId: `provider-${slot}-event`,
    challengeCode: begun.challengeCode,
    assurance: 'strong'
  })
  const redeemed = await service.redeemPairing({
    pollSecret: begun.pollSecret,
    idempotencyKey: `idem_${slot}_redeem_user`
  })
  return { userId: redeemed.userId, credential: redeemed.userCredential }
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

test('8.4 production HTTP boundary bounds command bodies, rate limits pairing and never echoes authorization material', async (t) => {
  const clock = new FakeClock()
  const repository = new FakeCollaborationRepository()
  const authentication = new AuthenticationService(repository, clock.now)
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

  const oversized = commandBody(90)
  oversized.requestedDisplayName = 'x'.repeat(1_200)
  const oversizedResponse = await postCommand(baseUrl, oversized)
  assert.equal(oversizedResponse.status, 413)
  const oversizedText = await oversizedResponse.text()
  assert.equal(oversizedText.includes('x'.repeat(64)), false)
  assert.equal(JSON.parse(oversizedText).error.code, 'payload_too_large')

  for (let index = 1; index <= 10; index += 1) {
    const response = await postCommand(baseUrl, commandBody(index))
    assert.equal(response.status, 200)
  }
  const limited = await postCommand(baseUrl, commandBody(11))
  assert.equal(limited.status, 429)
  const limitedBody = await limited.json()
  assert.equal(limitedBody.type, 'rest.error')
  assert.equal(limitedBody.error.code, 'rate_limited')

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
  const authentication = new AuthenticationService(repository, clock.now)
  const hub = new CollaborationWebSocketHub()
  const service = new CollaborationService({ repository, notifier: hub, now: clock.now })
  const participant = await bindUser(service)
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
    headers: { authorization: `${['Bear', 'er'].join('')} ${participant.credential}` }
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
  hub.notifyInboxAvailable({ kind: 'user', id: participant.userId }, 7)
  assert.deepEqual(await availabilityMessage, {
    protocolVersion: '1.0',
    type: 'inbox.available',
    recipientType: 'user',
    highestSequence: 7
  })

  const closeCode = closed(webSocket)
  webSocket.send('x'.repeat(8 * 1_024 + 1))
  assert.equal(await closeCode, 1009)

  const blocked = new WebSocket(`${webSocketUrl}/v1/events`, {
    origin: 'https://untrusted.invalid',
    headers: { authorization: `${['Bear', 'er'].join('')} ${participant.credential}` }
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

test('2.5 production HTTP owner transfer rotates the Agent credential once and audits old-owner denial', async (t) => {
  const clock = new FakeClock()
  const repository = new FakeCollaborationRepository()
  const authentication = new AuthenticationService(repository, clock.now)
  const service = new CollaborationService({ repository, now: clock.now })
  const a = await bindUser(service, 'transfer-a')
  const b = await bindUser(service, 'transfer-b')
  const actorA = await authentication.resolveBearer(a.credential)
  assert.equal(actorA.kind, 'user')
  const registered = await service.registerAgent(actorA, {
    installationId: 'ins_Transport0001',
    displayName: '待转移 Agent',
    nodeType: 'desktop',
    capabilities: ['agent-runtime'],
    idempotencyKey: 'idem_transport_register_agent'
  })
  const server = createCollaborationHttpServer({
    service,
    authentication,
    readiness: async () => true,
    now: clock.now,
    basePath: BASE_PATH
  })
  t.after(() => closeServer(server))
  const baseUrl = await listen(server)
  const transfer = {
    protocolVersion: '1.0',
    requestId: 'req_TransferAgent1',
    type: 'agent.owner.transfer',
    idempotencyKey: 'idem_transport_agent_transfer',
    agentId: registered.agent.agentId,
    targetUserId: b.userId,
    expectedRevision: registered.agent.revision
  }
  const authorization = `${['Bear', 'er'].join('')} ${a.credential}`
  const response = await postCommand(baseUrl, transfer, { authorization })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.type, 'agent.owner_transferred')
  assert.equal(body.agent.ownerUserId, b.userId)
  assert.equal(body.agent.credentialVersion, registered.agent.credentialGeneration + 1)
  const newDeviceActor = await authentication.resolveBearer(body.deviceCredential)
  assert.equal(newDeviceActor.userId, b.userId)
  assert.equal(newDeviceActor.agentId, registered.agent.agentId)
  await assert.rejects(() => authentication.resolveBearer(registered.deviceCredential), { code: 'credential_revoked' })

  const replay = await postCommand(baseUrl, transfer, { authorization })
  assert.equal(replay.status, 409)
  const replayText = await replay.text()
  assert.equal(replayText.includes(body.deviceCredential), false)

  const oldOwnerAttempt = await postCommand(baseUrl, {
    ...transfer,
    requestId: 'req_TransferAgent2',
    idempotencyKey: 'idem_transport_old_owner_retry',
    expectedRevision: body.agent.revision
  }, { authorization })
  assert.equal(oldOwnerAttempt.status, 403)
  assert.ok(repository.state.auditEvents.some((event) => (
    event.action === 'agent.owner.transfer' &&
    event.actorUserId === a.userId &&
    event.outcome === 'rejected' &&
    event.metadata.errorCode === 'permission_denied'
  )))
})
