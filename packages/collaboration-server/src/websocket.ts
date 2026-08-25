import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import { webSocketMessageSchema } from '@sciforge/collaboration-contracts'
import { WebSocket, WebSocketServer } from 'ws'

import { actorInboxRecipient } from './actor.js'
import type { InboxRecipient } from './model.js'
import type { CollaborationRequestActorResolver } from './network-boundary.js'
import type { InboxAvailabilityNotifier } from './service.js'

export type CollaborationWebSocketOptions = {
  authentication: CollaborationRequestActorResolver
  basePath?: string
  allowedOrigins?: readonly string[]
  now?: () => Date
}

export class CollaborationWebSocketHub implements InboxAvailabilityNotifier {
  private readonly clients = new Map<string, Set<WebSocket>>()
  private server?: WebSocketServer

  attach(httpServer: Server, options: CollaborationWebSocketOptions): void {
    if (this.server) throw new Error('Collaboration WebSocket hub is already attached.')
    const server = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024, perMessageDeflate: false })
    this.server = server
    const path = `${normalizeBasePath(options.basePath)}/v1/events`
    httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
      if (url.pathname !== path || !originAllowed(request.headers.origin, options.allowedOrigins)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      options.authentication.resolveRequestActor(request).then((actor) => {
        const recipient = actorInboxRecipient(actor)
        if (recipient.kind === 'human_endpoint') throw new Error('Provider endpoints do not use the public WebSocket.')
        server.handleUpgrade(request, socket, head, (webSocket) => {
          const key = recipientKey(recipient)
          const clients = this.clients.get(key) ?? new Set<WebSocket>()
          clients.add(webSocket)
          this.clients.set(key, clients)
          webSocket.on('error', (error) => {
            const code = (error as { code?: string }).code
            if (code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') webSocket.close(1009, 'Message too large')
            else webSocket.close(1011, 'WebSocket transport error')
          })
          webSocket.once('close', () => {
            clients.delete(webSocket)
            if (clients.size === 0) this.clients.delete(key)
          })
          webSocket.on('message', (data, binary) => {
            if (binary) return webSocket.close(1003, 'Text frames only')
            try {
              const message = webSocketMessageSchema.parse(JSON.parse(data.toString()))
              if (message.type !== 'connection.ping') return webSocket.close(1008, 'Only ping is accepted')
              webSocket.send(JSON.stringify({ protocolVersion: '1.0', type: 'connection.pong',
                nonce: message.nonce, sentAt: (options.now ?? (() => new Date()))().toISOString() }))
            } catch {
              webSocket.close(1007, 'Invalid collaboration WebSocket message')
            }
          })
          webSocket.send(JSON.stringify({ protocolVersion: '1.0', type: 'connection.ready',
            connectionId: randomUUID(), connectedAt: (options.now ?? (() => new Date()))().toISOString() }))
        })
      }).catch(() => {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        socket.destroy()
      })
    })
  }

  notifyInboxAvailable(recipient: InboxRecipient, latestSequence: number): void {
    if (recipient.kind === 'human_endpoint' || recipient.kind === 'provider_identity') return
    const payload = JSON.stringify({ protocolVersion: '1.0', type: 'inbox.available',
      recipientType: recipient.kind === 'agent' ? 'agent' : 'user', highestSequence: latestSequence })
    for (const client of this.clients.get(recipientKey(recipient)) ?? []) {
      if (client.readyState === WebSocket.OPEN) client.send(payload)
    }
  }

  async close(): Promise<void> {
    for (const clients of this.clients.values()) {
      for (const client of clients) client.close(1001, 'Server shutting down')
    }
    this.clients.clear()
    const server = this.server
    this.server = undefined
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function recipientKey(recipient: InboxRecipient): string { return `${recipient.kind}:${recipient.id}` }
function normalizeBasePath(value: string | undefined): string {
  if (!value || value === '/') return ''
  return `/${value.replace(/^\/+|\/+$/g, '')}`
}
function originAllowed(origin: string | undefined, allowed: readonly string[] | undefined): boolean {
  if (!origin) return true
  return Boolean(allowed?.includes(origin))
}
