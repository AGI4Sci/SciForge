import assert from 'node:assert/strict'
import test from 'node:test'
import { MultiAgentChildRunRecord, type MultiAgentChildEvent, type MultiAgentExecutorResult } from './contract.js'
import { MultiAgentRuntime, MultiAgentRuntimeError } from './runtime.js'
import { InMemoryMultiAgentStore } from './store.js'

test('runtime persists queued/running/completed records through an injected executor', async () => {
  const store = new InMemoryMultiAgentStore()
  const executorContext = Object.freeze({ lease: 'host-only' })
  const events: MultiAgentChildEvent[] = []
  const usageRecords: unknown[] = []
  const runtime = new MultiAgentRuntime({
    config: { maxParallel: 1 },
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
      assert.equal(input.executorContext, executorContext)
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
    maxToolCalls: 12,
    executorContext
  })

  assert.equal(record.status, 'completed')
  assert.equal(record.summary, 'Done')
  assert.deepEqual(record.usage, { promptTokens: 2, completionTokens: 3, totalTokens: 5 })
  assert.deepEqual(record.transcript.map((entry) => entry.id), ['child-1-prompt', 'tool-1', 'assistant-1'])
  assert.equal(record.threadRef?.threadId, 'child-thread-1')
  assert.equal('executorContext' in record, false)
  assert.deepEqual(events.map((event) => event.status), ['queued', 'running', 'completed'])
  assert.equal(usageRecords.length, 1)

  const diagnostics = await runtime.diagnostics('thread-1')
  assert.equal(diagnostics.statusCounts.completed, 1)
  assert.equal(diagnostics.usage.totalTokens, 5)
  assert.equal(diagnostics.aggregates[0]?.key, 'Notes:router-model')
})

test('runtime keeps executing when child refresh notifications fail', async () => {
  const store = new InMemoryMultiAgentStore()
  let executorCalls = 0
  let notificationCalls = 0
  const runtime = new MultiAgentRuntime({
    store,
    idGenerator: () => 'child-notification-failure',
    events: {
      onChildEvent: async () => {
        notificationCalls += 1
        throw new Error('refresh transport unavailable')
      }
    },
    executor: async () => {
      executorCalls += 1
      return { summary: 'Completed despite refresh failure' }
    }
  })

  const record = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Finish the work'
  })

  assert.equal(record.status, 'completed')
  assert.equal(executorCalls, 1)
  assert.equal(notificationCalls, 3)
  assert.equal((await store.get('thread-1', record.id))?.status, 'completed')
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

test('runtime persists a provider thread reference while the child is still running', async () => {
  let release!: () => void
  let attached!: () => void
  const waiting = new Promise<void>((resolve) => { release = resolve })
  const threadAttached = new Promise<void>((resolve) => { attached = resolve })
  const runtime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-with-thread',
    executor: async (input) => {
      await input.setThreadRef({
        runtime: 'claude',
        threadId: 'claude-child-thread',
        turnId: 'claude-child-turn'
      })
      attached()
      await waiting
      return { summary: 'Done' }
    }
  })

  const started = await runtime.startChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Inspect the project.'
  })
  assert.equal(started.status, 'running')
  await threadAttached
  assert.deepEqual((await runtime.child('thread-1', started.id))?.threadRef, {
    runtime: 'claude',
    threadId: 'claude-child-thread',
    turnId: 'claude-child-turn'
  })
  release()
  assert.equal((await runtime.waitForChild('thread-1', started.id, { timeoutMs: 1_000 }))?.record.status, 'completed')
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

test('runtime still fails closed when canonical child persistence fails', async () => {
  let executorCalls = 0
  const store = new class extends InMemoryMultiAgentStore {
    override async upsert(_record: MultiAgentChildRunRecord): Promise<void> {
      throw new Error('canonical store unavailable')
    }
  }()
  const runtime = new MultiAgentRuntime({
    store,
    executor: async () => {
      executorCalls += 1
      return { summary: 'must not run' }
    }
  })

  await assert.rejects(
    runtime.runChild({
      parentThreadId: 'thread-1',
      parentTurnId: 'turn-1',
      prompt: 'Do work'
    }),
    /canonical store unavailable/u
  )
  assert.equal(executorCalls, 0)
})

test('runtime enforces maxParallel while a child run is active', async () => {
  const entered = deferred<void>()
  const release = deferred<MultiAgentExecutorResult>()
  const store = new InMemoryMultiAgentStore()
  const runtime = new MultiAgentRuntime({
    config: { maxParallel: 1 },
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
    (error) => error instanceof MultiAgentRuntimeError &&
      error.code === 'parallel_budget_exhausted' &&
      error.message.includes('Wait for an existing child to reach a terminal state')
  )

  release.resolve({ summary: 'First done' })
  await first
})

test('runtime allows additional children in the same parent turn after completion', async () => {
  const store = new InMemoryMultiAgentStore()
  const runtime = new MultiAgentRuntime({
    config: { maxParallel: 1 },
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

  const second = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Second child in same turn'
  })
  assert.equal(second.status, 'completed')
  assert.equal((await store.list({ parentThreadId: 'thread-1' })).length, 2)
})

test('runtime reuses a persisted request before budget checks or executor startup', async () => {
  const store = new InMemoryMultiAgentStore()
  const firstExecutor = async () => ({ summary: 'persisted result' })
  const firstRuntime = new MultiAgentRuntime({
    config: { maxParallel: 1 },
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
    config: { maxParallel: 0 },
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
    config: { maxParallel: 2 },
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

test('runtime persistently recovers stale children once without replaying their requests', async () => {
  const store = new InMemoryMultiAgentStore()
  for (const [id, status] of [['child-queued', 'queued'], ['child-running', 'running']] as const) {
    await store.upsert(MultiAgentChildRunRecord.parse({
      id,
      parentThreadId: 'thread-1',
      parentTurnId: 'turn-stale',
      requestId: `request-${status}`,
      prompt: `${status} work`,
      status,
      transcript: [{
        id: `${id}-prompt`,
        kind: 'user_message',
        text: `${status} work`,
        createdAt: '2026-06-27T00:00:00.000Z'
      }],
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:01.000Z',
      ...(status === 'running' ? { startedAt: '2026-06-27T00:00:01.000Z' } : {})
    }))
  }
  const events: MultiAgentChildEvent[] = []
  let executorCalls = 0
  const runtime = new MultiAgentRuntime({
    store,
    nowIso: () => '2026-06-27T00:01:00.000Z',
    events: { onChildEvent: (event) => events.push(event) },
    executor: async () => {
      executorCalls += 1
      return { summary: 'fresh work completed' }
    }
  })

  const recovered = await runtime.recoverStaleChildren()
  assert.deepEqual(recovered.map((record) => record.status), ['aborted', 'aborted'])
  assert.deepEqual(events.map((event) => event.status), ['aborted', 'aborted'])
  for (const id of ['child-queued', 'child-running']) {
    const record = await store.get('thread-1', id)
    assert.equal(record?.status, 'aborted')
    assert.equal(record?.finishedAt, '2026-06-27T00:01:00.000Z')
    assert.equal(record?.error?.code, 'child_aborted')
    assert.equal(record?.error?.details && (record.error.details as { recoveryReason?: string }).recoveryReason, 'runtime_restart')
  }
  assert.deepEqual(await runtime.recoverStaleChildren(), [])
  assert.equal(events.length, 2)

  const replayed = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-stale',
    requestId: 'request-queued',
    prompt: 'must not replay'
  })
  assert.equal(replayed.status, 'aborted')
  assert.equal(executorCalls, 0)

  const fresh = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-fresh',
    requestId: 'request-fresh',
    prompt: 'new work'
  })
  assert.equal(fresh.status, 'completed')
  assert.equal(executorCalls, 1)
})

test('runtime recovery never aborts a child active in the current process', async () => {
  const entered = deferred<void>()
  const release = deferred<MultiAgentExecutorResult>()
  const store = new InMemoryMultiAgentStore()
  const runtime = new MultiAgentRuntime({
    store,
    idGenerator: () => 'child-active',
    executor: async () => {
      entered.resolve()
      return release.promise
    }
  })

  const started = await runtime.startChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-active',
    prompt: 'Keep running'
  })
  await entered.promise
  assert.deepEqual(await runtime.recoverStaleChildren(), [])
  assert.equal((await store.get('thread-1', started.id))?.status, 'running')

  release.resolve({ summary: 'done' })
  assert.equal((await runtime.waitForChild('thread-1', started.id, { timeoutMs: 1_000 }))?.record.status, 'completed')
})

test('runtime records executor failure and parent abort as canonical error codes', async () => {
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
        subagentUsage: { promptTokens: 7, completionTokens: 2, totalTokens: 9 },
        subagentTranscript: [
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
})

test('startChild returns a stable handle and observation timeout never fails a running child', async () => {
  const result = deferred<MultiAgentExecutorResult>()
  const runtime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-long-running',
    executor: async () => result.promise
  })

  const started = await runtime.startChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-long',
    prompt: 'Read all papers'
  })
  assert.equal(started.id, 'child-long-running')
  assert.equal(started.status, 'running')

  const observed = await runtime.waitForChild('thread-1', started.id, { timeoutMs: 5 })
  assert.equal(observed?.timedOut, true)
  assert.equal(observed?.record.status, 'running')
  assert.equal(observed?.record.error, undefined)

  result.resolve({ summary: 'All papers complete.' })
  const completed = await runtime.waitForChild('thread-1', started.id, { timeoutMs: 50 })
  assert.equal(completed?.timedOut, false)
  assert.equal(completed?.record.status, 'completed')
})

test('runtime inspects, messages, and explicitly cancels a running child through one lifecycle control', async () => {
  const messages: string[] = []
  const terminationReasons: string[] = []
  const runtime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-interactive',
    executor: async (input) => {
      input.registerLifecycleControl({
        sendMessage: async (request) => {
          messages.push(request.message)
          return { established: true }
        },
        inspect: async () => ({ state: 'active', observedAt: '2026-06-27T00:00:05.000Z' }),
        terminate: async (request) => {
          terminationReasons.push(request.reason)
        }
      })
      return waitForAbort(input.signal)
    }
  })

  const started = await runtime.startChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-interactive',
    prompt: 'Long research task'
  })
  assert.equal(await runtime.sendMessage('thread-1', started.id, 'Please report progress.'), true)
  assert.deepEqual(messages, ['Please report progress.'])
  assert.deepEqual((await runtime.inspectChild('thread-1', started.id))?.liveness, {
    state: 'active',
    observedAt: '2026-06-27T00:00:05.000Z'
  })

  const cancelled = await runtime.cancelChild('thread-1', started.id)
  assert.equal(cancelled?.status, 'aborted')
  assert.deepEqual(terminationReasons, ['parent_cancel'])
})

test('runtime resumes an interrupted child with the same identity and provider thread', async () => {
  let execution = 0
  const resumedExecutorContext = Object.freeze({ lease: 'resume-host-only' })
  const runtime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-resumable',
    executor: async (input) => {
      execution += 1
      if (execution === 1) {
        await input.setThreadRef({ runtime: 'codex', threadId: 'provider-child-thread', turnId: 'turn-1' })
        input.registerLifecycleControl({
          sendMessage: async () => ({ established: true }),
          inspect: async () => ({ state: 'active', observedAt: new Date().toISOString() }),
          terminate: async () => undefined
        })
        return waitForAbort(input.signal)
      }
      assert.equal(input.resumeThreadRef?.threadId, 'provider-child-thread')
      assert.equal(input.prompt, 'Continue the interrupted review.')
      assert.equal(input.executorContext, resumedExecutorContext)
      assert.deepEqual(input.allowedToolNames, ['sciforge_discover', 'sciforge_invoke'])
      assert.deepEqual(input.brokerScope, {
        providerFamily: 'managed-mcp',
        packageName: '@sciforge/domain-computer-use'
      })
      assert.equal(input.deadlineMs, 10_000)
      assert.equal(input.strictAllowedToolNames, true)
      assert.deepEqual(input.bashCommandPolicy, { allowPatterns: ['^python3 '] })
      assert.deepEqual(input.filePathPolicy, { allowPaths: ['/workspace'] })
      assert.equal(input.maxToolCalls, 12)
      return {
        summary: 'Resumed work completed.',
        threadRef: { runtime: 'codex', threadId: 'provider-child-thread', turnId: 'turn-2' }
      }
    }
  })

  const started = await runtime.startChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Review the paper.',
    allowedToolNames: ['sciforge_discover', 'sciforge_invoke'],
    brokerScope: {
      providerFamily: 'managed-mcp',
      packageName: '@sciforge/domain-computer-use'
    },
    deadlineMs: 10_000,
    strictAllowedToolNames: true,
    bashCommandPolicy: { allowPatterns: ['^python3 '] },
    filePathPolicy: { allowPaths: ['/workspace'] },
    maxToolCalls: 12
  })
  assert.equal((await runtime.cancelChild('thread-1', started.id))?.status, 'aborted')
  assert.deepEqual((await runtime.child('thread-1', started.id))?.brokerScope, {
    providerFamily: 'managed-mcp',
    packageName: '@sciforge/domain-computer-use'
  })

  const resumed = await runtime.resumeChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-2',
    childId: started.id,
    prompt: 'Continue the interrupted review.',
    executorContext: resumedExecutorContext
  })
  assert.equal(resumed.id, started.id)
  assert.equal(resumed.status, 'running')
  assert.equal(resumed.attempt, 2)

  const completed = await runtime.waitForChild('thread-1', started.id, { timeoutMs: 50 })
  assert.equal(completed?.record.status, 'completed')
  assert.equal(completed?.record.threadRef?.turnId, 'turn-2')
  assert.equal(completed?.record.summary, 'Resumed work completed.')
})

test('runtime retries durable terminal delivery independently of refresh failures', async () => {
  const store = new InMemoryMultiAgentStore()
  let terminalAttempts = 0
  const runtime = new MultiAgentRuntime({
    store,
    idGenerator: () => 'child-terminal-retry',
    executor: async () => ({ summary: 'Done.' }),
    events: {
      onChildEvent: async () => { throw new Error('refresh transport unavailable') },
      onChildTerminal: async () => {
        terminalAttempts += 1
        if (terminalAttempts === 1) throw new Error('terminal consumer unavailable')
      }
    }
  })

  const completed = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Deliver terminal lifecycle reliably.'
  })
  assert.equal(completed.status, 'completed')
  await waitUntil(() => terminalAttempts >= 2)
  assert.ok((await store.get('thread-1', completed.id))?.terminalEventDeliveredAt)
  runtime.dispose()
})

test('runtime recovers pending terminal delivery when a new process starts', async () => {
  const store = new InMemoryMultiAgentStore()
  await store.upsert(MultiAgentChildRunRecord.parse({
    id: 'child-pending-terminal',
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Already finished.',
    status: 'completed',
    transcript: [],
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:01.000Z',
    finishedAt: '2026-08-18T00:00:01.000Z'
  }))
  let delivered = 0
  const runtime = new MultiAgentRuntime({
    store,
    executor: async () => ({ summary: 'unused' }),
    events: { onChildTerminal: async () => { delivered += 1 } }
  })

  await waitUntil(() => delivered === 1)
  assert.ok((await store.get('thread-1', 'child-pending-terminal'))?.terminalEventDeliveredAt)
  runtime.dispose()
})

test('runtime protects pending terminal delivery and never redelivers it for delete refreshes', async () => {
  const store = new InMemoryMultiAgentStore()
  const operations: Array<string | undefined> = []
  let terminalCalls = 0
  let terminalAvailable = false
  const runtime = new MultiAgentRuntime({
    store,
    idGenerator: () => 'child-delete-after-terminal',
    executor: async () => ({ summary: 'Done.' }),
    events: {
      onChildEvent: (event) => { operations.push(event.operation) },
      onChildTerminal: async () => {
        terminalCalls += 1
        if (!terminalAvailable) throw new Error('terminal consumer unavailable')
      }
    }
  })
  const completed = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Delete only after terminal delivery.'
  })

  await assert.rejects(
    runtime.deleteChild('thread-1', completed.id),
    /terminal lifecycle delivery is pending/
  )
  assert.ok(await runtime.child('thread-1', completed.id))
  terminalAvailable = true
  await runtime.deleteChild('thread-1', completed.id)
  const callsAfterDelete = terminalCalls
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(terminalCalls, callsAfterDelete)
  assert.equal(await runtime.child('thread-1', completed.id), null)
  assert.equal(operations.at(-1), 'delete')
  runtime.dispose()
})

test('runtime permanently deletes a child and publishes a delete refresh event', async () => {
  const events: Array<{ operation?: string; childId: string }> = []
  const runtime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-delete',
    executor: async () => ({ summary: 'Done.' }),
    events: {
      onChildEvent: (event) => { events.push(event) }
    }
  })
  const completed = await runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Disposable task.'
  })

  assert.equal((await runtime.deleteChild('thread-1', completed.id))?.id, completed.id)
  assert.equal(await runtime.child('thread-1', completed.id), null)
  assert.equal(events.at(-1)?.operation, 'delete')
})

test('parent abort uses lifecycle termination control', async () => {
  const parent = new AbortController()
  const entered = deferred<void>()
  const terminationReasons: string[] = []
  const runtime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-parent-abort',
    executor: async (input) => {
      input.registerLifecycleControl({
        sendMessage: async () => ({ established: true }),
        inspect: async () => ({ state: 'active', observedAt: new Date().toISOString() }),
        terminate: async (request) => {
          terminationReasons.push(request.reason)
        }
      })
      entered.resolve()
      return waitForAbort(input.signal)
    }
  })

  const running = runtime.runChild({
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-parent-abort',
    prompt: 'Wait for parent abort',
    signal: parent.signal
  })
  await entered.promise
  parent.abort()
  const record = await running

  assert.equal(record.status, 'aborted')
  assert.equal(record.error?.code, 'child_aborted')
  assert.deepEqual(terminationReasons, ['parent_abort'])
})

test('execution deadline aborts the provider child and releases all active controls', async () => {
  let observedSignal: AbortSignal | undefined
  const runtime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    executor: async (input) => {
      observedSignal = input.signal
      input.registerLifecycleControl({
        sendMessage: async () => ({ established: true }),
        inspect: async () => ({ state: 'active', observedAt: new Date().toISOString() }),
        terminate: async () => undefined
      })
      await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      throw input.signal.reason
    }
  })
  const record = await runtime.runChild({
    parentThreadId: 'parent',
    parentTurnId: 'turn',
    prompt: 'bounded work',
    deadlineMs: 5
  })
  assert.equal(observedSignal?.aborted, true)
  assert.equal(record.status, 'aborted')
  assert.equal((await runtime.diagnostics()).active, 0)
  assert.equal((await runtime.diagnostics()).activeLifecycleControls, 0)
  assert.equal((await runtime.diagnostics()).activeBoundaries, 0)
})

test('execution deadline excludes independently tokenized external interaction waits', async () => {
  const entered = deferred<void>()
  let observedSignal: AbortSignal | undefined
  const runtime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-suspended-deadline',
    executor: async (input) => {
      observedSignal = input.signal
      entered.resolve()
      return waitForAbort(input.signal)
    }
  })

  const running = runtime.runChild({
    parentThreadId: 'parent',
    parentTurnId: 'turn',
    prompt: 'wait for external interaction',
    deadlineMs: 40
  })
  await entered.promise
  assert.equal(runtime.suspendChildExecutionDeadline('child-suspended-deadline', 'approval-a'), true)
  assert.equal(runtime.suspendChildExecutionDeadline('child-suspended-deadline', 'approval-b'), true)
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(observedSignal?.aborted, false)

  assert.equal(runtime.resumeChildExecutionDeadline('child-suspended-deadline', 'approval-a'), true)
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(observedSignal?.aborted, false)
  assert.equal(runtime.resumeChildExecutionDeadline('child-suspended-deadline', 'approval-b'), true)

  const record = await running
  assert.equal(record.status, 'aborted')
  assert.equal((await runtime.diagnostics()).activeBoundaries, 0)
})

test('parent abort remains immediate while the execution deadline is suspended', async () => {
  const parent = new AbortController()
  const entered = deferred<void>()
  const runtime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-parent-abort-suspended',
    executor: async (input) => {
      entered.resolve()
      return waitForAbort(input.signal)
    }
  })

  const running = runtime.runChild({
    parentThreadId: 'parent',
    parentTurnId: 'turn',
    prompt: 'wait for parent abort',
    deadlineMs: 10_000,
    signal: parent.signal
  })
  await entered.promise
  assert.equal(runtime.suspendChildExecutionDeadline('child-parent-abort-suspended', 'approval'), true)
  parent.abort(new Error('parent stopped'))

  const record = await running
  assert.equal(record.status, 'aborted')
  assert.equal((await runtime.diagnostics()).activeBoundaries, 0)
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

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
