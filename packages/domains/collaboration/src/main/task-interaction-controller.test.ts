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

test('local pause and resume apply without requiring a Runtime dispatch', async () => {
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
  let dispatchCount = 0
  const controller = new TaskInteractionController({
    store,
    dispatch: async () => { dispatchCount += 1; throw new Error('Runtime is temporarily unavailable.') }
  })

  const paused = await controller.submitPause({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId
  })

  assert.equal(paused.state, 'applied')
  assert.equal(store.snapshot().taskRuns[0]?.execution?.state, 'running')
  assert.equal(controller.view(TEST_IDS.projectId, TEST_IDS.taskId).state, 'paused_local')

  const resumed = await controller.submitResume({
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId
  })

  assert.equal(resumed.state, 'applied')
  assert.equal(dispatchCount, 0)
  assert.equal(controller.view(TEST_IDS.projectId, TEST_IDS.taskId).state, 'running')
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
