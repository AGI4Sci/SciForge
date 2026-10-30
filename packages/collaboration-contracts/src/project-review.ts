import { providerInstanceRefSchema } from './project-content.js'
import { collaborationObjectLocatorSchema } from './task-object-io.js'
import { legacyTaskFileDeclarationSchema } from './legacy-content-history.js'
import { exactContractInputReferenceSchema } from './object-reference.js'
import { portableContentSpaceLocatorSchema, taskResultOutputSchema } from './legacy-content-history.js'
import { z } from 'zod'
import { deviceFactSignatureMetadataSchema } from './identity.js'
import { humanActionConfirmationSchema, scientificDigest, type HumanActionConfirmation } from './scientific-collaboration.js'

import {
  agentIdSchema,
  contentRecoveryJournalEntryIdSchema,
  entityMetadataShape,
  executionIdSchema,
  nonEmptyTextSchema,
  planItemIdSchema,
  projectIdSchema,
  projectPlanIdSchema,
  projectRecordIdSchema,
  projectResultIdSchema,
  taskIdSchema,
  providerOpaqueIdSchema,
  resultSubmissionIdSchema,
  reviewDecisionIdSchema,
  revisionSchema,
  runtimeIdSchema,
  sha256Schema,
  taskOfferIdSchema,
  timestampSchema,
  userIdSchema
} from './core.js'
import {
  taskFileDestinationNameSchema,
  taskFileDeclarationSchema
} from './task-object-io.js'
import {
  requiredOutputSchema
} from './scientific-collaboration.js'
import { projectRequirementsDocumentIdSchema } from './project-requirements.js'

const unique = <T>(values: readonly T[]): boolean => new Set(values).size === values.length
const modelIdSchema = z.string().trim().min(1).max(256)

export const projectPlanStateSchema = z.enum([
  'draft',
  'awaiting_confirmation',
  'confirmed',
  'superseded'
])
export type ProjectPlanState = z.infer<typeof projectPlanStateSchema>

const projectPlanTaskDeclarationShape = {
  planItemId: planItemIdSchema,
  title: z.string().trim().min(1).max(200),
  objective: nonEmptyTextSchema,
  completionCriteria: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100),
  dependencyPlanItemIds: z.array(planItemIdSchema).max(1_000)
    .refine(unique, 'Plan item dependencies must be unique.'),
  requiredCapabilityTags: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u)).max(256)
    .refine(unique, 'Required capability tags must be unique.'),
  fileIntent: taskFileDeclarationSchema.nullable(),
  /** Optional while a pre-PR2 draft is being recovered; Cloud requires a complete material Contract. */
  scientificScope: z.string().trim().min(1).max(8_000).optional(),
  scientificInputVersions: z.array(exactContractInputReferenceSchema).max(1_000).optional(),
  constraints: z.array(z.string().trim().min(1).max(4_000)).max(100)
    .refine(unique, 'Contract constraints must be unique.').optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(4_000)).min(1).max(100).optional(),
  requiredOutputs: z.array(requiredOutputSchema).max(100).optional()
} as const

function validateProjectPlanTaskDeclaration(
  item: Readonly<{ planItemId: string, dependencyPlanItemIds: readonly string[] }>,
  context: z.RefinementCtx
): void {
  if (item.dependencyPlanItemIds.includes(item.planItemId)) {
    context.addIssue({
      code: 'custom',
      path: ['dependencyPlanItemIds'],
      message: 'A plan item cannot depend on itself.'
    })
  }
}

/** Coordinator/Runtime-authored logical Task before a Worker User is selected. */
export const projectPlanTaskDeclarationSchema = z.object(projectPlanTaskDeclarationShape)
  .strict()
  .superRefine(validateProjectPlanTaskDeclaration)
export type ProjectPlanTaskDeclaration = z.infer<typeof projectPlanTaskDeclarationSchema>

/** Cloud-authoritative Plan Task with its immutable Worker User selection. */
export const projectPlanTaskSchema = z.object({
  ...projectPlanTaskDeclarationShape,
  workerUserId: userIdSchema
}).strict().superRefine(validateProjectPlanTaskDeclaration)
export type ProjectPlanTask = z.infer<typeof projectPlanTaskSchema>

type ProjectPlanTaskDependencyFacts = Readonly<{
  planItemId: string
  dependencyPlanItemIds: readonly string[]
  fileIntent: { dependencyInputs: readonly { planItemId: string }[] } | null
}>

function validateProjectPlanTaskGraph(
  tasks: readonly ProjectPlanTaskDependencyFacts[],
  context: z.RefinementCtx
): void {
  const planItemIds = tasks.map(({ planItemId }) => planItemId)
  if (!unique(planItemIds)) {
    context.addIssue({ code: 'custom', message: 'Plan item IDs must be unique.' })
    return
  }
  const planItemSet = new Set(planItemIds)
  let referencesValid = true
  for (const [index, task] of tasks.entries()) {
    if (task.dependencyPlanItemIds.some((dependency) => !planItemSet.has(dependency))) {
      referencesValid = false
      context.addIssue({
        code: 'custom',
        path: [index, 'dependencyPlanItemIds'],
        message: 'Every dependency must name another item in the same plan revision.'
      })
    }
  }
  if (!referencesValid) return

  const tasksByPlanItemId = new Map(tasks.map((task) => [task.planItemId, task]))
  for (const [index, task] of tasks.entries()) {
    for (const [dependencyIndex, dependencyInput] of (task.fileIntent?.dependencyInputs ?? []).entries()) {
      const source = tasksByPlanItemId.get(dependencyInput.planItemId)
      if (!task.dependencyPlanItemIds.includes(dependencyInput.planItemId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'fileIntent', 'dependencyInputs', dependencyIndex, 'planItemId'],
          message: 'A dependency input must select a direct Task dependency.'
        })
      } else if (source?.fileIntent === null) {
        context.addIssue({
          code: 'custom',
          path: [index, 'fileIntent', 'dependencyInputs', dependencyIndex, 'planItemId'],
          message: 'A dependency input must select output from a file Task.'
        })
      }
    }
  }

  const remainingDependencies = new Map(tasks.map((task) => (
    [task.planItemId, task.dependencyPlanItemIds.length]
  )))
  const dependents = new Map(planItemIds.map((planItemId) => (
    [planItemId, [] as string[]]
  )))
  for (const task of tasks) {
    for (const dependency of task.dependencyPlanItemIds) {
      dependents.get(dependency)!.push(task.planItemId)
    }
  }
  const ready = planItemIds.filter((planItemId) => remainingDependencies.get(planItemId) === 0)
  let visited = 0
  while (ready.length > 0) {
    const planItemId = ready.pop()!
    visited += 1
    for (const dependent of dependents.get(planItemId)!) {
      const remaining = remainingDependencies.get(dependent)! - 1
      remainingDependencies.set(dependent, remaining)
      if (remaining === 0) ready.push(dependent)
    }
  }
  if (visited !== tasks.length) {
    context.addIssue({ code: 'custom', message: 'Plan Task dependencies must form an acyclic graph.' })
  }
}

export const projectPlanTaskDeclarationsSchema = z.array(projectPlanTaskDeclarationSchema)
  .min(1)
  .max(1_000)
  .superRefine(validateProjectPlanTaskGraph)

export const projectPlanTasksSchema = z.array(projectPlanTaskSchema)
  .min(1)
  .max(1_000)
  .superRefine(validateProjectPlanTaskGraph)

export const projectPlanRuntimeProvenanceSchema = z.object({
  runtimeId: runtimeIdSchema,
  modelId: modelIdSchema.nullable(),
  generatedByCoordinatorAgentId: agentIdSchema,
  generatedAt: timestampSchema
}).strict()
export type ProjectPlanRuntimeProvenance = z.infer<typeof projectPlanRuntimeProvenanceSchema>

const projectPlanBaseSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_plan'),
  projectPlanId: projectPlanIdSchema,
  projectId: projectIdSchema,
  state: projectPlanStateSchema,
  planRevision: revisionSchema,
  sourceInputLocators: z.array(collaborationObjectLocatorSchema).max(100),
  tasks: projectPlanTasksSchema,
  rationale: nonEmptyTextSchema,
  runtimeProvenance: projectPlanRuntimeProvenanceSchema,
  planDigest: sha256Schema,
  submittedAt: timestampSchema.nullable(),
  confirmedByUserId: userIdSchema.nullable(),
  confirmedAt: timestampSchema.nullable(),
  supersededAt: timestampSchema.nullable()
}).strict()
function validateProjectPlan(
  plan: Omit<z.infer<typeof projectPlanBaseSchema>, 'tasks' | 'sourceInputLocators'>, context: z.RefinementCtx
): void {
  const submittedRequired = plan.state === 'awaiting_confirmation' || plan.state === 'confirmed'
  if (submittedRequired && plan.submittedAt === null) {
    context.addIssue({ code: 'custom', path: ['submittedAt'], message: 'Awaiting and confirmed plans retain their submission time.' })
  }
  if (plan.state === 'draft' && plan.submittedAt !== null) {
    context.addIssue({ code: 'custom', path: ['submittedAt'], message: 'A draft plan has not been submitted.' })
  }
  const hasConfirmation = plan.confirmedByUserId !== null && plan.confirmedAt !== null
  if ((plan.confirmedByUserId === null) !== (plan.confirmedAt === null)) {
    context.addIssue({
      code: 'custom',
      path: ['confirmedAt'],
      message: 'Plan confirmation User and time must be retained together.'
    })
  }
  if (plan.state === 'confirmed' && !hasConfirmation) {
    context.addIssue({
      code: 'custom',
      path: ['confirmedAt'],
      message: 'A confirmed plan identifies the confirming Human and time.'
    })
  }
  if ((plan.state === 'draft' || plan.state === 'awaiting_confirmation') && hasConfirmation) {
    context.addIssue({
      code: 'custom',
      path: ['confirmedAt'],
      message: 'An unconfirmed plan cannot carry confirmation history.'
    })
  }
  if ((plan.state === 'superseded') !== (plan.supersededAt !== null)) {
    context.addIssue({ code: 'custom', path: ['supersededAt'], message: 'Only a superseded plan has a supersession time.' })
  }
}
export const projectPlanSchema = projectPlanBaseSchema.superRefine(validateProjectPlan)
const legacyScientificInputVersionSchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  immutableResourceReference: z.string().trim().min(1).max(2_048),
  immutableVersionId: providerOpaqueIdSchema,
  contentDigest: sha256Schema
}).strict()
const projectPlanTaskHistorySchema = z.object({ ...projectPlanTaskSchema.shape,
  fileIntent: z.union([taskFileDeclarationSchema, legacyTaskFileDeclarationSchema]).nullable(),
  scientificInputVersions: z.union([z.array(exactContractInputReferenceSchema), z.array(legacyScientificInputVersionSchema)]).optional()
}).strict().superRefine(validateProjectPlanTaskDeclaration)
export const projectPlanHistorySchema = z.object({ ...projectPlanBaseSchema.shape,
  tasks: z.array(projectPlanTaskHistorySchema).min(1).max(1_000).superRefine(validateProjectPlanTaskGraph),
  sourceInputLocators: z.union([z.array(collaborationObjectLocatorSchema).max(100), z.array(portableContentSpaceLocatorSchema).max(100)])
}).strict().superRefine(validateProjectPlan)
export type ProjectPlanHistory = z.infer<typeof projectPlanHistorySchema>

export type ProjectPlan = z.infer<typeof projectPlanSchema>

export const taskResultRuntimeProvenanceSchema = z.object({
  runtimeId: runtimeIdSchema,
  modelId: modelIdSchema.nullable(),
  /**
   * Reasoning level actually used for the Worker run. Additive and nullable:
   * historical records lack it and must keep parsing — UIs show “未知” rather
   * than inventing a value; new producers fill it only when the runtime knows
   * the exact level that reached the wire.
   */
  reasoningLevel: z.string().trim().min(1).max(120).nullable().optional(),
  startedAt: timestampSchema,
  completedAt: timestampSchema
}).strict().superRefine((provenance, context) => {
  if (Date.parse(provenance.completedAt) < Date.parse(provenance.startedAt)) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Runtime completion cannot precede its start.' })
  }
})





/** Immutable Worker submission for the current execution fence. */
export const taskResultSubmissionSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('task_result_submission'),
  resultSubmissionId: resultSubmissionIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  submittedTaskRevision: revisionSchema,
  submittedExecutionRevision: revisionSchema,
  submittedByUserId: userIdSchema,
  submittedByAgentId: agentIdSchema,
  summary: nonEmptyTextSchema,
  runtimeProvenance: taskResultRuntimeProvenanceSchema,
  outputs: z.array(taskResultOutputSchema).max(100),
  recoveryJournalEntryIds: z.array(contentRecoveryJournalEntryIdSchema).max(100)
    .refine(unique, 'Recovery journal references must be unique.'),
  submittedAt: timestampSchema,
  submissionDigest: sha256Schema
}).strict().superRefine((submission, context) => {
  const outputDigests = submission.outputs.map(({ locatorDigest }) => locatorDigest)
  if (!unique(outputDigests)) {
    context.addIssue({ code: 'custom', path: ['outputs'], message: 'Result output locators must be unique.' })
  }
  if (submission.outputs.some(({ executionId }) => executionId !== submission.executionId)) {
    context.addIssue({ code: 'custom', path: ['outputs'], message: 'Every output must belong to the exact submitted execution.' })
  }
})
export type TaskResultSubmission = z.infer<typeof taskResultSubmissionSchema>

export const taskReviewDecisionKindSchema = z.enum(['accept', 'request_revision'])
export type TaskReviewDecisionKind = z.infer<typeof taskReviewDecisionKindSchema>

export const taskReviewDecisionSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('task_review_decision'),
  reviewDecisionId: reviewDecisionIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  resultSubmissionId: resultSubmissionIdSchema,
  reviewedResultRevision: revisionSchema,
  decidedByUserId: userIdSchema,
  decidedByCoordinatorAgentId: agentIdSchema,
  decision: taskReviewDecisionKindSchema,
  instruction: nonEmptyTextSchema.nullable(),
  acceptedProjectRecordId: projectRecordIdSchema.nullable(),
  nextTaskOfferId: taskOfferIdSchema.nullable(),
  decidedAt: timestampSchema
}).strict().superRefine((review, context) => {
  if (review.decision === 'accept') {
    if (review.instruction !== null || review.acceptedProjectRecordId === null || review.nextTaskOfferId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['acceptedProjectRecordId'],
        message: 'Accept records the accepted Project Record and creates no revision execution.'
      })
    }
  } else if (
    review.instruction === null ||
    review.acceptedProjectRecordId !== null ||
    review.nextTaskOfferId === null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['nextTaskOfferId'],
      message: 'Request-revision requires bounded instruction and the new User-targeted offer, without an accepted record.'
    })
  }
})
export type TaskReviewDecision = z.infer<typeof taskReviewDecisionSchema>

export const projectFinalSummarySchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_final_summary'),
  projectId: projectIdSchema,
  projectRecordId: projectRecordIdSchema,
  projectPlanId: projectPlanIdSchema,
  confirmedPlanRevision: revisionSchema,
  acceptedResultSubmissionIds: z.array(resultSubmissionIdSchema).min(1).max(10_000)
    .refine(unique, 'Accepted result submissions must be unique.'),
  summary: nonEmptyTextSchema,
  createdByUserId: userIdSchema,
  createdByCoordinatorAgentId: agentIdSchema,
  completedAt: timestampSchema
}).strict()
export type ProjectFinalSummary = z.infer<typeof projectFinalSummarySchema>

/** One Owner-confirmed Plan snapshot. Result order is significant and never sorted after confirmation. */
export const projectPlanCompletionTargetSchema = z.object({
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  expectedExecutionAuthorityEpoch: revisionSchema,
  projectPlanId: projectPlanIdSchema,
  confirmedPlanRevision: revisionSchema,
  projectResultIds: z.array(projectResultIdSchema).min(1).max(10_000)
    .refine(unique, 'Published Project Results must be unique.'),
  summary: nonEmptyTextSchema
}).strict()

/** One Owner-confirmed requirements snapshot. Adoption receipts, not Project Results, satisfy it. */
export const projectRequirementsCompletionTargetSchema = z.object({
  baselineKind: z.literal('requirements'),
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  expectedExecutionAuthorityEpoch: revisionSchema,
  requirementsDocumentId: projectRequirementsDocumentIdSchema,
  confirmedRequirementsRevision: revisionSchema,
  adoptedTaskIds: z.array(taskIdSchema).min(1).max(10_000)
    .refine(unique, 'Adopted Task identities must be unique.'),
  summary: nonEmptyTextSchema
}).strict()

export const projectCompletionTargetSchema = z.union([
  projectPlanCompletionTargetSchema,
  projectRequirementsCompletionTargetSchema
])
export type ProjectCompletionTarget = z.infer<typeof projectCompletionTargetSchema>

export const projectCompletionApprovalSchema = humanActionConfirmationSchema.safeExtend({
  deviceSignature: deviceFactSignatureMetadataSchema.extend({ purpose: z.literal('project-completion-approval') })
}).superRefine((proof, context) => {
  if (proof.deviceSignature.observedAt !== proof.occurredAt || Date.parse(proof.deviceSignature.issuedAt) < Date.parse(proof.occurredAt)) {
    context.addIssue({ code: 'custom', path: ['deviceSignature'], message: 'Owner approval must bind the exact human action time.' })
  }
})
export type ProjectCompletionApproval = z.infer<typeof projectCompletionApprovalSchema>

export function projectCompletionTargetDigest(target: ProjectCompletionTarget): string {
  return scientificDigest(projectCompletionTargetSchema.parse(target))
}

export function projectCompletionHumanActionFactDigest(target: ProjectCompletionTarget, action: HumanActionConfirmation): string {
  const canonicalTarget = projectCompletionTargetSchema.parse(target)
  const canonicalAction = humanActionConfirmationSchema.parse(action)
  if (canonicalAction.confirmedInputDigest !== projectCompletionTargetDigest(canonicalTarget)) {
    throw new TypeError('Owner confirmation must cover the exact Project completion target.')
  }
  return scientificDigest({ purpose: 'project-completion-approval', target: canonicalTarget, humanAction: canonicalAction })
}

/** New completion authority; the old ProjectFinalSummary remains read-only history. */
export const projectResultFinalSummarySchema = projectFinalSummarySchema.omit({ acceptedResultSubmissionIds: true }).extend({
  type: z.literal('project_result_final_summary'),
  createdByCoordinatorAgentId: agentIdSchema.nullable(),
  projectResultIds: projectPlanCompletionTargetSchema.shape.projectResultIds,
  ownerApproval: projectCompletionApprovalSchema
}).strict()
export type ProjectResultFinalSummary = z.infer<typeof projectResultFinalSummarySchema>

export const projectRequirementsFinalSummarySchema = z.object({
  ...entityMetadataShape,
  type: z.literal('requirements_final_summary'),
  projectId: projectIdSchema,
  projectRecordId: projectRecordIdSchema,
  requirementsDocumentId: projectRequirementsDocumentIdSchema,
  confirmedRequirementsRevision: revisionSchema,
  adoptedTaskIds: z.array(taskIdSchema).min(1).max(10_000)
    .refine(unique, 'Adopted Task identities must be unique.'),
  summary: nonEmptyTextSchema,
  createdByUserId: userIdSchema,
  createdByCoordinatorAgentId: agentIdSchema.nullable(),
  ownerApproval: projectCompletionApprovalSchema,
  completedAt: timestampSchema
}).strict()
export type ProjectRequirementsFinalSummary = z.infer<typeof projectRequirementsFinalSummarySchema>
export const projectFinalSummaryHistorySchema = z.discriminatedUnion('type', [
  projectFinalSummarySchema,
  projectResultFinalSummarySchema,
  projectRequirementsFinalSummarySchema
])
export type ProjectFinalSummaryHistory = z.infer<typeof projectFinalSummaryHistorySchema>
