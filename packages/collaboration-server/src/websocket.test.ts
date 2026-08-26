import { once } from 'node:events'
import { createServer } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import type { AgentActor } from './actor.js'
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
      allowedOrigins: ['https://desktop.sciforge.test']
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
      origin: 'https://desktop.sciforge.test'
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
})
