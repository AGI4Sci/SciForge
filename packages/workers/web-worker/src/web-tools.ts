import type { JsonObject } from '../../../contracts/tool-worker/src/index';

export interface WebSearchResult extends JsonObject {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(input: JsonObject): Promise<JsonObject> {
  const rawQuery = requiredString(input.query, 'query');
  const query = normalizeSearchQuery(rawQuery);
  const limit = clampNumber(input.limit ?? input.maxResults, 5, 1, 10);
  const region = typeof input.region === 'string' && input.region.length > 0 ? input.region : 'us-en';
  const fallbackErrors: string[] = [];

  try {
    const duckDuckGoResults = await duckDuckGoSearch(query, limit, region);
    if (duckDuckGoResults.length > 0) {
      return {
        query,
        rawQuery,
        provider: 'duckduckgo-html',
        results: duckDuckGoResults,
      };
    }
    fallbackErrors.push('duckduckgo-html returned no parseable results');
  } catch (error) {
    fallbackErrors.push(`duckduckgo-html: ${errorMessage(error)}`);
  }

  try {
    const europePmcResults = await europePmcSearch(query, limit);
    if (europePmcResults.length > 0) {
      return {
        query,
        rawQuery,
        provider: 'europepmc',
        fallbackFrom: 'duckduckgo-html',
        fallbackReasons: fallbackErrors,
        results: europePmcResults,
      };
    }
    fallbackErrors.push('europepmc returned no records');
  } catch (error) {
    fallbackErrors.push(`europepmc: ${errorMessage(error)}`);
  }

  try {
    const crossrefResults = await crossrefSearch(query, limit);
    if (crossrefResults.length > 0) {
      return {
        query,
        rawQuery,
        provider: 'crossref',
        fallbackFrom: 'duckduckgo-html',
        fallbackReasons: fallbackErrors,
        results: crossrefResults,
      };
    }
    fallbackErrors.push('crossref returned no records');
  } catch (error) {
    fallbackErrors.push(`crossref: ${errorMessage(error)}`);
  }

  throw new RetryableToolError(`All search providers failed or returned no records: ${fallbackErrors.join('; ')}`);
}

async function duckDuckGoSearch(query: string, limit: number, region: string): Promise<WebSearchResult[]> {
  const searchUrl = new URL('https://duckduckgo.com/html/');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('kl', region);

  const response = await fetchWithTimeout(searchUrl, 15000, {
    headers: { 'user-agent': 'SciForgeWebWorker/0.1 (+https://sciforge.local)' },
  });
  const html = await response.text();
  if (!response.ok) {
    throw new RetryableToolError(`Search provider returned HTTP ${response.status}`);
  }

  return parseDuckDuckGoResults(html).slice(0, limit);
}

export async function webFetch(input: JsonObject): Promise<JsonObject> {
  const url = normalizeHttpUrl(requiredString(input.url, 'url'));
  const maxChars = clampNumber(input.maxChars, 12000, 100, 50000);
  const response = await fetchWithTimeout(url, 20000, {
    redirect: 'follow',
    headers: { 'user-agent': 'SciForgeWebWorker/0.1 (+https://sciforge.local)' },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  const title = contentType.includes('html') ? extractTitle(body) : undefined;
  const text = contentType.includes('html') ? htmlToText(body) : body;

  const result: JsonObject = {
    url,
    finalUrl: response.url,
    status: response.status,
    ok: response.ok,
    contentType,
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
  };
  if (title) {
    result.title = title;
  }
  return result;
}

export class RetryableToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableToolError';
  }
}

function parseDuckDuckGoResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const resultPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(resultPattern)) {
    const url = decodeDuckDuckGoUrl(decodeHtml(match[1] ?? ''));
    const title = cleanText(match[2] ?? '');
    const snippet = cleanText(match[3] ?? '');
    if (title && url) {
      results.push({ title, url, snippet });
    }
  }
  return results;
}

async function europePmcSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const searchUrl = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('resultType', 'lite');
  searchUrl.searchParams.set('pageSize', String(limit));
  searchUrl.searchParams.set('query', query);

  const response = await fetchWithTimeout(searchUrl, 15000, {
    headers: { 'user-agent': 'SciForgeWebWorker/0.1 (+https://sciforge.local)' },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new RetryableToolError(`Europe PMC returned HTTP ${response.status}`);
  }
  const records = isRecord(payload)
    && isRecord(payload.resultList)
    && Array.isArray(payload.resultList.result)
    ? payload.resultList.result
    : [];
  return records.filter(isRecord).map((record) => {
    const title = stringField(record.title) ?? 'Untitled Europe PMC result';
    const pmid = stringField(record.pmid);
    const doi = stringField(record.doi);
    const id = stringField(record.id);
    const url = doi
      ? `https://doi.org/${doi}`
      : pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
        : `https://europepmc.org/article/${encodeURIComponent(stringField(record.source) ?? 'MED')}/${encodeURIComponent(id ?? title)}`;
    const parts = [
      stringField(record.authorString),
      stringField(record.journalTitle),
      stringField(record.pubYear),
      doi ? `doi:${doi}` : undefined,
      pmid ? `PMID:${pmid}` : undefined,
    ].filter((part): part is string => Boolean(part));
    return { title: cleanText(title), url, snippet: parts.join(' | ') };
  });
}

async function crossrefSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const searchUrl = new URL('https://api.crossref.org/works');
  searchUrl.searchParams.set('rows', String(limit));
  searchUrl.searchParams.set('query.bibliographic', query);

  const response = await fetchWithTimeout(searchUrl, 15000, {
    headers: { 'user-agent': 'SciForgeWebWorker/0.1 (+https://sciforge.local)' },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new RetryableToolError(`Crossref returned HTTP ${response.status}`);
  }
  const records = isRecord(payload)
    && isRecord(payload.message)
    && Array.isArray(payload.message.items)
    ? payload.message.items
    : [];
  return records.filter(isRecord).map((record) => {
    const titleValue = Array.isArray(record.title) ? record.title.find((item) => typeof item === 'string') : undefined;
    const title = titleValue ?? stringField(record.title) ?? 'Untitled Crossref result';
    const doi = stringField(record.DOI);
    const url = stringField(record.URL) ?? (doi ? `https://doi.org/${doi}` : `https://search.crossref.org/?q=${encodeURIComponent(title)}`);
    const published = isRecord(record.published) && Array.isArray(record.published['date-parts'])
      ? String(record.published['date-parts'][0]?.[0] ?? '')
      : undefined;
    const parts = [
      stringField(record.publisher),
      published,
      doi ? `doi:${doi}` : undefined,
    ].filter((part): part is string => Boolean(part));
    return { title: cleanText(title), url, snippet: parts.join(' | ') };
  });
}

function decodeDuckDuckGoUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : url;
  } catch {
    return url;
  }
}

function htmlToText(html: string): string {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match ? cleanText(match[1]) : '';
  return title || undefined;
}

function cleanText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeSearchQuery(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  const researchQuestionMatch = collapsed.match(/(?:real\s+research\s+question|research\s+question|question|问题)\s*[:：]\s*([^.;。！？!?]+)/i);
  if (researchQuestionMatch?.[1]) {
    return researchQuestionMatch[1].trim();
  }
  const quotedMatch = collapsed.match(/["“]([^"”]{8,160})["”]/);
  if (quotedMatch?.[1] && !/\b(include|create|field|matrix|artifact|summary)\b/i.test(quotedMatch[1])) {
    return quotedMatch[1].trim();
  }
  if (collapsed.length <= 180 && !/\b(include|create|matrix fields|artifact|do not|prefer|生成|字段)\b/i.test(collapsed)) {
    return collapsed;
  }
  return collapsed
    .replace(/\b(Fresh task|Build|Create|Include|Prefer|Do not|Matrix fields|artifact|summary)\b/gi, ' ')
    .replace(/[.;。].*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeHttpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('url must use http or https');
  }
  return url.toString();
}

async function fetchWithTimeout(url: URL | string, timeoutMs: number, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RetryableToolError(`Request timed out after ${timeoutMs}ms`);
    }
    if (error instanceof Error) {
      throw new RetryableToolError(error.message);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
