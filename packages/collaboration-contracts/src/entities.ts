import { z } from 'zod'
import {
  agentIdSchema,
  assuranceLevelSchema,
  challengeIdSchema,
  credentialVersionSchema,
  displayNameSchema,
  entityMetadataShape,
  executionIdSchema,
  humanAnswerIdSchema,
  humanEndpointIdSchema,
  humanRequestIdSchema,
  installationIdSchema,
  localItemIdSchema,
  managedContainerIdSchema,
  nonEmptyTextSchema,
  participantIdSchema,
  projectIdSchema,
  projectEndpointBindingIdSchema,
  projectInputIdSchema,
  projectRecordIdSchema,
  projectionIdSchema,
  providerMessageIdSchema,
  revisionSchema,
  runtimeIdSchema,
  sequenceSchema,
  taskIdSchema,
  threadIdSchema,
  timestampSchema,
  turnIdSchema,
  userIdSchema
} from './core.js'
import {
  providerIdentitySchema,
  providerLocatorSchema,
  providerManagedContainerPolicySchema,
  providerManagedContainerRefSchema
} from './provider.js'
import {
  taskExecutionFenceSchema,
  taskFileIntentSchema
} from './content-space-task-io.js'

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

export const userStatusSchema = z.enum(['active', 'suspended', 'revoked'])
export type UserStatus = z.infer<typeof userStatusSchema>

export const userPrincipalSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('user_principal'),
  userId: userIdSchema,
  displayName: displayNameSchema,
  status: userStatusSchema
}).strict()
export type UserPrincipal = z.infer<typeof userPrincipalSchema>

export const endpointStatusSchema = z.enum(['active', 'suspended', 'revoked'])
export type EndpointStatus = z.infer<typeof endpointStatusSchema>

export const humanEndpointBindingSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('human_endpoint_binding'),
  humanEndpointId: humanEndpointIdSchema,
  userId: userIdSchema,
  identity: providerIdentitySchema,
  displayName: displayNameSchema,
  assurance: assuranceLevelSchema.exclude(['basic']),
  status: endpointStatusSchema,
  verifiedAt: timestampSchema,
  lastSeenAt: timestampSchema.optional(),
  revokedAt: timestampSchema.optional()
}).strict().superRefine((binding, context) => {
  if (binding.status === 'revoked' && binding.revokedAt === undefined) {
    context.addIssue({ code: 'custom', path: ['revokedAt'], message: 'Revoked endpoint requires revokedAt' })
  }
  if (binding.status !== 'revoked' && binding.revokedAt !== undefined) {
    context.addIssue({ code: 'custom', path: ['revokedAt'], message: 'Only revoked endpoint may set revokedAt' })
  }
})
export type HumanEndpointBinding = z.infer<typeof humanEndpointBindingSchema>

export const managedProviderContainerSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('managed_provider_container'),
  managedContainerId: managedContainerIdSchema,
  ownerUserId: userIdSchema,
  humanEndpointId: humanEndpointIdSchema,
  provider: z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/u),
  realmId: z.string().trim().min(1).max(512),
  stableKey: z.string().trim().min(1).max(512),
  displayName: displayNameSchema,
  container: providerManagedContainerRefSchema.nullable(),
  policy: providerManagedContainerPolicySchema,
  checks: z.object({
    private: z.boolean(),
    protectedHistory: z.boolean(),
    exactMembership: z.boolean(),
    ownerCanSend: z.boolean(),
    messageBotCanSend: z.boolean(),
    ownerCanCreateTopics: z.boolean(),
    memberManagementRestricted: z.boolean(),
    channelManagementRestricted: z.boolean()
  }).strict().nullable(),
  status: z.enum(['requested', 'provisioning', 'active', 'drifted', 'suspended', 'archived', 'failed']),
  lastVerifiedAt: timestampSchema.nullable(),
  safeErrorCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u).nullable()
}).strict()
export type ManagedProviderContainer = z.infer<typeof managedProviderContainerSchema>

export const endpointChallengeStatusSchema = z.enum(['pending', 'consumed', 'expired', 'cancelled'])
export const endpointChallengeSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('endpoint_challenge'),
  challengeId: challengeIdSchema,
  userId: userIdSchema,
  expectedIdentity: providerIdentitySchema,
  status: endpointChallengeStatusSchema,
  expiresAt: timestampSchema,
  consumedAt: timestampSchema.optional()
}).strict().superRefine((challenge, context) => {
  if ((challenge.status === 'consumed') !== (challenge.consumedAt !== undefined)) {
    context.addIssue({ code: 'custom', path: ['consumedAt'], message: 'Consumed challenge requires consumedAt exclusively' })
  }
})
export type EndpointChallenge = z.infer<typeof endpointChallengeSchema>

export const agentLifecycleStatusSchema = z.enum(['active', 'revoked'])
export const agentConnectionStatusSchema = z.enum(['online', 'offline'])
export const agentNodeTypeSchema = z.enum(['desktop', 'server'])
export type AgentLifecycleStatus = z.infer<typeof agentLifecycleStatusSchema>
export type AgentConnectionStatus = z.infer<typeof agentConnectionStatusSchema>
export type AgentNodeType = z.infer<typeof agentNodeTypeSchema>

export const agentCapabilitySchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/u)

export const agentNodeSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('agent_node'),
  agentId: agentIdSchema,
  ownerUserId: userIdSchema,
  installationId: installationIdSchema,
  displayName: displayNameSchema,
  nodeType: agentNodeTypeSchema,
  capabilities: z.array(agentCapabilitySchema).max(256).refine(uniqueStrings, 'Capabilities must be unique'),
  lifecycleStatus: agentLifecycleStatusSchema,
  connectionStatus: agentConnectionStatusSchema,
  credentialVersion: credentialVersionSchema,
  lastSeenAt: timestampSchema.optional(),
  revokedAt: timestampSchema.optional()
}).strict().superRefine((agent, context) => {
  if (agent.lifecycleStatus === 'revoked' && agent.revokedAt === undefined) {
    context.addIssue({ code: 'custom', path: ['revokedAt'], message: 'Revoked Agent requires revokedAt' })
  }
  if (agent.lifecycleStatus === 'revoked' && agent.connectionStatus !== 'offline') {
    context.addIssue({ code: 'custom', path: ['connectionStatus'], message: 'Revoked Agent must be offline' })
  }
  if (agent.lifecycleStatus === 'active' && agent.revokedAt !== undefined) {
    context.addIssue({ code: 'custom', path: ['revokedAt'], message: 'Active Agent cannot have revokedAt' })
  }
})
export type AgentNode = z.infer<typeof agentNodeSchema>

export const participantStatusSchema = z.enum(['incomplete', 'active', 'suspended', 'revoked'])
export type ParticipantStatus = z.infer<typeof participantStatusSchema>

export const participantProfileSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('participant_profile'),
  participantId: participantIdSchema,
  userId: userIdSchema,
  primaryHumanEndpointId: humanEndpointIdSchema.nullable(),
  primaryAgentId: agentIdSchema.nullable(),
  status: participantStatusSchema
}).strict().superRefine((participant, context) => {
  const complete = participant.primaryHumanEndpointId !== null && participant.primaryAgentId !== null
  if (participant.status === 'active' && !complete) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Active Participant requires both primary endpoints' })
  }
  if (participant.status === 'incomplete' && complete) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Complete Participant cannot be incomplete' })
  }
})
export type ParticipantProfile = z.infer<typeof participantProfileSchema>

export const projectionStatusSchema = z.enum(['active', 'paused', 'error', 'closed'])
export type ProjectionStatus = z.infer<typeof projectionStatusSchema>

export const remoteSessionProjectionSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('remote_session_projection'),
  projectionId: projectionIdSchema,
  ownerUserId: userIdSchema,
  agentId: agentIdSchema,
  humanEndpointId: humanEndpointIdSchema,
  locator: providerLocatorSchema,
  locatorRevision: revisionSchema,
  displayName: displayNameSchema,
  status: projectionStatusSchema,
  allowedSenderUserIds: z.array(userIdSchema).min(1).max(100).refine(uniqueStrings, 'Allowed senders must be unique'),
  lastErrorCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u).optional()
}).strict().superRefine((projection, context) => {
  if (!projection.allowedSenderUserIds.includes(projection.ownerUserId)) {
    context.addIssue({ code: 'custom', path: ['allowedSenderUserIds'], message: 'Projection owner must be allowed' })
  }
  if (projection.status === 'error' && projection.lastErrorCode === undefined) {
    context.addIssue({ code: 'custom', path: ['lastErrorCode'], message: 'Error projection requires lastErrorCode' })
  }
  if (projection.status !== 'error' && projection.lastErrorCode !== undefined) {
    context.addIssue({ code: 'custom', path: ['lastErrorCode'], message: 'Only error projection may set lastErrorCode' })
  }
})
export type RemoteSessionProjection = z.infer<typeof remoteSessionProjectionSchema>

export const localSessionProjectionBindingSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('local_session_projection_binding'),
  projectionId: projectionIdSchema,
  agentId: agentIdSchema,
  runtimeId: runtimeIdSchema,
  threadId: threadIdSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict()
export type LocalSessionProjectionBinding = z.infer<typeof localSessionProjectionBindingSchema>

export const projectInputStatusSchema = z.enum(['queued', 'processed', 'rejected', 'expired'])
export type ProjectInputStatus = z.infer<typeof projectInputStatusSchema>

export const projectInputSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_input'),
  projectInputId: projectInputIdSchema,
  projectId: projectIdSchema,
  senderUserId: userIdSchema,
  sourceHumanEndpointId: humanEndpointIdSchema,
  providerMessageId: providerMessageIdSchema,
  sequence: sequenceSchema,
  text: nonEmptyTextSchema,
  status: projectInputStatusSchema,
  occurredAt: timestampSchema
}).strict()
export type ProjectInput = z.infer<typeof projectInputSchema>

export const projectStatusSchema = z.enum(['draft', 'active', 'paused', 'completed', 'cancelled'])
export type ProjectStatus = z.infer<typeof projectStatusSchema>

export const projectBudgetSchema = z.object({
  maxTasks: z.number().int().min(1).max(10_000),
  maxTasksPerRound: z.number().int().min(1).max(1_000),
  maxCoordinationRounds: z.number().int().min(1).max(10_000),
  maxTaskRetries: z.number().int().min(0).max(100)
}).strict().superRefine((budget, context) => {
  if (budget.maxTasksPerRound > budget.maxTasks) {
    context.addIssue({ code: 'custom', path: ['maxTasksPerRound'], message: 'Per-round budget cannot exceed total tasks' })
  }
})
export type ProjectBudget = z.infer<typeof projectBudgetSchema>

export const projectSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project'),
  projectId: projectIdSchema,
  ownerUserId: userIdSchema,
  displayName: displayNameSchema,
  goal: nonEmptyTextSchema,
  memberUserIds: z.array(userIdSchema).min(1).max(1_000).refine(uniqueStrings, 'Project members must be unique'),
  coordinatorAgentId: agentIdSchema,
  status: projectStatusSchema,
  budget: projectBudgetSchema
}).strict().superRefine((project, context) => {
  if (!project.memberUserIds.includes(project.ownerUserId)) {
    context.addIssue({ code: 'custom', path: ['memberUserIds'], message: 'Project owner must be a member' })
  }
})
export type Project = z.infer<typeof projectSchema>

export const projectEndpointBindingStatusSchema = z.enum(['active', 'error', 'closed'])
export const projectEndpointBindingSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_endpoint_binding'),
  projectEndpointBindingId: projectEndpointBindingIdSchema,
  projectId: projectIdSchema,
  locator: providerLocatorSchema,
  locatorRevision: revisionSchema,
  status: projectEndpointBindingStatusSchema,
  lastErrorCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u).optional()
}).strict().superRefine((binding, context) => {
  if ((binding.status === 'error') !== (binding.lastErrorCode !== undefined)) {
    context.addIssue({ code: 'custom', path: ['lastErrorCode'], message: 'Error binding requires lastErrorCode exclusively' })
  }
})
export type ProjectEndpointBinding = z.infer<typeof projectEndpointBindingSchema>

export const taskStatusSchema = z.enum([
  'offered',
  'accepted',
  'rejected',
  'running',
  'needs_human',
  'succeeded',
  'failed',
  'cancelled'
])
export type TaskStatus = z.infer<typeof taskStatusSchema>

export const taskSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('task'),
  taskId: taskIdSchema,
  projectId: projectIdSchema,
  createdByCoordinatorAgentId: agentIdSchema,
  assigneeAgentId: agentIdSchema,
  title: displayNameSchema,
  objective: nonEmptyTextSchema,
  completionCriteria: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100),
  dependencyTaskIds: z.array(taskIdSchema).max(1_000).refine(uniqueStrings, 'Task dependencies must be unique'),
  fileIntent: taskFileIntentSchema.nullable(),
  resourceRefIds: z.array(z.string().regex(/^rrf_[A-Za-z0-9](?:[A-Za-z0-9_]{10,62}[A-Za-z0-9])$/u)).max(101)
    .refine(uniqueStrings, 'Derived ResourceRef IDs must be unique'),
  executionFence: taskExecutionFenceSchema,
  status: taskStatusSchema,
  attempt: z.number().int().min(0).max(100),
  maxRetries: z.number().int().min(0).max(100),
  activeTurnId: turnIdSchema.optional(),
  completedAt: timestampSchema.optional()
}).strict().superRefine((task, context) => {
  if (task.dependencyTaskIds.includes(task.taskId)) {
    context.addIssue({ code: 'custom', path: ['dependencyTaskIds'], message: 'Task cannot depend on itself' })
  }
  if (task.attempt > task.maxRetries + 1) {
    context.addIssue({ code: 'custom', path: ['attempt'], message: 'Task attempt exceeds retry budget' })
  }
  const terminal = task.status === 'rejected' || task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled'
  if (terminal !== (task.completedAt !== undefined)) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Terminal Task requires completedAt exclusively' })
  }
  if (task.executionFence.assigneeAgentId !== task.assigneeAgentId) {
    context.addIssue({ code: 'custom', path: ['executionFence', 'assigneeAgentId'], message: 'Execution fence assignee must match Task assignee.' })
  }
  if ((task.fileIntent === null) !== (task.executionFence.bindingRevision === null)) {
    context.addIssue({ code: 'custom', path: ['executionFence', 'bindingRevision'], message: 'Only file Tasks carry a binding revision.' })
  }
  if (task.fileIntent === null && task.resourceRefIds.length !== 0) {
    context.addIssue({ code: 'custom', path: ['resourceRefIds'], message: 'Metadata-only Tasks cannot project ResourceRefs.' })
  }
  if (task.fileIntent !== null) {
    if (task.executionFence.bindingRevision !== task.fileIntent.bindingRevision) {
      context.addIssue({ code: 'custom', path: ['executionFence', 'bindingRevision'], message: 'Execution fence must preserve the Task binding revision.' })
    }
    if (task.resourceRefIds.length !== task.fileIntent.inputs.length + 1) {
      context.addIssue({ code: 'custom', path: ['resourceRefIds'], message: 'ResourceRef projection must be derived from every input and the binding root.' })
    }
  }
})
export type Task = z.infer<typeof taskSchema>

export const projectRecordKindSchema = z.enum(['observation', 'proposal', 'decision', 'summary', 'task_result'])
export const projectRecordStatusSchema = z.enum(['proposed', 'accepted', 'rejected'])
export type ProjectRecordKind = z.infer<typeof projectRecordKindSchema>
export type ProjectRecordStatus = z.infer<typeof projectRecordStatusSchema>

export const projectRecordSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_record'),
  projectRecordId: projectRecordIdSchema,
  projectId: projectIdSchema,
  kind: projectRecordKindSchema,
  status: projectRecordStatusSchema,
  body: nonEmptyTextSchema,
  authorUserId: userIdSchema,
  authorAgentId: agentIdSchema.nullable(),
  sourceTaskId: taskIdSchema.nullable(),
  sourceRevision: revisionSchema,
  acceptedByUserId: userIdSchema.nullable(),
  acceptedByAgentId: agentIdSchema.nullable(),
  acceptedAt: timestampSchema.nullable()
}).strict().superRefine((record, context) => {
  const hasAcceptance = record.acceptedByUserId !== null || record.acceptedByAgentId !== null
  if (record.status === 'accepted' && (!hasAcceptance || record.acceptedAt === null)) {
    context.addIssue({ code: 'custom', path: ['acceptedAt'], message: 'Accepted record requires accepter and time' })
  }
  if (record.status !== 'accepted' && (hasAcceptance || record.acceptedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['acceptedAt'], message: 'Only accepted record may identify accepter' })
  }
})
export type ProjectRecord = z.infer<typeof projectRecordSchema>

export const humanNeededStatusSchema = z.enum(['pending', 'answered', 'expired', 'cancelled'])
export const humanNeededSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('human_needed'),
  humanRequestId: humanRequestIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  targetUserId: userIdSchema,
  requestedByAgentId: agentIdSchema,
  requiredAssurance: assuranceLevelSchema,
  prompt: nonEmptyTextSchema,
  status: humanNeededStatusSchema,
  expiresAt: timestampSchema
}).strict()
export type HumanNeeded = z.infer<typeof humanNeededSchema>

export const humanAnswerSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('human_answer'),
  humanAnswerId: humanAnswerIdSchema,
  humanRequestId: humanRequestIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  requestRevision: revisionSchema,
  answeredByUserId: userIdSchema,
  answeredFromHumanEndpointId: humanEndpointIdSchema,
  assurance: assuranceLevelSchema,
  answer: nonEmptyTextSchema,
  answeredAt: timestampSchema
}).strict()
export type HumanAnswer = z.infer<typeof humanAnswerSchema>

export const orderedProjectionItemSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('ordered_projection_item'),
  projectionId: projectionIdSchema,
  sequence: sequenceSchema,
  localItemId: localItemIdSchema,
  origin: z.enum(['local', 'remote']),
  senderUserId: userIdSchema,
  senderHumanEndpointId: humanEndpointIdSchema.optional(),
  providerMessageId: providerMessageIdSchema.optional(),
  text: nonEmptyTextSchema,
  createdAt: timestampSchema
}).strict().superRefine((item, context) => {
  const hasRemoteIdentity = item.senderHumanEndpointId !== undefined && item.providerMessageId !== undefined
  if ((item.origin === 'remote') !== hasRemoteIdentity) {
    context.addIssue({ code: 'custom', message: 'Remote origin requires endpoint and provider message identity' })
  }
})
export type OrderedProjectionItem = z.infer<typeof orderedProjectionItemSchema>
