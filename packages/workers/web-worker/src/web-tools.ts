import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { JsonObject } from '../../../contracts/tool-worker/src/index';
import type { Page } from 'playwright-core';
import { createPlaywrightEdgeBrowserAutomationProvider } from '../../../observe/web/mcp/playwright-edge-provider';

const execFileAsync = promisify(execFile);

export interface WebSearchResult extends JsonObject {
  title: string;
  url: string;
  snippet: string;
}

interface ArxivSearchResponse {
  results: WebSearchResult[];
  searchQuery: string;
  dateRange?: JsonObject;
  dateFallback?: JsonObject;
}

export interface BrowserAutomationForTests {
  search(input: JsonObject): Promise<JsonObject>;
  fetch(input: JsonObject): Promise<JsonObject>;
}

export interface PdfTextExtractionForTests {
  extract(input: { bytes: Uint8Array; url: string; maxChars: number; maxPages: number; timeoutMs: number }): Promise<JsonObject>;
}

let browserAutomationForTests: BrowserAutomationForTests | undefined;
let playwrightEdgeMcpAutomation: BrowserAutomationForTests | undefined;
let playwrightEdgeMcpAutomationKey: string | undefined;
let pdfTextExtractionForTests: PdfTextExtractionForTests | undefined;
let pdfTextExtractionAvailableForTests: boolean | undefined;

export function setBrowserAutomationForTests(provider: BrowserAutomationForTests | undefined): void {
  browserAutomationForTests = provider;
}

export function setPdfTextExtractionForTests(provider: PdfTextExtractionForTests | undefined): void {
  pdfTextExtractionForTests = provider;
}

export function setPdfTextExtractionAvailableForTests(available: boolean | undefined): void {
  pdfTextExtractionAvailableForTests = available;
}

export async function pdfTextExtractorHealth(): Promise<{ available: boolean; extractor: string; reason?: string }> {
  if (pdfTextExtractionAvailableForTests !== undefined) {
    return {
      available: pdfTextExtractionAvailableForTests,
      extractor: pdfTextExtractionForTests ? 'test-pdf' : 'pdftotext',
      ...(pdfTextExtractionAvailableForTests ? {} : { reason: 'pdf text extraction disabled by test override' }),
    };
  }
  if (pdfTextExtractionForTests) return { available: true, extractor: 'test-pdf' };
  try {
    await execFileAsync('pdftotext', ['-v'], { timeout: 1500, maxBuffer: 4096 });
    return { available: true, extractor: 'pdftotext' };
  } catch (error) {
    return {
      available: false,
      extractor: 'pdftotext',
      reason: errorMessage(error),
    };
  }
}

export async function webSearch(input: JsonObject): Promise<JsonObject> {
  const rawQuery = requiredString(input.query, 'query');
  const query = normalizeSearchQuery(rawQuery);
  const limit = clampNumber(input.limit ?? input.maxResults, 5, 1, 10);
  const now = typeof input.now === 'string' && input.now.trim() ? new Date(input.now) : new Date();
  const region = typeof input.region === 'string' && input.region.length > 0 ? input.region : 'us-en';
  const fallbackErrors: string[] = [];
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
          ...(arxivResponse.dateFallback ? { dateFallback: arxivResponse.dateFallback } : {}),
          results: arxivResponse.results,
        };
      }
      fallbackErrors.push(`arxiv-api returned no records for ${arxivResponse.searchQuery}`);
    } catch (error) {
      fallbackErrors.push(`arxiv-api: ${errorMessage(error)}`);
    }
    try {
      const browserResponse = await browserArxivSearch(query, limit, now, region);
      if (browserResponse.results.length > 0) {
        return {
          query,
          rawQuery,
          provider: 'arxiv-browser',
          fallbackFrom: 'arxiv-api',
          fallbackReasons: fallbackErrors,
          providerQuery: browserResponse.searchQuery,
          ...(browserResponse.dateRange ? { dateRange: browserResponse.dateRange } : {}),
          ...(browserResponse.dateFallback ? { dateFallback: browserResponse.dateFallback } : {}),
          results: browserResponse.results,
        };
      }
      fallbackErrors.push(`arxiv-browser returned no arXiv records for ${browserResponse.searchQuery}`);
    } catch (error) {
      fallbackErrors.push(`arxiv-browser: ${errorMessage(error)}`);
    }
    throw new RetryableToolError(`arxiv providers could not satisfy explicit arXiv query: ${fallbackErrors.join('; ')}`);
  }

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
    const browserResponse = await renderedBrowserSearch({ query, rawQuery, limit, region });
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
    fallbackErrors.push('playwright-chromium rendered search returned no parseable results');
  } catch (error) {
    fallbackErrors.push(`playwright-chromium rendered search: ${errorMessage(error)}`);
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

async function renderedBrowserSearch(input: JsonObject): Promise<JsonObject> {
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
  const mcpAutomation = browserAutomationFromMcpEnv(input);
  if (mcpAutomation) {
    return mcpAutomation.search({ ...request, ...(stringField(input.mcpUrl) ? { mcpUrl: input.mcpUrl } : {}) });
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

async function arxivSearch(query: string, limit: number, now: Date, options: { ignoreDateRange?: boolean } = {}): Promise<ArxivSearchResponse> {
  const primary = await arxivSearchOnce(query, limit, now, options);
  if (primary.results.length > 0 || !primary.dateRange || options.ignoreDateRange) return primary;
  const relaxed = await arxivSearchOnce(query, limit, now, { ignoreDateRange: true });
  if (relaxed.results.length === 0) return primary;
  return {
    ...relaxed,
    dateRange: primary.dateRange,
    dateFallback: {
      reason: 'requested arXiv submitted-date window returned no records; relaxed to latest matching arXiv records',
      requestedQuery: primary.searchQuery,
      requestedDateRange: primary.dateRange,
    },
  };
}

async function arxivSearchOnce(query: string, limit: number, now: Date, options: { ignoreDateRange?: boolean } = {}): Promise<ArxivSearchResponse> {
  const searchUrl = new URL('https://export.arxiv.org/api/query');
  const arxivQuery = arxivSearchQuery(query, now, options);
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
  const maxPages = clampNumber(input.maxPages, 8, 1, 50);
  const timeoutMs = clampNumber(input.timeoutMs, 20000, 5000, 60000);
  const response = await fetchWithTimeout(url, timeoutMs, {
    redirect: 'follow',
    headers: { 'user-agent': 'SciForgeWebWorker/0.1 (+https://sciforge.local)' },
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (looksLikePdf(url, contentType)) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const extraction = await extractPdfText({
      bytes,
      url: response.url || url,
      maxChars,
      maxPages,
      timeoutMs,
    });
    const text = stringField(extraction.text) ?? '';
    return {
      url,
      finalUrl: response.url,
      status: response.status,
      ok: response.ok,
      contentType,
      mediaType: 'application/pdf',
      text,
      truncated: extraction.truncated === true,
      pdfExtraction: extraction,
    };
  }
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

export async function pdfExtract(input: JsonObject): Promise<JsonObject> {
  const url = normalizeHttpUrl(requiredString(input.url, 'url'));
  const maxChars = clampNumber(input.maxChars, 12000, 100, 50000);
  const maxPages = clampNumber(input.maxPages, 8, 1, 50);
  const timeoutMs = clampNumber(input.timeoutMs, 20000, 5000, 60000);
  const response = await fetchWithTimeout(url, timeoutMs, {
    redirect: 'follow',
    headers: {
      accept: 'application/pdf,*/*;q=0.8',
      'user-agent': 'SciForgeWebWorker/0.1 (+https://sciforge.local)',
    },
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!looksLikePdf(response.url || url, contentType)) {
    return {
      url,
      finalUrl: response.url,
      status: response.status,
      ok: response.ok,
      contentType,
      mediaType: contentType || 'unknown',
      text: '',
      truncated: false,
      pdfExtraction: {
        status: 'unavailable',
        extractor: 'pdftotext',
        reason: `URL did not return a PDF response; content-type=${contentType || 'unknown'}`,
      },
    };
  }
  const extraction = await extractPdfText({
    bytes: new Uint8Array(await response.arrayBuffer()),
    url: response.url || url,
    maxChars,
    maxPages,
    timeoutMs,
  });
  return {
    url,
    finalUrl: response.url,
    status: response.status,
    ok: response.ok,
    contentType,
    mediaType: 'application/pdf',
    text: stringField(extraction.text) ?? '',
    truncated: extraction.truncated === true,
    pdfExtraction: extraction,
  };
}

export async function browserFetch(input: JsonObject): Promise<JsonObject> {
  const url = normalizeHttpUrl(requiredString(input.url, 'url'));
  const maxChars = clampNumber(input.maxChars, 12000, 100, 50000);
  const timeoutMs = clampNumber(input.timeoutMs, 25000, 5000, 60000);
  const request: JsonObject = { url, maxChars, timeoutMs };
  if (browserAutomationForTests) {
    return browserAutomationForTests.fetch(request);
  }
  const mcpAutomation = browserAutomationFromMcpEnv(input);
  if (mcpAutomation) {
    return mcpAutomation.fetch({ ...request, ...(stringField(input.mcpUrl) ? { mcpUrl: input.mcpUrl } : {}) });
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

async function browserArxivSearch(query: string, limit: number, now: Date, region: string): Promise<ArxivSearchResponse> {
  const dateRange = parseArxivDateRange(query, Number.isNaN(now.valueOf()) ? new Date() : now);
  const topic = arxivTopicQuery(query);
  const searchQuery = `site:arxiv.org/abs ${topic}`;
  const pageErrors: string[] = [];
  let searchResults = await browserArxivSearchResults(searchQuery, query, limit, region, pageErrors);
  let candidates = uniqueStrings(searchResults
    .map((result) => normalizeArxivAbsUrl(stringField(result.url) ?? ''))
    .filter((url): url is string => Boolean(url)))
    .slice(0, 10);
  const phraseSearchQuery = arxivPhraseSearchQuery(topic);
  if (candidates.length === 0 && phraseSearchQuery && phraseSearchQuery !== searchQuery) {
    const phraseResults = await browserArxivSearchResults(phraseSearchQuery, query, limit, region, pageErrors);
    searchResults = [...searchResults, ...phraseResults];
    candidates = uniqueStrings(phraseResults
      .map((result) => normalizeArxivAbsUrl(stringField(result.url) ?? ''))
      .filter((url): url is string => Boolean(url)))
      .slice(0, 10);
  }
  if (candidates.length === 0) {
    candidates = await recentArxivListCandidates(topic, limit, pageErrors);
  }
  if (candidates.length === 0) {
    try {
      candidates = await directArxivSearchCandidates(topic);
    } catch (error) {
      pageErrors.push(`direct arXiv rendered search: ${errorMessage(error)}`);
      candidates = [];
    }
  }
  const pageRows: WebSearchResult[] = [];
  for (const absUrl of candidates) {
    try {
      const page = await browserFetch({ url: absUrl, maxChars: 16000, timeoutMs: 30000 });
      const row = arxivResultFromBrowserPage(absUrl, page, searchResults.find((result) => normalizeArxivAbsUrl(stringField(result.url) ?? '') === absUrl));
      if (row) pageRows.push(row);
    } catch (error) {
      pageErrors.push(`${absUrl}: ${errorMessage(error)}`);
    }
    if (arxivRowsMatchingTopic(pageRows, topic).length >= Math.max(limit, 3)) break;
  }
  const topicRows = arxivRowsMatchingTopic(pageRows, topic);
  const requiresTopicFilter = arxivTopicTerms(topic).length >= 2;
  const rowsForDate = requiresTopicFilter ? topicRows : (topicRows.length ? topicRows : pageRows);
  const datedRows = dateRange
    ? rowsForDate.filter((row) => typeof row.published === 'string' && arxivPublishedDateInRange(row.published, dateRange))
    : rowsForDate;
  if (datedRows.length > 0 || !dateRange) {
    return {
      results: datedRows.slice(0, limit),
      searchQuery,
      ...(dateRange ? { dateRange } : {}),
    };
  }
  return {
    results: rowsForDate.slice(0, limit),
    searchQuery,
    dateRange,
    dateFallback: {
      reason: rowsForDate.length
        ? 'browser arXiv fallback found matching arXiv records, but none could be verified inside the requested submitted-date window'
        : pageRows.length
          ? 'browser arXiv fallback found arXiv records, but none matched the requested topic strongly enough'
          : 'browser arXiv fallback found no parseable arXiv records in the requested submitted-date window',
      requestedQuery: searchQuery,
      requestedDateRange: dateRange,
      ...(phraseSearchQuery && phraseSearchQuery !== searchQuery ? { phraseSearchQuery } : {}),
      ...(pageRows.length && !rowsForDate.length ? { rejectedCandidateCount: pageRows.length } : {}),
      ...(pageErrors.length ? { pageErrors: pageErrors.slice(0, 3) } : {}),
    },
  };
}

async function browserArxivSearchResults(
  searchQuery: string,
  rawQuery: string,
  limit: number,
  region: string,
  errors: string[],
): Promise<WebSearchResult[]> {
  const request = {
    query: searchQuery,
    rawQuery,
    limit: Math.min(10, Math.max(limit * 3, limit)),
    region,
    timeoutMs: 30000,
  };
  for (const engine of ['bing', 'duckduckgo'] as const) {
    try {
      const searchResponse = await renderedBrowserSearch({ ...request, engine });
      const results = Array.isArray(searchResponse.results)
        ? searchResponse.results.filter(isRecord) as WebSearchResult[]
        : [];
      if (results.length > 0) return results;
      errors.push(`${engine} rendered search returned no arXiv candidates for ${searchQuery}`);
    } catch (error) {
      errors.push(`${engine} rendered search: ${errorMessage(error)}`);
    }
  }
  return [];
}

function arxivRowsMatchingTopic(rows: WebSearchResult[], topic: string) {
  const terms = arxivTopicTerms(topic);
  if (terms.length < 2) return rows;
  const phraseProfile = arxivTopicPhraseProfile(topic);
  const threshold = Math.min(3, terms.length);
  return rows.filter((row) => {
    const haystack = `${row.title} ${row.snippet} ${stringField(row.summary) ?? ''}`.toLowerCase();
    const phraseHit = phraseProfile.phrases.some((phrase) => phraseRegex(phrase).test(haystack));
    const aliasHit = arxivTopicAliasRegexes(topic).some((regex) => regex.test(haystack));
    if (phraseProfile.requirePhrase) return phraseHit || aliasHit;
    const score = terms.reduce((count, term) => count + (new RegExp(`\\b${escapeRegExp(term)}s?\\b`, 'i').test(haystack) ? 1 : 0), 0);
    return phraseHit || aliasHit || score >= threshold;
  });
}

function arxivTopicTerms(topic: string) {
  const terms = topic
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((term) => term.length > 2 && !/^\d+$/.test(term) && !ARXIV_QUERY_STOPWORDS.has(term));
  const withoutGenericUse = terms.filter((term) => !['use', 'uses', 'using'].includes(term));
  return withoutGenericUse.length >= 2 ? uniqueStrings(withoutGenericUse) : uniqueStrings(terms);
}

function arxivTopicPhraseProfile(topic: string) {
  const terms = topic
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((term) => term.length > 2 && !/^\d+$/.test(term) && !ARXIV_QUERY_STOPWORDS.has(term));
  const phrases: string[] = [];
  for (let index = 0; index < terms.length - 1; index += 1) {
    const phrase = `${terms[index]} ${terms[index + 1]}`;
    if (phrase.trim().split(/\s+/).length === 2) phrases.push(phrase);
  }
  return {
    phrases: uniqueStrings(phrases),
    requirePhrase: phrases.some((phrase) => /\b(?:use|uses|using)\b/.test(phrase)),
  };
}

function arxivPhraseSearchQuery(topic: string): string | undefined {
  const profile = arxivTopicPhraseProfile(topic);
  if (profile.phrases.length === 0) return undefined;
  const quotedPhrase = profile.phrases
    .find((phrase) => /\b(?:use|uses|using)\b/.test(phrase))
    ?? profile.phrases[0];
  if (!quotedPhrase) return undefined;
  const phraseTerms = new Set(quotedPhrase.split(/\s+/));
  const remainingTerms = arxivTopicTerms(topic).filter((term) => !phraseTerms.has(term)).slice(0, 3);
  return [`site:arxiv.org/abs`, `"${quotedPhrase}"`, ...remainingTerms].join(' ');
}

function arxivTopicAliasRegexes(topic: string): RegExp[] {
  const normalized = topic.toLowerCase().replace(/[-_]+/g, ' ');
  const aliases: RegExp[] = [];
  if (/\bcomputer\s+use\b/.test(normalized)) {
    aliases.push(
      /\bcomputer[\s-]+use\b/i,
      /\b(?:gui|ui)[\s-]+(?:agent|control|automation|navigation|interaction|trace|critique)s?\b/i,
      /\b(?:browser|web|saas)[\s-]+agents?\b/i,
      /\bagents?[\s-]+(?:for|in|on)[\s-]+(?:browser|web|saas|gui|ui)\b/i,
      /\bOS[\s-]+exploration\b/i,
      /\boperating[\s-]+system[\s-]+(?:exploration|agent|control|automation)\b/i,
    );
  }
  return aliases;
}

function phraseRegex(phrase: string) {
  const parts = phrase.split(/\s+/).map(escapeRegExp);
  return new RegExp(`\\b${parts.join('[\\s-]+')}s?\\b`, 'i');
}

async function recentArxivListCandidates(topic: string, limit: number, errors: string[]): Promise<string[]> {
  const categories = arxivRecentCategories(topic);
  const candidates: WebSearchResult[] = [];
  for (const category of categories) {
    const listUrl = new URL(`https://arxiv.org/list/${category}/recent`);
    listUrl.searchParams.set('show', '100');
    try {
      const response = await fetchWithTimeout(listUrl, 20000, {
        headers: { 'user-agent': 'SciForgeWebWorker/0.1 (+https://sciforge.local)' },
      });
      const html = await response.text();
      if (!response.ok) {
        errors.push(`arXiv recent ${category}: HTTP ${response.status}`);
        continue;
      }
      candidates.push(...parseArxivRecentList(html));
    } catch (error) {
      errors.push(`arXiv recent ${category}: ${errorMessage(error)}`);
    }
    if (arxivRowsMatchingTopic(candidates, topic).length >= Math.max(limit, 3)) break;
  }
  const rows = arxivRowsMatchingTopic(candidates, topic);
  return uniqueStrings(rows.map((row) => normalizeArxivAbsUrl(row.url)).filter((url): url is string => Boolean(url))).slice(0, 10);
}

function arxivRecentCategories(topic: string): string[] {
  const normalized = topic.toLowerCase();
  const categories = ['cs.AI'];
  if (/\b(?:computer|gui|ui|browser|web|os|saas|human)\b/.test(normalized)) categories.push('cs.HC');
  if (/\b(?:language|llm|agent|reasoning|chat|dialog)\b/.test(normalized)) categories.push('cs.CL');
  if (/\b(?:learning|reinforcement|rl|benchmark|model)\b/.test(normalized)) categories.push('cs.LG');
  if (/\b(?:software|coding|program|repository|workflow)\b/.test(normalized)) categories.push('cs.SE');
  return uniqueStrings(categories).slice(0, 6);
}

function parseArxivRecentList(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const itemPattern = /<dt\b[^>]*>[\s\S]*?<a\s+href\s*=\s*"\/abs\/([^"]+)"[\s\S]*?<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  for (const match of html.matchAll(itemPattern)) {
    const arxivId = cleanText(match[1] ?? '');
    const body = match[2] ?? '';
    const titleMatch = body.match(/<div class='list-title[^']*'><span class='descriptor'>Title:<\/span>([\s\S]*?)<\/div>/i);
    const title = cleanText(titleMatch?.[1] ?? '');
    if (!arxivId || !title) continue;
    const commentsMatch = body.match(/<div class='list-comments[^']*'><span class='descriptor'>Comments:<\/span>([\s\S]*?)<\/div>/i);
    const subjectsMatch = body.match(/<div class='list-subjects[^']*'><span class='descriptor'>Subjects:<\/span>([\s\S]*?)<\/div>/i);
    const snippet = [cleanText(commentsMatch?.[1] ?? ''), cleanText(subjectsMatch?.[1] ?? '')].filter(Boolean).join(' | ');
    results.push({
      title,
      url: `https://arxiv.org/abs/${arxivId}`,
      snippet,
      arxivId,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    });
  }
  return results;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function arxivResultFromBrowserPage(absUrl: string, page: JsonObject, searchResult: WebSearchResult | undefined): WebSearchResult | undefined {
  const text = stringField(page.text) ?? searchResult?.snippet ?? '';
  const title = arxivTitleFromBrowserPage(page, text, searchResult);
  const arxivId = extractArxivId(absUrl);
  if (!arxivId || !title) return undefined;
  const links = Array.isArray(page.links) ? page.links.filter(isRecord) as Record<string, unknown>[] : [];
  const pdfUrl = links
    .map((link) => stringField(link.url) ?? stringField(link.href))
    .find((url) => Boolean(url && /arxiv\.org\/pdf\//i.test(url)))
    ?? arxivPdfUrl(absUrl);
  const published = arxivSubmittedDateFromText(text);
  const authors = arxivAuthorsFromText(text);
  const summary = arxivAbstractFromText(text) ?? searchResult?.snippet;
  const parts = [
    `arXiv:${arxivId}`,
    published ? `published:${published}` : undefined,
    authors.length ? `authors:${authors.slice(0, 6).join(', ')}` : undefined,
    pdfUrl ? `pdf:${pdfUrl}` : undefined,
    summary,
  ].filter((part): part is string => Boolean(part));
  const result: WebSearchResult = {
    title: cleanText(title),
    url: normalizeArxivUrl(absUrl),
    snippet: parts.join(' | '),
    arxivId,
  };
  if (pdfUrl) result.pdfUrl = pdfUrl;
  if (published) result.published = published;
  if (authors.length) result.authors = authors;
  if (summary) result.summary = summary;
  return result;
}

function arxivTitleFromBrowserPage(page: JsonObject, text: string, searchResult: WebSearchResult | undefined) {
  const pageTitle = stringField(page.title);
  if (pageTitle) {
    const match = pageTitle.match(/^\[\d{4}\.\d{4,5}(?:v\d+)?\]\s*(.+)$/);
    if (match?.[1]) return match[1];
    if (!/arXiv\.org/i.test(pageTitle)) return pageTitle;
  }
  const titleMatch = text.match(/Title:\s*([^\n]+?)(?:\s{2,}|Authors?:|Abstract:|$)/i)
    ?? text.match(/\]\s*([^|\n]+?)(?:\s+Authors?:|\s+Abstract:|$)/i);
  return titleMatch?.[1]?.trim() ?? searchResult?.title;
}

function arxivSubmittedDateFromText(text: string) {
  const submitted = text.match(/Submitted\s+on\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})/i)
    ?? text.match(/(?:published|submitted)[:\s]+(20\d{2}-\d{2}-\d{2})/i);
  if (!submitted) return undefined;
  if (submitted[1]?.includes('-')) return submitted[1];
  const day = Number.parseInt(submitted[1] ?? '', 10);
  const month = monthIndex(submitted[2] ?? '');
  const year = Number.parseInt(submitted[3] ?? '', 10);
  if (!day || month < 0 || !year) return undefined;
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function arxivAuthorsFromText(text: string) {
  const match = text.match(/Authors?:\s*([\s\S]{0,500}?)(?:Abstract:|Comments?:|Subjects?:|\n\s*\n|$)/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(/,\s+|\sand\s/i)
    .map((author) => cleanText(author))
    .filter((author) => author.length > 0 && author.length < 120)
    .slice(0, 20);
}

function arxivAbstractFromText(text: string) {
  const match = text.match(/Abstract:\s*([\s\S]{40,2000}?)(?:Comments?:|Subjects?:|Cite as:|Submission history|$)/i);
  return match?.[1] ? cleanText(match[1]).slice(0, 1200) : undefined;
}

function arxivPublishedDateInRange(published: string, dateRange: JsonObject) {
  const date = published.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)?.[0];
  const fromDate = stringField(dateRange.fromDate);
  const toDate = stringField(dateRange.toDate);
  if (!date || !fromDate || !toDate) return false;
  return date >= fromDate && date <= toDate;
}

function normalizeArxivAbsUrl(value: string) {
  const id = extractArxivId(value);
  if (!id) return undefined;
  return `https://arxiv.org/abs/${id}`;
}

async function directArxivSearchCandidates(topic: string): Promise<string[]> {
  const searchUrl = new URL('https://arxiv.org/search/');
  searchUrl.searchParams.set('query', topic);
  searchUrl.searchParams.set('searchtype', 'all');
  searchUrl.searchParams.set('abstracts', 'show');
  searchUrl.searchParams.set('order', '-announced_date_first');
  searchUrl.searchParams.set('size', '25');
  const page = await browserFetch({ url: searchUrl.toString(), maxChars: 20000, timeoutMs: 30000 });
  const fromLinks = Array.isArray(page.links)
    ? (page.links.filter(isRecord) as Record<string, unknown>[])
      .map((link) => normalizeArxivAbsUrl(stringField(link.url) ?? stringField(link.href) ?? ''))
      .filter((url): url is string => Boolean(url))
    : [];
  const fromText = Array.from((stringField(page.text) ?? '').matchAll(/\barXiv:(\d{4}\.\d{4,5}(?:v\d+)?)\b/gi))
    .map((match) => `https://arxiv.org/abs/${match[1]}`);
  return uniqueStrings([...fromLinks, ...fromText]).slice(0, 10);
}

function browserAutomationFromMcpEnv(input: JsonObject): BrowserAutomationForTests | undefined {
  const provider = stringField(input.provider) ?? stringField(input.browserProvider);
  const envProvider = process.env.SCIFORGE_WEB_WORKER_BROWSER_PROVIDER;
  const mcpUrl = stringField(input.mcpUrl) ?? process.env.SCIFORGE_PLAYWRIGHT_EDGE_MCP_URL;
  const requested = provider === 'playwright-edge-mcp'
    || input.mcp === true
    || envProvider === 'playwright-edge-mcp'
    || Boolean(mcpUrl);
  if (!requested) return undefined;
  const cacheKey = mcpUrl ?? 'default';
  if (!playwrightEdgeMcpAutomation || playwrightEdgeMcpAutomationKey !== cacheKey) {
    playwrightEdgeMcpAutomation = createPlaywrightEdgeBrowserAutomationProvider(
      mcpUrl ? { mcpUrl } : {},
    ) as BrowserAutomationForTests;
    playwrightEdgeMcpAutomationKey = cacheKey;
  }
  return playwrightEdgeMcpAutomation;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function monthIndex(value: string): number {
  const normalized = value.trim().toLowerCase().slice(0, 3);
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(normalized);
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

function arxivSearchQuery(query: string, now: Date, options: { ignoreDateRange?: boolean } = {}): { searchQuery: string; dateRange?: JsonObject } {
  const arxivId = query.match(/\b\d{4}\.\d{4,5}(?:v\d+)?\b/i)?.[0];
  if (arxivId) {
    return { searchQuery: `id:${arxivId}` };
  }
  const dateRange = options.ignoreDateRange ? undefined : parseArxivDateRange(query, Number.isNaN(now.valueOf()) ? new Date() : now);
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
  if (/\b(?:submitted|submission|published|updated)\s+(?:on|date|window)?\s*(?:20\d{2}[-\s]\d{1,2}[-\s]\d{1,2}|\d{4}\s+\d{1,2}\s+\d{1,2})(?:\s+utc)?\b/i.test(query)) {
    return arxivSubmittedDateRange(anchor, anchor);
  }
  if (/\btoday\b/i.test(query) || /今天/.test(query)) {
    return arxivSubmittedDateRange(anchor, anchor);
  }
  return undefined;
}

function dateAnchor(query: string): Date | undefined {
  const match = query.match(/\b(?:today\s+is\s+|submitted\s+(?:on\s+)?)?(20\d{2})[-\s](\d{1,2})[-\s](\d{1,2})\b/i);
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
  'debug',
  'default',
  'do',
  'evidence',
  'fallback',
  'fail',
  'fold',
  'folded',
  'for',
  'from',
  'full',
  'hard',
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
  'main',
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
  'raw',
  'read',
  'reply',
  'requirement',
  'requirements',
  'reasons',
  'recent',
  'reading',
  'research',
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
  'verified',
  'with',
  'yesterday',
]);

function arxivTopicQuery(query: string): string {
  const topic = query
    .replace(/\b(?:today\s+is\s+)?20\d{2}-\d{2}-\d{2}\b/gi, ' ')
    .replace(/\b(?:submitted|submission|published|updated)\s+(?:on|date|window)?\s*(?:20\d{2}[-\s]\d{1,2}[-\s]\d{1,2}|\d{4}\s+\d{1,2}\s+\d{1,2})(?:\s+utc)?\b/gi, ' ')
    .replace(/\b20\d{2}\s+\d{1,2}\s+\d{1,2}(?:\s+utc)?\b/gi, ' ')
    .replace(/\b(?:arxiv|preprint|paper|papers|article|articles|pdf|full[-\s]?text|latest|recent|today|yesterday|last\s+\d+\s+(?:day|days|week|weeks|month|months))\b/gi, ' ')
    .replace(/\b(?:choose|select|compare|report|matrix|evidence|source|sources|authors?|title|titles?|date|dates?|link|links?)\b/gi, ' ')
    .replace(/\b(?:research|investigate|survey|review|summari[sz]e|find|search|read|write|produce|create|list|availability|available|unavailable|note|locations?|sections?|pages?|snippets?|conclusions?|limitations?|advice|follow[-\s]?up|supported|method|methods|differences?|key|next|reading|as|much|possible)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}._-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const terms = topic
    .split(/\s+/)
    .map((term) => term.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((term) => term.length > 1 && !/^\d+$/.test(term) && !ARXIV_QUERY_STOPWORDS.has(term.toLowerCase()));
  const latinTerms = terms.flatMap((term) => term.match(/[a-z][a-z0-9._-]*/gi) ?? []);
  const queryTerms = latinTerms.length >= 2 ? latinTerms : terms;
  return queryTerms.join(' ') || query;
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

function looksLikePdf(url: string, contentType: string): boolean {
  return /application\/pdf|application\/x-pdf/i.test(contentType)
    || /\.pdf(?:$|[?#])/i.test(url)
    || /arxiv\.org\/pdf\//i.test(url);
}

async function extractPdfText(input: {
  bytes: Uint8Array;
  url: string;
  maxChars: number;
  maxPages: number;
  timeoutMs: number;
}): Promise<JsonObject> {
  if (pdfTextExtractionForTests) {
    return pdfTextExtractionForTests.extract(input);
  }
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-web-pdf-'));
  const pdfPath = join(dir, 'input.pdf');
  try {
    await writeFile(pdfPath, input.bytes);
    const { stdout } = await execFileAsync('pdftotext', [
      '-layout',
      '-enc',
      'UTF-8',
      '-f',
      '1',
      '-l',
      String(input.maxPages),
      pdfPath,
      '-',
    ], {
      timeout: input.timeoutMs,
      maxBuffer: Math.max(1024 * 1024, input.maxChars * 4),
    });
    const text = cleanPdfText(stdout);
    if (!text) {
      return {
        status: 'unavailable',
        extractor: 'pdftotext',
        reason: 'pdftotext returned no extractable text for the bounded page range',
        pageRange: `1-${input.maxPages}`,
        sourceUrl: input.url,
      };
    }
    const truncated = text.length > input.maxChars;
    return {
      status: 'extracted',
      extractor: 'pdftotext',
      pageRange: `1-${input.maxPages}`,
      sourceUrl: input.url,
      evidenceLocations: [`${input.url}#page=1`, `${input.url}#page=${input.maxPages}`],
      charsExtracted: Math.min(text.length, input.maxChars),
      truncated,
      text: text.slice(0, input.maxChars),
    };
  } catch (error) {
    return {
      status: 'failed',
      extractor: 'pdftotext',
      pageRange: `1-${input.maxPages}`,
      sourceUrl: input.url,
      reason: errorMessage(error),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function cleanPdfText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
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
  if (quotedMatch?.[1] && !/\bsite:\S+/i.test(collapsed) && !/\b(include|create|field|matrix|artifact|summary)\b/i.test(quotedMatch[1])) {
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
