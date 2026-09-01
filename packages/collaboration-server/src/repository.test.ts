import { describe, expect, it } from 'vitest'

import { FakeCollaborationRepository } from '../../../test-fixtures/collaboration/fake-adapters.mjs'
import { PostgresCollaborationRepository, type SqlConnection } from './postgres.js'
import type { CollaborationReadRepository, CollaborationTransaction } from './repository.js'

const canonicalReadPorts = [
  'getVisibleRecoveryAction',
  'listVisibleRecoveryActionsByProject',
  'getExternalOperationJournalById',
  'listProjectsForUser',
  'listTasksByProject',
  'listHumanRequestsByProject',
  'listTaskExecutionsByProject',
  'listTaskOffersByProject',
  'listTaskResultSubmissionsByProject',
  'listTaskResultReviewsByProject'
] as const satisfies readonly (keyof CollaborationReadRepository)[]

const visibleRecoveryTransactionPorts = [
  'getVisibleRecoveryActionForUpdate',
  'insertVisibleRecoveryAction',
  'updateVisibleRecoveryAction',
  'getExternalOperationJournalByIdForUpdate'
] as const satisfies readonly (keyof CollaborationTransaction)[]

describe('canonical collaboration persistence ports', () => {
  it('publishes one canonical read and CAS transaction contract', async () => {
    expect(canonicalReadPorts).toEqual([
      'getVisibleRecoveryAction',
      'listVisibleRecoveryActionsByProject',
      'getExternalOperationJournalById',
      'listProjectsForUser',
      'listTasksByProject',
      'listHumanRequestsByProject',
      'listTaskExecutionsByProject',
      'listTaskOffersByProject',
      'listTaskResultSubmissionsByProject',
      'listTaskResultReviewsByProject'
    ])
    expect(visibleRecoveryTransactionPorts).toEqual([
      'getVisibleRecoveryActionForUpdate',
      'insertVisibleRecoveryAction',
      'updateVisibleRecoveryAction',
      'getExternalOperationJournalByIdForUpdate'
    ])

    const connection: SqlConnection = {
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => undefined
    }
    const repository = new PostgresCollaborationRepository({
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => connection,
      end: async () => undefined
    })
    for (const port of canonicalReadPorts) {
      expect(repository[port]).toBeTypeOf('function')
    }
    await repository.transaction(async (transaction) => {
      for (const port of visibleRecoveryTransactionPorts) {
        expect(transaction[port]).toBeTypeOf('function')
      }
    })
  })

  it('fail-closes removed and pending Memberships while retaining terminal visible Projects', async () => {
    const repository = new FakeCollaborationRepository()
    const at = '2026-08-24T05:00:00.000Z'
    const targetUserId = 'usr_ProjectReader1'
    const project = (projectId: string, ownerUserId: string, status: string) => ({
      projectId, ownerUserId, displayName: projectId, goal: 'Synthetic pagination boundary',
      contentMode: 'none', status, coordinatorAgentId: 'agn_ProjectCoord1',
      coordinatorAuthorityEpoch: 1, executionAuthorityEpoch: 1, contentOwnerUserId: null,
      budget: { maxTasks: 20, maxTasksPerRound: 5, maxTaskRetries: 2, maxCoordinationRounds: 4 },
      coordinationRound: 0, revision: 1, createdAt: at, updatedAt: at
    })
    const member = (projectId: string, state: string, ordinal: number) => ({
      projectMembershipId: `pmb_ProjectReader${ordinal}`, projectId, userId: targetUserId,
      state, authorityEpoch: 1, activatedAt: state === 'pending_membership' ? null : at,
      removalRequestedAt: state === 'membership_removal_pending' || state === 'removed' ? at : null,
      removalRequestedByUserId: state === 'membership_removal_pending' || state === 'removed'
        ? 'usr_OtherOwner001'
        : null,
      removedAt: state === 'removed' ? at : null,
      revision: 1, createdAt: at, updatedAt: at
    })
    await repository.insertProject(
      project('prj_ProjectPage01', targetUserId, 'completed'), []
    )
    await repository.insertProject(
      project('prj_ProjectPage02', 'usr_OtherOwner001', 'cancelled'),
      [member('prj_ProjectPage02', 'active', 2)]
    )
    await repository.insertProject(
      project('prj_ProjectPage03', 'usr_OtherOwner001', 'completed'),
      [member('prj_ProjectPage03', 'membership_removal_pending', 3)]
    )
    await repository.insertProject(
      project('prj_ProjectPage04', 'usr_OtherOwner001', 'completed'),
      [member('prj_ProjectPage04', 'removed', 4)]
    )
    await repository.insertProject(
      project('prj_ProjectPage05', 'usr_OtherOwner001', 'active'),
      [member('prj_ProjectPage05', 'pending_membership', 5)]
    )

    await expect(repository.listProjectsForUser(targetUserId, null, 2)).resolves.toMatchObject([
      { projectId: 'prj_ProjectPage01', status: 'completed' },
      { projectId: 'prj_ProjectPage02', status: 'cancelled' }
    ])
    await expect(repository.listProjectsForUser(
      targetUserId, 'prj_ProjectPage02', 2
    )).resolves.toMatchObject([{ projectId: 'prj_ProjectPage03', status: 'completed' }])
    await expect(repository.listProjectsForUser(
      targetUserId, 'prj_ProjectPage03', 10
    )).resolves.toEqual([])
  })
})
