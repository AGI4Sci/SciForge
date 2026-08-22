import { z } from 'zod'
import {
  artifactV1Schema,
  artifactVersionIssueV1Schema,
  artifactVersionLifecycleEventV1Schema,
  artifactVersionRefV1Schema,
  artifactVersionV1Schema,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'

export {
  compareEvidenceDagWatermarks,
  evidenceDagWatermarkCoversValue,
  laterEvidenceDagWatermark
} from './watermark.js'

const boundedIdSchema = z.string().trim().min(1).max(512)
const runtimeIdSchema = z.string().trim().min(1).max(128)
const watermarkSchema = z.string().trim().min(1).max(512)
const timestampSchema = z.string().datetime({ offset: true })
const sha256DigestSchema = z.string().trim().toLowerCase().regex(/^sha256:[0-9a-f]{64}$/u)

export const EVIDENCE_DAG_RESOURCE_KIND = 'evidence-dag' as const

export const EVIDENCE_DAG_CAPABILITY_IDS = Object.freeze({
  view: 'evidence-dag.view',
  snapshotStatus: 'evidence-dag.snapshot-status',
  update: 'evidence-dag.update',
  priority: 'evidence-dag.priority',
  resolvePreview: 'evidence-dag.resolve-evidence-preview',
  exportSnapshotProducts: 'evidence-dag.export-snapshot-products'
} as const)

export const evidenceDagErrorCodeSchema = z.enum([
  'model_output_incomplete',
  'model_output_empty',
  'model_output_invalid_json',
  'upstream_timeout',
  'upstream_rate_limited',
  'upstream_unavailable',
  'snapshot_corrupt',
  'access_restricted',
  'internal_error'
])

export const evidenceDagTypedErrorSchema = z.object({
  code: evidenceDagErrorCodeSchema,
  message: z.string().trim().min(1).max(4_000),
  retryable: z.boolean(),
  occurredAt: timestampSchema,
  requestId: boundedIdSchema.optional(),
  attempts: z.number().int().positive().max(100).optional(),
  incompleteReason: z.string().trim().min(1).max(256).optional(),
  responseStatus: z.string().trim().min(1).max(256).optional(),
  upstreamStatus: z.number().int().min(100).max(599).optional(),
  maxOutputTokens: z.number().int().positive().max(1_000_000).optional()
}).strict()

export const evidenceDagCommittedSnapshotSchema = z.object({
  threadId: boundedIdSchema,
  version: z.number().int().nonnegative(),
  digest: sha256DigestSchema,
  inputWatermark: watermarkSchema,
  schemaVersion: boundedIdSchema,
  extractorVersion: boundedIdSchema,
  verifierVersion: boundedIdSchema,
  artifactDigests: z.array(sha256DigestSchema).max(10_000),
  createdAt: timestampSchema,
  url: z.string().url().max(4_096).optional()
}).strict()

/** Minimal immutable Evidence identity consumed by downstream DAG packages. */
export const evidenceDagSnapshotIdentitySchema = evidenceDagCommittedSnapshotSchema.pick({
  threadId: true,
  digest: true
})

const evidenceDagPendingBaseShape = {
  jobId: boundedIdSchema,
  targetWatermark: watermarkSchema,
  attempt: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  completedBatches: z.number().int().nonnegative().optional(),
  totalBatches: z.number().int().positive().optional()
}

export const evidenceDagPendingUpdateSchema = z.discriminatedUnion('state', [
  z.object({
    ...evidenceDagPendingBaseShape,
    state: z.literal('queued')
  }).strict(),
  z.object({
    ...evidenceDagPendingBaseShape,
    state: z.literal('running'),
    phase: z.enum(['capturing', 'extracting', 'verifying', 'committing', 'handoff'])
  }).strict(),
  z.object({
    ...evidenceDagPendingBaseShape,
    state: z.literal('retrying'),
    nextAttemptAt: timestampSchema,
    error: evidenceDagTypedErrorSchema
  }).strict(),
  z.object({
    ...evidenceDagPendingBaseShape,
    state: z.literal('failed'),
    error: evidenceDagTypedErrorSchema
  }).strict()
])

export const evidenceDagCanonicalStatusSchema = z.object({
  committed: evidenceDagCommittedSnapshotSchema.nullable(),
  pending: evidenceDagPendingUpdateSchema.nullable(),
  updatedAt: timestampSchema
}).strict()

export const evidenceDagViewInputSchema = z.object({
  runtimeId: runtimeIdSchema.optional(),
  threadId: boundedIdSchema.optional(),
  workspaceRoot: z.string().trim().min(1).max(4_096).optional()
}).strict().superRefine((value, context) => {
  if (Boolean(value.runtimeId) === Boolean(value.threadId)) return
  context.addIssue({
    code: 'custom',
    message: 'runtimeId and threadId must be supplied together.'
  })
})

export const evidenceDagViewOutputSchema = z.object({
  url: z.string().url().max(4_096),
  threadId: boundedIdSchema.optional(),
  status: evidenceDagCanonicalStatusSchema
}).strict()

/**
 * Workspace-authorized status read for downstream domain services. Unlike
 * `view`, this contract has no UI URL and therefore does not require the
 * Evidence sidecar to be ready.
 */
export const evidenceDagSnapshotStatusInputSchema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: boundedIdSchema,
  workspaceRoot: z.string().trim().min(1).max(4_096).optional()
}).strict()

export const evidenceDagSnapshotStatusOutputSchema = evidenceDagCanonicalStatusSchema

export const evidenceDagUpdateOperationSchema = z.enum(['update', 'rebuild'])
export const evidenceDagRebuildKindSchema = z.enum([
  'schema_upgrade',
  'corruption_recovery',
  'reinterpretation'
])

export const evidenceDagUpdateInputSchema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: boundedIdSchema,
  workspaceRoot: z.string().trim().min(1).max(4_096).optional(),
  operation: evidenceDagUpdateOperationSchema.default('update'),
  rebuildKind: evidenceDagRebuildKindSchema.optional(),
  rebuildRationale: z.string().trim().min(1).max(1_000).optional()
}).strict().superRefine((value, context) => {
  const rebuilding = value.operation === 'rebuild'
  if (rebuilding && (!value.rebuildKind || !value.rebuildRationale)) {
    context.addIssue({
      code: 'custom',
      message: 'rebuildKind and rebuildRationale are required for rebuild.'
    })
  }
  if (!rebuilding && (value.rebuildKind || value.rebuildRationale)) {
    context.addIssue({
      code: 'custom',
      message: 'rebuild fields are only valid for rebuild.'
    })
  }
})

export const evidenceDagUpdateOutputSchema = z.object({
  url: z.string().url().max(4_096),
  threadId: boundedIdSchema,
  itemCount: z.number().int().nonnegative(),
  jobId: boundedIdSchema,
  coalesced: z.boolean(),
  status: evidenceDagCanonicalStatusSchema
}).strict()

export const evidenceDagPriorityInputSchema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: boundedIdSchema,
  surfaceId: boundedIdSchema,
  visible: z.boolean(),
  workspaceRoot: z.string().trim().min(1).max(4_096).optional()
}).strict()

export const evidenceDagPriorityOutputSchema = evidenceDagCanonicalStatusSchema

export const evidenceSourceSelectorSchema = z.object({
  type: z.enum(['pdf', 'text', 'table', 'figure', 'code', 'dataset', 'web']),
  page: z.number().int().positive().optional(),
  section: z.string().trim().min(1).max(1_000).optional(),
  table: z.string().trim().min(1).max(1_000).optional(),
  figure: z.string().trim().min(1).max(1_000).optional(),
  rowRange: z.string().trim().min(1).max(1_000).optional(),
  columnNames: z.array(z.string().trim().min(1).max(512)).max(1_000).optional(),
  lineRange: z.string().trim().min(1).max(1_000).optional(),
  quote: z.string().max(20_000).optional(),
  query: z.record(z.string().trim().min(1).max(512), z.unknown()).optional()
}).strict()

/**
 * Immutable Artifact Version projection accepted by Evidence ingestion.
 *
 * `ref` is the authority. The optional records are a denormalized read
 * projection from the Artifact Versions domain; Evidence never writes them
 * back and never manufactures an Artifact or version identity.
 */
export const evidenceDagArtifactVersionRecordV1Schema = z.object({
  ref: artifactVersionRefV1Schema,
  artifact: artifactV1Schema.optional(),
  version: artifactVersionV1Schema.optional(),
  kind: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,63}$/).optional(),
  locator: z.string().trim().min(1).max(8_192).optional(),
  observedAt: timestampSchema.optional()
}).strict().superRefine((value, context) => {
  if (value.artifact && value.artifact.artifactId !== value.ref.artifactId) {
    context.addIssue({
      code: 'custom',
      path: ['artifact', 'artifactId'],
      message: 'Artifact projection must match the pinned ArtifactVersionRef.'
    })
  }
  if (
    value.version &&
    (value.version.artifactId !== value.ref.artifactId ||
      value.version.versionId !== value.ref.versionId)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['version'],
      message: 'Version projection must match the pinned ArtifactVersionRef.'
    })
  }
  if (value.version && (
    value.version.storage.contentDigest !== value.ref.contentDigest ||
    value.version.storage.byteLength !== value.ref.byteLength ||
    value.version.storage.mediaType !== value.ref.mediaType ||
    value.version.storage.mode !== value.ref.retention ||
    JSON.stringify(value.version.accessPolicy) !== JSON.stringify(value.ref.accessPolicy)
  )) {
    context.addIssue({
      code: 'custom',
      path: ['version'],
      message: 'Version content and access policy must match the pinned ArtifactVersionRef.'
    })
  }
})

export const evidenceDagArtifactVersionProjectionV1Schema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    versions: z.array(evidenceDagArtifactVersionRecordV1Schema).max(128),
    lifecycleEvents: z.array(artifactVersionLifecycleEventV1Schema).max(512),
    lastSequence: z.number().int().nonnegative().optional(),
    lifecyclePending: z.boolean().optional(),
    lifecycleIssue: artifactVersionIssueV1Schema.optional()
  }).strict(),
  z.object({
    status: z.literal('pending'),
    reason: z.string().trim().min(1).max(4_000),
    lifecycleEvents: z.array(artifactVersionLifecycleEventV1Schema).max(512).optional(),
    lastSequence: z.number().int().nonnegative().optional(),
    lifecyclePending: z.boolean().optional()
  }).strict(),
  z.object({
    status: z.literal('failed'),
    issue: artifactVersionIssueV1Schema,
    lifecycleEvents: z.array(artifactVersionLifecycleEventV1Schema).max(512).optional(),
    lastSequence: z.number().int().nonnegative().optional(),
    lifecyclePending: z.boolean().optional()
  }).strict()
])

export const evidenceDagPreviewInputSchema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: boundedIdSchema,
  workspaceRoot: z.string().trim().min(1).max(4_096).optional(),
  snapshotDigest: sha256DigestSchema,
  sourceAssertionId: boundedIdSchema,
  artifactVersionId: boundedIdSchema,
  sourceAnchorId: boundedIdSchema
}).strict()

export const evidenceDagPreviewFailureCodeSchema = z.enum([
  'snapshot_mismatch',
  'provenance_mismatch',
  'access_restricted',
  'unsupported_locator',
  'file_unavailable'
])

export const evidenceDagPreviewOutputSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    path: z.string().trim().min(1).max(4_096),
    workspaceRoot: z.string().trim().min(1).max(4_096),
    runtimeId: runtimeIdSchema,
    threadId: boundedIdSchema,
    snapshotDigest: sha256DigestSchema,
    sourceAssertionId: boundedIdSchema,
    artifactId: boundedIdSchema.optional(),
    artifactVersionId: boundedIdSchema,
    sourceAnchorId: boundedIdSchema,
    selector: evidenceSourceSelectorSchema,
    contentDigest: sha256DigestSchema,
    anchorDigest: sha256DigestSchema.optional(),
    mediaType: z.string().trim().min(1).max(512).optional()
  }).strict(),
  z.object({
    ok: z.literal(false),
    code: evidenceDagPreviewFailureCodeSchema,
    message: z.string().trim().min(1).max(4_000)
  }).strict()
])

export const evidenceDagExportProductKindSchema = z.enum([
  'prov-json',
  'ro-crate',
  'datacite',
  'audit-report',
  'reproduction-report'
])

export const evidenceDagDataCiteCreatorV1Schema = z.object({
  name: z.string().trim().min(1).max(1_000),
  nameType: z.enum(['Personal', 'Organizational']).optional(),
  givenName: z.string().trim().min(1).max(512).optional(),
  familyName: z.string().trim().min(1).max(512).optional(),
  orcid: z.string().trim().min(1).max(128).optional()
}).strict().superRefine((value, context) => {
  if ((value.givenName || value.familyName) && value.nameType !== 'Personal') {
    context.addIssue({
      code: 'custom',
      message: 'DataCite givenName/familyName require nameType Personal.'
    })
  }
})

export const evidenceDagDataCiteDescriptionV1Schema = z.object({
  description: z.string().trim().min(1).max(20_000),
  descriptionType: z.enum([
    'Abstract',
    'Methods',
    'SeriesInformation',
    'TableOfContents',
    'TechnicalInfo',
    'Other'
  ])
}).strict()

/** Discovery metadata is explicit: Evidence never guesses publication identity. */
export const evidenceDagDataCiteMetadataV1Schema = z.object({
  doi: z.string().trim().min(1).max(255),
  title: z.string().trim().min(1).max(2_000),
  creators: z.array(evidenceDagDataCiteCreatorV1Schema).min(1).max(1_000),
  publisher: z.string().trim().min(1).max(1_000),
  publicationYear: z.number().int().min(1000).max(9999),
  projectId: boundedIdSchema,
  resourceType: z.string().trim().min(1).max(1_000).optional(),
  language: z.string().trim().min(2).max(64).optional(),
  landingPage: z.string().url().max(4_096).optional(),
  descriptions: z.array(evidenceDagDataCiteDescriptionV1Schema).max(100).optional()
}).strict()

const evidenceDagExportTargetV1Schema = z.object({
  artifactId: z.string().trim().startsWith('artifact:').max(256),
  expectedCurrentVersionId: z.string().trim().startsWith('artifact-version:').max(256)
}).strict()

export const evidenceDagExportTargetsV1Schema = z.object({
  provJson: evidenceDagExportTargetV1Schema.optional(),
  roCrate: evidenceDagExportTargetV1Schema.optional(),
  datacite: evidenceDagExportTargetV1Schema.optional(),
  auditReport: evidenceDagExportTargetV1Schema.optional(),
  reproductionReport: evidenceDagExportTargetV1Schema.optional()
}).strict()

export const evidenceDagExportSnapshotProductsInputSchema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: boundedIdSchema,
  workspaceRoot: z.string().trim().min(1).max(4_096).optional(),
  snapshotDigest: sha256DigestSchema,
  idempotencyKey: z.string().trim().min(8).max(512),
  datacite: evidenceDagDataCiteMetadataV1Schema,
  targets: evidenceDagExportTargetsV1Schema.optional()
}).strict()

export const evidenceDagExportedProductV1Schema = z.object({
  product: evidenceDagExportProductKindSchema,
  ref: artifactVersionRefV1Schema
}).strict()

export const evidenceDagExportSnapshotProductsOutputSchema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: boundedIdSchema,
  snapshotDigest: sha256DigestSchema,
  transactionId: z.string().trim().startsWith('artifact-commit:').max(256),
  idempotentReplay: z.boolean(),
  products: z.array(evidenceDagExportedProductV1Schema).length(5),
  sourceArtifactVersionRefs: z.array(artifactVersionRefV1Schema).max(10_000)
}).strict().superRefine((value, context) => {
  const products = new Set(value.products.map((item) => item.product))
  if (products.size !== evidenceDagExportProductKindSchema.options.length) {
    context.addIssue({
      code: 'custom',
      path: ['products'],
      message: 'An export receipt must contain each Evidence product exactly once.'
    })
  }
})

/**
 * JSON-safe payload accepted when a generic workbench activation targets the
 * Evidence DAG contribution. Session identity normally comes from the panel
 * render context; runtimeId/threadId are optional so another contribution can
 * explicitly activate a different known Evidence thread.
 */
export const evidenceDagActivationPayloadSchema = z.object({
  view: z.enum(['graph', 'attention']).default('graph'),
  runtimeId: runtimeIdSchema.optional(),
  threadId: boundedIdSchema.optional(),
  snapshotDigest: sha256DigestSchema.optional(),
  nodeId: boundedIdSchema.optional()
}).strict().superRefine((value, context) => {
  if (Boolean(value.runtimeId) === Boolean(value.threadId)) return
  context.addIssue({
    code: 'custom',
    message: 'runtimeId and threadId must be supplied together.'
  })
})

export type EvidenceDagErrorCode = z.infer<typeof evidenceDagErrorCodeSchema>
export type EvidenceDagTypedError = z.infer<typeof evidenceDagTypedErrorSchema>
export type EvidenceDagCommittedSnapshot = z.infer<typeof evidenceDagCommittedSnapshotSchema>
export type EvidenceDagSnapshotIdentity = z.infer<typeof evidenceDagSnapshotIdentitySchema>
export type EvidenceDagPendingUpdate = z.infer<typeof evidenceDagPendingUpdateSchema>
export type EvidenceDagCanonicalStatus = z.infer<typeof evidenceDagCanonicalStatusSchema>
export type EvidenceDagViewInput = z.input<typeof evidenceDagViewInputSchema>
export type EvidenceDagViewOutput = z.infer<typeof evidenceDagViewOutputSchema>
export type EvidenceDagSnapshotStatusInput = z.infer<
  typeof evidenceDagSnapshotStatusInputSchema
>
export type EvidenceDagUpdateInput = z.input<typeof evidenceDagUpdateInputSchema>
export type EvidenceDagUpdateOutput = z.infer<typeof evidenceDagUpdateOutputSchema>
export type EvidenceDagPriorityInput = z.infer<typeof evidenceDagPriorityInputSchema>
export type EvidenceDagPriorityOutput = z.infer<typeof evidenceDagPriorityOutputSchema>
export type EvidenceSourceSelector = z.infer<typeof evidenceSourceSelectorSchema>
export type EvidenceDagArtifactVersionRecordV1 = z.infer<
  typeof evidenceDagArtifactVersionRecordV1Schema
>
export type EvidenceDagArtifactVersionProjectionV1 = z.infer<
  typeof evidenceDagArtifactVersionProjectionV1Schema
>
export type { ArtifactVersionRefV1 }
export type EvidenceDagPreviewInput = z.infer<typeof evidenceDagPreviewInputSchema>
export type EvidenceDagPreviewOutput = z.infer<typeof evidenceDagPreviewOutputSchema>
export type EvidenceDagExportProductKind = z.infer<
  typeof evidenceDagExportProductKindSchema
>
export type EvidenceDagDataCiteMetadataV1 = z.infer<
  typeof evidenceDagDataCiteMetadataV1Schema
>
export type EvidenceDagExportTargetsV1 = z.infer<
  typeof evidenceDagExportTargetsV1Schema
>
export type EvidenceDagExportSnapshotProductsInput = z.infer<
  typeof evidenceDagExportSnapshotProductsInputSchema
>
export type EvidenceDagExportSnapshotProductsOutput = z.infer<
  typeof evidenceDagExportSnapshotProductsOutputSchema
>
export type EvidenceDagActivationPayload = z.input<typeof evidenceDagActivationPayloadSchema>
