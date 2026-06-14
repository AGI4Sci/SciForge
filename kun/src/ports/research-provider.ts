export type ResearchIntent =
  | 'overview'
  | 'latest'
  | 'baseline'
  | 'sota'
  | 'dataset'
  | 'code'
  | 'gap'

export type ResearchDomain =
  | 'ai4s'
  | 'biology'
  | 'chemistry'
  | 'materials'
  | 'physics'
  | 'climate'
  | 'general'

export type ResearchSourceKind = 'arxiv' | 'biorxiv' | 'semantic_scholar' | 'web' | 'cns'

export type ResearchSearchRequest = {
  query: string
  intent: ResearchIntent
  domain: ResearchDomain
  sinceYear?: number
  maxResults: number
  timeoutMs: number
  signal: AbortSignal
}

export type ResearchPaper = {
  title: string
  authors: string[]
  year?: number
  venue?: string
  abstract?: string
  tldr?: string
  arxivId?: string
  doi?: string
  semanticScholarId?: string
  citationCount?: number
  url?: string
  pdfUrl?: string
  source: ResearchSourceKind[]
  relevanceReason?: string
}

export type ResearchWebResult = {
  title: string
  url: string
  snippet: string
  source: 'tavily' | 'cns'
  rank: number
}

export type ResearchSearchProviderResult = {
  papers: ResearchPaper[]
  webResults: ResearchWebResult[]
  diagnostics?: ResearchProviderDiagnostic[]
}

export type ResearchProviderDiagnostic = {
  id: string
  enabled: boolean
  available: boolean
  resultCount?: number
  reason?: string
}

export interface ResearchSearchProvider {
  readonly id: string
  search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult>
}
