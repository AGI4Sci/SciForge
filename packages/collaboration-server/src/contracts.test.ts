import { describe, expect, it } from 'vitest'

import {
  projectContentProvisioningAttestationSchema,
  projectFinalSummarySchema
} from '@sciforge/collaboration-contracts'
import {
  TEST_HASH,
  TEST_IDS,
  TEST_LATER_TIMESTAMP,
  TEST_TIMESTAMP
} from '@sciforge/collaboration-contracts/testing'

import {
  toProjectContentProvisioningAttestation,
  toProjectFinalSummary
} from './contracts.js'

describe('Cloud-to-public collaboration projections', () => {
  it('projects a stored final summary through the strict public contract', () => {
    const projected = toProjectFinalSummary({
      projectId: TEST_IDS.projectId,
      projectRecordId: TEST_IDS.projectRecordId,
      projectPlanId: TEST_IDS.projectPlanId,
      confirmedPlanRevision: 2,
      acceptedResultSubmissionIds: [TEST_IDS.resultSubmissionId],
      summary: 'The exact accepted results complete the Project.',
      createdByUserId: TEST_IDS.userId,
      createdByCoordinatorAgentId: TEST_IDS.agentId,
      coordinatorAuthorityEpoch: 3,
      completedAt: TEST_LATER_TIMESTAMP,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    })

    expect(projectFinalSummarySchema.parse(projected)).toEqual(projected)
    expect(projected).not.toHaveProperty('coordinatorAuthorityEpoch')
  })

  it('reconstructs the fixed provisioning-attestation envelope omitted by storage', () => {
    const providerInstance = {
      schemaVersion: 1 as const,
      type: 'provider_instance_reference' as const,
      providerInstanceRef: 'opencontent.contract-test'
    }
    const projected = toProjectContentProvisioningAttestation({
      provisioningAttestationId: TEST_IDS.provisioningAttestationId,
      projectId: TEST_IDS.projectId,
      provisioningIntentId: TEST_IDS.provisioningIntentId,
      provisioningRevision: 2,
      ownerUserId: TEST_IDS.userId,
      principalIdentityRevision: 1,
      providerBindingAttestationDigest: TEST_HASH,
      providerInstance,
      rootLocator: {
        contractVersion: 1,
        kind: 'content-space.container-reference',
        authority: 'opencontent.contract-test',
        identity: { containerId: 'contract-test-root' }
      },
      rootLocatorDigest: TEST_HASH,
      observedOperations: [{
        operationId: 'contract-test-create-root',
        operationRevision: 3,
        kind: 'create_shared_container',
        subjectPrincipal: null,
        requestDigest: TEST_HASH,
        receiptDigest: TEST_HASH,
        outcome: 'observed_success',
        safeFailureCode: null,
        observedAt: TEST_TIMESTAMP
      }],
      memberObservations: [{
        userId: TEST_IDS.userId,
        providerPrincipalFactId: TEST_IDS.providerPrincipalFactId,
        snapshottedFactRevision: 1,
        principal: {
          schemaVersion: 1,
          type: 'provider_directory_principal_reference',
          providerInstance,
          principalKind: 'user',
          principalId: 'contract-test-owner'
        },
        presence: 'present',
        observationDigest: TEST_HASH,
        observedAt: TEST_LATER_TIMESTAMP
      }],
      memberSetDigest: TEST_HASH,
      observationStartedAt: TEST_TIMESTAMP,
      observationCompletedAt: TEST_LATER_TIMESTAMP,
      deviceSignature: {
        purpose: 'project-content-provisioning-attestation',
        userId: TEST_IDS.userId,
        deviceId: TEST_IDS.deviceId,
        deviceKeyId: 'contract-test-key',
        deviceKeyRevision: 2,
        signatureAlgorithm: 'Ed25519',
        canonicalPayloadDigest: TEST_HASH,
        factRevision: 2,
        observedAt: TEST_LATER_TIMESTAMP,
        issuedAt: TEST_LATER_TIMESTAMP,
        signature: 'A'.repeat(86)
      },
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    })

    expect(projected.format).toBe('sciforge.project-content-provisioning-attestation.v1')
    expect(projectContentProvisioningAttestationSchema.parse(projected)).toEqual(projected)
  })
})
