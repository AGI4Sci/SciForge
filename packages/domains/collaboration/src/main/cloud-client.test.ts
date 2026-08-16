import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type WebSocket from 'ws'
import { HttpCollaborationCloudClient } from './cloud-client.js'

test('preserves a reverse-proxy base path for commands and WebSocket events', async () => {
  const urls: string[] = []
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    urls.push(String(input))
    const request = JSON.parse(String(init?.body)) as { type: string; requestId: string }
    const response = request.type === 'inbox.pull'
      ? {
          protocolVersion: '1.0',
          type: 'rest.inbox_page',
          requestId: request.requestId,
          messages: [],
          nextSequence: 0
        }
      : {
          protocolVersion: '1.0',
          type: 'endpoint.catalog',
          requestId: request.requestId,
          providers: []
        }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  let webSocketUrl = ''
  const client = new HttpCollaborationCloudClient({
    baseUrl: 'https://chat.sciforge.cn/collaboration',
    fetch: fetchImpl,
    webSocketFactory: (url) => {
      webSocketUrl = url
      return new FakeWebSocket() as unknown as WebSocket
    }
  })

  await client.execute({
    protocolVersion: '1.0',
    requestId: 'req_Request000001',
    type: 'endpoint.catalog.get'
  })
  await client.pullAgentInbox({
    afterSequence: 0,
    credential: { value: 'x'.repeat(32) }
  })
  assert.deepEqual(urls, [
    'https://chat.sciforge.cn/collaboration/v1/commands',
    'https://chat.sciforge.cn/collaboration/v1/commands'
  ])

  const controller = new AbortController()
  const iterator = client.observeAgentInbox(
    { value: 'x'.repeat(32) },
    controller.signal
  )[Symbol.asyncIterator]()
  const pending = iterator.next()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(webSocketUrl, 'wss://chat.sciforge.cn/collaboration/v1/events')
  controller.abort()
  await pending.catch(() => undefined)
})

class FakeWebSocket extends EventEmitter {
  readyState = 0

  constructor() {
    super()
    queueMicrotask(() => {
      this.readyState = 1
      this.emit('open')
    })
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.emit('close')
  }
}
