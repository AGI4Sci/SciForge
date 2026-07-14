import { errorMessage, fetchText } from '../http.js';
import type {
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest,
  ResearchWebResult
} from '../types.js';

const BING_RSS_SEARCH_URL = 'https://www.bing.com/search';
const DUCKDUCKGO_HTML_SEARCH_URL = 'https://html.duckduckgo.com/html/';
const MAX_SEARCH_RESPONSE_BYTES = 1_000_000;
const MAX_PARSED_CANDIDATES = 50;
const SEARCH_HEADERS = {
  Accept: 'application/rss+xml, application/xml;q=0.9, text/html;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 SciForge/0.1'
};

export type PublicWebSearchFetch = (
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
  headers: Record<string, string>,
  maxBytes: number
) => Promise<string>;

/**
 * A keyless, best-effort discovery provider. It intentionally uses public
 * search result representations and never attempts to bypass authentication,
 * CAPTCHAs, robots controls, or origin access policies.
 */
export class PublicWebResearchProvider implements ResearchSearchProvider {
  readonly id = 'public_web' as const;

  constructor(
    private readonly fetchSearchText: PublicWebSearchFetch = defaultFetchSearchText
  ) {}

  async search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult> {
    throwIfAborted(request.signal);
    const attempts: string[] = [];
    const deadline = Date.now() + request.timeoutMs;
    let successfulResponses = 0;

    try {
      const bingUrl = new URL(BING_RSS_SEARCH_URL);
      bingUrl.searchParams.set('format', 'rss');
      bingUrl.searchParams.set('q', request.query);
      bingUrl.searchParams.set('setlang', 'en-us');
      bingUrl.searchParams.set('cc', 'us');
      const xml = await this.fetchSearchText(
        bingUrl.href,
        primaryAttemptTimeout(request.timeoutMs),
        request.signal,
        SEARCH_HEADERS,
        MAX_SEARCH_RESPONSE_BYTES
      );
      successfulResponses += 1;
      const webResults = parseBingRssResults(xml, request.maxResults);
      if (webResults.length > 0) return success(webResults, 'Bing RSS');
      attempts.push('Bing RSS returned no parseable results');
    } catch (error) {
      if (request.signal.aborted) throwIfAborted(request.signal);
      attempts.push(`Bing RSS: ${errorMessage(error)}`);
    }

    try {
      const duckDuckGoUrl = new URL(DUCKDUCKGO_HTML_SEARCH_URL);
      duckDuckGoUrl.searchParams.set('q', request.query);
      const html = await this.fetchSearchText(
        duckDuckGoUrl.href,
        remainingTimeout(deadline),
        request.signal,
        SEARCH_HEADERS,
        MAX_SEARCH_RESPONSE_BYTES
      );
      successfulResponses += 1;
      const webResults = parseDuckDuckGoHtmlResults(html, request.maxResults);
      if (webResults.length > 0) return success(webResults, 'DuckDuckGo HTML');
      attempts.push('DuckDuckGo HTML returned no parseable results');
    } catch (error) {
      if (request.signal.aborted) throwIfAborted(request.signal);
      attempts.push(`DuckDuckGo HTML: ${errorMessage(error)}`);
    }

    return {
      papers: [],
      webResults: [],
      diagnostics: [{
        id: this.id,
        enabled: true,
        available: successfulResponses > 0,
        role: 'fallback',
        resultCount: 0,
        reason: attempts.join('; ')
      }]
    };
  }
}

export function parseBingRssResults(xml: string, limit: number): ResearchWebResult[] {
  const results: ResearchWebResult[] = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const item of items.slice(0, MAX_PARSED_CANDIDATES)) {
    const title = normalizeText(xmlElementText(item, 'title'));
    const url = normalizeResultUrl(xmlElementText(item, 'link'));
    const snippet = normalizeText(xmlElementText(item, 'description'));
    if (!title || !url || hasResultUrl(results, url)) continue;
    results.push({
      title,
      url,
      snippet,
      source: 'public_web',
      rank: results.length + 1
    });
    if (results.length >= limit) break;
  }
  return results;
}

export function parseDuckDuckGoHtmlResults(html: string, limit: number): ResearchWebResult[] {
  const results: ResearchWebResult[] = [];
  const resultBlocks = html.match(/<div\b[^>]*class=["'][^"']*\bresult\b[^"']*["'][^>]*>[\s\S]*?(?=<div\b[^>]*class=["'][^"']*\bresult\b|<\/body>|$)/gi) ?? [];
  for (const block of resultBlocks.slice(0, MAX_PARSED_CANDIDATES)) {
    const anchor = block.match(/<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*>[\s\S]*?<\/a>/i)?.[0];
    if (!anchor) continue;
    const title = normalizeText(anchor);
    const href = htmlAttribute(anchor, 'href');
    const url = normalizeResultUrl(decodeDuckDuckGoRedirect(href));
    const snippetTag = block.match(/<(?:a|div)\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>[\s\S]*?<\/(?:a|div)>/i)?.[0];
    const snippet = normalizeText(snippetTag ?? '');
    if (!title || !url || hasResultUrl(results, url)) continue;
    results.push({
      title,
      url,
      snippet,
      source: 'public_web',
      rank: results.length + 1
    });
    if (results.length >= limit) break;
  }
  return results;
}

function success(webResults: ResearchWebResult[], endpoint: string): ResearchSearchProviderResult {
  return {
    papers: [],
    webResults,
    diagnostics: [{
      id: 'public_web',
      enabled: true,
      available: true,
      role: 'fallback',
      resultCount: webResults.length,
      reason: `Used keyless fallback via ${endpoint}`
    }]
  };
}

function defaultFetchSearchText(
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
  headers: Record<string, string>,
  maxBytes: number
): Promise<string> {
  return fetchText(url, timeoutMs, signal, headers, maxBytes);
}

function xmlElementText(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] ?? '';
}

function htmlAttribute(tag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.match(new RegExp(`\\s${escaped}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? '';
}

function decodeDuckDuckGoRedirect(value: string): string {
  const decoded = decodeEntities(value).trim();
  if (!decoded) return '';
  const absolute = decoded.startsWith('//') ? `https:${decoded}` : decoded;
  try {
    const url = new URL(absolute, 'https://duckduckgo.com');
    if (url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com')) {
      const target = url.searchParams.get('uddg');
      if (target) return target;
    }
    return url.href;
  } catch {
    return '';
  }
}

function normalizeResultUrl(value: string): string {
  const decoded = decodeEntities(value).trim();
  if (!decoded) return '';
  try {
    const url = new URL(decoded);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function normalizeText(value: string): string {
  return decodeEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, encoded: string) => {
      const hex = encoded[0]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(encoded.slice(hex ? 1 : 0), hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : '';
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function hasResultUrl(results: ResearchWebResult[], url: string): boolean {
  return results.some((result) => result.url === url);
}

function primaryAttemptTimeout(totalTimeoutMs: number): number {
  return Math.max(1, Math.floor(totalTimeoutMs * 0.6));
}

function remainingTimeout(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('search timeout exceeded');
  return remaining;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) signal.throwIfAborted();
}
