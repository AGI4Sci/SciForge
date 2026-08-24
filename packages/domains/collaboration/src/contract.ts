import { z } from 'zod'
import {
  managedProviderContainerSchema,
  providerLocatorSchema,
  taskOfferRejectionReasonSchema
} from '@sciforge/collaboration-contracts'

const idSchema = z.string().trim().min(1).max(256)
const isoDateSchema = z.iso.datetime({ offset: true })
const safeTextSchema = z.string().max(4_000)
const displayTextSchema = z.string().trim().min(1).max(256)

export const COLLABORATION_CAPABILITY_IDS = Object.freeze({
  statusRead: 'collaboration.status.read',
  connectionConfigure: 'collaboration.connection.configure',
  connectionConnect: 'collaboration.connection.connect',
  endpointChallengeStart: 'collaboration.endpoint.challenge.start',
  endpointChallengePoll: 'collaboration.endpoint.challenge.poll',
  agentRegister: 'collaboration.agent.register',
  primaryAgentSelect: 'collaboration.participant.primary-agent.select',
  projectionLink: 'collaboration.projection.link',
  projectionUpdate: 'collaboration.projection.update',
  projectionShare: 'collaboration.projection.share',
  synchronizationRetry: 'collaboration.sync.retry',
  taskList: 'collaboration.task.list',
  workerAcceptanceUpdate: 'collaboration.worker.acceptance-policy.update',
  taskOfferDecide: 'collaboration.task.offer.decide',
  managedContainerInspect: 'collaboration.managed-container.inspect',
  managedContainerProvision: 'collaboration.managed-container.provision',
  managedContainerArchive: 'collaboration.managed-container.archive'
} as const)

export const collaborationProviderLocatorFieldSchema = z.object({
  key: z.string().trim().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/),
  label: displayTextSchema,
  required: z.boolean(),
  placeholder: z.string().max(256).optional()
}).strict()

export const collaborationProviderOptionSchema = z.object({
  providerKey: idSchema,
  label: displayTextSchema,
  realmLabel: displayTextSchema,
  containerLabel: displayTextSchema,
  topicLabel: displayTextSchema,
  locatorFields: z.array(collaborationProviderLocatorFieldSchema).max(32),
  managedContainers: z.boolean()
}).strict()

export const collaborationConnectionViewSchema = z.object({
  configured: z.boolean(),
  baseUrl: z.url().max(2_048).optional(),
  state: z.enum(['unconfigured', 'disconnected', 'connecting', 'connected', 'recovering', 'error']),
  agentAuthorityReady: z.boolean().optional(),
  localAgentId: idSchema.optional(),
  lastConnectedAt: isoDateSchema.optional(),
  lastInboxSequence: z.number().int().nonnegative(),
  pendingOutboxCount: z.number().int().nonnegative(),
  lastError: safeTextSchema.optional()
}).strict()

export const collaborationEndpointViewSchema = z.object({
  humanEndpointId: idSchema,
  providerKey: idSchema,
  displayName: z.string().max(256).optional(),
  status: z.enum(['active', 'suspended', 'revoked']),
  assurance: z.enum(['low', 'verified', 'strong']),
  projectionLocators: z.array(providerLocatorSchema).max(500),
  verifiedAt: isoDateSchema.optional(),
  lastSeenAt: isoDateSchema.optional()
}).strict()

export const collaborationAgentViewSchema = z.object({
  agentId: idSchema,
  ownerUserId: idSchema,
  displayName: displayTextSchema,
  nodeType: z.enum(['desktop', 'server']),
  status: z.enum(['online', 'offline', 'revoked']),
  capabilities: z.array(idSchema).max(256),
  lastSeenAt: isoDateSchema.optional(),
  primary: z.boolean(),
  workerAcceptanceMode: z.enum(['manual', 'automatic']).optional()
}).strict()

export const collaborationParticipantViewSchema = z.object({
  userId: idSchema,
  displayName: displayTextSchema,
  status: z.enum(['active', 'suspended', 'revoked']),
  revision: z.number().int().nonnegative(),
  complete: z.boolean(),
  primaryHumanEndpointId: idSchema.optional(),
  primaryAgentId: idSchema.optional(),
  endpoints: z.array(collaborationEndpointViewSchema).max(64),
  agents: z.array(collaborationAgentViewSchema).max(64)
}).strict()

export const collaborationProjectionQueueItemViewSchema = z.object({
  queueItemId: idSchema,
  projectionId: idSchema,
  sequence: z.number().int().positive(),
  origin: z.enum(['desktop', 'human-endpoint', 'agent', 'system']),
  kind: z.enum(['user-message', 'assistant-progress', 'assistant-reply', 'system-status']),
  state: z.enum([
    'queued',
    'executing',
    'reconciling',
    'awaiting-approval',
    'delivering',
    'completed',
    'failed',
    'ignored'
  ]),
  attempts: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  error: safeTextSchema.optional()
}).strict()

export const collaborationProjectionViewSchema = z.object({
  projectionId: idSchema,
  ownerUserId: idSchema,
  agentId: idSchema,
  agentOwnerUserId: idSchema,
  humanEndpointId: idSchema,
  runtimeId: idSchema,
  threadId: idSchema.optional(),
  workspaceRoot: z.string().max(4_096).optional(),
  displayName: displayTextSchema,
  remoteDisplay: z.string().max(512).optional(),
  remoteLocator: providerLocatorSchema.optional(),
  status: z.enum(['linking', 'active', 'paused', 'closed', 'error']),
  allowUserIds: z.array(idSchema).max(256),
  revision: z.number().int().nonnegative(),
  queueDepth: z.number().int().nonnegative(),
  lastSynchronizedAt: isoDateSchema.optional(),
  lastError: safeTextSchema.optional()
}).strict()

export const collaborationTaskViewSchema = z.object({
  taskId: idSchema,
  projectId: idSchema,
  executionId: idSchema,
  assigneeAgentId: idSchema,
  revision: z.number().int().positive(),
  title: displayTextSchema,
  state: z.enum([
    'offered',
    'awaiting-manual',
    'accepting',
    'running',
    'needs-human',
    'submitting',
    'completed',
    'rejected',
    'failed',
    'fenced',
    'manual-recovery'
  ]),
  acceptanceMode: z.enum(['manual', 'automatic']),
  decisionRequired: z.boolean(),
  preflightReasons: z.array(z.string().trim().min(1).max(128)).max(16),
  localTurnId: idSchema.optional(),
  updatedAt: isoDateSchema,
  error: safeTextSchema.optional()
}).strict()

export const collaborationProjectViewSchema = z.object({
  projectId: idSchema,
  name: displayTextSchema,
  state: z.enum(['active', 'paused', 'completed', 'cancelled']),
  revision: z.number().int().nonnegative(),
  coordinatorAgentId: idSchema,
  tasks: z.array(collaborationTaskViewSchema).max(10_000)
}).strict()

export const collaborationDiagnosticSchema = z.object({
  code: z.string().trim().min(1).max(128),
  severity: z.enum(['info', 'warning', 'error']),
  message: safeTextSchema,
  occurredAt: isoDateSchema,
  recoverable: z.boolean()
}).strict()

export const collaborationStatusSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  connection: collaborationConnectionViewSchema,
  providerOptions: z.array(collaborationProviderOptionSchema).max(32),
  managedContainers: z.array(managedProviderContainerSchema).max(64),
  participant: collaborationParticipantViewSchema.optional(),
  projections: z.array(collaborationProjectionViewSchema).max(10_000),
  projects: z.array(collaborationProjectViewSchema).max(10_000),
  queue: z.array(collaborationProjectionQueueItemViewSchema).max(10_000),
  diagnostics: z.array(collaborationDiagnosticSchema).max(256)
}).strict()

export const collaborationStatusReadInputSchema = z.object({}).strict()
export const collaborationStatusReadResultSchema = collaborationStatusSnapshotSchema

export const collaborationConnectionConfigureInputSchema = z.object({
  baseUrl: z.url().max(2_048).refine((value) => new URL(value).protocol === 'https:', {
    message: 'Collaboration service URL must use HTTPS.'
  })
}).strict()
export const collaborationConnectionConfigureResultSchema = z.object({
  connection: collaborationConnectionViewSchema
}).strict()

export const collaborationConnectionConnectInputSchema = z.object({
  action: z.enum(['connect', 'disconnect', 'recover'])
}).strict()
export const collaborationConnectionConnectResultSchema = z.object({
  connection: collaborationConnectionViewSchema
}).strict()

export const collaborationEndpointChallengeStartInputSchema = z.object({
  providerKey: idSchema,
  locator: z.record(
    z.string().trim().min(1).max(64),
    z.string().trim().min(1).max(1_024)
  )
}).strict()
export const collaborationEndpointChallengeStartResultSchema = z.object({
  challengeId: idSchema,
  pairingCode: z.string().trim().min(4).max(64),
  expiresAt: isoDateSchema,
  instruction: z.string().trim().min(1).max(1_000)
}).strict()

export const collaborationEndpointChallengePollInputSchema = z.object({
  challengeId: idSchema
}).strict()
export const collaborationEndpointChallengePollResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('pending'),
    expiresAt: isoDateSchema,
    retryAfterSeconds: z.number().int().min(1).max(300)
  }).strict(),
  z.object({ status: z.literal('expired') }).strict(),
  z.object({
    status: z.literal('verified'),
    userId: idSchema,
    humanEndpointId: idSchema,
    assurance: z.enum(['low', 'verified', 'strong'])
  }).strict()
])

export const collaborationAgentRegisterInputSchema = z.object({
  displayName: displayTextSchema,
  nodeType: z.enum(['desktop', 'server']).default('desktop'),
  capabilities: z.array(idSchema).max(256).default([])
}).strict()
export const collaborationAgentRegisterResultSchema = z.object({
  agent: collaborationAgentViewSchema
}).strict()

export const collaborationPrimaryAgentSelectInputSchema = z.object({
  agentId: idSchema,
  expectedParticipantRevision: z.number().int().nonnegative()
}).strict()
export const collaborationPrimaryAgentSelectResultSchema = z.object({
  participant: collaborationParticipantViewSchema
}).strict()

const projectionCommonSchema = z.object({
  agentId: idSchema,
  humanEndpointId: idSchema,
  locator: providerLocatorSchema,
  runtimeId: idSchema,
  workspaceRoot: z.string().min(1).max(4_096).optional(),
  displayName: displayTextSchema
})

export const collaborationProjectionLinkInputSchema = z.discriminatedUnion('mode', [
  projectionCommonSchema.extend({
    mode: z.literal('existing'),
    threadId: idSchema
  }).strict(),
  projectionCommonSchema.extend({
    mode: z.literal('new')
  }).strict()
])
export const collaborationProjectionLinkResultSchema = z.object({
  projection: collaborationProjectionViewSchema
}).strict()

export const collaborationProjectionUpdateInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('rename'),
    projectionId: idSchema,
    displayName: displayTextSchema,
    expectedRevision: z.number().int().nonnegative()
  }).strict(),
  z.object({
    action: z.enum(['pause', 'resume', 'close']),
    projectionId: idSchema,
    expectedRevision: z.number().int().nonnegative()
  }).strict(),
  z.object({
    action: z.literal('relink'),
    projectionId: idSchema,
    runtimeId: idSchema,
    threadId: idSchema,
    workspaceRoot: z.string().min(1).max(4_096).optional(),
    expectedRevision: z.number().int().nonnegative()
  }).strict(),
  z.object({
    action: z.literal('restore'),
    projectionId: idSchema,
    runtimeId: idSchema,
    threadId: idSchema,
    workspaceRoot: z.string().min(1).max(4_096).optional(),
    expectedRevision: z.number().int().nonnegative()
  }).strict()
])
export const collaborationProjectionUpdateResultSchema = z.object({
  projection: collaborationProjectionViewSchema
}).strict()

export const collaborationProjectionShareInputSchema = z.object({
  projectionId: idSchema,
  allowUserIds: z.array(idSchema).max(256).refine(
    (values) => new Set(values).size === values.length,
    { message: 'Projection allowlist must not contain duplicates.' }
  ),
  expectedRevision: z.number().int().nonnegative()
}).strict()
export const collaborationProjectionShareResultSchema = z.object({
  projection: collaborationProjectionViewSchema
}).strict()

export const collaborationSynchronizationRetryInputSchema = z.object({
  scope: z.enum(['connection', 'inbox', 'outbox', 'projection', 'task']),
  id: idSchema.optional()
}).strict().superRefine((value, context) => {
  if (['projection', 'task'].includes(value.scope) && !value.id) {
    context.addIssue({ code: 'custom', path: ['id'], message: `${value.scope} recovery requires an id.` })
  }
})
export const collaborationSynchronizationRetryResultSchema = z.object({
  accepted: z.boolean(),
  connection: collaborationConnectionViewSchema
}).strict()

export const collaborationTaskListInputSchema = z.object({
  projectId: idSchema.optional(),
  states: z.array(collaborationTaskViewSchema.shape.state).max(32).optional()
}).strict()
export const collaborationTaskListResultSchema = z.object({
  tasks: z.array(collaborationTaskViewSchema).max(100_000)
}).strict()

export const collaborationWorkerAcceptanceUpdateInputSchema = z.object({
  agentId: idSchema,
  mode: z.enum(['manual', 'automatic'])
}).strict()
export const collaborationWorkerAcceptanceUpdateResultSchema = z.object({
  agentId: idSchema,
  mode: z.enum(['manual', 'automatic'])
}).strict()

export const collaborationTaskOfferDecisionInputSchema = z.discriminatedUnion('decision', [
  z.object({
    executionId: idSchema,
    decision: z.literal('accept')
  }).strict(),
  z.object({
    executionId: idSchema,
    decision: z.literal('reject'),
    reason: taskOfferRejectionReasonSchema.extract(['human_rejected', 'other']),
    safeReasonDetail: z.string().trim().min(1).max(500).optional()
  }).strict().superRefine((value, context) => {
    if ((value.reason === 'other') !== Boolean(value.safeReasonDetail)) {
      context.addIssue({
        code: 'custom',
        path: ['safeReasonDetail'],
        message: 'Only other rejection requires a bounded safe detail.'
      })
    }
  })
])
export const collaborationTaskOfferDecisionResultSchema = z.object({
  accepted: z.literal(true)
}).strict()

const managedContainerEnsureInputSchema = z.object({ action: z.literal('ensure'), humanEndpointId: idSchema }).strict()
const managedContainerRefreshLocatorsInputSchema = z.object({
  action: z.literal('refresh-locators'), humanEndpointId: idSchema
}).strict()
const managedContainerRefreshStatusInputSchema = z.object({ action: z.literal('refresh-status') }).strict()
const managedContainerReconcileInputSchema = z.object({
    action: z.literal('reconcile'),
    managedContainerId: idSchema,
    expectedRevision: z.number().int().positive()
  }).strict()
const managedContainerArchiveInputSchema = z.object({
    action: z.literal('archive'),
    managedContainerId: idSchema,
    expectedRevision: z.number().int().positive()
  }).strict()

export const collaborationManagedContainerInspectInputSchema = z.discriminatedUnion('action', [
  managedContainerRefreshLocatorsInputSchema,
  managedContainerRefreshStatusInputSchema
])
export const collaborationManagedContainerProvisionInputSchema = z.discriminatedUnion('action', [
  managedContainerEnsureInputSchema,
  managedContainerReconcileInputSchema
])
export const collaborationManagedContainerArchiveInputSchema = managedContainerArchiveInputSchema
export const collaborationManagedContainerManageInputSchema = z.discriminatedUnion('action', [
  managedContainerEnsureInputSchema,
  managedContainerRefreshLocatorsInputSchema,
  managedContainerRefreshStatusInputSchema,
  managedContainerReconcileInputSchema,
  managedContainerArchiveInputSchema
])
export const collaborationManagedContainerManageResultSchema = z.object({
  managedContainer: managedProviderContainerSchema.nullable(),
  locatorCount: z.number().int().nonnegative().optional()
}).strict()

export type CollaborationStatusSnapshot = z.infer<typeof collaborationStatusSnapshotSchema>
export type CollaborationProjectionView = z.infer<typeof collaborationProjectionViewSchema>
export type CollaborationProjectionQueueItemView = z.infer<typeof collaborationProjectionQueueItemViewSchema>
export type CollaborationTaskView = z.infer<typeof collaborationTaskViewSchema>
export type CollaborationProviderOption = z.infer<typeof collaborationProviderOptionSchema>
export type CollaborationConnectionConfigureInput = z.infer<typeof collaborationConnectionConfigureInputSchema>
export type CollaborationConnectionConnectInput = z.infer<typeof collaborationConnectionConnectInputSchema>
export type CollaborationEndpointChallengeStartInput = z.infer<typeof collaborationEndpointChallengeStartInputSchema>
export type CollaborationEndpointChallengePollInput = z.infer<typeof collaborationEndpointChallengePollInputSchema>
export type CollaborationAgentRegisterInput = z.infer<typeof collaborationAgentRegisterInputSchema>
export type CollaborationPrimaryAgentSelectInput = z.infer<typeof collaborationPrimaryAgentSelectInputSchema>
export type CollaborationProjectionLinkInput = z.infer<typeof collaborationProjectionLinkInputSchema>
export type CollaborationProjectionUpdateInput = z.infer<typeof collaborationProjectionUpdateInputSchema>
export type CollaborationProjectionShareInput = z.infer<typeof collaborationProjectionShareInputSchema>
export type CollaborationSynchronizationRetryInput = z.infer<typeof collaborationSynchronizationRetryInputSchema>
export type CollaborationTaskListInput = z.infer<typeof collaborationTaskListInputSchema>
export type CollaborationWorkerAcceptanceUpdateInput = z.infer<
  typeof collaborationWorkerAcceptanceUpdateInputSchema
>
export type CollaborationTaskOfferDecisionInput = z.infer<
  typeof collaborationTaskOfferDecisionInputSchema
>
export type CollaborationManagedContainerManageInput = z.infer<typeof collaborationManagedContainerManageInputSchema>
