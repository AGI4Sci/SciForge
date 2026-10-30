import {
  deliveryDriveViewSchema,
  deliveryManifestDigest,
  projectPlanHistorySchema,
  type CollaborationObjectLocator,
  type Project
} from '@sciforge/collaboration-contracts'

/** Exact Cloud bytes used by Coordinator read and Delivery tests. */
export function cloudInputLocator(
  projectId: string,
  suffix = 'CoordinatorInput01',
  source: CollaborationObjectLocator['source'] = {
    kind: 'shared_material', materialRevisionId: `mat_${suffix}`
  }
): CollaborationObjectLocator {
  return {
    kind: 'collaboration.object-reference',
    source,
    object: {
      objectId: `obj_${suffix}`, objectKey: `projects/${projectId}/${suffix}`,
      projectId, revision: 1, sha256: 'a'.repeat(64), byteCount: 12,
      mediaType: 'text/markdown', visibility: 'project_public',
      ownerUserId: 'usr_Owner0000001', retentionUntil: null
    }
  }
}

export function publishedResultDrive(projectId: string, taskId: string, executionId: string, suffix: string) {
  const object = cloudInputLocator(projectId, suffix).object
  const at = '2026-08-25T01:00:00.000Z'
  const payload = {
    schemaVersion: 1 as const, type: 'delivery_manifest' as const, revision: 1,
    createdAt: at, updatedAt: at, projectId, taskId, executionId,
    deliveryManifestId: `mft_${suffix}`,
    contract: { projectId, taskId, contractRevision: 1, contractDigest: object.sha256, inputReferences: [] },
    resultRevision: 1, workerAttestationId: `wat_${suffix}`, bundleDigest: object.sha256,
    bundleObjectId: `obj_Bundle${suffix}`, outputObjectIds: [object.objectId],
    objects: [{ ...object, objectId: `obj_Bundle${suffix}` }, object],
    workerDecision: 'approved' as const, verificationEvidence: ['Verified output.'],
    operationId: `seal-${suffix}`, sealedAt: at
  }
  return deliveryDriveViewSchema.parse({ projectId, sharedMaterials: [],
    taskDeliveries: [{ ...payload, manifestDigest: deliveryManifestDigest(payload) }],
    projectResults: [{ schemaVersion: 1, type: 'project_result', revision: 1,
      createdAt: at, updatedAt: at, projectId, projectResultId: `res_${suffix}`,
      deliveryManifestId: payload.deliveryManifestId, integrationReceiptId: `irc_${suffix}`,
      projectVersion: 1, adoptedAt: at, disposition: 'adopted' }]
  })
}

// Retained Cloud data, never constructed through a retired write command.
export function historicalPlanFixture(project: Project, { legacy = false, superseded = false } = {}) {
  return projectPlanHistorySchema.parse({
    schemaVersion: 1, type: 'project_plan', projectId: project.projectId,
    projectPlanId: 'pln_HistoricalRead0001', planRevision: 1, revision: superseded ? 3 : 2,
    createdAt: project.createdAt, updatedAt: project.updatedAt,
    state: superseded ? 'superseded' : 'confirmed',
    sourceInputLocators: legacy ? [{ contractVersion: 1, kind: 'content-space.file-reference',
      authority: 'provider.instance.alpha', identity: { fileId: 'historical-input' } }] : [],
    tasks: [{ planItemId: 'item_historical', workerUserId: project.ownerUserId,
      title: 'Historical Task', objective: 'Read the retained historical baseline.',
      completionCriteria: ['Historical facts remain readable.'], dependencyPlanItemIds: [],
      requiredCapabilityTags: [], fileIntent: null }],
    rationale: 'Explicit retained data for read-only notification regression.',
    runtimeProvenance: { runtimeId: 'runtime-history', modelId: null,
      generatedByCoordinatorAgentId: project.coordinatorAgentId, generatedAt: project.createdAt },
    planDigest: 'a'.repeat(64), submittedAt: project.createdAt,
    confirmedByUserId: project.ownerUserId, confirmedAt: project.createdAt,
    supersededAt: superseded ? project.updatedAt : null
  })
}
