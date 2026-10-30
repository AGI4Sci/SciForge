import { z } from 'zod'
import {
  cloudProjectDashboardSchema,
  dashboardCommentDraftSchema,
  dashboardViewSchema,
  publicActivityEventSchema,
  agentProfilePublicProjectionSchema,
  deviceReadinessProjectionSchema,
  managedProviderContainerSchema,
  providerLocatorSchema,
  sha256Schema,
  taskExecutionStateSchema,
  type CloudProjectDashboard,
  notificationProjectionSchema,
} from '@sciforge/collaboration-contracts'
import {
  collaborationTaskCheckpointSchema,
  collaborationTaskInteractionSchema,
  type CollaborationTaskCheckpoint,
  type CollaborationTaskInteraction
} from './task-interaction.js'

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
  projectionLink: 'collaboration.projection.link',
  projectionUpdate: 'collaboration.projection.update',
  projectionShare: 'collaboration.projection.share',
  synchronizationRetry: 'collaboration.sync.retry',
  taskList: 'collaboration.task.list',
  workerDeliveryRead: 'collaboration.worker-delivery.read',
  workerDeliveryMaterialsList: 'collaboration.worker-delivery.materials.list',
  workerDeliveryDraftSave: 'collaboration.worker-delivery.draft.save',
  deliverySubmit: 'collaboration.delivery.submit',
  workerResidualDispose: 'collaboration.worker-residual.dispose',
  taskInteractionRead: 'collaboration.task.interaction.read',
  taskCheckpointAppend: 'collaboration.task.checkpoint.append',
  taskOfferDecide: 'collaboration.task.offer.decide',
  taskReturn: 'collaboration.task.return',
  taskSessionOpen: 'collaboration.task.session.open',
  managedContainerInspect: 'collaboration.managed-container.inspect',
  managedContainerProvision: 'collaboration.managed-container.provision',
  managedContainerArchive: 'collaboration.managed-container.archive',
  privateChannelDiscover: 'collaboration.private-channel.discover',
  activityComment: 'collaboration.activity.comment',
  notificationMarkRead: 'collaboration.notification.mark-read'
} as const)

/**
 * Routes of the one Collaboration Dashboard shell. A route is a view inside
 * the main-area page. Foreign packages add routes only through
 * `workbench.workspace-section` contributions whose section IDs are rendered
 * under Drive.
 */
export const COLLABORATION_WORKSPACE_ROUTES = Object.freeze([
  'dashboard',
  'requirements',
  'plan',
  'create',
  'my-work',
  'inbox',
  'activity',
  'drive',
  'members',
  'agents',
  'settings'
] as const)
export const collaborationWorkspaceRouteSchema = z.enum(COLLABORATION_WORKSPACE_ROUTES)
export type CollaborationWorkspaceRoute = z.infer<typeof collaborationWorkspaceRouteSchema>

export const collaborationActivationSchema = z.object({
  projectId: idSchema.optional(),
  route: collaborationWorkspaceRouteSchema.optional(),
  view: dashboardViewSchema.optional(),
  taskId: idSchema.optional()
}).strict().readonly()
export type CollaborationActivation = z.infer<typeof collaborationActivationSchema>

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

/** What queued Cloud commands are waiting for before they can be sent. */
export const collaborationOutboxWaitSchema = z.object({
  reason: z.enum(['agent_identity', 'agent_authority', 'authority_check', 'user_identity']),
  since: isoDateSchema
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
  outboxWait: collaborationOutboxWaitSchema.optional(),
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
  lastSeenAt: isoDateSchema.optional()
}).strict()

export const collaborationParticipantViewSchema = z.object({
  userId: idSchema,
  displayName: displayTextSchema,
  status: z.enum(['active', 'suspended', 'revoked']),
  revision: z.number().int().nonnegative(),
  complete: z.boolean(),
  primaryHumanEndpointId: idSchema.optional(),
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

export const collaborationOfferAvailabilitySchema = z.object({
  state: z.enum(['available', 'recovering', 'sync_pending', 'claimed_elsewhere', 'invalid', 'unverified']),
  reason: z.enum([
    'manual_decision_required', 'offline_queue_available', 'authority_unverified',
    'synchronization_pending', 'claimed_by_other_device', 'offer_closed',
    'offer_expired', 'contract_changed', 'authority_changed', 'recovery_evidence_missing', 'reconciliation_required'
  ]),
  canAccept: z.boolean(),
  canReject: z.boolean(),
  canDismiss: z.boolean()
}).strict().readonly()
export type CollaborationOfferAvailability = z.infer<typeof collaborationOfferAvailabilitySchema>

export const collaborationTaskViewSchema = z.object({
  taskId: idSchema,
  projectId: idSchema,
  taskOfferId: idSchema,
  workerUserId: idSchema,
  executionId: idSchema.optional(),
  contractRevision: z.number().int().positive().optional(),
  contractDigest: sha256Schema.optional(),
  assigneeAgentId: idSchema.optional(),
  hasDedicatedSession: z.boolean(),
  revision: z.number().int().positive(),
  title: displayTextSchema,
  state: z.enum([
    'offered',
    'awaiting-manual',
    'accepting',
    'accept-pending-sync',
    'waiting-runtime',
    'expired',
    'rejecting',
    'running',
    'needs-human',
    'waiting-result-confirm',
    'submitting',
    'completed',
    'dismissed',
    'claimed-elsewhere',
    'closed',
    'failed',
    'fenced',
    'manual-recovery'
  ]),
  decisionRequired: z.boolean(),
  offerAvailability: collaborationOfferAvailabilitySchema.optional(),
  preflightReasons: z.array(z.string().trim().min(1).max(128)).max(16),
  localTurnId: idSchema.optional(),
  reexecutionInputId: z.string().trim().min(1).max(512).optional(),
  resultSummary: z.string().trim().min(1).max(4_000).optional(),
  failure: z.object({
    code: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u),
    message: safeTextSchema,
    retryable: z.boolean(),
    retryState: z.enum(['available', 'retrying', 'failed', 'unavailable'])
  }).strict().readonly().optional(),
  revisionInstruction: z.string().trim().min(1).max(4_000).optional(),
  needsHumanQuestion: z.string().trim().min(1).max(4_000).optional(),
  updatedAt: isoDateSchema,
  error: safeTextSchema.optional()
}).strict()

export const collaborationTaskSessionOpenInputSchema = z.object({
  projectId: idSchema,
  taskId: idSchema,
  executionId: idSchema.optional()
}).strict()
export type CollaborationTaskSessionOpenInput = z.infer<typeof collaborationTaskSessionOpenInputSchema>

export const collaborationTaskSessionOpenResultSchema = z.object({
  opened: z.literal(true),
  sessionId: idSchema,
  runtimeId: idSchema,
  threadId: idSchema
}).strict()
export type CollaborationTaskSessionOpenResult = z.infer<typeof collaborationTaskSessionOpenResultSchema>

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
  /** Cloud-owned Dashboard projections, one per readable Project. */
  dashboards: z.array(cloudProjectDashboardSchema).max(10_000),
  agentProfiles: z.array(agentProfilePublicProjectionSchema).max(256).optional(),
  devices: z.array(deviceReadinessProjectionSchema).max(256).optional(),
  notifications: z.array(notificationProjectionSchema).max(10_000).optional(),
  queue: z.array(collaborationProjectionQueueItemViewSchema).max(10_000),
  diagnostics: z.array(collaborationDiagnosticSchema).max(256)
}).strict()

export const collaborationStatusReadInputSchema = z.object({
  /**
   * The foreground Collaboration page asks for a Dashboard refresh with its
   * silent refresh so changes other windows made become visible. This is a
   * read-only projection refresh and never requires an approval.
   */
  refreshDashboards: z.boolean().optional()
}).strict()
export const collaborationStatusReadResultSchema = collaborationStatusSnapshotSchema
export type CollaborationStatusReadInput = z.infer<typeof collaborationStatusReadInputSchema>

/** Omitting `baseUrl` binds Collaboration to the Cloud endpoint of the signed-in identity. */
export const collaborationConnectionConfigureInputSchema = z.object({
  baseUrl: z.url().max(2_048).refine((value) => new URL(value).protocol === 'https:', {
    message: 'Collaboration service URL must use HTTPS.'
  }).optional()
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
    action: z.enum(['pause', 'resume']),
    projectionId: idSchema,
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
  scope: z.enum(['connection', 'inbox', 'outbox', 'projection', 'task', 'dashboard']),
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

export const collaborationPrivateChannelDiscoverInputSchema = z.object({
  humanEndpointId: idSchema
}).strict()
export const collaborationPrivateChannelDiscoverResultSchema = z.object({
  locatorCount: z.number().int().nonnegative()
}).strict()

/** Local-only Task interaction contracts; these do not mutate Cloud state. */
export const collaborationTaskInteractionReadInputSchema = z.object({
  projectId: idSchema,
  taskId: idSchema,
  executionId: idSchema.optional()
}).strict()

export const collaborationTaskInteractionViewSchema = z.object({
  projectId: idSchema,
  taskId: idSchema,
  executionId: idSchema.optional(),
  state: z.enum([
    'idle', 'running', 'waiting_human', 'intervention_queued',
    'paused_local', 'awaiting_cloud', 'blocked_cloud', 'completed'
  ]),
  pending: z.array(collaborationTaskInteractionSchema).max(10_000),
  interactions: z.array(collaborationTaskInteractionSchema).max(100_000),
  latestInteraction: collaborationTaskInteractionSchema.optional(),
  checkpoints: z.array(collaborationTaskCheckpointSchema).max(20_000),
  cloudExecutionState: taskExecutionStateSchema.optional(),
  cloudTaskRevision: z.number().int().positive().optional(),
  localUpdatedAt: isoDateSchema.optional()
}).strict()

export const collaborationTaskInteractionReadResultSchema = z.object({
  view: collaborationTaskInteractionViewSchema
}).strict()

export const collaborationTaskCheckpointAppendInputSchema = z.object({
  projectId: idSchema,
  taskId: idSchema,
  executionId: idSchema.nullable(),
  kind: z.enum(['progress', 'partial-result', 'human-note', 'status']),
  source: z.enum(['human', 'agent', 'system']),
  summary: z.string().trim().min(1).max(4_000),
  detail: z.string().trim().min(1).max(32_000).nullable().optional(),
  idempotencyKey: z.string().min(16).max(128).regex(/^idem_[A-Za-z0-9._:-]+$/u).optional()
}).strict()

export const collaborationTaskCheckpointAppendResultSchema = z.object({
  checkpoint: collaborationTaskCheckpointSchema,
  view: collaborationTaskInteractionViewSchema
}).strict()

export const collaborationTaskOfferDecisionInputSchema = z.discriminatedUnion('decision', [
  z.object({
    taskOfferId: idSchema,
    decision: z.literal('accept')
  }).strict(),
  z.object({
    taskOfferId: idSchema,
    decision: z.literal('dismiss')
  }).strict(),
  z.object({
    taskOfferId: idSchema,
    decision: z.literal('reject')
  }).strict()
])
export const collaborationTaskOfferDecisionResultSchema = z.object({
  accepted: z.literal(true)
}).strict()

/** Desktop human control; the Cloud failure command remains the authority. */
export const collaborationTaskReturnInputSchema = z.object({
  projectId: idSchema,
  taskId: idSchema,
  executionId: idSchema,
  reason: z.string().trim().min(1).max(500)
}).strict()
export const collaborationTaskReturnResultSchema = z.object({
  returned: z.literal(true)
}).strict()
export type CollaborationTaskReturnInput = z.infer<typeof collaborationTaskReturnInputSchema>

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
export type { CloudProjectDashboard }
export type CollaborationProviderOption = z.infer<typeof collaborationProviderOptionSchema>
export type CollaborationConnectionConfigureInput = z.infer<typeof collaborationConnectionConfigureInputSchema>
export type CollaborationConnectionConnectInput = z.infer<typeof collaborationConnectionConnectInputSchema>
export type CollaborationEndpointChallengeStartInput = z.infer<typeof collaborationEndpointChallengeStartInputSchema>
export type CollaborationEndpointChallengePollInput = z.infer<typeof collaborationEndpointChallengePollInputSchema>
export type CollaborationProjectionLinkInput = z.infer<typeof collaborationProjectionLinkInputSchema>
export type CollaborationProjectionUpdateInput = z.infer<typeof collaborationProjectionUpdateInputSchema>
export type CollaborationProjectionShareInput = z.infer<typeof collaborationProjectionShareInputSchema>
export type CollaborationSynchronizationRetryInput = z.infer<typeof collaborationSynchronizationRetryInputSchema>
export type CollaborationTaskListInput = z.infer<typeof collaborationTaskListInputSchema>
export type CollaborationPrivateChannelDiscoverInput = z.infer<typeof collaborationPrivateChannelDiscoverInputSchema>
export type CollaborationTaskInteractionReadInput = z.infer<
  typeof collaborationTaskInteractionReadInputSchema
>
export type CollaborationTaskCheckpointAppendInput = z.infer<
  typeof collaborationTaskCheckpointAppendInputSchema
>
export type { CollaborationTaskInteraction, CollaborationTaskCheckpoint }
export type CollaborationTaskOfferDecisionInput = z.infer<
  typeof collaborationTaskOfferDecisionInputSchema
>
export type CollaborationManagedContainerManageInput = z.infer<typeof collaborationManagedContainerManageInputSchema>

// Coordinator contracts are part of the same installable Collaboration
// package. Keep the public contract entrypoint canonical after consolidation.
export {
  PROJECT_COORDINATOR_CAPABILITY_IDS,
  projectCoordinatorProjectCreateResultSchema
} from './coordinator/contract.js'
export type {
  ProjectCoordinatorProjectCreateResult
} from './coordinator/contract.js'

/** The Desktop path for a human public comment; the Cloud owns the event. */
export const collaborationActivityCommentInputSchema = z.object({
  commentId: z.string().trim().regex(/^cmt_[A-Za-z0-9_-]{16,96}$/u),
  projectId: dashboardCommentDraftSchema.shape.projectId,
  taskId: dashboardCommentDraftSchema.shape.taskId,
  text: dashboardCommentDraftSchema.shape.text,
  mentionedUserIds: dashboardCommentDraftSchema.shape.mentionedUserIds
}).strict()
export type CollaborationActivityCommentInput = z.infer<
  typeof collaborationActivityCommentInputSchema
>
export const collaborationActivityCommentResultSchema = z.object({
  event: publicActivityEventSchema,
  mentionedUserIds: z.array(idSchema).max(64)
}).strict()

export const collaborationNotificationMarkReadInputSchema = z.object({
  notificationId: notificationProjectionSchema.shape.notificationId,
  expectedRevision: notificationProjectionSchema.shape.revision
}).strict()
export type CollaborationNotificationMarkReadInput = z.infer<
  typeof collaborationNotificationMarkReadInputSchema
>
export const collaborationNotificationMarkReadResultSchema = z.object({
  notification: notificationProjectionSchema
}).strict()

export * from './worker-delivery.js'
