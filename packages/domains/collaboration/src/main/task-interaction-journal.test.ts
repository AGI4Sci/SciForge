import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EMPTY_COLLABORATION_LOCAL_STATE,
  CollaborationLocalStore,
  type CollaborationLocalState,
  type CollaborationStateBackend
} from './store.js'
import { TaskInteractionJournal } from './task-interaction-journal.js'

const IDS = {
  projectId: 'prj_Proj00000001',
  taskId: 'tsk_Task00000001',
  executionId: 'exe_Exec00000001'
} as const

const CREATED_AT = '2026-08-30T08:00:00.000Z'

test('task interactions preserve the local-only lifecycle and terminal invariants', async () => {
  const store = openStore()
  const journal = new TaskInteractionJournal(store, () => new Date(CREATED_AT))
  const queued = await journal.enqueue({
    projectId: IDS.projectId,
    taskId: IDS.taskId,
    executionId: IDS.executionId,
    kind: 'guidance',
    text: '请先核对输入文件。',
    idempotencyKey: 'idem_task-interaction-guidance-1'
  })
  assert.equal(queued.state, 'queued')
  assert.equal(queued.dispatchedAt, null)
  assert.equal(queued.completedAt, null)

  const dispatching = await journal.markDispatching(queued.interactionId)
  assert.equal(dispatching.state, 'dispatching')
  assert.equal(dispatching.attempts, 1)
  assert.equal(dispatching.dispatchedAt, CREATED_AT)
  assert.equal(dispatching.completedAt, null)

  // awaiting_cloud is not terminal: a local restart must be able to reconcile
  // the pending Cloud write without falsely recording a completion time.
  const awaitingCloud = await journal.markAwaitingCloud(queued.interactionId)
  assert.equal(awaitingCloud.state, 'awaiting_cloud')
  assert.equal(awaitingCloud.completedAt, null)
  assert.equal(awaitingCloud.error, null)

  const applied = await journal.markApplied(queued.interactionId, 'directive-1')
  assert.equal(applied.state, 'applied')
  assert.equal(applied.clientDirectiveId, 'directive-1')
  assert.equal(applied.completedAt, CREATED_AT)

  await assert.rejects(
    journal.markAwaitingCloud(queued.interactionId),
    /cannot transition from applied/u
  )
})

test('task interaction idempotency replays the same intent and rejects changed intent', async () => {
  const store = openStore()
  const journal = new TaskInteractionJournal(store, () => new Date(CREATED_AT))
  const input = {
    projectId: IDS.projectId,
    taskId: IDS.taskId,
    executionId: IDS.executionId,
    kind: 'guidance' as const,
    text: '继续输出摘要。',
    idempotencyKey: 'idem_task-interaction-replay-1'
  }
  const first = await journal.enqueue(input)
  const replay = await journal.enqueue(input)
  assert.deepEqual(replay, first)
  assert.equal(store.snapshot().taskInteractions.length, 1)

  await assert.rejects(
    journal.enqueue({ ...input, text: '改成另一条指令。' }),
    /idempotency key was reused for a different intent/u
  )
})

test('task checkpoints are append-only, ordered per execution, and idempotent', async () => {
  const store = openStore()
  const journal = new TaskInteractionJournal(store, () => new Date(CREATED_AT))
  const common = {
    projectId: IDS.projectId,
    taskId: IDS.taskId,
    executionId: IDS.executionId,
    kind: 'progress' as const,
    source: 'agent' as const
  }
  const first = await journal.appendCheckpoint({
    ...common,
    summary: '已完成输入校验。',
    idempotencyKey: 'idem_task-checkpoint-1'
  })
  const second = await journal.appendCheckpoint({
    ...common,
    kind: 'partial-result',
    summary: '得到第一版结果。',
    idempotencyKey: 'idem_task-checkpoint-2'
  })
  assert.equal(first.sequence, 1)
  assert.equal(second.sequence, 2)
  assert.deepEqual(
    await journal.appendCheckpoint({
      ...common,
      summary: first.summary,
      idempotencyKey: first.idempotencyKey
    }),
    first
  )
  assert.equal(journal.listCheckpoints(IDS.projectId, IDS.taskId).length, 2)

  await assert.rejects(
    journal.appendCheckpoint({
      ...common,
      summary: '篡改了已有 checkpoint。',
      idempotencyKey: first.idempotencyKey
    }),
    /idempotency key was reused for different content/u
  )
})

test('dispatching interaction is recovered as awaiting_cloud after a restart', async () => {
  const backend = new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
  const store = new CollaborationLocalStore(backend)
  await store.open()
  const journal = new TaskInteractionJournal(store, () => new Date(CREATED_AT))
  const interaction = await journal.enqueue({
    projectId: IDS.projectId,
    taskId: IDS.taskId,
    executionId: IDS.executionId,
    kind: 'guidance',
    text: '在重启后继续当前 Worker Session。'
  })
  await journal.markDispatching(interaction.interactionId)

  const restarted = new CollaborationLocalStore(backend)
  const recovered = await restarted.open()
  assert.equal(recovered.taskInteractions[0]?.state, 'awaiting_cloud')
  assert.equal(recovered.taskInteractions[0]?.attempts, 1)
  assert.equal(recovered.taskInteractions[0]?.completedAt, null)
})

function openStore(): CollaborationLocalStore {
  return new CollaborationLocalStore(
    new MemoryBackend(structuredClone(EMPTY_COLLABORATION_LOCAL_STATE))
  )
}

class MemoryBackend implements CollaborationStateBackend {
  constructor(private value: CollaborationLocalState) {}

  async read(): Promise<unknown> {
    return structuredClone(this.value)
  }

  async write(value: CollaborationLocalState): Promise<void> {
    this.value = structuredClone(value)
  }
}
