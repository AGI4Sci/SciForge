import { z } from 'zod'
import { collaborationObjectLocatorSchema } from './task-object-io.js'

import {
  dashboardCommentDraftSchema,
  exactContractReferenceHistorySchema,
  notificationProjectionSchema,
  publicProgressUpdateSchema
} from './authority.js'
import {
  agentIdSchema,
  collaborationEventIdSchema,
  deviceIdSchema,
  displayNameSchema,
  executionIdSchema,
  humanAnswerIdSchema,
  humanRequestIdSchema,
  idempotencyKeySchema,
  nonEmptyTextSchema,
  projectCreateIntentIdSchema,
  projectIdSchema,
  projectMembershipIdSchema,
  projectPlanIdSchema,
  projectRecordIdSchema,
  projectResultIdSchema,
  protocolEnvelopeShape,
  protocolVersionSchema,
  requestIdSchema,
  revisionSchema,
  safeCodeSchema,
  sha256Schema,
  taskAuthorityIdSchema,
  taskIdSchema,
  taskOfferIdSchema,
  timestampSchema,
  userIdSchema
} from './core.js'
import {
  agentConnectionStatusSchema,
  agentLifecycleStatusSchema,
  projectBudgetSchema,
  projectStatusSchema
} from './entities.js'
import { deviceStatusSchema } from './identity.js'
import {
  externalOperationRecoveryJournalEntrySchema,
  projectContentProvisioningAttestationSchema,
  projectContentProvisioningIntentSchema,
  projectContentReadinessSchema,
  projectContentSpaceBindingSchema,
  projectProviderMembershipObservationSchema,
  providerDirectoryPrincipalFactSchema,
  visibleRecoveryActionSchema
} from './project-content.js'
import {
  projectCoordinationReadQuerySchema,
  projectListQuerySchema
} from './project-coordination-read.js'
import {
  projectMembershipSchema,
  runtimeReadinessSchema,
  taskAuthorityReasonSchema,
  taskAuthoritySchema
} from './project-coordination.js'
import {
  projectRequirementsDocumentIdSchema,
  projectRequirementsDocumentSchema,
  requirementsAcceptanceCriteriaSchema,
  requirementsWorkModulesSchema
} from './project-requirements.js'
import {
  projectCompletionApprovalSchema,
  projectCompletionHumanActionFactDigest,
  projectFinalSummaryHistorySchema,
  projectPlanCompletionTargetSchema,
  projectPlanHistorySchema,
  projectPlanStateSchema,
  projectRequirementsCompletionTargetSchema,
  taskResultSubmissionSchema,
  taskReviewDecisionSchema
} from './project-review.js'
import { taskContractRevisionHistorySchema } from './scientific-collaboration.js'
import {
  taskExecutionHistorySchema,
  taskExecutionSchema,
  taskExecutionStateSchema,
  taskOfferSchema
} from './task-execution.js'
import {
  taskFileIntentSchema
} from './task-object-io.js'

const writeCommandShape = {
  ...protocolEnvelopeShape,
  idempotencyKey: idempotencyKeySchema
} as const

/**
 * The sole Project creation transaction. It creates only the authenticated
 * Agent Owner's draft Project and Owner Membership. Membership invitations
 * use explicit commands after projectId exists.
 */
export const projectCreateCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.create'),
  createIntentId: projectCreateIntentIdSchema,
  displayName: displayNameSchema,
  goal: nonEmptyTextSchema,
  budget: projectBudgetSchema
}).strict()
export type ProjectCreateCommand = z.infer<typeof projectCreateCommandSchema>

export const workerAvailabilityPublishCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('worker.availability.publish'),
  agentId: agentIdSchema,
  expectedAgentRevision: revisionSchema,
  connectionStatus: z.enum(['online', 'offline']),
  lastHeartbeatAt: timestampSchema.nullable(),
  runtimeReadiness: runtimeReadinessSchema,
  runtimeCapabilityTags: z.array(safeCodeSchema).max(256),
  acceptsNewOffers: z.boolean(),
  activeTaskCount: z.number().int().min(0).max(10_000),
  observedAt: timestampSchema
}).strict()

export const workerAvailabilityListQuerySchema = z.object({
  ...protocolEnvelopeShape,
  type: z.literal('worker.availability.list'),
  projectId: projectIdSchema.optional(),
  afterAgentId: agentIdSchema.optional(),
  limit: z.number().int().min(1).max(500)
}).strict()

export const projectMembershipAddCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.membership.add'),
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  userId: userIdSchema
}).strict()

/** The invited OIDC User accepts membership after requirements confirmation. */
export const projectMembershipAcceptCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.membership.accept'),
  projectId: projectIdSchema,
  projectMembershipId: projectMembershipIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedMembershipRevision: revisionSchema
}).strict()

/** Safety revocation is immediate; no public command can claim Provider removal succeeded. */
export const projectMembershipRemoveCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.membership.remove'),
  projectId: projectIdSchema,
  projectMembershipId: projectMembershipIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedMembershipRevision: revisionSchema
}).strict()

export const projectMembershipListQuerySchema = z.object({
  ...protocolEnvelopeShape,
  type: z.literal('project.membership.list'),
  projectId: projectIdSchema,
  includeRemoved: z.boolean(),
  limit: z.number().int().min(1).max(1_000)
}).strict()

export const projectTaskAuthorityListQuerySchema = z.object({
  ...protocolEnvelopeShape,
  type: z.literal('project.task_authority.list'),
  projectId: projectIdSchema,
  userId: userIdSchema.optional()
}).strict()

const offerCommandShape = {
  ...writeCommandShape,
  taskOfferId: taskOfferIdSchema,
  taskId: taskIdSchema,
  expectedTaskRevision: revisionSchema,
  expectedOfferRevision: revisionSchema,
  /** Optional stale-contract guard for clients that have the displayed version. */
  expectedContractRevision: revisionSchema.optional(),
  expectedContractDigest: sha256Schema.optional()
} as const

/** The one canonical initial Task creation + Worker User broadcast transaction. */
const taskOfferCreateEnvelopeShape = {
  ...writeCommandShape,
  type: z.literal('task.offer.create' as const),
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  expectedExecutionAuthorityEpoch: revisionSchema,
  offerExpiresAt: timestampSchema
}

export const taskOfferCreateCommandSchema = z.object({
  ...taskOfferCreateEnvelopeShape,
  requirementsDocumentId: projectRequirementsDocumentIdSchema,
  requirementsDocumentRevision: revisionSchema,
  requirementsContentDigest: sha256Schema,
  planItemId: z.string().regex(/^item_[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])$/u),
  workerUserId: userIdSchema
}).strict()
export type TaskOfferCreateCommand = z.infer<typeof taskOfferCreateCommandSchema>

export const taskOfferAcceptCommandSchema = z.object({
  ...offerCommandShape,
  type: z.literal('task.offer.accept'),
  /** Agent selected by the authenticated Worker User for this execution. */
  agentId: agentIdSchema.optional(),
  /** Optional explicit Device selection; Cloud verifies it belongs to the Agent/User. */
  deviceId: deviceIdSchema.optional(),
  /** The local human interaction that produced this acceptance. */
  interaction: z.enum(['explicit_click', 'explicit_keyboard_action']).optional()
}).strict()

export const taskOfferRejectCommandSchema = z.object({
  ...offerCommandShape,
  type: z.literal('task.offer.reject')
}).strict()
export type TaskOfferRejectCommand = z.infer<typeof taskOfferRejectCommandSchema>

export const taskOfferWithdrawCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.offer.withdraw'),
  taskOfferId: taskOfferIdSchema,
  taskId: taskIdSchema,
  expectedTaskRevision: revisionSchema,
  expectedOfferRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  reason: z.string().trim().min(1).max(500)
}).strict()

/** Extend the acceptance window of the current unclaimed Task offer. */
export const taskOfferExtendCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.offer.extend'),
  taskOfferId: taskOfferIdSchema,
  taskId: taskIdSchema,
  expectedTaskRevision: revisionSchema,
  expectedOfferRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  offerExpiresAt: timestampSchema
}).strict()
export type TaskOfferExtendCommand = z.infer<typeof taskOfferExtendCommandSchema>

export const taskOfferReassignCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.offer.reassign'),
  taskId: taskIdSchema,
  previousTaskOfferId: taskOfferIdSchema,
  expectedPreviousOfferRevision: revisionSchema,
  expectedProjectRevision: revisionSchema,
  expectedTaskRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  expectedExecutionAuthorityEpoch: revisionSchema,
  workerUserId: userIdSchema,
  offerExpiresAt: timestampSchema,
  nextFileIntent: taskFileIntentSchema.nullable()
}).strict()
export type TaskOfferReassignCommand = z.infer<typeof taskOfferReassignCommandSchema>

export const taskExecutionStartCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.execution.start'),
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  expectedTaskRevision: revisionSchema,
  expectedExecutionRevision: revisionSchema,
  startedAt: timestampSchema
}).strict()

export const taskExecutionFailCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.execution.fail'),
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  expectedTaskRevision: revisionSchema,
  expectedExecutionRevision: revisionSchema,
  safeFailureCode: safeCodeSchema,
  safeMessage: z.string().trim().min(1).max(500),
  failedAt: timestampSchema
}).strict()

export const taskExecutionPreflightGetQuerySchema = z.object({
  ...protocolEnvelopeShape,
  type: z.literal('task.execution.preflight.get'),
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  expectedTaskRevision: revisionSchema,
  expectedExecutionRevision: revisionSchema
}).strict()

export const projectFinalSummarySubmitCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.final_summary.submit'),
  ownerApproval: projectCompletionApprovalSchema,
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  expectedExecutionAuthorityEpoch: revisionSchema,
  projectPlanId: projectPlanIdSchema.optional(),
  confirmedPlanRevision: revisionSchema.optional(),
  projectResultIds: z.array(projectResultIdSchema).max(10_000).optional(),
  baselineKind: z.literal('requirements').optional(),
  requirementsDocumentId: z.string().regex(/^rqd_[A-Za-z0-9]{20,}$/u).optional(),
  confirmedRequirementsRevision: revisionSchema.optional(),
  adoptedTaskIds: z.array(taskIdSchema).max(10_000).optional(),
  summary: nonEmptyTextSchema
}).strict().superRefine((command, context) => {
  const requirementFields = [command.requirementsDocumentId, command.confirmedRequirementsRevision, command.adoptedTaskIds]
  const planFields = [command.projectPlanId, command.confirmedPlanRevision, command.projectResultIds]
  if (command.baselineKind === 'requirements' && planFields.some((value) => value !== undefined)) {
    context.addIssue({ code: 'custom', path: [], message: 'Requirements completion cannot carry Plan or Project Result fields.' })
    return
  }
  if (command.baselineKind !== 'requirements' && requirementFields.some((value) => value !== undefined)) {
    context.addIssue({ code: 'custom', path: [], message: 'Plan completion cannot carry requirements baseline fields.' })
    return
  }
  const target = command.baselineKind === 'requirements'
    ? projectRequirementsCompletionTargetSchema.safeParse({
        baselineKind: command.baselineKind, projectId: command.projectId,
        expectedProjectRevision: command.expectedProjectRevision,
        expectedCoordinatorAuthorityEpoch: command.expectedCoordinatorAuthorityEpoch,
        expectedExecutionAuthorityEpoch: command.expectedExecutionAuthorityEpoch,
        requirementsDocumentId: command.requirementsDocumentId,
        confirmedRequirementsRevision: command.confirmedRequirementsRevision,
        adoptedTaskIds: command.adoptedTaskIds, summary: command.summary
      })
    : projectPlanCompletionTargetSchema.safeParse({
        projectId: command.projectId, expectedProjectRevision: command.expectedProjectRevision,
        expectedCoordinatorAuthorityEpoch: command.expectedCoordinatorAuthorityEpoch,
        expectedExecutionAuthorityEpoch: command.expectedExecutionAuthorityEpoch,
        projectPlanId: command.projectPlanId, confirmedPlanRevision: command.confirmedPlanRevision,
        projectResultIds: command.projectResultIds, summary: command.summary
      })
  if (!target.success) {
    context.addIssue({ code: 'custom', path: [], message: 'Project completion target must be one exact Plan or requirements baseline.' })
    return
  }
  const { ownerApproval } = command
  const parsedApproval = projectCompletionApprovalSchema.safeParse(ownerApproval)
  if (!parsedApproval.success) return
  const { deviceSignature, ...action } = parsedApproval.data
  try {
    const expectedFactRevision = 'requirementsDocumentId' in target.data
      ? target.data.confirmedRequirementsRevision
      : target.data.confirmedPlanRevision
    if (deviceSignature.factRevision !== expectedFactRevision ||
      deviceSignature.canonicalPayloadDigest !== projectCompletionHumanActionFactDigest(target.data, action)) {
      context.addIssue({ code: 'custom', path: ['ownerApproval'], message: 'Owner approval must bind the exact Project completion snapshot.' })
    }
  } catch {
    context.addIssue({ code: 'custom', path: ['ownerApproval'], message: 'Owner approval must bind the exact Project completion snapshot.' })
  }
})
export type ProjectFinalSummarySubmitCommand = z.infer<
  typeof projectFinalSummarySubmitCommandSchema
>

export const projectDecisionSubmitCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.decision.submit'),
  projectId: projectIdSchema,
  humanRequestId: humanRequestIdSchema,
  humanAnswerId: humanAnswerIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  expectedHumanRequestRevision: revisionSchema,
  expectedHumanAnswerRevision: revisionSchema,
  decision: nonEmptyTextSchema
}).strict()

/** Public comments are Cloud activity facts; mentions only address visible Project Users. */
export const projectActivityCommentCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.activity.comment'),
  projectId: dashboardCommentDraftSchema.shape.projectId,
  taskId: dashboardCommentDraftSchema.shape.taskId,
  text: dashboardCommentDraftSchema.shape.text,
  mentionedUserIds: dashboardCommentDraftSchema.shape.mentionedUserIds,
  visibility: z.literal('project_public')
}).strict()

/** Agent progress is accepted only as a typed, bounded public projection. */
export const taskProgressPublishCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.progress.publish'),
  publicProgressUpdateId: publicProgressUpdateSchema.shape.publicProgressUpdateId,
  projectId: publicProgressUpdateSchema.shape.projectId,
  taskId: publicProgressUpdateSchema.shape.taskId,
  contract: exactContractReferenceHistorySchema,
  executionId: publicProgressUpdateSchema.shape.executionId,
  sessionBindingId: publicProgressUpdateSchema.shape.sessionBindingId,
  actorAgentId: publicProgressUpdateSchema.shape.actorAgentId,
  actorAgentProfileId: publicProgressUpdateSchema.shape.actorAgentProfileId,
  actorProfileRevision: publicProgressUpdateSchema.shape.actorProfileRevision,
  visibility: z.literal('project_public'),
  stage: publicProgressUpdateSchema.shape.stage,
  summary: publicProgressUpdateSchema.shape.summary,
  blocker: publicProgressUpdateSchema.shape.blocker,
  nextAction: publicProgressUpdateSchema.shape.nextAction,
  referencedObjectIds: publicProgressUpdateSchema.shape.referencedObjectIds,
  sourceEventId: publicProgressUpdateSchema.shape.sourceEventId
}).strict()

export const notificationMarkReadCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('notification.mark_read'),
  notificationId: notificationProjectionSchema.shape.notificationId,
  expectedRevision: notificationProjectionSchema.shape.revision
}).strict()

/** The Owner saves any of the four requirements parts (design §9.22.1). */
export const projectRequirementsDraftSaveCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.requirements.draft.save'),
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  /** 0 creates the Project's first draft. */
  expectedRequirementsRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  /** A draft saves any subset of the four parts; omitted parts keep their stored value. */
  goalsDeliverables: z.string().trim().max(16_000).optional(),
  inputsBoundaries: z.string().trim().max(16_000).optional(),
  inputReferences: z.array(collaborationObjectLocatorSchema).max(100).optional(),
  workModules: requirementsWorkModulesSchema.optional(),
  acceptanceCriteria: requirementsAcceptanceCriteriaSchema.optional()
}).strict()

/** The current Coordinator Agent completes 工作模块/验收标准 only. */
export const projectRequirementsCompletionSaveCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.requirements.completion.save'),
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  expectedRequirementsRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  workModules: requirementsWorkModulesSchema,
  acceptanceCriteria: requirementsAcceptanceCriteriaSchema
}).strict()

/** The Owner confirms one exact requirements version by digest. */
export const projectRequirementsConfirmCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.requirements.confirm'),
  projectId: projectIdSchema,
  requirementsDocumentId: projectRequirementsDocumentSchema.shape.requirementsDocumentId,
  expectedProjectRevision: revisionSchema,
  expectedRequirementsRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  contentDigest: sha256Schema
}).strict()

export const cloudStateCommandSchemas = [
  projectListQuerySchema,
  projectCoordinationReadQuerySchema,
  projectCreateCommandSchema,
  workerAvailabilityPublishCommandSchema,
  workerAvailabilityListQuerySchema,
  projectMembershipAddCommandSchema,
  projectMembershipAcceptCommandSchema,
  projectMembershipRemoveCommandSchema,
  projectMembershipListQuerySchema,
  projectTaskAuthorityListQuerySchema,
  taskOfferCreateCommandSchema,
  taskOfferAcceptCommandSchema,
  taskOfferRejectCommandSchema,
  taskOfferWithdrawCommandSchema,
  taskOfferExtendCommandSchema,
  taskOfferReassignCommandSchema,
  taskExecutionStartCommandSchema,
  taskExecutionFailCommandSchema,
  taskExecutionPreflightGetQuerySchema,
  projectDecisionSubmitCommandSchema,
  projectFinalSummarySubmitCommandSchema,
  projectActivityCommentCommandSchema,
  taskProgressPublishCommandSchema,
  notificationMarkReadCommandSchema,
  projectRequirementsDraftSaveCommandSchema,
  projectRequirementsCompletionSaveCommandSchema,
  projectRequirementsConfirmCommandSchema
] as const

export const cloudStateCommandSchema = z.discriminatedUnion('type', cloudStateCommandSchemas)

export type CloudStateCommand = z.infer<typeof cloudStateCommandSchema>

export const taskExecutionPreflightReasonSchema = z.enum([
  'project_not_active',
  'membership_not_active',
  'user_authority_not_eligible',
  'device_inactive',
  'agent_inactive',
  'execution_not_current',
  'execution_fenced',
  'task_revision_mismatch',
  'execution_revision_mismatch',
  'content_identity_missing',
  'content_not_ready',
  'content_binding_not_active'
])

export const taskExecutionPreflightDeviceFactSchema = z.object({
  deviceId: deviceIdSchema,
  userId: userIdSchema,
  revision: revisionSchema,
  status: deviceStatusSchema
}).strict()

export const taskExecutionPreflightAgentFactSchema = z.object({
  agentId: agentIdSchema,
  ownerUserId: userIdSchema,
  deviceId: deviceIdSchema,
  revision: revisionSchema,
  lifecycleStatus: agentLifecycleStatusSchema,
  connectionStatus: agentConnectionStatusSchema
}).strict()

export const taskExecutionPreflightSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('task_execution_preflight'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  currentExecutionId: executionIdSchema.nullable(),
  taskKind: z.enum(['text', 'file']),
  projectStatus: projectStatusSchema,
  projectRevision: revisionSchema,
  projectExecutionAuthorityEpoch: revisionSchema,
  requestedTaskRevision: revisionSchema,
  currentTaskRevision: revisionSchema,
  requestedExecutionRevision: revisionSchema,
  membership: projectMembershipSchema,
  taskAuthorities: z.array(taskAuthoritySchema).min(1).max(2),
  device: taskExecutionPreflightDeviceFactSchema,
  agent: taskExecutionPreflightAgentFactSchema,
  execution: taskExecutionSchema,
  decision: z.object({
    outcome: z.enum(['allowed', 'denied']),
    reasons: z.array(taskExecutionPreflightReasonSchema).max(16)
  }).strict(),
  evaluatedAt: timestampSchema
}).strict().superRefine((preflight, context) => {
  if ((preflight.decision.outcome === 'allowed') !== (preflight.decision.reasons.length === 0)) {
    context.addIssue({
      code: 'custom',
      path: ['decision', 'reasons'],
      message: 'Allowed preflight has no denial reasons; denied preflight requires at least one.'
    })
  }
  if (
    preflight.execution.projectId !== preflight.projectId ||
    preflight.execution.taskId !== preflight.taskId ||
    preflight.execution.executionId !== preflight.executionId
  ) {
    context.addIssue({ code: 'custom', path: ['execution'], message: 'Preflight execution identity must match the query.' })
  }
  if (preflight.membership.projectId !== preflight.projectId ||
      preflight.membership.userId !== preflight.execution.assigneeUserId) {
    context.addIssue({ code: 'custom', path: ['membership'], message: 'Preflight membership must belong to the assignee User.' })
  }
  if (preflight.taskAuthorities.some((authority) => (
    authority.projectId !== preflight.projectId ||
    authority.userId !== preflight.execution.assigneeUserId
  ))) {
    context.addIssue({
      code: 'custom',
      path: ['taskAuthorities'],
      message: 'Preflight authority rows must belong to the exact Project and assignee User.'
    })
  }
  if (
    preflight.device.deviceId !== preflight.execution.assigneeDeviceId ||
    preflight.device.userId !== preflight.execution.assigneeUserId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['device'],
      message: 'Preflight Device fact must belong to the immutable assignee User and Device.'
    })
  }
  if (
    preflight.agent.agentId !== preflight.execution.assigneeAgentId ||
    preflight.agent.ownerUserId !== preflight.execution.assigneeUserId ||
    preflight.agent.deviceId !== preflight.execution.assigneeDeviceId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['agent'],
      message: 'Preflight Agent fact must belong to the immutable assignee User and Device.'
    })
  }
  const scopes = preflight.taskAuthorities.map(({ scope }) => scope)
  if (new Set(scopes).size !== scopes.length) {
    context.addIssue({
      code: 'custom',
      path: ['taskAuthorities'],
      message: 'Preflight cannot contain conflicting authority rows for one scope.'
    })
  }
  const requiredScope = preflight.taskKind === 'file' ? 'file_tasks' : 'text_tasks'
  const relevantAuthority = preflight.taskAuthorities.find(({ scope }) => scope === requiredScope)
  if (relevantAuthority === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['taskAuthorities'],
      message: 'Preflight must include the authority row for the exact Task kind.'
    })
  }
  if (preflight.decision.outcome === 'allowed' && relevantAuthority?.state !== 'eligible') {
    context.addIssue({
      code: 'custom',
      path: ['decision'],
      message: 'Allowed preflight requires eligible authority for the exact Task kind.'
    })
  }
  if ((preflight.taskKind === 'file') !== (preflight.execution.fileIntent !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['taskKind'],
      message: 'Task kind must agree with the immutable execution file intent.'
    })
  }
  if (preflight.decision.outcome === 'allowed') {
    if (
      preflight.projectStatus !== 'active' ||
      preflight.projectExecutionAuthorityEpoch !== preflight.execution.fence.projectExecutionAuthorityEpoch ||
      preflight.currentExecutionId !== preflight.executionId ||
      preflight.requestedTaskRevision !== preflight.currentTaskRevision ||
      preflight.requestedExecutionRevision !== preflight.execution.revision ||
      preflight.membership.state !== 'active' ||
      relevantAuthority?.state !== 'eligible' ||
      relevantAuthority.authorityEpoch !== preflight.execution.fence.userTaskAuthorityEpoch ||
      preflight.device.status !== 'active' ||
      preflight.agent.lifecycleStatus !== 'active' ||
      preflight.execution.fence.status !== 'open'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['decision'],
        message: 'Allowed preflight requires every current Project, User, Device, Agent, execution and content authority fact.'
      })
    }
  }
  if (preflight.currentTaskRevision < preflight.execution.fence.assignmentTaskRevision) {
    context.addIssue({
      code: 'custom',
      path: ['currentTaskRevision'],
      message: 'Current Task revision cannot precede the immutable assignment revision.'
    })
  }
})
export type TaskExecutionPreflight = z.infer<typeof taskExecutionPreflightSchema>

const collaborationEventEnvelopeShape = {
  protocolVersion: protocolVersionSchema,
  eventId: collaborationEventIdSchema,
  causedByRequestId: requestIdSchema,
  occurredAt: timestampSchema
} as const

export const cloudStateEventSchemas = [
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('project.created'),
    projectId: projectIdSchema,
    ownerUserId: userIdSchema,
    coordinatorAgentId: agentIdSchema,
    coordinatorAuthorityEpoch: revisionSchema,
    executionAuthorityEpoch: revisionSchema,
    status: z.literal('draft'),
    revision: revisionSchema
  }).strict(),
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('project.execution_authority.changed'),
    projectId: projectIdSchema,
    status: projectStatusSchema,
    executionAuthorityEpoch: revisionSchema,
    revision: revisionSchema
  }).strict(),
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('project.coordinator.changed'),
    projectId: projectIdSchema,
    previousCoordinatorAgentId: agentIdSchema,
    coordinatorAgentId: agentIdSchema,
    coordinatorAuthorityEpoch: revisionSchema,
    revision: revisionSchema
  }).strict(),
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('worker.availability.changed'),
    userId: userIdSchema,
    agentId: agentIdSchema,
    revision: revisionSchema
  }).strict(),
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('project.membership.changed'),
    projectId: projectIdSchema,
    projectMembershipId: projectMembershipIdSchema,
    userId: userIdSchema,
    state: projectMembershipSchema.shape.state,
    revision: revisionSchema,
    authorityEpoch: revisionSchema
  }).strict(),
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('project.task_authority.changed'),
    taskAuthorityId: taskAuthorityIdSchema,
    projectId: projectIdSchema,
    userId: userIdSchema,
    scope: taskAuthoritySchema.shape.scope,
    state: taskAuthoritySchema.shape.state,
    reason: taskAuthorityReasonSchema.nullable(),
    revision: revisionSchema,
    authorityEpoch: revisionSchema
  }).strict(),
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('project.plan.changed'),
    projectId: projectIdSchema,
    projectPlanId: projectPlanIdSchema,
    state: projectPlanStateSchema,
    revision: revisionSchema
  }).strict(),
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('task.execution.changed'),
    projectId: projectIdSchema,
    taskId: taskIdSchema,
    executionId: executionIdSchema,
    state: taskExecutionStateSchema,
    revision: revisionSchema
  }).strict(),
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('project.final_summary.created'),
    projectId: projectIdSchema,
    projectRecordId: projectRecordIdSchema,
    revision: revisionSchema
  }).strict()
] as const

export const cloudStateEventSchema = z.discriminatedUnion('type', cloudStateEventSchemas)
export type CloudStateEvent = z.infer<typeof cloudStateEventSchema>

export const cloudStateEntitySchema = z.union([
  providerDirectoryPrincipalFactSchema,
  projectMembershipSchema,
  taskAuthoritySchema,
  projectContentReadinessSchema,
  projectProviderMembershipObservationSchema,
  projectContentProvisioningIntentSchema,
  projectContentProvisioningAttestationSchema,
  projectContentSpaceBindingSchema,
  externalOperationRecoveryJournalEntrySchema,
  visibleRecoveryActionSchema,
  projectPlanHistorySchema,
  projectRequirementsDocumentSchema,
  taskExecutionHistorySchema,
  taskOfferSchema,
  taskContractRevisionHistorySchema,
  taskResultSubmissionSchema,
  taskReviewDecisionSchema,
  projectFinalSummaryHistorySchema
])
export type CloudStateEntity = z.infer<typeof cloudStateEntitySchema>
