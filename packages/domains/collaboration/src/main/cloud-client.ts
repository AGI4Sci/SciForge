import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import {
  restRequestSchema,
  restResponseSchema,
  webSocketMessageSchema,
  type InboxMessage,
  type RestRequest,
  type RestResponse,
  type WebSocketMessage
} from '@sciforge/collaboration-contracts'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

export type CollaborationCredential = Readonly<{
  value: string
}>

export type CloudInboxPage = Readonly<{
  messages: readonly InboxMessage[]
  nextSequence: number
}>

export interface CollaborationCloudClient {
  execute(request: RestRequest, credential?: CollaborationCredential): Promise<RestResponse>
  pullAgentInbox(input: Readonly<{
    afterSequence: number
    limit?: number
    credential: CollaborationCredential
  }>): Promise<CloudInboxPage>
  observeAgentInbox(
    credential: CollaborationCredential,
    signal: AbortSignal
  ): AsyncIterable<WebSocketMessage>
}

export type HttpCollaborationCloudClientOptions = Readonly<{
  baseUrl: string
  fetch?: typeof globalThis.fetch
  webSocketFactory?: (url: string, headers: Readonly<Record<string, string>>) => WebSocket
  requestTimeoutMs?: number
}>

/** The only production HTTP/WebSocket implementation used by the desktop domain. */
export class HttpCollaborationCloudClient implements CollaborationCloudClient {
  private readonly baseUrl: URL
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly webSocketFactory: (url: string, headers: Readonly<Record<string, string>>) => WebSocket
  private readonly requestTimeoutMs: number

  constructor(options: HttpCollaborationCloudClientOptions) {
    this.baseUrl = validateBaseUrl(options.baseUrl)
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.webSocketFactory = options.webSocketFactory ?? ((url, headers) => new WebSocket(url, { headers }))
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
  }

  async execute(
    request: RestRequest,
    credential?: CollaborationCredential
  ): Promise<RestResponse> {
    const parsed = restRequestSchema.parse(request)
    const response = await this.request('v1/commands', {
      method: 'POST',
      credential,
      body: parsed
    })
    return restResponseSchema.parse(response)
  }

  async pullAgentInbox(input: Readonly<{
    afterSequence: number
    limit?: number
    credential: CollaborationCredential
  }>): Promise<CloudInboxPage> {
    const response = await this.execute(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'inbox.pull',
      recipientType: 'agent',
      afterSequence: input.afterSequence,
      limit: input.limit ?? 100
    }), input.credential)
    if (response.type === 'rest.error') throw new CloudProtocolError(response.error.message)
    if (response.type !== 'rest.inbox_page') {
      throw new CloudProtocolError(`Expected rest.inbox_page, received ${response.type}.`)
    }
    return { messages: response.messages, nextSequence: response.nextSequence }
  }

  async *observeAgentInbox(
    credential: CollaborationCredential,
    signal: AbortSignal
  ): AsyncIterable<WebSocketMessage> {
    const url = new URL('v1/events', this.baseUrl)
    url.protocol = 'wss:'
    const socket = this.webSocketFactory(url.toString(), {
      authorization: `Bearer ${credential.value}`
    })
    const close = () => socket.close(1000, 'client shutdown')
    signal.addEventListener('abort', close, { once: true })
    try {
      await Promise.race([
        once(socket, 'open'),
        once(socket, 'error').then(([error]) => Promise.reject(error)),
        abortPromise(signal)
      ])
      const events: unknown[] = []
      let wake: (() => void) | undefined
      const onMessage = (data: WebSocket.RawData) => {
        try {
          const text = rawDataText(data)
          if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
            socket.close(1009, 'payload too large')
            return
          }
          events.push(JSON.parse(text) as unknown)
          wake?.()
          wake = undefined
        } catch {
          socket.close(1007, 'invalid payload')
        }
      }
      socket.on('message', onMessage)
      while (!signal.aborted && socket.readyState === WebSocket.OPEN) {
        if (events.length === 0) {
          await Promise.race([
            new Promise<void>((resolve) => { wake = resolve }),
            once(socket, 'close').then(() => undefined),
            abortPromise(signal)
          ])
        }
        while (events.length > 0) yield webSocketMessageSchema.parse(events.shift())
      }
      socket.off('message', onMessage)
    } finally {
      signal.removeEventListener('abort', close)
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) close()
    }
  }

  private async request(
    path: string | URL,
    input: Readonly<{
      method: 'GET' | 'POST'
      credential?: CollaborationCredential
      body?: unknown
    }>
  ): Promise<unknown> {
    if (typeof path === 'string' && path.startsWith('/')) {
      throw new CloudProtocolError('Cloud endpoint paths must be relative to the configured service base path.')
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    try {
      const response = await this.fetchImpl(
        typeof path === 'string' ? new URL(path, this.baseUrl) : path,
        {
          method: input.method,
          headers: {
            accept: 'application/json',
            ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(idempotencyKey(input.body) ? { 'idempotency-key': idempotencyKey(input.body) } : {}),
            ...(input.credential ? { authorization: `Bearer ${input.credential.value}` } : {})
          },
          ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
          signal: controller.signal
        }
      )
      const declaredLength = Number(response.headers.get('content-length') ?? 0)
      if (declaredLength > MAX_RESPONSE_BYTES) throw new CloudProtocolError('Cloud response is too large.')
      const text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new CloudProtocolError('Cloud response is too large.')
      }
      let value: unknown
      try {
        value = JSON.parse(text) as unknown
      } catch {
        throw new CloudProtocolError('Cloud returned invalid JSON.')
      }
      if (!response.ok) {
        const parsed = restResponseSchema.safeParse(value)
        if (parsed.success && parsed.data.type === 'rest.error') {
          throw new CloudProtocolError(parsed.data.error.message)
        }
        throw new CloudProtocolError(`Cloud request failed with HTTP ${response.status}.`)
      }
      return value
    } finally {
      clearTimeout(timeout)
    }
  }
}

function idempotencyKey(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('idempotencyKey' in value)) return undefined
  const key = (value as { idempotencyKey?: unknown }).idempotencyKey
  return typeof key === 'string' ? key : undefined
}

export class CloudProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudProtocolError'
  }
}

export function collaborationRequestId(): `req_${string}` {
  return `req_${randomUUID().replaceAll('-', '')}`
}

export function validateCloudRestResponse(response: RestResponse): RestResponse {
  const parsed = restResponseSchema.parse(response)
  if (parsed.type === 'rest.error') throw new CloudProtocolError(parsed.error.message)
  return parsed
}

function validateBaseUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('Collaboration service URL must use HTTPS.')
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Collaboration service URL cannot contain credentials, query, or fragment.')
  }
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`
  return url
}

function abortPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function rawDataText(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}
