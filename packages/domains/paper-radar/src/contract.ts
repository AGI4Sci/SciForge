import { z } from 'zod'

export const PAPER_RADAR_CAPABILITY_IDS = {
  status: 'paper-radar.status',
  syncArxiv: 'paper-radar.sync-arxiv',
  syncBiorxiv: 'paper-radar.sync-biorxiv',
  syncProfile: 'paper-radar.sync-profile',
  listProfiles: 'paper-radar.profiles.list',
  saveProfile: 'paper-radar.profiles.save',
  review: 'paper-radar.review',
  search: 'paper-radar.search',
  rank: 'paper-radar.rank',
  digest: 'paper-radar.digest'
} as const

export const paperRadarSourceSchema = z.enum(['arxiv', 'biorxiv'])

export const paperRadarRecordSchema = z.object({
  id: z.string(),
  source: paperRadarSourceSchema,
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
  pdfUrl: z.string().optional(),
  score: z.number().optional(),
  reason: z.string().optional(),
  relevance: z.enum(['high', 'medium', 'low']).optional()
}).strict()

export const paperRadarProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  keywords: z.array(z.string().trim().min(1).max(128)).max(100),
  excludeKeywords: z.array(z.string().trim().min(1).max(128)).max(100),
  arxivCategories: z.array(z.string().trim().min(1).max(64)).max(50),
  biorxivSubjects: z.array(z.string().trim().min(1).max(128)).max(50)
}).strict()

export const paperRadarStatusSchema = z.object({
  ok: z.boolean(),
  service: z.string().optional(),
  stats: z.object({
    papers: z.number(),
    arxiv: z.number(),
    biorxiv: z.number()
  }).strict().optional(),
  checkedAt: z.string().optional(),
  message: z.string().optional()
}).strict()

export const paperRadarArxivSyncInputSchema = z.object({
  categories: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  since: z.string().trim().max(64).optional(),
  until: z.string().trim().max(64).optional(),
  maxRecords: z.number().int().positive().max(2_000).optional()
}).strict()

export const paperRadarBiorxivSyncInputSchema = z.object({
  from: z.string().trim().max(64).optional(),
  to: z.string().trim().max(64).optional(),
  maxRecords: z.number().int().positive().max(2_000).optional()
}).strict()

export const paperRadarProfileSyncInputSchema = z.object({
  profile: z.string().trim().max(128).optional(),
  from: z.string().trim().max(64).optional(),
  to: z.string().trim().max(64).optional(),
  maxRecords: z.number().int().positive().max(2_000).optional()
}).strict()

export const paperRadarSyncResultSchema = z.object({
  source: paperRadarSourceSchema,
  fetched: z.number(),
  upserted: z.number(),
  skipped: z.number(),
  from: z.string().optional(),
  to: z.string().optional()
}).strict()

export const paperRadarProfileSyncResultSchema = z.object({
  profile: z.string(),
  results: z.array(paperRadarSyncResultSchema)
}).strict()

export const paperRadarSearchInputSchema = z.object({
  query: z.string().trim().max(1_000).optional(),
  sources: z.array(paperRadarSourceSchema).max(2).optional(),
  categories: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  from: z.string().trim().max(64).optional(),
  to: z.string().trim().max(64).optional(),
  topK: z.number().int().positive().max(100).optional()
}).strict()

export const paperRadarSearchResultSchema = z.object({
  papers: z.array(paperRadarRecordSchema),
  count: z.number()
}).strict()

export const paperRadarProfileListResultSchema = z.object({
  profiles: z.array(paperRadarProfileSchema)
}).strict()

export const paperRadarProfileSaveResultSchema = z.object({
  profile: paperRadarProfileSchema
}).strict()

const paperRadarRankFields = {
  profile: z.string().trim().max(128).optional(),
  keywords: z.array(z.string().trim().min(1).max(128)).max(50).optional(),
  excludeKeywords: z.array(z.string().trim().min(1).max(128)).max(50).optional(),
  days: z.number().int().positive().max(365).optional()
}

export const paperRadarRankInputSchema = paperRadarSearchInputSchema.extend(paperRadarRankFields).strict()

export const paperRadarRankResultSchema = z.object({
  profile: z.string(),
  count: z.number(),
  papers: z.array(paperRadarRecordSchema)
}).strict()

export const paperRadarDigestInputSchema = paperRadarRankInputSchema

export const paperRadarDigestResultSchema = paperRadarRankResultSchema.extend({
  generatedAt: z.string()
}).strict()

export const paperRadarReviewInputSchema = z.object({
  profile: paperRadarProfileSchema,
  days: z.number().int().positive().max(365).optional(),
  topK: z.number().int().positive().max(100).optional(),
  maxRecords: z.number().int().positive().max(2_000).optional()
}).strict()

export const paperRadarReviewResultSchema = paperRadarDigestResultSchema.extend({
  syncResults: z.array(paperRadarSyncResultSchema)
}).strict()

export function paperRadarApiResultSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z.discriminatedUnion('ok', [
    z.object({
      ok: z.literal(true),
      data: dataSchema,
      summary: z.string().optional()
    }).strict(),
    z.object({
      ok: z.literal(false),
      message: z.string()
    }).strict()
  ])
}

export type PaperRadarSource = z.infer<typeof paperRadarSourceSchema>
export type PaperRadarRecord = z.infer<typeof paperRadarRecordSchema>
export type PaperRadarProfile = z.infer<typeof paperRadarProfileSchema>
export type PaperRadarStatus = z.infer<typeof paperRadarStatusSchema>
export type PaperRadarArxivSyncInput = z.infer<typeof paperRadarArxivSyncInputSchema>
export type PaperRadarBiorxivSyncInput = z.infer<typeof paperRadarBiorxivSyncInputSchema>
export type PaperRadarProfileSyncInput = z.infer<typeof paperRadarProfileSyncInputSchema>
export type PaperRadarSyncResult = z.infer<typeof paperRadarSyncResultSchema>
export type PaperRadarProfileSyncResult = z.infer<typeof paperRadarProfileSyncResultSchema>
export type PaperRadarSearchInput = z.infer<typeof paperRadarSearchInputSchema>
export type PaperRadarSearchResult = z.infer<typeof paperRadarSearchResultSchema>
export type PaperRadarProfileListResult = z.infer<typeof paperRadarProfileListResultSchema>
export type PaperRadarProfileSaveResult = z.infer<typeof paperRadarProfileSaveResultSchema>
export type PaperRadarRankInput = z.infer<typeof paperRadarRankInputSchema>
export type PaperRadarRankResult = z.infer<typeof paperRadarRankResultSchema>
export type PaperRadarDigestInput = z.infer<typeof paperRadarDigestInputSchema>
export type PaperRadarDigestResult = z.infer<typeof paperRadarDigestResultSchema>
export type PaperRadarReviewInput = z.infer<typeof paperRadarReviewInputSchema>
export type PaperRadarReviewResult = z.infer<typeof paperRadarReviewResultSchema>

export type PaperRadarApiResult<T> =
  | { ok: true; data: T; summary?: string }
  | { ok: false; message: string }
