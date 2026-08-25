import { describe, expect, it } from 'vitest'

import {
  projectMembershipSchema,
  projectWorkerAvailabilityViewSchema,
  taskAuthoritySchema,
  workerAvailabilityProjectionSchema
} from './project-coordination.js'
import { projectContentReadinessSchema } from './project-content.js'
import { TEST_HASH, TEST_IDS, TEST_LATER_TIMESTAMP, TEST_TIMESTAMP } from './testing.js'

const metadata = {
  schemaVersion: 1 as const,
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
}

const providerInstance = {
  schemaVersion: 1 as const,
  type: 'provider_instance_reference' as const,
  authority: 'provider.instance.alpha',
  instanceId: 'instance-alpha'
}

const activeMembership = projectMembershipSchema.parse({
  ...metadata,
  type: 'project_membership',
  projectMembershipId: TEST_IDS.projectMembershipId,
  projectId: TEST_IDS.projectId,
  userId: TEST_IDS.userId,
  state: 'active',
  authorityEpoch: 2,
  activatedAt: TEST_TIMESTAMP,
  removalRequestedAt: null,
  removalRequestedByUserId: null,
  removedAt: null
})

const globalAvailability = workerAvailabilityProjectionSchema.parse({
  ...metadata,
  type: 'worker_availability_projection',
  userId: TEST_IDS.userId,
  agentId: TEST_IDS.agentId,
  deviceId: TEST_IDS.deviceId,
  agentActive: true,
  deviceActive: true,
  connectionStatus: 'online',
  lastHeartbeatAt: TEST_TIMESTAMP,
  runtimeReadiness: 'ready',
  runtimeCapabilityTags: ['runtime.text', 'runtime.files'],
  acceptsNewOffers: true,
  activeTaskCount: 0,
  observedAt: TEST_TIMESTAMP,
  expiresAt: TEST_LATER_TIMESTAMP
})

const textAuthority = taskAuthoritySchema.parse({
  ...metadata,
  type: 'task_authority',
  taskAuthorityId: TEST_IDS.taskAuthorityId,
  projectId: TEST_IDS.projectId,
  userId: TEST_IDS.userId,
  scope: 'text_tasks',
  state: 'eligible',
  authorityEpoch: 2,
  reason: null,
  effectiveAt: TEST_TIMESTAMP
})

describe('orthogonal Project collaboration authority', () => {
  it('retains activation history throughout removal pending and removed states', () => {
    const pendingRemoval = projectMembershipSchema.parse({
      ...activeMembership,
      state: 'membership_removal_pending',
      authorityEpoch: 3,
      removalRequestedAt: TEST_LATER_TIMESTAMP,
      removalRequestedByUserId: TEST_IDS.userId
    })
    expect(pendingRemoval.activatedAt).toBe(TEST_TIMESTAMP)

    const removed = projectMembershipSchema.parse({
      ...pendingRemoval,
      state: 'removed',
      removedAt: '2026-08-15T08:02:00.000Z'
    })
    expect(removed.activatedAt).toBe(TEST_TIMESTAMP)
    expect(projectMembershipSchema.safeParse({
      ...removed,
      activatedAt: null
    }).success).toBe(false)
  })

  it('keeps durable Task Authority at Project + User with two non-overlapping scopes', () => {
    expect(textAuthority.userId).toBe(TEST_IDS.userId)
    expect(taskAuthoritySchema.safeParse({ ...textAuthority, scope: 'all_tasks' }).success).toBe(false)
    expect(taskAuthoritySchema.safeParse({
      ...textAuthority,
      subject: { kind: 'agent', userId: TEST_IDS.userId, agentId: TEST_IDS.agentId }
    }).success).toBe(false)
    expect(taskAuthoritySchema.safeParse({
      ...textAuthority,
      state: 'fenced',
      reason: 'membership_removal_pending',
      authorityEpoch: 3
    }).success).toBe(true)
  })

  it('keeps global availability Project-independent and composes Project readiness in a view', () => {
    expect(workerAvailabilityProjectionSchema.safeParse({
      ...globalAvailability,
      projectId: TEST_IDS.projectId
    }).success).toBe(false)

    const readiness = projectContentReadinessSchema.parse({
      ...metadata,
      type: 'project_content_readiness',
      projectId: TEST_IDS.projectId,
      userId: TEST_IDS.userId,
      providerInstance,
      state: 'missing_identity',
      reason: 'identity_missing',
      providerPrincipalFactId: null,
      snapshottedFactRevision: null,
      providerPrincipal: null,
      bindingRevision: null,
      lastObservationId: null,
      effectiveAt: TEST_TIMESTAMP
    })
    expect(projectWorkerAvailabilityViewSchema.safeParse({
      schemaVersion: 1,
      type: 'project_worker_availability_view',
      projectId: TEST_IDS.projectId,
      userId: TEST_IDS.userId,
      agentId: TEST_IDS.agentId,
      revision: 1,
      availability: globalAvailability,
      membership: activeMembership,
      taskAuthorities: [textAuthority],
      providerPrincipalFact: null,
      providerPrincipalSnapshotStatus: 'missing',
      contentReadiness: readiness,
      observedAt: TEST_TIMESTAMP
    }).success).toBe(true)
    expect(projectWorkerAvailabilityViewSchema.safeParse({
      schemaVersion: 1,
      type: 'project_worker_availability_view',
      projectId: TEST_IDS.projectId,
      userId: TEST_IDS.userId,
      agentId: TEST_IDS.agentId,
      revision: 1,
      availability: globalAvailability,
      membership: activeMembership,
      taskAuthorities: [textAuthority, { ...textAuthority, taskAuthorityId: 'tau_Duplicate0001' }],
      providerPrincipalFact: null,
      providerPrincipalSnapshotStatus: 'missing',
      contentReadiness: readiness,
      observedAt: TEST_TIMESTAMP
    }).success).toBe(false)
  })

  it('never reports offer intake when Device, Agent, connection or Runtime is unavailable', () => {
    expect(workerAvailabilityProjectionSchema.safeParse({
      ...globalAvailability,
      connectionStatus: 'offline',
      acceptsNewOffers: true
    }).success).toBe(false)
  })

  it('makes current global Provider fact drift explicit in the Project-scoped view', () => {
    const providerPrincipal = {
      schemaVersion: 1 as const,
      type: 'provider_directory_principal_reference' as const,
      providerInstance,
      principalKind: 'user' as const,
      principalId: 'principal-alpha'
    }
    const fact = {
      ...metadata,
      type: 'provider_directory_principal_fact' as const,
      providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
      userId: TEST_IDS.userId,
      providerPrincipal,
      principalIdentityRevision: 1,
      providerBindingAttestationDigest: TEST_HASH,
      publishedByDeviceId: TEST_IDS.deviceId,
      readiness: 'ready' as const,
      readinessReason: null,
      observedAt: TEST_TIMESTAMP
    }
    const readiness = projectContentReadinessSchema.parse({
      ...metadata,
      type: 'project_content_readiness',
      projectId: TEST_IDS.projectId,
      userId: TEST_IDS.userId,
      providerInstance,
      state: 'ready',
      reason: null,
      providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
      snapshottedFactRevision: 1,
      providerPrincipal,
      bindingRevision: 2,
      lastObservationId: TEST_IDS.providerObservationId,
      effectiveAt: TEST_TIMESTAMP
    })
    const view = {
      schemaVersion: 1 as const,
      type: 'project_worker_availability_view' as const,
      projectId: TEST_IDS.projectId,
      userId: TEST_IDS.userId,
      agentId: TEST_IDS.agentId,
      revision: 1,
      availability: globalAvailability,
      membership: activeMembership,
      taskAuthorities: [textAuthority],
      providerPrincipalFact: fact,
      providerPrincipalSnapshotStatus: 'match' as const,
      contentReadiness: readiness,
      observedAt: TEST_TIMESTAMP
    }
    expect(projectWorkerAvailabilityViewSchema.safeParse(view).success).toBe(true)
    expect(projectWorkerAvailabilityViewSchema.safeParse({
      ...view,
      providerPrincipalFact: { ...fact, revision: 2 }
    }).success).toBe(false)
    expect(projectWorkerAvailabilityViewSchema.safeParse({
      ...view,
      providerPrincipalFact: { ...fact, revision: 2 },
      providerPrincipalSnapshotStatus: 'stale'
    }).success).toBe(true)
  })
})
