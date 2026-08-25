import { z } from 'zod'

import {
  agentIdSchema,
  deviceIdSchema,
  entityMetadataShape,
  projectIdSchema,
  projectMembershipIdSchema,
  revisionSchema,
  safeCodeSchema,
  taskAuthorityIdSchema,
  timestampSchema,
  userIdSchema
} from './core.js'
import {
  projectContentReadinessSchema,
  providerDirectoryPrincipalFactSchema
} from './project-content.js'

const unique = <T>(values: readonly T[]): boolean => new Set(values).size === values.length

export const projectMembershipStateSchema = z.enum([
  'pending_membership',
  'active',
  'membership_removal_pending',
  'removed'
])
export type ProjectMembershipState = z.infer<typeof projectMembershipStateSchema>

export const projectMembershipSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_membership'),
  projectMembershipId: projectMembershipIdSchema,
  projectId: projectIdSchema,
  userId: userIdSchema,
  state: projectMembershipStateSchema,
  authorityEpoch: revisionSchema,
  activatedAt: timestampSchema.nullable(),
  removalRequestedAt: timestampSchema.nullable(),
  removalRequestedByUserId: userIdSchema.nullable(),
  removedAt: timestampSchema.nullable()
}).strict().superRefine((membership, context) => {
  const pending = membership.state === 'pending_membership'
  const removalPending = membership.state === 'membership_removal_pending'
  const removed = membership.state === 'removed'

  if (pending === (membership.activatedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['activatedAt'],
      message: 'Pending membership has no activation time; every later state retains it.'
    })
  }
  if ((removalPending || removed) !== (
    membership.removalRequestedAt !== null && membership.removalRequestedByUserId !== null
  )) {
    context.addIssue({
      code: 'custom',
      path: ['removalRequestedAt'],
      message: 'Removal states require the exact requester and request time.'
    })
  }
  if (removed !== (membership.removedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['removedAt'],
      message: 'Only removed membership has a removal completion time.'
    })
  }
})
export type ProjectMembership = z.infer<typeof projectMembershipSchema>

export const taskAuthorityStateSchema = z.enum(['eligible', 'suspended', 'fenced'])
export const taskAuthorityScopeSchema = z.enum(['text_tasks', 'file_tasks'])
export const taskAuthorityReasonSchema = z.enum([
  'project_paused',
  'project_terminal',
  'membership_pending',
  'membership_removal_pending',
  'membership_removed',
  'content_identity_missing',
  'content_not_ready',
  'content_binding_degraded'
])
export type TaskAuthorityState = z.infer<typeof taskAuthorityStateSchema>
export type TaskAuthorityScope = z.infer<typeof taskAuthorityScopeSchema>
export type TaskAuthorityReason = z.infer<typeof taskAuthorityReasonSchema>

/**
 * Durable Cloud authority state. Command authorization additionally checks the
 * current Project, Device, Agent, Task and execution revisions against this epoch.
 */
export const taskAuthoritySchema = z.object({
  ...entityMetadataShape,
  type: z.literal('task_authority'),
  taskAuthorityId: taskAuthorityIdSchema,
  projectId: projectIdSchema,
  userId: userIdSchema,
  scope: taskAuthorityScopeSchema,
  state: taskAuthorityStateSchema,
  authorityEpoch: revisionSchema,
  reason: taskAuthorityReasonSchema.nullable(),
  effectiveAt: timestampSchema
}).strict().superRefine((authority, context) => {
  if ((authority.state === 'eligible') !== (authority.reason === null)) {
    context.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'Eligible authority has no denial reason; suspended or fenced authority requires one.'
    })
  }
})
export type TaskAuthority = z.infer<typeof taskAuthoritySchema>

export const runtimeReadinessSchema = z.enum(['ready', 'unavailable'])
export const providerPrincipalSnapshotStatusSchema = z.enum([
  'not_applicable',
  'missing',
  'match',
  'stale'
])
export type ProviderPrincipalSnapshotStatus = z.infer<typeof providerPrincipalSnapshotStatusSchema>

export const workerAvailabilityProjectionSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('worker_availability_projection'),
  userId: userIdSchema,
  agentId: agentIdSchema,
  deviceId: deviceIdSchema,
  agentActive: z.boolean(),
  deviceActive: z.boolean(),
  connectionStatus: z.enum(['online', 'offline']),
  lastHeartbeatAt: timestampSchema.nullable(),
  runtimeReadiness: runtimeReadinessSchema,
  runtimeCapabilityTags: z.array(safeCodeSchema).max(256)
    .refine(unique, 'Runtime capability tags must be unique.'),
  acceptsNewOffers: z.boolean(),
  activeTaskCount: z.number().int().min(0).max(10_000),
  observedAt: timestampSchema,
  expiresAt: timestampSchema
}).strict().superRefine((projection, context) => {
  if (projection.connectionStatus === 'online' && projection.lastHeartbeatAt === null) {
    context.addIssue({
      code: 'custom',
      path: ['lastHeartbeatAt'],
      message: 'An online projection requires a heartbeat observation.'
    })
  }
  if (projection.acceptsNewOffers && (
    !projection.agentActive ||
    !projection.deviceActive ||
    projection.connectionStatus !== 'online' ||
    projection.runtimeReadiness !== 'ready'
  )) {
    context.addIssue({
      code: 'custom',
      path: ['acceptsNewOffers'],
      message: 'Only an active online Agent on an active Device with a ready Runtime may accept offers.'
    })
  }
  if (Date.parse(projection.expiresAt) <= Date.parse(projection.observedAt)) {
    context.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Availability projection expiry must follow its observation.'
    })
  }
})
export type WorkerAvailabilityProjection = z.infer<typeof workerAvailabilityProjectionSchema>

/** Project-scoped composition; it nests rather than duplicates global heartbeat facts. */
export const projectWorkerAvailabilityViewSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('project_worker_availability_view'),
  projectId: projectIdSchema,
  userId: userIdSchema,
  agentId: agentIdSchema,
  revision: revisionSchema,
  availability: workerAvailabilityProjectionSchema,
  membership: projectMembershipSchema.nullable(),
  taskAuthorities: z.array(taskAuthoritySchema).max(2),
  providerPrincipalFact: providerDirectoryPrincipalFactSchema.nullable(),
  providerPrincipalSnapshotStatus: providerPrincipalSnapshotStatusSchema,
  contentReadiness: projectContentReadinessSchema.nullable(),
  observedAt: timestampSchema
}).strict().superRefine((view, context) => {
  if (view.availability.userId !== view.userId || view.availability.agentId !== view.agentId) {
    context.addIssue({
      code: 'custom',
      path: ['availability'],
      message: 'Project view must compose the exact User and Agent global availability.'
    })
  }
  if (view.membership !== null && (
    view.membership.projectId !== view.projectId || view.membership.userId !== view.userId
  )) {
    context.addIssue({
      code: 'custom',
      path: ['membership'],
      message: 'Project view membership must belong to the exact Project and User.'
    })
  }
  if (view.taskAuthorities.some((authority) => (
    authority.projectId !== view.projectId || authority.userId !== view.userId
  ))) {
    context.addIssue({
      code: 'custom',
      path: ['taskAuthorities'],
      message: 'Project view authority rows must belong to the exact Project and User.'
    })
  }
  const scopes = view.taskAuthorities.map(({ scope }) => scope)
  if (new Set(scopes).size !== scopes.length) {
    context.addIssue({
      code: 'custom',
      path: ['taskAuthorities'],
      message: 'Project view may contain at most one Task Authority row per scope.'
    })
  }
  if (view.contentReadiness !== null && (
    view.contentReadiness.projectId !== view.projectId || view.contentReadiness.userId !== view.userId
  )) {
    context.addIssue({
      code: 'custom',
      path: ['contentReadiness'],
      message: 'Project view readiness must belong to the exact Project and User.'
    })
  }
  if (view.providerPrincipalFact !== null && view.providerPrincipalFact.userId !== view.userId) {
    context.addIssue({
      code: 'custom',
      path: ['providerPrincipalFact'],
      message: 'Project view Provider principal fact must belong to the exact User.'
    })
  }
  if (view.providerPrincipalFact !== null && view.contentReadiness?.providerPrincipal !== null &&
      view.contentReadiness?.providerPrincipal !== undefined && (
        view.providerPrincipalFact.providerPrincipal.providerInstance.authority !==
          view.contentReadiness.providerInstance.authority ||
        view.providerPrincipalFact.providerPrincipal.providerInstance.instanceId !==
          view.contentReadiness.providerInstance.instanceId
      )) {
    context.addIssue({
      code: 'custom',
      path: ['providerPrincipalFact'],
      message: 'Project view current Provider principal fact must belong to the Project Provider Instance.'
    })
  }
  if (view.contentReadiness === null && view.providerPrincipalFact !== null) {
    context.addIssue({
      code: 'custom',
      path: ['providerPrincipalFact'],
      message: 'A content-free Project view cannot join an unrelated global Provider principal fact.'
    })
  }
  const expectedSnapshotStatus = view.contentReadiness === null
    ? 'not_applicable'
    : view.providerPrincipalFact === null
      ? 'missing'
      : view.contentReadiness.providerPrincipalFactId === view.providerPrincipalFact.providerPrincipalFactId &&
          view.contentReadiness.snapshottedFactRevision === view.providerPrincipalFact.revision
        ? 'match'
        : 'stale'
  if (view.providerPrincipalSnapshotStatus !== expectedSnapshotStatus) {
    context.addIssue({
      code: 'custom',
      path: ['providerPrincipalSnapshotStatus'],
      message: 'Project view must report whether the current global Provider principal fact matches the Project snapshot.'
    })
  }
})
export type ProjectWorkerAvailabilityView = z.infer<typeof projectWorkerAvailabilityViewSchema>
