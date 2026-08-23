import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  LocalTraceStore,
  TRACE_REDACTION_MARKER,
  deriveExecutionTraceId,
  deriveTraceId,
  sanitizeTraceHeaders,
  sanitizeTraceText,
  sanitizeTraceTextChunks,
  sanitizeTraceValue,
  sensitiveTraceValuesFromHeaders,
  traceCorrelationFromHeaders,
  traceCorrelationHeaders,
  type TraceEvent
} from './index.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true })
  }))
})

describe('secret filtering', () => {
  test('removes credential headers, credential fields, and recognized inline secrets', () => {
    const authorization = 'Bearer very-secret-bearer-token'
    const openAiKey = 'sk-live-abcdefghijklmnopqrstuvwxyz'
    const githubToken = 'ghp_abcdefghijklmnopqrstuvwxyz123456'
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const privateKey = '-----BEGIN PRIVATE KEY-----\nsuper-private\n-----END PRIVATE KEY-----'

    assert.deepEqual(sanitizeTraceHeaders({
      Authorization: authorization,
      Cookie: 'session=sensitive',
      'Content-Type': 'application/json'
    }), {
      Authorization: TRACE_REDACTION_MARKER,
      Cookie: TRACE_REDACTION_MARKER,
      'Content-Type': 'application/json'
    })

    const sanitized = sanitizeTraceValue({
      api_key: openAiKey,
      nested: {
        refreshToken: 'refresh-value',
        prompt: `keys ${openAiKey} ${githubToken} ${jwt}`,
        max_tokens: 1024
      }
    })
    const serialized = JSON.stringify(sanitized)
    assert.equal(serialized.includes(openAiKey), false)
    assert.equal(serialized.includes(githubToken), false)
    assert.equal(serialized.includes(jwt), false)
    assert.equal(serialized.includes('refresh-value'), false)
    assert.equal(serialized.includes('"max_tokens":1024'), true)
    assert.equal(sanitizeTraceText(privateKey), TRACE_REDACTION_MARKER)
    const rawJson = `{"Authorization":"opaque-auth","api_key":"${openAiKey}","prompt":"safe"}`
    assert.equal(sanitizeTraceText(rawJson).includes('opaque-auth'), false)
    assert.equal(sanitizeTraceText(rawJson).includes(openAiKey), false)
    assert.equal(sanitizeTraceText('Cookie: session=secret; csrf=also-secret').includes('also-secret'), false)
    assert.equal(sanitizeTraceText('https://example.test/v1?api_key=query-secret&safe=1').includes('query-secret'), false)
    assert.equal(sanitizeTraceText('Set-Cookie: session=cookie-secret; Secure').includes('cookie-secret'), false)
    assert.equal(
      sanitizeTraceText('connect https://user:opaque-password@example.test/path'),
      `connect https://user:${TRACE_REDACTION_MARKER}@example.test/path`
    )
    assert.equal(sanitizeTraceText('x'.repeat(256 * 1024)), 'x'.repeat(256 * 1024))
    assert.deepEqual(sensitiveTraceValuesFromHeaders({
      Authorization: 'Bearer opaque-bearer',
      Cookie: 'session=cookie-value; csrf=csrf-value',
      'Content-Type': 'application/json'
    }), [
      'Bearer opaque-bearer',
      'opaque-bearer',
      'session=cookie-value; csrf=csrf-value',
      'cookie-value',
      'csrf-value'
    ])
  })

  test('removes configured secrets echoed as plain text across stream chunk boundaries', () => {
    const configuredSecret = 'totally-opaque-configured-value'
    const chunks = ['provider echoed totally-opaque-', 'configured-', 'value at the end']
    const sanitized = sanitizeTraceTextChunks(chunks, { sensitiveValues: [configuredSecret] })
    assert.equal(sanitized.length, chunks.length)
    assert.equal(sanitized.join('').includes(configuredSecret), false)
    assert.equal(sanitized.join('').includes(TRACE_REDACTION_MARKER), true)
    assert.equal(
      sanitizeTraceText('plain totally-opaque-configured-value response', {
        sensitiveValues: [configuredSecret]
      }).includes(configuredSecret),
      false
    )
    assert.equal(
      sanitizeTraceText('ordinary configured response remains readable', {
        sensitiveValues: ['unrelated-secret-with-ordinary-suffix']
      }),
      'ordinary configured response remains readable'
    )
    assert.equal(
      sanitizeTraceText('short xy secret', { sensitiveValues: ['xy'] }),
      `short ${TRACE_REDACTION_MARKER} secret`
    )
  })

  test('preserves arbitrary binary bytes as base64 and suppresses binary credential echoes', () => {
    const bytes = Uint8Array.from([0x00, 0xff, 0xfe, 0x80, 0x41, 0x00])
    assert.deepEqual(sanitizeTraceValue(bytes), {
      encoding: 'base64',
      data: Buffer.from(bytes).toString('base64')
    })

    const configuredSecret = 'opaque-binary-secret'
    const binaryWithSecret = Buffer.concat([
      Buffer.from([0xff, 0x00]),
      Buffer.from(configuredSecret),
      Buffer.from([0x80])
    ])
    assert.deepEqual(sanitizeTraceValue(binaryWithSecret, {
      sensitiveValues: [configuredSecret]
    }), {
      encoding: 'base64',
      data: TRACE_REDACTION_MARKER
    })
  })
})

describe('LocalTraceStore', () => {
  test('sanitizes an ordered text stream with the current exact-secret values', async () => {
    const temporary = await createTemporaryDirectory()
    let sensitiveValues = ['first-exact-secret']
    const store = new LocalTraceStore({
      storageDirectory: path.join(temporary, 'traces'),
      sensitiveValues: () => sensitiveValues
    })

    assert.equal(
      store.sanitizeTextChunks(['first-exact-', 'secret is hidden']).join(''),
      `${TRACE_REDACTION_MARKER} is hidden`
    )
    sensitiveValues = ['second-exact-secret']
    assert.equal(
      store.sanitizeTextChunks(['ordinary first-exact-', 'secret stays readable']).join(''),
      'ordinary first-exact-secret stays readable'
    )
  })

  test('sanitizes model response runs across chunk boundaries before persistence', async () => {
    const temporary = await createTemporaryDirectory()
    const secret = 'opaque-cross-chunk-secret'
    const store = new LocalTraceStore({
      storageDirectory: path.join(temporary, 'traces'),
      sensitiveValues: [secret]
    })

    await store.appendMany([{
      traceId: 'trace-cross-chunk',
      requestId: 'request-cross-chunk',
      source: 'model-router',
      kind: 'model_response_chunk',
      payload: { index: 0, body: 'opaque-cross-' }
    }, {
      traceId: 'trace-cross-chunk',
      requestId: 'request-cross-chunk',
      source: 'model-router',
      kind: 'model_response_chunk',
      payload: { index: 1, body: 'chunk-secret' }
    }])

    const stored = await store.read({ traceIds: ['trace-cross-chunk'] })
    assert.equal(stored.events.length, 1)
    const serialized = JSON.stringify(stored.events)
    assert.equal(serialized.includes(secret), false)
    assert.equal(serialized.includes(TRACE_REDACTION_MARKER), true)
  })

  test('appends complete sanitized events to owner-only files and filters export again', async () => {
    const temporary = await createTemporaryDirectory()
    const userDataDirectory = path.join(temporary, 'user-data')
    const destination = path.join(temporary, 'exports', 'trace.jsonl')
    const now = new Date('2026-07-19T10:00:00.000Z')
    const store = new LocalTraceStore({
      userDataDirectory,
      now: () => now,
      sensitiveValues: ['opaque-upstream-key']
    })
    await store.initialize()

    assert.equal((await lstat(store.directory)).mode & 0o777, 0o700)

    const traceId = deriveTraceId({ runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1' })
    const secret = 'sk-live-abcdefghijklmnopqrstuvwxyz'
    const first = await store.append({
      traceId,
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      source: 'model-router',
      kind: 'model_request',
      payload: {
        model: 'model-name',
        headers: { Authorization: `Bearer ${secret}`, 'x-api-key': secret },
        body: { prompt: `Use ${secret}; echoed opaque-upstream-key`, apiKey: secret }
      }
    })
    const segmentName = (await readdir(store.directory)).find((name) => (
      /^2026-07-19\.\d{6}\.ndjson$/u.test(name)
    ))
    assert.ok(segmentName)
    const segment = path.join(store.directory, segmentName)
    const firstSnapshot = await readFile(segment, 'utf8')
    assert.equal(firstSnapshot.includes(secret), false)
    assert.equal(firstSnapshot.includes('opaque-upstream-key'), false)
    assert.equal(firstSnapshot.includes(TRACE_REDACTION_MARKER), true)
    assert.equal((await lstat(segment)).mode & 0o777, 0o600)

    await store.append({
      traceId,
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      source: 'model-router',
      kind: 'model_response_chunk',
      payload: { index: 0, body: 'visible response' }
    })
    assert.equal((await readFile(segment, 'utf8')).startsWith(firstSnapshot), true)

    // Simulate externally injected data to prove read/export apply the mandatory filter again.
    const forged: TraceEvent = {
      ...first,
      eventId: 'event-forged',
      payload: { prompt: secret }
    }
    await appendFile(segment, `${JSON.stringify(forged)}\n`, 'utf8')

    const readResult = await store.read({ traceIds: [traceId] })
    assert.equal(JSON.stringify(readResult.events).includes(secret), false)
    const exportResult = await store.export({ destination, traceIds: [traceId] })
    assert.equal(exportResult.eventCount, 3)
    assert.equal(exportResult.traceCount, 1)
    assert.equal((await lstat(destination)).mode & 0o777, 0o600)
    const exported = await readFile(destination, 'utf8')
    assert.equal(exported.includes(secret), false)
    const [manifest] = exported.trim().split('\n').map((line) => JSON.parse(line) as unknown)
    assert.deepEqual(manifest, {
      recordType: 'manifest',
      format: 'sciforge.full-trace.jsonl.v1',
      schemaVersion: 'sciforge.trace.v1',
      exportedAt: now.toISOString(),
      eventCount: 3,
      traceCount: 1
    })
  })

  test('stores response streams as one bounded, digest-verifiable event', async () => {
    const temporary = await createTemporaryDirectory()
    const destination = path.join(temporary, 'exports', 'bounded.jsonl')
    const store = new LocalTraceStore({
      storageDirectory: path.join(temporary, 'traces'),
      now: () => new Date('2026-07-19T10:00:00.000Z')
    })
    const response = Array.from({ length: 100 }, (_, index) => `${index}:`.padEnd(1_024, 'x'))
    const persisted = await store.appendMany(response.map((body, index) => ({
      traceId: 'trace-bounded-stream',
      requestId: 'request-bounded-stream',
      source: 'model-router',
      kind: 'model_response_chunk' as const,
      timestamp: `2026-07-19T10:00:00.${String(index).padStart(3, '0')}Z`,
      payload: { index, body, byteLength: Buffer.byteLength(body) }
    })))

    assert.equal(persisted.length, 1)
    const [event] = (await store.read({ traceIds: ['trace-bounded-stream'] })).events
    assert.equal(event?.kind, 'model_response_chunk')
    const payload = event?.payload as Record<string, unknown>
    const capture = payload.capture as Record<string, unknown>
    assert.equal(capture.mode, 'bounded')
    assert.equal(capture.chunkCount, 100)
    assert.equal(capture.sourceByteLength, 102_400)
    assert.equal(capture.truncated, true)
    assert.equal(capture.sha256, createHash('sha256').update(response.join('')).digest('hex'))
    assert.ok(Buffer.byteLength(String(payload.body)) <= 2_048 + 3)

    await store.export({ destination, traceIds: ['trace-bounded-stream'] })
    const exported = (await readFile(destination, 'utf8')).trim().split('\n')
    assert.equal(exported.length, 2)
    const exportedEvent = JSON.parse(exported[1] as string) as TraceEvent
    assert.equal((exportedEvent.payload as Record<string, unknown>).body, payload.body)
  })

  test('rolls future writes by size and caps legacy plus indexed segments together', async () => {
    const temporary = await createTemporaryDirectory()
    let now = new Date('2026-07-19T10:00:00.000Z')
    const store = new LocalTraceStore({
      storageDirectory: path.join(temporary, 'traces'),
      now: () => now,
      maxSegmentBytes: 700,
      maxTotalBytes: 1_400
    })
    await store.initialize()
    await writeFile(
      path.join(store.directory, '2026-07-19.ndjson'),
      `${JSON.stringify({ legacy: 'trace-legacy'.repeat(80) })}\n`,
      { mode: 0o600 }
    )
    for (const input of Array.from({ length: 8 }, (_, index) => ({
      traceId: `trace-roll-${index}`,
      source: 'agent-runtime',
      kind: 'lifecycle' as const,
      payload: { phase: 'progress', detail: 'x'.repeat(180), index }
    }))) {
      await store.append(input)
    }
    now = new Date('2026-07-20T10:00:00.000Z')
    await store.pruneExpired({ force: true })

    const files = (await readdir(store.directory)).filter((name) => name.endsWith('.ndjson')).sort()
    assert.equal(files.includes('2026-07-19.ndjson'), false)
    assert.ok(files.some((name) => /^2026-07-19\.\d{6}\.ndjson$/u.test(name)))
    const retainedBytes = (await Promise.all(files
      .map(async (name) => (await lstat(path.join(store.directory, name))).size)))
      .reduce((sum, size) => sum + size, 0)
    assert.ok(retainedBytes <= store.maxTotalBytes)
  })

  test('rejects an over-capacity append batch atomically before writing any of it', async () => {
    const temporary = await createTemporaryDirectory()
    const store = new LocalTraceStore({
      storageDirectory: path.join(temporary, 'traces'),
      maxSegmentBytes: 1_500,
      maxTotalBytes: 3_000
    })
    const inputs = Array.from({ length: 10 }, (_, index) => ({
      traceId: `trace-over-capacity-${index}`,
      source: 'agent-runtime',
      kind: 'lifecycle' as const,
      payload: { phase: 'progress', detail: 'x'.repeat(600), index }
    }))

    await assert.rejects(store.appendMany(inputs), /exceeds the managed storage capacity/u)
    assert.deepEqual((await store.read()).events, [])
  })

  test('normalizes forged identifiers, source, and payload consistently on read and export', async () => {
    const temporary = await createTemporaryDirectory()
    const storageDirectory = path.join(temporary, 'traces')
    const destination = path.join(temporary, 'exports', 'forged.jsonl')
    const now = new Date('2026-07-19T10:00:00.000Z')
    const forgedSecret = 'opaque-forged-identifier-secret'
    const store = new LocalTraceStore({
      storageDirectory,
      now: () => now,
      sensitiveValues: [forgedSecret]
    })
    await store.initialize()
    const forged: TraceEvent = {
      schemaVersion: 'sciforge.trace.v1',
      eventId: forgedSecret,
      traceId: forgedSecret,
      source: forgedSecret,
      runtimeId: forgedSecret,
      threadId: forgedSecret,
      turnId: forgedSecret,
      requestId: forgedSecret,
      parentRequestId: forgedSecret,
      kind: 'model_request',
      timestamp: now.toISOString(),
      recordedAt: now.toISOString(),
      payload: {
        model: forgedSecret,
        body: { prompt: forgedSecret }
      }
    }
    await appendFile(
      path.join(store.directory, '2026-07-19.ndjson'),
      `${JSON.stringify(forged)}\n`,
      'utf8'
    )

    const [readEvent] = (await store.read()).events
    assert.ok(readEvent)
    const stableId = readEvent.traceId
    assert.match(stableId, /^redacted_sha256_[a-f0-9]{64}$/)
    assert.deepEqual([
      readEvent.eventId,
      readEvent.traceId,
      readEvent.source,
      readEvent.runtimeId,
      readEvent.threadId,
      readEvent.turnId,
      readEvent.requestId,
      readEvent.parentRequestId
    ], Array(8).fill(stableId))
    assert.equal(JSON.stringify(readEvent).includes(forgedSecret), false)

    await store.export({ destination })
    const exportedLines = (await readFile(destination, 'utf8')).trim().split('\n')
    const exported = JSON.parse(exportedLines[1] ?? '{}') as TraceEvent
    assert.equal(exported.traceId, stableId)
    assert.equal(exported.eventId, stableId)
    assert.equal(exported.source, stableId)
    assert.equal(JSON.stringify(exported).includes(forgedSecret), false)
  })

  test('derives summaries from the durable events and clears the same store', async () => {
    const temporary = await createTemporaryDirectory()
    let now = new Date('2026-07-19T10:00:00.000Z')
    const store = new LocalTraceStore({ storageDirectory: path.join(temporary, 'traces'), now: () => now })
    const correlation = {
      traceId: deriveTraceId({ runtimeId: 'runtime', threadId: 'thread', turnId: 'turn' }),
      runtimeId: 'runtime',
      threadId: 'thread',
      turnId: 'turn'
    }
    await store.append({
      ...correlation,
      requestId: 'request-1',
      source: 'model-router',
      kind: 'model_request',
      payload: { model: 'test-model', body: { prompt: 'Summarize this paper' } }
    })
    now = new Date('2026-07-19T10:00:01.000Z')
    await store.append({
      ...correlation,
      requestId: 'request-1',
      source: 'model-router',
      kind: 'usage',
      payload: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    })
    await store.append({
      ...correlation,
      source: 'agent-runtime',
      kind: 'agent_event',
      payload: { eventKind: 'tool', event: { name: 'read_file', result: 'ok' } }
    })
    now = new Date('2026-07-19T10:00:02.000Z')
    await store.append({
      ...correlation,
      requestId: 'request-1',
      source: 'model-router',
      kind: 'model_response_end',
      payload: { status: 200, durationMs: 2_000 }
    })

    const [summary] = await store.summaries({ runtimeId: 'runtime' })
    assert.equal(summary.traceId, correlation.traceId)
    assert.equal(summary.model, 'test-model')
    assert.equal(summary.status, 'completed')
    assert.equal(summary.requestCount, 1)
    assert.equal(summary.eventCount, 4)
    assert.equal(summary.agentEventCount, 1)
    assert.equal(summary.durationMs, 2_000)
    assert.deepEqual(summary.sources, ['agent-runtime', 'model-router'])
    assert.deepEqual(summary.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 })
    assert.match(summary.preview ?? '', /Summarize this paper/)

    const cleared = await store.clear()
    assert.equal(cleared.deletedFiles, 1)
    assert.equal(cleared.deletedEvents, 4)
    assert.deepEqual(await store.summaries(), [])
  })

  test('keeps limited reads bounded while preserving exact totals and corrupt-line counts', async () => {
    const temporary = await createTemporaryDirectory()
    let now = new Date('2026-07-18T10:00:00.000Z')
    const store = new LocalTraceStore({
      storageDirectory: path.join(temporary, 'traces'),
      now: () => now
    })
    for (let index = 0; index < 3; index += 1) {
      await store.append({
        traceId: `older-${index}`,
        source: 'agent-runtime',
        kind: 'lifecycle',
        timestamp: `2026-07-18T10:00:0${index}.000Z`,
        payload: { phase: 'completed' }
      })
    }
    await appendFile(path.join(store.directory, '2026-07-18.ndjson'), '{not-json}\n', 'utf8')
    now = new Date('2026-07-19T10:00:00.000Z')
    for (let index = 0; index < 2; index += 1) {
      await store.append({
        traceId: `newer-${index}`,
        source: 'agent-runtime',
        kind: 'lifecycle',
        timestamp: `2026-07-19T10:00:0${index}.000Z`,
        payload: { phase: 'completed' }
      })
    }

    const descending = await store.read({ order: 'desc', limit: 2 })
    assert.deepEqual(descending.events.map((event) => event.traceId), ['newer-1', 'newer-0'])
    assert.equal(descending.events.length, 2)
    assert.equal(descending.total, 5)
    assert.equal(descending.corruptLines, 1)

    const ascending = await store.read({ order: 'asc', limit: 2 })
    assert.deepEqual(ascending.events.map((event) => event.traceId), ['older-0', 'older-1'])
    assert.equal(ascending.total, 5)
    assert.equal(ascending.corruptLines, 1)
  })

  test('streams summaries and exports without materializing a full read result', async () => {
    class StreamingOnlyTraceStore extends LocalTraceStore {
      override async read(): Promise<never> {
        throw new Error('summary and export paths must not materialize read().events')
      }
    }

    const temporary = await createTemporaryDirectory()
    const destination = path.join(temporary, 'exports', 'streamed.jsonl')
    const store = new StreamingOnlyTraceStore({
      storageDirectory: path.join(temporary, 'traces'),
      now: () => new Date('2026-07-19T10:00:00.000Z')
    })
    const largePrompt = 'large-prompt '.repeat(40_000)
    for (const index of [1, 3, 0, 2]) {
      await store.appendMany([
        {
          traceId: `trace-${index}`,
          requestId: `request-${index}`,
          source: 'model-router',
          kind: 'model_request',
          timestamp: `2026-07-19T10:00:0${index}.000Z`,
          payload: { model: 'test-model', body: { prompt: largePrompt, index } }
        },
        {
          traceId: `trace-${index}`,
          requestId: `request-${index}`,
          source: 'model-router',
          kind: 'model_response_end',
          timestamp: `2026-07-19T10:00:0${index}.100Z`,
          payload: { status: 200 }
        }
      ])
    }

    const summaries = await store.summaries({ order: 'desc', limit: 1 })
    assert.deepEqual(summaries.map((summary) => summary.traceId), ['trace-3'])
    assert.equal(summaries[0]?.preview?.length, 240)
    const requests = await store.requestSummaries({ order: 'desc', limit: 2 })
    assert.deepEqual(requests.map((summary) => summary.requestId), ['request-3', 'request-2'])
    assert.equal(requests.every((summary) => (summary.preview?.length ?? 0) <= 240), true)

    const exported = await store.export({ destination })
    assert.equal(exported.eventCount, 8)
    assert.equal(exported.traceCount, 4)
    const exportedLines = (await readFile(destination, 'utf8')).trim().split('\n')
    assert.equal(exportedLines.length, 9)
    assert.deepEqual(
      exportedLines.slice(1).map((line) => (JSON.parse(line) as TraceEvent).traceId),
      ['trace-0', 'trace-0', 'trace-1', 'trace-1', 'trace-2', 'trace-2', 'trace-3', 'trace-3']
    )
    assert.deepEqual(await readdir(path.dirname(destination)), ['streamed.jsonl'])
  })

  test('fails a high-cardinality summary scan before it can exhaust the process heap', async () => {
    const temporary = await createTemporaryDirectory()
    const storageDirectory = path.join(temporary, 'traces')
    const store = new LocalTraceStore({ storageDirectory })
    await store.initialize()
    const timestamp = '2026-07-19T10:00:00.000Z'
    const lines = Array.from({ length: 20_000 }, (_, index) => JSON.stringify({
      schemaVersion: 'sciforge.trace.v1',
      eventId: `event-${index}`,
      traceId: `trace-${index}`,
      source: 'agent-runtime',
      kind: 'lifecycle',
      timestamp,
      recordedAt: timestamp,
      payload: { phase: 'completed' }
    })).join('\n')
    await writeFile(path.join(storageDirectory, '2026-07-19.ndjson'), `${lines}\n`, { mode: 0o600 })

    await assert.rejects(store.summaries({ order: 'desc', limit: 1 }), (error: unknown) => (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === 'TRACE_SUMMARY_CAPACITY_EXCEEDED'
    ))
  })

  test('derives request views and excludes child-attempt failures and usage from trajectory cards', async () => {
    const temporary = await createTemporaryDirectory()
    const recordedAt = new Date('2026-07-19T11:00:00.000Z')
    const store = new LocalTraceStore({
      storageDirectory: path.join(temporary, 'traces'),
      now: () => recordedAt
    })
    const traceId = 'trace-request-summaries'
    const rootRequestId = 'request-root'
    const childFailureId = 'request-child-failure'
    const childSuccessId = 'request-child-success'
    await store.appendMany([
      {
        traceId,
        requestId: rootRequestId,
        source: 'generic-client',
        kind: 'model_request',
        timestamp: '2026-07-19T10:00:00.000Z',
        payload: { model: 'test-model', protocol: 'responses', body: { input: 'root' } }
      },
      {
        traceId,
        requestId: rootRequestId,
        source: 'generic-client',
        kind: 'usage',
        timestamp: '2026-07-19T10:00:00.040Z',
        eventId: 'z-usage-after-response-end',
        payload: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
      },
      {
        traceId,
        requestId: childFailureId,
        parentRequestId: rootRequestId,
        source: 'generic-client',
        kind: 'model_request',
        timestamp: '2026-07-19T10:00:00.020Z',
        payload: { model: 'test-model', protocol: 'responses', retry: 1, body: { input: 'retry 1' } }
      },
      {
        traceId,
        requestId: childFailureId,
        parentRequestId: rootRequestId,
        source: 'generic-client',
        kind: 'usage',
        timestamp: '2026-07-19T10:00:00.021Z',
        payload: { inputTokens: 9, outputTokens: 3, totalTokens: 12 }
      },
      {
        traceId,
        requestId: childFailureId,
        parentRequestId: rootRequestId,
        source: 'generic-client',
        kind: 'error',
        timestamp: '2026-07-19T10:00:00.022Z',
        payload: { message: 'temporary upstream failure' }
      },
      {
        traceId,
        requestId: childFailureId,
        parentRequestId: rootRequestId,
        source: 'generic-client',
        kind: 'model_response_end',
        timestamp: '2026-07-19T10:00:00.023Z',
        payload: { status: 500, usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12 } }
      },
      {
        traceId,
        requestId: childSuccessId,
        parentRequestId: rootRequestId,
        source: 'generic-client',
        kind: 'model_request',
        timestamp: '2026-07-19T10:00:00.030Z',
        payload: { model: 'test-model', protocol: 'responses', retry: 2, body: { input: 'retry 2' } }
      },
      {
        traceId,
        requestId: childSuccessId,
        parentRequestId: rootRequestId,
        source: 'generic-client',
        kind: 'model_response_end',
        timestamp: '2026-07-19T10:00:00.031Z',
        payload: { status: 200, usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } }
      },
      {
        traceId,
        source: 'agent-runtime',
        kind: 'agent_event',
        timestamp: '2026-07-19T10:00:00.035Z',
        payload: { eventKind: 'tool', event: { name: 'read_file', result: 'ok' } }
      },
      {
        traceId,
        requestId: rootRequestId,
        source: 'generic-client',
        kind: 'model_response_end',
        timestamp: '2026-07-19T10:00:00.040Z',
        eventId: 'a-response-end-before-usage',
        payload: { status: 200, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } }
      }
    ])

    const all = await store.requestSummaries({ order: 'asc', scope: 'all' })
    assert.equal(all.length, 3)
    assert.deepEqual(all.map((summary) => summary.requestId), [
      rootRequestId,
      childFailureId,
      childSuccessId
    ])
    assert.deepEqual(all[0], {
      requestId: rootRequestId,
      traceId,
      sources: ['generic-client'],
      model: 'test-model',
      protocol: 'responses',
      startedAt: '2026-07-19T10:00:00.000Z',
      endedAt: '2026-07-19T10:00:00.040Z',
      durationMs: 40,
      status: 'completed',
      eventCount: 3,
      childRequestCount: 2,
      errorCount: 0,
      preview: '{"input":"root"}',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
    })
    assert.equal(all[1]?.status, 'error')
    assert.equal(all[1]?.errorCount, 1)
    assert.deepEqual(all[1]?.usage, { inputTokens: 9, outputTokens: 3, totalTokens: 12 })
    assert.equal(all[2]?.status, 'completed')
    assert.deepEqual(all[2]?.usage, { inputTokens: 20, outputTokens: 10, totalTokens: 30 })

    const roots = await store.requestSummaries({ scope: 'roots' })
    assert.deepEqual(roots.map((summary) => summary.requestId), [rootRequestId])
    const [latestStarted] = await store.requestSummaries({ order: 'desc', limit: 1 })
    assert.equal(latestStarted?.requestId, childSuccessId)
    const childEvents = await store.read({ parentRequestId: rootRequestId })
    assert.equal(childEvents.events.length, 6)
    assert.deepEqual(
      new Set(childEvents.events.map((event) => event.requestId)),
      new Set([childFailureId, childSuccessId])
    )

    const [trajectory] = await store.summaries({ order: 'asc' })
    assert.equal(trajectory.status, 'completed')
    assert.equal(trajectory.requestCount, 1)
    assert.equal(trajectory.errorCount, 0)
    assert.deepEqual(trajectory.usage, { inputTokens: 100, outputTokens: 50, totalTokens: 150 })
  })

  test('keeps identical request identifiers isolated between traces', async () => {
    const temporary = await createTemporaryDirectory()
    const store = new LocalTraceStore({ storageDirectory: path.join(temporary, 'traces') })
    await store.appendMany([
      {
        traceId: 'trace-a',
        requestId: 'shared-request',
        source: 'generic-client',
        kind: 'model_request',
        timestamp: '2026-07-19T10:00:00.000Z',
        payload: { model: 'model-a', body: 'first' }
      },
      {
        traceId: 'trace-a',
        requestId: 'shared-request',
        source: 'generic-client',
        kind: 'model_response_end',
        timestamp: '2026-07-19T10:00:00.010Z',
        payload: { status: 200 }
      },
      {
        traceId: 'trace-b',
        requestId: 'shared-request',
        source: 'generic-client',
        kind: 'model_request',
        timestamp: '2026-07-19T10:00:01.000Z',
        payload: { model: 'model-b', body: 'second' }
      },
      {
        traceId: 'trace-b',
        requestId: 'shared-request',
        source: 'generic-client',
        kind: 'model_response_end',
        timestamp: '2026-07-19T10:00:01.010Z',
        payload: { status: 503 }
      }
    ])

    const summaries = await store.requestSummaries({ order: 'asc' })
    assert.deepEqual(summaries.map(({ traceId, model, status }) => ({ traceId, model, status })), [
      { traceId: 'trace-a', model: 'model-a', status: 'completed' },
      { traceId: 'trace-b', model: 'model-b', status: 'error' }
    ])
  })

  test('hashes credential-shaped identifiers once and keeps correlation stable when keys rotate', async () => {
    const temporary = await createTemporaryDirectory()
    let activeSecrets = ['identifier-secret-one']
    const store = new LocalTraceStore({
      storageDirectory: path.join(temporary, 'traces'),
      sensitiveValues: () => activeSecrets
    })
    const first = await store.append({
      eventId: 'identifier-secret-one',
      traceId: 'identifier-secret-one',
      runtimeId: 'identifier-secret-one',
      threadId: 'ordinary-prefix-remains',
      requestId: 'identifier-secret-one',
      source: 'model-router',
      kind: 'lifecycle',
      payload: { phase: 'started', echoed: 'identifier-secret-one' }
    })
    assert.match(first.traceId, /^redacted_sha256_[a-f0-9]{64}$/)
    assert.equal(first.eventId, first.traceId)
    assert.equal(first.runtimeId, first.traceId)
    assert.equal(first.requestId, first.traceId)
    assert.equal(first.threadId, 'ordinary-prefix-remains')
    assert.equal(JSON.stringify(first).includes('identifier-secret-one'), false)

    activeSecrets = ['identifier-secret-two']
    const [readBack] = (await store.read()).events
    assert.equal(readBack?.traceId, first.traceId)
    assert.equal(readBack?.eventId, first.eventId)
    assert.equal(readBack?.runtimeId, first.runtimeId)
    assert.equal(readBack?.requestId, first.requestId)
  })

  test('removes events older than the configured retention period at most daily', async () => {
    const temporary = await createTemporaryDirectory()
    let now = new Date('2026-06-01T10:00:00.000Z')
    const store = new LocalTraceStore({
      storageDirectory: path.join(temporary, 'traces'),
      retentionDays: 30,
      now: () => now
    })
    await store.append({
      traceId: 'trace-old',
      source: 'agent-runtime',
      kind: 'lifecycle',
      payload: { phase: 'completed' }
    })

    now = new Date('2026-07-19T10:00:00.000Z')
    const pruned = await store.pruneExpired({ force: true })
    assert.equal(pruned.ran, true)
    assert.equal(pruned.deletedFiles, 1)
    assert.equal(pruned.deletedEvents, 1)
    assert.equal((await store.pruneExpired()).ran, false)

    await store.append({
      traceId: 'trace-current',
      source: 'agent-runtime',
      kind: 'lifecycle',
      payload: { phase: 'started' }
    })
    assert.deepEqual((await store.read()).events.map((event) => event.traceId), ['trace-current'])
  })

  test('retains the exact 30-day boundary and compacts only expired events in its segment', async () => {
    const temporary = await createTemporaryDirectory()
    let now = new Date('2026-06-19T09:59:59.999Z')
    const store = new LocalTraceStore({
      storageDirectory: path.join(temporary, 'traces'),
      retentionDays: 30,
      now: () => now
    })
    await store.append({
      traceId: 'trace-expired',
      source: 'agent-runtime',
      kind: 'lifecycle',
      payload: { phase: 'completed' }
    })
    now = new Date('2026-06-19T10:00:00.000Z')
    await store.append({
      traceId: 'trace-boundary',
      source: 'agent-runtime',
      kind: 'lifecycle',
      payload: { phase: 'completed' }
    })

    now = new Date('2026-07-19T10:00:00.000Z')
    const pruned = await store.pruneExpired({ force: true })
    assert.equal(pruned.deletedFiles, 0)
    assert.equal(pruned.deletedEvents, 1)
    assert.deepEqual((await store.read()).events.map((event) => event.traceId), ['trace-boundary'])
    const retainedSegment = (await readdir(store.directory)).find((name) => (
      /^2026-06-19\.\d{6}\.ndjson$/u.test(name)
    ))
    assert.ok(retainedSegment)
    assert.equal((await lstat(path.join(store.directory, retainedSegment))).mode & 0o777, 0o600)
    assert.equal((await readdir(store.directory)).some((entry) => entry.endsWith('.tmp')), false)
  })

  test('keeps JSONL records intact across concurrent store instances', async () => {
    const temporary = await createTemporaryDirectory()
    const storageDirectory = path.join(temporary, 'traces')
    const now = new Date('2026-07-19T10:00:00.000Z')
    const first = new LocalTraceStore({ storageDirectory, now: () => now, maxSegmentBytes: 1_500 })
    const second = new LocalTraceStore({ storageDirectory, now: () => now, maxSegmentBytes: 1_500 })
    await Promise.all([first.initialize(), second.initialize()])

    await Promise.all(Array.from({ length: 100 }, (_, index) => {
      const store = index % 2 === 0 ? first : second
      return store.append({
        traceId: `trace-${index}`,
        source: 'agent-runtime',
        kind: 'lifecycle',
        payload: { phase: 'started', detail: 'x'.repeat(180), index }
      })
    }))

    const result = await first.read()
    assert.equal(result.corruptLines, 0)
    assert.equal(result.events.length, 100)
    assert.equal(new Set(result.events.map((event) => event.traceId)).size, 100)
    const segments = (await readdir(storageDirectory)).filter((entry) => entry.endsWith('.ndjson'))
    assert.ok(segments.length > 1)
    for (const segment of segments) {
      assert.ok((await stat(path.join(storageDirectory, segment))).size <= first.maxSegmentBytes)
    }
  })

  test('serializes concurrent retention maintenance across store instances', async () => {
    const temporary = await createTemporaryDirectory()
    const storageDirectory = path.join(temporary, 'traces')
    let now = new Date('2026-06-01T10:00:00.000Z')
    const first = new LocalTraceStore({ storageDirectory, now: () => now, retentionDays: 30 })
    const second = new LocalTraceStore({ storageDirectory, now: () => now, retentionDays: 30 })
    await Promise.all([first.initialize(), second.initialize()])
    await first.append({
      traceId: 'trace-expired-concurrently',
      source: 'agent-runtime',
      kind: 'lifecycle',
      payload: { phase: 'completed' }
    })

    now = new Date('2026-08-01T10:00:00.000Z')
    const results = await Promise.all([
      first.pruneExpired({ force: true }),
      second.pruneExpired({ force: true })
    ])

    assert.equal(results.reduce((sum, result) => sum + result.deletedFiles, 0), 1)
    assert.deepEqual((await first.read()).events, [])
  })

  test('reclaims a stale mutation lease left by a terminated writer process', async () => {
    const temporary = await createTemporaryDirectory()
    const storageDirectory = path.join(temporary, 'traces')
    const lockDirectory = path.join(storageDirectory, '.writer.lock')
    await mkdir(lockDirectory, { recursive: true, mode: 0o700 })
    const ownerFile = path.join(lockDirectory, 'owner.json')
    await writeFile(ownerFile, `${JSON.stringify({
      pid: 2_147_483_647,
      createdAt: '2026-01-01T00:00:00.000Z',
      heartbeatAt: '2026-01-01T00:00:00.000Z',
      token: 'terminated-writer-process'
    })}\n`, { mode: 0o600 })
    await utimes(ownerFile, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'))

    const store = new LocalTraceStore({ storageDirectory })
    await store.initialize()

    assert.equal((await readdir(storageDirectory)).includes('.writer.lock'), false)
  })

  test('rejects an indivisible event larger than the segment limit before writing', async () => {
    const temporary = await createTemporaryDirectory()
    const storageDirectory = path.join(temporary, 'traces')
    const store = new LocalTraceStore({
      storageDirectory,
      maxSegmentBytes: 1_024,
      maxTotalBytes: 8_192
    })

    await assert.rejects(store.append({
      traceId: 'trace-oversized-line',
      source: 'agent-runtime',
      kind: 'lifecycle',
      payload: { phase: 'completed', detail: 'x'.repeat(2_048) }
    }), (error: unknown) => (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === 'TRACE_SEGMENT_EVENT_TOO_LARGE'
    ))
    assert.deepEqual((await store.read()).events, [])
  })

  test('rejects a symbolic-link storage directory', async () => {
    const temporary = await createTemporaryDirectory()
    const target = path.join(temporary, 'target')
    const storage = path.join(temporary, 'storage-link')
    await mkdir(target)
    await chmod(target, 0o700)
    await symlink(target, storage)
    const store = new LocalTraceStore({ storageDirectory: storage })
    await assert.rejects(store.initialize(), /symbolic link/)
  })
})

test('deriveTraceId is stable, scoped, and does not expose source identifiers', () => {
  const first = deriveTraceId({ runtimeId: 'runtime', threadId: 'thread', turnId: 'turn' })
  const repeated = deriveTraceId({ runtimeId: 'runtime', threadId: 'thread', turnId: 'turn' })
  const otherTurn = deriveTraceId({ runtimeId: 'runtime', threadId: 'thread', turnId: 'other' })
  assert.equal(first, repeated)
  assert.notEqual(first, otherTurn)
  assert.equal(first.includes('runtime'), false)
  assert.match(first, /^trace_[a-f0-9]{32}$/)
})

test('deriveExecutionTraceId is stable and scoped to owner plus execution', () => {
  const first = deriveExecutionTraceId({ moduleId: 'domain.create-loop', executionId: 'run-1' })
  const repeated = deriveExecutionTraceId({ moduleId: 'domain.create-loop', executionId: 'run-1' })
  const other = deriveExecutionTraceId({ moduleId: 'domain.create-loop', executionId: 'run-2' })
  assert.equal(first, repeated)
  assert.notEqual(first, other)
  assert.equal(first.includes('create-loop'), false)
  assert.match(first, /^trace_[a-f0-9]{32}$/)
})

test('execution events complete the same durable trace summary', async () => {
  const directory = await createTemporaryDirectory()
  const store = new LocalTraceStore({ storageDirectory: directory })
  const traceId = deriveExecutionTraceId({ moduleId: 'domain.create-loop', executionId: 'run-1' })
  await store.append({
    traceId,
    source: 'domain-execution:domain.create-loop',
    kind: 'execution_event',
    payload: {
      schemaVersion: 'sciforge.execution-event.v1',
      phase: 'run_completed',
      producer: { moduleId: 'domain.create-loop', moduleVersion: '1.0.0' },
      executionId: 'run-1',
      runId: 'run-1',
      event: { artifacts: [] }
    }
  })
  const summaries = await store.summaries({ traceIds: [traceId] })
  assert.equal(summaries[0]?.status, 'completed')
  assert.equal(summaries[0]?.preview, 'domain.create-loop · run-1')
})

test('execution event replay is idempotent by stable eventId and rejects collisions', async () => {
  const directory = await createTemporaryDirectory()
  const store = new LocalTraceStore({ storageDirectory: directory })
  const input = {
    eventId: 'execution-event-stable',
    traceId: 'trace-execution-stable',
    source: 'domain-execution:domain.create-loop',
    kind: 'execution_event' as const,
    timestamp: '2026-08-05T00:00:00.000Z',
    payload: {
      schemaVersion: 'sciforge.execution-event.v1' as const,
      phase: 'run_completed',
      producer: { moduleId: 'domain.create-loop', moduleVersion: '1.0.0' },
      executionId: 'execution-stable',
      runId: 'run-stable',
      event: { artifacts: [] }
    }
  }

  const first = await store.append(input)
  const replayed = await store.append(input)
  assert.equal(replayed.recordedAt, first.recordedAt)
  assert.equal((await store.read({ traceIds: [input.traceId] })).total, 1)
  await assert.rejects(
    store.append({
      ...input,
      payload: { ...input.payload, phase: 'run_failed' }
    }),
    /eventId collision/u
  )
})

test('serializes execution event collision checks across store instances', async () => {
  const directory = await createTemporaryDirectory()
  const first = new LocalTraceStore({ storageDirectory: directory })
  const second = new LocalTraceStore({ storageDirectory: directory })
  const base = {
    eventId: 'execution-event-concurrent',
    traceId: 'trace-execution-concurrent',
    source: 'domain-execution:domain.create-loop',
    kind: 'execution_event' as const,
    timestamp: '2026-08-05T00:00:00.000Z'
  }
  const payload = (phase: 'run_completed' | 'run_failed') => ({
    schemaVersion: 'sciforge.execution-event.v1' as const,
    phase,
    producer: { moduleId: 'domain.create-loop', moduleVersion: '1.0.0' },
    executionId: 'execution-concurrent',
    runId: 'run-concurrent',
    event: { artifacts: [] }
  })

  const results = await Promise.allSettled([
    first.append({ ...base, payload: payload('run_completed') }),
    second.append({ ...base, payload: payload('run_failed') })
  ])

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  assert.match(String((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason), /eventId collision/u)
  assert.equal((await first.read({ eventIds: [base.eventId] })).total, 1)
})

test('exact event id reads are bounded and retain only matching trace records', async () => {
  const directory = await createTemporaryDirectory()
  const store = new LocalTraceStore({ storageDirectory: directory })
  const input = (eventId: string, sequence: number) => ({
    eventId,
    traceId: `trace-lookup-${sequence}`,
    source: 'full-trace-test',
    kind: 'lifecycle' as const,
    timestamp: `2026-08-05T00:00:0${sequence}.000Z`,
    payload: { phase: `phase-${sequence}` }
  })
  await store.appendMany([
    input('lookup-first', 1),
    input('lookup-second', 2),
    input('lookup-third', 3)
  ])

  const exact = await store.read({ eventIds: ['lookup-second'] })
  assert.equal(exact.total, 1)
  assert.deepEqual(exact.events.map((event) => event.eventId), ['lookup-second'])
  await assert.rejects(
    store.read({ eventIds: ['lookup-second', 'lookup-second'] }),
    /unique bounded identifiers/u
  )
  await assert.rejects(
    store.read({ eventIds: Array.from({ length: 10_001 }, (_, index) => `event-${index}`) }),
    /at most 10000/u
  )

  // A forged segment cannot turn one exact-id migration into unbounded memory.
  await store.appendMany([
    input('lookup-duplicated', 4),
    input('lookup-duplicated', 5),
    input('lookup-duplicated', 6)
  ])
  await assert.rejects(
    store.read({ eventIds: ['lookup-duplicated'] }),
    /too many durable records/u
  )
  await assert.rejects(
    store.read({
      eventIds: ['lookup-duplicated'],
      traceIds: ['trace-lookup-4']
    }),
    /too many durable records/u
  )
})

test('correlation headers carry one contract across process boundaries', () => {
  const correlation = {
    traceId: 'trace-1',
    runtimeId: 'runtime-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    requestId: 'request-1',
    parentRequestId: 'request-parent'
  }
  const headers = traceCorrelationHeaders(correlation)
  assert.deepEqual(traceCorrelationFromHeaders(headers), correlation)
  assert.deepEqual(traceCorrelationFromHeaders(new Headers(headers)), correlation)
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sciforge-full-trace-'))
  temporaryDirectories.push(directory)
  return directory
}
