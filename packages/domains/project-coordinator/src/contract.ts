import { z } from 'zod'
import {
  DOMAIN_MAIN_FINITE_CAPABILITY_BATCH_CONFIRMED_PLAN_DIGEST_FIELD,
  domainMainFiniteCapabilityBatchPlanDigestSchema
} from '@sciforge/domain-sdk/host'
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
  projectDeleteCommandSchema,
  projectFinalSummarySchema,
  projectFinalSummarySubmitCommandSchema,
  projectIdSchema,
  projectMembershipAddCommandSchema,
  projectMembershipAcceptCommandSchema,
  projectMembershipRemoveCommandSchema,
  projectMembershipSchema,
  projectProviderMembershipObservationSchema,
  projectPlanConfirmCommandSchema,
  projectPlanSchema,
  projectPlanRuntimeProvenanceSchema,
  projectPlanTaskDeclarationSchema,
  projectPlanTaskDeclarationsSchema,
  projectRecordSchema,
  projectSchema,
  projectUserLabelFactSchema,
  projectWorkerAvailabilityViewSchema,
  workerAvailabilityProjectionSchema,
  taskExecutionSchema,
  taskIdSchema,
  taskOfferSchema,
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
  projectDelete: 'project-coordinator.project.delete',
  projectActivationAcknowledge: 'project-coordinator.project-activation.acknowledge',
  sessionProjectionRead: 'project-coordinator.session-projection.read',
  planDraftRead: 'project-coordinator.plan-draft.read',
  planDraftGenerate: 'project-coordinator.plan-draft.generate',
  planDraftEdit: 'project-coordinator.plan-draft.edit',
  planSubmit: 'project-coordinator.plan.submit',
  planConfirm: 'project-coordinator.plan.confirm',
  workflowPrepare: 'project-coordinator.workflow.prepare',
  workflowContinue: 'project-coordinator.workflow.continue',
  taskOfferReassign: 'project-coordinator.task-offer.reassign',
  contentRecoveryObserveLink: 'project-coordinator.content-recovery.observe-link',
  contentRecoveryAbandon: 'project-coordinator.content-recovery.abandon',
  membershipAdd: 'project-coordinator.membership.add',
  membershipAccept: 'project-coordinator.membership.accept',
  membershipRemove: 'project-coordinator.membership.remove',
  humanNeededCreate: 'project-coordinator.human-needed.create',
  humanAnswer: 'project-coordinator.human-needed.answer',
  coordinatorTransfer: 'project-coordinator.coordinator.transfer',
  artifactReviewPrepare: 'project-coordinator.artifact-review.prepare',
  resultReview: 'project-coordinator.result.review',
  projectComplete: 'project-coordinator.project.complete'
} as const)

export const projectCoordinatorSessionAccessSchema = z.enum([
  'coordinator',
  'worker',
  'read_only'
])

export const projectCoordinatorSessionFenceReasonSchema = z.enum([
  'authority_changed',
  'execution_fenced',
  'execution_not_current',
  'membership_inactive',
  'principal_changed',
  'project_terminal',
  'project_unavailable'
])

const projectCoordinatorCoordinatorSessionBindingRecordObjectSchema = z.object({
  schemaVersion: z.literal(1),
  role: z.literal('coordinator'),
  projectId: projectIdSchema,
  principalUserId: userIdSchema,
  coordinatorAgentId: agentIdSchema,
  coordinatorAuthorityEpoch: projectSchema.shape.coordinatorAuthorityEpoch,
  runtimeId: z.string().trim().min(1).max(256),
  threadId: z.string().trim().min(1).max(512),
  boundAt: timestampSchema
}).strict()

export const projectCoordinatorCoordinatorSessionBindingRecordSchema =
  projectCoordinatorCoordinatorSessionBindingRecordObjectSchema.readonly()

export const projectCoordinatorCoordinatorSessionBindingSchema =
  projectCoordinatorCoordinatorSessionBindingRecordObjectSchema.extend({
    access: z.enum(['coordinator', 'read_only']),
    fenceReason: projectCoordinatorSessionFenceReasonSchema.nullable()
  }).strict().superRefine((binding, context) => {
    if ((binding.access === 'read_only') !== (binding.fenceReason !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['fenceReason'],
        message: 'A read-only Coordinator Session requires its exact fence reason.'
      })
    }
  }).readonly()

export const projectCoordinatorWorkerSessionBindingSchema = z.object({
  schemaVersion: z.literal(1),
  role: z.literal('worker'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: taskExecutionSchema.shape.executionId,
  principalUserId: userIdSchema,
  assigneeAgentId: agentIdSchema,
  assigneeDeviceId: deviceIdSchema,
  runtimeId: z.string().trim().min(1).max(256),
  threadId: z.string().trim().min(1).max(512),
  taskRevision: taskSchema.shape.revision,
  executionRevision: taskExecutionSchema.shape.revision,
  projectExecutionAuthorityEpoch:
    taskExecutionSchema.shape.fence.shape.projectExecutionAuthorityEpoch,
  userTaskAuthorityEpoch:
    taskExecutionSchema.shape.fence.shape.userTaskAuthorityEpoch,
  access: z.enum(['worker', 'read_only']),
  fenceReason: projectCoordinatorSessionFenceReasonSchema.nullable(),
  updatedAt: timestampSchema
}).strict().superRefine((binding, context) => {
  if ((binding.access === 'read_only') !== (binding.fenceReason !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['fenceReason'],
      message: 'A read-only Worker Session requires its exact fence reason.'
    })
  }
}).readonly()

export const projectCoordinatorSessionBindingSchema = z.discriminatedUnion('role', [
  projectCoordinatorCoordinatorSessionBindingSchema,
  projectCoordinatorWorkerSessionBindingSchema
])

export const projectCoordinatorOrdinarySessionSchema = z.object({
  runtimeId: z.string().trim().min(1).max(256),
  threadId: z.string().trim().min(1).max(512)
}).strict().readonly()

export const projectCoordinatorActivationRequestIdSchema = z.string()
  .regex(/^pca_[A-Za-z0-9]{12,64}$/u)

export const projectCoordinatorPendingActivationSchema = z.object({
  activationRequestId: projectCoordinatorActivationRequestIdSchema,
  projectId: projectIdSchema,
  coordinatorSession: projectCoordinatorOrdinarySessionSchema,
  requestedAt: timestampSchema
}).strict().readonly()

export const projectCoordinatorSessionProjectionSchema = z.object({
  schemaVersion: z.literal(2),
  observedAt: timestampSchema,
  bindings: z.array(projectCoordinatorSessionBindingSchema).max(100_000),
  suppressedSessions: z.array(projectCoordinatorOrdinarySessionSchema).max(100_000),
  pendingActivations: z.array(projectCoordinatorPendingActivationSchema).max(10_000).default([])
}).strict().superRefine((projection, context) => {
  const identities = projection.bindings.map(({ runtimeId, threadId }) => (
    `${runtimeId}\u0000${threadId}`
  ))
  const identitySet = new Set(identities)
  if (identitySet.size !== identities.length) {
    context.addIssue({
      code: 'custom',
      path: ['bindings'],
      message: 'Each ordinary Session has at most one Project binding.'
    })
  }
  const suppressedIdentities = projection.suppressedSessions.map((session) => (
    `${session.runtimeId}\u0000${session.threadId}`
  ))
  const suppressedIdentitySet = new Set(suppressedIdentities)
  if (suppressedIdentitySet.size !== suppressedIdentities.length) {
    context.addIssue({
      code: 'custom',
      path: ['suppressedSessions'],
      message: 'Each suppressed ordinary Session identity appears at most once.'
    })
  }
  if (suppressedIdentities.some((identity) => identitySet.has(identity))) {
    context.addIssue({
      code: 'custom',
      path: ['suppressedSessions'],
      message: 'A Session cannot be both visible and suppressed.'
    })
  }
}).readonly()

export const projectCoordinatorSessionProjectionReadInputSchema = z.object({})
  .strict()
  .readonly()

export const projectCoordinatorProjectCreateInputSchema = projectCreateCommandSchema.omit({
  protocolVersion: true,
  requestId: true,
  type: true,
  idempotencyKey: true
}).readonly()

export const projectCoordinatorProjectDeleteInputSchema = projectDeleteCommandSchema.pick({
  projectId: true
}).readonly()

export const projectCoordinatorProjectDeleteResultSchema = z.object({
  projectId: projectIdSchema,
  deleted: z.literal(true)
}).strict().readonly()

export const projectCoordinatorActivationAcknowledgeInputSchema = z.object({
  activationRequestId: projectCoordinatorActivationRequestIdSchema
}).strict().readonly()

export const projectCoordinatorActivationAcknowledgeResultSchema = z.object({
  acknowledged: z.literal(true)
}).strict().readonly()

export const projectCoordinatorConnectionSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ready'),
    userId: userIdSchema,
    deviceId: deviceIdSchema,
    /** Exact active Agent owned by this local Collaboration runtime. */
    localAgentId: agentIdSchema.optional()
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
  planItemId: projectPlanTaskDeclarationSchema.shape.planItemId,
  workerUserId: userIdSchema.nullable(),
  recommendationReason: safeReasonSchema.nullable()
}).strict().superRefine((assignment, context) => {
  if ((assignment.workerUserId === null) !== (assignment.recommendationReason === null)) {
    context.addIssue({
      code: 'custom',
      path: ['recommendationReason'],
      message: 'A selected Worker User and its recommendation reason must be projected together.'
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
  tasks: projectPlanTaskDeclarationsSchema,
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
  'planning_candidates_unavailable',
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
  // These fields are part of the read projection and are commonly echoed by
  // agents when issuing a CAS edit. Accept them as optional request guards so
  // an otherwise valid edit is not rejected merely because the projection was
  // round-tripped. The handler still verifies them against current state.
  expectedProjectRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  expectedCoordinatorAuthorityEpoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  tasks: projectPlanTaskDeclarationsSchema,
  rationale: safeReasonSchema,
  assignments: z.array(projectCoordinatorPlanAssignmentSchema).min(1).max(1_000)
}).strict().readonly()

export const projectCoordinatorPlanDraftSubmitInputSchema = z.object({
  projectId: projectIdSchema,
  draftId: projectCoordinatorDraftIdSchema,
  expectedDraftRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
}).strict().readonly()

export const projectCoordinatorPlanConfirmInputSchema = projectPlanConfirmCommandSchema.omit({
  protocolVersion: true,
  requestId: true,
  type: true,
  idempotencyKey: true
}).readonly()

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

export const projectCoordinatorWorkflowPlanSchema = z.object({
  projectId: projectIdSchema,
  projectPlanId: projectPlanSchema.shape.projectPlanId,
  expectedProjectRevision: projectSchema.shape.revision,
  expectedCoordinatorAuthorityEpoch: projectSchema.shape.coordinatorAuthorityEpoch,
  expectedExecutionAuthorityEpoch: projectSchema.shape.executionAuthorityEpoch,
  expectedPlanRevision: projectPlanSchema.shape.revision,
  planDigest: projectPlanSchema.shape.planDigest,
  purpose: z.enum(['launch', 'team_reconcile']),
  provisioning: projectCoordinatorProvisioningPlanSchema.nullable(),
  [DOMAIN_MAIN_FINITE_CAPABILITY_BATCH_CONFIRMED_PLAN_DIGEST_FIELD]:
    domainMainFiniteCapabilityBatchPlanDigestSchema.optional(),
  workflowDigest: domainMainFiniteCapabilityBatchPlanDigestSchema
}).strict().superRefine((plan, context) => {
  if (plan.purpose === 'team_reconcile' && plan.provisioning === null) {
    context.addIssue({
      code: 'custom',
      path: ['provisioning'],
      message: 'A Team reconcile workflow requires one exact finite provisioning plan.'
    })
  }
  if (plan.provisioning !== null && (
    plan.provisioning.projectId !== plan.projectId ||
    plan.provisioning.expectedProjectRevision !== plan.expectedProjectRevision
  )) {
    context.addIssue({
      code: 'custom',
      path: ['provisioning'],
      message: 'The finite provisioning plan must target the exact workflow Project revision.'
    })
  }
  if (
    plan.provisioning === null
      ? plan.confirmedPlanDigest !== undefined
      : plan.confirmedPlanDigest !== plan.provisioning.confirmedPlanDigest
  ) {
    context.addIssue({
      code: 'custom',
      path: ['confirmedPlanDigest'],
      message: 'The workflow confirmation digest must identify its exact finite provisioning plan.'
    })
  }
}).readonly()

export const projectCoordinatorWorkflowPrepareInputSchema = z.object({
  projectId: projectIdSchema
}).strict().readonly()

export const projectCoordinatorWorkflowContinueInputSchema = projectCoordinatorWorkflowPlanSchema

/**
 * The caller selects only the current Task/offer, successor User, expiry, and
 * optional output filename. Main derives every Cloud CAS and file-intent fact
 * from a fresh workspace read.
 */
export const projectCoordinatorTaskOfferReassignInputSchema = z.object({
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  previousTaskOfferId: taskOfferSchema.shape.taskOfferId,
  workerUserId: userIdSchema,
  offerExpiresAt: timestampSchema,
  nextOutputFileName: taskFileDestinationNameSchema.nullable().optional()
}).strict().readonly()

export const projectCoordinatorMembershipAcceptInputSchema = projectMembershipAcceptCommandSchema.omit({
  protocolVersion: true,
  requestId: true,
  type: true,
  idempotencyKey: true
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
  targetUserId: humanNeededCreateCommandSchema.shape.targetUserId,
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
  plan: projectPlanSchema
}).strict().readonly()

export const projectCoordinatorWorkerAgentSchema = z.object({
  displayName: displayNameSchema,
  projectAvailability: projectWorkerAvailabilityViewSchema
}).strict().readonly()

/** Cloud-global online Worker directory; UI selection is only a User identity. */
export const projectCoordinatorAvailableWorkerUserSchema = z.object({
  userId: userIdSchema,
  displayName: displayNameSchema
}).strict().readonly()

/** User is the selection key; nested Agent facts are internal dispatch-readiness evidence. */
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
  memberUsers: z.array(projectUserLabelFactSchema).max(1_000),
  workerGroups: z.array(projectCoordinatorWorkerGroupSchema).max(1_000),
  tasks: z.array(projectCoordinatorTaskViewSchema).max(10_000),
  offers: z.array(taskOfferSchema).max(10_000),
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
  const memberUserIds = view.memberUsers.map(({ userId }) => userId)
  if (new Set(memberUserIds).size !== memberUserIds.length || view.memberUsers.some((member) => (
    member.projectId !== projectId
  ))) {
    context.addIssue({
      code: 'custom',
      path: ['memberUsers'],
      message: 'Project member User labels must be unique and belong to this Project.'
    })
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
  view.offers.forEach((offer, index) => {
    if (offer.projectId === projectId && view.tasks.some(({ task }) => task.taskId === offer.taskId)) return
    context.addIssue({
      code: 'custom',
      path: ['offers', index],
      message: 'Every Task offer must belong to a visible Task in this Project.'
    })
  })
  view.reviews.forEach((review, index) => {
    if (review.submission.projectId === projectId) return
    context.addIssue({ code: 'custom', path: ['reviews', index], message: 'Review must belong to this Project.' })
  })
  view.pendingHumanNeeded.forEach((request, index) => {
    if (request.projectId === projectId && memberUserIds.includes(request.targetUserId)) return
    context.addIssue({
      code: 'custom',
      path: ['pendingHumanNeeded', index],
      message: 'Pending HumanNeeded must target one visible Project member User.'
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

export const projectCoordinatorActivationViewSchema = z.enum([
  'overview',
  'tasks',
  'files',
  'decisions',
  'recovery',
  'create'
])

export const projectCoordinatorActivationSchema = z.object({
  projectId: projectIdSchema.optional(),
  view: projectCoordinatorActivationViewSchema.optional()
}).strict().readonly()

export const projectCoordinatorWorkspaceSchema = z.object({
  connection: projectCoordinatorConnectionSchema,
  observedAt: timestampSchema,
  focusedProjectId: projectIdSchema.optional(),
  availableWorkerUsers: z.array(projectCoordinatorAvailableWorkerUserSchema).max(1_000),
  providerPrincipalFacts: z.array(providerDirectoryPrincipalFactSchema).max(10_000),
  projects: z.array(projectCoordinatorProjectSchema).max(1_000)
}).strict().superRefine((workspace, context) => {
  if (workspace.connection.state !== 'ready' && workspace.projects.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['projects'],
      message: 'Unavailable coordination state cannot claim Project data.'
    })
  }
  if (workspace.connection.state !== 'ready' && workspace.availableWorkerUsers.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['availableWorkerUsers'],
      message: 'Unavailable coordination state cannot claim Cloud Worker directory data.'
    })
  }
  if (workspace.connection.state !== 'ready' && workspace.providerPrincipalFacts.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['providerPrincipalFacts'],
      message: 'Unavailable coordination state cannot claim Provider directory facts.'
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
  const workerUserIds = workspace.availableWorkerUsers.map(({ userId }) => userId)
  if (new Set(workerUserIds).size !== workerUserIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['availableWorkerUsers'],
      message: 'Available Worker groups must be unique by User.'
    })
  }
  const providerFactIds = workspace.providerPrincipalFacts.map(({ providerPrincipalFactId }) => (
    providerPrincipalFactId
  ))
  if (new Set(providerFactIds).size !== providerFactIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['providerPrincipalFacts'],
      message: 'Provider directory facts must be unique by fact ID.'
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

export const projectCoordinatorProjectCreateReceiptSchema = z.object({
  createIntentId: projectCoordinatorProjectCreateInputSchema.unwrap().shape.createIntentId,
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

export const projectCoordinatorProjectCreateResultSchema =
  projectCoordinatorProjectCreateReceiptSchema.unwrap().extend({
    coordinatorSession: projectCoordinatorOrdinarySessionSchema.unwrap().extend({
      projectId: projectIdSchema
    }).strict().readonly(),
    activationRequestId: projectCoordinatorActivationRequestIdSchema
  }).strict().superRefine((result, context) => {
    if (result.workspace.focusedProjectId !== result.createdProjectId) {
      context.addIssue({
        code: 'custom',
        path: ['workspace', 'focusedProjectId'],
        message: 'Project creation must focus the exact new Project.'
      })
    }
    if (result.coordinatorSession.projectId !== result.createdProjectId) {
      context.addIssue({
        code: 'custom',
        path: ['coordinatorSession', 'projectId'],
        message: 'Project creation must bind the exact new Project.'
      })
    }
  }).readonly()

export type ProjectCoordinatorConnection = z.infer<typeof projectCoordinatorConnectionSchema>
export type ProjectCoordinatorCoordinatorSessionBindingRecord = z.infer<
  typeof projectCoordinatorCoordinatorSessionBindingRecordSchema
>
export type ProjectCoordinatorSessionBinding = z.infer<
  typeof projectCoordinatorSessionBindingSchema
>
export type ProjectCoordinatorSessionProjection = z.infer<
  typeof projectCoordinatorSessionProjectionSchema
>
export type ProjectCoordinatorPendingActivation = z.infer<
  typeof projectCoordinatorPendingActivationSchema
>
export type ProjectCoordinatorOrdinarySession = z.infer<
  typeof projectCoordinatorOrdinarySessionSchema
>
export type ProjectCoordinatorProject = z.infer<typeof projectCoordinatorProjectSchema>
export type ProjectCoordinatorWorkspace = z.infer<typeof projectCoordinatorWorkspaceSchema>
export type ProjectCoordinatorWorkspaceReadInput = z.infer<
  typeof projectCoordinatorWorkspaceReadInputSchema
>
export type ProjectCoordinatorProjectCreateInput = z.infer<
  typeof projectCoordinatorProjectCreateInputSchema
>
export type ProjectCoordinatorProjectCreateReceipt = z.infer<
  typeof projectCoordinatorProjectCreateReceiptSchema
>
export type ProjectCoordinatorProjectCreateResult = z.infer<
  typeof projectCoordinatorProjectCreateResultSchema
>
export type ProjectCoordinatorProjectDeleteInput = z.infer<
  typeof projectCoordinatorProjectDeleteInputSchema
>
export type ProjectCoordinatorProjectDeleteResult = z.infer<
  typeof projectCoordinatorProjectDeleteResultSchema
>
export type ProjectCoordinatorActivationAcknowledgeInput = z.infer<
  typeof projectCoordinatorActivationAcknowledgeInputSchema
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
export type ProjectCoordinatorPlanConfirmInput = z.infer<
  typeof projectCoordinatorPlanConfirmInputSchema
>
export type ProjectCoordinatorProvisioningPlanInput = z.infer<
  typeof projectCoordinatorProvisioningPlanInputSchema
>
export type ProjectCoordinatorProvisioningPlan = z.infer<
  typeof projectCoordinatorProvisioningPlanSchema
>
export type ProjectCoordinatorWorkflowPlan = z.infer<
  typeof projectCoordinatorWorkflowPlanSchema
>
export type ProjectCoordinatorWorkflowPrepareInput = z.infer<
  typeof projectCoordinatorWorkflowPrepareInputSchema
>
export type ProjectCoordinatorWorkflowContinueInput = z.infer<
  typeof projectCoordinatorWorkflowContinueInputSchema
>
export type ProjectCoordinatorTaskOfferReassignInput = z.infer<
  typeof projectCoordinatorTaskOfferReassignInputSchema
>
export type ProjectCoordinatorMembershipAcceptInput = z.infer<
  typeof projectCoordinatorMembershipAcceptInputSchema
>
export type ProjectCoordinatorContentRecoveryObserveLinkInput = z.infer<
  typeof projectCoordinatorContentRecoveryObserveLinkInputSchema
>
export type ProjectCoordinatorContentRecoveryAbandonInput = z.infer<
  typeof projectCoordinatorContentRecoveryAbandonInputSchema
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
export type ProjectCoordinatorActivationView = z.infer<
  typeof projectCoordinatorActivationViewSchema
>
