import { z } from 'zod'

import {
  agentIdSchema,
  collaborationEventIdSchema,
  contentRecoveryJournalEntryIdSchema,
  deviceIdSchema,
  displayNameSchema,
  executionIdSchema,
  idempotencyKeySchema,
  nonEmptyTextSchema,
  projectContentBindingIdSchema,
  projectIdSchema,
  projectMembershipIdSchema,
  projectPlanIdSchema,
  projectRecordIdSchema,
  providerPrincipalFactIdSchema,
  protocolEnvelopeShape,
  protocolVersionSchema,
  provisioningIntentIdSchema,
  recoveryActionIdSchema,
  requestIdSchema,
  resultSubmissionIdSchema,
  reviewDecisionIdSchema,
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
  portableContentSpaceLocatorSchema,
  taskFileIntentSchema
} from './content-space-task-io.js'
import {
  externalOperationKindSchema,
  externalOperationRecoveryJournalEntrySchema,
  externalOperationRecoveryScopeSchema,
  projectContentProvisioningIntentSchema,
  projectContentProvisioningAttestationSchema,
  projectContentReadinessSchema,
  projectContentSpaceBindingSchema,
  projectProviderMembershipObservationSchema,
  providerDirectoryPrincipalFactReadinessReasonSchema,
  providerDirectoryPrincipalFactReadinessSchema,
  providerDirectoryPrincipalFactSchema,
  providerDirectoryPrincipalReferenceSchema,
  providerInstanceReferenceSchema,
  provisioningIntentStateSchema,
  visibleRecoveryActionSchema
} from './project-content.js'
import {
  projectMembershipSchema,
  projectWorkerAvailabilityViewSchema,
  runtimeReadinessSchema,
  taskAuthoritySchema,
  taskAuthorityReasonSchema,
  workerAvailabilityProjectionSchema
} from './project-coordination.js'
import {
  projectFinalSummarySchema,
  projectPlanRuntimeProvenanceSchema,
  projectPlanSchema,
  projectPlanTaskSchema,
  projectPlanStateSchema,
  taskResultOutputSchema,
  taskResultRuntimeProvenanceSchema,
  taskResultSubmissionSchema,
  taskReviewDecisionKindSchema,
  taskReviewDecisionSchema
} from './project-review.js'
import {
  taskExecutionSchema,
  taskExecutionStateSchema,
  taskOfferRejectionReasonSchema,
  taskOfferSchema
} from './task-execution.js'
import {
  projectCoordinationReadQuerySchema,
  projectListQuerySchema
} from './project-coordination-read.js'
import {
  agentConnectionStatusSchema,
  agentLifecycleStatusSchema,
  projectBudgetSchema,
  projectContentModeSchema,
  projectStatusSchema
} from './entities.js'
import { deviceStatusSchema } from './identity.js'

const writeCommandShape = {
  ...protocolEnvelopeShape,
  idempotencyKey: idempotencyKeySchema
} as const

export const providerDirectoryPrincipalFactPublishCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('provider_directory_principal.publish'),
  providerPrincipalFactId: providerPrincipalFactIdSchema.nullable(),
  expectedFactRevision: revisionSchema.nullable(),
  deviceId: deviceIdSchema,
  expectedDeviceRevision: revisionSchema,
  providerPrincipal: providerDirectoryPrincipalReferenceSchema,
  principalIdentityRevision: revisionSchema,
  providerBindingAttestationDigest: sha256Schema,
  readiness: providerDirectoryPrincipalFactReadinessSchema,
  readinessReason: providerDirectoryPrincipalFactReadinessReasonSchema.nullable(),
  observedAt: timestampSchema
}).strict().superRefine((command, context) => {
  if ((command.providerPrincipalFactId === null) !== (command.expectedFactRevision === null)) {
    context.addIssue({
      code: 'custom',
      path: ['expectedFactRevision'],
      message: 'Creating a Provider principal fact omits both ID and expected revision; replacing it requires both.'
    })
  }
  if ((command.readiness === 'ready') !== (command.readinessReason === null)) {
    context.addIssue({
      code: 'custom',
      path: ['readinessReason'],
      message: 'A ready Provider principal fact has no degradation reason; a degraded fact requires one.'
    })
  }
})

export const providerDirectoryPrincipalFactListQuerySchema = z.object({
  ...protocolEnvelopeShape,
  type: z.literal('provider_directory_principal.list'),
  userIds: z.array(userIdSchema).min(1).max(1_000)
    .refine((values) => new Set(values).size === values.length, 'Provider principal fact User filters must be unique.'),
  providerInstance: providerInstanceReferenceSchema.optional(),
  includeDegraded: z.boolean(),
  afterFactId: providerPrincipalFactIdSchema.optional(),
  limit: z.number().int().min(1).max(1_000)
}).strict()

export const projectCreateMemberSchema = z.object({
  userId: userIdSchema
}).strict()

export const projectCreateContentMemberSchema = z.object({
  userId: userIdSchema,
  providerPrincipalFactId: providerPrincipalFactIdSchema,
  expectedFactRevision: revisionSchema
}).strict()

const uniqueProjectCreateUsers = (
  members: readonly Readonly<{ userId: string }>[],
  context: z.RefinementCtx
): void => {
  if (new Set(members.map(({ userId }) => userId)).size !== members.length) {
    context.addIssue({ code: 'custom', path: ['members'], message: 'Project members must be unique by User.' })
  }
}

export const projectCreateContentSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('none'),
    members: z.array(projectCreateMemberSchema).min(1).max(1_000)
  }).strict().superRefine(({ members }, context) => uniqueProjectCreateUsers(members, context)),
  z.object({
    mode: z.literal('required'),
    contentOwnerUserId: userIdSchema,
    providerInstance: providerInstanceReferenceSchema,
    containerDisplayName: displayNameSchema,
    members: z.array(projectCreateContentMemberSchema).min(1).max(1_000)
  }).strict().superRefine((content, context) => {
    uniqueProjectCreateUsers(content.members, context)
    if (!content.members.some(({ userId }) => userId === content.contentOwnerUserId)) {
      context.addIssue({
        code: 'custom',
        path: ['contentOwnerUserId'],
        message: 'The Project content owner must be one of the exact Project members.'
      })
    }
    const factIds = content.members.map(({ providerPrincipalFactId }) => providerPrincipalFactId)
    if (new Set(factIds).size !== factIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['members'],
        message: 'Every Project member requires a distinct ready Provider principal fact.'
      })
    }
  })
])

/**
 * The sole Project creation transaction. The authenticated OIDC actor is the
 * Owner; callers cannot nominate another Owner. Required content facts are
 * validated and snapshotted with Memberships and the provisioning intent.
 */
export const projectCreateCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.create'),
  displayName: displayNameSchema,
  goal: nonEmptyTextSchema,
  coordinatorAgentId: agentIdSchema,
  expectedCoordinatorAgentRevision: revisionSchema,
  budget: projectBudgetSchema,
  content: projectCreateContentSchema
}).strict()
export type ProjectCreateCommand = z.infer<typeof projectCreateCommandSchema>

/** Service precondition because the authenticated OIDC Owner is intentionally not caller input. */
export function projectCreateIncludesAuthenticatedOwner(
  command: ProjectCreateCommand,
  authenticatedOwnerUserId: string
): boolean {
  const ownerUserId = userIdSchema.parse(authenticatedOwnerUserId)
  return command.content.members.some(({ userId }) => userId === ownerUserId)
}

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
  userId: userIdSchema,
  providerPrincipalFactId: providerPrincipalFactIdSchema.nullable(),
  expectedProviderPrincipalFactRevision: revisionSchema.nullable()
}).strict().superRefine((command, context) => {
  if ((command.providerPrincipalFactId === null) !== (command.expectedProviderPrincipalFactRevision === null)) {
    context.addIssue({
      code: 'custom',
      path: ['expectedProviderPrincipalFactRevision'],
      message: 'A content-required dynamic member add supplies both exact Provider principal fact ID and revision.'
    })
  }
})

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

export const projectContentProvisioningIntentGetQuerySchema = z.object({
  ...protocolEnvelopeShape,
  type: z.literal('project.content.provisioning_intent.get'),
  projectId: projectIdSchema,
  provisioningIntentId: provisioningIntentIdSchema.optional()
}).strict()

export const projectContentAttestCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.content.attest'),
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedProvisioningRevision: revisionSchema,
  attestation: projectContentProvisioningAttestationSchema
}).strict()

export const projectContentObservationSubmitCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.content.observation.submit'),
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  observation: projectProviderMembershipObservationSchema
}).strict()

export const projectContentBindingGetQuerySchema = z.object({
  ...protocolEnvelopeShape,
  type: z.literal('project.content.binding.get'),
  projectId: projectIdSchema
}).strict()

export const projectContentBindingCloseCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.content.binding.close'),
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedBindingRevision: revisionSchema,
  reason: z.enum(['project_archived', 'project_deleted', 'owner_requested'])
}).strict()

export const externalOperationPrepareCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('external_operation.prepare'),
  scope: externalOperationRecoveryScopeSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema.nullable(),
  executionId: executionIdSchema.nullable(),
  preparedTaskRevision: revisionSchema.nullable(),
  preparedExecutionRevision: revisionSchema.nullable(),
  provisioningIntentId: provisioningIntentIdSchema.nullable(),
  provisioningRevision: revisionSchema.nullable(),
  logicalInvocationId: z.string().trim().min(1).max(128),
  operation: externalOperationKindSchema,
  requestDigest: sha256Schema
}).strict().superRefine((command, context) => {
  const taskScoped = command.scope === 'task_content_transfer'
  if (taskScoped !== (
    command.taskId !== null &&
    command.executionId !== null &&
    command.preparedTaskRevision !== null &&
    command.preparedExecutionRevision !== null
  )) {
    context.addIssue({ code: 'custom', path: ['taskId'], message: 'Task recovery scope requires exact Task execution.' })
  }
  if (!taskScoped && (
    command.taskId !== null ||
    command.executionId !== null ||
    command.preparedTaskRevision !== null ||
    command.preparedExecutionRevision !== null
  )) {
    context.addIssue({
      code: 'custom',
      path: ['preparedTaskRevision'],
      message: 'Only Task content transfer recovery carries Task and execution revisions.'
    })
  }
  if (taskScoped && (command.provisioningIntentId !== null || command.provisioningRevision !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['provisioningIntentId'],
      message: 'Task content transfer recovery cannot claim a provisioning intent.'
    })
  }
  const provisioningScoped = !taskScoped
  if (provisioningScoped !== (
    command.provisioningIntentId !== null && command.provisioningRevision !== null
  )) {
    context.addIssue({
      code: 'custom',
      path: ['provisioningIntentId'],
      message: 'Provisioning recovery scope requires exact intent revision.'
    })
  }
})

export const externalOperationDispatchCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('external_operation.dispatch'),
  journalEntryId: contentRecoveryJournalEntryIdSchema,
  expectedJournalRevision: revisionSchema
}).strict()

export const externalOperationObserveCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('external_operation.observe'),
  journalEntryId: contentRecoveryJournalEntryIdSchema,
  expectedJournalRevision: revisionSchema,
  outcome: z.enum(['observed_success', 'observed_failure', 'outcome_unknown']),
  receiptDigest: sha256Schema.nullable(),
  observationDigest: sha256Schema.nullable(),
  safeFailureCode: safeCodeSchema.nullable()
}).strict().superRefine((command, context) => {
  const success = command.outcome === 'observed_success'
  if (success !== (command.receiptDigest !== null && command.observationDigest !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['observationDigest'],
      message: 'Observed success requires exact receipt and write-after-observation digests.'
    })
  }
  if (success === (command.safeFailureCode !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['safeFailureCode'],
      message: 'Only failure or unknown outcome requires a safe failure code.'
    })
  }
})

export const projectPlanSubmitCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.plan.submit'),
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  supersedesProjectPlanId: projectPlanIdSchema.nullable(),
  sourceInputLocators: z.array(portableContentSpaceLocatorSchema).max(100),
  tasks: z.array(projectPlanTaskSchema).min(1).max(1_000),
  rationale: nonEmptyTextSchema,
  runtimeProvenance: projectPlanRuntimeProvenanceSchema,
  planDigest: sha256Schema
}).strict()

export const projectPlanConfirmCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.plan.confirm'),
  projectId: projectIdSchema,
  projectPlanId: projectPlanIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  expectedPlanRevision: revisionSchema,
  planDigest: sha256Schema
}).strict()

const offerCommandShape = {
  ...writeCommandShape,
  taskOfferId: taskOfferIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  expectedTaskRevision: revisionSchema,
  expectedExecutionRevision: revisionSchema,
  expectedOfferRevision: revisionSchema
} as const

/** The one canonical initial Task creation + exact Agent offer transaction. */
export const taskOfferCreateCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.offer.create'),
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  expectedExecutionAuthorityEpoch: revisionSchema,
  projectPlanId: projectPlanIdSchema,
  expectedPlanRevision: revisionSchema,
  planItemId: z.string().regex(/^item_[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])$/u),
  assigneeAgentId: agentIdSchema,
  expectedAvailabilityRevision: revisionSchema,
  offerExpiresAt: timestampSchema
}).strict()

export const taskOfferAcceptCommandSchema = z.object({
  ...offerCommandShape,
  type: z.literal('task.offer.accept')
}).strict()

export const taskOfferRejectCommandSchema = z.object({
  ...offerCommandShape,
  type: z.literal('task.offer.reject'),
  reason: taskOfferRejectionReasonSchema,
  safeReasonDetail: z.string().trim().min(1).max(500).nullable()
}).strict().superRefine((command, context) => {
  if ((command.reason === 'other') !== (command.safeReasonDetail !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['safeReasonDetail'],
      message: 'Only the other rejection reason requires a bounded safe detail.'
    })
  }
})

export const taskOfferWithdrawCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.offer.withdraw'),
  taskOfferId: taskOfferIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  expectedTaskRevision: revisionSchema,
  expectedExecutionRevision: revisionSchema,
  expectedOfferRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  reason: z.string().trim().min(1).max(500)
}).strict()

export const taskOfferReassignCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.offer.reassign'),
  taskId: taskIdSchema,
  previousExecutionId: executionIdSchema,
  expectedTaskRevision: revisionSchema,
  expectedExecutionRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  assigneeAgentId: agentIdSchema,
  expectedAvailabilityRevision: revisionSchema,
  offerExpiresAt: timestampSchema
}).strict()

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

export const taskResultSubmitCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.result.submit'),
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  expectedTaskRevision: revisionSchema,
  expectedExecutionRevision: revisionSchema,
  summary: nonEmptyTextSchema,
  runtimeProvenance: taskResultRuntimeProvenanceSchema,
  outputs: z.array(taskResultOutputSchema).max(100),
  recoveryJournalEntryIds: z.array(contentRecoveryJournalEntryIdSchema).max(100),
  submissionDigest: sha256Schema
}).strict()

export const taskResultReviewCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.result.review'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  resultSubmissionId: resultSubmissionIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedTaskRevision: revisionSchema,
  expectedExecutionRevision: revisionSchema,
  expectedResultRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  decision: taskReviewDecisionKindSchema,
  instruction: nonEmptyTextSchema.nullable(),
  nextAssigneeAgentId: agentIdSchema.nullable(),
  expectedNextAssigneeAvailabilityRevision: revisionSchema.nullable(),
  nextOfferExpiresAt: timestampSchema.nullable(),
  nextFileIntent: taskFileIntentSchema.nullable()
}).strict().superRefine((command, context) => {
  if (command.decision === 'accept') {
    if (
      command.instruction !== null ||
      command.nextAssigneeAgentId !== null ||
      command.expectedNextAssigneeAvailabilityRevision !== null ||
      command.nextOfferExpiresAt !== null ||
      command.nextFileIntent !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['decision'],
        message: 'Accept cannot create or configure another execution.'
      })
    }
  } else if (
    command.instruction === null ||
    command.nextAssigneeAgentId === null ||
    command.expectedNextAssigneeAvailabilityRevision === null ||
    command.nextOfferExpiresAt === null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['nextAssigneeAgentId'],
      message: 'Request-revision requires bounded instruction, exact next Agent availability and offer expiry.'
    })
  }
})

export const taskRecoveryLinkObservedOutputCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.recovery.link_observed_output'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  recoveryActionId: recoveryActionIdSchema,
  journalEntryId: contentRecoveryJournalEntryIdSchema,
  expectedTaskRevision: revisionSchema,
  expectedExecutionRevision: revisionSchema,
  expectedRecoveryActionRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  output: taskResultOutputSchema,
  humanObservationDigest: sha256Schema
}).strict()

export const taskRecoveryAbandonCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('task.recovery.abandon'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  recoveryActionId: recoveryActionIdSchema,
  journalEntryId: contentRecoveryJournalEntryIdSchema,
  expectedTaskRevision: revisionSchema,
  expectedExecutionRevision: revisionSchema,
  expectedRecoveryActionRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  reason: z.string().trim().min(1).max(500)
}).strict()

export const projectFinalSummarySubmitCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.final_summary.submit'),
  projectId: projectIdSchema,
  expectedProjectRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  expectedExecutionAuthorityEpoch: revisionSchema,
  projectPlanId: projectPlanIdSchema,
  confirmedPlanRevision: revisionSchema,
  acceptedResultSubmissionIds: z.array(resultSubmissionIdSchema).min(1).max(10_000),
  summary: nonEmptyTextSchema
}).strict()

export const cloudStateCommandSchemas = [
  projectListQuerySchema,
  projectCoordinationReadQuerySchema,
  providerDirectoryPrincipalFactPublishCommandSchema,
  providerDirectoryPrincipalFactListQuerySchema,
  projectCreateCommandSchema,
  workerAvailabilityPublishCommandSchema,
  workerAvailabilityListQuerySchema,
  projectMembershipAddCommandSchema,
  projectMembershipRemoveCommandSchema,
  projectMembershipListQuerySchema,
  projectTaskAuthorityListQuerySchema,
  projectContentProvisioningIntentGetQuerySchema,
  projectContentAttestCommandSchema,
  projectContentObservationSubmitCommandSchema,
  projectContentBindingGetQuerySchema,
  projectContentBindingCloseCommandSchema,
  externalOperationPrepareCommandSchema,
  externalOperationDispatchCommandSchema,
  externalOperationObserveCommandSchema,
  projectPlanSubmitCommandSchema,
  projectPlanConfirmCommandSchema,
  taskOfferCreateCommandSchema,
  taskOfferAcceptCommandSchema,
  taskOfferRejectCommandSchema,
  taskOfferWithdrawCommandSchema,
  taskOfferReassignCommandSchema,
  taskExecutionStartCommandSchema,
  taskExecutionFailCommandSchema,
  taskExecutionPreflightGetQuerySchema,
  taskResultSubmitCommandSchema,
  taskResultReviewCommandSchema,
  taskRecoveryLinkObservedOutputCommandSchema,
  taskRecoveryAbandonCommandSchema,
  projectFinalSummarySubmitCommandSchema
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
  contentReadiness: projectContentReadinessSchema.nullable(),
  contentBinding: projectContentSpaceBindingSchema.nullable(),
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
  if (preflight.contentReadiness !== null && (
    preflight.contentReadiness.projectId !== preflight.projectId ||
    preflight.contentReadiness.userId !== preflight.execution.assigneeUserId
  )) {
    context.addIssue({
      code: 'custom',
      path: ['contentReadiness'],
      message: 'Preflight content readiness must belong to the exact Project and assignee User.'
    })
  }
  if (preflight.contentBinding !== null && preflight.contentBinding.projectId !== preflight.projectId) {
    context.addIssue({
      code: 'custom',
      path: ['contentBinding'],
      message: 'Preflight content binding must belong to the exact Project.'
    })
  }
  if ((preflight.taskKind === 'file') !== (preflight.execution.fileIntent !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['taskKind'],
      message: 'Task kind must agree with the immutable execution file intent.'
    })
  }
  if (preflight.taskKind === 'file' && (
    preflight.contentReadiness === null || preflight.contentBinding === null
  )) {
    context.addIssue({
      code: 'custom',
      path: ['contentReadiness'],
      message: 'File Task preflight requires exact Project content readiness and binding.'
    })
  }
  if (preflight.decision.outcome === 'allowed') {
    const fileAuthorityFactsValid = preflight.taskKind !== 'file' || (
      preflight.contentReadiness?.state === 'ready' &&
      preflight.contentBinding?.status === 'active' &&
      preflight.contentReadiness.bindingRevision === preflight.contentBinding.revision &&
      preflight.execution.fence.bindingRevision === preflight.contentBinding.revision
    )
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
      preflight.execution.fence.status !== 'open' ||
      !fileAuthorityFactsValid
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
    type: z.literal('provider_directory_principal.changed'),
    providerPrincipalFactId: providerPrincipalFactIdSchema,
    userId: userIdSchema,
    providerInstance: providerInstanceReferenceSchema,
    readiness: providerDirectoryPrincipalFactReadinessSchema,
    revision: revisionSchema
  }).strict(),
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('project.created'),
    projectId: projectIdSchema,
    ownerUserId: userIdSchema,
    coordinatorAgentId: agentIdSchema,
    coordinatorAuthorityEpoch: revisionSchema,
    executionAuthorityEpoch: revisionSchema,
    status: z.literal('paused'),
    contentMode: projectContentModeSchema,
    provisioningIntentId: provisioningIntentIdSchema.nullable(),
    revision: revisionSchema
  }).strict().superRefine((event, context) => {
    if ((event.contentMode === 'required') !== (event.provisioningIntentId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['provisioningIntentId'],
        message: 'Only a content-required Project is created with a provisioning intent.'
      })
    }
  }),
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
    type: z.literal('project.content.readiness.changed'),
    projectId: projectIdSchema,
    userId: userIdSchema,
    state: projectContentReadinessSchema.shape.state,
    revision: revisionSchema
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
    type: z.literal('project.content.provisioning_intent.changed'),
    projectId: projectIdSchema,
    provisioningIntentId: provisioningIntentIdSchema,
    provisioningRevision: revisionSchema,
    state: provisioningIntentStateSchema,
    revision: revisionSchema
  }).strict(),
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('project.content.binding.changed'),
    projectId: projectIdSchema,
    projectContentBindingId: projectContentBindingIdSchema,
    status: projectContentSpaceBindingSchema.shape.status,
    revision: revisionSchema
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
    type: z.literal('task.result.submitted'),
    projectId: projectIdSchema,
    taskId: taskIdSchema,
    executionId: executionIdSchema,
    resultSubmissionId: resultSubmissionIdSchema,
    revision: revisionSchema
  }).strict(),
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('task.review.decided'),
    projectId: projectIdSchema,
    taskId: taskIdSchema,
    executionId: executionIdSchema,
    resultSubmissionId: resultSubmissionIdSchema,
    reviewDecisionId: reviewDecisionIdSchema,
    decision: taskReviewDecisionKindSchema,
    revision: revisionSchema
  }).strict(),
  z.object({
    ...collaborationEventEnvelopeShape,
    type: z.literal('project.recovery.action.changed'),
    projectId: projectIdSchema,
    recoveryActionId: recoveryActionIdSchema,
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
  projectPlanSchema,
  taskExecutionSchema,
  taskOfferSchema,
  taskResultSubmissionSchema,
  taskReviewDecisionSchema,
  projectFinalSummarySchema
])
export type CloudStateEntity = z.infer<typeof cloudStateEntitySchema>
