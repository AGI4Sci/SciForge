import {
  agentIdSchema,
  deliveryAdoptionCommandSchema,
  deliveryDriveListQuerySchema,
  deliveryDriveViewSchema,
  deliveryManifestGetQuerySchema,
  deliveryRevisionRequestCommandSchema,
  deviceIdSchema,
  displayNameSchema,
  humanAnswerCommandSchema,
  humanNeededCreateCommandSchema,
  humanNeededSchema,
  inboxMessageIdSchema,
  projectCompletionTargetSchema,
  projectCreateCommandSchema,
  projectDeleteCommandSchema,
  projectFinalSummaryHistorySchema,
  projectIdSchema,
  projectMembershipAcceptCommandSchema,
  projectMembershipAddCommandSchema,
  projectMembershipRemoveCommandSchema,
  projectMembershipSchema,
  projectPlanHistorySchema,
  projectPlanSchema,
  projectRecordSchema,
  projectRequirementsConfirmCommandSchema,
  projectRequirementsDocumentIdSchema,
  projectRequirementsDocumentSchema,
  projectRequirementsDocumentSummarySchema,
  projectRequirementsDraftSaveCommandSchema,
  projectResultPublishCommandSchema,
  projectSchema,
  projectUserLabelFactSchema,
  projectWorkerAvailabilityViewSchema,
  taskDeliveryFactsSchema,
  taskExecutionHistorySchema,
  taskExecutionSchema,
  taskFileDestinationNameSchema,
  taskHistorySchema,
  taskIdSchema,
  taskOfferSchema,
  taskSchema,
  timestampSchema,
  sha256Schema,
  revisionSchema,
  userIdSchema
} from '@sciforge/collaboration-contracts'
import { z } from 'zod'

const safeReasonSchema = z.string().trim().min(1).max(2_000)

export const PROJECT_COORDINATOR_CAPABILITY_IDS = Object.freeze({
  workspaceRead: 'collaboration.workspace.read',
  projectCreate: 'collaboration.project.create',
  projectDelete: 'collaboration.project.delete',
  projectActivationAcknowledge: 'collaboration.project-activation.acknowledge',
  sessionOwnershipRead: 'collaboration.session-ownership.read',
  sessionProjectionRead: 'collaboration.session-projection.read',
  requirementsDraftSave: 'collaboration.requirements-draft.save',
  requirementsComplete: 'collaboration.requirements.complete',
  requirementsConfirm: 'collaboration.requirements.confirm',
  taskOfferWithdraw: 'collaboration.task-offer.withdraw',
  taskOfferExtend: 'collaboration.task-offer.extend',
  taskOfferReassign: 'collaboration.task-offer.reassign',
  membershipAdd: 'collaboration.membership.add',
  membershipAccept: 'collaboration.membership.accept',
  membershipRemove: 'collaboration.membership.remove',
  humanNeededCreate: 'collaboration.human-needed.create',
  humanAnswer: 'collaboration.human-needed.answer',
  coordinatorTransfer: 'collaboration.coordinator.transfer',
  deliveryRead: 'collaboration.delivery.read',
  driveList: 'collaboration.delivery.drive.list',
  adoptionDecide: 'collaboration.adoption.decide',
  revisionRequest: 'collaboration.delivery.revision.request',
  resultPublish: 'collaboration.project.result.publish',
  projectComplete: 'collaboration.project.complete'
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

export const projectCoordinatorSessionOwnershipSchema = z.array(projectCoordinatorOrdinarySessionSchema)
  .max(100_000).readonly()
export const projectCoordinatorSessionOwnershipReadInputSchema = z.object({}).strict().readonly()

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
    reasonCode: z.enum(['authority_unverified', 'authority_rejected']).optional(),
    reason: safeReasonSchema
  }).strict().readonly()
])

const projectCoordinatorDraftIdSchema = z.string()
  .regex(/^draft_[A-Za-z0-9](?:[A-Za-z0-9_-]{10,95}[A-Za-z0-9])$/u)

/** The Owner writes all four requirements parts; no Coordinator epoch guard (§9.22.1). */
export const projectCoordinatorRequirementsDraftSaveInputSchema =
  projectRequirementsDraftSaveCommandSchema.omit({
    protocolVersion: true,
    requestId: true,
    type: true,
    idempotencyKey: true
  }).readonly()

/**
 * One Coordinator completion request. The Coordinator derives 工作模块/验收标准
 * from the current draft in the project-bound Runtime Session and writes the
 * result back through `project.requirements.completion.save`.
 * `expectedRequirementsRevision` fences the exact draft the caller observed; a
 * newer draft fails the CAS instead of being overwritten.
 */
export const projectCoordinatorRequirementsCompleteInputSchema = z.object({
  projectId: projectIdSchema,
  expectedRequirementsRevision: z.number().int().min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .optional()
}).strict().readonly()

export const projectCoordinatorRequirementsCompletionFailureReasonSchema = z.enum([
  'draft_unavailable',
  'completion_in_progress',
  'revision_conflict',
  'runtime_unavailable',
  'runtime_execution_failed',
  'invalid_structured_output',
  'placeholder_generated_content',
  'write_failed',
  'unexpected_failure'
])

export const projectCoordinatorRequirementsCompletionSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('running'),
    startedAt: timestampSchema
  }).strict().readonly(),
  z.object({
    state: z.literal('failed'),
    reason: projectCoordinatorRequirementsCompletionFailureReasonSchema,
    failedAt: timestampSchema
  }).strict().readonly(),
  z.object({
    state: z.literal('completed'),
    requirementsDocumentId: projectRequirementsDocumentIdSchema,
    sourceRevision: revisionSchema,
    sourceContentDigest: sha256Schema,
    resultRevision: revisionSchema,
    resultContentDigest: sha256Schema
  }).strict().readonly()
])

export const projectCoordinatorRequirementsCompleteResultSchema =
  z.discriminatedUnion('status', [
    z.object({
      status: z.literal('completed'),
      document: projectRequirementsDocumentSchema
    }).strict().readonly(),
    z.object({
      status: z.literal('failed'),
      reason: projectCoordinatorRequirementsCompletionFailureReasonSchema
    }).strict().readonly()
  ])

/** The Owner confirms one exact requirements version by digest (§9.22.1). */
export const projectCoordinatorRequirementsConfirmInputSchema =
  projectRequirementsConfirmCommandSchema.omit({
    protocolVersion: true,
    requestId: true,
    type: true,
    idempotencyKey: true
  }).readonly()

/**
 * The caller selects only the current Task/offer, successor User, expiry, and
 * optional output filename. Main derives every Cloud CAS and file-intent fact
 * from a fresh workspace read.
 */
export const projectCoordinatorTaskOfferReassignInputSchema = z.object({
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  previousTaskOfferId: taskOfferSchema.shape.taskOfferId.nullable(),
  workerUserId: userIdSchema,
  offerExpiresAt: timestampSchema,
  nextOutputFileName: taskFileDestinationNameSchema.nullable().optional(),
  requirementsDocumentId: projectRequirementsDocumentIdSchema.optional(),
  planItemId: projectRequirementsDocumentSchema.shape.workModules.element.shape.planItemId.optional()
}).strict().superRefine((input, context) => {
  if (input.previousTaskOfferId === null && (input.requirementsDocumentId === undefined || input.planItemId === undefined)) {
    context.addIssue({ code: 'custom', path: ['requirementsDocumentId'], message: 'A first requirements assignment must identify its confirmed document and module.' })
  }
  if (input.previousTaskOfferId !== null && (input.requirementsDocumentId !== undefined || input.planItemId !== undefined)) {
    context.addIssue({ code: 'custom', path: ['requirementsDocumentId'], message: 'A successor assignment cannot include first-promotion fields.' })
  }
}).readonly()

export const projectCoordinatorTaskOfferWithdrawInputSchema = z.object({
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  taskOfferId: taskOfferSchema.shape.taskOfferId,
  reason: z.string().trim().min(1).max(500).default('Coordinator withdrew the pending offer.')
}).strict().readonly()

export const projectCoordinatorTaskOfferExtendInputSchema = z.object({
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  taskOfferId: taskOfferSchema.shape.taskOfferId,
  offerExpiresAt: timestampSchema
}).strict().readonly()

export const projectCoordinatorMembershipAcceptInputSchema = projectMembershipAcceptCommandSchema.omit({
  protocolVersion: true,
  requestId: true,
  type: true,
  idempotencyKey: true
}).strict().readonly()

export const projectCoordinatorMembershipAddInputSchema = projectMembershipAddCommandSchema.omit({
  protocolVersion: true, requestId: true, type: true, idempotencyKey: true
}).strict().readonly()

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

export const projectCoordinatorCompleteInputSchema = z.object({
  target: projectCompletionTargetSchema
}).strict().readonly()

export const projectCoordinatorDeliveryReadInputSchema = deliveryManifestGetQuerySchema.omit({
  protocolVersion: true, requestId: true, type: true
}).strict().readonly()
export const projectCoordinatorDriveListInputSchema = deliveryDriveListQuerySchema.omit({
  protocolVersion: true, requestId: true, type: true
}).strict().readonly()
export const projectCoordinatorAdoptionInputSchema = deliveryAdoptionCommandSchema.omit({
  protocolVersion: true, requestId: true, type: true, idempotencyKey: true
}).strict().readonly()
export const projectCoordinatorRevisionRequestInputSchema = deliveryRevisionRequestCommandSchema.omit({
  protocolVersion: true, requestId: true, type: true, idempotencyKey: true
}).strict().readonly()
export const projectCoordinatorResultPublishInputSchema = projectResultPublishCommandSchema.omit({
  protocolVersion: true, requestId: true, type: true, idempotencyKey: true, now: true
}).strict().readonly()

export const projectCoordinatorPlanViewSchema = z.object({
  plan: projectPlanSchema
}).strict().readonly()

export const projectCoordinatorWorkerAgentSchema = z.object({
  displayName: displayNameSchema,
  projectAvailability: projectWorkerAvailabilityViewSchema
}).strict().readonly()

/** Cloud-global registered Worker directory; UI selection is only a User identity. */
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
  delivery: taskDeliveryFactsSchema.nullable().default(null),
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

export const projectCoordinatorProjectSchema = z.object({
  project: projectSchema,
  coordinatorTransferFeedback: projectCoordinatorTransferFeedbackSchema.nullable().default(null),
  plan: projectCoordinatorPlanViewSchema.nullable(),
  requirementsDraft: projectRequirementsDocumentSchema.nullable().default(null),
  requirementsDraftSummary: projectRequirementsDocumentSummarySchema.nullable().optional(),
  requirementsCompletion: projectCoordinatorRequirementsCompletionSchema.nullable().optional(),
  confirmedRequirements: projectRequirementsDocumentSchema.nullable().default(null),
  memberUsers: z.array(projectUserLabelFactSchema).max(1_000),
  workerGroups: z.array(projectCoordinatorWorkerGroupSchema).max(1_000),
  tasks: z.array(projectCoordinatorTaskViewSchema).max(10_000),
  offers: z.array(taskOfferSchema).max(10_000),
  deliveryDrive: deliveryDriveViewSchema.nullable(),
  pendingHumanNeeded: z.array(humanNeededSchema).max(10_000),
  records: z.array(projectRecordSchema).max(10_000),
  finalSummary: projectFinalSummaryHistorySchema.nullable(),
  memberships: z.array(projectMembershipSchema).max(1_000),
  legacyHistory: z.object({
    readOnly: z.literal(true),
    plans: z.array(projectPlanHistorySchema).max(1_000),
    tasks: z.array(taskHistorySchema).max(10_000),
    executions: z.array(taskExecutionHistorySchema).max(100_000)
  }).strict().readonly().default({ readOnly: true, plans: [], tasks: [], executions: [] })
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
  if (view.requirementsDraft && (
    view.requirementsDraft.projectId !== projectId || view.requirementsDraft.state !== 'draft'
  )) {
    context.addIssue({
      code: 'custom', path: ['requirementsDraft'],
      message: 'The requirements draft must be this Project\'s current draft.'
    })
  }
  if (view.requirementsDraftSummary && view.requirementsDraftSummary.projectId !== projectId) {
    context.addIssue({
      code: 'custom', path: ['requirementsDraftSummary'],
      message: 'The requirements draft summary must be this Project\'s current draft.'
    })
  }
  if (view.confirmedRequirements && (
    view.confirmedRequirements.projectId !== projectId ||
    view.confirmedRequirements.state !== 'confirmed'
  )) {
    context.addIssue({
      code: 'custom', path: ['confirmedRequirements'],
      message: 'The confirmed requirements must be this Project\'s current confirmed version.'
    })
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
    if (offer.projectId === projectId && (view.tasks.some(({ task }) => task.taskId === offer.taskId) || view.legacyHistory.tasks.some((task) => task.taskId === offer.taskId))) return
    context.addIssue({
      code: 'custom',
      path: ['offers', index],
      message: 'Every Task offer must belong to a visible Task in this Project.'
    })
  })
  if (view.deliveryDrive && view.deliveryDrive.projectId !== projectId) {
    context.addIssue({ code: 'custom', path: ['deliveryDrive'], message: 'Drive must belong to this Project.' })
  }
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
  for (const collection of ['plans', 'tasks', 'executions'] as const) {
    view.legacyHistory[collection].forEach((record, index) => {
      if (record.projectId !== projectId) context.addIssue({ code: 'custom',
        path: ['legacyHistory', collection, index], message: 'Historical facts must belong to this Project.' })
    })
  }
  view.memberships.forEach((membership, index) => {
    if (membership.projectId === projectId) return
    context.addIssue({ code: 'custom', path: ['memberships', index], message: 'Membership must belong to this Project.' })
  })
}).readonly()

export const projectCoordinatorWorkspaceReadInputSchema = z.object({
  projectId: projectIdSchema.optional()
}).strict().readonly()

export const projectCoordinatorWorkspaceSchema = z.object({
  connection: projectCoordinatorConnectionSchema,
  observedAt: timestampSchema,
  focusedProjectId: projectIdSchema.optional(),
  availableWorkerUsers: z.array(projectCoordinatorAvailableWorkerUserSchema).max(1_000),
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
export type ProjectCoordinatorRequirementsDraftSaveInput = z.infer<
  typeof projectCoordinatorRequirementsDraftSaveInputSchema
>
export type ProjectCoordinatorRequirementsCompleteInput = z.infer<
  typeof projectCoordinatorRequirementsCompleteInputSchema
>
export type ProjectCoordinatorRequirementsCompletionFailureReason = z.infer<
  typeof projectCoordinatorRequirementsCompletionFailureReasonSchema
>
export type ProjectCoordinatorRequirementsCompletion = z.infer<
  typeof projectCoordinatorRequirementsCompletionSchema
>
export type ProjectCoordinatorRequirementsCompleteResult = z.infer<
  typeof projectCoordinatorRequirementsCompleteResultSchema
>
export type ProjectCoordinatorRequirementsConfirmInput = z.infer<
  typeof projectCoordinatorRequirementsConfirmInputSchema
>
export type ProjectCoordinatorTaskOfferReassignInput = z.infer<
  typeof projectCoordinatorTaskOfferReassignInputSchema
>
export type ProjectCoordinatorTaskOfferWithdrawInput = z.infer<
  typeof projectCoordinatorTaskOfferWithdrawInputSchema
>
export type ProjectCoordinatorTaskOfferExtendInput = z.infer<
  typeof projectCoordinatorTaskOfferExtendInputSchema
>
export type ProjectCoordinatorMembershipAcceptInput = z.infer<
  typeof projectCoordinatorMembershipAcceptInputSchema
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
export type ProjectCoordinatorCompleteInput = z.infer<
  typeof projectCoordinatorCompleteInputSchema
>

export type ProjectCoordinatorDeliveryReadInput = z.infer<typeof projectCoordinatorDeliveryReadInputSchema>
export type ProjectCoordinatorDriveListInput = z.infer<typeof projectCoordinatorDriveListInputSchema>
export type ProjectCoordinatorAdoptionInput = z.infer<typeof projectCoordinatorAdoptionInputSchema>
export type ProjectCoordinatorRevisionRequestInput = z.infer<typeof projectCoordinatorRevisionRequestInputSchema>
export type ProjectCoordinatorResultPublishInput = z.infer<typeof projectCoordinatorResultPublishInputSchema>
