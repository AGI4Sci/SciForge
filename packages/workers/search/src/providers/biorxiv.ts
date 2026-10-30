import type {
  ResearchPaper,
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest
} from '../types.js';
import { errorMessage, fetchJson } from '../http.js';

const BIORXIV_DETAILS_BASE_URL = 'https://api.biorxiv.org/details/biorxiv';
const MAX_CURSOR = 300;
const PAGE_SIZE = 100;

export class BiorxivResearchProvider implements ResearchSearchProvider {
  readonly id = 'biorxiv' as const;
  private readonly intervalCache = new Map<string, ResearchPaper[]>();

  async search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult> {
    try {
      const interval = intervalFor(request.sinceYear);
      const cached = this.intervalCache.get(interval);
      const papers = cached
        ? cached.filter((paper) => paperMatchesQuery(paper, request.query)).slice(0, request.maxResults)
        : await this.loadMatchingIntervalPapers(interval, request);
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

  private async loadMatchingIntervalPapers(
    interval: string,
    request: ResearchSearchRequest
  ): Promise<ResearchPaper[]> {
    const matching: ResearchPaper[] = [];
    const allPapers: ResearchPaper[] = [];
    let completed = true;
    for (let cursor = 0; cursor <= MAX_CURSOR; cursor += PAGE_SIZE) {
      const json = await fetchJson(
        `${BIORXIV_DETAILS_BASE_URL}/${interval}/${cursor}/json`,
        request.timeoutMs,
        request.signal,
        { headers: { Accept: 'application/json' } }
      );
      const page = parseBiorxivPapers(json);
      allPapers.push(...page);
      matching.push(...page.filter((paper) => paperMatchesQuery(paper, request.query)));
      if (matching.length >= request.maxResults) {
        completed = false;
        break;
      }
      const rawMessages = asRecord(json).messages;
      const messages = Array.isArray(rawMessages) ? rawMessages : [];
      const total = Number(asRecord(messages[0]).total);
      if (!Number.isFinite(total) || cursor + PAGE_SIZE >= total) break;
    }
    if (completed) this.intervalCache.set(interval, allPapers);
    return matching.slice(0, request.maxResults);
  }
}

function intervalFor(sinceYear: number | undefined): string {
  if (sinceYear) return `${sinceYear}-01-01/${todayIsoDate()}`;
  return `${daysAgoIsoDate(365)}/${todayIsoDate()}`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIsoDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function parseBiorxivPapers(value: unknown): ResearchPaper[] {
  const collection = asRecord(value).collection;
  if (!Array.isArray(collection)) return [];
  return collection.map(parseBiorxivPaper).filter(isPaper);
}

function parseBiorxivPaper(value: unknown): ResearchPaper | null {
  const record = asRecord(value);
  const title = stringValue(record.title);
  const doi = stringValue(record.doi);
  if (!title || !doi) return null;
  const version = numberValue(record.version);
  const date = stringValue(record.date);
  const year = date ? Number(date.slice(0, 4)) : undefined;
  const url = `https://www.biorxiv.org/content/${doi}${version ? `v${version}` : ''}`;
  return {
    title,
    authors: splitAuthors(stringValue(record.authors)),
    ...(Number.isFinite(year) ? { year } : {}),
    venue: 'bioRxiv',
    abstract: optionalString(record.abstract),
    doi,
    url,
    pdfUrl: `${url}.full.pdf`,
    source: ['biorxiv']
  };
}

function paperMatchesQuery(paper: ResearchPaper, query: string): boolean {
  const terms = meaningfulTerms(query);
  if (terms.length === 0) return true;
  const text = [paper.title, paper.abstract].filter(Boolean).join(' ').toLowerCase();
  const matches = terms.filter((term) => text.includes(term));
  return matches.length >= Math.max(1, Math.ceil(terms.length * 0.75));
}

function meaningfulTerms(query: string): string[] {
  const stop = new Set([
    'model',
    'models',
    'latest',
    'recent',
    'advance',
    'advances',
    'review',
    'survey',
    '2024',
    '2025',
    '2026',
    'and',
    'for',
    'with',
    'the',
    'science',
    'biology',
    'computational',
    'foundation'
  ]);
  return [...new Set(query.toLowerCase().split(/\W+/).filter((term) => term.length > 2 && !stop.has(term)))];
}

function splitAuthors(value: string): string[] {
  return value.split(/;\s*|,\s+(?=[A-Z][A-Za-z'-]+(?:\s|$))/).map((author) => author.trim()).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value);
  return text || undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isPaper(value: ResearchPaper | null): value is ResearchPaper {
  return value !== null;
}
