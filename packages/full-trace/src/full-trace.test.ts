import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  LocalTraceStore,
  TRACE_REDACTION_MARKER,
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
    const segment = path.join(store.directory, '2026-07-19.ndjson')
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
    assert.equal((await lstat(path.join(store.directory, '2026-06-19.ndjson'))).mode & 0o777, 0o600)
  })

  test('keeps JSONL records intact across concurrent store instances', async () => {
    const temporary = await createTemporaryDirectory()
    const storageDirectory = path.join(temporary, 'traces')
    const now = new Date('2026-07-19T10:00:00.000Z')
    const first = new LocalTraceStore({ storageDirectory, now: () => now })
    const second = new LocalTraceStore({ storageDirectory, now: () => now })
    await Promise.all([first.initialize(), second.initialize()])

    await Promise.all(Array.from({ length: 100 }, (_, index) => {
      const store = index % 2 === 0 ? first : second
      return store.append({
        traceId: `trace-${index}`,
        source: 'agent-runtime',
        kind: 'lifecycle',
        payload: { phase: 'started', index }
      })
    }))

    const result = await first.read()
    assert.equal(result.corruptLines, 0)
    assert.equal(result.events.length, 100)
    assert.equal(new Set(result.events.map((event) => event.traceId)).size, 100)
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
