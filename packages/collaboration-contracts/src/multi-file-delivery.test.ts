import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import {
  collaborationObjectLocatorSchema,
  cloudStateEntitySchema,
  deliveryCandidateHistorySchema,
  deliveryCandidateSchema,
  deliveryManifestSealCommandSchema,
  deliveryManifestDigest,
  deliveryManifestSchema,
  deliveryManifestWriteSchema,
  exactContractInputReferenceHistorySchema,
  exactContractInputReferenceSchema,
  exactContractReferenceSchema,
  frozenDeliveryBundleDigest,
  frozenDeliveryBundleHistorySchema,
  scientificDigest,
  frozenDeliveryBundleSchema,
  restResponseSchema,
  taskDeliveryFactsSchema,
  taskContractHistorySchema,
  taskContractRevisionHistorySchema,
  taskContractRevisionSchema,
  taskContractSchema,
  dashboardTaskCardSchema,
  privateTaskSessionBindingSchema,
  publicProgressUpdateSchema,
  taskOfferAcceptanceBindingSchema,
  taskProgressPublishCommandSchema,
  taskProjectionSchema
} from './index.js'
import { TEST_IDS, TEST_TIMESTAMP } from './testing.js'

const output = {
  fileName: 'README.md', relativePath: 'README.md', role: 'declared', source: 'ai',
  mediaType: 'text/markdown', byteCount: 42, sha256: 'd'.repeat(64)
} as const
const bundle = {
  schemaVersion: 2, projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
  executionId: TEST_IDS.executionId, contractRevision: 1, resultRevision: 1,
  summary: 'Analysis and supporting data.', outputs: [output]
}
const additional = (index: number) => ({
  ...output, fileName: `data-${index}.csv`, relativePath: `data/data-${index}.csv`,
  role: 'member' as const, source: 'member' as const, mediaType: 'text/csv'
})
const object = {
  objectId: 'obj_MultiOutput001', objectKey: 'objects/multi-output', revision: 3,
  sha256: output.sha256, byteCount: output.byteCount, mediaType: output.mediaType,
  projectId: TEST_IDS.projectId, visibility: 'project_public' as const,
  ownerUserId: TEST_IDS.userId, retentionUntil: null
}
const contract = {
  projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
  contractRevision: 1, contractDigest: 'a'.repeat(64), inputReferences: []
}
function candidate() {
  return {
    candidateId: 'candidate-multi-file', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId, workerUserId: TEST_IDS.userId,
    contractRevision: 1, resultRevision: 1, bundleDigest: frozenDeliveryBundleDigest(frozenDeliveryBundleSchema.parse(bundle)),
    bundleObjectId: 'obj_MultiBundle001', outputObjectIds: [object.objectId],
    outputs: [{ ...output, objectId: object.objectId }],
    status: 'private', createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP
  }
}
function manifest() {
  const candidateFacts = candidate()
  const payload = {
    schemaVersion: 1 as const, revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP,
    type: 'delivery_manifest' as const, deliveryManifestId: 'mft_MultiManifest01',
    projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
    contract, resultRevision: 1, workerAttestationId: 'worker-attestation-multi',
    bundleDigest: candidateFacts.bundleDigest, bundleObjectId: candidateFacts.bundleObjectId,
    outputObjectIds: candidateFacts.outputObjectIds, outputs: candidateFacts.outputs,
    objects: [{ ...object, objectId: candidateFacts.bundleObjectId, objectKey: 'objects/bundle',
      sha256: candidateFacts.bundleDigest, mediaType: 'application/json', byteCount: 100 }, object],
    workerDecision: 'approved' as const, verificationEvidence: ['Reviewed all files.'],
    operationId: 'seal-multi-file', sealedAt: TEST_TIMESTAMP
  }
  return { ...payload, manifestDigest: deliveryManifestDigest(payload) }
}
function resignedManifest(patch: Record<string, unknown>) {
  const { manifestDigest: _digest, ...payload } = { ...manifest(), ...patch }
  return { ...payload, manifestDigest: deliveryManifestDigest(payload) }
}

describe('multi-file Delivery contract', () => {
  it('retains the original sealed bundle payload and digest only through read-only history', () => {
    const historical = { ...bundle, schemaVersion: 1,
      outputs: [{ fileName: output.fileName, mediaType: output.mediaType, byteCount: output.byteCount, sha256: output.sha256 }] }
    expect(frozenDeliveryBundleHistorySchema.parse(historical)).toEqual(historical)
    expect(scientificDigest(frozenDeliveryBundleHistorySchema.parse(historical))).toBe(scientificDigest(historical))
    expect(frozenDeliveryBundleSchema.safeParse(historical).success).toBe(false)
  })

  it('accepts twenty ordered outputs and rejects a twenty-first output', () => {
    const outputs = [output, ...Array.from({ length: 19 }, (_, index) => additional(index))]
    expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, outputs }).success).toBe(true)
    expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, outputs: [...outputs, additional(20)] }).success).toBe(false)
  })

  it('bounds the sum of file bytes at 200 MiB', () => {
    const outputs = [{ ...output, byteCount: 100 * 1024 * 1024 }, { ...additional(1), byteCount: 100 * 1024 * 1024 }]
    expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, outputs }).success).toBe(true)
    expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, outputs: [...outputs, { ...additional(2), byteCount: 1 }] }).success).toBe(false)
  })

  it('rejects traversal, absolute, ambiguous and nonportable paths', () => {
    for (const relativePath of ['/README.md', '../README.md', 'data/../README.md', 'data//README.md',
      './README.md', 'data\\README.md', 'C:/README.md', 'data/CON', 'data/file.', ' data/file.csv']) {
      expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, outputs: [{ ...output,
        relativePath, fileName: relativePath.split('/').at(-1) }] }).success, relativePath).toBe(false)
    }
    expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, outputs: [{ ...additional(1), fileName: '结果.csv', relativePath: '数据/结果.csv' }] }).success).toBe(true)
  })

  it('preserves logical attachment names separately from their exact imported workspace paths', () => {
    const outputs = [{ ...additional(1), source: 'attachment' as const, fileName: 'data.csv',
      relativePath: '.sciforge/uploads/thread-one/123-uuid-data.csv' }]
    expect(frozenDeliveryBundleSchema.parse({ ...bundle, outputs }).outputs).toEqual(outputs)
    expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, outputs: [outputs[0], {
      ...outputs[0], relativePath: '.sciforge/uploads/thread-one/456-uuid-data.csv'
    }] }).success).toBe(true)
  })

  it('rejects portable path collisions but permits equal bytes in distinct files', () => {
    expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, outputs: [output, { ...additional(1),
      fileName: 'readme.MD', relativePath: 'readme.MD' }] }).success).toBe(false)
    const first = { ...additional(1), fileName: 'résumé.csv', relativePath: 'data/résumé.csv' }
    expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, outputs: [first, { ...first,
      fileName: 'résumé.csv', relativePath: 'data/résumé.csv' }] }).success).toBe(false)
    expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, outputs: [output, additional(1)] }).success).toBe(true)
  })

  it('binds names, paths, roles, provenance and order into the frozen digest', () => {
    const parsed = frozenDeliveryBundleSchema.parse({ ...bundle, outputs: [output, additional(1)] })
    const digest = frozenDeliveryBundleDigest(parsed)
    expect(frozenDeliveryBundleDigest({ ...parsed, outputs: [...parsed.outputs].reverse() })).not.toBe(digest)
    for (const patch of [{ source: 'attachment' as const }, { relativePath: 'more/data-1.csv' },
      { fileName: 'other.csv', relativePath: 'data/other.csv' }]) {
      expect(frozenDeliveryBundleDigest({ ...parsed, outputs: [output, { ...parsed.outputs[1]!, ...patch }] })).not.toBe(digest)
    }
    expect(frozenDeliveryBundleSchema.safeParse({ ...bundle, outputs: [{ ...output, source: 'member' }] }).success).toBe(false)
  })

  it('requires verified descriptors for new candidates while reading old candidates without fabricated facts', () => {
    const current = candidate()
    expect(deliveryCandidateSchema.parse(current)).toEqual(current)
    const { outputs: _outputs, ...historical } = current
    expect(deliveryCandidateSchema.safeParse(historical).success).toBe(false)
    expect(deliveryCandidateHistorySchema.parse(historical)).toEqual(historical)
    expect(deliveryCandidateSchema.safeParse({ ...current, outputObjectIds: ['obj_DifferentFile01'] }).success).toBe(false)
  })

  it('reads role-bound A candidates through standard REST queries without weakening new candidate writes', () => {
    const { outputs: _outputs, ...historical } = candidate()
    const response = { protocolVersion: '1.0', type: 'rest.entity', requestId: TEST_IDS.requestId,
      entity: { type: 'delivery_candidate', ...historical } }
    expect(restResponseSchema.parse(response)).toEqual(response)
    expect(deliveryCandidateSchema.safeParse(historical).success).toBe(false)
    const { outputs: _manifestOutputs, manifestDigest: _digest, ...oldPayload } = manifest()
    const oldManifest = { ...oldPayload, manifestDigest: deliveryManifestDigest(oldPayload) }
    const facts = { taskId: TEST_IDS.taskId, candidate: historical, manifest: oldManifest,
      receipt: null, result: null, revisionRequest: null }
    expect(taskDeliveryFactsSchema.parse(facts)).toEqual(facts)
    expect(restResponseSchema.parse({ protocolVersion: '1.0', type: 'rest.task.delivery',
      requestId: TEST_IDS.requestId, facts })).toEqual({ protocolVersion: '1.0', type: 'rest.task.delivery',
      requestId: TEST_IDS.requestId, facts })
  })

  it('does not expose pre-human legacy candidates as current actionable Task delivery facts', () => {
    const { outputs: _outputs, bundleObjectId: _bundleObjectId, outputObjectIds: _outputObjectIds, ...facts } = candidate()
    const legacy = { ...facts, bundleDigest: null, objectIds: [object.objectId] }
    expect(deliveryCandidateHistorySchema.parse(legacy)).toEqual(legacy)
    expect(taskDeliveryFactsSchema.safeParse({ taskId: TEST_IDS.taskId, candidate: legacy,
      manifest: null, receipt: null, result: null, revisionRequest: null }).success).toBe(false)
  })

  it('keeps accepted historical Task Contract identities and digests readable without authorizing new ambiguous inputs', () => {
    const payload = {
      schemaVersion: 1, type: 'task_contract', projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId,
      contractRevision: 1, objective: 'Analyze the adopted data.', scientificScope: 'Use the accepted input.',
      scientificInputVersions: [{ kind: 'project_result', referenceId: 'res_ProjectResult01', revision: 1, digest: object.sha256 }],
      constraints: [], acceptanceCriteria: ['Provide the analysis.'], requiredOutputs: []
    }
    const historical = { ...payload, contractDigest: scientificDigest(payload) }
    expect(taskContractHistorySchema.parse(historical)).toEqual(historical)
    expect(taskContractSchema.safeParse(historical).success).toBe(false)
    expect(taskContractHistorySchema.safeParse({ ...historical, objective: 'A different objective.' }).success).toBe(false)
    const row = { schemaVersion: 1, type: 'task_contract_revision', projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId, contract: historical, revision: 1, createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP }
    expect(taskContractRevisionHistorySchema.parse(row)).toEqual(row)
    expect(taskContractRevisionSchema.safeParse(row).success).toBe(false)
    expect(cloudStateEntitySchema.parse(row)).toEqual(row)
    expect(taskContractRevisionHistorySchema.safeParse({ ...row, taskId: 'tsk_DifferentTask01' }).success).toBe(false)
  })

  it('allows submission to reference the unchanged accepted A-era Contract without modifying its input identities', () => {
    const historical = { ...contract, inputReferences: [{ kind: 'project_result', referenceId: 'res_ProjectResult01',
      revision: 1, digest: object.sha256 }] }
    const command = { protocolVersion: '1.0', requestId: TEST_IDS.requestId, idempotencyKey: 'idem_seal-accepted-history',
      type: 'delivery.manifest.seal', candidateId: candidate().candidateId, operationId: 'seal-old-accepted-task',
      contract: historical, verificationEvidence: ['Reviewed the exact accepted Contract.'] }
    expect(deliveryManifestSealCommandSchema.parse(command).contract).toEqual(historical)
    expect(exactContractReferenceSchema.safeParse(historical).success).toBe(false)
    expect(deliveryManifestSealCommandSchema.safeParse({ ...command, contract: { ...historical,
      inputReferences: [{ ...historical.inputReferences[0], objectId: 'invented' }] } }).success).toBe(false)
  })

  it('keeps current Task/dashboard and private Session projections bound to the original accepted Contract', () => {
    const historical = { ...contract, inputReferences: [{ kind: 'project_result', referenceId: 'res_ProjectResult01',
      revision: 1, digest: object.sha256 }] }
    const projection = { schemaVersion: 1, type: 'task_projection', projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId, lineage: { projectId: TEST_IDS.projectId, requirementsBaselineId: 'requirements-accepted',
        workItemId: 'item_accepted' }, title: 'An accepted task', workflowColumn: 'in_progress',
      contractExecution: 'running', delivery: 'not_submitted', adoption: 'pending', contract: historical,
      assigneeUserId: TEST_IDS.userId, executionId: TEST_IDS.executionId, unread: false,
      blocker: null, nextAction: null, observedAt: TEST_TIMESTAMP }
    expect(taskProjectionSchema.parse(projection).contract).toEqual(historical)
    expect(dashboardTaskCardSchema.parse({ ...projection, type: 'dashboard_task_card', plannedStartAt: null,
      plannedDueAt: null, dependencyTaskIds: [], assigneeDisplayName: 'Assigned member', publicSummary: null,
      privateSessionAvailable: true, primaryAction: 'open_private_session' }).contract).toEqual(historical)
    const session = { schemaVersion: 1, type: 'private_task_session_binding', revision: 1,
      createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP, sessionBindingId: 'ses_AcceptedSession01',
      projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
      workerUserId: TEST_IDS.userId, agentId: TEST_IDS.agentId, agentProfileId: 'prf_AcceptedProfile01',
      deviceId: TEST_IDS.deviceId, contract: historical, status: 'active', private: true, sessionLocator: 'local-session-one' }
    expect(privateTaskSessionBindingSchema.parse(session).contract).toEqual(historical)
  })

  it('carries the accepted Contract through acceptance and progress without changing input definitions', () => {
    const historical = { ...contract, inputReferences: [{ kind: 'project_result', referenceId: 'res_ProjectResult01',
      revision: 1, digest: object.sha256 }] }
    const binding = { taskOfferId: TEST_IDS.taskOfferId, taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
      workerUserId: TEST_IDS.userId, agentId: TEST_IDS.agentId, agentProfileId: 'prf_AcceptedProfile01',
      profileRevision: 1, deviceId: TEST_IDS.deviceId, contract: historical,
      proof: { userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId, acceptedAt: TEST_TIMESTAMP,
        proofDigest: 'b'.repeat(64), interaction: 'explicit_click' }, idempotencyKey: 'idem_accepted-history' }
    expect(taskOfferAcceptanceBindingSchema.parse(binding).contract).toEqual(historical)
    const update = { schemaVersion: 1, type: 'public_progress_update', revision: 1,
      createdAt: TEST_TIMESTAMP, updatedAt: TEST_TIMESTAMP, publicProgressUpdateId: 'ppu_AcceptedProgress01',
      projectId: TEST_IDS.projectId, taskId: TEST_IDS.taskId, contract: historical,
      executionId: TEST_IDS.executionId, sessionBindingId: 'ses_AcceptedSession01', actorAgentId: TEST_IDS.agentId,
      actorAgentProfileId: 'prf_AcceptedProfile01', actorProfileRevision: 1, visibility: 'project_public',
      stage: 'running', summary: 'Analyzing the accepted input.', blocker: null, nextAction: null,
      referencedObjectIds: [], sourceEventId: 'evt_AcceptedProgress01', idempotencyKey: 'idem_progress-history' }
    expect(publicProgressUpdateSchema.parse(update).contract).toEqual(historical)
    const { schemaVersion: _schemaVersion, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt,
      type: _type, ...command } = update
    expect(taskProgressPublishCommandSchema.parse({ ...command, protocolVersion: '1.0',
      type: 'task.progress.publish', requestId: TEST_IDS.requestId }).contract).toEqual(historical)
    expect(exactContractReferenceSchema.safeParse(historical).success).toBe(false)
  })

  it('keeps equal-content files distinct and rejects reordered candidate descriptor identities', () => {
    const current = candidate()
    const secondObjectId = 'obj_MultiOutput002'
    const outputs = [...current.outputs, { ...additional(1), objectId: secondObjectId }]
    const multi = { ...current, outputs, outputObjectIds: [...current.outputObjectIds, secondObjectId] }
    expect(deliveryCandidateSchema.parse(multi)).toEqual(multi)
    expect(deliveryCandidateSchema.safeParse({ ...multi, outputObjectIds: [...multi.outputObjectIds].reverse() }).success).toBe(false)
  })

  it('matches each sealed descriptor to its ordered object ID and exact bytes', () => {
    expect(deliveryManifestWriteSchema.safeParse(manifest()).success).toBe(true)
    for (const patch of [{ objectId: 'obj_DifferentFile01' }, { byteCount: 43 },
      { mediaType: 'text/csv' }, { sha256: 'e'.repeat(64) }]) {
      expect(deliveryManifestWriteSchema.safeParse(resignedManifest({ outputs: [{ ...output, objectId: object.objectId, ...patch }] })).success).toBe(false)
    }
    const { outputs: _outputs, manifestDigest: _digest, ...historical } = manifest()
    const legacy = { ...historical, manifestDigest: deliveryManifestDigest(historical) }
    expect(deliveryManifestSchema.parse(legacy)).toEqual(legacy)
    expect(deliveryManifestWriteSchema.safeParse(legacy).success).toBe(false)
  })

  it('pins adopted files by manifest and object even when two files have equal digests', () => {
    const reference = { kind: 'adopted_delivery', referenceId: 'mft_MultiManifest01', objectId: object.objectId,
      revision: object.revision, digest: object.sha256 }
    expect(exactContractInputReferenceSchema.parse(reference)).toEqual(reference)
    const other = { ...reference, objectId: 'obj_MultiOutput002' }
    expect(exactContractReferenceSchema.safeParse({ ...contract, inputReferences: [reference, other] }).success).toBe(true)
    expect(exactContractReferenceSchema.safeParse({ ...contract, inputReferences: [reference, reference] }).success).toBe(false)
    expect(collaborationObjectLocatorSchema.safeParse({ kind: 'collaboration.object-reference',
      source: { kind: 'adopted_delivery', deliveryManifestId: reference.referenceId }, object }).success).toBe(true)
  })

  it('requires object identity on new Project Result references and preserves read-only history', () => {
    const reference = { kind: 'project_result', referenceId: 'res_ProjectResult01', revision: 1, digest: object.sha256 }
    expect(exactContractInputReferenceSchema.safeParse(reference).success).toBe(false)
    expect(exactContractInputReferenceHistorySchema.parse(reference)).toEqual(reference)
    expect(exactContractInputReferenceSchema.safeParse({ ...reference, objectId: object.objectId }).success).toBe(true)
    expect(exactContractInputReferenceSchema.safeParse({ ...reference, kind: 'delivery_manifest' }).success).toBe(false)
  })

  it('publishes discriminated JSON schema with required file identities', () => {
    const schema = z.toJSONSchema(exactContractInputReferenceSchema)
    const branches = schema.oneOf as Array<{ properties: { kind: { const: string } }; required: string[] }>
    expect(branches.find(({ properties }) => properties.kind.const === 'adopted_delivery')?.required).toContain('objectId')
    expect(branches.find(({ properties }) => properties.kind.const === 'project_result')?.required).toContain('objectId')
  })
})
