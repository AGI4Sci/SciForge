import { objectReferenceSchema, exactContractInputReferenceSchema, exactContractInputReferenceHistorySchema, uniqueInputReferences } from './object-reference.js'
import { z } from 'zod'
import { DELIVERY_MAX_FILE_COUNT, deliveryManifestOutputsSchema, deliveryOutputsSchema } from './delivery-output.js'
import { taskFileDestinationNameSchema } from './task-object-io.js'

import {
  activityCursorIdSchema,
  agentIdSchema,
  agentProfileIdSchema,
  collaborationEventIdSchema,
  deliveryManifestIdSchema,
  deviceIdSchema,
  entityMetadataShape,
  executionIdSchema,
  idempotencyKeySchema,
  idempotencyReceiptIdSchema,
  integrationReceiptIdSchema,
  materialRevisionIdSchema,
  notificationIdSchema,
  objectIdSchema,
  planItemIdSchema,
  planPromotionIdSchema,
  projectIdSchema,
  projectResultIdSchema,
  publicProgressUpdateIdSchema,
  revisionSchema,
  safeCodeSchema,
  sequenceSchema,
  sessionBindingIdSchema,
  sha256Schema,
  taskIdSchema,
  taskOfferIdSchema,
  timestampSchema,
  transferOperationIdSchema,
  userIdSchema
} from './core.js'
import { scientificDigest, canonicalScientificJson, workerDeliveryHumanActionProofSchema, workerAttestationHistorySchema } from './scientific-collaboration.js'

const boundedLabelSchema = z.string().trim().min(1).max(200)
const boundedSummarySchema = z.string().trim().min(1).max(1_000)
const opaqueReferenceSchema = z.string().trim().min(1).max(2_048)
const unique = <T>(values: readonly T[]): boolean => new Set(values).size === values.length

/** The only lineage that derives an effective Task identity. */
export const taskLineageSchema = z.object({
  projectId: projectIdSchema,
  requirementsBaselineId: opaqueReferenceSchema,
  workItemId: planItemIdSchema
}).strict()
export type TaskLineage = z.infer<typeof taskLineageSchema>

/** Deterministic identity for Plan promotion; changing any lineage fact changes the Task. */
export function canonicalTaskIdForLineage(
  projectId: string,
  requirementsBaselineId: string,
  workItemId: string
): z.infer<typeof taskIdSchema> {
  const lineage = taskLineageSchema.parse({ projectId, requirementsBaselineId, workItemId })
  const digest = scientificDigest(lineage)
  return taskIdSchema.parse(`tsk_${digest.slice(0, 32)}`)
}

export const planPromotionSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('plan_promotion'),
  planPromotionId: planPromotionIdSchema,
  lineage: taskLineageSchema,
  planItemId: planItemIdSchema,
  taskId: taskIdSchema,
  contractRevision: revisionSchema,
  contractDigest: sha256Schema,
  idempotencyKey: idempotencyKeySchema
}).strict().superRefine((promotion, context) => {
  if (promotion.lineage.workItemId !== promotion.planItemId) {
    context.addIssue({ code: 'custom', path: ['planItemId'], message: 'Promotion Plan item must match its lineage work item.' })
  }
  if (promotion.taskId !== canonicalTaskIdForLineage(
    promotion.lineage.projectId,
    promotion.lineage.requirementsBaselineId,
    promotion.lineage.workItemId
  )) {
    context.addIssue({ code: 'custom', path: ['taskId'], message: 'Task identity must be derived from project, baseline and work-item lineage.' })
  }
})
export type PlanPromotion = z.infer<typeof planPromotionSchema>

export const exactContractReferenceSchema = z.object({
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  contractRevision: revisionSchema,
  contractDigest: sha256Schema,
  inputReferences: z.array(exactContractInputReferenceSchema).max(1_000).refine(uniqueInputReferences, 'Contract inputs must be unique.')
}).strict()
export const exactContractReferenceHistorySchema = exactContractReferenceSchema.extend({
  inputReferences: z.array(exactContractInputReferenceHistorySchema).max(1_000).refine(uniqueInputReferences, 'Contract inputs must be unique.')
}).strict()
export type ExactContractReference = z.infer<typeof exactContractReferenceSchema>
export type ExactContractReferenceHistory = z.infer<typeof exactContractReferenceHistorySchema>

export const taskWorkflowColumnSchema = z.enum(['intake', 'ready', 'in_progress', 'confirmation', 'completed'])
export const taskContractExecutionBadgeSchema = z.enum([
  'unassigned', 'accepted_awaiting_runtime', 'running', 'needs_human', 'waiting_result_confirm',
  'unknown_reconciling', 'completed', 'failed', 'cancelled'
])
export const taskDeliveryBadgeSchema = z.enum(['not_submitted', 'worker_review', 'sealed', 'returned'])
export const taskAdoptionBadgeSchema = z.enum(['pending', 'adopted', 'unadopted', 'superseded'])
export type TaskWorkflowColumn = z.infer<typeof taskWorkflowColumnSchema>

/** Read-only task card projection. The dimensions are intentionally orthogonal. */
export const taskProjectionSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('task_projection'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  lineage: taskLineageSchema,
  title: boundedLabelSchema,
  workflowColumn: taskWorkflowColumnSchema,
  contractExecution: taskContractExecutionBadgeSchema,
  delivery: taskDeliveryBadgeSchema,
  adoption: taskAdoptionBadgeSchema,
  contract: exactContractReferenceHistorySchema,
  assigneeUserId: userIdSchema.nullable(),
  executionId: executionIdSchema.nullable(),
  unread: z.boolean(),
  blocker: boundedSummarySchema.nullable(),
  nextAction: boundedSummarySchema.nullable(),
  observedAt: timestampSchema
}).strict().superRefine((projection, context) => {
  if (
    projection.lineage.projectId !== projection.projectId ||
    projection.contract.projectId !== projection.projectId ||
    projection.contract.taskId !== projection.taskId
  ) {
    context.addIssue({ code: 'custom', path: ['lineage'], message: 'Task projection references must share the same Project and Task.' })
  }
  if ((projection.executionId === null) !== (projection.contractExecution === 'unassigned')) {
    context.addIssue({ code: 'custom', path: ['executionId'], message: 'An assigned execution is required for every non-unassigned execution badge.' })
  }
  if (projection.workflowColumn === 'completed' && projection.adoption !== 'adopted' && projection.adoption !== 'unadopted') {
    context.addIssue({ code: 'custom', path: ['adoption'], message: 'Completed work has an explicit adoption disposition.' })
  }
})
export type TaskProjection = z.infer<typeof taskProjectionSchema>

/** Human proof and all execution bindings are committed as one acceptance transaction. */
export const workerAcceptanceProofSchema = z.object({
  userId: userIdSchema,
  deviceId: deviceIdSchema,
  acceptedAt: timestampSchema,
  proofDigest: sha256Schema,
  interaction: z.enum(['explicit_click', 'explicit_keyboard_action'])
}).strict()
export type WorkerAcceptanceProof = z.infer<typeof workerAcceptanceProofSchema>

export const taskOfferAcceptanceBindingSchema = z.object({
  taskOfferId: taskOfferIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  workerUserId: userIdSchema,
  agentId: agentIdSchema,
  agentProfileId: agentProfileIdSchema,
  profileRevision: revisionSchema,
  deviceId: deviceIdSchema,
  contract: exactContractReferenceHistorySchema,
  proof: workerAcceptanceProofSchema,
  idempotencyKey: idempotencyKeySchema
}).strict().superRefine((binding, context) => {
  if (binding.proof.userId !== binding.workerUserId || binding.proof.deviceId !== binding.deviceId) {
    context.addIssue({ code: 'custom', path: ['proof'], message: 'Human proof must bind the winning Worker User and Device.' })
  }
  if (binding.contract.taskId !== binding.taskId) {
    context.addIssue({ code: 'custom', path: ['contract'], message: 'Accepted Contract must belong to the accepted Task.' })
  }
})
export type TaskOfferAcceptanceBinding = z.infer<typeof taskOfferAcceptanceBindingSchema>

export const privateTaskSessionBindingSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('private_task_session_binding'),
  sessionBindingId: sessionBindingIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  workerUserId: userIdSchema,
  agentId: agentIdSchema,
  agentProfileId: agentProfileIdSchema,
  deviceId: deviceIdSchema,
  contract: exactContractReferenceHistorySchema,
  status: z.enum(['active', 'paused', 'reconciling', 'closed']),
  private: z.literal(true),
  sessionLocator: opaqueReferenceSchema
}).strict().superRefine((binding, context) => {
  if (binding.contract.projectId !== binding.projectId || binding.contract.taskId !== binding.taskId) {
    context.addIssue({ code: 'custom', path: ['contract'], message: 'Private Session Contract must belong to the Task.' })
  }
})
export type PrivateTaskSessionBinding = z.infer<typeof privateTaskSessionBindingSchema>

export const agentProfileRevisionSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('agent_profile_revision'),
  agentProfileId: agentProfileIdSchema,
  ownerUserId: userIdSchema,
  profileRevision: revisionSchema,
  responsibilitySummary: boundedSummarySchema,
  capabilityTags: z.array(safeCodeSchema).max(256).refine(unique, 'Profile capabilities must be unique.'),
  modelFamily: boundedLabelSchema.nullable(),
  privatePrompt: z.string().trim().min(1).max(32_000),
  privateMemoryRef: opaqueReferenceSchema.nullable(),
  privateCredentialVersion: revisionSchema.nullable(),
  localPath: opaqueReferenceSchema.nullable(),
  status: z.enum(['active', 'archived'])
}).strict()
export type AgentProfileRevision = z.infer<typeof agentProfileRevisionSchema>

export const agentProfilePublicProjectionSchema = agentProfileRevisionSchema.omit({
  privatePrompt: true,
  privateMemoryRef: true,
  privateCredentialVersion: true,
  localPath: true
}).extend({ type: z.literal('agent_profile_public_projection') }).strict()
export type AgentProfilePublicProjection = z.infer<typeof agentProfilePublicProjectionSchema>

export const deviceReadinessSchema = z.enum(['ready', 'busy', 'waiting_device', 'offline', 'stale_unknown', 'recovering', 'unavailable'])
export type DeviceReadiness = z.infer<typeof deviceReadinessSchema>

export const deviceReadinessProjectionSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('device_readiness_projection'),
  deviceId: deviceIdSchema,
  ownerUserId: userIdSchema,
  readiness: deviceReadinessSchema,
  heartbeatAt: timestampSchema.nullable(),
  authorityEpoch: revisionSchema,
  credentialRevision: revisionSchema,
  observedAt: timestampSchema
}).strict().superRefine((device, context) => {
  if (['ready', 'busy', 'waiting_device', 'recovering'].includes(device.readiness) && device.heartbeatAt === null) {
    context.addIssue({ code: 'custom', path: ['heartbeatAt'], message: 'A live Device readiness projection requires a heartbeat.' })
  }
})
export type DeviceReadinessProjection = z.infer<typeof deviceReadinessProjectionSchema>

const privateContentPattern = /(?:transcript|prompt|memory|credential|private(?:\s|_|-)path|tool(?:\s|_|-)command)/iu
const safeProgressText = z.string().trim().min(1).max(1_000).refine(
  (value) => !privateContentPattern.test(value),
  'Progress text cannot contain private Session or transcript material.'
)

export const publicProgressStageSchema = z.enum(['queued', 'planning', 'running', 'waiting_human', 'preparing_delivery', 'blocked', 'complete'])
export const publicProgressUpdateSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('public_progress_update'),
  publicProgressUpdateId: publicProgressUpdateIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  contract: exactContractReferenceHistorySchema,
  executionId: executionIdSchema,
  sessionBindingId: sessionBindingIdSchema,
  actorAgentId: agentIdSchema,
  actorAgentProfileId: agentProfileIdSchema,
  actorProfileRevision: revisionSchema,
  visibility: z.literal('project_public'),
  stage: publicProgressStageSchema,
  summary: safeProgressText,
  blocker: safeProgressText.nullable(),
  nextAction: safeProgressText.nullable(),
  referencedObjectIds: z.array(objectIdSchema).max(100).refine(unique, 'Referenced public objects must be unique.'),
  sourceEventId: collaborationEventIdSchema,
  idempotencyKey: idempotencyKeySchema
}).strict().superRefine((update, context) => {
  if (update.contract.projectId !== update.projectId || update.contract.taskId !== update.taskId) {
    context.addIssue({ code: 'custom', path: ['contract'], message: 'Progress Contract must belong to the Task.' })
  }
  if (update.stage === 'complete' && update.nextAction !== null) {
    context.addIssue({ code: 'custom', path: ['nextAction'], message: 'A complete progress update has no next action.' })
  }
})
export type PublicProgressUpdate = z.infer<typeof publicProgressUpdateSchema>

/** Explicit parser used at the Cloud boundary; transcript-derived payloads cannot pass the strict schema. */
export function parsePublicProgressUpdate(value: unknown): PublicProgressUpdate {
  return publicProgressUpdateSchema.parse(value)
}

export const publicActivityCursorSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('public_activity_cursor'),
  activityCursorId: activityCursorIdSchema,
  projectId: projectIdSchema,
  sequence: sequenceSchema,
  snapshotRevision: revisionSchema,
  opaqueCursor: opaqueReferenceSchema
}).strict()
export type PublicActivityCursor = z.infer<typeof publicActivityCursorSchema>

export const publicActivityEventSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('public_activity_event'),
  projectId: projectIdSchema,
  sequence: sequenceSchema,
  eventId: collaborationEventIdSchema,
  kind: z.enum(['state', 'comment', 'mention', 'progress', 'review', 'delivery', 'integration', 'adoption', 'exception']),
  taskId: taskIdSchema.nullable(),
  payload: z.union([publicProgressUpdateSchema, z.object({ summary: safeProgressText }).strict()]),
  occurredAt: timestampSchema
}).strict().superRefine((event, context) => {
  const payload = event.payload
  if ('projectId' in payload && payload.projectId !== event.projectId) {
    context.addIssue({ code: 'custom', path: ['payload', 'projectId'], message: 'Activity payload must belong to the event Project.' })
  }
  if ('taskId' in payload && event.taskId !== payload.taskId) {
    context.addIssue({ code: 'custom', path: ['payload', 'taskId'], message: 'Activity payload must belong to the event Task.' })
  }
  if (event.kind === 'progress' && !('publicProgressUpdateId' in payload)) {
    context.addIssue({ code: 'custom', path: ['payload'], message: 'Progress activity must carry a typed PublicProgressUpdate.' })
  }
})
export type PublicActivityEvent = z.infer<typeof publicActivityEventSchema>

export function isActivityCursorReplay(cursor: Pick<PublicActivityCursor, 'projectId' | 'sequence'>, event: Pick<PublicActivityEvent, 'projectId' | 'sequence'>): boolean {
  return cursor.projectId === event.projectId && event.sequence > cursor.sequence
}

export const materialRevisionSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('material_revision'),
  materialRevisionId: materialRevisionIdSchema,
  logicalMaterialId: opaqueReferenceSchema,
  object: objectReferenceSchema,
  uploadedByUserId: userIdSchema,
  sourceRevisionId: materialRevisionIdSchema.nullable(),
  active: z.boolean()
}).strict().superRefine((material, context) => {
  if (material.object.visibility !== 'project_public') {
    context.addIssue({ code: 'custom', path: ['object', 'visibility'], message: 'A MaterialRevision must reference a public object.' })
  }
})
export type MaterialRevision = z.infer<typeof materialRevisionSchema>

/** Canonical frozen bytes. Generated Cloud object IDs are deliberately absent. */
/** Frozen report capacity is measured in Unicode code points, independently of progress previews. */
export const deliveryBundleSummarySchema = z.string().trim().min(1).max(16_000)
  .refine((value) => [...value].length <= 8_000, 'A Delivery report may contain at most 8000 Unicode code points.')
  .refine((value) => !privateContentPattern.test(value), 'Delivery reports cannot expose private Session material.')

export const frozenDeliveryBundleSchema = z.object({
  schemaVersion: z.literal(2),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  contractRevision: revisionSchema,
  resultRevision: revisionSchema,
  summary: deliveryBundleSummarySchema,
  outputs: deliveryOutputsSchema
}).strict()
export type FrozenDeliveryBundle = z.infer<typeof frozenDeliveryBundleSchema>

/** Original sealed bytes remain readable without inventing file roles, sources or paths. */
const singleOutputFrozenDeliveryBundleHistorySchema = frozenDeliveryBundleSchema.extend({
  schemaVersion: z.literal(1),
  outputs: z.array(z.object({
    fileName: taskFileDestinationNameSchema,
    mediaType: z.string().trim().min(1).max(255),
    byteCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sha256: sha256Schema
  }).strict()).max(1)
}).strict()
export const frozenDeliveryBundleHistorySchema = z.union([
  frozenDeliveryBundleSchema, singleOutputFrozenDeliveryBundleHistorySchema
])
export type FrozenDeliveryBundleHistory = z.infer<typeof frozenDeliveryBundleHistorySchema>

export function canonicalFrozenDeliveryBundleBytes(bundle: FrozenDeliveryBundle): Uint8Array {
  return new TextEncoder().encode(canonicalScientificJson(frozenDeliveryBundleSchema.parse(bundle)))
}

export function frozenDeliveryBundleDigest(bundle: FrozenDeliveryBundle): string {
  return scientificDigest(frozenDeliveryBundleSchema.parse(bundle))
}

export const deliveryManifestSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('delivery_manifest'),
  deliveryManifestId: deliveryManifestIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  contract: exactContractReferenceHistorySchema,
  /** The result revision and Worker attestation are optional only for legacy
   * snapshots. New sealed manifests always carry both exact references. */
  resultRevision: revisionSchema.optional(),
  workerAttestationId: opaqueReferenceSchema.optional(),
  bundleDigest: sha256Schema.optional(),
  bundleObjectId: objectIdSchema.optional(),
  outputObjectIds: z.array(objectIdSchema).max(DELIVERY_MAX_FILE_COUNT).optional(),
  /** Missing only on pre-multi-file history; never reconstruct names from mutable workspace files. */
  outputs: deliveryManifestOutputsSchema.optional(),
  objects: z.array(objectReferenceSchema).min(1).max(1_000),
  manifestDigest: sha256Schema,
  workerDecision: z.enum(['approved', 'returned']),
  verificationEvidence: z.array(safeProgressText).max(100),
  operationId: opaqueReferenceSchema,
  sealedAt: timestampSchema
}).strict().superRefine((manifest, context) => {
  if (
    manifest.contract.projectId !== manifest.projectId ||
    manifest.contract.taskId !== manifest.taskId
  ) {
    context.addIssue({ code: 'custom', path: ['contract'], message: 'Delivery Contract must belong to its Task.' })
  }
  if (manifest.objects.some((object) => object.projectId !== manifest.projectId)) {
    context.addIssue({ code: 'custom', path: ['objects'], message: 'Delivery objects must belong to the same Project.' })
  }
  if (manifest.objects.some((object) => object.visibility !== 'project_public')) {
    context.addIssue({ code: 'custom', path: ['objects'], message: 'A sealed Delivery can reference only project-public objects.' })
  }
  if (manifest.workerDecision !== 'approved') {
    context.addIssue({ code: 'custom', path: ['workerDecision'], message: 'Only an approved Worker decision may seal a Delivery.' })
  }
  const rolesPresent = manifest.bundleDigest !== undefined || manifest.bundleObjectId !== undefined || manifest.outputObjectIds !== undefined
  if (rolesPresent) {
    if (manifest.bundleDigest === undefined || manifest.bundleObjectId === undefined || manifest.outputObjectIds === undefined) {
      context.addIssue({ code: 'custom', path: ['bundleObjectId'], message: 'Delivery object roles and bundle digest must be recorded together.' })
    } else {
      const roleIds = [manifest.bundleObjectId, ...manifest.outputObjectIds]
      const objectIds = manifest.objects.map((object) => object.objectId)
      if (!unique(roleIds) || !unique(objectIds) || objectIds.length !== roleIds.length || roleIds.some((id) => !objectIds.includes(id))) {
        context.addIssue({ code: 'custom', path: ['objects'], message: 'Manifest bytes must match its exact bundle and ordered output roles.' })
      }
      if (manifest.objects.find((object) => object.objectId === manifest.bundleObjectId)?.sha256 !== manifest.bundleDigest) {
        context.addIssue({ code: 'custom', path: ['bundleDigest'], message: 'The bundle digest must identify the sealed bundle bytes.' })
      }
    }
  }
  if (manifest.outputs !== undefined) {
    if (manifest.outputObjectIds === undefined || manifest.outputs.length !== manifest.outputObjectIds.length ||
      manifest.outputs.some((output, index) => output.objectId !== manifest.outputObjectIds?.[index])) {
      context.addIssue({ code: 'custom', path: ['outputs'], message: 'Delivery descriptors must match the exact ordered output object IDs.' })
    }
    for (const [index, output] of manifest.outputs.entries()) {
      const object = manifest.objects.find(({ objectId }) => objectId === output.objectId)
      if (object === undefined || object.sha256 !== output.sha256 || object.byteCount !== output.byteCount || object.mediaType !== output.mediaType) {
        context.addIssue({ code: 'custom', path: ['outputs', index], message: 'A Delivery descriptor must match its exact sealed object bytes and media type.' })
      }
    }
  }
  const { manifestDigest, ...payload } = manifest
  if (deliveryManifestDigest(payload) !== manifestDigest) {
    context.addIssue({ code: 'custom', path: ['manifestDigest'], message: 'Delivery manifest digest must cover the immutable manifest payload.' })
  }
})
export type DeliveryManifest = z.infer<typeof deliveryManifestSchema>
export const deliveryManifestWriteSchema = deliveryManifestSchema.safeExtend({
  contract: exactContractReferenceHistorySchema,
  resultRevision: revisionSchema,
  workerAttestationId: opaqueReferenceSchema,
  bundleDigest: sha256Schema,
  bundleObjectId: objectIdSchema,
  outputObjectIds: z.array(objectIdSchema).max(DELIVERY_MAX_FILE_COUNT),
  outputs: deliveryManifestOutputsSchema
})
export type DeliveryManifestWrite = z.infer<typeof deliveryManifestWriteSchema>

export function deliveryManifestDigest(manifest: unknown): string {
  return scientificDigest(manifest)
}

export const integrationReceiptSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('integration_receipt'),
  integrationReceiptId: integrationReceiptIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  deliveryManifestId: deliveryManifestIdSchema,
  integrationRevision: revisionSchema,
  validationEvidence: z.array(safeProgressText).min(1).max(100),
  operationId: opaqueReferenceSchema,
  disposition: z.enum(['adopted', 'unadopted', 'superseded', 'rejected'])
}).strict()
export type IntegrationReceipt = z.infer<typeof integrationReceiptSchema>

export const projectResultSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_result'),
  projectResultId: projectResultIdSchema,
  projectId: projectIdSchema,
  deliveryManifestId: deliveryManifestIdSchema,
  integrationReceiptId: integrationReceiptIdSchema,
  projectVersion: revisionSchema,
  adoptedAt: timestampSchema,
  disposition: z.enum(['adopted', 'unadopted', 'superseded']).default('adopted')
}).strict()
export type ProjectResult = z.infer<typeof projectResultSchema>

export const orphanReconciliationEntrySchema = z.object({
  operationId: opaqueReferenceSchema,
  objectId: objectIdSchema,
  objectKey: opaqueReferenceSchema,
  sha256: sha256Schema,
  manifestId: deliveryManifestIdSchema.nullable(),
  retentionUntil: timestampSchema.nullable(),
  disposition: z.enum(['retained_formal_reference', 'retained_retention_window', 'retained_unresolved', 'dry_run_eligible', 'deleted']),
  reason: safeProgressText
}).strict()
export type OrphanReconciliationEntry = z.infer<typeof orphanReconciliationEntrySchema>

export const objectStorageReconciliationSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('object_storage_reconciliation'),
  reconciliationId: opaqueReferenceSchema,
  projectId: projectIdSchema.nullable(),
  dryRun: z.boolean(),
  entries: z.array(orphanReconciliationEntrySchema).max(100_000),
  deletedObjectIds: z.array(objectIdSchema).max(100_000),
  observedAt: timestampSchema
}).strict()
export type ObjectStorageReconciliation = z.infer<typeof objectStorageReconciliationSchema>

export const migrationProvenanceSourceSchema = z.enum(['git', 'filesystem', 'legacy_database', 'other'])
export const migrationProvenanceStatusSchema = z.enum(['planned', 'staged', 'committed', 'abandoned'])

/** One immutable cutover fact for an imported legacy commit/path/digest. */
export const migrationProvenanceRecordSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('migration_provenance_record'),
  migrationOperationId: opaqueReferenceSchema,
  objectId: objectIdSchema.nullable(),
  sourceKind: migrationProvenanceSourceSchema,
  sourceCommit: opaqueReferenceSchema.nullable(),
  sourcePath: opaqueReferenceSchema.nullable(),
  sourceSha256: sha256Schema.nullable(),
  status: migrationProvenanceStatusSchema,
  cutoverAt: timestampSchema.nullable()
}).strict().superRefine((record, context) => {
  if (record.status === 'committed' && (
    record.objectId === null || record.sourceCommit === null || record.sourcePath === null ||
    record.sourceSha256 === null || record.cutoverAt === null
  )) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'A committed migration requires object, source commit/path/digest and cutover time.' })
  }
  if (record.status !== 'committed' && record.cutoverAt !== null) {
    context.addIssue({ code: 'custom', path: ['cutoverAt'], message: 'Only a committed migration has a cutover time.' })
  }
})
export type MigrationProvenanceRecord = z.infer<typeof migrationProvenanceRecordSchema>

export const transferOperationSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('transfer_operation'),
  transferOperationId: transferOperationIdSchema,
  projectId: projectIdSchema,
  objectId: objectIdSchema,
  kind: z.enum(['upload', 'download', 'preview', 'copy', 'delete']),
  scope: z.enum(['material', 'comment_attachment', 'delivery', 'project_result', 'private_session']),
  permissionEpoch: revisionSchema,
  expiresAt: timestampSchema,
  status: z.enum(['issued', 'in_progress', 'completed', 'unknown', 'revoked', 'abandoned']),
  idempotencyKey: idempotencyKeySchema
}).strict()
export type TransferOperation = z.infer<typeof transferOperationSchema>

export const idempotencyReceiptSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('idempotency_receipt'),
  idempotencyReceiptId: idempotencyReceiptIdSchema,
  idempotencyKey: idempotencyKeySchema,
  commandType: safeCodeSchema,
  bodyDigest: sha256Schema,
  status: z.enum(['committed', 'rejected']),
  resultDigest: sha256Schema,
  resourceType: safeCodeSchema,
  resourceId: opaqueReferenceSchema,
  committedRevision: revisionSchema
}).strict()
export type IdempotencyReceipt = z.infer<typeof idempotencyReceiptSchema>

export const notificationProjectionSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('notification_projection'),
  notificationId: notificationIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema.nullable(),
  recipientUserId: userIdSchema,
  kind: z.enum(['offer', 'review', 'mention', 'blocked', 'exception', 'system']),
  summary: safeProgressText,
  actionRequired: z.boolean(),
  expiresAt: timestampSchema.nullable(),
  readAt: timestampSchema.nullable(),
  sourceEventId: collaborationEventIdSchema
}).strict()
export type NotificationProjection = z.infer<typeof notificationProjectionSchema>

/** Canonical coordination and delivery commands; server adapters must consume these schemas. */
export const mentionActionSchema = z.object({
  mentionActionId: opaqueReferenceSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  recipientUserId: userIdSchema,
  sourceEventId: collaborationEventIdSchema,
  publicContext: safeProgressText,
  state: z.enum(['pending', 'accepted', 'dismissed', 'expired']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict()
export type MentionAction = z.infer<typeof mentionActionSchema>

export const privateMentionDispatchSchema = z.object({
  mentionActionId: opaqueReferenceSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  workerUserId: userIdSchema,
  sessionBindingId: sessionBindingIdSchema,
  publicContext: safeProgressText,
  private: z.literal(true)
}).strict()
export type PrivateMentionDispatch = z.infer<typeof privateMentionDispatchSchema>

export const coordinatorDeviceTransferSchema = z.object({
  projectId: projectIdSchema,
  ownerUserId: userIdSchema,
  fromDeviceId: deviceIdSchema,
  toDeviceId: deviceIdSchema,
  expectedAuthorityEpoch: revisionSchema,
  ownerConfirmationDigest: sha256Schema,
  idempotencyKey: idempotencyKeySchema
}).strict()
export type CoordinatorDeviceTransfer = z.infer<typeof coordinatorDeviceTransferSchema>

export const deliveryCandidateSchema = z.object({
  candidateId: opaqueReferenceSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  workerUserId: userIdSchema,
  contractRevision: revisionSchema,
  resultRevision: revisionSchema,
  /** Digest of the frozen local candidate the Worker reviews; a text-only Task delivers it as a bundle object. */
  bundleDigest: sha256Schema,
  bundleObjectId: objectIdSchema,
  outputObjectIds: z.array(objectIdSchema).max(DELIVERY_MAX_FILE_COUNT),
  outputs: deliveryManifestOutputsSchema,
  status: z.enum(['private', 'submitted', 'returned', 'sealed', 'superseded']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((candidate, context) => {
  if (!unique([candidate.bundleObjectId, ...candidate.outputObjectIds])) {
    context.addIssue({ code: 'custom', path: ['outputObjectIds'], message: 'The bundle and declared outputs must be distinct objects.' })
  }
  if (candidate.outputs.length !== candidate.outputObjectIds.length ||
    candidate.outputs.some((output, index) => output.objectId !== candidate.outputObjectIds[index])) {
    context.addIssue({ code: 'custom', path: ['outputs'], message: 'Candidate descriptors must match the exact ordered output object IDs.' })
  }
})
export type DeliveryCandidate = z.infer<typeof deliveryCandidateSchema>

/** Legacy candidates have no proven bundle/output role mapping and are read-only. */
export const legacyDeliveryCandidateSchema = z.object({
  candidateId: opaqueReferenceSchema, projectId: projectIdSchema, taskId: taskIdSchema,
  executionId: executionIdSchema, workerUserId: userIdSchema,
  contractRevision: revisionSchema, resultRevision: revisionSchema, bundleDigest: sha256Schema.nullable(),
  objectIds: z.array(objectIdSchema).min(1).max(1_000),
  status: deliveryCandidateSchema.shape.status, createdAt: timestampSchema, updatedAt: timestampSchema
}).strict()
/** A-era role-bound facts preserve their original proof and snapshot; normal review actions remain available. */
export const singleOutputDeliveryCandidateHistorySchema = z.object({
  ...deliveryCandidateSchema.shape,
  outputObjectIds: z.array(objectIdSchema).max(1)
}).omit({ outputs: true }).strict().superRefine((candidate, context) => {
  if (!unique([candidate.bundleObjectId, ...candidate.outputObjectIds])) {
    context.addIssue({ code: 'custom', path: ['outputObjectIds'], message: 'Historical bundle and output objects must be distinct.' })
  }
})
/** Proven role-bound candidates, including pre-multi-file records; new writes use deliveryCandidateSchema. */
export const deliveryCandidateRecordSchema = z.union([
  deliveryCandidateSchema, singleOutputDeliveryCandidateHistorySchema
])
export type DeliveryCandidateRecord = z.infer<typeof deliveryCandidateRecordSchema>
export const deliveryCandidateHistorySchema = z.union([
  deliveryCandidateRecordSchema, legacyDeliveryCandidateSchema
])
export type DeliveryCandidateHistory = z.infer<typeof deliveryCandidateHistorySchema>

export function deliveryCandidateObjectIds(candidate: DeliveryCandidateHistory): string[] {
  return 'bundleObjectId' in candidate ? [candidate.bundleObjectId, ...candidate.outputObjectIds] : [...candidate.objectIds]
}

/** One explicit Worker User review of the exact candidate revision and bundle. */
export const workerDeliveryReviewSchema = z.object({
  candidateId: opaqueReferenceSchema,
  workerUserId: userIdSchema,
  decision: z.enum(['approved', 'returned']),
  resultRevision: revisionSchema,
  bundleDigest: sha256Schema,
  humanAction: workerDeliveryHumanActionProofSchema,
  reason: safeProgressText.nullable(),
  idempotencyKey: idempotencyKeySchema
}).strict().superRefine((review, context) => {
  if (review.humanAction.deviceSignature.userId !== review.workerUserId ||
    review.humanAction.deviceSignature.factRevision !== review.resultRevision) {
    context.addIssue({ code: 'custom', path: ['humanAction'], message: 'The review proof must bind the exact Worker and result revision.' })
  }
})
export type WorkerDeliveryReview = z.infer<typeof workerDeliveryReviewSchema>

export const coordinatorAdoptionSchema = z.object({
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  deliveryManifestId: deliveryManifestIdSchema,
  integrationRevision: revisionSchema,
  validationEvidence: z.array(safeProgressText).min(1).max(100),
  operationId: opaqueReferenceSchema,
  disposition: z.enum(['adopted', 'unadopted', 'superseded', 'rejected']),
  idempotencyKey: idempotencyKeySchema
}).strict()
export type CoordinatorAdoption = z.infer<typeof coordinatorAdoptionSchema>

/** Owner-side request to rework a sealed Delivery inside the same Execution and private Session. */
export const deliveryRevisionRequestSchema = z.object({
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  deliveryManifestId: deliveryManifestIdSchema,
  instruction: safeProgressText,
  idempotencyKey: idempotencyKeySchema
}).strict()
export type DeliveryRevisionRequest = z.infer<typeof deliveryRevisionRequestSchema>

/** Immutable Owner instruction, bound to the reopened Execution revision. */
export const deliveryRevisionRecordSchema = z.object({
  revisionRequestId: opaqueReferenceSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  executionRevision: revisionSchema,
  deliveryManifestId: deliveryManifestIdSchema,
  instruction: safeProgressText,
  requestedByUserId: userIdSchema,
  requestedAt: timestampSchema
}).strict()
export type DeliveryRevisionRecord = z.infer<typeof deliveryRevisionRecordSchema>

export const taskDeliveryFactsSchema = z.object({
  taskId: taskIdSchema,
  candidate: deliveryCandidateRecordSchema.nullable(),
  manifest: deliveryManifestSchema.nullable(),
  receipt: integrationReceiptSchema.nullable(),
  result: projectResultSchema.nullable(),
  revisionRequest: deliveryRevisionRecordSchema.nullable()
}).strict()
export type TaskDeliveryFacts = z.infer<typeof taskDeliveryFactsSchema>

export const deliveryDriveViewSchema = z.object({
  projectId: projectIdSchema,
  sharedMaterials: z.array(objectReferenceSchema).max(100_000),
  taskDeliveries: z.array(deliveryManifestSchema).max(100_000),
  projectResults: z.array(projectResultSchema).max(100_000)
}).strict()
export type DeliveryDriveView = z.infer<typeof deliveryDriveViewSchema>

/** Authorized sealed Delivery read, never private instructions or staged bytes. */
export const deliveryReadViewSchema = z.object({
  manifest: deliveryManifestSchema,
  workerAttestation: workerAttestationHistorySchema.nullable(),
  revisionRequests: z.array(deliveryRevisionRecordSchema).max(10_000)
}).strict()
export type DeliveryReadView = z.infer<typeof deliveryReadViewSchema>

/** Public Dashboard data is a projection of Cloud facts, never a local task ledger. */
export const dashboardViewSchema = z.enum(['board', 'table', 'calendar', 'gantt'])
export type DashboardView = z.infer<typeof dashboardViewSchema>

export const dashboardMemberRoleSchema = z.enum(['owner', 'coordinator', 'worker', 'member'])
export type DashboardMemberRole = z.infer<typeof dashboardMemberRoleSchema>

/** Public member labels are the only values a renderer may use to address an @mention. */
export const dashboardMentionOptionSchema = z.object({
  userId: userIdSchema,
  displayName: boundedLabelSchema,
  role: dashboardMemberRoleSchema
}).strict()
export type DashboardMentionOption = z.infer<typeof dashboardMentionOptionSchema>

export const dashboardTaskKindSchema = z.enum(['plan_item', 'task'])
export type DashboardTaskKind = z.infer<typeof dashboardTaskKindSchema>

const materialConflictRevisionSchema = z.object({
  materialRevisionId: materialRevisionIdSchema,
  revision: revisionSchema,
  sha256: sha256Schema
}).strict()

export const materialConflictDecisionSchema = z.enum(['keep_current', 'adopt_incoming', 'save_as_new'])
export type MaterialConflictDecision = z.infer<typeof materialConflictDecisionSchema>

/**
 * A conflict is a read-only decision prompt. It never mutates a MaterialRevision;
 * the selected decision must be sent through the canonical material command.
 */
export const dashboardMaterialConflictSchema = z.object({
  logicalMaterialId: opaqueReferenceSchema,
  current: materialConflictRevisionSchema,
  incoming: materialConflictRevisionSchema,
  allowedDecisions: z.array(materialConflictDecisionSchema).min(2).max(3).refine(unique, 'Material conflict decisions must be unique.')
}).strict().superRefine((conflict, context) => {
  if (conflict.current.materialRevisionId === conflict.incoming.materialRevisionId ||
      conflict.current.sha256 === conflict.incoming.sha256) {
    context.addIssue({ code: 'custom', path: ['incoming'], message: 'A material conflict must reference two distinct revisions.' })
  }
})
export type DashboardMaterialConflict = z.infer<typeof dashboardMaterialConflictSchema>

export const dashboardTaskCardSchema = z.object({
  ...taskProjectionSchema.shape,
  type: z.literal('dashboard_task_card'),
  taskKind: dashboardTaskKindSchema.default('task'),
  revision: revisionSchema.optional(),
  plannedStartAt: timestampSchema.nullable(),
  plannedDueAt: timestampSchema.nullable(),
  dependencyTaskIds: z.array(taskIdSchema).max(256),
  assigneeDisplayName: boundedLabelSchema.nullable(),
  publicSummary: safeProgressText.nullable(),
  privateSessionAvailable: z.boolean(),
  primaryAction: z.enum([
    'view', 'promote_plan', 'accept_offer', 'open_private_session',
    'submit_review', 'adopt_delivery', 'recover'
  ]).nullable()
}).strict().superRefine((card, context) => {
  if (
    card.lineage.projectId !== card.projectId ||
    card.contract.projectId !== card.projectId ||
    card.contract.taskId !== card.taskId
  ) {
    context.addIssue({ code: 'custom', path: ['lineage'], message: 'Dashboard Task references must share the same Project and Task.' })
  }
  if ((card.executionId === null) !== (card.contractExecution === 'unassigned')) {
    context.addIssue({ code: 'custom', path: ['executionId'], message: 'An assigned execution is required for every non-unassigned execution badge.' })
  }
  if (card.workflowColumn === 'completed' && card.adoption !== 'adopted' && card.adoption !== 'unadopted') {
    context.addIssue({ code: 'custom', path: ['adoption'], message: 'Completed work has an explicit adoption disposition.' })
  }
  if (card.privateSessionAvailable && card.assigneeDisplayName === null) {
    context.addIssue({ code: 'custom', path: ['assigneeDisplayName'], message: 'A private Session must be bound to a visible Worker.' })
  }
  if (card.plannedStartAt && card.plannedDueAt && Date.parse(card.plannedStartAt) > Date.parse(card.plannedDueAt)) {
    context.addIssue({ code: 'custom', path: ['plannedDueAt'], message: 'Planned due time must not precede planned start time.' })
  }
})
export type DashboardTaskCard = z.infer<typeof dashboardTaskCardSchema>

export const dashboardActivityItemSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('dashboard_activity_item'),
  event: publicActivityEventSchema,
  actorDisplayName: boundedLabelSchema.nullable(),
  public: z.literal(true)
}).strict()
export type DashboardActivityItem = z.infer<typeof dashboardActivityItemSchema>

export const cloudProjectDashboardSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('cloud_project_dashboard'),
  projectId: projectIdSchema,
  projectName: boundedLabelSchema,
  role: dashboardMemberRoleSchema,
  view: dashboardViewSchema,
  tasks: z.array(dashboardTaskCardSchema).max(100_000),
  activity: z.array(dashboardActivityItemSchema).max(10_000),
  mentionableUsers: z.array(dashboardMentionOptionSchema).max(10_000).default([]),
  materialConflicts: z.array(dashboardMaterialConflictSchema).max(10_000).default([]),
  /** Null until the Cloud has a durable public activity cursor. */
  activityCursor: publicActivityCursorSchema.nullable(),
  stale: z.boolean(),
  offline: z.boolean(),
  revoked: z.boolean()
}).strict().superRefine((dashboard, context) => {
  if (dashboard.activityCursor !== null && dashboard.activityCursor.projectId !== dashboard.projectId) {
    context.addIssue({ code: 'custom', path: ['activityCursor'], message: 'Dashboard activity cursor must belong to the Project.' })
  }
  if (dashboard.revoked && dashboard.tasks.length > 0) {
    context.addIssue({ code: 'custom', path: ['tasks'], message: 'A revoked dashboard cannot expose task details.' })
  }
  if (dashboard.tasks.some((task) => task.projectId !== dashboard.projectId) ||
      dashboard.activity.some((item) => item.event.projectId !== dashboard.projectId)) {
    context.addIssue({ code: 'custom', path: ['tasks'], message: 'Dashboard facts must belong to the exact Project.' })
  }
})
export type CloudProjectDashboard = z.infer<typeof cloudProjectDashboardSchema>

export const dashboardCommentDraftSchema = z.object({
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  text: safeProgressText,
  mentionedUserIds: z.array(userIdSchema).max(64).refine(unique, 'Mentions must be unique.'),
  visibility: z.literal('project_public'),
  idempotencyKey: idempotencyKeySchema
}).strict()
export type DashboardCommentDraft = z.infer<typeof dashboardCommentDraftSchema>

export const dashboardScheduleUpdateSchema = z.object({
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  expectedRevision: revisionSchema,
  plannedStartAt: timestampSchema.nullable(),
  plannedDueAt: timestampSchema.nullable(),
  idempotencyKey: idempotencyKeySchema
}).strict().superRefine((schedule, context) => {
  if (schedule.plannedStartAt && schedule.plannedDueAt && Date.parse(schedule.plannedStartAt) > Date.parse(schedule.plannedDueAt)) {
    context.addIssue({ code: 'custom', path: ['plannedDueAt'], message: 'Planned due time must not precede planned start time.' })
  }
})
export type DashboardScheduleUpdate = z.infer<typeof dashboardScheduleUpdateSchema>

export function isRevisionCurrent(expectedRevision: number, currentRevision: number): boolean {
  return revisionSchema.safeParse(expectedRevision).success && revisionSchema.safeParse(currentRevision).success && expectedRevision === currentRevision
}

export function isIdempotencyReplay(
  receipt: Pick<IdempotencyReceipt, 'idempotencyKey' | 'bodyDigest'>,
  command: Pick<IdempotencyReceipt, 'idempotencyKey' | 'bodyDigest'>
): boolean {
  return receipt.idempotencyKey === command.idempotencyKey && receipt.bodyDigest === command.bodyDigest
}
