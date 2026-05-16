import type { JsonObject } from '../../../contracts/tool-worker/src/index';
import type { Page } from 'playwright-core';

export interface WebSearchResult extends JsonObject {
  title: string;
  url: string;
  snippet: string;
}

interface ArxivSearchResponse {
  results: WebSearchResult[];
  searchQuery: string;
  dateRange?: JsonObject;
}

export interface BrowserAutomationForTests {
  search(input: JsonObject): Promise<JsonObject>;
  fetch(input: JsonObject): Promise<JsonObject>;
}

let browserAutomationForTests: BrowserAutomationForTests | undefined;

export function setBrowserAutomationForTests(provider: BrowserAutomationForTests | undefined): void {
  browserAutomationForTests = provider;
}

export async function webSearch(input: JsonObject): Promise<JsonObject> {
  const rawQuery = requiredString(input.query, 'query');
  const query = normalizeSearchQuery(rawQuery);
  const limit = clampNumber(input.limit ?? input.maxResults, 5, 1, 10);
  const now = typeof input.now === 'string' && input.now.trim() ? new Date(input.now) : new Date();
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

  const arxivRequested = shouldTryArxivSearch(query);
  if (arxivRequested) {
    try {
      const arxivResponse = await arxivSearch(query, limit, now);
      if (arxivResponse.results.length > 0) {
        return {
          query,
          rawQuery,
          provider: 'arxiv-api',
          providerQuery: arxivResponse.searchQuery,
          ...(arxivResponse.dateRange ? { dateRange: arxivResponse.dateRange } : {}),
          fallbackFrom: 'duckduckgo-html',
          fallbackReasons: fallbackErrors,
          results: arxivResponse.results,
        };
      }
      fallbackErrors.push(`arxiv-api returned no records for ${arxivResponse.searchQuery}`);
    } catch (error) {
      fallbackErrors.push(`arxiv-api: ${errorMessage(error)}`);
    }
    throw new RetryableToolError(`arxiv-api could not satisfy explicit arXiv query: ${fallbackErrors.join('; ')}`);
  }

  try {
    const browserResponse = await browserSearch({ query, rawQuery, limit, region });
    const browserResults = Array.isArray(browserResponse.results)
      ? browserResponse.results as unknown as WebSearchResult[]
      : [];
    if (browserResults.length > 0) {
      return {
        ...browserResponse,
        query,
        rawQuery,
        fallbackFrom: 'duckduckgo-html',
        fallbackReasons: fallbackErrors,
        results: browserResults,
      };
    }
    fallbackErrors.push('playwright-chromium browser_search returned no parseable results');
  } catch (error) {
    fallbackErrors.push(`playwright-chromium browser_search: ${errorMessage(error)}`);
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

export async function browserSearch(input: JsonObject): Promise<JsonObject> {
  const rawQuery = requiredString(input.rawQuery ?? input.query, 'query');
  const query = normalizeSearchQuery(requiredString(input.query ?? rawQuery, 'query'));
  const limit = clampNumber(input.limit ?? input.maxResults, 5, 1, 10);
  const region = typeof input.region === 'string' && input.region.length > 0 ? input.region : 'us-en';
  const engine = typeof input.engine === 'string' && /duckduckgo/i.test(input.engine) ? 'duckduckgo' : 'bing';
  const timeoutMs = clampNumber(input.timeoutMs, 25000, 5000, 60000);
  const request: JsonObject = { rawQuery, query, limit, region, engine, timeoutMs };
  if (browserAutomationForTests) {
    return browserAutomationForTests.search(request);
  }

  const searchUrl = browserSearchUrl(engine, query, region);

  return withBrowserPage(timeoutMs, async (page) => {
    const response = await page.goto(searchUrl.toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await waitForBrowserSettle(page, timeoutMs);
    const html = await page.content();
    const parsedResults = engine === 'duckduckgo'
      ? parseDuckDuckGoResults(html)
      : await browserBingResults(page);
    const anchorResults = parsedResults.length > 0 ? [] : await browserAnchorResults(page);
    const results = (parsedResults.length > 0 ? parsedResults : anchorResults).slice(0, limit);
    return {
      query,
      rawQuery,
      provider: 'playwright-chromium',
      engine: engine === 'duckduckgo' ? 'duckduckgo-html-rendered' : 'bing-rendered',
      searchUrl: searchUrl.toString(),
      finalUrl: page.url(),
      status: response?.status() ?? 0,
      ok: response?.ok() ?? false,
      title: cleanText(await page.title().catch(() => '')),
      rendered: true,
      results,
    };
  });
}

function browserSearchUrl(engine: 'bing' | 'duckduckgo', query: string, region: string): URL {
  if (engine === 'duckduckgo') {
    const searchUrl = new URL('https://duckduckgo.com/html/');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('kl', region);
    return searchUrl;
  }
  const searchUrl = new URL('https://www.bing.com/search');
  searchUrl.searchParams.set('q', query);
  if (region.startsWith('us')) {
    searchUrl.searchParams.set('cc', 'US');
    searchUrl.searchParams.set('mkt', 'en-US');
    searchUrl.searchParams.set('setlang', 'en-US');
  } else {
    searchUrl.searchParams.set('setlang', region);
  }
  return searchUrl;
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

async function arxivSearch(query: string, limit: number, now: Date): Promise<ArxivSearchResponse> {
  const searchUrl = new URL('https://export.arxiv.org/api/query');
  const arxivQuery = arxivSearchQuery(query, now);
  searchUrl.searchParams.set('search_query', arxivQuery.searchQuery);
  searchUrl.searchParams.set('start', '0');
  searchUrl.searchParams.set('max_results', String(limit));
  searchUrl.searchParams.set('sortBy', 'submittedDate');
  searchUrl.searchParams.set('sortOrder', 'descending');

  const response = await fetchWithTimeout(searchUrl, 25000, {
    headers: { 'user-agent': 'SciForgeWebWorker/0.1 (+https://sciforge.local)' },
  });
  const xml = await response.text();
  if (!response.ok) {
    throw new RetryableToolError(`arXiv API returned HTTP ${response.status}`);
  }
  return {
    results: parseArxivResults(xml).slice(0, limit),
    searchQuery: arxivQuery.searchQuery,
    dateRange: arxivQuery.dateRange,
  };
}

export async function webFetch(input: JsonObject): Promise<JsonObject> {
  if (input.rendered === true || input.browser === true) {
    return browserFetch(input);
  }
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

export async function browserFetch(input: JsonObject): Promise<JsonObject> {
  const url = normalizeHttpUrl(requiredString(input.url, 'url'));
  const maxChars = clampNumber(input.maxChars, 12000, 100, 50000);
  const timeoutMs = clampNumber(input.timeoutMs, 25000, 5000, 60000);
  const request: JsonObject = { url, maxChars, timeoutMs };
  if (browserAutomationForTests) {
    return browserAutomationForTests.fetch(request);
  }

  return withBrowserPage(timeoutMs, async (page) => {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await waitForBrowserSettle(page, timeoutMs);
    const rawText = await page.innerText('body', { timeout: Math.min(5000, timeoutMs) })
      .catch(async () => htmlToText(await page.content()));
    const text = cleanText(rawText);
    const title = cleanText(await page.title().catch(() => ''));
    const links = await browserLinks(page);
    const headers = response?.headers() ?? {};
    const result: JsonObject = {
      url,
      finalUrl: page.url(),
      status: response?.status() ?? 0,
      ok: response?.ok() ?? false,
      contentType: headers['content-type'] ?? '',
      provider: 'playwright-chromium',
      rendered: true,
      text: text.slice(0, maxChars),
      truncated: text.length > maxChars,
      links,
    };
    if (title) {
      result.title = title;
    }
    return result;
  });
}

export class RetryableToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableToolError';
  }
}

async function withBrowserPage<T>(timeoutMs: number, run: (page: Page) => Promise<T>): Promise<T> {
  let chromium: Awaited<typeof import('playwright-core')>['chromium'];
  try {
    ({ chromium } = await import('playwright-core'));
  } catch (error) {
    throw new RetryableToolError(`Playwright browser automation is unavailable: ${errorMessage(error)}`);
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1365, height: 900 },
      userAgent: 'SciForgeBrowserWorker/0.1 (+https://sciforge.local)',
    });
    try {
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(timeoutMs);
      page.setDefaultTimeout(timeoutMs);
      return await run(page);
    } finally {
      await context.close().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof RetryableToolError) throw error;
    throw new RetryableToolError(`Playwright Chromium browser automation failed: ${errorMessage(error)}`);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function waitForBrowserSettle(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: Math.min(5000, timeoutMs) }).catch(() => undefined);
}

async function browserBingResults(page: Page): Promise<WebSearchResult[]> {
  const rows = await page.$$eval('li.b_algo', (nodes) => nodes.map((node) => {
    const titleNode = node.querySelector('h2');
    const anchor = titleNode?.querySelector('a[href]') ?? node.querySelector('a[href]');
    const snippetNode = node.querySelector('.b_caption p') ?? node.querySelector('p');
    return {
      title: (titleNode?.textContent ?? anchor?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      url: anchor instanceof HTMLAnchorElement ? anchor.href : '',
      snippet: (snippetNode?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    };
  }));
  const seen = new Set<string>();
  const results: WebSearchResult[] = [];
  for (const row of rows) {
    if (!row.title || !/^https?:\/\//i.test(row.url) || seen.has(row.url)) continue;
    seen.add(row.url);
    results.push({
      title: cleanText(row.title),
      url: row.url,
      snippet: cleanText(row.snippet),
    });
  }
  return results;
}

async function browserAnchorResults(page: Page): Promise<WebSearchResult[]> {
  const anchors = await page.$$eval('a[href]', (nodes) => nodes.map((node) => {
    const anchor = node as HTMLAnchorElement;
    const title = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
    const url = anchor.href;
    return { title, url };
  }));
  const seen = new Set<string>();
  const results: WebSearchResult[] = [];
  for (const anchor of anchors) {
    const url = decodeDuckDuckGoUrl(anchor.url);
    if (!anchor.title || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    if (/duckduckgo\.com|javascript:|#$/i.test(url)) continue;
    seen.add(url);
    results.push({ title: cleanText(anchor.title), url, snippet: '' });
  }
  return results;
}

async function browserLinks(page: Page): Promise<JsonObject[]> {
  const rows = await page.$$eval('a[href]', (nodes) => nodes.map((node) => {
    const anchor = node as HTMLAnchorElement;
    return {
      text: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim(),
      url: anchor.href,
    };
  }));
  const seen = new Set<string>();
  const links: JsonObject[] = [];
  for (const row of rows) {
    if (!row.url || !/^https?:\/\//i.test(row.url) || seen.has(row.url)) continue;
    seen.add(row.url);
    links.push({ text: cleanText(row.text).slice(0, 160), url: row.url });
    if (links.length >= 40) break;
  }
  return links;
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

function parseArxivResults(xml: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const entryPattern = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  for (const match of xml.matchAll(entryPattern)) {
    const entry = match[1] ?? '';
    const title = xmlText(entry, 'title') || 'Untitled arXiv result';
    const summary = xmlText(entry, 'summary');
    const published = xmlText(entry, 'published');
    const updated = xmlText(entry, 'updated');
    const authors = xmlTexts(entry, 'name');
    const links = xmlLinks(entry);
    const absUrl = links.find((link) => link.rel === 'alternate')?.href
      ?? xmlText(entry, 'id')
      ?? links[0]?.href;
    if (!absUrl) continue;
    const pdfUrl = links.find((link) => link.title === 'pdf' || link.type === 'application/pdf')?.href
      ?? arxivPdfUrl(absUrl);
    const arxivId = extractArxivId(absUrl);
    const parts = [
      arxivId ? `arXiv:${arxivId}` : undefined,
      published ? `published:${published}` : undefined,
      updated && updated !== published ? `updated:${updated}` : undefined,
      authors.length > 0 ? `authors:${authors.slice(0, 6).join(', ')}` : undefined,
      pdfUrl ? `pdf:${pdfUrl}` : undefined,
      summary,
    ].filter((part): part is string => Boolean(part));
    const result: WebSearchResult = {
      title: cleanText(title),
      url: normalizeArxivUrl(absUrl),
      snippet: parts.join(' | '),
    };
    if (arxivId) result.arxivId = arxivId;
    if (published) result.published = published;
    if (updated) result.updated = updated;
    if (authors.length > 0) result.authors = authors;
    if (pdfUrl) result.pdfUrl = pdfUrl;
    if (summary) result.summary = summary;
    results.push(result);
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

function shouldTryArxivSearch(query: string): boolean {
  return /\barxiv\b/i.test(query) || /\b\d{4}\.\d{4,5}(?:v\d+)?\b/i.test(query);
}

function arxivSearchQuery(query: string, now: Date): { searchQuery: string; dateRange?: JsonObject } {
  const arxivId = query.match(/\b\d{4}\.\d{4,5}(?:v\d+)?\b/i)?.[0];
  if (arxivId) {
    return { searchQuery: `id:${arxivId}` };
  }
  const dateRange = parseArxivDateRange(query, Number.isNaN(now.valueOf()) ? new Date() : now);
  const terms = arxivTopicQuery(query)
    .replace(/-/g, ' ')
    .split(/\s+/)
    .map((term) => term.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((term) => term.length > 1 && !/^\d+$/.test(term) && !ARXIV_QUERY_STOPWORDS.has(term.toLowerCase()))
    .slice(0, 8);
  const topicQuery = terms.length > 0 ? terms.map((term) => `all:${term}`).join(' AND ') : `all:${query}`;
  if (!dateRange) {
    return { searchQuery: topicQuery };
  }
  return {
    searchQuery: `${topicQuery} AND submittedDate:[${dateRange.from} TO ${dateRange.to}]`,
    dateRange,
  };
}

function parseArxivDateRange(query: string, now: Date): JsonObject | undefined {
  const anchor = dateAnchor(query) ?? now;
  const daysMatch = query.match(/\b(?:last|past|recent)\s+(\d{1,3})\s+(?:day|days)\b/i)
    ?? query.match(/最近\s*(\d{1,3})\s*天/);
  if (daysMatch?.[1]) {
    const days = Math.max(1, Math.min(365, Number.parseInt(daysMatch[1], 10)));
    return arxivSubmittedDateRange(addUtcDays(anchor, -(days - 1)), anchor);
  }
  const hoursMatch = query.match(/\b(?:last|past|recent)\s+(\d{1,3})\s+(?:hour|hours)\b/i)
    ?? query.match(/最近\s*(\d{1,3})\s*(?:小时|小時)/);
  if (hoursMatch?.[1]) {
    const hours = Math.max(1, Math.min(24 * 365, Number.parseInt(hoursMatch[1], 10)));
    return arxivSubmittedDateRange(addUtcDays(anchor, -(Math.ceil(hours / 24) - 1)), anchor);
  }
  if (/\btoday\b/i.test(query) || /今天/.test(query)) {
    return arxivSubmittedDateRange(anchor, anchor);
  }
  return undefined;
}

function dateAnchor(query: string): Date | undefined {
  const match = query.match(/\b(?:today\s+is\s+)?(20\d{2})-(\d{2})-(\d{2})\b/i);
  if (!match) return undefined;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function arxivSubmittedDateRange(from: Date, to: Date): JsonObject {
  return {
    from: `${formatUtcDate(from)}0000`,
    to: `${formatUtcDate(to)}2359`,
    fromDate: isoDate(from),
    toDate: isoDate(to),
  };
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatUtcDate(date: Date): string {
  return isoDate(date).replace(/-/g, '');
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const ARXIV_QUERY_STOPWORDS = new Set([
  'a',
  'about',
  'abs',
  'abstract',
  'abstracts',
  'an',
  'and',
  'answer',
  'arxiv',
  'article',
  'articles',
  'artifact',
  'authors',
  'candidate',
  'candidates',
  'cannot',
  'chinese',
  'choose',
  'compare',
  'date',
  'days',
  'do',
  'evidence',
  'fail',
  'for',
  'from',
  'full',
  'honestly',
  'id',
  'if',
  'in',
  'is',
  'last',
  'latest',
  'link',
  'links',
  'list',
  'matrix',
  'metadata',
  'must',
  'not',
  'of',
  'old',
  'on',
  'or',
  'paper',
  'papers',
  'pdf',
  'preprint',
  'provider',
  'query',
  'read',
  'reasons',
  'recent',
  'report',
  'say',
  'search',
  'select',
  'source',
  'sources',
  'submission',
  'submit',
  'submitt',
  'submitted',
  'text',
  'the',
  'title',
  'titles',
  'to',
  'today',
  'try',
  'unread',
  'updated',
  'use',
  'verified',
  'with',
  'yesterday',
]);

function arxivTopicQuery(query: string): string {
  const topic = query
    .replace(/\b(?:today\s+is\s+)?20\d{2}-\d{2}-\d{2}\b/gi, ' ')
    .replace(/\b(?:arxiv|preprint|paper|papers|article|articles|pdf|full[-\s]?text|latest|recent|today|yesterday|last\s+\d+\s+(?:day|days|week|weeks|month|months))\b/gi, ' ')
    .replace(/\b(?:choose|select|compare|report|matrix|evidence|source|sources|authors?|title|titles?|date|dates?|link|links?)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}._-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return topic || query;
}

function xmlText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  const value = match ? cleanText(match[1] ?? '') : '';
  return value || undefined;
}

function xmlTexts(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  return Array.from(xml.matchAll(pattern))
    .map((match) => cleanText(match[1] ?? ''))
    .filter(Boolean);
}

function xmlLinks(xml: string): Array<{ href?: string; rel?: string; title?: string; type?: string }> {
  return Array.from(xml.matchAll(/<link\b[^>]*>/gi)).map((match) => {
    const tag = match[0] ?? '';
    return {
      href: xmlAttribute(tag, 'href'),
      rel: xmlAttribute(tag, 'rel'),
      title: xmlAttribute(tag, 'title'),
      type: xmlAttribute(tag, 'type'),
    };
  });
}

function xmlAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'));
  const value = match ? decodeHtml(match[1] ?? '').trim() : '';
  return value || undefined;
}

function extractArxivId(url: string): string | undefined {
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:\.pdf)?(?:[?#]|$)/i);
  return match?.[1];
}

function arxivPdfUrl(url: string): string | undefined {
  const id = extractArxivId(url);
  return id ? `https://arxiv.org/pdf/${id}` : undefined;
}

function normalizeArxivUrl(url: string): string {
  const id = extractArxivId(url);
  return id ? `https://arxiv.org/abs/${id}` : url;
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
