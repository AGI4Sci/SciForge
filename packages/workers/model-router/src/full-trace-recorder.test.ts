import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, test } from 'node:test'
import { deriveTraceId, type TraceEvent, type TraceEventInput } from '@sciforge/full-trace'

import { ModelRouterFullTraceRecorder } from './full-trace-recorder.js'
import { startModelRouterServer, type ModelRouterConfig } from './router.js'
import {
  completeModelRouterTraceCorrelation,
  createModelRouterTraceCorrelationRegistry
} from './trace-correlation.js'

const closeCallbacks: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()))
})

test('Codex extractor accepts only the reserved runtime, GUI thread, and native turn fields', () => {
  const registry = createModelRouterTraceCorrelationRegistry()
  const body = {
    metadata: {
      sciforge_trace: {
        trace_id: 'business-trace',
        runtime_id: 'business-runtime',
        thread_id: 'business-thread',
        turn_id: 'business-turn'
      }
    },
    client_metadata: {
      'x-codex-turn-metadata': JSON.stringify({
        runtime_id: 'codex',
        gui_thread_id: 'gui-thread',
        turn_id: 'native-turn',
        sciforge_runtime_id: 'synthetic-runtime',
        sciforge_thread_id: 'synthetic-thread',
        thread_id: 'synthetic-native-thread',
        gui_turn_id: 'synthetic-gui-turn',
        sciforge_turn_id: 'synthetic-turn',
        trace_id: 'synthetic-trace',
        sciforge_trace_id: 'synthetic-sciforge-trace',
        parent_request_id: 'synthetic-parent-request'
      })
    }
  }
  const first = completeModelRouterTraceCorrelation(registry.extract({ headers: {}, body }))
  const second = completeModelRouterTraceCorrelation(registry.extract({ headers: {}, body }))
  assert.equal(first.traceId, deriveTraceId({
    runtimeId: 'codex',
    threadId: 'gui-thread',
    turnId: 'native-turn'
  }))
  assert.equal(first.runtimeId, 'codex')
  assert.equal(first.threadId, 'gui-thread')
  assert.equal(first.turnId, 'native-turn')
  assert.equal(first.parentRequestId, undefined)
  assert.notEqual(first.requestId, second.requestId)

  const explicit = completeModelRouterTraceCorrelation(registry.extract({
    headers: {
      'x-sciforge-trace-id': 'header-trace',
      'x-sciforge-runtime-id': 'header-runtime',
      'x-sciforge-thread-id': 'header-thread',
      'x-sciforge-turn-id': 'header-turn'
    },
    body
  }))
  assert.equal(explicit.traceId, 'header-trace')
  assert.equal(explicit.runtimeId, 'header-runtime')
  assert.equal(explicit.threadId, 'header-thread')
  assert.equal(explicit.turnId, 'header-turn')
})

test('records two concurrent turns independently with complete model events', async () => {
  const batches: TraceEventInput[][] = []
  const recorder = new ModelRouterFullTraceRecorder({
    sink: {
      async appendMany(inputs) {
        batches.push([...inputs])
        return inputs as TraceEvent[]
      }
    }
  })
  const server = createServer(async (request, response) => {
    const session = recorder.start({
      method: request.method ?? 'POST',
      path: request.url ?? '/',
      headers: request.headers
    })
    session.attach(response)
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const raw = Buffer.concat(chunks).toString('utf8')
    session.recordRequestBody(raw, JSON.parse(raw))
    response.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': 'session=must-not-persist'
    })
    response.write('{"output":"opaque-configured-')
    response.end('api-key","usage":{"input_tokens":2,"output_tokens":3}}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closeCallbacks.push(async () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))
  const address = server.address() as AddressInfo
  const requestBody = (turn: string) => ({
    model: 'test-model',
    client_metadata: {
      'x-codex-turn-metadata': JSON.stringify({
        runtime_id: 'codex',
        gui_thread_id: 'gui-thread',
        turn_id: `native-${turn}`,
        gui_turn_id: `synthetic-${turn}`,
        sciforge_turn_id: `synthetic-${turn}`,
        trace_id: `synthetic-${turn}`,
        sciforge_trace_id: `synthetic-${turn}`
      })
    },
    input: `hello ${turn}`
  })

  await Promise.all(['turn-a', 'turn-b'].map(async (turn) => fetch(
    `http://127.0.0.1:${address.port}/v1/responses?api_key=query-secret`,
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer runtime-secret',
        'content-type': 'application/json'
      },
      body: JSON.stringify(requestBody(turn))
    }
  )))
  await recorder.flush()

  assert.equal(batches.length, 2)
  const events = batches.flat()
  const expectedTraceIds = ['turn-a', 'turn-b'].map((turn) => deriveTraceId({
    runtimeId: 'codex',
    threadId: 'gui-thread',
    turnId: `native-${turn}`
  }))
  assert.deepEqual(new Set(events.map((event) => event.traceId)), new Set(expectedTraceIds))
  assert.deepEqual(new Set(events.map((event) => event.turnId)), new Set(['native-turn-a', 'native-turn-b']))
  const requestIds = new Set(events.map((event) => event.requestId))
  assert.equal(requestIds.size, 2)
  for (const traceId of expectedTraceIds) {
    const traceEvents = events.filter((event) => event.traceId === traceId)
    assert.deepEqual(traceEvents.map((event) => event.kind), [
      'model_request',
      'model_response_headers',
      'model_response_chunk',
      'model_response_chunk',
      'usage',
      'model_response_end'
    ])
    assert.deepEqual(
      traceEvents.filter((event) => event.kind === 'model_response_chunk').map((event) => event.payload.index),
      [0, 1]
    )
  }
})

test('bounds outstanding trace work and reopens admission after the writer catches up', async () => {
  let releaseWrite: (() => void) | undefined
  const writeReleased = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  const recorder = new ModelRouterFullTraceRecorder({
    sink: {
      async appendMany() {
        await writeReleased
      }
    },
    maxOutstandingWork: 1
  })
  const event: TraceEventInput<'lifecycle'> = {
    traceId: 'trace-backlog',
    source: 'model-router',
    kind: 'lifecycle',
    payload: { phase: 'queued' }
  }

  recorder.commit([event])
  assert.throws(() => recorder.commit([event]), /backlogged/)
  assert.deepEqual(recorder.status(), {
    state: 'backlogged',
    ready: false,
    activeSessions: 0,
    pendingBatches: 1,
    maxOutstandingWork: 1
  })
  assert.throws(() => recorder.start({ method: 'POST', path: '/v1/responses', headers: {} }), /backlogged/)

  releaseWrite?.()
  await recorder.flush()
  assert.equal(recorder.status().state, 'ready')
})

test('keeps trace admission closed while the isolated writer is initializing', () => {
  let writerState: 'starting' | 'ready' = 'starting'
  const recorder = new ModelRouterFullTraceRecorder({
    sink: {
      status: () => ({ state: writerState }),
      async appendMany() {}
    }
  })

  assert.equal(recorder.status().state, 'starting')
  assert.throws(() => recorder.start({ method: 'POST', path: '/v1/responses', headers: {} }), /starting/)
  writerState = 'ready'
  assert.equal(recorder.status().state, 'ready')
})

test('marks trace capture failed after a durable writer error', async () => {
  const recorder = new ModelRouterFullTraceRecorder({
    sink: {
      async appendMany() {
        throw new Error('disk unavailable')
      }
    }
  })
  recorder.commit([{
    traceId: 'trace-failure',
    source: 'model-router',
    kind: 'lifecycle',
    payload: { phase: 'queued' }
  }])

  await assert.rejects(recorder.flush(), /disk unavailable/)
  assert.deepEqual(recorder.status(), {
    state: 'failed',
    ready: false,
    activeSessions: 0,
    pendingBatches: 0,
    maxOutstandingWork: 32,
    failure: 'disk unavailable'
  })
})

test('records actual protocol fallback attempts as independent children of the client request', async () => {
  const batches: TraceEventInput[][] = []
  const recorder = new ModelRouterFullTraceRecorder({
    sink: {
      async appendMany(inputs) {
        batches.push([...inputs])
        return inputs as TraceEvent[]
      }
    }
  })
  const responses = [
    Response.json({ error: { message: 'unsupported endpoint' } }, { status: 404 }),
    Response.json({
      id: 'chat_fallback',
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'fallback answer' },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
    })
  ]
  const config: ModelRouterConfig = {
    defaultProfile: 'default',
    publicModelAlias: 'router-model',
    runtimeApiKeyEnv: 'RUNTIME_KEY',
    profiles: {
      default: {
        textReasoner: {
          baseUrl: 'https://provider.example/v1',
          apiKeyEnv: 'PROVIDER_KEY',
          model: 'provider-model'
        },
        translators: {}
      }
    }
  }
  const router = await startModelRouterServer({
    port: 0,
    config,
    env: {
      RUNTIME_KEY: 'runtime-secret',
      PROVIDER_KEY: 'provider-secret'
    },
    fullTraceRecorder: recorder,
    fetchImpl: async () => {
      const response = responses.shift()
      assert.ok(response)
      return response
    }
  })
  closeCallbacks.push(() => router.close())

  const response = await fetch(`${router.url}/v1/responses`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer runtime-secret',
      'content-type': 'application/json',
      'x-sciforge-runtime-id': 'runtime',
      'x-sciforge-thread-id': 'thread',
      'x-sciforge-turn-id': 'turn'
    },
    body: JSON.stringify({ model: 'router-model', input: 'hello' })
  })
  assert.equal(response.status, 200)
  await response.json()
  await recorder.flush()

  assert.equal(batches.length, 1)
  const events = batches.flat()
  const requests = events.filter((event) => event.kind === 'model_request')
  const clientRequest = requests.find((event) => !asPayload(event).upstream)
  const upstreamRequests = requests.filter((event) => asPayload(event).upstream === true)
  assert.ok(clientRequest?.requestId)
  assert.equal(upstreamRequests.length, 2)
  assert.deepEqual(upstreamRequests.map((event) => asPayload(event).protocol), [
    'responses',
    'chat-completions'
  ])
  assert.deepEqual(upstreamRequests.map((event) => asPayload(event).retry), [0, 1])
  assert.equal(new Set(upstreamRequests.map((event) => event.requestId)).size, 2)
  assert.deepEqual(
    new Set(upstreamRequests.map((event) => event.parentRequestId)),
    new Set([clientRequest.requestId])
  )
  assert.equal(new Set(events.map((event) => event.traceId)).size, 1)
  assert.deepEqual(new Set(events.map((event) => event.turnId)), new Set(['turn']))

  const upstreamEnds = events.filter((event) => (
    event.kind === 'model_response_end' && asPayload(event).upstream === true
  ))
  assert.deepEqual(upstreamEnds.map((event) => asPayload(event).status), [404, 200])
  const upstreamChunks = events.filter((event) => (
    event.kind === 'model_response_chunk' && asPayload(event).upstream === true
  ))
  assert.equal(upstreamChunks.length, 2)
  assert.equal(upstreamChunks.every((event) => asPayload(event).body instanceof Uint8Array), true)
})

test('preserves binary multipart image edits and traces the transformed upstream request', async () => {
  const batches: TraceEventInput[][] = []
  const recorder = new ModelRouterFullTraceRecorder({
    sink: {
      async appendMany(inputs) {
        batches.push([...inputs])
        return inputs as TraceEvent[]
      }
    }
  })
  const config: ModelRouterConfig = {
    defaultProfile: 'default',
    publicModelAlias: 'router-model',
    runtimeApiKeyEnv: 'RUNTIME_KEY',
    profiles: {
      default: {
        textReasoner: {
          baseUrl: 'https://provider.example/v1',
          apiKeyEnv: 'PROVIDER_KEY',
          model: 'provider-model'
        },
        imageGenerator: {
          baseUrl: 'https://images.example/v1',
          apiKeyEnv: 'IMAGE_KEY',
          model: 'image-model'
        },
        translators: {}
      }
    }
  }
  const router = await startModelRouterServer({
    port: 0,
    config,
    env: {
      RUNTIME_KEY: 'runtime-secret',
      PROVIDER_KEY: 'provider-secret',
      IMAGE_KEY: 'image-secret'
    },
    fullTraceRecorder: recorder,
    fetchImpl: async () => Response.json({
      created: 1,
      data: [{ b64_json: Buffer.from('generated-image').toString('base64') }]
    })
  })
  closeCallbacks.push(() => router.close())

  const binaryImage = Uint8Array.from([0x00, 0xff, 0xfe, 0x80, 0x41, 0x42, 0x00])
  const form = new FormData()
  form.set('model', 'router-model')
  form.set('prompt', 'edit this image')
  form.set('image', new Blob([binaryImage], { type: 'image/png' }), 'input.png')
  const response = await fetch(`${router.url}/v1/images/edits`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer runtime-secret',
      'x-sciforge-runtime-id': 'runtime',
      'x-sciforge-thread-id': 'thread',
      'x-sciforge-turn-id': 'image-turn'
    },
    body: form
  })
  assert.equal(response.status, 200)
  await response.json()
  await recorder.flush()

  const requests = batches.flat().filter((event) => event.kind === 'model_request')
  const client = requests.find((event) => !asPayload(event).upstream)
  const upstream = requests.find((event) => asPayload(event).protocol === 'images-edits')
  assert.ok(client?.requestId)
  assert.ok(upstream?.requestId)
  assert.equal(upstream.parentRequestId, client.requestId)

  const rawBody = asPayload(client).body
  assert.ok(rawBody instanceof Uint8Array)
  const rawBytes = Buffer.from(rawBody)
  assert.notEqual(rawBytes.indexOf(Buffer.from(binaryImage)), -1)

  const upstreamBody = asPayload(upstream).body as Record<string, unknown>
  const entries = Array.isArray(upstreamBody.entries)
    ? upstreamBody.entries as Array<Record<string, unknown>>
    : []
  const imageEntry = entries.find((entry) => entry.name === 'image')
  const file = imageEntry?.file as Record<string, unknown> | undefined
  const fileBody = file?.body
  assert.ok(fileBody instanceof Uint8Array)
  assert.deepEqual(Buffer.from(fileBody), Buffer.from(binaryImage))
})

function asPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const payload = record.payload
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : record
}
