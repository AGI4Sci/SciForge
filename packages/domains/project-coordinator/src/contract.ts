import { z } from 'zod'
import { domainMainFiniteCapabilityBatchPlanDigestSchema } from '@sciforge/domain-sdk/host'
import {
  ARTIFACT_RESOURCE_KIND,
  CONTENT_FILE_RESOURCE_KIND
} from '@sciforge/domain-content-space/contract'
import {
  agentIdSchema,
  deviceIdSchema,
  displayNameSchema,
  inboxMessageIdSchema,
  humanAnswerCommandSchema,
  humanNeededSchema,
  humanNeededCreateCommandSchema,
  externalOperationRecoveryJournalEntrySchema,
  projectContentReadinessSchema,
  projectContentProvisioningAttestationSchema,
  projectContentProvisioningIntentSchema,
  projectContentSpaceBindingSchema,
  projectCreateCommandSchema,
  projectFinalSummarySchema,
  projectFinalSummarySubmitCommandSchema,
  projectIdSchema,
  projectMembershipAddCommandSchema,
  projectMembershipRemoveCommandSchema,
  projectMembershipSchema,
  projectProviderMembershipObservationSchema,
  projectPlanSchema,
  projectPlanRuntimeProvenanceSchema,
  projectPlanTaskSchema,
  projectRecordSchema,
  projectSchema,
  projectWorkerAvailabilityViewSchema,
  workerAvailabilityProjectionSchema,
  taskExecutionSchema,
  taskFileDestinationNameSchema,
  taskResultOutputSchema,
  taskResultReviewFactsSchema,
  taskResultSubmissionSchema,
  taskReviewDecisionSchema,
  taskSchema,
  timestampSchema,
  userIdSchema,
  visibleRecoveryActionSchema,
  providerDirectoryPrincipalFactSchema,
  portableContentSpaceLocatorSchema
} from '@sciforge/collaboration-contracts'

const safeReasonSchema = z.string().trim().min(1).max(2_000)

export const PROJECT_COORDINATOR_CAPABILITY_IDS = Object.freeze({
  workspaceRead: 'project-coordinator.workspace.read',
  projectCreate: 'project-coordinator.project.create',
  planDraftRead: 'project-coordinator.plan-draft.read',
  planDraftGenerate: 'project-coordinator.plan-draft.generate',
  planDraftEdit: 'project-coordinator.plan-draft.edit',
  planSubmit: 'project-coordinator.plan.submit',
  planConfirmActivate: 'project-coordinator.plan.confirm-activate',
  contentProvisioningPlan: 'project-coordinator.content-provisioning.plan',
  contentProvisioningApply: 'project-coordinator.content-provisioning.apply',
  contentRecoveryObserveLink: 'project-coordinator.content-recovery.observe-link',
  contentRecoveryAbandon: 'project-coordinator.content-recovery.abandon',
  contentRecoveryRetrySuccessor: 'project-coordinator.content-recovery.retry-successor',
  membershipAdd: 'project-coordinator.membership.add',
  membershipRemove: 'project-coordinator.membership.remove',
  humanNeededCreate: 'project-coordinator.human-needed.create',
  humanAnswer: 'project-coordinator.human-needed.answer',
  coordinatorTransfer: 'project-coordinator.coordinator.transfer',
  artifactReviewPrepare: 'project-coordinator.artifact-review.prepare',
  resultReview: 'project-coordinator.result.review',
  projectComplete: 'project-coordinator.project.complete'
} as const)

export const projectCoordinatorProjectCreateInputSchema = projectCreateCommandSchema.omit({
  protocolVersion: true,
  requestId: true,
  type: true,
  idempotencyKey: true,
  coordinatorAgentId: true,
  expectedCoordinatorAgentRevision: true
}).readonly()

export const projectCoordinatorConnectionSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ready'),
    userId: userIdSchema,
    deviceId: deviceIdSchema
  }).strict().readonly(),
  z.object({ state: z.literal('identity_required') }).strict().readonly(),
  z.object({
    state: z.literal('device_required'),
    reason: safeReasonSchema
  }).strict().readonly(),
  z.object({
    state: z.literal('cloud_unavailable'),
    reason: safeReasonSchema
  }).strict().readonly()
])

/** UI-only assignment projection; the Plan and Agent facts remain canonical Cloud records. */
export const projectCoordinatorPlanAssignmentSchema = z.object({
  planItemId: projectPlanTaskSchema.shape.planItemId,
  selectedAgentId: agentIdSchema.nullable(),
  recommendationReason: safeReasonSchema.nullable()
}).strict().superRefine((assignment, context) => {
  if ((assignment.selectedAgentId === null) !== (assignment.recommendationReason === null)) {
    context.addIssue({
      code: 'custom',
      path: ['recommendationReason'],
      message: 'A selected exact Agent and its recommendation reason must be projected together.'
    })
  }
}).readonly()

const projectCoordinatorDraftIdSchema = z.string()
  .regex(/^draft_[A-Za-z0-9](?:[A-Za-z0-9_-]{10,95}[A-Za-z0-9])$/u)

export const projectCoordinatorPlanDraftSchema = z.object({
  draftId: projectCoordinatorDraftIdSchema,
  draftRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  projectId: projectIdSchema,
  expectedProjectRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  expectedCoordinatorAuthorityEpoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  supersedesProjectPlanId: projectPlanSchema.shape.projectPlanId.nullable(),
  sourceInputLocators: z.array(portableContentSpaceLocatorSchema).max(100),
  tasks: z.array(projectPlanTaskSchema).min(1).max(1_000),
  rationale: safeReasonSchema,
  runtimeProvenance: projectPlanRuntimeProvenanceSchema,
  assignments: z.array(projectCoordinatorPlanAssignmentSchema).min(1).max(1_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((draft, context) => {
  const taskIds = draft.tasks.map(({ planItemId }) => planItemId)
  const assignmentIds = draft.assignments.map(({ planItemId }) => planItemId)
  if (
    taskIds.length !== assignmentIds.length ||
    new Set(assignmentIds).size !== assignmentIds.length ||
    taskIds.some((planItemId) => !assignmentIds.includes(planItemId))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['assignments'],
      message: 'A Plan draft retains exactly one assignment choice for every Plan item.'
    })
  }
  if (Date.parse(draft.updatedAt) < Date.parse(draft.createdAt)) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Draft update cannot precede creation.' })
  }
}).readonly()

export const projectCoordinatorPlanDraftGenerateInputSchema = z.object({
  projectId: projectIdSchema,
  instruction: safeReasonSchema,
  sourceInputLocators: z.array(portableContentSpaceLocatorSchema).max(100),
  modelId: z.string().trim().min(1).max(256).nullable()
}).strict().readonly()

export const projectCoordinatorPlanDraftGenerateFailureReasonSchema = z.enum([
  'runtime_unavailable',
  'runtime_execution_failed',
  'invalid_structured_output'
])

export const projectCoordinatorPlanDraftGenerateResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('generated'),
    draft: projectCoordinatorPlanDraftSchema
  }).strict().readonly(),
  z.object({
    status: z.literal('failed'),
    reason: projectCoordinatorPlanDraftGenerateFailureReasonSchema
  }).strict().readonly()
])

export const projectCoordinatorPlanDraftReadInputSchema = z.object({
  projectId: projectIdSchema
}).strict().readonly()

export const projectCoordinatorPlanDraftEditInputSchema = z.object({
  projectId: projectIdSchema,
  draftId: projectCoordinatorDraftIdSchema,
  expectedDraftRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  tasks: z.array(projectPlanTaskSchema).min(1).max(1_000),
  rationale: safeReasonSchema,
  assignments: z.array(projectCoordinatorPlanAssignmentSchema).min(1).max(1_000)
}).strict().readonly()

export const projectCoordinatorPlanDraftSubmitInputSchema = z.object({
  projectId: projectIdSchema,
  draftId: projectCoordinatorDraftIdSchema,
  expectedDraftRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
}).strict().readonly()

export const projectCoordinatorPlanConfirmActivateInputSchema = z.object({
  projectId: projectIdSchema,
  projectPlanId: projectPlanSchema.shape.projectPlanId,
  expectedProjectRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  expectedCoordinatorAuthorityEpoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  expectedPlanRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  planDigest: projectPlanSchema.shape.planDigest
}).strict().readonly()

export const projectCoordinatorProvisioningAttemptIdSchema = z.string()
  .trim()
  .min(12)
  .max(96)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{10,94}[A-Za-z0-9])$/u)

export const projectCoordinatorProvisioningPlanInputSchema = z.object({
  projectId: projectIdSchema
}).strict().readonly()

export const projectCoordinatorProvisioningPlanOperationSchema = z.object({
  operationId: z.string().trim().min(1).max(128),
  actionId: z.string().trim().min(1).max(256),
  kind: z.enum([
    'authorize_provider',
    'authorize_root',
    'create_shared_container',
    'observe_root',
    'list_members',
    'add_member',
    'remove_member'
  ]),
  userId: userIdSchema.nullable()
}).strict().readonly()

export const projectCoordinatorProvisioningPlanSchema = z.object({
  projectId: projectIdSchema,
  provisioningIntentId: projectContentProvisioningIntentSchema.shape.provisioningIntentId,
  expectedProjectRevision: projectSchema.shape.revision,
  expectedProvisioningRevision: projectContentProvisioningIntentSchema.shape.provisioningRevision,
  expectedProvisioningIntentRevision: projectContentProvisioningIntentSchema.shape.revision,
  intentDigest: projectContentProvisioningIntentSchema.shape.intentDigest,
  attemptId: projectCoordinatorProvisioningAttemptIdSchema,
  rootStrategy: z.enum(['create', 'reauthorize']),
  providerInstance: projectContentProvisioningIntentSchema.shape.providerInstance,
  containerDisplayName: projectContentProvisioningIntentSchema.shape.containerDisplayName,
  currentRootLocator: portableContentSpaceLocatorSchema.nullable(),
  operations: z.array(projectCoordinatorProvisioningPlanOperationSchema).min(1).max(64),
  confirmedPlanDigest: domainMainFiniteCapabilityBatchPlanDigestSchema
}).strict().readonly()

export const projectCoordinatorProvisioningApplyInputSchema = z.object({
  projectId: projectIdSchema,
  provisioningIntentId: projectContentProvisioningIntentSchema.shape.provisioningIntentId,
  expectedProjectRevision: projectSchema.shape.revision,
  expectedProvisioningRevision: projectContentProvisioningIntentSchema.shape.provisioningRevision,
  expectedProvisioningIntentRevision: projectContentProvisioningIntentSchema.shape.revision,
  intentDigest: projectContentProvisioningIntentSchema.shape.intentDigest,
  attemptId: projectCoordinatorProvisioningAttemptIdSchema,
  confirmedPlanDigest: domainMainFiniteCapabilityBatchPlanDigestSchema
}).strict().readonly()

export const projectCoordinatorContentRecoveryObserveLinkInputSchema = z.object({
  projectId: projectIdSchema,
  recoveryActionId: visibleRecoveryActionSchema.shape.recoveryActionId
}).strict().readonly()

export const projectCoordinatorContentRecoveryAbandonInputSchema = z.object({
  projectId: projectIdSchema,
  recoveryActionId: visibleRecoveryActionSchema.shape.recoveryActionId,
  reason: safeReasonSchema.refine((reason) => reason.length <= 500, {
    message: 'A recovery abandon reason cannot exceed 500 characters.'
  })
}).strict().readonly()

/**
 * Human-reviewed recovery choices only. The package re-reads every Task,
 * execution, authority, availability, and file-intent CAS fact before the
 * current Coordinator Agent may create a successor execution.
 */
export const projectCoordinatorContentRecoveryRetrySuccessorInputSchema = z.object({
  projectId: projectIdSchema,
  recoveryActionId: visibleRecoveryActionSchema.shape.recoveryActionId,
  assigneeAgentId: agentIdSchema,
  nextOutputFileName: taskFileDestinationNameSchema,
  offerExpiresAt: timestampSchema
}).strict().readonly()

export const projectCoordinatorMembershipAddInputSchema = z.object({
  projectId: projectMembershipAddCommandSchema.shape.projectId,
  expectedProjectRevision: projectMembershipAddCommandSchema.shape.expectedProjectRevision,
  userId: projectMembershipAddCommandSchema.shape.userId,
  providerPrincipalFactId: projectMembershipAddCommandSchema.shape.providerPrincipalFactId,
  expectedProviderPrincipalFactRevision:
    projectMembershipAddCommandSchema.shape.expectedProviderPrincipalFactRevision
}).strict().superRefine((input, context) => {
  if ((input.providerPrincipalFactId === null) !== (
    input.expectedProviderPrincipalFactRevision === null
  )) {
    context.addIssue({
      code: 'custom',
      path: ['expectedProviderPrincipalFactRevision'],
      message: 'A Provider principal fact ID and revision must be supplied together.'
    })
  }
}).readonly()

export const projectCoordinatorMembershipRemoveInputSchema = z.object({
  projectId: projectMembershipRemoveCommandSchema.shape.projectId,
  projectMembershipId: projectMembershipRemoveCommandSchema.shape.projectMembershipId,
  expectedProjectRevision: projectMembershipRemoveCommandSchema.shape.expectedProjectRevision,
  expectedMembershipRevision: projectMembershipRemoveCommandSchema.shape.expectedMembershipRevision
}).strict().readonly()

export const projectCoordinatorHumanNeededCreateInputSchema = z.object({
  projectId: humanNeededCreateCommandSchema.shape.projectId,
  expectedProjectRevision: projectSchema.shape.revision,
  expectedCoordinatorAuthorityEpoch: projectSchema.shape.coordinatorAuthorityEpoch,
  requiredAssurance: humanNeededCreateCommandSchema.shape.requiredAssurance.exclude(['basic']),
  prompt: humanNeededCreateCommandSchema.shape.prompt,
  expiresAt: humanNeededCreateCommandSchema.shape.expiresAt
}).strict().readonly()

export const projectCoordinatorHumanAnswerInputSchema = humanAnswerCommandSchema.omit({
  protocolVersion: true,
  requestId: true,
  type: true,
  idempotencyKey: true
}).extend({
  projectId: projectIdSchema
}).strict().readonly()

/**
 * The Owner chooses only the exact successor Agent. Cloud CAS facts are
 * re-read and derived in main; renderer input cannot claim authority epochs.
 */
export const projectCoordinatorTransferInputSchema = z.object({
  projectId: projectIdSchema,
  coordinatorAgentId: agentIdSchema
}).strict().readonly()

/**
 * Selects one immutable output from fresh Cloud facts. The renderer never
 * supplies the portable locator or claims a binding/session authority fact.
 */
export const projectCoordinatorArtifactReviewPrepareInputSchema = z.object({
  projectId: projectIdSchema,
  taskId: taskResultSubmissionSchema.shape.taskId,
  executionId: taskResultSubmissionSchema.shape.executionId,
  resultSubmissionId: taskResultSubmissionSchema.shape.resultSubmissionId,
  submissionDigest: taskResultSubmissionSchema.shape.submissionDigest,
  outputIndex: z.number().int().min(0).max(99),
  locatorDigest: taskResultOutputSchema.shape.locatorDigest
}).strict().readonly()

export const projectCoordinatorArtifactReviewResourceSchema = z.object({
  kind: z.enum([CONTENT_FILE_RESOURCE_KIND, ARTIFACT_RESOURCE_KIND]),
  resourceRef: z.string().trim().regex(/^res_[A-Za-z0-9_-]{20,}$/u)
}).strict().readonly()

export const projectCoordinatorArtifactReviewPreparedSchema = z.object({
  projectId: projectIdSchema,
  taskId: taskResultSubmissionSchema.shape.taskId,
  executionId: taskResultSubmissionSchema.shape.executionId,
  resultSubmissionId: taskResultSubmissionSchema.shape.resultSubmissionId,
  outputIndex: z.number().int().min(0).max(99),
  locatorDigest: taskResultOutputSchema.shape.locatorDigest,
  resource: projectCoordinatorArtifactReviewResourceSchema
}).strict().readonly()

export const projectCoordinatorTransferFeedbackSchema = z.object({
  projectId: projectIdSchema,
  inboxMessageId: inboxMessageIdSchema,
  recipientAgentId: agentIdSchema,
  previousCoordinatorAgentId: agentIdSchema,
  coordinatorAgentId: agentIdSchema,
  coordinatorAuthorityEpoch: projectSchema.shape.coordinatorAuthorityEpoch,
  projectRevision: projectSchema.shape.revision,
  disposition: z.enum(['authority_transferred_out', 'authority_transferred_in']),
  observedAt: timestampSchema
}).strict().superRefine((feedback, context) => {
  if (
    feedback.disposition === 'authority_transferred_out' &&
    feedback.recipientAgentId !== feedback.previousCoordinatorAgentId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['recipientAgentId'],
      message: 'Transferred-out feedback must target the previous Coordinator Agent.'
    })
  }
  if (
    feedback.disposition === 'authority_transferred_in' &&
    feedback.recipientAgentId !== feedback.coordinatorAgentId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['recipientAgentId'],
      message: 'Transferred-in feedback must target the successor Coordinator Agent.'
    })
  }
}).readonly()

export const projectCoordinatorResultReviewInputSchema = taskResultReviewFactsSchema.readonly()

export const projectCoordinatorCompleteInputSchema = projectFinalSummarySubmitCommandSchema.omit({
  protocolVersion: true,
  requestId: true,
  type: true,
  idempotencyKey: true
}).strict().readonly()

export const projectCoordinatorPlanViewSchema = z.object({
  plan: projectPlanSchema,
  assignments: z.array(projectCoordinatorPlanAssignmentSchema).max(1_000)
}).strict().superRefine((view, context) => {
  const planItemIds = new Set(view.plan.tasks.map(({ planItemId }) => planItemId))
  const assignmentIds = view.assignments.map(({ planItemId }) => planItemId)
  if (new Set(assignmentIds).size !== assignmentIds.length) {
    context.addIssue({ code: 'custom', path: ['assignments'], message: 'Plan assignments must be unique.' })
  }
  view.assignments.forEach((assignment, index) => {
    if (planItemIds.has(assignment.planItemId)) return
    context.addIssue({
      code: 'custom',
      path: ['assignments', index, 'planItemId'],
      message: 'Every assignment must reference an item in the exact Plan revision.'
    })
  })
}).readonly()

export const projectCoordinatorWorkerAgentSchema = z.object({
  displayName: displayNameSchema,
  projectAvailability: projectWorkerAvailabilityViewSchema
}).strict().readonly()

export const projectCoordinatorAvailableWorkerAgentSchema = z.object({
  displayName: displayNameSchema,
  availability: workerAvailabilityProjectionSchema
}).strict().readonly()

/** Cloud-global online Worker directory grouped by User; selection remains exact Agent. */
export const projectCoordinatorAvailableWorkerGroupSchema = z.object({
  userId: userIdSchema,
  displayName: displayNameSchema,
  agents: z.array(projectCoordinatorAvailableWorkerAgentSchema).max(64)
}).strict().superRefine((group, context) => {
  const agentIds = group.agents.map(({ availability }) => availability.agentId)
  if (new Set(agentIds).size !== agentIds.length) {
    context.addIssue({ code: 'custom', path: ['agents'], message: 'Available Worker Agent IDs must be unique per User.' })
  }
  group.agents.forEach((agent, index) => {
    if (agent.availability.userId === group.userId) return
    context.addIssue({
      code: 'custom',
      path: ['agents', index, 'availability', 'userId'],
      message: 'Available Worker User must match its Cloud directory group.'
    })
  })
}).readonly()

/** User is the grouping key; availability and selection remain exact Agent facts. */
export const projectCoordinatorWorkerGroupSchema = z.object({
  userId: userIdSchema,
  displayName: displayNameSchema,
  agents: z.array(projectCoordinatorWorkerAgentSchema).max(64)
}).strict().superRefine((group, context) => {
  const agentIds = group.agents.map(({ projectAvailability }) => projectAvailability.agentId)
  if (new Set(agentIds).size !== agentIds.length) {
    context.addIssue({ code: 'custom', path: ['agents'], message: 'Worker Agent IDs must be unique per User.' })
  }
  group.agents.forEach((agent, index) => {
    if (agent.projectAvailability.userId === group.userId) return
    context.addIssue({
      code: 'custom',
      path: ['agents', index, 'projectAvailability', 'userId'],
      message: 'Project availability User must match its group.'
    })
  })
}).readonly()

export const projectCoordinatorTaskViewSchema = z.object({
  task: taskSchema,
  executions: z.array(taskExecutionSchema).max(101)
}).strict().superRefine((view, context) => {
  const executionIds = view.executions.map(({ executionId }) => executionId)
  if (new Set(executionIds).size !== executionIds.length) {
    context.addIssue({ code: 'custom', path: ['executions'], message: 'Task execution IDs must be unique.' })
  }
  view.executions.forEach((execution, index) => {
    if (execution.projectId === view.task.projectId && execution.taskId === view.task.taskId) return
    context.addIssue({
      code: 'custom',
      path: ['executions', index],
      message: 'Every execution must belong to the exact Task.'
    })
  })
  if (
    view.task.currentExecutionId !== null &&
    !view.executions.some(({ executionId }) => executionId === view.task.currentExecutionId)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['executions'],
      message: 'The current execution must be present in the Task execution history.'
    })
  }
}).readonly()

export const projectCoordinatorReviewViewSchema = z.object({
  submission: taskResultSubmissionSchema,
  decision: taskReviewDecisionSchema.nullable()
}).strict().superRefine((view, context) => {
  if (!view.decision) return
  if (
    view.decision.projectId !== view.submission.projectId ||
    view.decision.taskId !== view.submission.taskId ||
    view.decision.executionId !== view.submission.executionId ||
    view.decision.resultSubmissionId !== view.submission.resultSubmissionId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['decision'],
      message: 'Review decision must reference the exact immutable result submission.'
    })
  }
}).readonly()

export const projectCoordinatorProvisioningViewSchema = z.object({
  intent: projectContentProvisioningIntentSchema.nullable(),
  attestation: projectContentProvisioningAttestationSchema.nullable(),
  binding: projectContentSpaceBindingSchema.nullable(),
  memberships: z.array(projectMembershipSchema).max(1_000),
  providerPrincipalFacts: z.array(providerDirectoryPrincipalFactSchema).max(1_000),
  contentReadiness: z.array(projectContentReadinessSchema).max(1_000),
  providerMembershipObservations: z.array(projectProviderMembershipObservationSchema).max(10_000),
  externalOperationJournal: z.array(externalOperationRecoveryJournalEntrySchema).max(10_000),
  recoveryActions: z.array(visibleRecoveryActionSchema).max(1_000)
}).strict().readonly()

export const projectCoordinatorProjectSchema = z.object({
  project: projectSchema,
  coordinatorTransferFeedback: projectCoordinatorTransferFeedbackSchema.nullable().default(null),
  plan: projectCoordinatorPlanViewSchema.nullable(),
  workerGroups: z.array(projectCoordinatorWorkerGroupSchema).max(1_000),
  tasks: z.array(projectCoordinatorTaskViewSchema).max(10_000),
  reviews: z.array(projectCoordinatorReviewViewSchema).max(10_000),
  pendingHumanNeeded: z.array(humanNeededSchema).max(10_000),
  records: z.array(projectRecordSchema).max(10_000),
  finalSummary: projectFinalSummarySchema.nullable(),
  provisioning: projectCoordinatorProvisioningViewSchema
}).strict().superRefine((view, context) => {
  const projectId = view.project.projectId
  if (view.coordinatorTransferFeedback && (
    view.coordinatorTransferFeedback.projectId !== projectId ||
    view.coordinatorTransferFeedback.coordinatorAgentId !== view.project.coordinatorAgentId ||
    view.coordinatorTransferFeedback.coordinatorAuthorityEpoch !==
      view.project.coordinatorAuthorityEpoch ||
    view.coordinatorTransferFeedback.projectRevision > view.project.revision
  )) {
    context.addIssue({
      code: 'custom',
      path: ['coordinatorTransferFeedback'],
      message: 'Coordinator transfer feedback must match the current Project authority.'
    })
  }
  if (view.plan && view.plan.plan.projectId !== projectId) {
    context.addIssue({ code: 'custom', path: ['plan'], message: 'Plan must belong to this Project.' })
  }
  const userIds = view.workerGroups.map(({ userId }) => userId)
  if (new Set(userIds).size !== userIds.length) {
    context.addIssue({ code: 'custom', path: ['workerGroups'], message: 'Worker groups must be unique by User.' })
  }
  const agentIds = view.workerGroups.flatMap((group) =>
    group.agents.map(({ projectAvailability }) => projectAvailability.agentId)
  )
  if (new Set(agentIds).size !== agentIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['workerGroups'],
      message: 'Each Agent must occur in exactly one User group.'
    })
  }
  const candidateIds = new Set(agentIds)
  view.plan?.assignments.forEach((assignment, index) => {
    if (assignment.selectedAgentId === null || candidateIds.has(assignment.selectedAgentId)) return
    context.addIssue({
      code: 'custom',
      path: ['plan', 'assignments', index, 'selectedAgentId'],
      message: 'A selected Worker must reference an exact Agent in the User-grouped candidate projection.'
    })
  })
  view.workerGroups.forEach((group, index) => {
    if (group.agents.every(({ projectAvailability }) => (
      projectAvailability.projectId === projectId
    ))) return
    context.addIssue({
      code: 'custom',
      path: ['workerGroups', index],
      message: 'Every Worker project availability view must belong to this Project.'
    })
  })
  view.tasks.forEach((task, index) => {
    if (task.task.projectId === projectId) return
    context.addIssue({ code: 'custom', path: ['tasks', index], message: 'Task must belong to this Project.' })
  })
  view.reviews.forEach((review, index) => {
    if (review.submission.projectId === projectId) return
    context.addIssue({ code: 'custom', path: ['reviews', index], message: 'Review must belong to this Project.' })
  })
  view.pendingHumanNeeded.forEach((request, index) => {
    if (request.projectId === projectId && request.targetUserId === view.project.ownerUserId) return
    context.addIssue({
      code: 'custom',
      path: ['pendingHumanNeeded', index],
      message: 'Pending HumanNeeded must belong to this Project Owner.'
    })
  })
  view.records.forEach((record, index) => {
    if (record.projectId === projectId) return
    context.addIssue({
      code: 'custom',
      path: ['records', index],
      message: 'Project Record must belong to this Project.'
    })
  })
  if (view.finalSummary && view.finalSummary.projectId !== projectId) {
    context.addIssue({
      code: 'custom',
      path: ['finalSummary'],
      message: 'Final summary must belong to this Project.'
    })
  }
  const {
    intent,
    attestation,
    binding,
    memberships,
    contentReadiness,
    providerMembershipObservations,
    externalOperationJournal,
    recoveryActions
  } = view.provisioning
  if (intent && intent.projectId !== projectId) {
    context.addIssue({ code: 'custom', path: ['provisioning', 'intent'], message: 'Intent must belong to this Project.' })
  }
  if (binding && binding.projectId !== projectId) {
    context.addIssue({ code: 'custom', path: ['provisioning', 'binding'], message: 'Binding must belong to this Project.' })
  }
  if (attestation && attestation.projectId !== projectId) {
    context.addIssue({
      code: 'custom',
      path: ['provisioning', 'attestation'],
      message: 'Attestation must belong to this Project.'
    })
  }
  if (
    attestation && intent &&
    attestation.provisioningIntentId !== intent.provisioningIntentId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['provisioning', 'attestation', 'provisioningIntentId'],
      message: 'Attestation must bind the exact visible provisioning intent.'
    })
  }
  memberships.forEach((membership, index) => {
    if (membership.projectId === projectId) return
    context.addIssue({
      code: 'custom',
      path: ['provisioning', 'memberships', index],
      message: 'Every Project Membership must belong to this Project.'
    })
  })
  contentReadiness.forEach((readiness, index) => {
    if (readiness.projectId === projectId) return
    context.addIssue({
      code: 'custom',
      path: ['provisioning', 'contentReadiness', index],
      message: 'Every Content Readiness fact must belong to this Project.'
    })
  })
  providerMembershipObservations.forEach((observation, index) => {
    if (observation.projectId === projectId) return
    context.addIssue({
      code: 'custom',
      path: ['provisioning', 'providerMembershipObservations', index],
      message: 'Every Provider observation must belong to this Project.'
    })
  })
  externalOperationJournal.forEach((journal, index) => {
    if (journal.projectId === projectId) return
    context.addIssue({
      code: 'custom',
      path: ['provisioning', 'externalOperationJournal', index],
      message: 'Every external operation journal entry must belong to this Project.'
    })
  })
  recoveryActions.forEach((action, index) => {
    if (action.projectId === projectId) return
    context.addIssue({
      code: 'custom',
      path: ['provisioning', 'recoveryActions', index],
      message: 'Recovery action must belong to this Project.'
    })
  })
}).readonly()

export const projectCoordinatorWorkspaceReadInputSchema = z.object({
  projectId: projectIdSchema.optional()
}).strict().readonly()

export const projectCoordinatorActivationSchema = z.object({
  projectId: projectIdSchema.optional()
}).strict().readonly()

export const projectCoordinatorWorkspaceSchema = z.object({
  connection: projectCoordinatorConnectionSchema,
  observedAt: timestampSchema,
  focusedProjectId: projectIdSchema.optional(),
  availableWorkerGroups: z.array(projectCoordinatorAvailableWorkerGroupSchema).max(1_000),
  projects: z.array(projectCoordinatorProjectSchema).max(1_000)
}).strict().superRefine((workspace, context) => {
  if (workspace.connection.state !== 'ready' && workspace.projects.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['projects'],
      message: 'Unavailable coordination state cannot claim Project data.'
    })
  }
  if (workspace.connection.state !== 'ready' && workspace.availableWorkerGroups.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['availableWorkerGroups'],
      message: 'Unavailable coordination state cannot claim Cloud Worker directory data.'
    })
  }
  if (workspace.connection.state !== 'ready' && workspace.focusedProjectId) {
    context.addIssue({
      code: 'custom',
      path: ['focusedProjectId'],
      message: 'Unavailable coordination state cannot focus a Project.'
    })
  }
  if (
    workspace.focusedProjectId &&
    !workspace.projects.some(({ project }) => project.projectId === workspace.focusedProjectId)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['focusedProjectId'],
      message: 'The focused Project must be present in this workspace projection.'
    })
  }
  const projectIds = workspace.projects.map(({ project }) => project.projectId)
  if (new Set(projectIds).size !== projectIds.length) {
    context.addIssue({ code: 'custom', path: ['projects'], message: 'Project IDs must be unique.' })
  }
  const workerUserIds = workspace.availableWorkerGroups.map(({ userId }) => userId)
  if (new Set(workerUserIds).size !== workerUserIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['availableWorkerGroups'],
      message: 'Available Worker groups must be unique by User.'
    })
  }
  const workerAgentIds = workspace.availableWorkerGroups.flatMap(({ agents }) => (
    agents.map(({ availability }) => availability.agentId)
  ))
  if (new Set(workerAgentIds).size !== workerAgentIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['availableWorkerGroups'],
      message: 'Each available Agent must occur in exactly one User group.'
    })
  }
}).readonly()

export const projectCoordinatorPlanSubmitResultSchema = z.object({
  plan: projectPlanSchema,
  workspace: projectCoordinatorWorkspaceSchema
}).strict().superRefine((result, context) => {
  if (result.plan.state !== 'awaiting_confirmation') {
    context.addIssue({ code: 'custom', path: ['plan', 'state'], message: 'A submitted Plan awaits Owner confirmation.' })
  }
  if (result.workspace.focusedProjectId !== result.plan.projectId) {
    context.addIssue({ code: 'custom', path: ['workspace'], message: 'Plan submit must retain exact Project focus.' })
  }
}).readonly()

export const projectCoordinatorProjectCreateResultSchema = z.object({
  createdProjectId: projectIdSchema,
  workspace: projectCoordinatorWorkspaceSchema
}).strict().superRefine((result, context) => {
  if (result.workspace.focusedProjectId !== result.createdProjectId) {
    context.addIssue({
      code: 'custom',
      path: ['workspace', 'focusedProjectId'],
      message: 'Project creation must focus the exact new Project.'
    })
  }
}).readonly()

export type ProjectCoordinatorConnection = z.infer<typeof projectCoordinatorConnectionSchema>
export type ProjectCoordinatorProject = z.infer<typeof projectCoordinatorProjectSchema>
export type ProjectCoordinatorWorkspace = z.infer<typeof projectCoordinatorWorkspaceSchema>
export type ProjectCoordinatorWorkspaceReadInput = z.infer<
  typeof projectCoordinatorWorkspaceReadInputSchema
>
export type ProjectCoordinatorProjectCreateInput = z.infer<
  typeof projectCoordinatorProjectCreateInputSchema
>
export type ProjectCoordinatorProjectCreateResult = z.infer<
  typeof projectCoordinatorProjectCreateResultSchema
>
export type ProjectCoordinatorArtifactReviewPrepareInput = z.infer<
  typeof projectCoordinatorArtifactReviewPrepareInputSchema
>
export type ProjectCoordinatorArtifactReviewPrepared = z.infer<
  typeof projectCoordinatorArtifactReviewPreparedSchema
>
export type ProjectCoordinatorPlanDraft = z.infer<typeof projectCoordinatorPlanDraftSchema>
export type ProjectCoordinatorPlanAssignment = z.infer<
  typeof projectCoordinatorPlanAssignmentSchema
>
export type ProjectCoordinatorPlanDraftGenerateInput = z.infer<
  typeof projectCoordinatorPlanDraftGenerateInputSchema
>
export type ProjectCoordinatorPlanDraftGenerateFailureReason = z.infer<
  typeof projectCoordinatorPlanDraftGenerateFailureReasonSchema
>
export type ProjectCoordinatorPlanDraftGenerateResult = z.infer<
  typeof projectCoordinatorPlanDraftGenerateResultSchema
>
export type ProjectCoordinatorPlanDraftReadInput = z.infer<
  typeof projectCoordinatorPlanDraftReadInputSchema
>
export type ProjectCoordinatorPlanDraftEditInput = z.infer<
  typeof projectCoordinatorPlanDraftEditInputSchema
>
export type ProjectCoordinatorPlanDraftSubmitInput = z.infer<
  typeof projectCoordinatorPlanDraftSubmitInputSchema
>
export type ProjectCoordinatorPlanSubmitResult = z.infer<
  typeof projectCoordinatorPlanSubmitResultSchema
>
export type ProjectCoordinatorPlanConfirmActivateInput = z.infer<
  typeof projectCoordinatorPlanConfirmActivateInputSchema
>
export type ProjectCoordinatorProvisioningPlanInput = z.infer<
  typeof projectCoordinatorProvisioningPlanInputSchema
>
export type ProjectCoordinatorProvisioningPlan = z.infer<
  typeof projectCoordinatorProvisioningPlanSchema
>
export type ProjectCoordinatorProvisioningApplyInput = z.infer<
  typeof projectCoordinatorProvisioningApplyInputSchema
>
export type ProjectCoordinatorContentRecoveryObserveLinkInput = z.infer<
  typeof projectCoordinatorContentRecoveryObserveLinkInputSchema
>
export type ProjectCoordinatorContentRecoveryAbandonInput = z.infer<
  typeof projectCoordinatorContentRecoveryAbandonInputSchema
>
export type ProjectCoordinatorContentRecoveryRetrySuccessorInput = z.infer<
  typeof projectCoordinatorContentRecoveryRetrySuccessorInputSchema
>
export type ProjectCoordinatorMembershipAddInput = z.infer<
  typeof projectCoordinatorMembershipAddInputSchema
>
export type ProjectCoordinatorMembershipRemoveInput = z.infer<
  typeof projectCoordinatorMembershipRemoveInputSchema
>
export type ProjectCoordinatorHumanNeededCreateInput = z.infer<
  typeof projectCoordinatorHumanNeededCreateInputSchema
>
export type ProjectCoordinatorHumanAnswerInput = z.infer<
  typeof projectCoordinatorHumanAnswerInputSchema
>
export type ProjectCoordinatorTransferInput = z.infer<
  typeof projectCoordinatorTransferInputSchema
>
export type ProjectCoordinatorTransferFeedback = z.infer<
  typeof projectCoordinatorTransferFeedbackSchema
>
export type ProjectCoordinatorResultReviewInput = z.infer<
  typeof projectCoordinatorResultReviewInputSchema
>
export type ProjectCoordinatorCompleteInput = z.infer<
  typeof projectCoordinatorCompleteInputSchema
>
export type ProjectCoordinatorActivation = z.infer<typeof projectCoordinatorActivationSchema>
