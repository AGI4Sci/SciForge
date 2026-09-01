import { z } from 'zod'
import {
  agentIdSchema,
  assuranceLevelSchema,
  challengeIdSchema,
  contentRecoveryJournalEntryIdSchema,
  deviceIdSchema,
  humanEndpointIdSchema,
  humanRequestIdSchema,
  idempotencyKeySchema,
  installationIdSchema,
  inboxMessageIdSchema,
  localItemIdSchema,
  managedContainerIdSchema,
  nonEmptyTextSchema,
  projectIdSchema,
  projectEndpointBindingIdSchema,
  projectInputIdSchema,
  projectPlanIdSchema,
  projectRecordIdSchema,
  projectionIdSchema,
  protocolEnvelopeShape,
  protocolVersionSchema,
  providerIdSchema,
  providerMessageIdSchema,
  providerOpaqueIdSchema,
  providerPrincipalFactIdSchema,
  receiptIdSchema,
  recoveryActionIdSchema,
  remoteApprovalIdSchema,
  requestIdSchema,
  resultSubmissionIdSchema,
  resourceRefIdSchema,
  revisionSchema,
  runtimeIdSchema,
  runtimeTurnIdSchema,
  sequenceSchema,
  sha256Schema,
  taskIdSchema,
  taskOfferIdSchema,
  executionIdSchema,
  threadIdSchema,
  timestampSchema,
  userIdSchema
} from './core.js'
import {
  agentNodeSchema,
  endpointChallengeSchema,
  humanAnswerSchema,
  humanEndpointBindingSchema,
  humanNeededSchema,
  confirmableHumanActionSchema,
  managedProviderContainerSchema,
  localSessionProjectionBindingSchema,
  orderedProjectionItemSchema,
  participantProfileSchema,
  projectInputSchema,
  projectEndpointBindingSchema,
  projectRecordSchema,
  projectSchema,
  remoteSessionProjectionSchema,
  taskSchema,
  taskStatusSchema,
  userPrincipalSchema
} from './entities.js'
import {
  cloudResourceRefSchema
} from './content-space-task-io.js'
import {
  cloudStateCommandSchemas,
  cloudStateEntitySchema,
  cloudStateEventSchema,
  taskExecutionPreflightSchema
} from './cloud-state-protocol.js'
import {
  projectWorkerAvailabilityViewSchema,
  projectMembershipSchema,
  workerDirectoryAgentLabelSchema,
  workerDirectoryUserLabelSchema,
  workerAvailabilityProjectionSchema
} from './project-coordination.js'
import {
  projectContentProvisioningIntentSchema,
  projectContentReadinessSchema,
  projectContentSpaceBindingSchema,
  providerDirectoryPrincipalFactSchema
} from './project-content.js'
import { taskResultOutputSchema } from './project-review.js'
import {
  restProjectCoordinationResponseSchema,
  restProjectPageResponseSchema
} from './project-coordination-read.js'
import { collaborationErrorSchema } from './errors.js'
import {
  humanEndpointProviderContractSchema,
  providerLocatorSchema,
  providerManagedContainerPolicySchema
} from './provider.js'
import {
  remoteApprovalDecisionSchema,
  remoteCapabilityApprovalSchema
} from './remote-approval.js'

export const PAIRING_BIND_CODE_VERSION = 'SF1' as const
export const pairingBindCodeSchema = z.string().regex(/^SF1\.[a-f0-9]{32}\.[A-Za-z0-9_-]{12}$/u)
export type PairingBindCode = z.infer<typeof pairingBindCodeSchema>

export function encodePairingBindCode(input: Readonly<{
  challengeId: string
  challengeCode: string
}>): PairingBindCode {
  challengeIdSchema.parse(input.challengeId)
  const match = /^chl_([a-f0-9]{32})$/u.exec(input.challengeId)
  if (!match || !/^[A-Za-z0-9_-]{12}$/u.test(input.challengeCode)) {
    throw new TypeError('Pairing material cannot be represented by the SF1 bind-code format.')
  }
  return pairingBindCodeSchema.parse(`${PAIRING_BIND_CODE_VERSION}.${match[1]}.${input.challengeCode}`)
}

export function decodePairingBindCode(code: string): Readonly<{
  challengeId: string
  challengeResponse: string
}> {
  const parsed = pairingBindCodeSchema.parse(code)
  const [, challengeHex, challengeResponse] = parsed.split('.')
  const challengeId = challengeIdSchema.parse(`chl_${challengeHex}`)
  return { challengeId, challengeResponse: challengeResponse! }
}

const canonicalBase64UrlSchema = (bytes: number) => z.string().refine((value) => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) return false
  const remainder = value.length % 4
  const finalSextet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    .indexOf(value.at(-1)!)
  if ((remainder === 2 && (finalSextet & 0x0f) !== 0) ||
      (remainder === 3 && (finalSextet & 0x03) !== 0)) return false
  return Math.floor(value.length * 3 / 4) === bytes
}, `Expected canonical base64url for exactly ${bytes} bytes`)

export const agentCredentialBootstrapPublicKeySchema = z.object({
  kty: z.literal('OKP'),
  crv: z.literal('X25519'),
  x: canonicalBase64UrlSchema(32)
}).strict()
export type AgentCredentialBootstrapPublicKey = z.infer<typeof agentCredentialBootstrapPublicKeySchema>

export const agentCredentialEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal('X25519-HKDF-SHA256+A256GCM'),
  agentId: agentIdSchema,
  deviceId: deviceIdSchema,
  credentialGeneration: z.number().int().min(1),
  issuedAt: timestampSchema,
  ephemeralPublicKey: agentCredentialBootstrapPublicKeySchema,
  salt: canonicalBase64UrlSchema(32),
  iv: canonicalBase64UrlSchema(12),
  ciphertext: z.string().min(1).max(4_096).regex(/^[A-Za-z0-9_-]+$/u),
  authenticationTag: canonicalBase64UrlSchema(16)
}).strict()
export type AgentCredentialEnvelope = z.infer<typeof agentCredentialEnvelopeSchema>

export function agentCredentialEnvelopeAad(input: Readonly<{
  agentId: string
  deviceId: string
  credentialGeneration: number
  issuedAt: string
}>): string {
  return [
    'sciforge-agent-credential-v1',
    agentIdSchema.parse(input.agentId),
    deviceIdSchema.parse(input.deviceId),
    z.number().int().min(1).parse(input.credentialGeneration).toString(),
    timestampSchema.parse(input.issuedAt)
  ].join('\n')
}

export const authenticationContextSchema = z.discriminatedUnion('actorType', [
  z.object({
    actorType: z.literal('user'),
    userId: userIdSchema,
    assurance: assuranceLevelSchema
  }).strict(),
  z.object({
    actorType: z.literal('human_endpoint'),
    userId: userIdSchema,
    humanEndpointId: humanEndpointIdSchema,
    assurance: assuranceLevelSchema
  }).strict(),
  z.object({
    actorType: z.literal('agent'),
    userId: userIdSchema,
    agentId: agentIdSchema,
    assurance: z.literal('strong')
  }).strict()
])
export type AuthenticationContext = z.infer<typeof authenticationContextSchema>

const agentInboxEnvelopeShape = {
  protocolVersion: protocolVersionSchema
} as const

export const personalMessageReceivedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('personal.message.received'),
  projectionId: projectionIdSchema,
  projectionRevision: revisionSchema,
  senderUserId: userIdSchema,
  humanEndpointId: humanEndpointIdSchema,
  providerMessageId: providerMessageIdSchema,
  text: nonEmptyTextSchema,
  occurredAt: timestampSchema
}).strict()
export type PersonalMessageReceivedPayload = z.infer<typeof personalMessageReceivedPayloadSchema>

export const taskOfferedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('task.offered'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  taskOfferId: taskOfferIdSchema,
  workerUserId: userIdSchema,
  currentTaskRevision: revisionSchema,
  offerRevision: revisionSchema
}).strict()
export type TaskOfferedPayload = z.infer<typeof taskOfferedPayloadSchema>

export const taskOfferClaimedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('task.offer.claimed'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  taskOfferId: taskOfferIdSchema,
  executionId: executionIdSchema,
  claimedByAgentId: agentIdSchema,
  offerRevision: revisionSchema
}).strict()
export type TaskOfferClaimedPayload = z.infer<typeof taskOfferClaimedPayloadSchema>

export const taskOfferClosedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('task.offer.closed'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  taskOfferId: taskOfferIdSchema,
  audience: z.enum(['worker', 'coordinator']),
  outcome: z.enum(['rejected', 'withdrawn', 'timed_out']),
  taskRevision: revisionSchema,
  offerRevision: revisionSchema
}).strict()
export type TaskOfferClosedPayload = z.infer<typeof taskOfferClosedPayloadSchema>

export const projectionUpdatedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('projection.updated'),
  projectionId: projectionIdSchema,
  revision: revisionSchema
}).strict()
export type ProjectionUpdatedPayload = z.infer<typeof projectionUpdatedPayloadSchema>

export const projectEndpointUpdatedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('project.endpoint.updated'),
  projectId: projectIdSchema,
  projectEndpointBindingId: projectEndpointBindingIdSchema,
  revision: revisionSchema,
  locatorRevision: revisionSchema
}).strict()
export type ProjectEndpointUpdatedPayload = z.infer<typeof projectEndpointUpdatedPayloadSchema>

export const taskRecoveryOutputLinkedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('task.recovery.output_linked'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  recoveryActionId: recoveryActionIdSchema,
  journalEntryId: contentRecoveryJournalEntryIdSchema,
  logicalInvocationId: z.string().trim().min(1).max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  resourceRefId: resourceRefIdSchema,
  taskRevision: revisionSchema,
  executionRevision: revisionSchema,
  journalRevision: revisionSchema,
  output: taskResultOutputSchema
}).strict()
export type TaskRecoveryOutputLinkedPayload = z.infer<
  typeof taskRecoveryOutputLinkedPayloadSchema
>

export const taskRecoveryAbandonedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('task.recovery.abandoned'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  recoveryActionId: recoveryActionIdSchema,
  taskRevision: revisionSchema,
  executionRevision: revisionSchema,
  reason: z.string().trim().min(1).max(500)
}).strict()
export type TaskRecoveryAbandonedPayload = z.infer<typeof taskRecoveryAbandonedPayloadSchema>

export const projectPlanConfirmedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('project.plan.confirmed'),
  projectId: projectIdSchema,
  projectPlanId: projectPlanIdSchema,
  planDigest: sha256Schema,
  revision: revisionSchema
}).strict()
export type ProjectPlanConfirmedPayload = z.infer<typeof projectPlanConfirmedPayloadSchema>

export const taskResultSubmittedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('task.result.submitted'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  resultSubmissionId: resultSubmissionIdSchema,
  revision: revisionSchema
}).strict()
export type TaskResultSubmittedPayload = z.infer<typeof taskResultSubmittedPayloadSchema>

export const providerDirectoryPrincipalChangedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('provider_directory_principal.changed'),
  providerPrincipalFactId: providerPrincipalFactIdSchema,
  revision: revisionSchema,
  readiness: providerDirectoryPrincipalFactSchema.shape.readiness
}).strict()

export const projectMembershipChangedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('project.membership.changed'),
  projectId: projectIdSchema,
  projectMembershipId: projectMembershipSchema.shape.projectMembershipId,
  userId: userIdSchema,
  state: projectMembershipSchema.shape.state,
  revision: revisionSchema,
  authorityEpoch: revisionSchema
}).strict()

export const projectContentBindingChangedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('project.content.binding.changed'),
  projectId: projectIdSchema,
  projectContentBindingId: projectContentSpaceBindingSchema.shape.projectContentBindingId,
  status: projectContentSpaceBindingSchema.shape.status,
  revision: revisionSchema
}).strict()

export const projectContentProvisioningIntentChangedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('project.content.provisioning_intent.changed'),
  projectId: projectIdSchema,
  provisioningIntentId: projectContentProvisioningIntentSchema.shape.provisioningIntentId,
  provisioningRevision: revisionSchema,
  state: projectContentProvisioningIntentSchema.shape.state,
  revision: revisionSchema
}).strict()

export const projectContentReadinessChangedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('project.content.readiness.changed'),
  projectId: projectIdSchema,
  userId: userIdSchema,
  state: projectContentReadinessSchema.shape.state,
  revision: revisionSchema
}).strict()

export const projectRecoveryActionChangedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('project.recovery.action.changed'),
  projectId: projectIdSchema,
  recoveryActionId: recoveryActionIdSchema,
  revision: revisionSchema
}).strict()

export const taskExecutionFencedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('task.execution.fenced'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  reason: z.string().trim().min(1).max(500)
}).strict()

export const taskExecutionStartedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('task.execution.started'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  taskRevision: revisionSchema,
  executionRevision: revisionSchema
}).strict()

export const taskExecutionFailedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('task.execution.failed'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  taskRevision: revisionSchema,
  executionRevision: revisionSchema,
  taskStatus: z.enum(['revision_requested', 'failed']),
  retryable: z.boolean(),
  safeFailureCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u),
  safeMessage: z.string().trim().min(1).max(500)
}).strict()
export type TaskExecutionFailedPayload = z.infer<typeof taskExecutionFailedPayloadSchema>

export const projectPlanAwaitingConfirmationPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('project.plan.awaiting_confirmation'),
  projectId: projectIdSchema,
  projectPlanId: projectPlanIdSchema,
  planDigest: sha256Schema,
  revision: revisionSchema
}).strict()

export const projectFinalSummaryCreatedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('project.final_summary.created'),
  projectId: projectIdSchema,
  projectRecordId: projectRecordIdSchema,
  revision: revisionSchema
}).strict()

export const projectRecordSubmittedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('project_record.submitted'),
  projectId: projectIdSchema,
  projectRecordId: projectRecordIdSchema,
  revision: revisionSchema
}).strict()

export const projectDeletedPayloadSchema = z.object({
  ...agentInboxEnvelopeShape,
  type: z.literal('project.deleted'),
  projectId: projectIdSchema,
  deletedAt: timestampSchema
}).strict()
export type ProjectDeletedPayload = z.infer<typeof projectDeletedPayloadSchema>

export const agentInboxPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('capability.approval.decision'),
    remoteApprovalId: remoteApprovalIdSchema,
    desktopApprovalId: providerOpaqueIdSchema,
    projectionId: projectionIdSchema,
    runtimeId: runtimeIdSchema,
    threadId: threadIdSchema,
    turnId: runtimeTurnIdSchema,
    capabilityRequestId: providerOpaqueIdSchema,
    decisionId: providerOpaqueIdSchema,
    decision: remoteApprovalDecisionSchema
  }).strict(),
  personalMessageReceivedPayloadSchema,
  taskOfferedPayloadSchema,
  taskOfferClaimedPayloadSchema,
  taskOfferClosedPayloadSchema,
  taskRecoveryOutputLinkedPayloadSchema,
  taskRecoveryAbandonedPayloadSchema,
  projectPlanConfirmedPayloadSchema,
  taskResultSubmittedPayloadSchema,
  projectMembershipChangedPayloadSchema,
  projectContentBindingChangedPayloadSchema,
  projectContentProvisioningIntentChangedPayloadSchema,
  projectContentReadinessChangedPayloadSchema,
  projectRecoveryActionChangedPayloadSchema,
  taskExecutionFencedPayloadSchema,
  taskExecutionStartedPayloadSchema,
  taskExecutionFailedPayloadSchema,
  projectionUpdatedPayloadSchema,
  projectEndpointUpdatedPayloadSchema,
  projectDeletedPayloadSchema,
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('collaboration.state.changed'),
    event: cloudStateEventSchema
  }).strict(),
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('task.cancelled'),
    projectId: projectIdSchema,
    taskId: taskIdSchema,
    executionId: executionIdSchema,
    revision: revisionSchema,
    reason: z.string().trim().min(1).max(500)
  }).strict(),
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('task.updated'),
    projectId: projectIdSchema,
    taskId: taskIdSchema,
    executionId: executionIdSchema,
    revision: revisionSchema,
    status: taskStatusSchema,
    safeFailureCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u).optional(),
    resultProjectRecordId: projectRecordIdSchema.optional(),
    humanRequestId: z.string().regex(/^hrq_[A-Za-z0-9]{12,64}$/u).optional()
  }).strict(),
  projectRecordSubmittedPayloadSchema,
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('agent.revoked'),
    agentId: agentIdSchema
  }).strict(),
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('human.answer.received'),
    answer: humanAnswerSchema
  }).strict(),
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('project.started'),
    projectId: projectIdSchema,
    revision: revisionSchema
  }).strict(),
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('project.input.received'),
    projectId: projectIdSchema,
    projectInputId: projectInputIdSchema,
    revision: revisionSchema
  }).strict(),
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('coordinator.transferred'),
    projectId: projectIdSchema,
    previousCoordinatorAgentId: agentIdSchema,
    coordinatorAgentId: agentIdSchema,
    coordinatorAuthorityEpoch: revisionSchema,
    revision: revisionSchema
  }).strict()
])
export type AgentInboxPayload = z.infer<typeof agentInboxPayloadSchema>

export const userInboxPayloadSchema = z.discriminatedUnion('type', [
  providerDirectoryPrincipalChangedPayloadSchema,
  projectMembershipChangedPayloadSchema,
  projectPlanAwaitingConfirmationPayloadSchema,
  projectFinalSummaryCreatedPayloadSchema,
  projectRecordSubmittedPayloadSchema,
  projectRecoveryActionChangedPayloadSchema,
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('human.needed'),
    request: humanNeededSchema
  }).strict(),
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('personal.message.final'),
    projectionId: projectionIdSchema,
    text: nonEmptyTextSchema,
    turnId: runtimeTurnIdSchema,
    completedAt: timestampSchema
  }).strict(),
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('collaboration.important_failure'),
    projectId: projectIdSchema.optional(),
    taskId: taskIdSchema.optional(),
    safeMessage: z.string().trim().min(1).max(500)
  }).strict(),
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('project.summary'),
    projectId: projectIdSchema,
    projectRecordId: projectRecordIdSchema,
    text: nonEmptyTextSchema
  }).strict(),
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('capability.approval.pending'),
    projectionId: projectionIdSchema.optional(),
    taskId: taskIdSchema.optional(),
    approvalId: providerOpaqueIdSchema,
    requiresDesktop: z.literal(true),
    safeSummary: z.string().trim().min(1).max(500)
  }).strict()
])
export type UserInboxPayload = z.infer<typeof userInboxPayloadSchema>

export const inboxPayloadSchema = z.union([agentInboxPayloadSchema, userInboxPayloadSchema])
export type InboxPayload = z.infer<typeof inboxPayloadSchema>

const inboxMessageCommonShape = {
  schemaVersion: z.literal(1),
  type: z.literal('inbox_message'),
  inboxMessageId: inboxMessageIdSchema,
  sequence: sequenceSchema,
  status: z.enum(['pending', 'delivered', 'acknowledged', 'expired', 'dead_letter']),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.optional(),
  acknowledgedAt: timestampSchema.optional()
} as const

export const agentInboxMessageSchema = z.object({
  ...inboxMessageCommonShape,
  recipientType: z.literal('agent'),
  recipientAgentId: agentIdSchema,
  payload: agentInboxPayloadSchema
}).strict()

export const userInboxMessageSchema = z.object({
  ...inboxMessageCommonShape,
  recipientType: z.literal('user'),
  recipientUserId: userIdSchema,
  payload: userInboxPayloadSchema
}).strict()

export const inboxMessageSchema = z.discriminatedUnion('recipientType', [
  agentInboxMessageSchema,
  userInboxMessageSchema
]).superRefine((message, context) => {
  if ((message.status === 'acknowledged') !== (message.acknowledgedAt !== undefined)) {
    context.addIssue({ code: 'custom', path: ['acknowledgedAt'], message: 'Acknowledged inbox message requires acknowledgedAt exclusively' })
  }
})
export type InboxMessage = z.infer<typeof inboxMessageSchema>
export type AgentInboxMessage = z.infer<typeof agentInboxMessageSchema>
export type UserInboxMessage = z.infer<typeof userInboxMessageSchema>

const receiptCommonShape = {
  schemaVersion: z.literal(1),
  receiptId: receiptIdSchema,
  createdAt: timestampSchema
} as const

export const operationReceiptSchema = z.object({
  ...receiptCommonShape,
  type: z.literal('operation.receipt'),
  actor: authenticationContextSchema,
  idempotencyKey: idempotencyKeySchema,
  requestHash: sha256Schema,
  status: z.enum(['accepted', 'executing', 'succeeded', 'failed', 'rejected']),
  resultHash: sha256Schema.optional(),
  safeErrorCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u).optional()
}).strict().superRefine((receipt, context) => {
  if (receipt.status === 'failed' || receipt.status === 'rejected') {
    if (receipt.safeErrorCode === undefined) {
      context.addIssue({ code: 'custom', path: ['safeErrorCode'], message: 'Failed receipt requires safeErrorCode' })
    }
  } else if (receipt.safeErrorCode !== undefined) {
    context.addIssue({ code: 'custom', path: ['safeErrorCode'], message: 'Successful receipt cannot have safeErrorCode' })
  }
})

export const inboxReceiptSchema = z.object({
  ...receiptCommonShape,
  type: z.literal('inbox.receipt'),
  inboxMessageId: inboxMessageIdSchema,
  recipientType: z.enum(['user', 'agent']),
  sequence: sequenceSchema,
  acknowledgedAt: timestampSchema
}).strict()

export const providerDeliveryReceiptSchema = z.object({
  ...receiptCommonShape,
  type: z.literal('provider.delivery.receipt'),
  providerClientMessageId: providerOpaqueIdSchema,
  providerMessageId: providerMessageIdSchema,
  status: z.enum(['sent', 'failed']),
  attempt: z.number().int().min(1).max(100),
  safeErrorCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u).optional()
}).strict()

export const projectionMessageReceiptSchema = z.object({
  ...receiptCommonShape,
  type: z.literal('projection.message.receipt'),
  projectionId: projectionIdSchema,
  direction: z.enum(['remote_to_local', 'local_to_remote']),
  localItemId: localItemIdSchema,
  localTurnId: runtimeTurnIdSchema.optional(),
  providerMessageId: providerMessageIdSchema.optional(),
  payloadHash: sha256Schema,
  attempt: z.number().int().min(1).max(100),
  status: z.enum(['pending', 'accepted', 'executing', 'succeeded', 'failed', 'rejected', 'expired']),
  safeErrorCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u).optional()
}).strict()

export const humanAnswerReceiptSchema = z.object({
  ...receiptCommonShape,
  type: z.literal('human.answer.receipt'),
  humanAnswerId: z.string().regex(/^han_[A-Za-z0-9]{12,64}$/u),
  requestRevision: revisionSchema,
  status: z.enum(['accepted', 'duplicate', 'expired', 'rejected'])
}).strict()

export const receiptSchema = z.discriminatedUnion('type', [
  operationReceiptSchema,
  inboxReceiptSchema,
  providerDeliveryReceiptSchema,
  projectionMessageReceiptSchema,
  humanAnswerReceiptSchema
])
export type Receipt = z.infer<typeof receiptSchema>

const writeCommandShape = {
  ...protocolEnvelopeShape,
  idempotencyKey: idempotencyKeySchema
} as const

export const projectDeleteCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.delete'),
  projectId: projectIdSchema,
  expectedRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  expectedExecutionAuthorityEpoch: revisionSchema
}).strict()
export type ProjectDeleteCommand = z.infer<typeof projectDeleteCommandSchema>

export const humanNeededCreateContextSchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('worker_execution'),
    taskId: taskIdSchema,
    executionId: executionIdSchema,
    expectedTaskRevision: revisionSchema,
    expectedExecutionRevision: revisionSchema
  }).strict(),
  z.object({
    scope: z.literal('coordinator_project'),
    expectedProjectRevision: revisionSchema,
    expectedCoordinatorAuthorityEpoch: revisionSchema
  }).strict()
])
export type HumanNeededCreateContext = z.infer<typeof humanNeededCreateContextSchema>

export const projectTransferCoordinatorCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('project.transfer_coordinator'),
  projectId: projectIdSchema,
  expectedRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  coordinatorAgentId: agentIdSchema,
  expectedCoordinatorAvailabilityRevision: revisionSchema
}).strict()
export type ProjectTransferCoordinatorCommand = z.infer<
  typeof projectTransferCoordinatorCommandSchema
>

export const humanAnswerCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('human.answer'),
  humanRequestId: humanRequestIdSchema,
  requestRevision: revisionSchema,
  answer: nonEmptyTextSchema,
  decision: z.enum(['approve', 'reject']).optional()
}).strict()
export type HumanAnswerCommand = z.infer<typeof humanAnswerCommandSchema>

export const humanNeededCreateCommandSchema = z.object({
  ...writeCommandShape,
  type: z.literal('human.needed.create'),
  projectId: projectIdSchema,
  targetUserId: userIdSchema,
  context: humanNeededCreateContextSchema,
  requiredAssurance: assuranceLevelSchema,
  prompt: nonEmptyTextSchema,
  confirmableAction: confirmableHumanActionSchema.nullable().optional(),
  expiresAt: timestampSchema
}).strict()
export type HumanNeededCreateCommand = z.infer<typeof humanNeededCreateCommandSchema>

export const restRequestSchema = z.discriminatedUnion('type', [
  ...cloudStateCommandSchemas,
  z.object({
    ...writeCommandShape,
    type: z.literal('capability.approval.create'),
    projectionId: projectionIdSchema,
    runtimeId: runtimeIdSchema,
    threadId: threadIdSchema,
    turnId: runtimeTurnIdSchema,
    capabilityRequestId: providerOpaqueIdSchema,
    desktopApprovalId: providerOpaqueIdSchema,
    safeSummary: z.string().trim().min(1).max(500),
    effect: z.enum(['workspace-write', 'external-write', 'destructive']),
    remoteEligible: z.boolean(),
    expiresAt: timestampSchema
  }).strict(),
  z.object({
    ...writeCommandShape,
    type: z.literal('capability.approval.result'),
    remoteApprovalId: remoteApprovalIdSchema,
    decisionId: providerOpaqueIdSchema,
    outcome: z.enum(['applied', 'already_terminal', 'not_pending', 'not_eligible'])
  }).strict(),
  z.object({
    ...writeCommandShape,
    type: z.literal('capability.approval.withdraw'),
    remoteApprovalId: remoteApprovalIdSchema,
    desktopApprovalId: providerOpaqueIdSchema
  }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('user.get'), userId: userIdSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('user.update'), userId: userIdSchema, expectedRevision: revisionSchema, displayName: z.string().trim().min(1).max(200).optional(), status: z.enum(['active', 'suspended', 'revoked']).optional() }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('endpoint.challenge.create'), expectedIdentity: z.object({ provider: z.string().min(1).max(64), realmId: z.string().min(1).max(512), providerUserId: z.string().min(1).max(512) }).strict() }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('endpoint.challenge.get'), challengeId: challengeIdSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('endpoint.transition'), humanEndpointId: humanEndpointIdSchema, expectedRevision: revisionSchema, status: z.enum(['active', 'suspended', 'revoked']) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('endpoint.transfer'), humanEndpointId: humanEndpointIdSchema, targetUserId: userIdSchema, expectedRevision: revisionSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('agent.ensure'), deviceId: deviceIdSchema, capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/u)).max(256), credentialBootstrapPublicKey: agentCredentialBootstrapPublicKeySchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('agent.heartbeat'), agentId: agentIdSchema, expectedRevision: revisionSchema, connectionStatus: z.enum(['online', 'offline']), capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/u)).max(256) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('agent.rotate_credential'), agentId: agentIdSchema, expectedRevision: revisionSchema, credentialBootstrapPublicKey: agentCredentialBootstrapPublicKeySchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('agent.revoke'), agentId: agentIdSchema, expectedRevision: revisionSchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('participant.get'), userId: userIdSchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('endpoint.catalog.get'), provider: providerIdSchema.optional() }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('endpoint.locator.list'), humanEndpointId: humanEndpointIdSchema, agentId: agentIdSchema, query: z.string().trim().max(200).optional(), cursor: z.string().min(1).max(2_048).optional(), limit: z.number().int().min(1).max(500) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('managed_container.ensure'), humanEndpointId: humanEndpointIdSchema, agentId: agentIdSchema, displayName: z.string().trim().min(1).max(200).optional(), policy: providerManagedContainerPolicySchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('managed_container.get'), managedContainerId: managedContainerIdSchema, agentId: agentIdSchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('managed_container.list'), agentId: agentIdSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('managed_container.inspect'), managedContainerId: managedContainerIdSchema, agentId: agentIdSchema, expectedRevision: revisionSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('managed_container.reconcile'), managedContainerId: managedContainerIdSchema, agentId: agentIdSchema, expectedRevision: revisionSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('managed_container.archive'), managedContainerId: managedContainerIdSchema, agentId: agentIdSchema, expectedRevision: revisionSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('projection.create'), ownerUserId: userIdSchema, agentId: agentIdSchema, humanEndpointId: humanEndpointIdSchema, locator: providerLocatorSchema, displayName: z.string().trim().min(1).max(200), allowedSenderUserIds: z.array(userIdSchema).min(1).max(100) }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('projection.get'), projectionId: projectionIdSchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('projection.list'), ownerUserId: userIdSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('projection.update'), projectionId: projectionIdSchema, expectedRevision: revisionSchema, displayName: z.string().trim().min(1).max(200).optional(), status: z.enum(['active', 'paused']).optional(), allowedSenderUserIds: z.array(userIdSchema).min(1).max(100).optional() }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('projection.message.publish'), projectionId: projectionIdSchema, projectionRevision: revisionSchema, localItemId: localItemIdSchema, localTurnId: runtimeTurnIdSchema.optional(), kind: z.enum(['user_message', 'assistant_progress', 'assistant_final', 'system_status']), text: nonEmptyTextSchema, occurredAt: timestampSchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('project.get'), projectId: projectIdSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('project.transition'), projectId: projectIdSchema, expectedRevision: revisionSchema, expectedCoordinatorAuthorityEpoch: revisionSchema, expectedExecutionAuthorityEpoch: revisionSchema, status: z.enum(['active', 'paused', 'cancelled']) }).strict(),
  projectDeleteCommandSchema,
  projectTransferCoordinatorCommandSchema,
  z.object({ ...writeCommandShape, type: z.literal('project.input.create'), projectId: projectIdSchema, senderUserId: userIdSchema, sourceHumanEndpointId: humanEndpointIdSchema, providerMessageId: providerMessageIdSchema, text: nonEmptyTextSchema, occurredAt: timestampSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('project.endpoint.bind'), projectId: projectIdSchema, locator: providerLocatorSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('project.endpoint.update'), projectEndpointBindingId: projectEndpointBindingIdSchema, expectedRevision: revisionSchema, locator: providerLocatorSchema.optional(), locatorRevision: revisionSchema.optional(), status: z.enum(['active', 'closed']).optional() }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('project.endpoint.get'), projectId: projectIdSchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('task.get'), taskId: taskIdSchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('resource.get'), resourceRefId: resourceRefIdSchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('inbox.pull'), recipientType: z.enum(['user', 'agent']), afterSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), limit: z.number().int().min(1).max(1_000) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('inbox.ack'), inboxMessageId: inboxMessageIdSchema, sequence: sequenceSchema }).strict(),
  humanAnswerCommandSchema,
  humanNeededCreateCommandSchema,
  z.object({ ...protocolEnvelopeShape, type: z.literal('receipt.get'), receiptId: receiptIdSchema }).strict()
])
export type RestRequest = z.infer<typeof restRequestSchema>

export const restEntitySchema = z.union([
  remoteCapabilityApprovalSchema,
  userPrincipalSchema,
  humanEndpointBindingSchema,
  managedProviderContainerSchema,
  endpointChallengeSchema,
  agentNodeSchema,
  participantProfileSchema,
  remoteSessionProjectionSchema,
  projectInputSchema,
  projectSchema,
  projectEndpointBindingSchema,
  taskSchema,
  cloudResourceRefSchema,
  projectRecordSchema,
  workerAvailabilityProjectionSchema,
  humanNeededSchema,
  humanAnswerSchema,
  cloudStateEntitySchema
])
export type RestEntity = z.infer<typeof restEntitySchema>

const restWorkerAvailabilityPageSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('rest.worker_availability_page'),
  requestId: requestIdSchema,
  observedAt: timestampSchema,
  items: z.array(workerAvailabilityProjectionSchema).max(500),
  userLabels: z.array(workerDirectoryUserLabelSchema).max(500),
  agentLabels: z.array(workerDirectoryAgentLabelSchema).max(500),
  nextAgentId: agentIdSchema.optional()
}).strict().superRefine((page, context) => {
  const userIds = [...new Set(page.items.map(({ userId }) => userId))]
  const agentIds = page.items.map(({ agentId }) => agentId)
  if (new Set(agentIds).size !== agentIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'A global Worker directory page contains each Agent at most once.'
    })
  }
  if (
    page.userLabels.length !== userIds.length ||
    page.userLabels.some(({ userId }) => !userIds.includes(userId))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['userLabels'],
      message: 'A global Worker directory page contains one safe label for every visible User.'
    })
  }
  if (
    page.agentLabels.length !== agentIds.length ||
    page.agentLabels.some(({ agentId }) => !agentIds.includes(agentId))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['agentLabels'],
      message: 'A global Worker directory page contains one safe label for every visible Agent.'
    })
  }
  for (const [index, availability] of page.items.entries()) {
    const user = page.userLabels.find(({ userId }) => userId === availability.userId)
    const agent = page.agentLabels.find(({ agentId }) => agentId === availability.agentId)
    if (user?.status !== 'active') {
      context.addIssue({
        code: 'custom',
        path: ['userLabels'],
        message: `Worker availability item ${index} requires its active User label.`
      })
    }
    if (
      !agent ||
      agent.ownerUserId !== availability.userId ||
      agent.deviceId !== availability.deviceId ||
      agent.lifecycleStatus !== 'active'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['agentLabels'],
        message: `Worker availability item ${index} requires its exact active Agent ownership label.`
      })
    }
  }
}).readonly()

export const restResponseSchema = z.discriminatedUnion('type', [
  restProjectPageResponseSchema,
  restProjectCoordinationResponseSchema,
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('capability.approval.created'),
    requestId: requestIdSchema,
    approval: remoteCapabilityApprovalSchema
  }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('endpoint.challenge.created'), requestId: requestIdSchema, challengeId: challengeIdSchema, challengeCode: z.string().min(8).max(128), expiresAt: timestampSchema }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('endpoint.challenge.pending'), requestId: requestIdSchema, challengeId: challengeIdSchema, expiresAt: timestampSchema, retryAfterSeconds: z.number().int().min(1).max(300) }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('endpoint.challenge.verified'), requestId: requestIdSchema, challengeId: challengeIdSchema, userId: userIdSchema, humanEndpointId: humanEndpointIdSchema, assurance: assuranceLevelSchema.exclude(['basic']), verifiedAt: timestampSchema }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('endpoint.challenge.expired'), requestId: requestIdSchema, challengeId: challengeIdSchema, expiresAt: timestampSchema }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('participant.snapshot'), requestId: requestIdSchema, user: userPrincipalSchema, participant: participantProfileSchema, humanEndpoints: z.array(humanEndpointBindingSchema).max(100), agents: z.array(agentNodeSchema).max(100) }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('endpoint.catalog'), requestId: requestIdSchema, providers: z.array(humanEndpointProviderContractSchema).max(100) }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('endpoint.locator_page'), requestId: requestIdSchema, locators: z.array(providerLocatorSchema).max(500), nextCursor: z.string().min(1).max(2_048).optional() }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('agent.ensured'),
    requestId: requestIdSchema,
    agent: agentNodeSchema,
    sealedCredential: agentCredentialEnvelopeSchema.optional()
  }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('agent.credential_rotated'), requestId: requestIdSchema, agent: agentNodeSchema, sealedCredential: agentCredentialEnvelopeSchema }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('rest.entity'), requestId: requestIdSchema, entity: restEntitySchema }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('rest.collection'), requestId: requestIdSchema, items: z.array(restEntitySchema).max(10_000), nextCursor: z.string().min(1).max(2_048).optional() }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('rest.inbox_page'), requestId: requestIdSchema, messages: z.array(inboxMessageSchema).max(1_000), nextSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(),
  restWorkerAvailabilityPageSchema,
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('rest.project_worker_availability_page'), requestId: requestIdSchema, projectId: projectIdSchema, items: z.array(projectWorkerAvailabilityViewSchema).max(500), nextAgentId: agentIdSchema.optional() }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('rest.provider_directory_principal_page'), requestId: requestIdSchema, items: z.array(providerDirectoryPrincipalFactSchema).max(1_000), nextFactId: providerPrincipalFactIdSchema.optional() }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('rest.project_created'),
    requestId: requestIdSchema,
    project: projectSchema,
    memberships: z.array(projectMembershipSchema).min(1).max(1_000),
    provisioningIntent: projectContentProvisioningIntentSchema.nullable()
  }).strict().superRefine((response, context) => {
    if (response.project.status !== 'draft') {
      context.addIssue({ code: 'custom', path: ['project', 'status'], message: 'A Project creation transaction returns the initial draft Project.' })
    }
    if (response.memberships.some(({ projectId }) => projectId !== response.project.projectId)) {
      context.addIssue({ code: 'custom', path: ['memberships'], message: 'Created Memberships must belong to the created Project.' })
    }
    if (
      response.memberships.length !== 1 ||
      response.memberships[0]?.userId !== response.project.ownerUserId ||
      response.memberships[0]?.state !== 'active'
    ) {
      context.addIssue({ code: 'custom', path: ['memberships'], message: 'Project create returns only the authenticated Owner Membership.' })
    }
    if (response.project.contentMode !== 'none' || response.provisioningIntent !== null) {
      context.addIssue({
        code: 'custom',
        path: ['provisioningIntent'],
        message: 'Project create precedes initial Team/content configuration and Provider provisioning.'
      })
    }
  }),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('rest.task_execution_preflight'), requestId: requestIdSchema, preflight: taskExecutionPreflightSchema }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('rest.receipt'), requestId: requestIdSchema, receipt: receiptSchema }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('rest.error'), requestId: requestIdSchema, error: collaborationErrorSchema }).strict()
])
export type RestResponse = z.infer<typeof restResponseSchema>

export const webSocketMessageSchema = z.discriminatedUnion('type', [
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('connection.ready'),
    connectionId: providerOpaqueIdSchema,
    connectedAt: timestampSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('inbox.available'),
    recipientType: z.enum(['user', 'agent']),
    highestSequence: sequenceSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('connection.error'),
    error: collaborationErrorSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('connection.ping'),
    nonce: providerOpaqueIdSchema,
    sentAt: timestampSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('connection.pong'),
    nonce: providerOpaqueIdSchema,
    sentAt: timestampSchema
  }).strict()
])
export type WebSocketMessage = z.infer<typeof webSocketMessageSchema>

export const capabilityInputSchema = z.discriminatedUnion('type', [
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('collaboration.session.link'),
    projection: remoteSessionProjectionSchema,
    localBinding: localSessionProjectionBindingSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('collaboration.personal.execute'),
    projectionId: projectionIdSchema,
    projectionRevision: revisionSchema,
    runtimeId: runtimeIdSchema,
    threadId: threadIdSchema,
    item: orderedProjectionItemSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('collaboration.task.execute'),
    task: taskSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('collaboration.task.cancel'),
    taskId: taskIdSchema,
    revision: revisionSchema,
    reason: z.string().trim().min(1).max(500)
  }).strict()
])
export type CapabilityInput = z.infer<typeof capabilityInputSchema>

export const capabilityOutputSchema = z.discriminatedUnion('type', [
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('collaboration.session.linked'),
    projectionId: projectionIdSchema,
    runtimeId: runtimeIdSchema,
    threadId: threadIdSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('collaboration.execution.accepted'),
    localTurnId: runtimeTurnIdSchema,
    acceptedAt: timestampSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('collaboration.execution.final'),
    localTurnId: runtimeTurnIdSchema,
    text: nonEmptyTextSchema,
    completedAt: timestampSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('collaboration.execution.needs_approval'),
    localTurnId: runtimeTurnIdSchema,
    approvalId: providerOpaqueIdSchema,
    requiresDesktop: z.boolean(),
    safeSummary: z.string().trim().min(1).max(500)
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('collaboration.execution.failed'),
    localTurnId: runtimeTurnIdSchema.optional(),
    retryable: z.boolean(),
    safeErrorCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u),
    safeMessage: z.string().trim().min(1).max(500)
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('collaboration.task.cancelled'),
    taskId: taskIdSchema,
    revision: revisionSchema
  }).strict()
])
export type CapabilityOutput = z.infer<typeof capabilityOutputSchema>
