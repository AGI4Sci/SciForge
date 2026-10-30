import { z } from 'zod'

/**
 * Neutral read-port contracts consumed by the Host-side `research-audit.query`
 * projection (openspec/changes/seal-evidence-versioning-audit design §4.2).
 *
 * The projection is a cross-domain Host feature: it invokes three landed
 * per-domain read ports and merges their bounded read models. Those port
 * contracts are canonical here — in the SDK — so the Host validates broker
 * results against public SDK contracts only, never by importing a domain
 * contract package. The owning domains re-export these definitions under
 * their package names and keep owning their implementations, record business
 * rules, and write-side contracts.
 */

/** Read capabilities the projection is allowed to invoke; all declare `effect: 'read'`. */
export const RESEARCH_AUDIT_READ_PORT_CAPABILITY_IDS = Object.freeze({
  evidenceAuditQuery: 'evidence-dag.audit-query',
  sessionChangeListChanges: 'change-inspector.list-changes',
  projectReadRecords: 'project-dag.read-records'
} as const)

const boundedIdSchema = z.string().trim().min(1).max(512)
const timestampSchema = z.string().datetime({ offset: true })
const sha256DigestSchema = z.string().trim().toLowerCase().regex(/^sha256:[0-9a-f]{64}$/u)

/**
 * Shared Artifact Version identity. Canonical here because the audit subject
 * pins it across the evidence-dag and project-dag ports; the artifact-versions
 * domain re-exports it under its own contract name.
 */
const identifierSchema = z.string().trim().min(1).max(256)
const artifactIdSchema = identifierSchema.startsWith('artifact:')
const versionIdSchema = identifierSchema.startsWith('artifact-version:')
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const mediaTypeSchema = z.string().trim().regex(/^[^\s/]+\/[^\s/]+$/).max(256)

export const artifactVersionAvailabilityV1Schema = z.enum([
  'available',
  'missing',
  'remote'
])

export const artifactVersionRetentionV1Schema = z.enum(['snapshot', 'reference'])

export const artifactVersionAccessPolicyV1Schema = z.object({
  visibility: z.enum(['workspace', 'restricted', 'public']),
  principals: z.array(z.string().trim().min(1).max(512)).max(1_000),
  allowExport: z.boolean()
}).strict().superRefine((value, context) => {
  if (value.visibility === 'restricted' && value.principals.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['principals'],
      message: 'Restricted access requires at least one principal.'
    })
  }
})

export const artifactVersionRefV1Schema = z.object({
  artifactId: artifactIdSchema,
  versionId: versionIdSchema,
  contentDigest: sha256Schema,
  byteLength: z.number().int().nonnegative(),
  mediaType: mediaTypeSchema.optional(),
  availability: artifactVersionAvailabilityV1Schema,
  retention: artifactVersionRetentionV1Schema,
  accessPolicy: artifactVersionAccessPolicyV1Schema
}).strict()

export type ArtifactVersionRefV1 = z.infer<typeof artifactVersionRefV1Schema>
export type ArtifactVersionAccessPolicyV1 = z.infer<
  typeof artifactVersionAccessPolicyV1Schema
>

/** Shared five-value freshness vocabulary (seal-evidence-versioning design §4.4); no new coinage. */
export const researchAuditFreshnessSchema = z.enum([
  'fresh',
  'stale',
  'pending',
  'failed',
  'unknown'
])
export type ResearchAuditFreshness = z.infer<typeof researchAuditFreshnessSchema>

/**
 * Exactly one subject identity selects the audit records (evidence-dag audit
 * read port). `threadId` is the Evidence engine thread identity (for example
 * `codex:thread-1`); the artifact-version variant pins an exact
 * `artifactId` + `versionId` + `contentDigest` identity, never a prefix.
 */
export const researchAuditSubjectSchema = z.union([
  z.object({ closureDigest: sha256DigestSchema }).strict(),
  z.object({
    threadId: boundedIdSchema,
    headDigest: sha256DigestSchema.optional()
  }).strict(),
  z.object({ artifactVersionRef: artifactVersionRefV1Schema }).strict()
])
export type ResearchAuditSubject = z.infer<typeof researchAuditSubjectSchema>

export const researchAuditEvidenceSidechainRecordTypeSchema = z.enum([
  'audit',
  'finding',
  'review',
  'decision',
  'approval'
])
export type ResearchAuditEvidenceSidechainRecordType = z.infer<
  typeof researchAuditEvidenceSidechainRecordTypeSchema
>

/** Append-only Evidence sidechain records created from, but never backfilled into, a closure. */
export const researchAuditEvidenceSidechainRecordV1Schema = z.object({
  recordDigest: sha256DigestSchema,
  threadId: boundedIdSchema,
  sequence: z.number().int().positive(),
  recordId: boundedIdSchema,
  recordType: researchAuditEvidenceSidechainRecordTypeSchema,
  closureDigest: sha256DigestSchema,
  idempotencyKey: z.string().trim().min(8).max(512),
  payload: z.record(z.string().trim().min(1).max(256), z.unknown()),
  producerIdentity: boundedIdSchema,
  reviewerIdentity: boundedIdSchema.nullable(),
  createdAt: timestampSchema
}).strict()
export type ResearchAuditEvidenceSidechainRecordV1 = z.infer<
  typeof researchAuditEvidenceSidechainRecordV1Schema
>

/** Output of the `evidence-dag.audit-query` read port. */
export const researchAuditEvidenceAuditQueryOutputSchema = z.object({
  subject: researchAuditSubjectSchema,
  records: z.array(researchAuditEvidenceSidechainRecordV1Schema),
  completeness: z.object({
    complete: z.boolean(),
    gapCodes: z.array(z.string().trim().min(1).max(256)).max(64)
  }).strict(),
  freshness: researchAuditFreshnessSchema,
  source: z.literal('evidence-dag')
}).strict()
export type ResearchAuditEvidenceAuditQueryOutput = z.infer<
  typeof researchAuditEvidenceAuditQueryOutputSchema
>

export const RESEARCH_AUDIT_SESSION_CHANGE_MAX_LIST_CHANGES = 500
export const RESEARCH_AUDIT_SESSION_CHANGE_MAX_SUMMARY_PATCH_BYTES = 1_024

export const researchAuditSessionChangeStatusSchema = z.enum(['running', 'success', 'error'])
export type ResearchAuditSessionChangeStatus = z.infer<
  typeof researchAuditSessionChangeStatusSchema
>

export const researchAuditSessionChangeSummarySchema = z.object({
  id: z.string().trim().min(1).max(512),
  status: researchAuditSessionChangeStatusSchema,
  filePath: z.string().trim().min(1).max(4_096).optional(),
  patch: z.string().max(RESEARCH_AUDIT_SESSION_CHANGE_MAX_SUMMARY_PATCH_BYTES),
  patchBytes: z.number().int().nonnegative(),
  patchTruncated: z.boolean(),
  occurredAt: timestampSchema.optional()
}).strict()
export type ResearchAuditSessionChangeSummary = z.infer<
  typeof researchAuditSessionChangeSummarySchema
>

/** Output of the `change-inspector.list-changes` read port. */
export const researchAuditSessionChangeListChangesOutputSchema = z.object({
  changes: z.array(researchAuditSessionChangeSummarySchema).max(
    RESEARCH_AUDIT_SESSION_CHANGE_MAX_LIST_CHANGES
  ),
  nextCursor: z.string().trim().min(1).max(512).nullable(),
  revision: z.string().trim().min(1).max(256),
  truncated: z.boolean()
}).strict()
export type ResearchAuditSessionChangeListChangesOutput = z.infer<
  typeof researchAuditSessionChangeListChangesOutputSchema
>

const researchAuditProjectIdSchema = z.string().trim().min(1).max(512)
const researchAuditProjectMessageSchema = z.string().trim().min(1).max(4_000)
const researchAuditProjectDigestSchema = z.string()
  .trim()
  .regex(/^[a-z][a-z0-9-]*:[0-9a-f]{64}$/u)

export const researchAuditProjectErrorCodeSchema = z.enum([
  'invalid_request',
  'project_not_found',
  'receipt_not_found',
  'receipt_fingerprint_mismatch',
  'evidence_vector_regression',
  'evidence_snapshot_unavailable',
  'project_compile_failed',
  'snapshot_mismatch',
  'claim_mismatch',
  'provenance_mismatch',
  'access_restricted',
  'unsupported_locator',
  'file_unavailable',
  'upstream_timeout',
  'upstream_unavailable',
  'service_unreachable',
  'internal_error'
])
export type ResearchAuditProjectErrorCode = z.infer<
  typeof researchAuditProjectErrorCodeSchema
>

const researchAuditProjectErrorDetailValueSchema = z.union([
  z.string().max(4_000),
  z.number().finite(),
  z.boolean(),
  z.null()
])

export const researchAuditProjectErrorSchema = z.object({
  code: researchAuditProjectErrorCodeSchema,
  message: researchAuditProjectMessageSchema,
  retryable: z.boolean(),
  details: z.record(
    z.string().trim().min(1).max(128),
    researchAuditProjectErrorDetailValueSchema
  ).optional()
}).strict()
export type ResearchAuditProjectError = z.infer<typeof researchAuditProjectErrorSchema>

/**
 * Result envelope of the `project-dag.read-records` read port. Governance
 * records stay opaque (`z.unknown()`) at this boundary: the owning domain
 * validates them on write, and the projection only maps the stable release
 * subset declared in `ResearchAuditProjectRelease`.
 */
export const researchAuditProjectReadRecordsOutputSchema = z.object({
  records: z.array(z.unknown()),
  nextCursor: z.string().trim().min(1).max(512).nullable()
}).strict()
export type ResearchAuditProjectReadRecordsOutput = z.infer<
  typeof researchAuditProjectReadRecordsOutputSchema
>

export const researchAuditProjectReadRecordsResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    data: researchAuditProjectReadRecordsOutputSchema
  }).strict(),
  z.object({
    ok: z.literal(false),
    error: researchAuditProjectErrorSchema
  }).strict()
])
export type ResearchAuditProjectReadRecordsResult = z.infer<
  typeof researchAuditProjectReadRecordsResultSchema
>

/**
 * Structural read-model shape the projection maps out of project-dag release
 * records. Owner-side validation stays with the project-dag release contract;
 * this type only declares the consumed subset, so a write-side schema change
 * cannot silently alter projection behavior.
 */
export type ResearchAuditProjectRelease = Readonly<{
  releaseId: string
  projectSnapshot: string
  createdAt: string
  outputArtifactVersions: ReadonlyArray<Readonly<{
    artifactVersionId: string
    contentDigest: string
    artifactId?: string
  }>>
}>
