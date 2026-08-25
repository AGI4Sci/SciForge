import { describe, expect, it } from 'vitest'

import {
  projectFinalSummarySchema,
  projectPlanSchema,
  taskResultSubmissionSchema,
  taskReviewDecisionSchema
} from './project-review.js'
import { projectFinalSummarySubmitCommandSchema } from './cloud-state-protocol.js'
import { TEST_HASH, TEST_IDS, TEST_LATER_TIMESTAMP, TEST_TIMESTAMP } from './testing.js'

const metadata = {
  schemaVersion: 1 as const,
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
}

describe('Project plan, result review and final summary', () => {
  it('keeps a Runtime-generated plan awaiting explicit Human confirmation', () => {
    const awaiting = projectPlanSchema.parse({
      ...metadata,
      type: 'project_plan',
      projectPlanId: TEST_IDS.projectPlanId,
      projectId: TEST_IDS.projectId,
      state: 'awaiting_confirmation',
      planRevision: 1,
      sourceInputLocators: [],
      tasks: [{
        planItemId: 'item_review0001',
        title: 'Review architecture',
        objective: 'Produce the architecture review.',
        completionCriteria: ['Submit one review'],
        dependencyPlanItemIds: [],
        requiredCapabilityTags: ['runtime.text'],
        fileIntent: null
      }],
      rationale: 'Split the review into one independently owned Task.',
      runtimeProvenance: {
        runtimeId: 'runtime-local',
        modelId: null,
        generatedByCoordinatorAgentId: TEST_IDS.agentId,
        generatedAt: TEST_TIMESTAMP
      },
      planDigest: TEST_HASH,
      submittedAt: TEST_TIMESTAMP,
      confirmedByUserId: null,
      confirmedAt: null,
      supersededAt: null
    })
    expect(projectPlanSchema.safeParse({
      ...awaiting,
      state: 'confirmed'
    }).success).toBe(false)
    const confirmed = projectPlanSchema.parse({
      ...awaiting,
      state: 'confirmed',
      confirmedByUserId: TEST_IDS.userId,
      confirmedAt: TEST_LATER_TIMESTAMP
    })
    expect(projectPlanSchema.safeParse({
      ...confirmed,
      state: 'superseded',
      supersededAt: '2026-08-15T08:02:00.000Z'
    }).success).toBe(true)
  })

  it('uses immutable result submission and explicit accept/request-revision decisions', () => {
    const result = taskResultSubmissionSchema.parse({
      ...metadata,
      type: 'task_result_submission',
      resultSubmissionId: TEST_IDS.resultSubmissionId,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      submittedTaskRevision: 3,
      submittedExecutionRevision: 4,
      submittedByUserId: TEST_IDS.secondUserId,
      submittedByAgentId: TEST_IDS.secondAgentId,
      summary: 'Architecture review completed.',
      runtimeProvenance: {
        runtimeId: 'runtime-worker',
        modelId: null,
        startedAt: TEST_TIMESTAMP,
        completedAt: TEST_LATER_TIMESTAMP
      },
      outputs: [],
      recoveryJournalEntryIds: [],
      submittedAt: TEST_LATER_TIMESTAMP,
      submissionDigest: TEST_HASH
    })
    expect(result.runtimeProvenance.modelId).toBeNull()

    expect(taskReviewDecisionSchema.safeParse({
      ...metadata,
      type: 'task_review_decision',
      reviewDecisionId: TEST_IDS.reviewDecisionId,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      resultSubmissionId: TEST_IDS.resultSubmissionId,
      reviewedResultRevision: 1,
      decidedByUserId: TEST_IDS.userId,
      decidedByCoordinatorAgentId: TEST_IDS.agentId,
      decision: 'accept',
      instruction: null,
      acceptedProjectRecordId: TEST_IDS.projectRecordId,
      nextExecutionId: null,
      decidedAt: TEST_LATER_TIMESTAMP
    }).success).toBe(true)

    expect(taskReviewDecisionSchema.safeParse({
      ...metadata,
      type: 'task_review_decision',
      reviewDecisionId: TEST_IDS.reviewDecisionId,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      resultSubmissionId: TEST_IDS.resultSubmissionId,
      reviewedResultRevision: 1,
      decidedByUserId: TEST_IDS.userId,
      decidedByCoordinatorAgentId: TEST_IDS.agentId,
      decision: 'request_revision',
      instruction: 'Add failure-mode analysis.',
      acceptedProjectRecordId: null,
      nextExecutionId: 'exe_RevisionExec01',
      decidedAt: TEST_LATER_TIMESTAMP
    }).success).toBe(true)
  })

  it('requires a final summary to name the confirmed plan and accepted results without making file integrity a PoC gate', () => {
    const finalSummary = {
      ...metadata,
      type: 'project_final_summary',
      projectId: TEST_IDS.projectId,
      projectRecordId: TEST_IDS.projectRecordId,
      projectPlanId: TEST_IDS.projectPlanId,
      confirmedPlanRevision: 2,
      acceptedResultSubmissionIds: [TEST_IDS.resultSubmissionId],
      summary: 'The design review meeting completed.',
      createdByUserId: TEST_IDS.userId,
      createdByCoordinatorAgentId: TEST_IDS.agentId,
      completedAt: TEST_LATER_TIMESTAMP
    } as const
    expect(projectFinalSummarySchema.safeParse(finalSummary).success).toBe(true)
    expect(projectFinalSummarySchema.safeParse({ ...finalSummary, integrityVerified: true }).success).toBe(false)

    const command = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_final_summary_submit_0001',
      type: 'project.final_summary.submit',
      projectId: TEST_IDS.projectId,
      expectedProjectRevision: 5,
      expectedCoordinatorAuthorityEpoch: 2,
      expectedExecutionAuthorityEpoch: 2,
      projectPlanId: TEST_IDS.projectPlanId,
      confirmedPlanRevision: 2,
      acceptedResultSubmissionIds: [TEST_IDS.resultSubmissionId],
      summary: 'The design review meeting completed.'
    } as const
    expect(projectFinalSummarySubmitCommandSchema.safeParse(command).success).toBe(true)
    expect(projectFinalSummarySubmitCommandSchema.safeParse({ ...command, integrityVerified: true }).success).toBe(false)
  })
})
