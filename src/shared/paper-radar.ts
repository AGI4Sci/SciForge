export type PaperRadarSource = 'arxiv' | 'biorxiv'

export type PaperRadarRecord = {
  id: string
  source: PaperRadarSource
  externalId: string
  title: string
  authors: string[]
  abstract: string
  categories: string[]
  subjects: string[]
  publishedAt: string
  updatedAt?: string
  doi?: string
  absUrl: string
  pdfUrl?: string
  score?: number
  reason?: string
  relevance?: 'high' | 'medium' | 'low'
}

export type PaperRadarProfile = {
  name: string
  description?: string
  keywords: string[]
  excludeKeywords: string[]
  arxivCategories: string[]
  biorxivSubjects: string[]
}

export type PaperRadarStatus = {
  ok: boolean
  service?: string
  stats?: {
    papers: number
    arxiv: number
    biorxiv: number
  }
  checkedAt?: string
  message?: string
}

export type PaperRadarArxivSyncInput = {
  categories?: string[]
  since?: string
  until?: string
  maxRecords?: number
}

export type PaperRadarBiorxivSyncInput = {
  from?: string
  to?: string
  maxRecords?: number
}

export type PaperRadarProfileSyncInput = {
  profile?: string
  from?: string
  to?: string
  maxRecords?: number
}

export type PaperRadarSyncResult = {
  source: PaperRadarSource
  fetched: number
  upserted: number
  skipped: number
  from?: string
  to?: string
}

export type PaperRadarProfileSyncResult = {
  profile: string
  results: PaperRadarSyncResult[]
}

export type PaperRadarSearchInput = {
  query?: string
  sources?: PaperRadarSource[]
  categories?: string[]
  from?: string
  to?: string
  topK?: number
}

export type PaperRadarSearchResult = {
  papers: PaperRadarRecord[]
  count: number
}

export type PaperRadarProfileListResult = {
  profiles: PaperRadarProfile[]
}

export type PaperRadarProfileSaveResult = {
  profile: PaperRadarProfile
}

export type PaperRadarRankInput = PaperRadarSearchInput & {
  profile?: string
  keywords?: string[]
  excludeKeywords?: string[]
  days?: number
}

export type PaperRadarRankResult = {
  profile: string
  count: number
  papers: PaperRadarRecord[]
}

export type PaperRadarDigestInput = PaperRadarSearchInput & {
  profile?: string
  keywords?: string[]
  excludeKeywords?: string[]
  days?: number
}

export type PaperRadarDigestResult = {
  profile: string
  generatedAt: string
  count: number
  papers: PaperRadarRecord[]
}

export type PaperRadarApiResult<T> =
  | { ok: true; data: T; summary?: string }
  | { ok: false; message: string }
