import type {
  ResearchPaper,
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest
} from '../types.js';
import { errorMessage, fetchJson } from '../http.js';

const EUROPE_PMC_SEARCH_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const PAGE_SIZE_MULTIPLIER = 3;

export class EuropePmcResearchProvider implements ResearchSearchProvider {
  readonly id = 'europe_pmc' as const;

  async search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult> {
    const url = new URL(EUROPE_PMC_SEARCH_URL);
    url.searchParams.set('query', buildEuropePmcQuery(request.query, request.sinceYear));
    url.searchParams.set('format', 'json');
    url.searchParams.set('resultType', 'core');
    url.searchParams.set('pageSize', String(Math.min(100, Math.max(request.maxResults, request.maxResults * PAGE_SIZE_MULTIPLIER))));
    if (request.intent === 'latest') url.searchParams.set('sort', 'FIRST_PDATE_D desc');

    try {
      const json = await fetchJson(url.href, request.timeoutMs, request.signal, {
        headers: { Accept: 'application/json' }
      });
      const papers = parseEuropePmcPapers(json).slice(0, request.maxResults);
      return {
        papers,
        webResults: [],
        diagnostics: [{
          id: this.id,
          enabled: true,
          available: true,
          resultCount: papers.length
        }]
      };
    } catch (error) {
      return {
        papers: [],
        webResults: [],
        diagnostics: [{
          id: this.id,
          enabled: true,
          available: false,
          reason: errorMessage(error)
        }]
      };
    }
  }
}

export function buildEuropePmcQuery(query: string, sinceYear?: number): string {
  const normalized = query.replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  if (!sinceYear) return normalized;
  return `(${normalized}) AND FIRST_PDATE:[${sinceYear}-01-01 TO ${todayIsoDate()}]`;
}

export function parseEuropePmcPapers(value: unknown): ResearchPaper[] {
  const rows = asRecord(asRecord(value).resultList).result;
  if (!Array.isArray(rows)) return [];
  return rows.map(parseEuropePmcPaper).filter(isPaper);
}

function parseEuropePmcPaper(value: unknown): ResearchPaper | null {
  const record = asRecord(value);
  const title = cleanText(record.title);
  if (!title) return null;

  const source = cleanText(record.source);
  const id = cleanText(record.id);
  const pmid = cleanText(record.pmid);
  const pmcid = cleanText(record.pmcid);
  const doi = cleanText(record.doi);
  const year = numberFromString(record.pubYear);
  const citedByCount = numberFromString(record.citedByCount);
  const url = europePmcArticleUrl({ source, id, pmid, pmcid, doi });

  return {
    title,
    authors: parseAuthors(record),
    ...(Number.isFinite(year) ? { year } : {}),
    venue: europePmcVenue(record),
    abstract: optionalCleanText(record.abstractText),
    ...(doi ? { doi } : {}),
    ...(citedByCount !== undefined ? { citationCount: citedByCount } : {}),
    ...(url ? { url } : {}),
    source: ['europe_pmc']
  };
}

function europePmcArticleUrl(input: {
  source: string;
  id: string;
  pmid: string;
  pmcid: string;
  doi: string;
}): string | undefined {
  if (input.source && input.id) return `https://europepmc.org/article/${encodeURIComponent(input.source)}/${encodeURIComponent(input.id)}`;
  if (input.pmid) return `https://europepmc.org/article/MED/${encodeURIComponent(input.pmid)}`;
  if (input.pmcid) return `https://europepmc.org/article/PMC/${encodeURIComponent(input.pmcid)}`;
  if (input.doi) return `https://doi.org/${encodeURIComponent(input.doi)}`;
  return undefined;
}

function europePmcVenue(record: Record<string, unknown>): string | undefined {
  const journalTitle = cleanText(asRecord(asRecord(record.journalInfo).journal).title);
  return journalTitle || optionalCleanText(record.journalTitle);
}

function parseAuthors(record: Record<string, unknown>): string[] {
  const authors = asRecord(record.authorList).author;
  if (Array.isArray(authors)) {
    return authors
      .map((author) => cleanText(asRecord(author).fullName))
      .filter(Boolean);
  }
  const authorString = cleanText(record.authorString);
  return authorString
    ? authorString.replace(/\.$/, '').split(/\s*,\s*/).map((author) => author.trim()).filter(Boolean)
    : [];
}

function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    : '';
}

function optionalCleanText(value: unknown): string | undefined {
  const text = cleanText(value);
  return text || undefined;
}

function numberFromString(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isPaper(value: ResearchPaper | null): value is ResearchPaper {
  return value !== null;
}
