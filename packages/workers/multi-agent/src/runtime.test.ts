import assert from 'node:assert/strict'
import test from 'node:test'
import { MultiAgentChildRunRecord, type MultiAgentChildEvent, type MultiAgentExecutorResult } from './contract.js'
import { MultiAgentRuntime, MultiAgentRuntimeError } from './runtime.js'
import { InMemoryMultiAgentStore } from './store.js'

test('runtime persists queued/running/completed records through an injected executor', async () => {
  const store = new InMemoryMultiAgentStore()
  const events: MultiAgentChildEvent[] = []
  const usageRecords: unknown[] = []
  const runtime = new MultiAgentRuntime({
    config: { maxParallel: 1, maxChildren: 2 },
    store,
    idGenerator: () => 'child-1',
    nowIso: clock(),
    events: {
      onChildEvent: (event) => events.push(event)
    },
    recordUsage: (_threadId, usage) => usageRecords.push(usage),
    executor: async (input) => {
      assert.equal(input.childId, 'child-1')
      assert.equal(input.model, 'router-model')
      assert.deepEqual(input.allowedToolNames, ['bash', 'delegate_tasks'])
      assert.equal(input.strictAllowedToolNames, true)
      assert.deepEqual(input.bashCommandPolicy, { allowPatterns: ['^python3 '] })
      assert.deepEqual(input.filePathPolicy, { allowPaths: ['/workspace'] })
      assert.equal(input.maxToolCalls, 12)
      assert.equal(input.signal.aborted, false)
      await input.appendTranscript({
        id: 'tool-1',
        kind: 'tool',
        summary: 'Read notes',
        text: '{}',
        createdAt: '2026-06-27T00:00:03.000Z'
      })
      return {
        summary: 'Done',
        usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
        transcript: [{ id: 'assistant-1', kind: 'assistant_message', text: 'Done' }],
        threadRef: { threadId: 'child-thread-1' }
      }
    }
  })

  const record = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    label: 'Notes',
    prompt: '  Summarize notes  ',
    workspace: '/workspace',
    model: 'router-model',
    allowedToolNames: ['bash', 'delegate_tasks', 'bash'],
    strictAllowedToolNames: true,
    bashCommandPolicy: { allowPatterns: ['^python3 '] },
    filePathPolicy: { allowPaths: ['/workspace'] },
    maxToolCalls: 12
  })

  assert.equal(record.status, 'completed')
  assert.equal(record.summary, 'Done')
  assert.deepEqual(record.usage, { promptTokens: 2, completionTokens: 3, totalTokens: 5 })
  assert.deepEqual(record.transcript.map((entry) => entry.id), ['child-1-prompt', 'tool-1', 'assistant-1'])
  assert.equal(record.threadRef?.threadId, 'child-thread-1')
  assert.deepEqual(events.map((event) => event.status), ['queued', 'running', 'running', 'completed'])
  assert.equal(usageRecords.length, 1)

  const diagnostics = await runtime.diagnostics('thread-1')
  assert.equal(diagnostics.statusCounts.completed, 1)
  assert.equal(diagnostics.usage.totalTokens, 5)
  assert.equal(diagnostics.aggregates[0]?.key, 'Notes:router-model')
})

test('runtime merges streamed transcript updates by entry id', async () => {
  const store = new InMemoryMultiAgentStore()
  const runtime = new MultiAgentRuntime({
    store,
    idGenerator: () => 'child-streamed',
    nowIso: clock(),
    executor: async (input) => {
      await input.appendTranscript({
        id: 'tool-1',
        kind: 'tool',
        summary: 'Read notes',
        text: '{"status":"running"}',
        status: 'running',
        createdAt: '2026-06-27T00:00:03.000Z'
      })
      await input.appendTranscript({
        id: 'tool-1',
        kind: 'tool',
        summary: 'Read notes result',
        text: '{"status":"completed"}',
        status: 'completed',
        createdAt: '2026-06-27T00:00:03.000Z'
      })
      return { summary: 'Done' }
    }
  })

  const record = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Summarize notes'
  })

  assert.equal(record.transcript.filter((entry) => entry.id === 'tool-1').length, 1)
  assert.deepEqual(record.transcript.find((entry) => entry.id === 'tool-1'), {
    id: 'tool-1',
    kind: 'tool',
    summary: 'Read notes result',
    text: '{"status":"completed"}',
    status: 'completed',
    createdAt: '2026-06-27T00:00:03.000Z'
  })
})

test('runtime preserves an explicit empty child tool allow-list', async () => {
  const runtime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-no-tools',
    executor: async (input) => {
      assert.deepEqual(input.allowedToolNames, [])
      assert.equal(input.strictAllowedToolNames, true)
      return { summary: 'No tools advertised.' }
    }
  })

  await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Collect sources only if tools are available.',
    allowedToolNames: [],
    strictAllowedToolNames: true
  })
})

test('runtime drops runtime-only usage fields returned by child executors', async () => {
  const runtime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-usage',
    executor: async () => ({
      summary: 'Done',
      usage: {
        promptTokens: 2,
        completionTokens: 3,
        totalTokens: 5,
        hasError: false
      } as never
    })
  })

  const record = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Summarize'
  })

  assert.equal(record.status, 'completed')
  assert.deepEqual(record.usage, { promptTokens: 2, completionTokens: 3, totalTokens: 5 })
})

test('runtime requires a host-injected executor and does not create a fallback child run', async () => {
  const store = new InMemoryMultiAgentStore()
  const runtime = new MultiAgentRuntime({ store })

  await assert.rejects(
    runtime.runChild({
      parentThreadId: 'thread-1',
      parentTurnId: 'turn-1',
      prompt: 'Do work'
    }),
    (error) => error instanceof MultiAgentRuntimeError && error.code === 'executor_missing'
  )
  assert.deepEqual(await store.list(), [])
})

test('runtime enforces maxParallel while a child run is active', async () => {
  const entered = deferred<void>()
  const release = deferred<MultiAgentExecutorResult>()
  const store = new InMemoryMultiAgentStore()
  const runtime = new MultiAgentRuntime({
    config: { maxParallel: 1, maxChildren: 1 },
    store,
    idGenerator: sequenceIds('child'),
    executor: async () => {
      entered.resolve()
      return release.promise
    }
  })

  const first = runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'First'
  })
  await entered.promise
  const liveDiagnostics = await runtime.diagnostics('thread-1')
  assert.equal(liveDiagnostics.active, 1)
  assert.equal(liveDiagnostics.statusCounts.running, 1)

  await assert.rejects(
    runtime.runChild({
      parentThreadId: 'thread-1',
      parentTurnId: 'turn-2',
      prompt: 'Second'
    }),
    (error) => error instanceof MultiAgentRuntimeError && error.code === 'parallel_budget_exhausted'
  )

  release.resolve({ summary: 'First done' })
  await first
})

test('runtime enforces maxChildren per parent turn without exhausting later turns', async () => {
  const store = new InMemoryMultiAgentStore()
  const runtime = new MultiAgentRuntime({
    config: { maxParallel: 1, maxChildren: 1 },
    store,
    idGenerator: sequenceIds('child'),
    executor: async (input) => ({ summary: `${input.parentTurnId} done` })
  })

  const first = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'First'
  })
  assert.equal(first.status, 'completed')

  await assert.rejects(
    runtime.runChild({
      parentThreadId: 'thread-1',
      parentTurnId: 'turn-1',
      prompt: 'Second child in same turn'
    }),
    (error) => error instanceof MultiAgentRuntimeError && error.code === 'child_budget_exhausted'
  )

  const third = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-3',
    prompt: 'Third'
  })
  assert.equal(third.status, 'completed')
})

test('runtime reuses a persisted request before budget checks or executor startup', async () => {
  const store = new InMemoryMultiAgentStore()
  const firstExecutor = async () => ({ summary: 'persisted result' })
  const firstRuntime = new MultiAgentRuntime({
    config: { maxParallel: 1, maxChildren: 1 },
    store,
    idGenerator: () => 'child-persisted',
    executor: firstExecutor
  })
  const first = await firstRuntime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    requestId: 'request-1',
    prompt: 'Run once'
  })

  let replayExecutorCalls = 0
  const restartedRuntime = new MultiAgentRuntime({
    config: { maxParallel: 0, maxChildren: 0 },
    store,
    executor: async () => {
      replayExecutorCalls += 1
      return { summary: 'must not execute' }
    }
  })
  const replayed = await restartedRuntime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    requestId: 'request-1',
    prompt: 'A replay may carry different arguments'
  })

  assert.equal(replayed.id, first.id)
  assert.equal(replayed.summary, 'persisted result')
  assert.equal(replayExecutorCalls, 0)
  assert.equal((await store.list()).length, 1)
})

test('runtime diagnostics hide stale persisted active records after restart', async () => {
  const store = new InMemoryMultiAgentStore()
  await store.upsert(MultiAgentChildRunRecord.parse({
    id: 'child-stale',
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    label: 'stale-worker',
    prompt: 'Do work',
    model: 'router-model',
    status: 'running',
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    transcript: [{
      id: 'child-stale-prompt',
      kind: 'user_message',
      text: 'Do work',
      createdAt: '2026-06-27T00:00:00.000Z'
    }],
    createdAt: '2026-06-27T00:00:00.000Z',
    startedAt: '2026-06-27T00:00:01.000Z',
    updatedAt: '2026-06-27T00:00:02.000Z'
  }))
  const runtime = new MultiAgentRuntime({ store })

  const diagnostics = await runtime.diagnostics('thread-1')
  assert.equal(diagnostics.active, 0)
  assert.equal(diagnostics.childRuns[0]?.status, 'aborted')
  assert.equal(diagnostics.childRuns[0]?.error?.code, 'child_aborted')
  assert.equal(diagnostics.childRuns[0]?.finishedAt, '2026-06-27T00:00:02.000Z')
  assert.equal(diagnostics.statusCounts.running, 0)
  assert.equal(diagnostics.statusCounts.aborted, 1)
  assert.equal(diagnostics.aggregates[0]?.running, 0)
  assert.equal(diagnostics.aggregates[0]?.aborted, 1)
  assert.equal((await runtime.child('thread-1', 'child-stale'))?.status, 'aborted')
  assert.equal((await store.get('thread-1', 'child-stale'))?.status, 'running')
})

test('runtime records executor failure, abort, and timeout as canonical error codes', async () => {
  const failedRuntime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-failed',
    executor: async () => {
      throw new Error('boom')
    }
  })
  const failed = await failedRuntime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Fail'
  })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error?.code, 'child_failed')
  assert.equal(failed.transcript.at(-1)?.status, 'failed')
  assert.equal(failed.transcript.at(-1)?.metadata?.code, 'child_failed')

  const detailedFailureRuntime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-detailed-failed',
    executor: async () => {
      throw Object.assign(new Error('tool loop failed'), {
        multiAgentUsage: { promptTokens: 7, completionTokens: 2, totalTokens: 9 },
        multiAgentTranscript: [
          {
            id: 'tool-call-1',
            kind: 'tool',
            text: '{"command":"rg"}',
            createdAt: '2026-06-27T00:00:00.000Z'
          }
        ]
      })
    }
  })
  const detailedFailed = await detailedFailureRuntime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Fail with details'
  })
  assert.equal(detailedFailed.status, 'failed')
  assert.equal(detailedFailed.usage.totalTokens, 9)
  assert.equal(detailedFailed.transcript.some((entry) => entry.id === 'tool-call-1'), true)
  assert.equal(detailedFailed.transcript.at(-1)?.metadata?.code, 'child_failed')

  const abortController = new AbortController()
  const abortEntered = deferred<void>()
  const abortedRuntime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-aborted',
    executor: async ({ signal }) => {
      abortEntered.resolve()
      await waitForAbort(signal)
      return { summary: 'unreachable' }
    }
  })
  const abortedPromise = abortedRuntime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-2',
    prompt: 'Abort',
    signal: abortController.signal
  })
  await abortEntered.promise
  abortController.abort()
  const aborted = await abortedPromise
  assert.equal(aborted.status, 'aborted')
  assert.equal(aborted.error?.code, 'child_aborted')

  const timedOutRuntime = new MultiAgentRuntime({
    config: { childTimeoutMs: 5 },
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-timeout',
    executor: async () => new Promise(() => undefined)
  })
  const timedOut = await timedOutRuntime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-3',
    prompt: 'Timeout'
  })
  assert.equal(timedOut.status, 'failed')
  assert.equal(timedOut.error?.code, 'timeout')

  const perChildTimedOutRuntime = new MultiAgentRuntime({
    config: { childTimeoutMs: 60_000 },
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-timeout-override',
    executor: async () => new Promise(() => undefined)
  })
  const perChildTimedOut = await perChildTimedOutRuntime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-4',
    prompt: 'Timeout override',
    childTimeoutMs: 5
  })
  assert.equal(perChildTimedOut.status, 'failed')
  assert.equal(perChildTimedOut.error?.code, 'timeout')
})

function clock(): () => string {
  let tick = 0
  return () => `2026-06-27T00:00:${String(tick++).padStart(2, '0')}.000Z`
}

function sequenceIds(prefix: string): () => string {
  let index = 0
  return () => `${prefix}-${++index}`
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

async function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) throw new Error('aborted')
  await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
  throw new Error('aborted')
}
