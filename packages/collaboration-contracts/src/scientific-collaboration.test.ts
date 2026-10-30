import { describe, expect, it } from 'vitest'

import {
  approvedClaimSchema,
  canTransitionScientificResult,
  coordinatorReviewSchema,
  frozenManifestSchema,
  resultBundleSchema,
  requiredOutputsFromTaskFileIntent,
  requiredOutputsMatchTaskFileIntent,
  scientificDigest,
  scientificResultStateSnapshotSchema,
  stateTransitionSchema,
  taskContractRevisionSchema,
  taskContractSchema,
  legacyWorkerAttestationSchema
} from './index.js'
import { TEST_IDS, TEST_LATER_TIMESTAMP, TEST_TIMESTAMP } from './testing.js'

const providerInstanceRef = 'opencontent-primary'
const evidenceRefId = 'evr_Evidence00001'
const claimId = 'clm_Claim0000001'
const interventionId = 'int_Intervention01'
const attestationId = 'wra_Attestation0001'

const contractPayload = {
  schemaVersion: 1 as const,
  type: 'task_contract' as const,
  projectId: TEST_IDS.projectId,
  taskId: TEST_IDS.taskId,
  contractRevision: 1,
  objective: 'Quantify the treatment response in the sample cohort.',
  scientificScope: 'Use the frozen sample table and report the pre-registered endpoint.',
  scientificInputVersions: [{ kind: 'material_revision' as const, referenceId: 'mat_FrozenInput001', revision: 1, digest: 'a'.repeat(64) }],
  constraints: ['Use the pre-registered statistical test.'],
  acceptanceCriteria: ['Report the effect size and uncertainty with cited evidence.'],
  requiredOutputs: [{
    outputKey: 'analysis-table',
    kind: 'table' as const,
    description: 'The final analysis table.'
  }]
}

const evidenceRef = {
  kind: 'immutable_version' as const,
  evidenceRefId,
  providerInstanceRef,
  immutableResourceReference: 'team-file:sample-table',
  immutableVersionId: 'version-0001',
  contentDigest: 'a'.repeat(64),
  proof: {
    immutableIdentity: true as const,
    retentionGuaranteed: true as const,
    versionSpecificRetrieval: true as const,
    byteStable: true as const,
    observedAt: TEST_TIMESTAMP
  }
}

const claim = {
  claimId,
  type: 'quantitative' as const,
  statement: 'The treatment increased the endpoint by 12 percent.',
  evidenceRefIds: [evidenceRefId]
}

function resultBundle() {
  const payload = {
    schemaVersion: 1 as const,
    type: 'result_bundle' as const,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    resultSubmissionId: TEST_IDS.resultSubmissionId,
    contractRevision: 1,
    resultRevision: 1,
    summary: 'The treatment increased the endpoint in the frozen cohort.',
    claims: [claim],
    evidenceRefs: [evidenceRef],
    interventions: [{
      interventionId,
      kind: 'other' as const,
      description: 'Recorded the final analysis interpretation.',
      affectedClaimIds: [claimId]
    }]
  }
  return { ...payload, bundleDigest: scientificDigest(payload) }
}

describe('scientific collaboration contracts', () => {
  it('binds Task Contract and frozen manifest digests to immutable material fields', () => {
    const contract = taskContractSchema.parse({
      ...contractPayload,
      contractDigest: scientificDigest(contractPayload)
    })
    expect(taskContractRevisionSchema.safeParse({
      schemaVersion: 1,
      type: 'task_contract_revision',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      contract,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    }).success).toBe(true)
    expect(taskContractSchema.safeParse({
      ...contract,
      objective: 'A changed objective'
    }).success).toBe(false)

    const manifestEntries = [{
      providerInstanceRef,
      immutableResourceReference: 'team-file:sample-table',
      immutableVersionId: 'version-0001',
      contentDigest: 'a'.repeat(64)
    }]
    expect(frozenManifestSchema.safeParse({
      entries: manifestEntries,
      manifestDigest: scientificDigest(manifestEntries)
    }).success).toBe(true)
    expect(frozenManifestSchema.safeParse({
      entries: manifestEntries,
      manifestDigest: 'b'.repeat(64)
    }).success).toBe(false)
  })

  it('requires every material Claim to cite a Bundle EvidenceRef and keeps Bundles append-only', () => {
    const bundle = resultBundle()
    expect(resultBundleSchema.safeParse(bundle).success).toBe(true)
    expect(resultBundleSchema.safeParse({
      ...bundle,
      claims: [{ ...claim, evidenceRefIds: ['evr_MissingEvidence'] }],
      bundleDigest: scientificDigest({
        ...bundle,
        claims: [{ ...claim, evidenceRefIds: ['evr_MissingEvidence'] }]
      })
    }).success).toBe(false)
    const duplicateEvidencePayload = {
      ...bundle,
      evidenceRefs: [evidenceRef, { ...evidenceRef, proof: { ...evidenceRef.proof } }]
    }
    expect(resultBundleSchema.safeParse({
      ...duplicateEvidencePayload,
      bundleDigest: scientificDigest(duplicateEvidencePayload)
    }).success).toBe(false)
    expect(resultBundleSchema.safeParse({
      ...bundle,
      summary: 'mutated after attestation'
    }).success).toBe(false)
  })

  it('maps one file intent to one canonical required output and rejects divergent output rules', () => {
    const intent = {
      schemaVersion: 2 as const,
      inputs: [],
      dependencyInputs: [],
      output: {
        kind: 'delivery.output' as const,
        fileName: 'analysis.csv', mediaType: 'text/csv', maxBytes: 123_456
      }
    }
    const outputs = requiredOutputsFromTaskFileIntent(intent)
    expect(outputs).toEqual([expect.objectContaining({
      outputKey: 'primary-file', kind: 'file', fileName: 'analysis.csv',
      mediaType: 'text/csv', maxBytes: 123_456
    })])
    expect(requiredOutputsMatchTaskFileIntent(outputs, intent)).toBe(true)
    const divergentPayload = {
      ...contractPayload,
      requiredOutputs: [{ ...outputs[0]!, fileName: 'other.csv' }]
    }
    expect(taskContractSchema.safeParse({
      ...divergentPayload,
      contractDigest: scientificDigest(divergentPayload)
    }).success).toBe(true)
    expect(requiredOutputsMatchTaskFileIntent(divergentPayload.requiredOutputs, intent)).toBe(false)
  })

  it('keeps the historical Worker attestation and Coordinator decision chain read-only', () => {
    const bundle = resultBundle()
    const attestationPayload = {
      schemaVersion: 1 as const,
      type: 'worker_attestation' as const,
      attestationId,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      resultSubmissionId: TEST_IDS.resultSubmissionId,
      workerUserId: TEST_IDS.secondUserId,
      attestedByUserId: TEST_IDS.secondUserId,
      contractRevision: 1,
      resultRevision: 1,
      bundleDigest: bundle.bundleDigest,
      attestedAt: TEST_TIMESTAMP
    }
    const attestation = {
      ...attestationPayload,
      attestationDigest: scientificDigest(attestationPayload),
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    }
    expect(legacyWorkerAttestationSchema.safeParse(attestation).success).toBe(true)
    expect(legacyWorkerAttestationSchema.safeParse({
      ...attestation,
      attestedByUserId: TEST_IDS.userId
    }).success).toBe(false)

    const reviewPayload = {
      schemaVersion: 1 as const,
      type: 'coordinator_review' as const,
      reviewDecisionId: TEST_IDS.reviewDecisionId,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      resultSubmissionId: TEST_IDS.resultSubmissionId,
      workerAttestationId: attestationId,
      contractRevision: 1,
      resultRevision: 1,
      bundleDigest: bundle.bundleDigest,
      decision: 'approved' as const,
      reviewedByUserId: TEST_IDS.userId,
      instruction: null,
      reviewedAt: TEST_LATER_TIMESTAMP
    }
    const review = {
      ...reviewPayload,
      reviewDigest: scientificDigest(reviewPayload),
      revision: 1,
      createdAt: TEST_LATER_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP
    }
    expect(coordinatorReviewSchema.safeParse(review).success).toBe(true)

    const approvedPayload = {
      schemaVersion: 1 as const,
      type: 'approved_claim' as const,
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      resultSubmissionId: TEST_IDS.resultSubmissionId,
      workerUserId: TEST_IDS.secondUserId,
      contractRevision: 1,
      resultRevision: 1,
      claim,
      evidenceRefs: [evidenceRef],
      workerAttestationId: attestationId,
      attestationDigest: attestation.attestationDigest,
      coordinatorReviewId: TEST_IDS.reviewDecisionId,
      reviewDigest: review.reviewDigest,
      approvedByUserId: TEST_IDS.userId,
      approvedAt: TEST_LATER_TIMESTAMP
    }
    expect(approvedClaimSchema.safeParse({
      ...approvedPayload,
      approvalDigest: scientificDigest(approvedPayload)
    }).success).toBe(true)
  })

  it('exposes the result correction transition without changing Contract or Execution identity', () => {
    expect(canTransitionScientificResult('submitted', 'revision_requested')).toBe(true)
    expect(canTransitionScientificResult('revision_requested', 'submitted')).toBe(true)
    expect(canTransitionScientificResult('approved', 'submitted')).toBe(false)
    expect(scientificResultStateSnapshotSchema.safeParse({
      schemaVersion: 1,
      type: 'scientific_result_state',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      contractRevision: 1,
      resultRevision: 1,
      state: 'revision_requested',
      currentResultSubmissionId: TEST_IDS.resultSubmissionId
    }).success).toBe(true)
    expect(stateTransitionSchema.safeParse({
      machine: 'scientific_result',
      from: 'submitted',
      to: 'revision_requested'
    }).success).toBe(true)
  })
})
