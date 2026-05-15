import type { JsonObject } from '../../../contracts/tool-worker/src/index';

export interface WebSearchResult extends JsonObject {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(input: JsonObject): Promise<JsonObject> {
  const query = requiredString(input.query, 'query');
  const limit = clampNumber(input.limit, 5, 1, 10);
  const region = typeof input.region === 'string' && input.region.length > 0 ? input.region : 'us-en';
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

  return {
    query,
    provider: 'duckduckgo-html',
    results: parseDuckDuckGoResults(html).slice(0, limit),
  };
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
