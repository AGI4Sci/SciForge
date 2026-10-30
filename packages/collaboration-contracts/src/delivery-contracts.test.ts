import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto'
import { canonicalizeJson } from '@sciforge/domain-sdk/canonical-json'
import { describe, expect, it } from 'vitest'

import {
  agentInboxPayloadSchema,
  canonicalDeviceFactAttestationBytes,
  canonicalScientificJson,
  cloudResourceRefSchema,
  deliveryCandidateHistorySchema,
  deliveryCandidateSchema,
  deliveryBundleSummarySchema,
  objectReadQuerySchema,
  exactContractInputReferenceSchema,
  exactContractInputReferenceHistorySchema,
  frozenDeliveryBundleSchema,
  frozenDeliveryBundleDigest,
  canonicalFrozenDeliveryBundleBytes,
  deliveryCandidateObjectIds,
  deliveryCandidateReviewCommandSchema,
  deliveryManifestSealCommandSchema,
  deliveryRevisionRecordSchema,
  deviceFactHumanConfirmationSchema,
  humanActionConfirmationSchema,
  projectCompletionHumanActionFactDigest,
  projectCompletionTargetDigest,
  projectFinalSummarySubmitCommandSchema,
  restRequestSchema,
  scientificDigest,
  taskFileIntentSchema,
  taskDeliveryBadgeSchema,
  dashboardTaskCardSchema,
  workerDeliveryConfirmationDigest,
  workerDeliveryHumanActionFactDigest,
  workerDeliveryHumanActionProofSchema,
  type HumanActionConfirmation,
  type ProjectCompletionTarget,
  type WorkerDeliveryConfirmationTarget
} from './index.js'
import { TEST_IDS, TEST_TIMESTAMP } from './testing.js'

const target: WorkerDeliveryConfirmationTarget = {
  projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
  contractRevision: 1, resultRevision: 2, bundleDigest: 'a'.repeat(64), decision: 'approved'
}
const action: HumanActionConfirmation = {
  actionId: 'human_action_delivery_001', interaction: 'explicit_click', occurredAt: TEST_TIMESTAMP,
  confirmedInputDigest: workerDeliveryConfirmationDigest(target), sourceMessageDigest: null
}
const key = generateKeyPairSync('ed25519')
function signature(factDigest: string, purpose: 'worker-delivery-review' | 'project-completion-approval', revision: number) {
  const facts = {
    purpose, userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId,
    deviceKeyId: 'device-key-01', deviceKeyRevision: 1,
    canonicalPayloadDigest: factDigest, factRevision: revision,
    observedAt: TEST_TIMESTAMP, issuedAt: TEST_TIMESTAMP
  }
  return {
    ...facts, signatureAlgorithm: 'Ed25519' as const,
    signature: sign(null, canonicalDeviceFactAttestationBytes(facts), key.privateKey).toString('base64url')
  }
}
function proof() {
  return { ...action, deviceSignature: signature(workerDeliveryHumanActionFactDigest(target, action), 'worker-delivery-review', target.resultRevision) }
}
const envelope = { protocolVersion: '1.0', requestId: TEST_IDS.requestId, idempotencyKey: 'idem_delivery_contract_001' }

const candidate = {
  candidateId: 'candidate_review_001', projectId: target.projectId, taskId: target.taskId,
  executionId: target.executionId, workerUserId: TEST_IDS.userId,
  contractRevision: 1, resultRevision: 2, bundleDigest: target.bundleDigest,
  bundleObjectId: 'obj_DeliveryBundle01', outputObjectIds: ['obj_DeliveryObject01'],
  outputs: [{ objectId: 'obj_DeliveryObject01', fileName: 'result.txt', relativePath: 'result.txt',
    role: 'declared', source: 'ai', mediaType: 'text/plain', byteCount: 42, sha256: 'd'.repeat(64) }],
  status: 'private', createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP
}

describe('single Delivery authority contract', () => {
  it('rejects complete legacy submit and review requests', () => {
    const submit = { ...envelope, type: 'task.result.submit', taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
      expectedTaskRevision: 2, expectedExecutionRevision: 2, summary: 'Legacy completed work',
      runtimeProvenance: { runtimeId: 'runtime_legacy', modelId: null, startedAt: TEST_TIMESTAMP, completedAt: TEST_TIMESTAMP },
      outputs: [], recoveryJournalEntryIds: [], submissionDigest: 'a'.repeat(64) }
    const review = { ...envelope, type: 'task.result.review', projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId, resultSubmissionId: TEST_IDS.resultSubmissionId,
      expectedProjectRevision: 1, expectedTaskRevision: 2, expectedExecutionRevision: 2, expectedResultRevision: 1,
      expectedCoordinatorAuthorityEpoch: 1, decision: 'accept', instruction: null, nextWorkerUserId: null,
      nextOfferExpiresAt: null, nextFileIntent: null }
    expect(restRequestSchema.safeParse(submit).success).toBe(false)
    expect(restRequestSchema.safeParse(review).success).toBe(false)
  })

  it('rejects the removed result event and unbacked delivery badge', () => {
    expect(agentInboxPayloadSchema.safeParse({ protocolVersion: '1.0', type: 'task.result.submitted',
      projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
      resultSubmissionId: TEST_IDS.resultSubmissionId, revision: 1 }).success).toBe(false)
    expect(taskDeliveryBadgeSchema.safeParse('integrating').success).toBe(false)
    expect(dashboardTaskCardSchema.shape.primaryAction.safeParse('review_delivery').success).toBe(false)
  })

  it('separates readable old candidates from eligible new writes', () => {
    expect(deliveryCandidateSchema.safeParse(candidate).success).toBe(true)
    const { bundleObjectId: _bundleObjectId, outputObjectIds: _outputObjectIds, outputs: _outputs, ...facts } = candidate
    const legacy = { ...facts, objectIds: ['obj_DeliveryObject01'], bundleDigest: null }
    expect(deliveryCandidateHistorySchema.safeParse(legacy).success).toBe(true)
    expect(deliveryCandidateSchema.safeParse(legacy).success).toBe(false)
    expect(deliveryCandidateSchema.safeParse({ ...candidate, bundleDigest: null }).success).toBe(false)
  })

  it('binds frozen bundle bytes to exact identities and declared output digests', () => {
    const bundle = { schemaVersion: 2 as const, projectId: target.projectId, taskId: target.taskId,
      executionId: target.executionId, contractRevision: 1, resultRevision: 2,
      summary: 'Completed the control experiment.', outputs: [{ fileName: 'result.txt', relativePath: 'result.txt',
        role: 'declared' as const, source: 'ai' as const, mediaType: 'text/plain', byteCount: 42, sha256: 'd'.repeat(64) }] }
    const digest = frozenDeliveryBundleDigest(bundle)
    expect(digest).toBe(createHash('sha256').update(canonicalFrozenDeliveryBundleBytes(bundle)).digest('hex'))
    expect(frozenDeliveryBundleDigest({ ...bundle, executionId: 'exe_OtherExecution01' })).not.toBe(digest)
    expect(frozenDeliveryBundleDigest({ ...bundle, outputs: [{ ...bundle.outputs[0]!, sha256: 'e'.repeat(64) }] })).not.toBe(digest)
    expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, bundleDigest: digest }).success).toBe(false)
    expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, outputs: [bundle.outputs[0], bundle.outputs[0]] }).success).toBe(false)
    expect(deliveryCandidateObjectIds(deliveryCandidateSchema.parse(candidate))).toEqual(['obj_DeliveryBundle01', 'obj_DeliveryObject01'])
    expect(deliveryCandidateSchema.safeParse({ ...candidate, outputObjectIds: [candidate.bundleObjectId] }).success).toBe(false)
  })

  it('retains the full bounded report and rejects private Session material', () => {
    expect(deliveryBundleSummarySchema.parse('😀'.repeat(8_000))).toBe('😀'.repeat(8_000))
    expect(deliveryBundleSummarySchema.safeParse('😀'.repeat(8_001)).success).toBe(false)
    expect(deliveryBundleSummarySchema.safeParse('a'.repeat(8_001)).success).toBe(false)
    expect(deliveryBundleSummarySchema.safeParse('Private path: /home/local/report').success).toBe(false)
    expect(deliveryBundleSummarySchema.safeParse('Full transcript of the session').success).toBe(false)
  })

  it('does not treat an unadopted manifest as an authorized scientific input', () => {
    const ref = { kind: 'delivery_manifest', referenceId: 'mft_Historical001', revision: 1, digest: 'e'.repeat(64) }
    expect(exactContractInputReferenceSchema.safeParse(ref).success).toBe(false)
    expect(exactContractInputReferenceHistorySchema.parse(ref)).toEqual(ref)
    expect(exactContractInputReferenceSchema.safeParse({ ...ref, kind: 'project_result', referenceId: 'res_Result000001', objectId: 'obj_DeliveryObject01' }).success).toBe(true)
  })

  it('requires exactly one authorized object source on the byte read route', () => {
    const query = { projectId: TEST_IDS.projectId, objectId: 'obj_ReadObject001', deliveryManifestId: 'mft_ReadManifest01' }
    expect(objectReadQuerySchema.safeParse(query).success).toBe(true)
    expect(objectReadQuerySchema.safeParse({ projectId: query.projectId, objectId: query.objectId, materialRevisionId: 'mat_ReadMaterial01' }).success).toBe(true)
    expect(objectReadQuerySchema.safeParse({ ...query, materialRevisionId: 'mat_ReadMaterial01' }).success).toBe(false)
    expect(objectReadQuerySchema.safeParse({ projectId: query.projectId, objectId: query.objectId }).success).toBe(false)
  })

  it('requires a Device-signed human action instead of self-asserted fields', () => {
    const command = { ...envelope, type: 'delivery.candidate.review', candidateId: candidate.candidateId,
      resultRevision: 2, bundleDigest: target.bundleDigest, decision: 'approved', reason: null, humanAction: proof() }
    expect(deliveryCandidateReviewCommandSchema.safeParse(command).success).toBe(true)
    const { humanAction: _humanAction, ...unsigned } = command
    expect(deliveryCandidateReviewCommandSchema.safeParse({ ...unsigned, deviceId: TEST_IDS.deviceId,
      interaction: 'explicit_click', sourceMessageDigest: null }).success).toBe(false)
    expect(deliveryCandidateReviewCommandSchema.safeParse({ ...command, resultRevision: 3 }).success).toBe(false)
    expect(workerDeliveryHumanActionProofSchema.safeParse({ ...proof(), runtimeId: 'private-runtime' }).success).toBe(false)
  })

  it('binds the confirmation to one exact candidate target and human action', () => {
    expect(() => workerDeliveryHumanActionFactDigest({ ...target, resultRevision: 3 }, action)).toThrow(/exact Delivery target/u)
    expect(() => workerDeliveryHumanActionFactDigest({ ...target, decision: 'returned' }, action)).toThrow()
    expect(workerDeliveryHumanActionFactDigest(target, { ...action, actionId: 'another-human-action' }))
      .not.toBe(workerDeliveryHumanActionFactDigest(target, action))
    const signed = proof().deviceSignature
    expect(verify(null, canonicalDeviceFactAttestationBytes(signed), key.publicKey, Buffer.from(signed.signature, 'base64url'))).toBe(true)
    expect(verify(null, canonicalDeviceFactAttestationBytes({ ...signed, purpose: 'project-completion-approval' }),
      key.publicKey, Buffer.from(signed.signature, 'base64url'))).toBe(false)
  })

  it('requires a message digest only for a trusted Session confirmation', () => {
    expect(humanActionConfirmationSchema.safeParse({ ...action, interaction: 'session_message' }).success).toBe(false)
    expect(humanActionConfirmationSchema.safeParse({ ...action, sourceMessageDigest: 'b'.repeat(64) }).success).toBe(false)
    expect(humanActionConfirmationSchema.safeParse({ ...action, interaction: 'session_message', sourceMessageDigest: 'b'.repeat(64) }).success).toBe(true)
  })

  it('seals with the Cloud attestation and no second client-built approval', () => {
    const command = { ...envelope, type: 'delivery.manifest.seal', candidateId: candidate.candidateId,
      operationId: 'operation_seal_001', contract: { projectId: target.projectId, taskId: target.taskId,
        inputReferences: [], contractRevision: 1, contractDigest: 'c'.repeat(64) },
      verificationEvidence: ['Reviewed result'] }
    expect(deliveryManifestSealCommandSchema.safeParse(command).success).toBe(true)
    expect(deliveryManifestSealCommandSchema.safeParse({ ...command, workerAttestationId: 'wra_Attestation001' }).success).toBe(false)
    expect(deliveryManifestSealCommandSchema.safeParse({ ...command, workerAttestation: {} }).success).toBe(false)
  })

  it('makes same-Execution revision requests restart-readable with a bounded instruction', () => {
    const revision = { revisionRequestId: 'revision_request_001', projectId: target.projectId, taskId: target.taskId,
      executionId: target.executionId, executionRevision: 5, deliveryManifestId: 'mft_DeliveryManifest01',
      instruction: 'Add the missing control experiment.', requestedByUserId: TEST_IDS.userId, requestedAt: TEST_TIMESTAMP }
    expect(deliveryRevisionRecordSchema.safeParse(revision).success).toBe(true)
    const { executionRevision: _executionRevision, ...unbound } = revision
    expect(deliveryRevisionRecordSchema.safeParse(unbound).success).toBe(false)
    expect(restRequestSchema.safeParse({ ...envelope, type: 'delivery.revision.request', projectId: target.projectId,
      taskId: target.taskId, deliveryManifestId: revision.deliveryManifestId, instruction: revision.instruction }).success).toBe(true)
  })

  it('requires Owner approval of ordered Project Results and the exact current Plan', () => {
    const completion: ProjectCompletionTarget = { projectId: TEST_IDS.projectId, projectPlanId: TEST_IDS.projectPlanId,
      expectedProjectRevision: 4, expectedCoordinatorAuthorityEpoch: 1, expectedExecutionAuthorityEpoch: 1,
      confirmedPlanRevision: 2, projectResultIds: ['res_ProjectResult01', 'res_ProjectResult02'], summary: '完成实验 ✅' }
    const ownerAction = { ...action, confirmedInputDigest: projectCompletionTargetDigest(completion) }
    const ownerApproval = { ...ownerAction, deviceSignature: signature(projectCompletionHumanActionFactDigest(completion, ownerAction),
      'project-completion-approval', completion.confirmedPlanRevision) }
    const command = { ...envelope, type: 'project.final_summary.submit', ...completion, ownerApproval }
    expect(projectFinalSummarySubmitCommandSchema.safeParse(command).success).toBe(true)
    expect(projectFinalSummarySubmitCommandSchema.safeParse({ ...command, confirmedPlanRevision: 3 }).success).toBe(false)
    expect(projectFinalSummarySubmitCommandSchema.safeParse({ ...command, projectResultIds: [...completion.projectResultIds].reverse() }).success).toBe(false)
    expect(projectFinalSummarySubmitCommandSchema.safeParse({ ...command, ownerApproval: undefined }).success).toBe(false)
    expect(deviceFactHumanConfirmationSchema.safeParse({ purpose: 'project-completion-approval', target: completion, action: ownerAction }).success).toBe(true)
  })

  it('accepts the strict requirements completion baseline without Plan or Project Result fields', () => {
    const completion = {
      baselineKind: 'requirements' as const,
      projectId: TEST_IDS.projectId,
      expectedProjectRevision: 4,
      expectedCoordinatorAuthorityEpoch: 1,
      expectedExecutionAuthorityEpoch: 1,
      requirementsDocumentId: 'rqd_RequirementsCompletion01',
      confirmedRequirementsRevision: 2,
      adoptedTaskIds: [TEST_IDS.taskId],
      summary: 'Every requirements module was adopted.'
    }
    const ownerAction = { ...action, confirmedInputDigest: projectCompletionTargetDigest(completion) }
    const ownerApproval = {
      ...ownerAction,
      deviceSignature: signature(
        projectCompletionHumanActionFactDigest(completion, ownerAction),
        'project-completion-approval', completion.confirmedRequirementsRevision
      )
    }
    const command = { ...envelope, type: 'project.final_summary.submit', ...completion, ownerApproval }
    expect(projectFinalSummarySubmitCommandSchema.safeParse(command).success).toBe(true)
    expect(projectFinalSummarySubmitCommandSchema.safeParse({ ...command, projectPlanId: TEST_IDS.projectPlanId }).success).toBe(false)
    expect(projectFinalSummarySubmitCommandSchema.safeParse({ ...command, projectResultIds: ['res_ProjectResult01'] }).success).toBe(false)
    expect(projectFinalSummarySubmitCommandSchema.safeParse({ ...command, confirmedRequirementsRevision: 3 }).success).toBe(false)
  })

  it('uses the public SDK canonical bytes for keys, Unicode, null and ordered arrays', () => {
    const values = [{ z: null, a: ['汉字', '😀', { '10': true, '2': false }] }, { b: 2, a: 1 }, [1, null, '✓']]
    for (const value of values) {
      expect(canonicalScientificJson(value)).toBe(canonicalizeJson(value))
      expect(scientificDigest(value)).toBe(createHash('sha256').update(canonicalizeJson(value)).digest('hex'))
    }
    expect(workerDeliveryConfirmationDigest(target)).toBe(createHash('sha256').update(canonicalizeJson(target)).digest('hex'))
    expect(scientificDigest(['a', 'b'])).not.toBe(scientificDigest(['b', 'a']))
    expect(() => canonicalScientificJson({ invalid: '\ud800' })).toThrow()
  })

  it('pins dependency bytes through Project Result, manifest and exact ObjectReference', () => {
    const locator = { kind: 'collaboration.object-reference', source: { kind: 'project_result', projectResultId: 'res_ProjectResult01',
      deliveryManifestId: 'mft_DeliveryManifest01' }, object: { objectId: 'obj_DeliveryObject01', objectKey: 'objects/exact-key',
        revision: 2, sha256: 'd'.repeat(64), byteCount: 42, mediaType: 'text/plain', projectId: TEST_IDS.projectId,
        visibility: 'project_public', ownerUserId: TEST_IDS.userId, retentionUntil: null } }
    const input = { kind: 'collaboration.object-input', locator, destinationName: 'input.txt' }
    const intent = { schemaVersion: 1, inputs: [input], output: {
      kind: 'delivery.output',
      fileName: 'result.txt', mediaType: 'text/plain', maxBytes: 100 } }
    expect(taskFileIntentSchema.safeParse(intent).success).toBe(true)
    expect(taskFileIntentSchema.safeParse({ ...intent, inputs: [input, input] }).success).toBe(false)
    const resource = { schemaVersion: 1, type: 'resource_ref', resourceRefId: 'rrf_InputResource001',
      projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
      assignmentTaskRevision: 1, intentDigest: 'e'.repeat(64), role: 'input-file', ordinal: 0,
      locator, locatorDigest: scientificDigest(locator), status: 'available', invalidatedAt: null,
      revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP }
    expect(cloudResourceRefSchema.safeParse(resource).success).toBe(true)
    expect(cloudResourceRefSchema.safeParse({ ...resource, role: 'output-container' }).success).toBe(false)
    expect(taskFileIntentSchema.safeParse({ ...intent, inputs: [{ ...input, locator: { ...locator,
      object: { ...locator.object, visibility: 'staged' } } }] }).success).toBe(false)
  })
})
