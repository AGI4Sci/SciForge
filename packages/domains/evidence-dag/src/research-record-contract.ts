import { z } from 'zod'
import { artifactVersionRefV1Schema } from '@sciforge/domain-artifact-versions/contract'

const id = z.string().min(1).max(512)
export const researchRecordScopeSchema = z.object({
  runtimeId: id, threadId: id, workspaceRoot: z.string().min(1).max(4096)
}).strict()
export type ResearchRecordScope = z.infer<typeof researchRecordScopeSchema>
export const researchRecordSourceSchema = researchRecordScopeSchema.extend({
  turnId: id, itemId: id, digest: z.string().regex(/^[a-f0-9]{64}$/)
})
export const researchRecordContextBoundarySchema = z.object({
  scope: researchRecordScopeSchema, turnId: id,
  metadata: z.object({ itemId: id, kind: z.literal('compaction'), status: z.string(), occurredAt: z.string().nullable() }).strict(),
  completeness: z.literal('unknown'), hiddenReasoning: z.literal('not-recorded')
}).strict()
export const researchRecordLocksSchema = z.object({ placement: z.boolean(), title: z.boolean(), summary: z.boolean() }).strict()
export const researchRecordStateEntrySchema = z.object({
  id, kind: z.enum(['goal', 'progress', 'negative', 'open']), text: z.string().min(1).max(2000),
  sourceIds: z.array(id).min(1).max(48), status: z.enum(['active', 'resolved']),
  membership: z.enum(['current', 'historical', 'mixed']).optional(),
  resolution: z.object({ note: z.string().min(1).max(2000), sourceIds: z.array(id).min(1).max(48), at: z.string() }).strict().optional()
}).strict()
export const researchRecordSynthesisSchema = z.object({
  revision: z.number().int().min(0), updatedAt: z.string(), entries: z.array(researchRecordStateEntrySchema),
  legacySummary: z.string().max(8000).optional(), summaryLimited: z.boolean(),
  coveredChildRevisions: z.record(z.string(), z.number().int().min(0)).optional(),
  coveredEntryDigests: z.record(z.string(), z.string()).optional(),
  coveredChildMembership: z.record(z.string(), z.string()).optional(),
  coveredChildMetadata: z.record(z.string(), z.string()).optional()
}).strict()
export const researchRecordOrganizationCoverageSchema = z.object({
  observed: z.number().int(), historical: z.number().int(), processed: z.number().int(), assigned: z.number().int(),
  fullExcerpt: z.number().int(), truncated: z.number().int(), unavailable: z.number().int(), changed: z.number().int(),
  unassigned: z.number().int(), pending: z.number().int(), blocked: z.number().int()
}).strict()
export const researchRecordQuerySchema = z.object({
  text: z.string().trim().min(1).max(256).optional(),
  sourceStatus: z.enum(['current', 'changed', 'unavailable', 'unknown']).optional(),
  concern: z.enum(['negative', 'open', 'failed']).optional()
}).strict()
const pagination = {
  // Cursor is reading position only. Any revision, scope or query change
  // invalidates it; the normal Host authorization still runs on every request.
  cursor: z.string().min(1).max(4096).optional(), limit: z.number().int().min(1).max(100).optional(),
  query: researchRecordQuerySchema.optional()
}
export const researchRecordPageSchema = z.object({
  nextCursor: z.string().nullable(), nextOffset: z.number().int().nullable(),
  total: z.number().int(), scanned: z.number().int(), indexBuildNodes: z.number().int(),
  indexRevision: z.number().int()
}).strict()
export const researchRecordNodeSchema = z.object({
  id, parentId: id, kind: z.enum(['phase', 'round', 'step', 'capability', 'event']),
  title: z.string().max(512), summary: z.string().max(8000),
  origin: z.enum(['system', 'model', 'human']), status: z.string().max(128),
  createdAt: z.string(), updatedAt: z.string(),
  recordedRange: z.object({ start: z.string(), end: z.string() }).optional(),
  recentRound: z.object({ id, title: z.string().max(512), summary: z.string().max(8000), status: z.string().max(128) }).optional(),
  source: researchRecordSourceSchema.optional(),
  scope: researchRecordScopeSchema.optional(), turnId: id.optional(),
  locks: researchRecordLocksSchema.optional(), synthesis: researchRecordSynthesisSchema.optional(),
  synthesisStatus: z.enum(['missing', 'pending', 'stale', 'ready', 'unavailable']).optional(),
  organizationCoverage: researchRecordOrganizationCoverageSchema.optional(),
  behaviorCounts: z.object({ total: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), cancelled: z.number().int().nonnegative() }).optional(),
  concernCounts: z.object({ negative: z.number().int(), open: z.number().int() }).strict().optional(),
  counts: z.object({ rounds: z.number(), failedRounds: z.number(), events: z.number() }).optional(),
  sourceStatus: z.enum(['current', 'changed', 'unavailable', 'unknown']).optional(),
  summaryProjection: z.object({
    version: z.literal('research-record-summary-v1'), throughRevision: z.number().int(), synthesisRevision: z.number().int(),
    totalEntries: z.number().int(), negative: z.number().int(), open: z.number().int(),
    totalCoverageMembers: z.number().int(),
    offset: z.number().int(), nextOffset: z.number().int().nullable(), limited: z.boolean(),
    sourceCoverage: z.enum(['observed', 'gaps', 'unknown'])
  }).strict().optional()
}).strict()
export type ResearchRecordNode = z.infer<typeof researchRecordNodeSchema>
export const researchRecordMessageSchema = z.object({
  id, role: z.enum(['user', 'assistant']), text: z.string().max(40000),
  sourceIds: z.array(id), createdAt: z.string(), status: z.enum(['complete', 'failed', 'pending']),
  requestId: id, scopeDigest: z.string(), limited: z.boolean()
}).strict()
/** Store usage is global, reference verification is limited to this authorized
 * record scope. Completeness does not imply complete Session history. */
export const researchSourceRetentionSchema = z.object({
  usageKnown: z.boolean(),
  maxBytes: z.number().int().nonnegative(), usedBytes: z.number().int().nonnegative(),
  maxEntries: z.number().int().nonnegative(), retainedEntries: z.number().int().nonnegative(),
  reservedEntries: z.number().int().nonnegative().optional(),
  missingEntries: z.number().int().nonnegative(), corruptEntries: z.number().int().nonnegative(), rejectedEntries: z.number().int().nonnegative(),
  referencedEntries: z.number().int().nonnegative(), inspectedEntries: z.number().int().nonnegative(),
  complete: z.boolean(), reasons: z.array(z.string().max(256)), policy: z.literal('retain-referenced-no-auto-delete'), exportRequired: z.boolean()
}).strict()
export const researchSourceExportSchema = z.object({
  version: z.literal('research-source-export-v1'), ref: researchRecordSourceSchema.nullable(),
  raw: z.unknown().optional(), complete: z.boolean(), reasons: z.array(z.string()),
  strategy: z.literal('page-authorized-record-nodes; export-one-retained-source-per-view; preserve-ref-and-digest; never-delete-originals')
}).strict()
export const researchRecordViewInputSchema = researchRecordScopeSchema.extend({
  nodeId: id.default('root'), offset: z.number().int().min(0).default(0),
  ...pagination, synthesisOffset: z.number().int().nonnegative().optional(),
  messageOffset: z.number().int().nonnegative().optional(),
  includeSourceExport: z.boolean().optional(),
  includeScientificReview: z.boolean().optional(),
  includeDiscussionContext: z.boolean().optional()
})
export const researchRecordViewOutputSchema = z.object({
  sourceRetention: researchSourceRetentionSchema.optional(),
  sourceExport: researchSourceExportSchema.optional(),
  revision: z.number().int(), node: researchRecordNodeSchema.nullable(),
  ancestors: z.array(researchRecordNodeSchema), children: z.array(researchRecordNodeSchema),
  latestRecordPath: z.array(id),
  page: researchRecordPageSchema.optional(),
  locations: z.array(z.object({ nodeId: id, ancestorIds: z.array(id) }).strict()).optional(),
  messageTotal: z.number().int().optional(),
  messageNextOffset: z.number().int().nullable().optional(),
  totalChildren: z.number().int(), messages: z.array(researchRecordMessageSchema),
  retainedSource: z.enum(['retained', 'not-retained', 'corrupt', 'denied']).optional(),
  rawOrigin: z.enum(['retained', 'live']).optional(),
  raw: z.unknown().optional(), sourceStatus: z.enum(['current', 'changed', 'unavailable']).optional(),
  auditReferences: z.object({ refs: z.array(artifactVersionRefV1Schema).max(8), limited: z.boolean() }).optional(),
  synthesisImpact: z.array(z.object({ id, title: z.string().max(300), status: z.enum(['requires-review', 'no-recorded-impact', 'unknown']), sourceIds: z.array(id).max(48) }).strict()).max(80).optional(),
  discussionContext: z.object({
    evidence: z.array(z.object({ id, ref: researchRecordSourceSchema, excerpt: z.string().max(3000), truncated: z.boolean(), origin: z.enum(['retained', 'live']).optional(), liveStatus: z.enum(['current', 'changed', 'unavailable']).optional() })).max(48),
    summaries: z.array(z.object({ id, title: z.string(), summary: z.string().max(500) })).max(12),
    limited: z.boolean(), totalEvents: z.number().int().min(0)
  }).optional(),
  paused: z.boolean(), model: z.string(), pending: z.number().int(),
  failures: z.array(z.object({ nodeId: id, message: z.string(), at: z.string() })),
  coverage: z.literal('visible-session-snapshots'), lastScanAt: z.string().nullable(),
  auditCoverage: z.object({
    kind: z.literal('visible-session-snapshots'), completeness: z.literal('unknown'),
    contextBoundaries: z.number().int(), hiddenReasoning: z.literal('not-recorded'),
    historicalSourceAvailability: z.literal('unknown')
  }).strict().optional(),
  organizationCoverage: researchRecordOrganizationCoverageSchema
}).strict()
export const researchRecordEditInputSchema = researchRecordScopeSchema.extend({
  requestId: id, expectedRevision: z.number().int(),
  change: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('phase'), nodeId: id.optional(), parentId: id, title: z.string().trim().min(1).max(512), summary: z.string().max(8000).default('') }).strict(),
    z.object({ kind: z.literal('move'), nodeId: id, parentId: id }).strict(),
    z.object({ kind: z.literal('fields'), nodeId: id, title: z.string().trim().min(1).max(512).optional(),
      summary: z.string().max(8000).optional(), locks: researchRecordLocksSchema.partial().optional() }).strict(),
    z.object({ kind: z.literal('settings'), paused: z.boolean(), model: z.string().trim().max(256) }).strict(),
    z.object({ kind: z.literal('retry') }).strict()
  ])
})
export type ResearchRecordView = z.infer<typeof researchRecordViewOutputSchema>
export type ResearchRecordEdit = z.infer<typeof researchRecordEditInputSchema>

export const researchRecordReviewInputSchema = researchRecordScopeSchema.extend({
  nodeId: id.default('root'), mode: z.enum(['changes', 'attention', 'history']).default('changes'),
  sinceSequence: z.number().int().nonnegative().default(0),
  throughSequence: z.number().int().nonnegative().optional(),
  ...pagination,
  offset: z.number().int().nonnegative().default(0)
})
export const researchRecordReviewItemSchema = z.object({
  id, sequence: z.number().int().nonnegative(), nodeId: id, title: z.string(), at: z.string(),
  kind: z.string(), text: z.string(), sourceIds: z.array(id), historical: z.boolean(),
  origin: z.enum(['model', 'human', 'system']), limited: z.boolean(),
  ancestorIds: z.array(id).optional()
}).strict()
export const researchRecordReviewOutputSchema = z.object({
  revision: z.number().int(), latestSequence: z.number().int(), throughSequence: z.number().int(),
  items: z.array(researchRecordReviewItemSchema), total: z.number().int(), nextOffset: z.number().int().nullable(),
  pending: z.number().int(), blocked: z.number().int(),
  page: researchRecordPageSchema.optional(),
  worker: z.enum(['paused', 'foreground', 'cooldown', 'working', 'idle'])
}).strict()
export type ResearchRecordReview = z.infer<typeof researchRecordReviewOutputSchema>
export const researchRecordAuditInputSchema = researchRecordScopeSchema.extend({ sequence: z.number().int().positive() })
export const researchRecordAuditOutputSchema = z.object({
  sourceRetention: researchSourceRetentionSchema.optional(),
  sequence: z.number().int(), at: z.string(), nodeId: id, kind: z.string(),
  origin: z.enum(['model', 'human', 'system']),
  changes: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() }).strict()),
  sources: z.array(z.object({ id, ref: researchRecordSourceSchema, status: z.enum(['current', 'changed', 'unavailable']), retainedSource: z.enum(['retained', 'not-retained', 'corrupt', 'denied']).optional(), rawOrigin: z.enum(['retained', 'live']).optional(), excerpt: z.string().max(3000).optional() }).strict()),
  sourcesLimited: z.boolean(),
  contextBoundary: researchRecordContextBoundarySchema.optional(),
  execution: z.object({ runtimeId: z.string(), threadId: z.string(), turnId: z.string(), requestedModel: z.string() }).strict().nullable(),
  recipe: z.object({ version: z.string(), inputDigest: z.string(), outputDigest: z.string(), dataChars: z.number().int() }).strict().nullable(),
  input: z.string().nullable(), output: z.string().nullable(),
  inputStatus: z.enum(['matched', 'changed', 'unavailable', 'not-recorded', 'not-applicable']),
  outputStatus: z.enum(['matched', 'changed', 'unavailable', 'not-recorded', 'not-applicable'])
}).strict()
export type ResearchRecordAudit = z.infer<typeof researchRecordAuditOutputSchema>

export const RESEARCH_RECORD_ACTIONS = Object.freeze({
  view: 'evidence-dag.record.view', edit: 'evidence-dag.record.edit',
  review: 'evidence-dag.record.review', audit: 'evidence-dag.record.audit'
})
export const researchRecordContracts = Object.freeze({
  view: { actionId: RESEARCH_RECORD_ACTIONS.view, effect: 'read' as const, inputSchema: researchRecordViewInputSchema, outputSchema: researchRecordViewOutputSchema },
  edit: { actionId: RESEARCH_RECORD_ACTIONS.edit, effect: 'compute' as const, inputSchema: researchRecordEditInputSchema, outputSchema: z.object({ revision: z.number().int() }).strict() },
  review: { actionId: RESEARCH_RECORD_ACTIONS.review, effect: 'read' as const, inputSchema: researchRecordReviewInputSchema, outputSchema: researchRecordReviewOutputSchema },
  audit: { actionId: RESEARCH_RECORD_ACTIONS.audit, effect: 'read' as const, inputSchema: researchRecordAuditInputSchema, outputSchema: researchRecordAuditOutputSchema }
})

/** Summaries are projections, never replacements for runtime facts. */
export const researchRecordStatePatchSchema = z.array(z.union([
  z.object({ op: z.literal('add'), kind: z.enum(['goal', 'progress', 'negative', 'open']),
    text: z.string().trim().min(1).max(2000), sourceIds: z.array(id).min(1).max(48) }).strict(),
  z.object({ op: z.literal('resolve'), entryId: id, note: z.string().trim().min(1).max(2000),
    sourceIds: z.array(id).min(1).max(48) }).strict()
])).min(1).max(24)
export const researchRecordClassificationSchema = z.object({
  phasePath: z.array(z.string().trim().min(1).max(160)).max(16),
  title: z.string().trim().min(1).max(512), statePatch: researchRecordStatePatchSchema,
  steps: z.array(z.object({
    title: z.string().trim().min(1).max(512), summary: z.string().max(2000),
    sourceIds: z.array(id).min(1).max(48)
  }).strict()).max(16)
}).strict()
export const researchRecordPhaseSynthesisSchema = z.object({ statePatch: researchRecordStatePatchSchema }).strict()
