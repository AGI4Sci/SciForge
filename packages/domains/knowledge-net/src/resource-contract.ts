import { z } from 'zod'

export const KNOWLEDGE_RESOURCE_KIND = 'knowledge-net.resource'
export const KNOWLEDGE_RESOURCE_CAPABILITY_IDS = Object.freeze({
  commit: 'knowledge-net.resource.commit', search: 'knowledge-net.resource.search'
})

const text = z.string().trim().min(1).max(512)
const detail = z.string().trim().min(1).max(4096)
const ids = z.array(text).max(200)
const timestamp = z.iso.datetime({ offset: true })
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const publicUrl = z.url({ protocol: /^https?$/ }).max(4096).refine((value) => {
  const url = new URL(value)
  if (url.username || url.password) return false
  return ![...url.searchParams.keys()].some((key) =>
    /^(x-amz-|x-goog-|signature$|sig$|token$|access_token$|api[_-]?key$)/i.test(key))
}, 'URLs must not contain credentials or temporary signed access parameters.')

export const resourceAccessModeSchema = z.enum(['open', 'registration', 'application', 'closed', 'unknown'])
export const resourceProcessingLevelSchema = z.enum(['raw', 'processed', 'derived', 'mixed', 'unknown'])
export const resourceCheckKindSchema = z.enum(['source_report', 'official_page', 'retrieval', 'integrity'])
export const resourceEvidenceSchema = z.strictObject({
  evidenceId: text, url: publicUrl.optional(), paperId: text.optional(), locator: detail.optional(),
  quote: detail, observedAt: timestamp, actorLabel: text
}).refine((value) => value.url !== undefined || value.paperId !== undefined, 'Evidence requires a URL or paper source.')
export const resourceCheckSchema = z.strictObject({
  checkId: text, kind: resourceCheckKindSchema, outcome: z.enum(['confirmed', 'failed', 'inconclusive']),
  observedAt: timestamp, evidenceIds: ids.min(1), detail: detail.optional(),
  source: text.optional(), supersedesCheckId: text.optional(),
  integrity: z.strictObject({ algorithm: z.literal('sha256'), expectedDigest: digest, actualDigest: digest }).optional()
}).superRefine((value, ctx) => {
  if (value.kind === 'source_report' && !value.source) ctx.addIssue({ code: 'custom', message: 'Source reports require a source.', path: ['source'] })
  if (value.kind === 'integrity' && value.outcome === 'confirmed' &&
    (!value.integrity || value.integrity.expectedDigest !== value.integrity.actualDigest)) {
    ctx.addIssue({ code: 'custom', message: 'Confirmed integrity requires matching expected and actual SHA-256 digests.', path: ['integrity'] })
  }
  if (value.integrity && value.kind !== 'integrity') ctx.addIssue({ code: 'custom', message: 'Integrity facts require an integrity check.', path: ['integrity'] })
})

export const knowledgeResourceSchema = z.strictObject({
  schemaVersion: z.literal(1), name: text, aliases: ids, identifiers: z.array(z.strictObject({ scheme: text, value: text })).max(100),
  version: text.optional(), parentResourceId: text.optional(), description: detail,
  dataTypes: ids.min(1), processingLevel: resourceProcessingLevelSchema, formats: ids.optional(), sizeDescription: detail.optional(),
  locations: z.array(z.strictObject({ url: publicUrl, role: z.enum(['landing', 'download', 'documentation']) })).max(100),
  access: z.strictObject({ mode: resourceAccessModeSchema, details: detail.optional(), evidenceIds: ids }),
  license: z.strictObject({ name: text, url: publicUrl.optional(), evidenceIds: ids.min(1) }).optional(),
  paperLinks: z.array(z.strictObject({ paperId: text, relation: z.enum(['used', 'produced', 'mentioned']), evidenceIds: ids.min(1) })).max(200),
  evidence: z.array(resourceEvidenceSchema).max(1000), checks: z.array(resourceCheckSchema).max(1000)
}).superRefine((value, ctx) => {
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })
  const evidenceIds = new Set(value.evidence.map((item) => item.evidenceId))
  const checkIds = new Set(value.checks.map((item) => item.checkId))
  if (evidenceIds.size !== value.evidence.length) issue('Evidence IDs must be unique.', ['evidence'])
  if (checkIds.size !== value.checks.length) issue('Check IDs must be unique.', ['checks'])
  if (value.access.mode !== 'unknown' && !value.access.evidenceIds.length) issue('Declared access requires evidence.', ['access', 'evidenceIds'])
  const checkRefs = (refs: string[], path: (string | number)[]) => {
    if (refs.some((id) => !evidenceIds.has(id))) issue('Unresolved evidence reference.', path)
  }
  checkRefs(value.access.evidenceIds, ['access', 'evidenceIds'])
  if (value.license) checkRefs(value.license.evidenceIds, ['license', 'evidenceIds'])
  value.paperLinks.forEach((link, i) => checkRefs(link.evidenceIds, ['paperLinks', i, 'evidenceIds']))
  // Corrections point backward in the append-only observation sequence, ruling out cycles.
  const previous = new Set<string>()
  value.checks.forEach((check, i) => {
    checkRefs(check.evidenceIds, ['checks', i, 'evidenceIds'])
    if (check.supersedesCheckId && !previous.has(check.supersedesCheckId)) issue('Corrections must reference an earlier check.', ['checks', i, 'supersedesCheckId'])
    previous.add(check.checkId)
  })
})
export type KnowledgeResource = z.infer<typeof knowledgeResourceSchema>
export type ResourceCheck = z.infer<typeof resourceCheckSchema>

export const resourceCommitInputSchema = z.strictObject({
  operationId: z.string().trim().min(8).max(200), resourceId: text.optional(),
  expectedVersionId: text.nullable(), resource: knowledgeResourceSchema
}).superRefine((value, ctx) => {
  if (Boolean(value.resourceId) !== Boolean(value.expectedVersionId)) ctx.addIssue({ code: 'custom', message: 'Creation omits resourceId and uses a null baseline; updates require both IDs.' })
  if (value.resourceId && value.resource.parentResourceId === value.resourceId) ctx.addIssue({ code: 'custom', message: 'A resource cannot be its own parent.', path: ['resource', 'parentResourceId'] })
})
export type ResourceCommitInput = z.infer<typeof resourceCommitInputSchema>
export const resourceCommitResultSchema = z.strictObject({ resourceId: text, versionId: text, contentDigest: digest })

export const sealedResourceSchema = z.strictObject({
  resourceId: text, versionId: text, contentDigest: digest, sealedAt: timestamp, resource: knowledgeResourceSchema
})
export type SealedResource = z.infer<typeof sealedResourceSchema>
export const resourceSearchInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(512).optional(), resourceId: text.optional(), paperId: text.optional(), parentResourceId: text.optional(),
  dataTypes: ids.min(1).optional(), accessModes: z.array(resourceAccessModeSchema).min(1).max(5).optional(),
  processingLevels: z.array(resourceProcessingLevelSchema).min(1).max(5).optional(),
  limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).max(4096).optional()
})
export type ResourceSearchInput = z.infer<typeof resourceSearchInputSchema>
export const resourceRelationIssueSchema = z.strictObject({ resourceId: text, code: z.enum(['unresolved_parent', 'self_parent', 'parent_cycle']), parentResourceId: text })
export const resourceSearchResultSchema = z.strictObject({
  status: z.enum(['hit', 'no_recorded_match', 'coverage_unknown']),
  resources: z.array(sealedResourceSchema.extend({ latestChecks: z.array(resourceCheckSchema) })),
  duplicateCandidates: z.array(z.strictObject({ resourceId: text, otherResourceId: text, identifiers: z.array(z.strictObject({ scheme: text, value: text })) })),
  relationIssues: z.array(resourceRelationIssueSchema), nextCursor: z.string().nullable(),
  derivedFrom: z.strictObject({ coverage: z.enum(['complete', 'partial']), coverageReasons: z.array(z.string()), eventsScanned: z.number(),
    versionsScanned: z.number(), resources: z.number(), skipped: z.array(z.strictObject({ versionId: z.string(), reason: z.string() })) })
})

/** Preserve exact prefix values, not merely IDs; corrections append new observations. */
export function validateResourceUpdate(baseline: KnowledgeResource, next: KnowledgeResource): string | null {
  for (const field of ['evidence', 'checks'] as const) {
    if (baseline[field].some((item, i) => JSON.stringify(item) !== JSON.stringify(next[field][i]))) {
      return `Existing ${field} must remain an unchanged prefix; append corrections instead.`
    }
  }
  return null
}
