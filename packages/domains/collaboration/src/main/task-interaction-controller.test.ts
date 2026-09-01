import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  taskExecutionSchema,
  taskSchema,
  type TaskExecution,
  type Task
} from '@sciforge/collaboration-contracts'
import { TEST_IDS, TEST_TIMESTAMP, TEST_LATER_TIMESTAMP, taskFixture } from '@sciforge/collaboration-contracts/testing'
import {
  CollaborationLocalStore,
  EMPTY_COLLABORATION_LOCAL_STATE,
  type CollaborationStateBackend
} from './store.js'
import { TaskInteractionJournal } from './task-interaction-journal.js'
import { TaskInteractionController } from './task-interaction-controller.js'

class MemoryBackend implements CollaborationStateBackend {
  private value: unknown

  constructor(initial: unknown = EMPTY_COLLABORATION_LOCAL_STATE) {
    this.value = structuredClone(initial)
  }

  async read(): Promise<unknown> {
    return structuredClone(this.value)
  }

  async write(value: unknown): Promise<void> {
    this.value = structuredClone(value)
  }
}

test('local guidance is durable and explicitly rejected when no Worker execution is bound', async () => {
  const store = new CollaborationLocalStore(new MemoryBackend())
  await store.open()
  const controller = new TaskInteractionController({ store })

  const interaction = await controller.submitGuidance({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    text: '请先验证输入，再继续执行。'
  })

  assert.equal(interaction.state, 'rejected')
  assert.match(interaction.error ?? '', /No local Worker execution/)
  assert.equal(controller.view(TEST_IDS.projectId, TEST_IDS.taskId).state, 'idle')
  assert.equal(store.snapshot().taskInteractions.length, 1)
})

test('queued guidance dispatches against the exact Runtime Session and leaves a local checkpoint', async () => {
  const task = taskSchema.parse({
    ...taskFixture,
    currentExecutionId: TEST_IDS.executionId,
    currentExecutionState: 'running',
    status: 'in_progress',
    executionCount: 1
  })
  const execution = runningExecution()
  const store = new CollaborationLocalStore(new MemoryBackend({
    ...structuredClone(EMPTY_COLLABORATION_LOCAL_STATE),
    tasks: [task],
    taskRuns: [runningTaskRun(task, execution)]
  }))
  await store.open()
  const calls: Array<Readonly<{ text: string; runtimeId: string; threadId: string }>> = []
  const controller = new TaskInteractionController({
    store,
    dispatch: async ({ interaction, session }) => {
      calls.push({
        text: interaction.text ?? '',
        runtimeId: session.runtimeId,
        threadId: session.threadId
      })
      return { outcome: 'applied', clientDirectiveId: interaction.clientDirectiveId ?? undefined }
    }
  })

  const interaction = await controller.submitGuidance({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    text: '把结论压缩成三点，并保留证据来源。'
  })
  const checkpoint = await controller.appendCheckpoint({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    kind: 'human-note',
    source: 'human',
    summary: '人类补充了结果格式要求。'
  })

  assert.equal(interaction.state, 'applied')
  assert.deepEqual(calls, [{
    text: '把结论压缩成三点，并保留证据来源。',
    runtimeId: 'runtime-worker',
    threadId: 'thread-worker'
  }])
  assert.equal(checkpoint.sequence, 1)
  assert.equal(controller.view(TEST_IDS.projectId, TEST_IDS.taskId).state, 'running')
})

test('dispatch failure is recorded locally without changing Cloud execution facts', async () => {
  const task = taskSchema.parse({
    ...taskFixture,
    currentExecutionId: TEST_IDS.executionId,
    currentExecutionState: 'running',
    status: 'in_progress',
    executionCount: 1
  })
  const execution = runningExecution()
  const store = new CollaborationLocalStore(new MemoryBackend({
    ...structuredClone(EMPTY_COLLABORATION_LOCAL_STATE),
    tasks: [task],
    taskRuns: [runningTaskRun(task, execution)]
  }))
  await store.open()
  const controller = new TaskInteractionController({
    store,
    dispatch: async () => { throw new Error('Runtime is temporarily unavailable.') }
  })

  const interaction = await controller.submitPause({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId
  })

  assert.equal(interaction.state, 'failed')
  assert.equal(store.snapshot().taskRuns[0]?.execution?.state, 'running')
  assert.equal(controller.view(TEST_IDS.projectId, TEST_IDS.taskId).state, 'running')
})

test('flush consumes guidance queued while an earlier interaction turn is in flight', async () => {
  const task = taskSchema.parse({
    ...taskFixture,
    currentExecutionId: TEST_IDS.executionId,
    currentExecutionState: 'running',
    status: 'in_progress',
    executionCount: 1
  })
  const execution = runningExecution()
  const store = new CollaborationLocalStore(new MemoryBackend({
    ...structuredClone(EMPTY_COLLABORATION_LOCAL_STATE),
    tasks: [task],
    taskRuns: [runningTaskRun(task, execution)]
  }))
  await store.open()
  const journal = new TaskInteractionJournal(store)
  const calls: string[] = []
  const controller = new TaskInteractionController({
    store,
    journal,
    dispatch: async ({ interaction }) => {
      calls.push(interaction.text ?? '')
      if (calls.length === 1) {
        await journal.enqueue({
          projectId: TEST_IDS.projectId,
          taskId: TEST_IDS.taskId,
          executionId: TEST_IDS.executionId,
          kind: 'guidance',
          text: '第二条指导应在同一轮 flush 中继续消费。'
        })
      }
      return { outcome: 'applied' }
    }
  })

  await controller.submitGuidance({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    text: '第一条指导。'
  })

  assert.deepEqual(calls, ['第一条指导。', '第二条指导应在同一轮 flush 中继续消费。'])
  assert.equal(controller.view(TEST_IDS.projectId, TEST_IDS.taskId).pending.length, 0)
})

function runningExecution(): TaskExecution {
  return taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    attempt: 1,
    offeredByCoordinatorAgentId: TEST_IDS.secondAgentId,
    assigneeUserId: TEST_IDS.userId,
    assigneeAgentId: TEST_IDS.agentId,
    assigneeDeviceId: TEST_IDS.deviceId,
    state: 'running',
    stateRevision: 2,
    fence: {
      schemaVersion: 1,
      executionId: TEST_IDS.executionId,
      assigneeUserId: TEST_IDS.userId,
      assigneeAgentId: TEST_IDS.agentId,
      assigneeDeviceId: TEST_IDS.deviceId,
      assignmentTaskRevision: 1,
      projectExecutionAuthorityEpoch: 1,
      userTaskAuthorityEpoch: 1,
      bindingRevision: null,
      status: 'open',
      reason: null,
      fencedAt: null
    },
    fileIntent: null,
    currentResultSubmissionId: null,
    offeredAt: TEST_TIMESTAMP,
    acceptedAt: TEST_TIMESTAMP,
    startedAt: TEST_LATER_TIMESTAMP,
    terminalAt: null,
    revision: 2,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
}

function runningTaskRun(task: Task, execution: TaskExecution) {
  return {
    offer: {
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      taskOfferId: TEST_IDS.taskOfferId,
      currentTaskRevision: task.revision,
      currentExecutionRevision: execution.revision,
      offerRevision: 1,
      recipientAgentId: TEST_IDS.agentId,
      receivedAt: TEST_TIMESTAMP
    },
    task,
    execution,
    latestPreflight: null,
    decision: { decision: 'accept' as const, decidedAt: TEST_TIMESTAMP },
    expectedTaskRevision: task.revision,
    expectedExecutionRevision: execution.revision,
    state: 'running' as const,
    workspaceRoot: '/tmp/sciforge-interaction-test',
    runtimeId: 'runtime-worker',
    threadId: 'thread-worker',
    humanRequestId: null,
    humanAnswer: null,
    resources: [],
    agentJournal: [],
    externalJournal: [],
    outputs: [],
    recoveryJournalEntryIds: [],
    resultSummary: null,
    lateOutcomes: [],
    startedAt: TEST_LATER_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP,
    completedAt: null,
    error: null
  }
}
