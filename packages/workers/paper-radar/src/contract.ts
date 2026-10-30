import { z } from 'zod'

export const PAPER_RADAR_SERVICE_VERSION = '0.1.0'
export const PAPER_RADAR_WRITE_OPERATIONS = [
  'paper_profile_save',
  'paper_profile_sync'
] as const

export type PaperRadarWriteOperation = typeof PAPER_RADAR_WRITE_OPERATIONS[number]

export const paperRadarWriteOperationSchema = z.enum(PAPER_RADAR_WRITE_OPERATIONS)
export const paperRadarServiceSideEffectSchema = z.enum(['read_only', 'write', 'destructive'])

export type PaperRadarServiceSideEffect = z.infer<typeof paperRadarServiceSideEffectSchema>

export const paperSourceSchema = z.enum(['arxiv', 'biorxiv'])
export const paperRelevanceSchema = z.enum(['high', 'medium', 'low'])
export const paperRadarErrorCodeSchema = z.enum([
  'invalid_input',
  'not_found',
  'upstream_error',
  'sqlite_error',
  'aborted',
  'unknown'
])

const trimmedString = (max = 16_384) => z.string().trim().min(1).max(max)
const optionalTrimmedString = (max = 16_384) => z.string().trim().max(max).optional()
const dateString = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const stringList = z.array(z.string().trim().min(1).max(256)).max(100)
const optionalStringList = stringList.optional()
const topKSchema = z.number().int().min(1).max(100).optional()
const maxRecordsSchema = z.number().int().min(1).max(2_000).optional()

export const paperRecordSchema = z.object({
  id: z.string(),
  source: paperSourceSchema,
  externalId: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  abstract: z.string(),
  categories: z.array(z.string()),
  subjects: z.array(z.string()),
  publishedAt: z.string(),
  updatedAt: z.string().optional(),
  doi: z.string().optional(),
  absUrl: z.string(),
  pdfUrl: z.string().optional()
}).passthrough()

export const rankedPaperSchema = paperRecordSchema.extend({
  score: z.number(),
  reason: z.string(),
  relevance: paperRelevanceSchema.optional()
}).passthrough()

export const paperProfileSchema = z.object({
  name: trimmedString(80).describe('Stable profile name. Unsafe characters are normalized to underscores.'),
  description: optionalTrimmedString(2_000),
  keywords: stringList.describe('Positive keywords used for ranking and digest relevance.'),
  excludeKeywords: stringList.describe('Keywords that suppress matching papers.'),
  arxivCategories: stringList.describe('arXiv categories or roots, for example cs.LG or q-bio.'),
  biorxivSubjects: stringList.describe('bioRxiv subject names, for example bioinformatics.')
}).strict()

export const paperProfileListInputSchema = z.object({}).strict()

export const paperProfileSaveInputSchema = z.object({
  name: trimmedString(80),
  description: optionalTrimmedString(2_000),
  keywords: stringList,
  exclude_keywords: stringList.default([]),
  arxiv_categories: stringList.default([]),
  biorxiv_subjects: stringList.default([])
}).strict()

export const paperProfileSyncInputSchema = z.object({
  profile: optionalTrimmedString(80).describe('Profile name. Defaults to the configured default profile.'),
  from: dateString.optional(),
  to: dateString.optional(),
  max_records: maxRecordsSchema
}).strict()

export const paperSearchInputSchema = z.object({
  query: optionalTrimmedString(2_000),
  sources: z.array(paperSourceSchema).max(2).optional(),
  categories: optionalStringList,
  from: dateString.optional(),
  to: dateString.optional(),
  top_k: topKSchema
}).strict()

export const paperRankInputSchema = paperSearchInputSchema.extend({
  profile: optionalTrimmedString(80),
  keywords: optionalStringList,
  exclude_keywords: optionalStringList,
  days: z.number().int().min(1).max(365).optional()
}).strict()

export const paperDigestInputSchema = paperRankInputSchema

export const paperStatsSchema = z.object({
  papers: z.number().int().nonnegative(),
  arxiv: z.number().int().nonnegative(),
  biorxiv: z.number().int().nonnegative()
}).strict()

export const paperSyncStateRecordSchema = z.object({
  source: paperSourceSchema,
  key: z.string(),
  value: z.string(),
  updatedAt: z.string()
}).strict()

export const paperRadarErrorPayloadSchema = z.object({
  code: paperRadarErrorCodeSchema,
  reason: z.string(),
  retryable: z.boolean(),
  suggestion: z.string(),
  status: z.number().int().min(100).max(599).optional(),
  auditId: z.string().optional(),
  sideEffect: paperRadarServiceSideEffectSchema.optional(),
  operation: z.string().optional()
}).passthrough()

export type PaperSource = z.infer<typeof paperSourceSchema>
export type PaperRecord = z.infer<typeof paperRecordSchema>
export type RankedPaper = z.infer<typeof rankedPaperSchema>
export type PaperProfile = z.infer<typeof paperProfileSchema>
export type PaperProfileListInput = z.infer<typeof paperProfileListInputSchema>
export type PaperProfileSaveInput = z.infer<typeof paperProfileSaveInputSchema>
export type PaperProfileSyncInput = z.infer<typeof paperProfileSyncInputSchema>
export type PaperSearchInput = z.infer<typeof paperSearchInputSchema>
export type PaperRankInput = z.infer<typeof paperRankInputSchema>
export type PaperDigestInput = z.infer<typeof paperDigestInputSchema>
export type PaperStats = z.infer<typeof paperStatsSchema>
export type PaperSyncStateRecord = z.infer<typeof paperSyncStateRecordSchema>
export type PaperRadarErrorCode = z.infer<typeof paperRadarErrorCodeSchema>
export type PaperRadarErrorPayload = z.infer<typeof paperRadarErrorPayloadSchema>

export class PaperRadarWorkerError extends Error {
  readonly code: PaperRadarErrorCode
  readonly retryable: boolean
  readonly suggestion: string
  readonly status?: number
  private readonly extra: Record<string, unknown>

  constructor(payload: PaperRadarErrorPayload) {
    super(payload.reason)
    this.name = 'PaperRadarWorkerError'
    this.code = payload.code
    this.retryable = payload.retryable
    this.suggestion = payload.suggestion
    this.status = payload.status
    const {
      code: _code,
      reason: _reason,
      retryable: _retryable,
      suggestion: _suggestion,
      status: _status,
      ...extra
    } = payload
    this.extra = extra
  }

  toPayload(): PaperRadarErrorPayload {
    return {
      code: this.code,
      reason: this.message,
      retryable: this.retryable,
      suggestion: this.suggestion,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...this.extra
    }
  }
}

export function paperRadarErrorPayloadFromUnknown(
  error: unknown,
  fallback: Partial<PaperRadarErrorPayload> = {}
): PaperRadarErrorPayload {
  if (error instanceof PaperRadarWorkerError) return error.toPayload()
  if (error instanceof z.ZodError) {
    return {
      code: 'invalid_input',
      reason: 'Invalid Paper Radar service input.',
      retryable: false,
      suggestion: fallback.suggestion ?? 'Check the service schema and retry with valid Paper Radar arguments.',
      issues: error.issues.slice(0, 5).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      code: 'aborted',
      reason: error.message || fallback.reason || 'Paper Radar request was aborted.',
      retryable: false,
      suggestion: fallback.suggestion ?? 'Retry the request if it was cancelled accidentally.'
    }
  }
  if (error instanceof Error && /SQLITE|sqlite/i.test(error.message)) {
    return {
      code: 'sqlite_error',
      reason: error.message,
      retryable: false,
      suggestion: fallback.suggestion ?? 'Check the Paper Radar database path and SQLite file permissions.'
    }
  }
  if (error instanceof Error && /arXiv|bioRxiv|HTTP|fetch|network/i.test(error.message)) {
    return {
      code: 'upstream_error',
      reason: error.message,
      retryable: true,
      suggestion: fallback.suggestion ?? 'Retry later or reduce the requested sync window.'
    }
  }
  return {
    code: fallback.code ?? 'unknown',
    reason: error instanceof Error ? error.message : fallback.reason ?? String(error),
    retryable: fallback.retryable ?? false,
    suggestion: fallback.suggestion ?? 'Check the Paper Radar service input and local worker logs.'
  }
}
