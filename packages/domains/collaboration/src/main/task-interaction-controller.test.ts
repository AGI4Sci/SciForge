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
import { collaborationTaskInteractionReadResultSchema } from '../contract.js'

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

test('published Task diagnostics are scoped, sanitized, bounded and retain older startup failures', async () => {
  const task = taskSchema.parse(taskFixture)
  const run = runningTaskRun(task, runningExecution())
  const journal = Array.from({ length: 40 }, (_, index) => ({
    logicalInvocationId: `agent.${index}`, clientDirectiveId: `directive.${index}`,
    state: index === 0 ? 'observed_failure' as const : 'observed_success' as const,
    preparedAt: TEST_TIMESTAMP, dispatchedAt: TEST_TIMESTAMP, observedAt: TEST_LATER_TIMESTAMP,
    runtimeId: 'codex', threadId: 'thread-secret', turnId: index === 0 ? null : `turn.${index}`,
    runtimeState: index === 0 ? 'failed' as const : 'completed' as const,
    safeError: index === 0 ? `startup secret ${'😀'.repeat(1_500)}` : null,
    safeResultText: 'private result must stay private'
  }))
  const store = new CollaborationLocalStore(new MemoryBackend({
    ...structuredClone(EMPTY_COLLABORATION_LOCAL_STATE),
    taskRuns: [{ ...run, agentJournal: journal }]
  }))
  await store.open()
  const controller = new TaskInteractionController({ store,
    sanitizeText: (text) => text.replaceAll('secret', '[REDACTED]') })
  const view = controller.view(TEST_IDS.projectId, TEST_IDS.taskId, TEST_IDS.executionId)
  const parsed = collaborationTaskInteractionReadResultSchema.parse({ view })
  const diagnostics = parsed.view.runtimeDiagnostics!
  assert.equal(diagnostics.coverage.total, 40)
  assert.equal(diagnostics.coverage.included, 20)
  assert.equal(diagnostics.coverage.omitted, 20)
  assert.equal(diagnostics.coverage.truncated, 1)
  assert.equal(diagnostics.coverage.sanitized, true)
  assert.deepEqual(diagnostics.agentJournal.slice(0, 3).map((entry) => entry.logicalInvocationId), ['agent.39', 'agent.38', 'agent.0'])
  assert.equal(diagnostics.agentJournal[2]!.turnId, null)
  assert.ok(diagnostics.agentJournal[2]!.safeError!.length <= 1_000)
  assert.doesNotMatch(diagnostics.agentJournal[2]!.safeError!, /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u)
  const serialized = JSON.stringify(diagnostics)
  assert.ok(serialized.length < 17_000)
  assert.doesNotMatch(serialized, /secret|private result|safeResultText/u)
  assert.equal(controller.view('other-project', TEST_IDS.taskId, TEST_IDS.executionId).runtimeDiagnostics, undefined)
  assert.equal(controller.view(TEST_IDS.projectId, 'other-task', TEST_IDS.executionId).runtimeDiagnostics, undefined)
  assert.equal(controller.view(TEST_IDS.projectId, TEST_IDS.taskId, 'other-execution').runtimeDiagnostics, undefined)
})

test('diagnostics retain sanitized structured failures after reopening the durable store', async () => {
  const run = runningTaskRun(taskSchema.parse(taskFixture), runningExecution())
  const backend = new MemoryBackend({ ...structuredClone(EMPTY_COLLABORATION_LOCAL_STATE), taskRuns: [{ ...run,
    agentJournal: [{ logicalInvocationId: 'failed.start', clientDirectiveId: 'directive.start',
      state: 'observed_failure', preparedAt: TEST_TIMESTAMP, dispatchedAt: TEST_TIMESTAMP,
      observedAt: TEST_LATER_TIMESTAMP, runtimeId: 'codex', threadId: null, turnId: null,
      runtimeState: 'failed', safeError: 'startup secret', safeResultText: null,
      failure: { code: 'runtime_start_failed', message: 'startup secret', retryable: true } }]
  }] })
  const first = new CollaborationLocalStore(backend)
  await first.open()
  const reopened = new CollaborationLocalStore(backend)
  await reopened.open()
  const controller = new TaskInteractionController({ store: reopened,
    sanitizeText: (text) => text.replaceAll('secret', '[REDACTED]') })
  const result = collaborationTaskInteractionReadResultSchema.parse({ view: controller.view(TEST_IDS.projectId, TEST_IDS.taskId, TEST_IDS.executionId) })
  assert.deepEqual(result.view.runtimeDiagnostics?.agentJournal[0]?.failure,
    { code: 'runtime_start_failed', message: 'startup [REDACTED]', retryable: true })
  assert.doesNotMatch(JSON.stringify(result), /secret/)
  assert.equal(controller.view(TEST_IDS.projectId, TEST_IDS.taskId, 'another-execution').runtimeDiagnostics, undefined)
})

test('Task diagnostics omit oversized identity envelopes and cap aggregate serialized records', async () => {
  const run = runningTaskRun(taskSchema.parse(taskFixture), runningExecution())
  const journal = Array.from({ length: 40 }, (_, index) => ({
    logicalInvocationId: `agent.${index}`, clientDirectiveId: `directive.${index}`,
    state: 'observed_failure' as const, preparedAt: TEST_TIMESTAMP,
    dispatchedAt: TEST_TIMESTAMP, observedAt: TEST_LATER_TIMESTAMP,
    runtimeId: 'codex', threadId: 't'.repeat(500), turnId: 'u'.repeat(500),
    runtimeState: 'failed' as const, safeError: 'x'.repeat(4_000), safeResultText: null
  }))
  const store = new CollaborationLocalStore(new MemoryBackend({
    ...structuredClone(EMPTY_COLLABORATION_LOCAL_STATE), taskRuns: [{ ...run, agentJournal: journal }]
  }))
  await store.open()
  const controller = new TaskInteractionController({ store,
    sanitizeText: (text) => text === 'directive.39' ? 'x'.repeat(300) : text })
  const diagnostics = controller.view(TEST_IDS.projectId, TEST_IDS.taskId, TEST_IDS.executionId).runtimeDiagnostics!
  assert.ok(diagnostics.coverage.included < 20)
  assert.equal(diagnostics.coverage.total, diagnostics.coverage.included + diagnostics.coverage.omitted)
  assert.equal(diagnostics.coverage.truncated, diagnostics.coverage.included)
  assert.ok(diagnostics.agentJournal.every((entry) => entry.logicalInvocationId !== 'agent.39'))
  assert.ok(JSON.stringify(diagnostics.agentJournal).length < 16_100)
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
