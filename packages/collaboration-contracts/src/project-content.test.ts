import { describe, expect, it } from 'vitest'

import {
  canonicalProvisionedMemberSetBytes,
  canonicalProjectContentProvisioningAttestationFactualPayloadBytes,
  externalOperationRecoveryJournalEntrySchema,
  projectContentProvisioningAttestationSchema,
  projectContentProvisioningIntentSchema,
  providerDirectoryPrincipalFactSchema,
  providerDirectoryPrincipalReferenceSchema
} from './project-content.js'
import { restRequestSchema, restResponseSchema } from './protocol.js'
import { projectCreateIncludesAuthenticatedOwner } from './cloud-state-protocol.js'
import { TEST_HASH, TEST_IDS, TEST_LATER_TIMESTAMP, TEST_TIMESTAMP, projectFixture } from './testing.js'

const providerInstance = {
  schemaVersion: 1 as const,
  type: 'provider_instance_reference' as const,
  providerInstanceRef: 'provider-instance-alpha'
}
const ownerPrincipal = {
  schemaVersion: 1 as const,
  type: 'provider_directory_principal_reference' as const,
  providerInstance,
  principalKind: 'user' as const,
  principalId: 'principal-owner-alpha'
}
const rootLocator = {
  contractVersion: 1 as const,
  kind: 'content-space.container-reference' as const,
  authority: 'provider.instance.alpha',
  identity: { containerId: 'shared-root-alpha' }
}

const attestation = {
  schemaVersion: 1 as const,
  type: 'project_content_provisioning_attestation' as const,
  format: 'sciforge.project-content-provisioning-attestation.v1' as const,
  provisioningAttestationId: TEST_IDS.provisioningAttestationId,
  projectId: TEST_IDS.projectId,
  provisioningIntentId: TEST_IDS.provisioningIntentId,
  provisioningRevision: 2,
  ownerUserId: TEST_IDS.userId,
  principalIdentityRevision: 3,
  providerBindingAttestationDigest: TEST_HASH,
  providerInstance,
  rootLocator,
  rootLocatorDigest: TEST_HASH,
  observedOperations: [{
    operationId: 'operation-create-root-01',
    operationRevision: 1,
    kind: 'create_shared_container' as const,
    subjectPrincipal: null,
    requestDigest: TEST_HASH,
    receiptDigest: TEST_HASH,
    outcome: 'observed_success' as const,
    safeFailureCode: null,
    observedAt: TEST_TIMESTAMP
  }],
  memberObservations: [{
    userId: TEST_IDS.userId,
    providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
    snapshottedFactRevision: 1,
    principal: ownerPrincipal,
    presence: 'present' as const,
    observationDigest: TEST_HASH,
    observedAt: TEST_LATER_TIMESTAMP
  }],
  memberSetDigest: TEST_HASH,
  observationStartedAt: TEST_TIMESTAMP,
  observationCompletedAt: TEST_LATER_TIMESTAMP,
  deviceSignature: {
    purpose: 'project-content-provisioning-attestation' as const,
    userId: TEST_IDS.userId,
    deviceId: TEST_IDS.deviceId,
    deviceKeyId: 'device-key-alpha',
    deviceKeyRevision: 2,
    signatureAlgorithm: 'Ed25519' as const,
    canonicalPayloadDigest: TEST_HASH,
    factRevision: 2,
    observedAt: TEST_LATER_TIMESTAMP,
    issuedAt: '2026-08-15T08:02:00.000Z',
    signature: 'A'.repeat(86)
  },
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
}

describe('Project content provisioning facts', () => {
  it('uses the canonical opaque Provider Instance Ref as its single non-authorizing identity', () => {
    expect(providerDirectoryPrincipalReferenceSchema.parse(ownerPrincipal).providerInstance)
      .toEqual(providerInstance)
    expect(providerDirectoryPrincipalReferenceSchema.safeParse({
      ...ownerPrincipal,
      providerInstance: {
        schemaVersion: 1,
        type: 'provider_instance_reference',
        authority: 'provider.instance.alpha',
        instanceId: 'instance-alpha'
      }
    }).success).toBe(false)
  })

  it('publishes one global non-authoritative User + Provider Instance principal fact before Project creation', () => {
    const fact = providerDirectoryPrincipalFactSchema.parse({
      schemaVersion: 1,
      type: 'provider_directory_principal_fact',
      providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
      userId: TEST_IDS.userId,
      providerPrincipal: ownerPrincipal,
      principalIdentityRevision: 3,
      providerBindingAttestationDigest: TEST_HASH,
      publishedByDeviceId: TEST_IDS.deviceId,
      readiness: 'ready',
      readinessReason: null,
      observedAt: TEST_TIMESTAMP,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    })
    expect(JSON.stringify(fact)).not.toMatch(/credential|token|authorization|scope/iu)
    expect(providerDirectoryPrincipalFactSchema.safeParse({
      ...fact,
      providerAcl: ['read', 'write']
    }).success).toBe(false)

    const publish = {
      protocolVersion: '1.0',
      type: 'provider_directory_principal.publish',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_principal_publish_001',
      providerPrincipalFactId: null,
      expectedFactRevision: null,
      deviceId: TEST_IDS.deviceId,
      expectedDeviceRevision: 2,
      providerPrincipal: ownerPrincipal,
      principalIdentityRevision: 3,
      providerBindingAttestationDigest: TEST_HASH,
      readiness: 'ready',
      readinessReason: null,
      observedAt: TEST_TIMESTAMP
    }
    expect(restRequestSchema.safeParse(publish).success).toBe(true)
    expect(restRequestSchema.safeParse({
      ...publish,
      providerPrincipalFactId: TEST_IDS.providerPrincipalFactId
    }).success).toBe(false)
    expect(restRequestSchema.safeParse({ ...publish, projectId: TEST_IDS.projectId }).success).toBe(false)
    expect(restRequestSchema.safeParse({
      protocolVersion: '1.0',
      type: 'provider_directory_principal.list',
      requestId: TEST_IDS.requestId,
      userIds: [TEST_IDS.userId],
      providerInstance,
      includeDegraded: false,
      limit: 100
    }).success).toBe(true)
    expect(restResponseSchema.safeParse({
      protocolVersion: '1.0',
      type: 'rest.provider_directory_principal_page',
      requestId: TEST_IDS.requestId,
      items: [fact]
    }).success).toBe(true)
  })

  it('creates a content-required Project from one canonical member/fact roster and no caller-nominated Owner', () => {
    const request = {
      protocolVersion: '1.0',
      type: 'project.create',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_project_create_0001',
      displayName: 'Meeting PoC',
      goal: 'Complete one real multi-user meeting loop.',
      coordinatorAgentId: TEST_IDS.agentId,
      expectedCoordinatorAgentRevision: 4,
      budget: {
        maxTasks: 20,
        maxTasksPerRound: 5,
        maxCoordinationRounds: 10,
        maxTaskRetries: 2
      },
      content: {
        mode: 'required',
        contentOwnerUserId: TEST_IDS.userId,
        providerInstance,
        containerDisplayName: 'Meeting PoC Team Library',
        members: [{
          userId: TEST_IDS.userId,
          providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
          expectedFactRevision: 1
        }, {
          userId: TEST_IDS.secondUserId,
          providerPrincipalFactId: 'ppf_Principal00002',
          expectedFactRevision: 2
        }]
      }
    }
    const parsed = restRequestSchema.parse(request)
    if (parsed.type !== 'project.create') throw new Error('Expected canonical Project create command.')
    expect(projectCreateIncludesAuthenticatedOwner(parsed, TEST_IDS.userId)).toBe(true)
    expect(projectCreateIncludesAuthenticatedOwner(parsed, 'usr_NotAMember0001')).toBe(false)
    expect(restRequestSchema.safeParse({ ...request, ownerUserId: TEST_IDS.userId }).success).toBe(false)
    expect(restRequestSchema.safeParse({ ...request, memberUserIds: [TEST_IDS.userId] }).success).toBe(false)
    expect(restRequestSchema.safeParse({
      ...request,
      content: {
        ...request.content,
        contentOwnerUserId: 'usr_NotAMember0001'
      }
    }).success).toBe(false)

    const createdWithoutEmptyBinding = {
      protocolVersion: '1.0',
      type: 'rest.project_created',
      requestId: TEST_IDS.requestId,
      project: { ...projectFixture, status: 'paused', contentMode: 'none' },
      memberships: [{
        schemaVersion: 1,
        type: 'project_membership',
        projectMembershipId: TEST_IDS.projectMembershipId,
        projectId: TEST_IDS.projectId,
        userId: TEST_IDS.userId,
        state: 'active',
        authorityEpoch: 1,
        activatedAt: TEST_TIMESTAMP,
        removalRequestedAt: null,
        removalRequestedByUserId: null,
        removedAt: null,
        revision: 1,
        createdAt: TEST_TIMESTAMP,
        updatedAt: TEST_TIMESTAMP
      }],
      provisioningIntent: null
    }
    expect(restResponseSchema.safeParse(createdWithoutEmptyBinding).success).toBe(true)
    expect(restResponseSchema.safeParse({
      ...createdWithoutEmptyBinding,
      contentBinding: null
    }).success).toBe(false)
  })

  it('keeps Provider principal references opaque and free of inferred identity fields', () => {
    expect(providerDirectoryPrincipalReferenceSchema.parse(ownerPrincipal)).toEqual(ownerPrincipal)
    expect(providerDirectoryPrincipalReferenceSchema.safeParse({
      ...ownerPrincipal,
      email: 'owner@example.invalid'
    }).success).toBe(false)
    expect(providerDirectoryPrincipalReferenceSchema.safeParse({
      ...ownerPrincipal,
      providerCredential: 'forbidden'
    }).success).toBe(false)
  })

  it('requires an exact desired Provider member set in a durable provisioning intent', () => {
    const intent = projectContentProvisioningIntentSchema.parse({
      schemaVersion: 1,
      type: 'project_content_provisioning_intent',
      provisioningIntentId: TEST_IDS.provisioningIntentId,
      projectId: TEST_IDS.projectId,
      provisioningRevision: 2,
      kind: 'initial_provisioning',
      state: 'pending',
      createdByOwnerUserId: TEST_IDS.userId,
      contentOwnerUserId: TEST_IDS.userId,
      providerInstance,
      desiredMembers: [{
        userId: TEST_IDS.userId,
        providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
        snapshottedFactRevision: 1,
        principal: ownerPrincipal
      }],
      containerDisplayName: 'Design Review Project',
      currentRootLocator: null,
      currentBindingRevision: null,
      intentDigest: TEST_HASH,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    })
    expect(intent.desiredMembers).toHaveLength(1)
    expect(projectContentProvisioningIntentSchema.safeParse({
      ...intent,
      desiredMembers: []
    }).success).toBe(false)
  })

  it('reuses the Identity Device signature metadata and canonicalizes only factual payload', () => {
    const parsed = projectContentProvisioningAttestationSchema.parse(attestation)
    const first = canonicalProjectContentProvisioningAttestationFactualPayloadBytes(parsed)
    const second = canonicalProjectContentProvisioningAttestationFactualPayloadBytes(parsed)
    expect(first).toEqual(second)
    const canonicalText = new TextDecoder().decode(first)
    expect(canonicalText).not.toContain('deviceSignature')
    expect(canonicalText).not.toContain(parsed.deviceSignature.signature)
    expect(projectContentProvisioningAttestationSchema.safeParse({
      ...attestation,
      signature: attestation.deviceSignature.signature
    }).success).toBe(false)
    expect(projectContentProvisioningAttestationSchema.safeParse({
      ...attestation,
      deviceSignature: { ...attestation.deviceSignature, userId: TEST_IDS.secondUserId }
    }).success).toBe(false)
  })

  it('freezes one User-sorted canonical member-set byte vector without hashing in contracts', () => {
    const ownerObservation = attestation.memberObservations[0]
    expect(ownerObservation).toBeDefined()
    if (ownerObservation === undefined) throw new Error('Fixture must contain the Owner observation.')
    const workerPrincipal = {
      ...ownerPrincipal,
      principalId: 'principal-worker-alpha'
    }
    const members = [
      {
        userId: TEST_IDS.secondUserId,
        providerPrincipalFactId: 'ppf_Principal00002',
        snapshottedFactRevision: 2,
        principal: workerPrincipal,
        presence: 'absent' as const,
        observationDigest: TEST_HASH,
        observedAt: TEST_LATER_TIMESTAMP
      },
      ownerObservation
    ]
    const first = canonicalProvisionedMemberSetBytes(members)
    const second = canonicalProvisionedMemberSetBytes([...members].reverse())
    expect(first).toEqual(second)
    expect(new TextDecoder().decode(first)).toBe(
      `[{"observationDigest":"${TEST_HASH}","observedAt":"${TEST_LATER_TIMESTAMP}","presence":"present","principal":{"principalId":"principal-owner-alpha","principalKind":"user","providerInstance":{"providerInstanceRef":"provider-instance-alpha","schemaVersion":1,"type":"provider_instance_reference"},"schemaVersion":1,"type":"provider_directory_principal_reference"},"providerPrincipalFactId":"${TEST_IDS.providerPrincipalFactId}","snapshottedFactRevision":1,"userId":"${TEST_IDS.userId}"},{"observationDigest":"${TEST_HASH}","observedAt":"${TEST_LATER_TIMESTAMP}","presence":"absent","principal":{"principalId":"principal-worker-alpha","principalKind":"user","providerInstance":{"providerInstanceRef":"provider-instance-alpha","schemaVersion":1,"type":"provider_instance_reference"},"schemaVersion":1,"type":"provider_directory_principal_reference"},"providerPrincipalFactId":"ppf_Principal00002","snapshottedFactRevision":2,"userId":"${TEST_IDS.secondUserId}"}]`
    )
    expect(() => canonicalProvisionedMemberSetBytes([
      ownerObservation,
      { ...ownerObservation, providerPrincipalFactId: 'ppf_Principal00002' }
    ])).toThrow()
  })

  it('can attest exact Provider member removal without exposing a finalize command', () => {
    expect(projectContentProvisioningAttestationSchema.safeParse({
      ...attestation,
      observedOperations: [{
        ...attestation.observedOperations[0],
        operationId: 'operation-remove-member-01',
        kind: 'remove_member',
        subjectPrincipal: ownerPrincipal
      }],
      memberObservations: [{
        ...attestation.memberObservations[0],
        presence: 'absent'
      }]
    }).success).toBe(true)
  })
})

describe('durable external operation recovery journal', () => {
  const dispatched = {
    schemaVersion: 1 as const,
    type: 'external_operation_recovery_journal_entry' as const,
    contentRecoveryJournalEntryId: TEST_IDS.contentRecoveryJournalEntryId,
    scope: 'task_content_transfer' as const,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    preparedTaskRevision: 2,
    preparedExecutionRevision: 3,
    provisioningIntentId: null,
    provisioningRevision: null,
    logicalInvocationId: 'upload-invocation-01',
    operation: 'upload_new' as const,
    state: 'dispatched' as const,
    requestDigest: TEST_HASH,
    receiptDigest: null,
    observationDigest: null,
    safeFailureCode: null,
    preparedAt: TEST_TIMESTAMP,
    dispatchedAt: TEST_LATER_TIMESTAMP,
    resolvedAt: null,
    revision: 2,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_LATER_TIMESTAMP
  }

  it('keeps uncertain writes unresolved until exact observation or abandonment', () => {
    expect(externalOperationRecoveryJournalEntrySchema.safeParse(dispatched).success).toBe(true)
    expect(externalOperationRecoveryJournalEntrySchema.safeParse({
      ...dispatched,
      state: 'outcome_unknown',
      safeFailureCode: 'provider.transport_lost'
    }).success).toBe(true)
    expect(externalOperationRecoveryJournalEntrySchema.safeParse({
      ...dispatched,
      state: 'observed_success'
    }).success).toBe(false)
  })
})
