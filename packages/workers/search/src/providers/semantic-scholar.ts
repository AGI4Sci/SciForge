import type {
  ResearchPaper,
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest
} from '../types.js';
import { errorMessage, fetchJson } from '../http.js';

const S2_SEARCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/search';
const S2_FIELDS = [
  'title',
  'authors',
  'year',
  'venue',
  'citationCount',
  'externalIds',
  'tldr',
  'abstract',
  'url'
].join(',');

export class SemanticScholarResearchProvider implements ResearchSearchProvider {
  readonly id = 'semantic_scholar' as const;

  constructor(private readonly apiKey = '') {}

  async search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult> {
    const url = new URL(S2_SEARCH_URL);
    url.searchParams.set('query', request.query);
    url.searchParams.set('limit', String(request.maxResults));
    url.searchParams.set('fields', S2_FIELDS);
    if (request.sinceYear) url.searchParams.set('year', `${request.sinceYear}-`);
    try {
      const json = await fetchJson(url.href, request.timeoutMs, request.signal, { headers: this.headers() });
      const papers = parseSemanticScholarPapers(json);
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

  private headers(): Record<string, string> {
    return this.apiKey.trim()
      ? { Accept: 'application/json', 'x-api-key': this.apiKey.trim() }
      : { Accept: 'application/json' };
  }
}

function parseSemanticScholarPapers(value: unknown): ResearchPaper[] {
  const rows = asRecord(value).data;
  if (!Array.isArray(rows)) return [];
  return rows.map(parseSemanticScholarPaper).filter(isPaper);
}

function parseSemanticScholarPaper(value: unknown): ResearchPaper | null {
  const record = asRecord(value);
  const title = stringValue(record.title);
  if (!title) return null;
  const externalIds = asRecord(record.externalIds);
  const authors = Array.isArray(record.authors)
    ? record.authors.map((author) => stringValue(asRecord(author).name)).filter(Boolean)
    : [];
  const tldr = asRecord(record.tldr);
  const year = numberValue(record.year);
  const citationCount = numberValue(record.citationCount);
  return {
    title,
    authors,
    ...(year ? { year } : {}),
    venue: optionalString(record.venue),
    abstract: optionalString(record.abstract),
    tldr: optionalString(tldr.text),
    arxivId: optionalString(externalIds.ArXiv),
    doi: optionalString(externalIds.DOI),
    semanticScholarId: optionalString(record.paperId),
    ...(citationCount !== undefined ? { citationCount } : {}),
    url: optionalString(record.url),
    source: ['semantic_scholar']
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
