/**
 * Matches workspace PDF file names against sealed bibliography entries.
 *
 * A PDF is never opened, so this can only use the file name: its title tokens,
 * a year, or a DOI suffix. Every result therefore carries the evidence behind
 * the match and a score, and an ambiguous file name is reported as ambiguous
 * instead of picking a winner.
 */

export type LibraryEntryForMatch = Readonly<{
  paperId: string
  title: string
  year?: number
  doi?: string
}>

export type PdfMatchEvidence = 'doi' | 'title' | 'year'

export type PdfMatch = Readonly<{
  paperId: string
  title: string
  /** 0..1 confidence: full title coverage is 0.85, a year makes it 1, a DOI suffix is 1. */
  score: number
  matchedBy: readonly PdfMatchEvidence[]
}>

export type PdfMatchResult = Readonly<{
  matched: PdfMatch | null
  /** Runners-up when the file name fits several entries within the tie window. */
  candidates: readonly PdfMatch[]
}>

/** Entries and file names inside this window are treated as a tie. */
const TIE_WINDOW = 0.05
/** A file name that carries the whole entry title is strong, not certain evidence. */
const TITLE_WEIGHT = 0.85
const YEAR_WEIGHT = 0.15
/** A title-only match needs this much of the entry title plus this many tokens. */
const MIN_TITLE_COVERAGE = 0.6
const MIN_TITLE_TOKENS = 2
const MAX_CANDIDATES = 5

const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'and', 'or', 'to', 'for', 'with', 'from', 'by', 'at',
  'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'its', 'their', 'this', 'that',
  'these', 'those', 'we', 'our', 'how', 'what', 'why', 'when', 'where', 'not', 'no', 'do',
  'does', 'did', 'via', 'into', 'between', 'under', 'over', 'using', 'use', 'used', 'can',
  'may', 'more', 'than', 'two', 'one', 'about', 'after', 'before', 'during', 'through',
  'per', 'also', 'but', 'if', 'it', 'they', 'them', 'his', 'her', 'he', 'she', 'you', 'your'
])

export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
}

function tokens(value: string): string[] {
  return normalizeForMatch(value).split(' ').filter((token) => token.length > 1)
}

function titleTokens(title: string): string[] {
  return tokens(title).filter((token) => !STOPWORDS.has(token) && !/^\d{4}$/u.test(token))
}

/** The part of a DOI that a file name would contain, e.g. `s41586-025-09796-0`. */
function doiSuffix(doi: string): string {
  const trimmed = doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//u, '').replace(/^doi:\s*/u, '')
  const slash = trimmed.indexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

function fileContainsDoiSuffix(normalizedStem: string, suffix: string): boolean {
  const normalizedSuffix = normalizeForMatch(suffix).replace(/ /gu, '')
  const normalizedFile = normalizedStem.replace(/ /gu, '')
  if (normalizedSuffix.length < 6 || normalizedFile.length < 6) return false
  return normalizedFile.includes(normalizedSuffix)
}

function scoreEntry(entry: LibraryEntryForMatch, stem: string): (PdfMatch & { coverage: number }) | null {
  const fileTokens = new Set(tokens(stem))
  const entryTokens = titleTokens(entry.title)
  const matchedTokens = entryTokens.filter((token) => fileTokens.has(token))
  const coverage = entryTokens.length === 0 ? 0 : matchedTokens.length / entryTokens.length
  const yearHit = entry.year !== undefined && fileTokens.has(String(entry.year))
  const doiHit = entry.doi ? fileContainsDoiSuffix(normalizeForMatch(stem), doiSuffix(entry.doi)) : false
  const matchedBy: PdfMatchEvidence[] = []
  if (doiHit) matchedBy.push('doi')
  if (coverage >= MIN_TITLE_COVERAGE && matchedTokens.length >= MIN_TITLE_TOKENS) matchedBy.push('title')
  if (yearHit && matchedBy.length > 0) matchedBy.push('year')
  if (!doiHit && !(coverage >= MIN_TITLE_COVERAGE && matchedTokens.length >= MIN_TITLE_TOKENS)) return null
  const base = doiHit ? 1 : coverage * TITLE_WEIGHT
  const score = Math.min(1, base + (yearHit ? YEAR_WEIGHT : 0))
  return { paperId: entry.paperId, title: entry.title, score, matchedBy, coverage }
}

/**
 * Returns the best entry for one file name. `matched` is null when nothing fits
 * or when several entries fit equally well, in which case `candidates` lists them.
 */
export function matchPdfStem(entries: readonly LibraryEntryForMatch[], stem: string): PdfMatchResult {
  const scored = entries
    .map((entry) => scoreEntry(entry, stem))
    .filter((value): value is PdfMatch & { coverage: number } => value !== null)
    .sort((left, right) => right.score - left.score || left.paperId.localeCompare(right.paperId))
  if (scored.length === 0) return { matched: null, candidates: [] }
  const best = scored[0]!
  const ties = scored.filter((value) => best.score - value.score <= TIE_WINDOW)
  const toPublic = (value: PdfMatch & { coverage: number }): PdfMatch => ({
    paperId: value.paperId, title: value.title, score: Number(value.score.toFixed(3)), matchedBy: value.matchedBy
  })
  if (ties.length > 1) {
    return { matched: null, candidates: ties.slice(0, MAX_CANDIDATES).map(toPublic) }
  }
  return { matched: toPublic(best), candidates: scored.slice(1, 1 + MAX_CANDIDATES).map(toPublic) }
}
