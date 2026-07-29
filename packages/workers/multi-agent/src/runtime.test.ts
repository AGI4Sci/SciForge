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

test('runtime reserves concurrent starts atomically before enforcing child budgets', async () => {
  const release = deferred<MultiAgentExecutorResult>()
  const store = new InMemoryMultiAgentStore()
  const runtime = new MultiAgentRuntime({
    config: { maxParallel: 2, maxChildren: 1 },
    store,
    idGenerator: sequenceIds('child'),
    executor: async () => release.promise
  })

  const first = runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'First'
  })
  const second = runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Second'
  })

  await assert.rejects(
    second,
    (error) => error instanceof MultiAgentRuntimeError && error.code === 'child_budget_exhausted'
  )
  const diagnostics = await runtime.diagnostics('thread-1')
  assert.equal(diagnostics.active, 1)
  assert.equal(diagnostics.childRuns.length, 1)

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

test('runtime shares one in-flight execution for concurrent calls with the same request identity', async () => {
  const release = deferred<MultiAgentExecutorResult>()
  let executorCalls = 0
  const store = new InMemoryMultiAgentStore()
  const runtime = new MultiAgentRuntime({
    config: { maxParallel: 2, maxChildren: 2 },
    store,
    idGenerator: sequenceIds('child'),
    executor: async () => {
      executorCalls += 1
      return release.promise
    }
  })
  const input = {
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    requestId: 'request-1',
    prompt: 'Run once'
  }

  const first = runtime.runChild(input)
  const replay = runtime.runChild(input)
  await Promise.resolve()
  release.resolve({ summary: 'Done once' })

  const [firstRecord, replayRecord] = await Promise.all([first, replay])
  assert.equal(firstRecord.id, replayRecord.id)
  assert.equal(executorCalls, 1)
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

test('timeout handshake requests and preserves a child progress summary before closing the run', async () => {
  const result = deferred<MultiAgentExecutorResult>()
  const summaryRequests: string[] = []
  const terminationReasons: string[] = []
  const runtime = new MultiAgentRuntime({
    config: {
      childTimeoutMs: 5,
      timeoutHandshakeMs: 20,
      timeoutSummaryGraceMs: 50
    },
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-timeout-summary',
    executor: async (input) => {
      input.registerLifecycleControl({
        threadRef: {
          runtime: 'codex',
          threadId: 'codex-child-thread',
          turnId: 'codex-child-turn'
        },
        requestProgressSummary: async (request) => {
          summaryRequests.push(request.message)
          setTimeout(() => {
            result.resolve({
              summary: 'Read three papers; the fourth remains unfinished.',
              usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
              threadRef: {
                runtime: 'codex',
                threadId: 'codex-child-thread',
                turnId: 'codex-child-turn'
              }
            })
          }, 0)
          return { established: true }
        },
        terminate: async (request) => {
          terminationReasons.push(request.reason)
        }
      })
      return result.promise
    }
  })

  const record = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-summary',
    prompt: 'Read all papers'
  })

  assert.equal(record.status, 'failed')
  assert.equal(record.error?.code, 'timeout')
  assert.equal(record.summary, 'Read three papers; the fourth remains unfinished.')
  assert.equal(record.usage.totalTokens, 14)
  assert.equal(record.threadRef?.threadId, 'codex-child-thread')
  assert.equal(summaryRequests.length, 1)
  assert.match(summaryRequests[0] ?? '', /progress summary/u)
  assert.deepEqual(terminationReasons, [])
  assert.deepEqual(record.error?.details, {
    disposition: 'progress_summary_received'
  })
  assert.equal(record.transcript.at(-2)?.kind, 'assistant_message')
  assert.equal(record.transcript.at(-1)?.metadata?.code, 'timeout')
})

test('timeout handshake terminates immediately when the child channel cannot be established', async () => {
  const terminationReasons: string[] = []
  let executorSignal: AbortSignal | undefined
  const runtime = new MultiAgentRuntime({
    config: {
      childTimeoutMs: 5,
      timeoutHandshakeMs: 20,
      timeoutSummaryGraceMs: 50
    },
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-timeout-no-channel',
    executor: async (input) => {
      executorSignal = input.signal
      input.registerLifecycleControl({
        requestProgressSummary: async () => ({ established: false }),
        terminate: async (request) => {
          terminationReasons.push(request.reason)
        }
      })
      return new Promise(() => undefined)
    }
  })

  const record = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-no-channel',
    prompt: 'Hang without a channel'
  })

  assert.equal(record.error?.code, 'timeout')
  assert.deepEqual(record.error?.details, { disposition: 'channel_unavailable' })
  assert.deepEqual(terminationReasons, ['timeout_channel_unavailable'])
  assert.equal(executorSignal?.aborted, true)
})

test('timeout handshake cannot deadlock on an unresponsive summary or termination channel', async () => {
  const terminationReasons: string[] = []
  let executorSignal: AbortSignal | undefined
  const runtime = new MultiAgentRuntime({
    config: {
      childTimeoutMs: 5,
      timeoutHandshakeMs: 10,
      timeoutSummaryGraceMs: 50
    },
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-dead-channel',
    executor: async (input) => {
      executorSignal = input.signal
      input.registerLifecycleControl({
        requestProgressSummary: async () => new Promise(() => undefined),
        terminate: async (request) => {
          terminationReasons.push(request.reason)
          return new Promise(() => undefined)
        }
      })
      return new Promise(() => undefined)
    }
  })

  const record = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-dead-channel',
    prompt: 'Become unresponsive'
  })

  assert.equal(record.error?.code, 'timeout')
  assert.deepEqual(record.error?.details, { disposition: 'channel_unavailable' })
  assert.deepEqual(terminationReasons, ['timeout_channel_unavailable'])
  assert.equal(executorSignal?.aborted, true)
})

test('timeout handshake grants a bounded summary window before terminating an unresponsive child', async () => {
  const terminationReasons: string[] = []
  let executorSignal: AbortSignal | undefined
  const runtime = new MultiAgentRuntime({
    config: {
      childTimeoutMs: 5,
      timeoutHandshakeMs: 20,
      timeoutSummaryGraceMs: 10
    },
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-timeout-grace',
    executor: async (input) => {
      executorSignal = input.signal
      input.registerLifecycleControl({
        requestProgressSummary: async () => ({ established: true }),
        terminate: async (request) => {
          terminationReasons.push(request.reason)
        }
      })
      try {
        return await waitForAbort(input.signal)
      } catch {
        throw Object.assign(new Error('child stopped after the summary grace period'), {
          multiAgentSummary: 'Completed indexing; synthesis was still running.'
        })
      }
    }
  })

  const record = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-grace',
    prompt: 'Ignore the summary request'
  })

  assert.equal(record.error?.code, 'timeout')
  assert.deepEqual(record.error?.details, { disposition: 'summary_grace_expired' })
  assert.equal(record.summary, 'Completed indexing; synthesis was still running.')
  assert.deepEqual(terminationReasons, ['timeout_summary_grace_expired'])
  assert.equal(executorSignal?.aborted, true)
})

test('parent abort preempts the timeout summary grace period and uses the same lifecycle termination control', async () => {
  const parent = new AbortController()
  const summaryRequested = deferred<void>()
  const terminationReasons: string[] = []
  const runtime = new MultiAgentRuntime({
    config: {
      childTimeoutMs: 5,
      timeoutHandshakeMs: 20,
      timeoutSummaryGraceMs: 60_000
    },
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-parent-abort-during-summary',
    executor: async (input) => {
      input.registerLifecycleControl({
        requestProgressSummary: async () => {
          summaryRequested.resolve()
          return { established: true }
        },
        terminate: async (request) => {
          terminationReasons.push(request.reason)
        }
      })
      return waitForAbort(input.signal)
    }
  })

  const running = runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-parent-abort',
    prompt: 'Wait for parent abort',
    signal: parent.signal
  })
  await summaryRequested.promise
  parent.abort()
  const record = await running

  assert.equal(record.status, 'aborted')
  assert.equal(record.error?.code, 'child_aborted')
  assert.deepEqual(terminationReasons, ['parent_abort'])
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
