import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LocalTraceStore, type TraceEventInput } from '@sciforge/full-trace'
import { ModelRouterFullTraceRecorder } from './full-trace-recorder.js'
import { ModelRouterFullTraceWorkerSink } from './full-trace-worker-sink.js'
import { requestMetrics, traceProtocol, WireResponseMetrics } from './wire-metrics.js'

const t1 = '2026-11-03T01:00:01.000Z'
const t2 = '2026-11-03T01:00:02.000Z'
const t3 = '2026-11-03T01:00:03.000Z'
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const chunk = (metrics: WireResponseMetrics, text: string, at = t1) => metrics.chunk(Buffer.from(text), at)

test('request composition is numeric and distinguishes instructions, tools and role overhead', () => {
  const request = { instructions: 'hidden-system', messages: [
    { role: 'user', content: 'question' }, { role: 'assistant', content: 'old answer' },
    { role: 'untrusted-private-role', content: 'secret' }
  ], tools: [{ type: 'function', function: { name: 'secret-tool', parameters: { type: 'object' } } }] }
  const result = requestMetrics(request)
  assert.equal(result.serializedChars, JSON.stringify(request).length)
  assert.equal(result.toolCount, 1)
  assert.equal(result.messageCount, 3)
  assert.equal(result.compositionAvailable, true)
  assert.equal(result.countersMayBePartial, false)
  assert.deepEqual(result.unavailableFields, [])
  assert.ok(result.messageCharsByRole.user > 0)
  assert.ok(result.messageCharsByRole.other > 0)
  for (const secret of ['hidden-system', 'question', 'old answer', 'secret-tool', 'untrusted-private-role']) {
    assert.equal(JSON.stringify(result).includes(secret), false)
  }
})

const deeplyNestedRequest = () => '{"model":"fixture","input":[],"extra":'
  + '['.repeat(12_000) + 'null' + ']'.repeat(12_000) + '}'

test('valid deeply nested JSON preserves measurable counts and explicitly marks failed composition', () => {
  const raw = deeplyNestedRequest()
  assert.equal(raw.length, 24_043)
  const body = JSON.parse(raw)
  assert.throws(() => JSON.stringify(body), RangeError)
  const metrics = requestMetrics(body)
  assert.equal(metrics.compositionAvailable, false)
  assert.equal(metrics.countersMayBePartial, true)
  assert.equal(metrics.measurementFailure, 'serialization_failed')
  assert.deepEqual(metrics.unavailableFields, ['serializedChars', 'otherFieldsChars'])
  assert.equal(metrics.serializedChars, 0) // Unavailable, as explicitly identified above.
  assert.equal(metrics.inputChars, 2) // The empty input array is still measured correctly.
  assert.equal(metrics.messageCount, 0)
  assert.equal(metrics.toolCount, 0)
})

test('unmeasurable requests do not interrupt HTTP completion or retain full-trace admission', async () => {
  const batches: TraceEventInput[][] = []
  const recorder = new ModelRouterFullTraceRecorder({ sink: { async appendMany(events) { batches.push([...events]) } } })
  const raw = deeplyNestedRequest()
  let requests = 0
  const server = createServer((_request, response) => {
    const first = requests++ === 0
    const parsed = first ? JSON.parse(raw) : { input: 'next request' }
    const session = recorder.start({ method: 'POST', path: '/v1/responses', headers: {} })
    session.recordRequestBody(first ? raw : JSON.stringify(parsed), parsed)
    session.attach(response)
    const upstream = session.startUpstreamAttempt({ protocol: 'responses', phase: 'request', method: 'POST',
      url: 'https://fixture.invalid/v1/responses', headers: {}, body: parsed })
    upstream.responseHeaders?.(200, { 'content-type': 'application/json' })
    upstream.responseChunk?.(0, Buffer.from('{"status":"completed"}'))
    upstream.end?.({ status: 200, durationMs: 1 })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"status":"completed"}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    for (let index = 0; index < 2; index++) {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
      assert.equal(response.status, 200)
      assert.equal(await response.text(), '{"status":"completed"}')
      await recorder.flush()
      assert.equal(recorder.status().activeSessions, 0)
      assert.equal(recorder.status().ready, true)
    }
    const ends = batches.flat().filter((event) => event.kind === 'model_response_end')
    assert.equal(ends.length, 4)
    for (const [index, event] of ends.entries()) {
      const metrics = event.payload.metrics as { request: ReturnType<typeof requestMetrics>; response: ReturnType<WireResponseMetrics['finish']> }
      assert.equal(metrics.request.compositionAvailable, index >= 2)
      assert.equal(metrics.request.countersMayBePartial, index < 2)
      assert.equal(metrics.request.measurementFailure, index < 2 ? 'serialization_failed' : undefined)
      assert.equal(metrics.response.outcome, 'complete')
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('protocol detection does not mistake unknown endpoints for supported streams', () => {
  assert.equal(traceProtocol('/v1/responses?x=1'), 'responses')
  assert.equal(traceProtocol('chat-completions'), 'chat-completions')
  assert.equal(traceProtocol('/v1/chat/completions'), 'chat-completions')
  assert.equal(traceProtocol('anthropic-messages'), 'unknown')
})

test('embedded additional_tools catalogs count namespace leaves separately without changing input role accounting', () => {
  const catalog = [{ type: 'namespace', name: 'private-functions', tools: [
    { type: 'function', name: 'private-tool-a', parameters: { type: 'object' } },
    { type: 'namespace', name: 'nested', tools: [
      { type: 'custom', name: 'private-tool-b' },
      { type: 'namespace', name: 'empty', tools: [] }
    ] }
  ] }, { type: 'web_search' }]
  const secondCatalog = [{ type: 'function', name: 'private-tool-c' }]
  const request = { tools: [], input: [
    { role: 'user', content: 'question' },
    { type: 'additional_tools', tools: catalog },
    { type: 'additional_tools', tools: secondCatalog },
    { type: 'message', tools: [{ type: 'function', name: 'not-a-catalog' }] }
  ] }
  const before = JSON.stringify(request)
  const result = requestMetrics(request)
  assert.equal(result.toolCount, 0)
  assert.equal(result.embeddedToolCount, 4)
  assert.equal(result.embeddedToolCatalogChars, JSON.stringify(catalog).length + JSON.stringify(secondCatalog).length)
  assert.equal(result.messageCharsByRole.user, JSON.stringify(request.input[0]).length)
  assert.equal(result.messageCharsByRole.other, request.input.slice(1).reduce((sum, item) => sum + JSON.stringify(item).length, 0))
  assert.equal(result.inputChars, JSON.stringify(request.input).length)
  assert.equal(JSON.stringify(request), before)
  assert.equal(JSON.stringify(result).includes('private-'), false)
  assert.equal(requestMetrics({ tools: [{ type: 'function' }], input: [] }).toolCount, 1)
  assert.equal(requestMetrics({ tools: [{ type: 'function' }], input: [] }).embeddedToolCount, 0)
  assert.equal(requestMetrics({ input: [{ type: 'additional_tools', tools: [null, 'invalid', { type: 'namespace' }] }] }).embeddedToolCount, 0)
})

test('chat SSE handles bytewise UTF8/CRLF fragmentation and never persists text or reasoning', () => {
  const metrics = new WireResponseMetrics('chat-completions', true)
  const reasoning = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '隐秘🧪' } }] })}\r\n\r\n`
  for (const byte of Buffer.from(reasoning)) metrics.chunk(Uint8Array.of(byte), t1)
  chunk(metrics, frame({ choices: [{ delta: { content: '正文🔬' } }] }), t2)
  chunk(metrics, frame({ choices: [{ delta: { tool_calls: [{ function: { arguments: '{"x":1}' } }] }, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n', t3)
  const result = metrics.finish(t3)
  assert.equal(result.reasoningChars, '隐秘🧪'.length)
  assert.equal(result.textChars, '正文🔬'.length)
  assert.equal(result.toolArgumentChars, 7)
  assert.equal(result.firstByteAt, t1)
  assert.equal(result.firstReasoningAt, t1)
  assert.equal(result.firstTextAt, t2)
  assert.equal(result.lastOutputAt, t3)
  assert.equal(result.doneSeen, true)
  assert.equal(result.outcome, 'complete')
  assert.equal(result.malformedFrames, 0)
  assert.equal(JSON.stringify(result).includes('隐秘'), false)
  assert.equal(JSON.stringify(result).includes('正文'), false)
})

test('HTTP 200, an ordinary response end, and unterminated DONE are insufficient completion evidence', () => {
  const metrics = new WireResponseMetrics('chat-completions', true)
  metrics.headers(200, { 'content-type': 'text/event-stream' })
  chunk(metrics, frame({ choices: [{ delta: { content: 'partial' } }] }))
  chunk(metrics, 'data: [DONE]')
  const result = metrics.finish(t3)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.completionObserved, false)
  assert.equal(result.incompleteFrame, true)
  assert.equal(result.countersMayBePartial, true)
})

test('abort and errors preserve independently observed protocol completion', () => {
  const metrics = new WireResponseMetrics('chat-completions', true)
  chunk(metrics, 'data: [DONE]\n\n')
  metrics.error(Object.assign(new Error('must not persist this'), { name: 'AbortError' }))
  const result = metrics.finish(t3)
  assert.equal(result.outcome, 'aborted')
  assert.equal(result.completionObserved, true)
  assert.equal(result.abortObserved, true)
  assert.equal(JSON.stringify(result).includes('must not persist'), false)
  const failed = new WireResponseMetrics('responses')
  failed.headers(503, {})
  assert.equal(failed.finish(t3).outcome, 'error')
  const protocolError = new WireResponseMetrics('chat-completions', true)
  chunk(protocolError, frame({ choices: [{ finish_reason: 'error' }] }))
  assert.equal(protocolError.finish(t3).outcome, 'error')
  assert.equal(protocolError.finish(t3).completionObserved, false)
})

test('Responses streaming counts only deltas and identifies completed/failed/incomplete terminals', () => {
  const metrics = new WireResponseMetrics('responses', true)
  chunk(metrics, frame({ type: 'response.reasoning_summary_text.delta', delta: 'reasoning' }), t1)
  chunk(metrics, frame({ type: 'response.output_text.delta', delta: 'answer' }), t2)
  chunk(metrics, frame({ type: 'response.function_call_arguments.delta', delta: '{}' }), t2)
  chunk(metrics, frame({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'answer' }] }] } }), t3)
  const result = metrics.finish(t3)
  assert.equal(result.textChars, 6)
  assert.equal(result.reasoningChars, 9)
  assert.equal(result.toolArgumentChars, 2)
  assert.equal(result.responseTerminal, 'completed')
  assert.equal(result.outcome, 'complete')
  for (const status of ['failed', 'incomplete']) {
    const failed = new WireResponseMetrics('responses', true)
    chunk(failed, `event: response.${status}\ndata: {}\n\n`)
    assert.equal(failed.finish(t3).outcome, 'error')
  }
})

test('bounded parser skips oversized and malformed SSE frames and recovers at the next event', () => {
  const metrics = new WireResponseMetrics('chat-completions', true)
  chunk(metrics, `data: ${'x'.repeat(300_000)}\n\ndata: not-json\n\n`)
  chunk(metrics, frame({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }))
  const result = metrics.finish(t3)
  assert.equal(result.oversizedFrames, 1)
  assert.equal(result.malformedFrames, 1)
  assert.equal(result.textChars, 2)
  assert.equal(result.countersMayBePartial, true)
  assert.equal(result.outcome, 'complete')
})

test('SSE multiline data and comments are parsed without treating keepalive as output', () => {
  const metrics = new WireResponseMetrics('chat-completions', true)
  chunk(metrics, ': ping\n\ndata: {"choices":\ndata: [{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n')
  const result = metrics.finish(t3)
  assert.equal(result.textChars, 2)
  assert.equal(result.outcome, 'complete')
})

test('nonstream JSON handles split UTF8 and explicit completion, and bounds oversized bodies', () => {
  const metrics = new WireResponseMetrics('responses')
  const bytes = Buffer.from(JSON.stringify({ status: 'completed', output: [
    { type: 'message', content: [{ type: 'output_text', text: '汉字' }] },
    { type: 'reasoning', summary: [{ text: 'private' }] }
  ] }))
  for (const byte of bytes) metrics.chunk(Uint8Array.of(byte), t1)
  const result = metrics.finish(t3)
  assert.equal(result.textChars, 2)
  assert.equal(result.reasoningChars, 7)
  assert.equal(result.firstTextAt, t1)
  assert.equal(result.outcome, 'complete')
  assert.deepEqual(metrics.finish(t3), result)
  const oversized = new WireResponseMetrics('responses')
  chunk(oversized, JSON.stringify({ status: 'completed', output: 'a'.repeat(300_000) }))
  assert.equal(oversized.finish(t3).outcome, 'unknown')
  assert.equal(oversized.finish(t3).oversizedFrames, 1)
})

test('unsupported protocol and unknown finish reasons never store arbitrary provider strings', () => {
  const unknown = new WireResponseMetrics('unknown', true)
  chunk(unknown, 'data: [DONE]\n\n')
  assert.equal(unknown.finish(t3).outcome, 'unknown')
  assert.equal(unknown.finish(t3).parsing, 'unsupported')
  const chat = new WireResponseMetrics('chat-completions', true)
  chunk(chat, frame({ choices: [{ finish_reason: 'SECRET_SERVER_TEXT' }] }))
  assert.deepEqual(chat.finish(t3).finishReasons, ['other'])
  assert.equal(chat.finish(t3).outcome, 'unknown')
  assert.equal(JSON.stringify(chat.finish(t3)).includes('SECRET_SERVER_TEXT'), false)
})

test('durable bounded trace retains complete metrics after preview truncation and redaction', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'sciforge-wire-metrics-'))
  const secret = 'synthetic-private-test-value'
  const sink = new ModelRouterFullTraceWorkerSink({ userDataDirectory, sensitiveValues: [secret] })
  await sink.initialize()
  const recorder = new ModelRouterFullTraceRecorder({ sink })
  const server = createServer((_request, response) => {
    const session = recorder.start({ method: 'POST', path: '/v1/responses', headers: { 'x-sciforge-trace-id': 'durable-metrics' } })
    session.attach(response)
    session.recordRequestBody({ input: `${secret}${'x'.repeat(20_000)}` }, { input: `${secret}${'x'.repeat(20_000)}` })
    const attempt = session.startUpstreamAttempt({ protocol: 'chat-completions', phase: 'request', method: 'POST', url: 'https://example.test/v1/chat/completions', headers: { authorization: `Bearer ${secret}` }, body: { messages: [{ role: 'user', content: 'x'.repeat(20_000) }], stream: true } })
    attempt.responseHeaders?.(200, { 'content-type': 'text/event-stream' })
    attempt.responseChunk?.(0, Buffer.from(frame({ choices: [{ delta: { content: 'x'.repeat(5_000) } }] })))
    attempt.responseChunk?.(1, Buffer.from(frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n'))
    attempt.end?.({ status: 200, durationMs: 20 })
    response.end(JSON.stringify({ status: 'completed', output: [] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    await response.text()
    await recorder.flush()
    await sink.close()
    const stored = await new LocalTraceStore({ userDataDirectory }).read({ traceIds: ['durable-metrics'] })
    const upstream = stored.events.find((event) => event.kind === 'model_response_end' && event.payload.upstream === true)
    const metrics = upstream?.payload.metrics as { request: ReturnType<typeof requestMetrics>; response: ReturnType<WireResponseMetrics['finish']> }
    assert.equal(metrics.response.textChars, 5_000)
    assert.equal(metrics.response.doneSeen, true)
    assert.deepEqual(metrics.response.finishReasons, ['stop'])
    assert.equal(metrics.response.outcome, 'complete')
    assert.ok(metrics.request.serializedChars > 20_000)
    assert.equal(JSON.stringify(stored.events).includes(secret), false)
    const request = stored.events.find((event) => event.kind === 'model_request' && event.payload.upstream === true)
    assert.ok(JSON.stringify(request?.payload.body).length < metrics.request.serializedChars)
    const previews = stored.events.filter((event) => event.kind === 'model_response_chunk' && event.payload.upstream === true)
    assert.ok(JSON.stringify(previews).length < 5_000)
  } finally {
    await sink.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('canonical recorder persists independent root/upstream metrics including abort without a terminal', async () => {
  const batches: TraceEventInput[][] = []
  const recorder = new ModelRouterFullTraceRecorder({ sink: { async appendMany(events) { batches.push([...events]) } } })
  const server = createServer((_request, response) => {
    const session = recorder.start({ method: 'POST', path: '/v1/responses', headers: {} })
    session.recordRequestBody('{"stream":true}', { stream: true, input: 'hello', tools: [] })
    session.attach(response)
    const upstream = session.startUpstreamAttempt({ protocol: 'chat-completions', phase: 'request', method: 'POST', url: 'https://example.test/v1/chat/completions', headers: {}, body: { stream: true, messages: [{ role: 'user', content: 'hello' }], tools: [{ type: 'function' }] } })
    upstream.responseHeaders?.(200, { 'content-type': 'text/event-stream' })
    upstream.responseChunk?.(0, Buffer.from(frame({ choices: [{ delta: { reasoning_content: 'private' } }] })))
    upstream.error?.(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
    upstream.end?.({ status: 200, durationMs: 10 })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(frame({ type: 'response.completed', response: { status: 'completed' } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    await response.text()
    await recorder.flush()
    const ends = batches.flat().filter((event) => event.kind === 'model_response_end')
    assert.equal(ends.length, 2)
    const upstream = ends.find((event) => event.payload.upstream === true)?.payload.metrics as { request: ReturnType<typeof requestMetrics>; response: ReturnType<WireResponseMetrics['finish']> }
    const root = ends.find((event) => !event.payload.upstream)?.payload.metrics as typeof upstream
    assert.equal(upstream.response.outcome, 'aborted')
    assert.equal(upstream.response.reasoningChars, 7)
    assert.equal(upstream.request.toolCount, 1)
    assert.equal(root.response.outcome, 'complete')
    assert.equal(root.request.toolCount, 0)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
