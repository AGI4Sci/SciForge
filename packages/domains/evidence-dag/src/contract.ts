import { z } from 'zod'

const boundedIdSchema = z.string().trim().min(1).max(512)
const runtimeIdSchema = z.string().trim().min(1).max(128)
const watermarkSchema = z.string().trim().min(1).max(512)
const timestampSchema = z.string().datetime({ offset: true })
const sha256DigestSchema = z.string().trim().toLowerCase().regex(/^sha256:[0-9a-f]{64}$/u)

export const EVIDENCE_DAG_RESOURCE_KIND = 'evidence-dag' as const

export const EVIDENCE_DAG_CAPABILITY_IDS = Object.freeze({
  view: 'evidence-dag.view',
  update: 'evidence-dag.update',
  priority: 'evidence-dag.priority',
  resolvePreview: 'evidence-dag.resolve-evidence-preview'
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
  threadId: boundedIdSchema.optional()
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
  visible: z.boolean()
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

export const evidenceDagPreviewInputSchema = z.object({
  runtimeId: runtimeIdSchema,
  threadId: boundedIdSchema,
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
export type EvidenceDagUpdateInput = z.input<typeof evidenceDagUpdateInputSchema>
export type EvidenceDagUpdateOutput = z.infer<typeof evidenceDagUpdateOutputSchema>
export type EvidenceDagPriorityInput = z.infer<typeof evidenceDagPriorityInputSchema>
export type EvidenceDagPriorityOutput = z.infer<typeof evidenceDagPriorityOutputSchema>
export type EvidenceSourceSelector = z.infer<typeof evidenceSourceSelectorSchema>
export type EvidenceDagPreviewInput = z.infer<typeof evidenceDagPreviewInputSchema>
export type EvidenceDagPreviewOutput = z.infer<typeof evidenceDagPreviewOutputSchema>
export type EvidenceDagActivationPayload = z.input<typeof evidenceDagActivationPayloadSchema>
