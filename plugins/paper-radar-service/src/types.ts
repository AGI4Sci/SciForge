export type PaperSource = 'arxiv' | 'biorxiv';

export interface PaperRecord {
  id: string;
  source: PaperSource;
  externalId: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  subjects: string[];
  publishedAt: string;
  updatedAt?: string;
  doi?: string;
  absUrl: string;
  pdfUrl?: string;
}

export interface SearchRequest {
  query?: string;
  sources?: PaperSource[];
  categories?: string[];
  from?: string;
  to?: string;
  topK?: number;
}

export interface DigestRequest extends SearchRequest {
  profile?: string;
  keywords?: string[];
  excludeKeywords?: string[];
  days?: number;
}

export interface TopicProfile {
  name: string;
  description?: string;
  keywords: string[];
  excludeKeywords: string[];
  arxivCategories: string[];
  biorxivSubjects: string[];
}

export interface RankRequest extends SearchRequest {
  profile?: string;
  keywords?: string[];
  excludeKeywords?: string[];
  days?: number;
}

export interface RankedPaper extends PaperRecord {
  score: number;
  reason: string;
  relevance?: 'high' | 'medium' | 'low';
}

export interface SyncResult {
  source: PaperSource;
  fetched: number;
  upserted: number;
  skipped: number;
  from?: string;
  to?: string;
}

export interface ServiceError {
  code: 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'UPSTREAM_ERROR' | 'INTERNAL_ERROR';
  message: string;
  retryable: boolean;
}

export type ServiceResult<T> =
  | { ok: true; data: T; summary?: string; provenance?: Record<string, unknown> }
  | { ok: false; error: ServiceError; provenance?: Record<string, unknown> };
