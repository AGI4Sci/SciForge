import { z } from 'zod'

import {
  agentIdSchema,
  contentRecoveryJournalEntryIdSchema,
  entityMetadataShape,
  executionIdSchema,
  nonEmptyTextSchema,
  projectIdSchema,
  projectPlanIdSchema,
  projectRecordIdSchema,
  resultSubmissionIdSchema,
  reviewDecisionIdSchema,
  revisionSchema,
  runtimeIdSchema,
  sha256Schema,
  taskIdSchema,
  taskOfferIdSchema,
  timestampSchema,
  userIdSchema
} from './core.js'
import {
  portableContentSpaceLocatorSchema,
  taskFileDestinationNameSchema,
  taskFileDeclarationSchema
} from './content-space-task-io.js'

const unique = <T>(values: readonly T[]): boolean => new Set(values).size === values.length
const planItemIdSchema = z.string().regex(/^item_[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])$/u)
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
  fileIntent: taskFileDeclarationSchema.nullable()
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

export const projectPlanSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_plan'),
  projectPlanId: projectPlanIdSchema,
  projectId: projectIdSchema,
  state: projectPlanStateSchema,
  planRevision: revisionSchema,
  sourceInputLocators: z.array(portableContentSpaceLocatorSchema).max(100),
  tasks: projectPlanTasksSchema,
  rationale: nonEmptyTextSchema,
  runtimeProvenance: projectPlanRuntimeProvenanceSchema,
  planDigest: sha256Schema,
  submittedAt: timestampSchema.nullable(),
  confirmedByUserId: userIdSchema.nullable(),
  confirmedAt: timestampSchema.nullable(),
  supersededAt: timestampSchema.nullable()
}).strict().superRefine((plan, context) => {
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
})
export type ProjectPlan = z.infer<typeof projectPlanSchema>

export const taskResultRuntimeProvenanceSchema = z.object({
  runtimeId: runtimeIdSchema,
  modelId: modelIdSchema.nullable(),
  startedAt: timestampSchema,
  completedAt: timestampSchema
}).strict().superRefine((provenance, context) => {
  if (Date.parse(provenance.completedAt) < Date.parse(provenance.startedAt)) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Runtime completion cannot precede its start.' })
  }
})

export const taskResultOutputSchema = z.object({
  executionId: executionIdSchema,
  assignmentTaskRevision: revisionSchema,
  locator: portableContentSpaceLocatorSchema,
  locatorDigest: sha256Schema,
  rootLocatorDigest: sha256Schema,
  bindingRevision: revisionSchema,
  transferReceiptDigest: sha256Schema,
  observationDigest: sha256Schema,
  preflightObservationDigest: sha256Schema
}).strict().superRefine((output, context) => {
  if (output.locator.kind !== 'content-space.file-reference' &&
      output.locator.kind !== 'content-space.artifact-reference') {
    context.addIssue({
      code: 'custom',
      path: ['locator', 'kind'],
      message: 'A Task result output must be an exact file or fixed artifact reference.'
    })
  }
})
export type TaskResultOutput = z.infer<typeof taskResultOutputSchema>

/**
 * Provider-neutral evidence produced by the canonical Content Space recovery
 * observation. It describes what the current Owner observed; it is neither a
 * Provider credential nor reusable Content Space authority.
 */
export const taskRecoveryObservedOutputSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  assignmentTaskRevision: revisionSchema,
  bindingRevision: revisionSchema,
  logicalInvocationId: z.string().trim().min(1).max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  requestDigest: sha256Schema,
  rootLocator: portableContentSpaceLocatorSchema,
  rootLocatorDigest: sha256Schema,
  expectedName: taskFileDestinationNameSchema,
  locator: portableContentSpaceLocatorSchema,
  locatorDigest: sha256Schema,
  contentObservationReceiptDigest: sha256Schema,
  observationDigest: sha256Schema,
  providerObservationDigest: sha256Schema,
  observedAt: timestampSchema
}).strict().superRefine((observation, context) => {
  if (observation.rootLocator.kind !== 'content-space.container-reference') {
    context.addIssue({
      code: 'custom',
      path: ['rootLocator', 'kind'],
      message: 'Task recovery must observe beneath the exact Project Content root.'
    })
  }
  if (observation.locator.kind !== 'content-space.file-reference') {
    context.addIssue({
      code: 'custom',
      path: ['locator', 'kind'],
      message: 'Task recovery can link only one exact observed Provider file.'
    })
  }
  if (observation.rootLocator.authority !== observation.locator.authority) {
    context.addIssue({
      code: 'custom',
      path: ['locator', 'authority'],
      message: 'Task recovery root and output must use one exact Provider Instance.'
    })
  }
})
export type TaskRecoveryObservedOutput = z.infer<typeof taskRecoveryObservedOutputSchema>

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
