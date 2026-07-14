import { expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnInProgressError, TurnService } from './turn-service.js'

it('interruptTurn rejects missing thread or turn instead of reporting a fake abort', async () => {
  const { turns, threadStore } = createTurnService()

  await expect(turns.interruptTurn({ threadId: 'missing-thread', turnId: 'turn_1' }))
    .rejects.toThrow(/thread not found: missing-thread/)

  await threadStore.upsert(makeThread('thread_1'))
  await expect(turns.interruptTurn({ threadId: 'thread_1', turnId: 'missing-turn' }))
    .rejects.toThrow(/turn not found: missing-turn/)
})

it('interruptTurn still aborts an existing in-flight turn', async () => {
  const { turns, threadStore } = createTurnService()
  await threadStore.upsert(makeThread('thread_1'))
  const started = await turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'Work' }
  })

  const result = await turns.interruptTurn({
    threadId: 'thread_1',
    turnId: started.turnId
  })

  expect(result.status).toBe('aborted')
  const turn = await turns.getTurn('thread_1', started.turnId)
  expect(turn?.status).toBe('aborted')
})

it('startTurn rejects a second running turn on the same thread', async () => {
  const { turns, threadStore } = createTurnService()
  await threadStore.upsert(makeThread('thread_1'))
  const first = await turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'Work' }
  })

  await expect(turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'Overlapping work' }
  })).rejects.toThrow(TurnInProgressError)

  const thread = await threadStore.get('thread_1')
  expect(thread?.turns.map((turn) => turn.id)).toEqual([first.turnId])
})

it('startTurn reuses the persisted turn for a repeated host request id', async () => {
  const { turns, threadStore, sessionStore } = createTurnService()
  await threadStore.upsert(makeThread('thread_1'))

  const first = await turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'Continue the workflow', hostRequestId: 'biogym:run-1:ready:3' }
  })
  const repeated = await turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'A retry may have different rendered context', hostRequestId: 'biogym:run-1:ready:3' }
  })

  expect(repeated).toEqual({ ...first, reused: true })
  expect((await threadStore.get('thread_1'))?.turns).toHaveLength(1)
  expect(await sessionStore.loadItems('thread_1')).toHaveLength(1)
})

it('serializes concurrent repeated host requests into exactly one turn', async () => {
  const { turns, threadStore, sessionStore } = createTurnService()
  await threadStore.upsert(makeThread('thread_1'))
  const request = {
    threadId: 'thread_1',
    request: { prompt: 'Stage completed', hostRequestId: 'biogym:run-1:stage:4' }
  }

  const [first, second] = await Promise.all([
    turns.startTurn(request),
    turns.startTurn(request)
  ])

  expect(second.turnId).toBe(first.turnId)
  expect([first.reused, second.reused].filter(Boolean)).toHaveLength(1)
  expect((await threadStore.get('thread_1'))?.turns).toHaveLength(1)
  expect(await sessionStore.loadItems('thread_1')).toHaveLength(1)
})

it('reuses a completed keyed turn instead of running the continuation twice', async () => {
  const { turns, threadStore } = createTurnService()
  await threadStore.upsert(makeThread('thread_1'))
  const first = await turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'Stage completed', hostRequestId: 'biogym:run-1:stage:5' }
  })
  await turns.finishTurn({ threadId: 'thread_1', turnId: first.turnId, status: 'completed' })

  const repeated = await turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'Stage completed', hostRequestId: 'biogym:run-1:stage:5' }
  })

  expect(repeated).toEqual({ ...first, reused: true })
  expect((await threadStore.get('thread_1'))?.turns).toHaveLength(1)
})

it('reconcileStaleRunningTurns aborts persisted running turns after runtime restart', async () => {
  const firstRuntime = createTurnService()
  await firstRuntime.threadStore.upsert(makeThread('thread_1'))
  const started = await firstRuntime.turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'Long work' }
  })

  const restartedRuntime = createTurnService({
    threadStore: firstRuntime.threadStore,
    sessionStore: firstRuntime.sessionStore
  })
  const result = await restartedRuntime.turns.reconcileStaleRunningTurns()

  expect(result).toEqual({ reconciledTurns: 1, reconciledThreads: 1 })
  const thread = await restartedRuntime.threadStore.get('thread_1')
  expect(thread?.status).toBe('idle')
  const turn = await restartedRuntime.turns.getTurn('thread_1', started.turnId)
  expect(turn?.status).toBe('aborted')
  expect(turn?.error).toContain('Runtime restarted')
})

it('allows a keyed continuation to replace its startup-reconciled stale turn', async () => {
  const firstRuntime = createTurnService()
  await firstRuntime.threadStore.upsert(makeThread('thread_1'))
  const first = await firstRuntime.turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'Stage completed', hostRequestId: 'biogym:run-1:stage:6' }
  })
  const restartedRuntime = createTurnService({
    threadStore: firstRuntime.threadStore,
    sessionStore: firstRuntime.sessionStore
  })
  await restartedRuntime.turns.reconcileStaleRunningTurns()

  const replacement = await restartedRuntime.turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'Stage completed', hostRequestId: 'biogym:run-1:stage:6' }
  })

  expect(replacement.turnId).not.toBe(first.turnId)
  expect(replacement.reused).toBeUndefined()
  const thread = await restartedRuntime.threadStore.get('thread_1')
  expect(thread?.turns).toHaveLength(2)
  expect(thread?.turns[0]).toMatchObject({
    id: first.turnId,
    status: 'aborted',
    errorCode: 'stale_turn_reconciled'
  })
  expect(thread?.turns[1]).toMatchObject({
    id: replacement.turnId,
    status: 'running',
    hostRequestId: 'biogym:run-1:stage:6'
  })
})

function createTurnService(deps: {
  threadStore?: InMemoryThreadStore
  sessionStore?: InMemorySessionStore
} = {}) {
  const eventBus = new InMemoryEventBus()
  const sessionStore = deps.sessionStore ?? new InMemorySessionStore()
  const threadStore = deps.threadStore ?? new InMemoryThreadStore()
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
    nowIso: () => '2026-06-28T00:00:00.000Z'
  })
  const turns = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    compactor: new ContextCompactor({}),
    ids: new SequentialIdGenerator(),
    nowIso: () => '2026-06-28T00:00:00.000Z'
  })
  return { turns, threadStore, sessionStore }
}

function makeThread(id: string): ThreadRecord {
  return {
    id,
    title: 'Test thread',
    workspace: '/tmp/workspace',
    model: 'test-model',
    mode: 'agent',
    status: 'idle',
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    relation: 'primary',
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
    turns: []
  }
}
