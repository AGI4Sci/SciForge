import type {
  ResearchPaper,
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest
} from '../types.js';
import { errorMessage, fetchText } from '../http.js';

const ARXIV_API_URL = 'https://export.arxiv.org/api/query';
const ARXIV_MAX_QUERY_TERMS = 8;
const ARXIV_QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'advance',
  'advances',
  'for',
  'in',
  'latest',
  'new',
  'of',
  'on',
  'or',
  'progress',
  'recent',
  'review',
  'sota',
  'survey',
  'the',
  'to',
  'trend',
  'trends',
  'with'
]);

export class ArxivResearchProvider implements ResearchSearchProvider {
  readonly id = 'arxiv' as const;

  async search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult> {
    const url = new URL(ARXIV_API_URL);
    url.searchParams.set('search_query', buildArxivQuery(request.query, request.sinceYear));
    url.searchParams.set('start', '0');
    url.searchParams.set('max_results', String(request.maxResults));
    url.searchParams.set('sortBy', request.intent === 'latest' ? 'submittedDate' : 'relevance');
    url.searchParams.set('sortOrder', 'descending');
    try {
      const text = await fetchText(url.href, request.timeoutMs, request.signal, {
        Accept: 'application/atom+xml'
      });
      const papers = parseArxivFeed(text);
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

export function buildArxivQuery(query: string, sinceYear: number | undefined): string {
  const terms = arxivQueryTerms(query);
  const base = terms.length > 0
    ? terms.map(arxivTermClause).join(' AND ')
    : `all:"${escapeArxivTerm(query)}"`;
  if (!sinceYear) return base;
  return `${base} AND submittedDate:[${sinceYear}01010000 TO 299912312359]`;
}

function arxivQueryTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of query.match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? []) {
    const normalized = token.toLowerCase();
    if (normalized.length < 2) continue;
    if (/^20\d{2}$/.test(normalized)) continue;
    if (ARXIV_QUERY_STOP_WORDS.has(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push(token);
    if (terms.length >= ARXIV_MAX_QUERY_TERMS) break;
  }
  return terms;
}

function arxivTermClause(term: string): string {
  const escaped = escapeArxivTerm(term);
  return escaped.toLowerCase() === 'ai'
    ? '(all:AI OR all:"artificial intelligence" OR all:"machine learning")'
    : `all:"${escaped}"`;
}

function escapeArxivTerm(term: string): string {
  return term.replace(/["()]/g, '').trim();
}

function parseArxivFeed(xml: string): ResearchPaper[] {
  return xml.match(/<entry>[\s\S]*?<\/entry>/g)?.map(parseArxivEntry).filter(isPaper) ?? [];
}

function parseArxivEntry(entry: string): ResearchPaper | null {
  const title = textOf(entry, 'title');
  if (!title) return null;
  const idUrl = textOf(entry, 'id');
  const arxivId = arxivIdFromUrl(idUrl);
  const pdfUrl = hrefFor(entry, 'pdf') ?? (arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined);
  const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
    .map((match) => decodeXml(match[1] ?? '').trim())
    .filter(Boolean);
  const published = textOf(entry, 'published');
  const year = published ? Number(published.slice(0, 4)) : undefined;
  return {
    title,
    authors,
    ...(Number.isFinite(year) ? { year } : {}),
    abstract: textOf(entry, 'summary'),
    ...(arxivId ? { arxivId } : {}),
    url: idUrl || (arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined),
    ...(pdfUrl ? { pdfUrl } : {}),
    source: ['arxiv']
  };
}

function textOf(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  const value = decodeXml(match?.[1] ?? '').replace(/\s+/g, ' ').trim();
  return value || undefined;
}

function hrefFor(xml: string, title: string): string | undefined {
  const pattern = new RegExp(`<link[^>]*title=["']${title}["'][^>]*>`, 'i');
  const tag = xml.match(pattern)?.[0];
  return tag?.match(/\shref=["']([^"']+)["']/i)?.[1];
}

function arxivIdFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/\/abs\/([^/?#]+)/);
  return match?.[1];
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function isPaper(value: ResearchPaper | null): value is ResearchPaper {
  return value !== null;
}
