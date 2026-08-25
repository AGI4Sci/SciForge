import { describe, expect, it } from 'vitest'

import { taskExecutionPreflightSchema } from './cloud-state-protocol.js'
import { restRequestSchema } from './protocol.js'
import { checkCoordinatorAuthorityEpoch } from './rules.js'
import { taskExecutionSchema } from './task-execution.js'
import { TEST_IDS, TEST_LATER_TIMESTAMP, TEST_TIMESTAMP } from './testing.js'

const openFence = {
  schemaVersion: 1 as const,
  executionId: TEST_IDS.executionId,
  assigneeUserId: TEST_IDS.secondUserId,
  assigneeAgentId: TEST_IDS.secondAgentId,
  assigneeDeviceId: 'dev_WorkerDevice01',
  assignmentTaskRevision: 2,
  projectExecutionAuthorityEpoch: 1,
  userTaskAuthorityEpoch: 3,
  bindingRevision: null,
  status: 'open' as const,
  reason: null,
  fencedAt: null
}

const offeredExecution = {
  schemaVersion: 1 as const,
  type: 'task_execution' as const,
  projectId: TEST_IDS.projectId,
  taskId: TEST_IDS.taskId,
  executionId: TEST_IDS.executionId,
  attempt: 1,
  offeredByCoordinatorAgentId: TEST_IDS.agentId,
  assigneeUserId: TEST_IDS.secondUserId,
  assigneeAgentId: TEST_IDS.secondAgentId,
  assigneeDeviceId: 'dev_WorkerDevice01',
  state: 'offered' as const,
  stateRevision: 1,
  fence: openFence,
  fileIntent: null,
  currentResultSubmissionId: null,
  offeredAt: TEST_TIMESTAMP,
  acceptedAt: null,
  startedAt: null,
  terminalAt: null,
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
}

describe('Task execution attempts and fences', () => {
  it('permits an offered execution to be cancelled or Device-revoked without inventing acceptance', () => {
    for (const [state, reason] of [
      ['cancelled', 'execution_cancelled'],
      ['revoked', 'device_revoked']
    ] as const) {
      expect(taskExecutionSchema.safeParse({
        ...offeredExecution,
        state,
        stateRevision: 2,
        fence: {
          ...openFence,
          status: 'fenced',
          reason,
          fencedAt: TEST_LATER_TIMESTAMP
        },
        terminalAt: TEST_LATER_TIMESTAMP,
        revision: 2,
        updatedAt: TEST_LATER_TIMESTAMP
      }).success).toBe(true)
    }
  })

  it('retains the immutable result submission after review acceptance', () => {
    const completed = {
      ...offeredExecution,
      state: 'completed' as const,
      stateRevision: 5,
      fence: {
        ...openFence,
        status: 'fenced' as const,
        reason: 'completed' as const,
        fencedAt: TEST_LATER_TIMESTAMP
      },
      currentResultSubmissionId: TEST_IDS.resultSubmissionId,
      acceptedAt: TEST_TIMESTAMP,
      startedAt: TEST_TIMESTAMP,
      terminalAt: TEST_LATER_TIMESTAMP,
      revision: 5,
      updatedAt: TEST_LATER_TIMESTAMP
    }
    expect(taskExecutionSchema.safeParse(completed).success).toBe(true)
    expect(taskExecutionSchema.safeParse({
      ...completed,
      currentResultSubmissionId: null
    }).success).toBe(false)
  })

  it('rejects a live execution whose write fence is already closed', () => {
    expect(taskExecutionSchema.safeParse({
      ...offeredExecution,
      state: 'running',
      acceptedAt: TEST_TIMESTAMP,
      startedAt: TEST_TIMESTAMP,
      fence: {
        ...openFence,
        status: 'fenced',
        reason: 'device_revoked',
        fencedAt: TEST_LATER_TIMESTAMP
      }
    }).success).toBe(false)
  })

  it('preflights current Project, User, Device and Agent authority without fencing on ordinary entity revisions', () => {
    const runningExecution = taskExecutionSchema.parse({
      ...offeredExecution,
      state: 'running',
      stateRevision: 3,
      acceptedAt: TEST_TIMESTAMP,
      startedAt: TEST_TIMESTAMP,
      revision: 3
    })
    const allowed = {
      schemaVersion: 1 as const,
      type: 'task_execution_preflight' as const,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      currentExecutionId: TEST_IDS.executionId,
      taskKind: 'text' as const,
      projectStatus: 'active' as const,
      projectRevision: 99,
      projectExecutionAuthorityEpoch: 1,
      requestedTaskRevision: 5,
      currentTaskRevision: 5,
      requestedExecutionRevision: 3,
      membership: {
        schemaVersion: 1 as const,
        type: 'project_membership' as const,
        projectMembershipId: TEST_IDS.projectMembershipId,
        projectId: TEST_IDS.projectId,
        userId: TEST_IDS.secondUserId,
        state: 'active' as const,
        authorityEpoch: 4,
        activatedAt: TEST_TIMESTAMP,
        removalRequestedAt: null,
        removalRequestedByUserId: null,
        removedAt: null,
        revision: 8,
        createdAt: TEST_TIMESTAMP,
        updatedAt: TEST_TIMESTAMP
      },
      taskAuthorities: [{
        schemaVersion: 1 as const,
        type: 'task_authority' as const,
        taskAuthorityId: TEST_IDS.taskAuthorityId,
        projectId: TEST_IDS.projectId,
        userId: TEST_IDS.secondUserId,
        scope: 'text_tasks' as const,
        state: 'eligible' as const,
        authorityEpoch: 3,
        reason: null,
        effectiveAt: TEST_TIMESTAMP,
        revision: 21,
        createdAt: TEST_TIMESTAMP,
        updatedAt: TEST_TIMESTAMP
      }],
      device: {
        deviceId: 'dev_WorkerDevice01',
        userId: TEST_IDS.secondUserId,
        revision: 77,
        status: 'active' as const
      },
      agent: {
        agentId: TEST_IDS.secondAgentId,
        ownerUserId: TEST_IDS.secondUserId,
        deviceId: 'dev_WorkerDevice01',
        revision: 88,
        lifecycleStatus: 'active' as const,
        connectionStatus: 'online' as const
      },
      contentReadiness: null,
      contentBinding: null,
      execution: runningExecution,
      decision: { outcome: 'allowed' as const, reasons: [] },
      evaluatedAt: TEST_LATER_TIMESTAMP
    }

    expect(taskExecutionPreflightSchema.safeParse(allowed).success).toBe(true)
    expect(taskExecutionPreflightSchema.safeParse({
      ...allowed,
      projectExecutionAuthorityEpoch: 2
    }).success).toBe(false)
    expect(taskExecutionPreflightSchema.safeParse({
      ...allowed,
      device: { ...allowed.device, status: 'revoked' }
    }).success).toBe(false)
  })
})

describe('Coordinator authority epoch', () => {
  it('fences every old Coordinator epoch deterministically', () => {
    expect(checkCoordinatorAuthorityEpoch(4, 4)).toEqual({
      outcome: 'match',
      currentCoordinatorAuthorityEpoch: 4
    })
    expect(checkCoordinatorAuthorityEpoch(3, 4)).toEqual({
      outcome: 'fenced',
      expectedCoordinatorAuthorityEpoch: 3,
      currentCoordinatorAuthorityEpoch: 4
    })
  })

  it('requires the epoch on Coordinator writes and transfer', () => {
    const withdraw = {
      protocolVersion: '1.0',
      type: 'task.offer.withdraw',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_offer_withdraw_001',
      taskOfferId: TEST_IDS.taskOfferId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      expectedTaskRevision: 2,
      expectedExecutionRevision: 1,
      expectedOfferRevision: 1,
      expectedCoordinatorAuthorityEpoch: 4,
      reason: 'Coordinator selected a replacement.'
    }
    expect(restRequestSchema.safeParse(withdraw).success).toBe(true)
    const { expectedCoordinatorAuthorityEpoch: _omitted, ...withoutEpoch } = withdraw
    expect(restRequestSchema.safeParse(withoutEpoch).success).toBe(false)

    expect(restRequestSchema.safeParse({
      protocolVersion: '1.0',
      type: 'project.transfer_coordinator',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_transfer_coord_001',
      projectId: TEST_IDS.projectId,
      expectedRevision: 4,
      expectedCoordinatorAuthorityEpoch: 4,
      coordinatorAgentId: TEST_IDS.secondAgentId,
      expectedCoordinatorAvailabilityRevision: 7
    }).success).toBe(true)
  })

  it('requires exact availability for reassignment and revision offers', () => {
    const reassign = {
      protocolVersion: '1.0',
      type: 'task.offer.reassign',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_offer_reassign_001',
      taskId: TEST_IDS.taskId,
      previousExecutionId: TEST_IDS.executionId,
      expectedTaskRevision: 3,
      expectedExecutionRevision: 2,
      expectedCoordinatorAuthorityEpoch: 4,
      assigneeAgentId: TEST_IDS.secondAgentId,
      expectedAvailabilityRevision: 9,
      offerExpiresAt: TEST_LATER_TIMESTAMP
    }
    expect(restRequestSchema.safeParse(reassign).success).toBe(true)
    const { expectedAvailabilityRevision: _availability, ...withoutAvailability } = reassign
    expect(restRequestSchema.safeParse(withoutAvailability).success).toBe(false)
    expect(restRequestSchema.safeParse({ ...reassign, fileIntent: null }).success).toBe(false)

    const review = {
      protocolVersion: '1.0',
      type: 'task.result.review',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_result_review_0001',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      resultSubmissionId: TEST_IDS.resultSubmissionId,
      expectedProjectRevision: 8,
      expectedTaskRevision: 5,
      expectedExecutionRevision: 5,
      expectedResultRevision: 1,
      expectedCoordinatorAuthorityEpoch: 4,
      decision: 'request_revision',
      instruction: 'Address the missing evidence.',
      nextAssigneeAgentId: TEST_IDS.secondAgentId,
      expectedNextAssigneeAvailabilityRevision: 9,
      nextOfferExpiresAt: TEST_LATER_TIMESTAMP,
      nextFileIntent: null
    }
    expect(restRequestSchema.safeParse(review).success).toBe(true)
    expect(restRequestSchema.safeParse({
      ...review,
      expectedNextAssigneeAvailabilityRevision: null
    }).success).toBe(false)
  })

  it('fences HumanNeeded creation to the exact execution and keeps Task results on the canonical path', () => {
    const humanNeeded = {
      protocolVersion: '1.0',
      type: 'human.needed.create',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_human_needed_0001',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      expectedTaskRevision: 4,
      expectedExecutionRevision: 3,
      requiredAssurance: 'basic',
      prompt: 'Confirm how to interpret the ambiguous sample.',
      expiresAt: TEST_LATER_TIMESTAMP
    }
    expect(restRequestSchema.safeParse(humanNeeded).success).toBe(true)
    const { expectedExecutionRevision: _executionRevision, ...staleHumanNeeded } = humanNeeded
    expect(restRequestSchema.safeParse(staleHumanNeeded).success).toBe(false)
    expect(restRequestSchema.safeParse({
      protocolVersion: '1.0',
      type: 'project_record.submit',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_legacy_result_0001',
      projectId: TEST_IDS.projectId,
      sourceTaskId: TEST_IDS.taskId,
      sourceRevision: 4,
      kind: 'task_result',
      body: 'Bypass result'
    }).success).toBe(false)
  })
})
