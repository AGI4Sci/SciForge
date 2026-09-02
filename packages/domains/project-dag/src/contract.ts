import {
  evidenceDagSnapshotIdentitySchema,
  type EvidenceDagSnapshotIdentity
} from '@sciforge/domain-evidence-dag/contract'
import { z } from 'zod'

const MAX_ID_LENGTH = 512
const MAX_PATH_LENGTH = 16_384
const MAX_URL_LENGTH = 8_192
const MAX_MESSAGE_LENGTH = 4_000
const MAX_SESSIONS = 500

const trimmedIdSchema = z.string().trim().min(1).max(MAX_ID_LENGTH)
const optionalPathSchema = z.string().trim().min(1).max(MAX_PATH_LENGTH).optional()
const timestampSchema = z.string().datetime({ offset: true })
const prefixedDigestSchema = z.string()
  .trim()
  .regex(/^[a-z][a-z0-9-]*:[0-9a-f]{64}$/u)

export const PROJECT_DAG_RESOURCE_KIND = 'project-dag'
export const PROJECT_DAG_SERVICE_URL_ENV = 'SCIFORGE_PROJECT_DAG_SERVICE_URL'
export const PROJECT_DAG_API_KEY_ENV = 'SCIFORGE_PROJECT_DAG_API_KEY'
export const DEFAULT_PROJECT_DAG_SERVICE_URL = 'http://127.0.0.1:3898'
export const PROJECT_DAG_SERVICE_VERSION = '1.0.0'
export const PROJECT_INVALIDATION_POLICY_V1 = 'project-invalidation-policy/v1'
export const DECISION_POLICY_V1 = 'decision-policy/v1'

export const PROJECT_DAG_CAPABILITY_IDS = Object.freeze({
  view: 'project-dag.view',
  update: 'project-dag.update',
  saveGoal: 'project-dag.goal.save',
  resolveEvidencePreview: 'project-dag.evidence-preview.resolve'
} as const)

export const projectDagViewNameSchema = z.enum([
  'home',
  'goals',
  'graph',
  'attention'
])

export const projectDagAutonomyModeSchema = z.enum([
  'autonomous',
  'checkpointed',
  'supervised'
])

/** Public immutable Evidence identity consumed through the Evidence contract only. */
export const projectDagEvidenceVectorEntrySchema = evidenceDagSnapshotIdentitySchema

export const projectDagEvidenceVectorSchema = z.array(
  projectDagEvidenceVectorEntrySchema
).max(MAX_SESSIONS).superRefine((entries, context) => {
  const byThread = new Map<string, string>()
  for (const [index, entry] of entries.entries()) {
    const previous = byThread.get(entry.threadId)
    if (previous && previous !== entry.digest) {
      context.addIssue({
        code: 'custom',
        path: [index, 'digest'],
        message: `Evidence vector has conflicting digests for ${entry.threadId}.`
      })
    }
    byThread.set(entry.threadId, entry.digest)
  }
})

const sessionListSchema = z.array(trimmedIdSchema).max(MAX_SESSIONS)

export const projectDagCapturedScopeSchema = z.object({
  includedSessions: sessionListSchema,
  excludedSessions: sessionListSchema,
  isolatedSessions: sessionListSchema,
  reasons: z.record(trimmedIdSchema, z.string().trim().min(1).max(MAX_MESSAGE_LENGTH)).optional()
}).strict().superRefine((scope, context) => {
  const included = new Set(scope.includedSessions)
  const excluded = new Set(scope.excludedSessions)
  const isolated = new Set(scope.isolatedSessions)
  const reasons = new Set(Object.keys(scope.reasons ?? {}))
  const duplicate = scope.includedSessions.find((sessionId) =>
    excluded.has(sessionId) || isolated.has(sessionId)
  )
  if (duplicate) {
    context.addIssue({
      code: 'custom',
      path: ['includedSessions'],
      message: `Included session ${duplicate} is excluded or isolated.`
    })
  }
  const conflictingDisposition = scope.excludedSessions.find((sessionId) =>
    isolated.has(sessionId)
  )
  if (conflictingDisposition) {
    context.addIssue({
      code: 'custom',
      path: ['excludedSessions'],
      message: `Session ${conflictingDisposition} is both excluded and isolated.`
    })
  }
  if (
    included.size !== scope.includedSessions.length ||
    excluded.size !== scope.excludedSessions.length ||
    isolated.size !== scope.isolatedSessions.length
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Captured scope session lists must not contain duplicates.'
    })
  }
  for (const sessionId of reasons) {
    if (!included.has(sessionId) && !excluded.has(sessionId) && !isolated.has(sessionId)) {
      context.addIssue({
        code: 'custom',
        path: ['reasons', sessionId],
        message: `Scope reason references unknown session ${sessionId}.`
      })
    }
  }
})

/** Updates must carry an explicit, caller-selected Session scope. */
export const projectDagRequestedScopeSchema = sessionListSchema.min(
  1,
  'Project updates require at least one explicitly selected Session.'
)

export const projectDagTargetSchema = z.object({
  workspaceRoot: optionalPathSchema,
  projectRoot: optionalPathSchema,
  project: trimmedIdSchema.optional(),
  sessions: sessionListSchema.optional()
}).strict()

/**
 * Process-neutral payload for activating the Project DAG surface.
 * UI callbacks, DOM handles, and host workspace types deliberately stay out.
 */
export const projectDagActivationPayloadSchema = projectDagTargetSchema.extend({
  view: projectDagViewNameSchema.optional(),
  focus: z.object({
    claimId: trimmedIdSchema.optional(),
    nodeId: trimmedIdSchema.optional()
  }).strict().refine(
    (focus) => Boolean(focus.claimId || focus.nodeId),
    'Project DAG focus requires a claimId or nodeId.'
  ).optional()
}).strict()

export const projectDagReceiptStateSchema = z.enum([
  'queued',
  'running',
  'committed',
  'covered',
  'superseded',
  'failed'
])

export const projectDagDurableReceiptSchema = z.object({
  projectKey: trimmedIdSchema,
  jobId: trimmedIdSchema,
  acceptedRequestVersion: z.number().int().positive(),
  desiredFingerprint: prefixedDigestSchema,
  desiredEvidenceVector: projectDagEvidenceVectorSchema,
  capturedScope: projectDagCapturedScopeSchema,
  state: projectDagReceiptStateSchema,
  acceptedAt: timestampSchema,
  updatedAt: timestampSchema
}).strict()

export const projectDagErrorCodeSchema = z.enum([
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
  'internal_error'
])

const projectDagErrorDetailValueSchema = z.union([
  z.string().max(MAX_MESSAGE_LENGTH),
  z.number().finite(),
  z.boolean(),
  z.null()
])

export const projectDagErrorSchema = z.object({
  code: projectDagErrorCodeSchema,
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  retryable: z.boolean(),
  details: z.record(
    z.string().trim().min(1).max(128),
    projectDagErrorDetailValueSchema
  ).optional()
}).strict()

export const projectDagCommittedSnapshotSchema = z.object({
  version: z.number().int().positive(),
  digest: prefixedDigestSchema,
  evidenceVector: projectDagEvidenceVectorSchema,
  createdAt: timestampSchema
}).strict()

export const projectDagPendingStateSchema = z.enum([
  'queued',
  'running',
  'retry_scheduled',
  'failed'
])

export const projectDagPendingStatusSchema = z.object({
  state: projectDagPendingStateSchema,
  receipt: projectDagDurableReceiptSchema,
  attempts: z.number().int().nonnegative(),
  updatedAt: timestampSchema,
  nextAttemptAt: timestampSchema.nullable().optional(),
  error: projectDagErrorSchema.nullable().optional()
}).strict().superRefine((pending, context) => {
  if (pending.state === 'failed' && !pending.error) {
    context.addIssue({
      code: 'custom',
      path: ['error'],
      message: 'A failed Project update must expose its canonical typed error.'
    })
  }
  if (pending.state !== 'failed' && pending.error) {
    context.addIssue({
      code: 'custom',
      path: ['error'],
      message: 'Only a failed Project update may expose a terminal error.'
    })
  }
})

export const projectDagStatusSchema = z.object({
  projectKey: trimmedIdSchema,
  committed: projectDagCommittedSnapshotSchema.nullable(),
  pending: projectDagPendingStatusSchema.nullable(),
  latestReceipt: projectDagDurableReceiptSchema.nullable().optional(),
  scope: projectDagCapturedScopeSchema,
  autonomyMode: projectDagAutonomyModeSchema,
  attentionCount: z.number().int().nonnegative(),
  auditTargetDigest: prefixedDigestSchema.nullable().optional(),
  auditStale: z.boolean().optional(),
  invalidation: z.lazy(() => projectDagInvalidationSchema).nullable().optional(),
  scopeRevisions: z.array(z.object({
    revision: z.number().int().positive(),
    includedSessions: sessionListSchema,
    excludedSessions: sessionListSchema,
    isolatedSessions: sessionListSchema,
    reasons: z.record(trimmedIdSchema, z.string().trim().min(1).max(MAX_MESSAGE_LENGTH)).optional(),
    createdBy: trimmedIdSchema.optional(),
    createdAt: timestampSchema.optional()
  }).strict()).optional()
}).strict()

export const projectDagGoalSchema = z.object({
  id: trimmedIdSchema,
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(MAX_MESSAGE_LENGTH).optional(),
  version: z.number().int().positive()
}).strict()

export const projectDagViewInputSchema = projectDagTargetSchema.extend({
  view: projectDagViewNameSchema.optional()
}).strict()

export const projectDagViewOutputSchema = z.object({
  url: z.string().trim().min(1).max(MAX_URL_LENGTH),
  status: projectDagStatusSchema,
  goal: projectDagGoalSchema.optional()
}).strict()

export const projectDagUpdateInputSchema = projectDagTargetSchema.extend({
  scope: projectDagRequestedScopeSchema.optional(),
  excludedSessions: sessionListSchema.optional(),
  isolatedSessions: sessionListSchema.optional(),
  autonomyMode: projectDagAutonomyModeSchema.optional()
}).strict()

export const projectDagUpdateOutputSchema = z.object({
  url: z.string().trim().min(1).max(MAX_URL_LENGTH),
  receipt: projectDagDurableReceiptSchema,
  status: projectDagStatusSchema
}).strict()

export const projectDagSaveGoalInputSchema = projectDagTargetSchema.extend({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(MAX_MESSAGE_LENGTH).optional(),
  rootGoalId: trimmedIdSchema.optional(),
  autonomyMode: projectDagAutonomyModeSchema.optional()
}).strict()

export const projectDagSaveGoalOutputSchema = z.object({
  goal: projectDagGoalSchema,
  status: projectDagStatusSchema
}).strict()

export const projectDagScopeDraftSchema = z.object({
  includedSessions: sessionListSchema,
  excludedSessions: sessionListSchema,
  isolatedSessions: sessionListSchema,
  reasons: z.record(trimmedIdSchema, z.string().trim().min(1).max(MAX_MESSAGE_LENGTH)).optional(),
  baseRevision: z.number().int().nonnegative().nullable().optional(),
  updatedBy: trimmedIdSchema.optional(),
  updatedAt: timestampSchema.optional()
}).strict()

export const projectDagDecisionActionClassSchema = z.enum([
  'draft_internal_reversible', 'certified_internal', 'public_external',
  'specialized_high_impact'
])

export const projectDagDecisionRuleSchema = z.object({
  agentOnly: z.boolean(),
  requiredRoles: z.array(z.object({
    role: trimmedIdSchema,
    count: z.number().int().positive()
  }).strict()).max(32),
  quorum: z.number().int().nonnegative(),
  allowCertification: z.boolean(),
  trustedRoleSource: trimmedIdSchema.nullable()
}).strict()

export const projectDagDecisionPolicySchema = z.object({
  version: z.literal('decision-policy/v1'),
  rules: z.record(projectDagDecisionActionClassSchema, projectDagDecisionRuleSchema)
}).strict()

export const projectDagInvalidationSchema = z.object({
  projectKey: trimmedIdSchema,
  desiredFingerprint: prefixedDigestSchema.nullable().optional(),
  appliedFingerprint: prefixedDigestSchema.nullable().optional(),
  stale: z.boolean(),
  reason: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH).nullable().optional(),
  changedFields: z.array(trimmedIdSchema).max(128),
  updatedAt: timestampSchema
}).strict()

export const projectDagDecisionV1Schema = z.object({
  decisionId: trimmedIdSchema,
  projectSnapshot: prefixedDigestSchema,
  actionClass: projectDagDecisionActionClassSchema,
  action: trimmedIdSchema,
  target: z.string().trim().max(MAX_MESSAGE_LENGTH).optional(),
  actor: z.object({
    type: z.enum(['agent', 'human', 'tool']),
    id: trimmedIdSchema
  }).strict(),
  rationale: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  alternatives: z.array(z.string().trim().min(1).max(MAX_MESSAGE_LENGTH)).max(100).optional(),
  reversibility: z.string().trim().min(1).max(256),
  policyRef: trimmedIdSchema,
  createdAt: timestampSchema,
  supersedesDecisionId: trimmedIdSchema.nullable().optional()
}).strict()

export const projectDagApprovalV1Schema = z.object({
  approvalId: trimmedIdSchema,
  decisionRef: trimmedIdSchema,
  projectSnapshot: prefixedDigestSchema,
  attestor: trimmedIdSchema,
  trustedRoleAssertionRef: trimmedIdSchema.nullable().optional(),
  attestation: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  policyRef: trimmedIdSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable().optional(),
  revokesApprovalId: trimmedIdSchema.nullable().optional(),
  status: z.enum(['effective', 'expired', 'revoked'])
}).strict()

export const projectDagReleaseArtifactVersionRefSchema = z.object({
  artifactVersionId: trimmedIdSchema,
  contentDigest: prefixedDigestSchema,
  artifactId: trimmedIdSchema.optional(),
  mediaType: z.string().trim().min(1).max(500).optional()
}).strict().superRefine((reference, context) => {
  if (reference.artifactVersionId === 'latest' || reference.artifactVersionId === 'current') {
    context.addIssue({
      code: 'custom',
      path: ['artifactVersionId'],
      message: 'Release outputs must reference an exact Artifact Version identity.'
    })
  }
})

export const projectDagReleaseV1Schema = z.object({
  releaseId: trimmedIdSchema,
  projectSnapshot: prefixedDigestSchema,
  classification: z.enum(['internal', 'certified', 'public']),
  target: z.string().trim().max(MAX_MESSAGE_LENGTH),
  outputArtifactVersions: z.array(projectDagReleaseArtifactVersionRefSchema).max(MAX_SESSIONS),
  auditRefs: z.array(trimmedIdSchema).max(100),
  decisionRefs: z.array(trimmedIdSchema).max(100),
  approvalRefs: z.array(trimmedIdSchema).max(100),
  attemptOutcome: z.string().trim().min(1).max(256),
  createdAt: timestampSchema,
  supersedesReleaseId: trimmedIdSchema.nullable().optional()
}).strict()

export const projectDagSourceSelectorSchema = z.object({
  type: z.enum(['pdf', 'text', 'table', 'figure', 'code', 'dataset', 'web']),
  page: z.number().int().positive().optional(),
  section: z.string().trim().max(1_000).optional(),
  table: z.string().trim().max(1_000).optional(),
  figure: z.string().trim().max(1_000).optional(),
  rowRange: z.string().trim().max(1_000).optional(),
  columnNames: z.array(z.string().trim().min(1).max(500)).max(500).optional(),
  lineRange: z.string().trim().max(1_000).optional(),
  quote: z.string().max(20_000).optional(),
  query: z.record(z.string().max(500), z.unknown()).optional()
}).strict()

export const projectDagResolveEvidencePreviewInputSchema = projectDagTargetSchema.extend({
  workspaceRoot: z.string().trim().min(1).max(MAX_PATH_LENGTH),
  snapshotDigest: prefixedDigestSchema,
  claimId: trimmedIdSchema,
  artifactVersionId: trimmedIdSchema,
  sourceAnchorId: trimmedIdSchema
}).strict()

export const projectDagResolveEvidencePreviewOutputSchema = z.object({
  path: z.string().trim().min(1).max(MAX_PATH_LENGTH),
  workspaceRoot: z.string().trim().min(1).max(MAX_PATH_LENGTH),
  snapshotDigest: prefixedDigestSchema,
  claimId: trimmedIdSchema,
  artifactId: trimmedIdSchema.optional(),
  artifactVersionId: trimmedIdSchema,
  sourceAnchorId: trimmedIdSchema,
  selector: projectDagSourceSelectorSchema,
  contentDigest: prefixedDigestSchema.optional(),
  anchorDigest: prefixedDigestSchema.optional(),
  mediaType: z.string().trim().min(1).max(500).optional()
}).strict()

export function projectDagOperationResultSchema<TSchema extends z.ZodType>(
  dataSchema: TSchema
) {
  return z.discriminatedUnion('ok', [
    z.object({
      ok: z.literal(true),
      data: dataSchema
    }).strict(),
    z.object({
      ok: z.literal(false),
      error: projectDagErrorSchema
    }).strict()
  ])
}

export function normalizeProjectDagServiceUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().replace(/\/+$/u, '') : ''
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.toString().replace(/\/+$/u, '')
  } catch {
    return ''
  }
}

export function projectDagServiceUrlFromEnv(
  environment: Readonly<Record<string, string | undefined>>
): string {
  return normalizeProjectDagServiceUrl(environment[PROJECT_DAG_SERVICE_URL_ENV])
}

export function projectDagApiKeyFromEnv(
  environment: Readonly<Record<string, string | undefined>>
): string {
  return (environment[PROJECT_DAG_API_KEY_ENV] ?? '').trim()
}

export function projectDagUiUrl(input: {
  serviceUrl?: string
  apiKey?: string | null
  view?: 'home' | 'goals' | 'graph' | 'updates'
  embed?: boolean
  workspaceRoot?: string | null
  projectRoot?: string | null
  project?: string | null
  sessionIds?: readonly string[] | null
}): string {
  const base = normalizeProjectDagServiceUrl(input.serviceUrl) ||
    DEFAULT_PROJECT_DAG_SERVICE_URL
  const url = new URL(`${base}/`)
  if (input.view) url.searchParams.set('view', input.view)
  if (input.embed) url.searchParams.set('embed', '1')
  if (input.workspaceRoot?.trim()) {
    url.searchParams.set('workspaceRoot', input.workspaceRoot.trim())
  }
  if (input.projectRoot?.trim()) {
    url.searchParams.set('projectRoot', input.projectRoot.trim())
  }
  if (input.project?.trim()) url.searchParams.set('project', input.project.trim())
  for (const sessionId of input.sessionIds ?? []) {
    if (sessionId.trim()) url.searchParams.append('session', sessionId.trim())
  }
  if (input.apiKey?.trim()) {
    const hash = new URLSearchParams()
    hash.set('token', input.apiKey.trim())
    url.hash = hash.toString()
  }
  return url.toString()
}

export const projectDagViewResultSchema =
  projectDagOperationResultSchema(projectDagViewOutputSchema)
export const projectDagUpdateResultSchema =
  projectDagOperationResultSchema(projectDagUpdateOutputSchema)
export const projectDagSaveGoalResultSchema =
  projectDagOperationResultSchema(projectDagSaveGoalOutputSchema)
export const projectDagResolveEvidencePreviewResultSchema =
  projectDagOperationResultSchema(projectDagResolveEvidencePreviewOutputSchema)

export type ProjectDagViewName = z.infer<typeof projectDagViewNameSchema>
export type ProjectDagAutonomyMode = z.infer<typeof projectDagAutonomyModeSchema>
export type ProjectDagEvidenceVectorEntry = EvidenceDagSnapshotIdentity
export type ProjectDagCapturedScope = z.infer<typeof projectDagCapturedScopeSchema>
export type ProjectDagRequestedScope = z.infer<typeof projectDagRequestedScopeSchema>
export type ProjectDagTarget = z.infer<typeof projectDagTargetSchema>
export type ProjectDagActivationPayload = z.infer<
  typeof projectDagActivationPayloadSchema
>
export type ProjectDagReceiptState = z.infer<typeof projectDagReceiptStateSchema>
export type ProjectDagDurableReceipt = z.infer<typeof projectDagDurableReceiptSchema>
export type ProjectDagErrorCode = z.infer<typeof projectDagErrorCodeSchema>
export type ProjectDagError = z.infer<typeof projectDagErrorSchema>
export type ProjectDagCommittedSnapshot = z.infer<
  typeof projectDagCommittedSnapshotSchema
>
export type ProjectDagPendingStatus = z.infer<typeof projectDagPendingStatusSchema>
export type ProjectDagStatus = z.infer<typeof projectDagStatusSchema>
export type ProjectDagGoal = z.infer<typeof projectDagGoalSchema>
export type ProjectDagViewInput = z.infer<typeof projectDagViewInputSchema>
export type ProjectDagViewOutput = z.infer<typeof projectDagViewOutputSchema>
export type ProjectDagUpdateInput = z.infer<typeof projectDagUpdateInputSchema>
export type ProjectDagUpdateOutput = z.infer<typeof projectDagUpdateOutputSchema>
export type ProjectDagSaveGoalInput = z.infer<typeof projectDagSaveGoalInputSchema>
export type ProjectDagSaveGoalOutput = z.infer<typeof projectDagSaveGoalOutputSchema>
export type ProjectDagScopeDraft = z.infer<typeof projectDagScopeDraftSchema>
export type ProjectDagDecisionActionClass = z.infer<typeof projectDagDecisionActionClassSchema>
export type ProjectDagDecisionRule = z.infer<typeof projectDagDecisionRuleSchema>
export type ProjectDagDecisionPolicy = z.infer<typeof projectDagDecisionPolicySchema>
export type ProjectDagInvalidation = z.infer<typeof projectDagInvalidationSchema>
export type ProjectDagDecisionV1 = z.infer<typeof projectDagDecisionV1Schema>
export type ProjectDagApprovalV1 = z.infer<typeof projectDagApprovalV1Schema>
export type ProjectDagReleaseV1 = z.infer<typeof projectDagReleaseV1Schema>
export type ProjectDagReleaseArtifactVersionRef = z.infer<
  typeof projectDagReleaseArtifactVersionRefSchema
>
export type ProjectDagSourceSelector = z.infer<typeof projectDagSourceSelectorSchema>
export type ProjectDagResolveEvidencePreviewInput = z.infer<
  typeof projectDagResolveEvidencePreviewInputSchema
>
export type ProjectDagResolveEvidencePreviewOutput = z.infer<
  typeof projectDagResolveEvidencePreviewOutputSchema
>
export type ProjectDagViewResult = z.infer<typeof projectDagViewResultSchema>
export type ProjectDagUpdateResult = z.infer<typeof projectDagUpdateResultSchema>
export type ProjectDagSaveGoalResult = z.infer<typeof projectDagSaveGoalResultSchema>
export type ProjectDagResolveEvidencePreviewResult = z.infer<
  typeof projectDagResolveEvidencePreviewResultSchema
>
