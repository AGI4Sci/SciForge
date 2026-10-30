import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { LocalTraceStore, type TraceEventInput } from '@sciforge/full-trace'

import { ModelRouterFullTraceWorkerSink } from './full-trace-worker-sink.js'

test('persists Full Trace batches through the isolated writer worker', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-writer-'))
  const secret = 'opaque-cross-chunk-secret'
  const sink = new ModelRouterFullTraceWorkerSink({ userDataDirectory })
  const events: TraceEventInput[] = [{
    traceId: 'trace-worker',
    requestId: 'request-worker',
    source: 'model-router',
    kind: 'model_request',
    payload: {
      headers: { 'x-api-key': secret },
      body: { echoedCredential: secret, value: 'writer-test' }
    }
  }, {
    traceId: 'trace-worker',
    requestId: 'request-worker',
    source: 'model-router',
    kind: 'model_response_chunk',
    payload: { index: 0, body: 'opaque-cross-' }
  }, {
    traceId: 'trace-worker',
    requestId: 'request-worker',
    source: 'model-router',
    kind: 'model_response_chunk',
    payload: { index: 1, body: 'chunk-secret' }
  }]

  try {
    assert.deepEqual(sink.status(), { state: 'starting' })
    await sink.initialize()
    assert.deepEqual(sink.status(), { state: 'ready' })
    await sink.appendMany(events)
    await sink.close()

    const store = new LocalTraceStore({ userDataDirectory })
    const stored = await store.read({ traceIds: ['trace-worker'] })
    assert.equal(stored.events.length, 2)
    const serialized = JSON.stringify(stored.events)
    assert.equal(serialized.includes(secret), false)
    assert.equal(serialized.includes('[REDACTED]'), true)
  } finally {
    await sink.close()
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('surfaces writer initialization failures instead of leaving capture apparently ready', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-writer-failure-'))
  const sink = new ModelRouterFullTraceWorkerSink({
    userDataDirectory,
    moduleUrl: 'file:///missing/sciforge-full-trace.js'
  })

  try {
    await assert.rejects(sink.initialize(), /Cannot find module/)
    assert.equal(sink.status().state, 'failed')
  } finally {
    await sink.close()
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('closes once and rejects appends that race with shutdown', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-writer-close-'))
  const sink = new ModelRouterFullTraceWorkerSink({ userDataDirectory })

  try {
    await sink.initialize()
    const firstClose = sink.close()
    const secondClose = sink.close()
    assert.equal(firstClose, secondClose)
    await assert.rejects(sink.appendMany([]), /closing/)
    await firstClose
    assert.equal(sink.status().state, 'closed')
  } finally {
    await sink.close()
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})

test('can cancel a writer that is still initializing', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-writer-cancel-'))
  const sink = new ModelRouterFullTraceWorkerSink({ userDataDirectory })
  const initialization = sink.initialize()
  const initializationFailure = assert.rejects(initialization, /closed during initialization/)

  try {
    await sink.close()
    await initializationFailure
    assert.equal(sink.status().state, 'closed')
  } finally {
    await sink.close()
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
