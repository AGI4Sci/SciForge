import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import type { AgentActor, OidcUserActor } from './actor.js'
import { CollaborationWebSocketHub } from './websocket.js'

const actor: AgentActor = {
  kind: 'agent_device',
  actorKey: 'agent:agt_websocket_authority:test',
  userId: 'usr_websocket_authority',
  agentId: 'agt_websocket_authority',
  deviceId: 'dev_websocket_authority',
  credentialId: 'credential_websocket_authority',
  credentialGeneration: 1,
  assurance: 'device'
}

const otherActor: AgentActor = {
  ...actor,
  actorKey: 'agent:agt_websocket_other:test',
  agentId: 'agt_websocket_other',
  deviceId: 'dev_websocket_other',
  credentialId: 'credential_websocket_other'
}

const userActor: OidcUserActor = {
  kind: 'user',
  authentication: 'oidc',
  actorKey: 'oidc:oid_websocket_user',
  userId: actor.userId,
  identityId: 'oid_websocket_user',
  issuer: 'https://identity.sciforge.test',
  subject: 'websocket-user',
  authTime: 1_787_020_800,
  expiresAt: 1_787_024_400,
  assurance: 'verified'
}

const origin = 'https://desktop.sciforge.test'
const sentAt = '2026-08-26T04:00:00.000Z'

describe('Collaboration WSS authority fencing', () => {
  const cleanup: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanup.length > 0) await cleanup.pop()!()
  })

  it('immediately closes every existing Agent connection after authority revoke', async () => {
    const httpServer = createServer()
    const hub = new CollaborationWebSocketHub()
    hub.attach(httpServer, {
      authentication: { resolveRequestActor: async () => actor },
      allowedOrigins: [origin]
    })
    httpServer.listen(0, '127.0.0.1')
    await once(httpServer, 'listening')
    cleanup.push(async () => {
      await hub.close()
      if (httpServer.listening) await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    })
    const address = httpServer.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test address.')

    const client = new WebSocket(`ws://127.0.0.1:${address.port}/v1/events`, {
      origin
    })
    cleanup.push(async () => {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.terminate()
    })
    const ready = once(client, 'message')
    const closed = once(client, 'close')
    await once(client, 'open')
    const [readyData] = await ready
    expect(JSON.parse(readyData.toString())).toMatchObject({ type: 'connection.ready' })
    hub.disconnectAgentAuthority(actor.agentId)
    const [code, reason] = await closed
    expect(code).toBe(4003)
    expect(reason.toString()).toBe('Agent authority revoked')
  })

  it('rejects an untrusted browser Origin and authentication failure during the HTTP upgrade', async () => {
    const { hub, url } = await startHub(async (request) => {
      if (request.headers.authorization !== 'Bearer accepted-agent-credential') throw new Error('denied')
      return actor
    })

    const badOrigin = new WebSocket(url, {
      origin: 'https://attacker.invalid',
      headers: { authorization: 'Bearer accepted-agent-credential' }
    })
    expect(await unexpectedStatus(badOrigin)).toBe(403)

    const badCredential = new WebSocket(url, {
      origin,
      headers: { authorization: 'Bearer rejected-agent-credential' }
    })
    expect(await unexpectedStatus(badCredential)).toBe(401)
    expect(hub).toBeDefined()
  })

  it('delivers only an audience-scoped Inbox availability hint and refills no business payload over WSS', async () => {
    const { hub, url } = await startHub(async (request) => {
      if (request.headers.authorization === 'Bearer agent-a-credential') return actor
      if (request.headers.authorization === 'Bearer agent-b-credential') return otherActor
      if (request.headers.authorization === 'Bearer oidc-user-token') return userActor
      throw new Error('denied')
    })
    const agentA = openClient(url, 'agent-a-credential')
    const agentB = openClient(url, 'agent-b-credential')
    const user = openClient(url, 'oidc-user-token')
    await Promise.all([expectReady(agentA), expectReady(agentB), expectReady(user)])

    const audienceMessage = once(agentA, 'message')
    const otherNextMessage = once(agentB, 'message')
    const userNextMessage = once(user, 'message')
    hub.notifyInboxAvailable({ kind: 'agent', id: actor.agentId }, 17)
    agentB.send(JSON.stringify({ protocolVersion: '1.0', type: 'connection.ping',
      nonce: 'nonce_other_audience_0001', sentAt }))
    user.send(JSON.stringify({ protocolVersion: '1.0', type: 'connection.ping',
      nonce: 'nonce_user_audience_0001', sentAt }))

    const [data] = await audienceMessage
    expect(JSON.parse(data.toString())).toEqual({
      protocolVersion: '1.0',
      type: 'inbox.available',
      recipientType: 'agent',
      highestSequence: 17
    })
    const [otherData] = await otherNextMessage
    const [userData] = await userNextMessage
    expect(JSON.parse(otherData.toString())).toMatchObject({
      type: 'connection.pong', nonce: 'nonce_other_audience_0001'
    })
    expect(JSON.parse(userData.toString())).toMatchObject({
      type: 'connection.pong', nonce: 'nonce_user_audience_0001'
    })
  })

  it('accepts only bounded strict ping messages and uses stable safe close codes', async () => {
    const { url } = await startHub(async () => actor)

    const valid = openClient(url)
    await expectReady(valid)
    const pong = once(valid, 'message')
    valid.send(JSON.stringify({ protocolVersion: '1.0', type: 'connection.ping',
      nonce: 'nonce_ping_stage3_0001', sentAt }))
    const [pongData] = await pong
    expect(JSON.parse(pongData.toString())).toEqual({
      protocolVersion: '1.0', type: 'connection.pong', nonce: 'nonce_ping_stage3_0001', sentAt
    })

    await expectRejectedFrame(url, '{not-json', 1007, 'Invalid collaboration WebSocket message')
    await expectRejectedFrame(url, JSON.stringify({ protocolVersion: '1.0', type: 'connection.ready',
      connectionId: 'client-authored' }), 1007, 'Invalid collaboration WebSocket message')
    await expectRejectedFrame(url, Buffer.from('binary-client-message'), 1003, 'Text frames only')
    await expectRejectedFrame(url, JSON.stringify({ protocolVersion: '1.0', type: 'connection.ping',
      nonce: 'x'.repeat(9 * 1024) }), 1009, '')
  })

  async function startHub(
    resolveRequestActor: (request: import('node:http').IncomingMessage) => Promise<AgentActor | OidcUserActor>
  ): Promise<{ hub: CollaborationWebSocketHub; url: string }> {
    const httpServer = createServer()
    const hub = new CollaborationWebSocketHub()
    hub.attach(httpServer, {
      authentication: { resolveRequestActor },
      allowedOrigins: [origin],
      now: () => new Date(sentAt)
    })
    httpServer.listen(0, '127.0.0.1')
    await once(httpServer, 'listening')
    cleanup.push(async () => {
      await hub.close()
      if (httpServer.listening) await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    })
    return { hub, url: `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}/v1/events` }
  }

  function openClient(url: string, credential = 'accepted-agent-credential'): WebSocket {
    const client = new WebSocket(url, { origin, headers: { authorization: `Bearer ${credential}` } })
    cleanup.push(async () => {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.terminate()
    })
    return client
  }

  async function expectReady(client: WebSocket): Promise<void> {
    const ready = once(client, 'message')
    await once(client, 'open')
    const [data] = await ready
    expect(JSON.parse(data.toString())).toMatchObject({ protocolVersion: '1.0', type: 'connection.ready' })
  }

  async function unexpectedStatus(client: WebSocket): Promise<number | undefined> {
    const [, response] = await once(client, 'unexpected-response')
    response.resume()
    client.on('error', () => undefined)
    client.close()
    return response.statusCode
  }

  async function expectRejectedFrame(
    url: string,
    frame: string | Buffer,
    expectedCode: number,
    expectedReason: string
  ): Promise<void> {
    const client = openClient(url)
    await expectReady(client)
    const closed = once(client, 'close')
    client.send(frame)
    const [code, reason] = await closed
    expect(code).toBe(expectedCode)
    expect(reason.toString()).toBe(expectedReason)
  }
})
