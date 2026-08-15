import { z } from 'zod'
import {
  agentIdSchema,
  assuranceLevelSchema,
  humanEndpointIdSchema,
  idempotencyKeySchema,
  inboxMessageIdSchema,
  localItemIdSchema,
  nonEmptyTextSchema,
  projectIdSchema,
  projectEndpointBindingIdSchema,
  projectInputIdSchema,
  projectRecordIdSchema,
  projectionIdSchema,
  protocolEnvelopeShape,
  protocolVersionSchema,
  providerIdSchema,
  providerMessageIdSchema,
  providerOpaqueIdSchema,
  receiptIdSchema,
  requestIdSchema,
  revisionSchema,
  runtimeIdSchema,
  runtimeTurnIdSchema,
  sequenceSchema,
  sha256Schema,
  taskIdSchema,
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
import { collaborationErrorSchema } from './errors.js'
import {
  humanEndpointProviderContractSchema,
  providerLocatorSchema
} from './provider.js'

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
  revision: revisionSchema
}).strict()
export type TaskOfferedPayload = z.infer<typeof taskOfferedPayloadSchema>

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

export const agentInboxPayloadSchema = z.discriminatedUnion('type', [
  personalMessageReceivedPayloadSchema,
  taskOfferedPayloadSchema,
  projectionUpdatedPayloadSchema,
  projectEndpointUpdatedPayloadSchema,
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('task.cancelled'),
    projectId: projectIdSchema,
    taskId: taskIdSchema,
    revision: revisionSchema,
    reason: z.string().trim().min(1).max(500)
  }).strict(),
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('task.updated'),
    projectId: projectIdSchema,
    taskId: taskIdSchema,
    revision: revisionSchema,
    status: taskStatusSchema,
    safeFailureCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u).optional(),
    resultProjectRecordId: projectRecordIdSchema.optional(),
    humanRequestId: z.string().regex(/^hrq_[A-Za-z0-9]{12,64}$/u).optional()
  }).strict(),
  z.object({
    ...agentInboxEnvelopeShape,
    type: z.literal('project_record.submitted'),
    projectId: projectIdSchema,
    projectRecordId: projectRecordIdSchema,
    revision: revisionSchema
  }).strict(),
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
    revision: revisionSchema
  }).strict()
])
export type AgentInboxPayload = z.infer<typeof agentInboxPayloadSchema>

export const userInboxPayloadSchema = z.discriminatedUnion('type', [
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

export const restRequestSchema = z.discriminatedUnion('type', [
  z.object({ ...writeCommandShape, type: z.literal('pairing.begin'), provider: providerIdSchema, realmId: providerOpaqueIdSchema, requestedDisplayName: z.string().trim().min(1).max(200) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('pairing.verify'), providerEventId: providerOpaqueIdSchema, challengeCode: z.string().min(8).max(128), provider: providerIdSchema, realmId: providerOpaqueIdSchema, providerUserId: providerOpaqueIdSchema, displayName: z.string().trim().min(1).max(200), assurance: assuranceLevelSchema.exclude(['basic']) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('pairing.redeem'), pollSecret: z.string().min(32).max(512) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('user.create'), displayName: z.string().trim().min(1).max(200) }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('user.get'), userId: userIdSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('user.update'), userId: userIdSchema, expectedRevision: revisionSchema, displayName: z.string().trim().min(1).max(200).optional(), status: z.enum(['active', 'suspended', 'revoked']).optional() }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('endpoint.challenge.create'), userId: userIdSchema, expectedIdentity: z.object({ provider: z.string().min(1).max(64), realmId: z.string().min(1).max(512), providerUserId: z.string().min(1).max(512) }).strict() }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('endpoint.bind'), userId: userIdSchema, challengeId: z.string().regex(/^chl_[A-Za-z0-9]{12,64}$/u), challengeResponse: z.string().min(8).max(512) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('endpoint.transition'), humanEndpointId: humanEndpointIdSchema, expectedRevision: revisionSchema, status: z.enum(['active', 'suspended', 'revoked']) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('endpoint.transfer'), humanEndpointId: humanEndpointIdSchema, targetUserId: userIdSchema, expectedRevision: revisionSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('agent.register'), ownerUserId: userIdSchema, installationId: z.string().regex(/^ins_[A-Za-z0-9]{12,64}$/u), displayName: z.string().trim().min(1).max(200), nodeType: z.enum(['desktop', 'server']), capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/u)).max(256) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('agent.heartbeat'), agentId: agentIdSchema, expectedRevision: revisionSchema, connectionStatus: z.enum(['online', 'offline']), capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/u)).max(256) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('agent.rotate_credential'), agentId: agentIdSchema, expectedRevision: revisionSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('agent.owner.transfer'), agentId: agentIdSchema, targetUserId: userIdSchema, expectedRevision: revisionSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('agent.revoke'), agentId: agentIdSchema, expectedRevision: revisionSchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('participant.get'), userId: userIdSchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('endpoint.catalog.get'), provider: providerIdSchema.optional() }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('endpoint.locator.list'), humanEndpointId: humanEndpointIdSchema, query: z.string().trim().max(200).optional(), cursor: z.string().min(1).max(2_048).optional(), limit: z.number().int().min(1).max(500) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('participant.update_primary'), userId: userIdSchema, expectedRevision: revisionSchema, primaryHumanEndpointId: humanEndpointIdSchema.nullable(), primaryAgentId: agentIdSchema.nullable() }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('projection.create'), ownerUserId: userIdSchema, agentId: agentIdSchema, humanEndpointId: humanEndpointIdSchema, locator: providerLocatorSchema, displayName: z.string().trim().min(1).max(200), allowedSenderUserIds: z.array(userIdSchema).min(1).max(100) }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('projection.get'), projectionId: projectionIdSchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('projection.list'), ownerUserId: userIdSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('projection.update'), projectionId: projectionIdSchema, expectedRevision: revisionSchema, displayName: z.string().trim().min(1).max(200).optional(), status: z.enum(['active', 'paused', 'closed']).optional(), locator: providerLocatorSchema.optional(), locatorRevision: revisionSchema.optional(), allowedSenderUserIds: z.array(userIdSchema).min(1).max(100).optional() }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('projection.message.publish'), projectionId: projectionIdSchema, projectionRevision: revisionSchema, localItemId: localItemIdSchema, localTurnId: runtimeTurnIdSchema.optional(), kind: z.enum(['user_message', 'assistant_final', 'system_status']), text: nonEmptyTextSchema, occurredAt: timestampSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('project.create'), ownerUserId: userIdSchema, displayName: z.string().trim().min(1).max(200), goal: nonEmptyTextSchema, memberUserIds: z.array(userIdSchema).min(1).max(1_000), coordinatorAgentId: agentIdSchema, budget: z.object({ maxTasks: z.number().int().min(1).max(10_000), maxTasksPerRound: z.number().int().min(1).max(1_000), maxCoordinationRounds: z.number().int().min(1).max(10_000), maxTaskRetries: z.number().int().min(0).max(100) }).strict() }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('project.get'), projectId: projectIdSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('project.transition'), projectId: projectIdSchema, expectedRevision: revisionSchema, status: z.enum(['active', 'paused', 'completed', 'cancelled']) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('project.transfer_coordinator'), projectId: projectIdSchema, expectedRevision: revisionSchema, coordinatorAgentId: agentIdSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('project.input.create'), projectId: projectIdSchema, senderUserId: userIdSchema, sourceHumanEndpointId: humanEndpointIdSchema, providerMessageId: providerMessageIdSchema, text: nonEmptyTextSchema, occurredAt: timestampSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('project.endpoint.bind'), projectId: projectIdSchema, locator: providerLocatorSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('project.endpoint.update'), projectEndpointBindingId: projectEndpointBindingIdSchema, expectedRevision: revisionSchema, locator: providerLocatorSchema.optional(), locatorRevision: revisionSchema.optional(), status: z.enum(['active', 'closed']).optional() }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('project.endpoint.get'), projectId: projectIdSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('task.create'), projectId: projectIdSchema, expectedRevision: revisionSchema, assigneeAgentId: agentIdSchema, title: z.string().trim().min(1).max(200), objective: nonEmptyTextSchema, completionCriteria: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100), dependencyTaskIds: z.array(taskIdSchema).max(1_000) }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('task.get'), taskId: taskIdSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('task.transition'), taskId: taskIdSchema, expectedRevision: revisionSchema, status: taskStatusSchema, resultSummary: nonEmptyTextSchema.optional(), safeFailureCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u).optional() }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('project_record.submit'), projectId: projectIdSchema, sourceTaskId: taskIdSchema.nullable(), sourceRevision: revisionSchema, kind: z.enum(['observation', 'proposal', 'decision', 'summary', 'task_result']), body: nonEmptyTextSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('project_record.accept'), projectRecordId: projectRecordIdSchema, expectedRevision: revisionSchema, decision: z.enum(['accepted', 'rejected']) }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('inbox.pull'), recipientType: z.enum(['user', 'agent']), afterSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), limit: z.number().int().min(1).max(1_000) }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('inbox.ack'), inboxMessageId: inboxMessageIdSchema, sequence: sequenceSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('human.answer'), humanRequestId: z.string().regex(/^hrq_[A-Za-z0-9]{12,64}$/u), requestRevision: revisionSchema, answer: nonEmptyTextSchema }).strict(),
  z.object({ ...writeCommandShape, type: z.literal('human.needed.create'), projectId: projectIdSchema, taskId: taskIdSchema, expectedTaskRevision: revisionSchema, targetUserId: userIdSchema, requiredAssurance: assuranceLevelSchema, prompt: nonEmptyTextSchema, expiresAt: timestampSchema }).strict(),
  z.object({ ...protocolEnvelopeShape, type: z.literal('receipt.get'), receiptId: receiptIdSchema }).strict()
])
export type RestRequest = z.infer<typeof restRequestSchema>

export const restEntitySchema = z.union([
  userPrincipalSchema,
  humanEndpointBindingSchema,
  endpointChallengeSchema,
  agentNodeSchema,
  participantProfileSchema,
  remoteSessionProjectionSchema,
  projectInputSchema,
  projectSchema,
  projectEndpointBindingSchema,
  taskSchema,
  projectRecordSchema,
  humanNeededSchema,
  humanAnswerSchema
])
export type RestEntity = z.infer<typeof restEntitySchema>

export const restResponseSchema = z.discriminatedUnion('type', [
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('pairing.begun'), requestId: requestIdSchema, challengeId: z.string().regex(/^chl_[A-Za-z0-9]{12,64}$/u), challengeCode: z.string().min(8).max(128), pollSecret: z.string().min(32).max(512), expiresAt: timestampSchema }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('pairing.pending'), requestId: requestIdSchema, challengeId: z.string().regex(/^chl_[A-Za-z0-9]{12,64}$/u), retryAfterSeconds: z.number().int().min(1).max(300) }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('pairing.verified'), requestId: requestIdSchema, userId: userIdSchema, humanEndpointId: humanEndpointIdSchema, userCredential: z.string().min(32).max(2_048) }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('participant.snapshot'), requestId: requestIdSchema, user: userPrincipalSchema, participant: participantProfileSchema, humanEndpoints: z.array(humanEndpointBindingSchema).max(100), agents: z.array(agentNodeSchema).max(100) }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('endpoint.catalog'), requestId: requestIdSchema, providers: z.array(humanEndpointProviderContractSchema).max(100) }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('endpoint.locator_page'), requestId: requestIdSchema, locators: z.array(providerLocatorSchema).max(500), nextCursor: z.string().min(1).max(2_048).optional() }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('agent.registered'), requestId: requestIdSchema, agent: agentNodeSchema, deviceCredential: z.string().min(32).max(2_048) }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('agent.credential_rotated'), requestId: requestIdSchema, agent: agentNodeSchema, deviceCredential: z.string().min(32).max(2_048) }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('agent.owner_transferred'), requestId: requestIdSchema, agent: agentNodeSchema, deviceCredential: z.string().min(32).max(2_048) }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('rest.entity'), requestId: requestIdSchema, entity: restEntitySchema }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('rest.collection'), requestId: requestIdSchema, items: z.array(restEntitySchema).max(10_000), nextCursor: z.string().min(1).max(2_048).optional() }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, type: z.literal('rest.inbox_page'), requestId: requestIdSchema, messages: z.array(inboxMessageSchema).max(1_000), nextSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(),
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
