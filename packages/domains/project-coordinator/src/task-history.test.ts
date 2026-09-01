import assert from 'node:assert/strict'
import test from 'node:test'

import { projectCoordinatorTaskHistory } from './task-history.js'
import type { ProjectCoordinatorProject } from './contract.js'

test('task history exposes immutable attempts, offers, and remaining retry budget', () => {
  const project = {
    project: {
      projectId: 'prj_history',
      revision: 3,
      coordinatorAuthorityEpoch: 1,
      executionAuthorityEpoch: 1
    },
    offers: [
      {
        taskOfferId: 'ofr_old', projectId: 'prj_history', taskId: 'tsk_history',
        executionId: null, workerUserId: 'usr_worker', offeredByCoordinatorAgentId: 'agt_coord',
        state: 'withdrawn', reassignmentTaskRevision: 2,
        offeredAt: '2026-08-30T09:00:00.000Z', expiresAt: '2026-08-30T10:00:00.000Z',
        respondedAt: '2026-08-30T09:30:00.000Z', revision: 2,
        createdAt: '2026-08-30T09:00:00.000Z', updatedAt: '2026-08-30T09:30:00.000Z'
      },
      {
        taskOfferId: 'ofr_pending', projectId: 'prj_history', taskId: 'tsk_history',
        executionId: null, workerUserId: 'usr_worker', offeredByCoordinatorAgentId: 'agt_coord',
        state: 'pending', reassignmentTaskRevision: null,
        offeredAt: '2026-08-30T11:00:00.000Z', expiresAt: '2026-08-30T12:00:00.000Z',
        respondedAt: null, revision: 1,
        createdAt: '2026-08-30T11:00:00.000Z', updatedAt: '2026-08-30T11:00:00.000Z'
      }
    ],
    tasks: [{
      task: {
        taskId: 'tsk_history', projectId: 'prj_history', status: 'offered',
        currentExecutionId: null, executionCount: 2, maxRetries: 3,
        updatedAt: '2026-08-30T11:00:00.000Z'
      },
      executions: [{
        executionId: 'exe_history', projectId: 'prj_history', taskId: 'tsk_history',
        attempt: 1, state: 'failed', stateRevision: 2,
        fence: { status: 'fenced', reason: 'execution_failed' },
        assigneeUserId: 'usr_worker', offeredAt: '2026-08-30T09:00:00.000Z'
      }]
    }]
  } as unknown as ProjectCoordinatorProject

  const history = projectCoordinatorTaskHistory(project, project.tasks[0]!)
  assert.equal(history.attempts.length, 1)
  assert.equal(history.retriesUsed, 1)
  assert.equal(history.retriesRemaining, 2)
  assert.equal(history.canWithdrawPendingOffer, true)
  assert.equal(history.canExtendPendingOffer, true)
  assert.deepEqual(history.lineage.pendingOfferIds, ['ofr_pending'])
  assert.deepEqual(history.offers.map(({ taskOfferId }) => taskOfferId), ['ofr_old', 'ofr_pending'])
})
