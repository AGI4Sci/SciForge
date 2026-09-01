import { describe, expect, it } from 'vitest'

import {
  projectFinalSummarySchema,
  projectPlanSchema,
  taskResultSubmissionSchema,
  taskReviewDecisionSchema
} from './project-review.js'
import {
  projectDecisionSubmitCommandSchema,
  projectFinalSummarySubmitCommandSchema
} from './cloud-state-protocol.js'
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
        workerUserId: TEST_IDS.secondUserId,
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

  it('keeps file Plans logical and rejects a pre-bound Content revision', () => {
    const fileTask = {
      workerUserId: TEST_IDS.secondUserId,
      planItemId: 'item_file_review1',
      title: 'Review one file',
      objective: 'Read one portable input and create one new output.',
      completionCriteria: ['One new output is reviewable.'],
      dependencyPlanItemIds: [],
      requiredCapabilityTags: ['content.read', 'content.write'],
      fileIntent: {
        schemaVersion: 2,
        inputs: [],
        dependencyInputs: [],
        output: {
          kind: 'content-space.output-new',
          target: 'project-binding-root',
          mode: 'upload-new',
          fileName: 'review.md',
          mediaType: 'text/markdown',
          maxBytes: 65_536
        }
      }
    }
    expect(projectPlanSchema.shape.tasks.element.safeParse(fileTask).success).toBe(true)
    expect(projectPlanSchema.shape.tasks.element.safeParse({
      ...fileTask,
      fileIntent: { ...fileTask.fileIntent, schemaVersion: 1 }
    }).success).toBe(false)
    expect(projectPlanSchema.shape.tasks.element.safeParse({
      ...fileTask,
      fileIntent: { ...fileTask.fileIntent, bindingRevision: 1 }
    }).success).toBe(false)
  })

  it('rejects a cyclic Task dependency graph before Cloud submit', () => {
    const task = {
      workerUserId: TEST_IDS.secondUserId,
      title: 'Review one dependency',
      objective: 'Produce one independently reviewable result.',
      completionCriteria: ['One result is reviewable.'],
      requiredCapabilityTags: ['runtime.text'],
      fileIntent: null
    }
    expect(projectPlanSchema.safeParse({
      ...metadata,
      type: 'project_plan',
      projectPlanId: TEST_IDS.projectPlanId,
      projectId: TEST_IDS.projectId,
      state: 'awaiting_confirmation',
      planRevision: 1,
      sourceInputLocators: [],
      tasks: [{
        ...task,
        planItemId: 'item_cycle_a',
        dependencyPlanItemIds: ['item_cycle_b']
      }, {
        ...task,
        planItemId: 'item_cycle_b',
        dependencyPlanItemIds: ['item_cycle_a']
      }],
      rationale: 'This cyclic graph must never enter Cloud state.',
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
    }).success).toBe(false)
  })

  it('allows dependency file inputs only from direct file Task dependencies', () => {
    const fileDeclaration = (fileName: string) => ({
      schemaVersion: 2 as const,
      inputs: [],
      dependencyInputs: [],
      output: {
        kind: 'content-space.output-new' as const,
        target: 'project-binding-root' as const,
        mode: 'upload-new' as const,
        fileName,
        mediaType: 'text/markdown',
        maxBytes: 65_536
      }
    })
    const task = {
      workerUserId: TEST_IDS.secondUserId,
      title: 'Produce one dependency result',
      objective: 'Produce one independently reviewable result.',
      completionCriteria: ['One result is reviewable.'],
      requiredCapabilityTags: ['runtime.text']
    }
    const source = {
      ...task,
      planItemId: 'item_dependency_file_source',
      dependencyPlanItemIds: [],
      fileIntent: fileDeclaration('source.md')
    }
    const bridge = {
      ...task,
      planItemId: 'item_dependency_file_bridge',
      dependencyPlanItemIds: [source.planItemId],
      fileIntent: fileDeclaration('bridge.md')
    }
    const textSource = {
      ...task,
      planItemId: 'item_dependency_text_source',
      dependencyPlanItemIds: [],
      fileIntent: null
    }
    const consumer = (
      dependencyPlanItemIds: readonly string[],
      selectedPlanItemId: string,
      planItemId = 'item_dependency_consumer'
    ) => ({
      ...task,
      planItemId,
      dependencyPlanItemIds: [...dependencyPlanItemIds],
      fileIntent: {
        ...fileDeclaration(`${planItemId}.md`),
        dependencyInputs: [{
          planItemId: selectedPlanItemId,
          outputIndex: 0,
          destinationName: 'selected-source.md'
        }]
      }
    })
    const planWith = (tasks: readonly unknown[]) => ({
      ...metadata,
      type: 'project_plan',
      projectPlanId: TEST_IDS.projectPlanId,
      projectId: TEST_IDS.projectId,
      state: 'awaiting_confirmation',
      planRevision: 1,
      sourceInputLocators: [],
      tasks,
      rationale: 'Dependency file selectors are validated before Cloud submit.',
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

    expect(projectPlanSchema.safeParse(planWith([
      source,
      consumer([source.planItemId], source.planItemId)
    ])).success).toBe(true)

    const invalidCases = [{
      tasks: [
        source,
        bridge,
        consumer([bridge.planItemId], source.planItemId)
      ],
      expectedIssue: 'A dependency input must select a direct Task dependency.'
    }, {
      tasks: [
        source,
        consumer(
          ['item_dependency_self'],
          'item_dependency_self',
          'item_dependency_self'
        )
      ],
      expectedIssue: 'A plan item cannot depend on itself.'
    }, {
      tasks: [
        textSource,
        consumer([textSource.planItemId], textSource.planItemId)
      ],
      expectedIssue: 'A dependency input must select output from a file Task.'
    }]
    for (const { tasks, expectedIssue } of invalidCases) {
      const parsed = projectPlanSchema.safeParse(planWith(tasks))
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        expect(parsed.error.issues.map(({ message }) => message)).toContain(expectedIssue)
      }
    }
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
      nextTaskOfferId: null,
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
      nextTaskOfferId: 'ofr_RevisionOffer01',
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
    expect(projectFinalSummarySubmitCommandSchema.safeParse({
      ...command,
      acceptedResultSubmissionIds: [TEST_IDS.resultSubmissionId, TEST_IDS.resultSubmissionId]
    }).success).toBe(false)
    expect(projectFinalSummarySubmitCommandSchema.safeParse({ ...command, integrityVerified: true }).success).toBe(false)
  })

  it('binds a Coordinator decision to one exact target User HumanAnswer revision', () => {
    const command = {
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_project_decision_0001',
      type: 'project.decision.submit',
      projectId: TEST_IDS.projectId,
      humanRequestId: TEST_IDS.humanRequestId,
      humanAnswerId: TEST_IDS.humanAnswerId,
      expectedProjectRevision: 5,
      expectedCoordinatorAuthorityEpoch: 2,
      expectedHumanRequestRevision: 2,
      expectedHumanAnswerRevision: 1,
      decision: 'Proceed with the frozen Coordinator boundary.'
    } as const

    expect(projectDecisionSubmitCommandSchema.safeParse(command).success).toBe(true)
    expect(projectDecisionSubmitCommandSchema.safeParse({
      ...command,
      humanAnswerId: undefined
    }).success).toBe(false)
  })
})
