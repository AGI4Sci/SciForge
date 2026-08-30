import assert from 'node:assert/strict'
import test from 'node:test'

import {
  taskExecutionSchema,
  taskOfferSchema,
  taskSchema,
  type Task,
  type TaskExecution,
  type TaskOffer
} from '@sciforge/collaboration-contracts'
import {
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP,
  taskFixture
} from '@sciforge/collaboration-contracts/testing'

import {
  buildTaskRecoveryLineage,
  deriveTaskRecoveryDecision,
  mergeTaskRecoveryObservations,
  type TaskRecoveryObservation
} from './task-recovery.js'

test('active open execution stays on the current Session for human interaction', () => {
  const execution = executionFixture('running', TEST_IDS.executionId, 1, 2)
  const task = taskFixtureWith({
    status: 'in_progress',
    currentExecutionId: execution.executionId,
    currentExecutionState: 'running',
    executionCount: 1,
    revision: 2
  })
  const decision = deriveTaskRecoveryDecision(observation(task, [execution], [offerFixture(execution)]))

  assert.equal(decision.action, 'continue_current_execution')
  assert.equal(decision.currentExecutionId, execution.executionId)
  assert.equal(decision.currentExecutionRevision, execution.revision)
  assert.equal(decision.previousTaskOfferId, TEST_IDS.taskOfferId)
})

test('a fenced failed execution selects the existing offer for successor reassignment', () => {
  const execution = executionFixture('failed', TEST_IDS.executionId, 1, 3)
  const task = taskFixtureWith({
    status: 'revision_requested',
    currentExecutionId: execution.executionId,
    currentExecutionState: 'failed',
    executionCount: 1,
    revision: 3
  })
  const decision = deriveTaskRecoveryDecision(observation(task, [execution], [offerFixture(execution)]))

  assert.equal(decision.action, 'reassign_successor')
  assert.equal(decision.previousTaskOfferId, TEST_IDS.taskOfferId)
  assert.equal(decision.workerUserId, TEST_IDS.userId)
  assert.equal(decision.retryable, true)
})

test('a fenced failed execution without its accepted offer is blocked closed', () => {
  const execution = executionFixture('failed', TEST_IDS.executionId, 1, 3)
  const task = taskFixtureWith({
    status: 'revision_requested',
    currentExecutionId: execution.executionId,
    currentExecutionState: 'failed',
    executionCount: 1,
    revision: 3
  })
  const decision = deriveTaskRecoveryDecision(observation(task, [execution], []))

  assert.equal(decision.action, 'blocked')
  assert.equal(decision.previousTaskOfferId, null)
  assert.match(decision.reason, /no exact accepted Task offer/u)
})

test('a fenced failed execution with exhausted retry budget is blocked', () => {
  const execution = executionFixture('failed', TEST_IDS.executionId, 3, 5)
  const task = taskFixtureWith({
    status: 'failed',
    currentExecutionId: execution.executionId,
    currentExecutionState: 'failed',
    executionCount: 3,
    maxRetries: 2,
    completedAt: TEST_LATER_TIMESTAMP,
    revision: 5
  })
  const decision = deriveTaskRecoveryDecision(observation(task, [execution], [offerFixture(execution)]))

  assert.equal(decision.action, 'blocked')
  assert.equal(decision.retryable, false)
  assert.match(decision.reason, /retry budget is exhausted/u)
})

test('an unclaimed terminal offer at the current revision can be reassigned', () => {
  const task = taskFixtureWith({
    status: 'revision_requested',
    currentExecutionId: null,
    currentExecutionState: null,
    executionCount: 0,
    revision: 2
  })
  const offer = taskOfferSchema.parse({
    ...offerFixture(null),
    state: 'rejected',
    executionId: null,
    reassignmentTaskRevision: task.revision,
    respondedAt: TEST_LATER_TIMESTAMP,
    revision: 2
  })
  const decision = deriveTaskRecoveryDecision(observation(task, [], [offer]))

  assert.equal(decision.action, 'reassign_successor')
  assert.equal(decision.previousTaskOfferId, offer.taskOfferId)
  assert.equal(decision.workerUserId, offer.workerUserId)
})

test('manual content recovery and submitted results do not dispatch a successor', () => {
  const recoveryExecution = executionFixture('manual_recovery_required', TEST_IDS.executionId, 1, 4)
  const recoveryTask = taskFixtureWith({
    status: 'manual_recovery_required',
    currentExecutionId: recoveryExecution.executionId,
    currentExecutionState: 'manual_recovery_required',
    executionCount: 1,
    revision: 4
  })
  assert.equal(
    deriveTaskRecoveryDecision(observation(recoveryTask, [recoveryExecution], [offerFixture(recoveryExecution)])).action,
    'recover_content'
  )

  const submittedExecution = executionFixture('result_submitted', TEST_IDS.executionId, 1, 4)
  const submittedTask = taskFixtureWith({
    status: 'awaiting_review',
    currentExecutionId: submittedExecution.executionId,
    currentExecutionState: 'result_submitted',
    executionCount: 1,
    revision: 4
  })
  assert.equal(
    deriveTaskRecoveryDecision(observation(submittedTask, [submittedExecution], [offerFixture(submittedExecution)])).action,
    'await_result_review'
  )
})

test('lineage derives local parent/child links from immutable attempt order', () => {
  const first = executionFixture('failed', TEST_IDS.executionId, 1, 3)
  const second = executionFixture('accepted', 'exe_Exec00000002', 2, 1)
  const task = taskFixtureWith({
    status: 'in_progress',
    currentExecutionId: second.executionId,
    currentExecutionState: 'accepted',
    executionCount: 2,
    revision: 4
  })
  const lineage = buildTaskRecoveryLineage(observation(task, [first, second], [
    offerFixture(first),
    offerFixture(second, 'ofr_Offer00000002')
  ]))

  assert.deepEqual(lineage.attempts.map(({ executionId }) => executionId), [
    first.executionId,
    second.executionId
  ])
  assert.equal(lineage.attempts[0]?.parentExecutionId, null)
  assert.equal(lineage.attempts[0]?.childExecutionId, second.executionId)
  assert.equal(lineage.attempts[1]?.parentExecutionId, first.executionId)
  assert.equal(lineage.attempts[1]?.isCurrent, true)
})

test('reconciliation rejects stale or same-revision-conflicting Cloud observations', () => {
  const execution = executionFixture('failed', TEST_IDS.executionId, 1, 3)
  const task = taskFixtureWith({
    status: 'revision_requested',
    currentExecutionId: execution.executionId,
    currentExecutionState: 'failed',
    executionCount: 1,
    revision: 3
  })
  const previous = observation(task, [execution], [offerFixture(execution)])

  assert.throws(
    () => mergeTaskRecoveryObservations(previous, { ...previous, projectRevision: previous.projectRevision - 1 }),
    /stale Project recovery observation/u
  )
  const conflict = taskSchema.parse({ ...task, title: 'Different at same revision' })
  assert.throws(
    () => mergeTaskRecoveryObservations(previous, { ...previous, task: conflict }),
    /Cloud revision conflict/u
  )
})

test('reconciliation keeps historical executions while adopting a newer Task revision', () => {
  const execution = executionFixture('failed', TEST_IDS.executionId, 1, 3)
  const task = taskFixtureWith({
    status: 'revision_requested',
    currentExecutionId: execution.executionId,
    currentExecutionState: 'failed',
    executionCount: 1,
    revision: 3
  })
  const previous = observation(task, [execution], [offerFixture(execution)])
  const nextTask = taskFixtureWith({
    status: 'offered',
    currentExecutionId: null,
    currentExecutionState: null,
    executionCount: 1,
    revision: 4
  })
  const successor = offerFixture(null, 'ofr_Offer00000002')
  const next = observation(nextTask, [execution], [offerFixture(execution), successor], 6)
  const merged = mergeTaskRecoveryObservations(previous, next)

  assert.equal(merged.task.revision, nextTask.revision)
  assert.equal(merged.projectRevision, 6)
  assert.equal(merged.executions.length, 1)
  assert.equal(merged.offers.length, 2)
})

function observation(
  task: Task,
  executions: readonly TaskExecution[],
  offers: readonly TaskOffer[],
  projectRevision = 5
): TaskRecoveryObservation {
  return {
    projectId: task.projectId,
    taskId: task.taskId,
    projectRevision,
    coordinatorAuthorityEpoch: 2,
    executionAuthorityEpoch: 2,
    task,
    executions,
    offers
  }
}

function taskFixtureWith(
  overrides: Partial<Task>
): Task {
  return taskSchema.parse({ ...taskFixture, ...overrides })
}

function executionFixture(
  state: TaskExecution['state'],
  executionId: string,
  attempt: number,
  revision: number
): TaskExecution {
  const terminal = state === 'failed' || state === 'cancelled' ||
    state === 'revoked' || state === 'manual_recovery_required' ||
    state === 'result_submitted'
  return taskExecutionSchema.parse({
    schemaVersion: 1,
    type: 'task_execution',
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId,
    attempt,
    offeredByCoordinatorAgentId: TEST_IDS.agentId,
    assigneeUserId: TEST_IDS.userId,
    assigneeAgentId: TEST_IDS.agentId,
    assigneeDeviceId: TEST_IDS.deviceId,
    state,
    stateRevision: revision,
    fence: {
      schemaVersion: 1,
      executionId,
      assigneeUserId: TEST_IDS.userId,
      assigneeAgentId: TEST_IDS.agentId,
      assigneeDeviceId: TEST_IDS.deviceId,
      assignmentTaskRevision: 1,
      projectExecutionAuthorityEpoch: 2,
      userTaskAuthorityEpoch: 1,
      bindingRevision: null,
      status: terminal ? 'fenced' : 'open',
      reason: terminal
        ? state === 'failed' ? 'execution_failed'
          : state === 'cancelled' ? 'execution_cancelled'
            : state === 'manual_recovery_required' ? 'manual_recovery_required'
              : state === 'result_submitted' ? 'result_submitted'
                : 'agent_revoked'
        : null,
      fencedAt: terminal ? TEST_LATER_TIMESTAMP : null
    },
    fileIntent: null,
    currentResultSubmissionId: state === 'result_submitted'
      ? TEST_IDS.resultSubmissionId
      : null,
    offeredAt: TEST_TIMESTAMP,
    acceptedAt: TEST_TIMESTAMP,
    startedAt: state === 'accepted' ? null : TEST_TIMESTAMP,
    terminalAt: terminal ? TEST_LATER_TIMESTAMP : null,
    revision,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
}

function offerFixture(
  execution: TaskExecution | null,
  taskOfferId: string = TEST_IDS.taskOfferId
): TaskOffer {
  return taskOfferSchema.parse({
    schemaVersion: 1,
    type: 'task_offer',
    taskOfferId,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: execution?.executionId ?? null,
    workerUserId: TEST_IDS.userId,
    offeredByCoordinatorAgentId: TEST_IDS.agentId,
    state: execution ? 'accepted' : 'pending',
    reassignmentTaskRevision: null,
    offeredAt: TEST_TIMESTAMP,
    expiresAt: '2026-08-15T08:05:00.000Z',
    respondedAt: execution ? TEST_LATER_TIMESTAMP : null,
    revision: execution ? 2 : 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  })
}
