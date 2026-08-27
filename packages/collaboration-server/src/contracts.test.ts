import { describe, expect, it } from 'vitest'

import { projectFinalSummarySchema } from '@sciforge/collaboration-contracts'
import { TEST_IDS, TEST_LATER_TIMESTAMP, TEST_TIMESTAMP } from '@sciforge/collaboration-contracts/testing'

import { toProjectFinalSummary } from './contracts.js'

describe('Cloud-to-public collaboration projections', () => {
  it('projects a stored final summary through the strict public contract', () => {
    const projected = toProjectFinalSummary({
      projectId: TEST_IDS.projectId,
      projectRecordId: TEST_IDS.projectRecordId,
      projectPlanId: TEST_IDS.projectPlanId,
      confirmedPlanRevision: 2,
      acceptedResultSubmissionIds: [TEST_IDS.resultSubmissionId],
      summary: 'The exact accepted results complete the Project.',
      createdByUserId: TEST_IDS.userId,
      createdByCoordinatorAgentId: TEST_IDS.agentId,
      coordinatorAuthorityEpoch: 3,
      completedAt: TEST_LATER_TIMESTAMP,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    })

    expect(projectFinalSummarySchema.parse(projected)).toEqual(projected)
    expect(projected).not.toHaveProperty('coordinatorAuthorityEpoch')
  })
})
