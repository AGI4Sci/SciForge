import { Buffer } from 'node:buffer';

import type {
  BrowserHostSearchEngine,
  BrowserHostSearchOutput,
  BrowserHostSearchResult,
  BrowserHostSessionDriver,
} from './browser-host-session-types.js';

export function browserHostSearchUrl(engine: BrowserHostSearchEngine, query: string, region = 'us-en'): string {
  if (engine === 'duckduckgo') {
    const url = new URL('https://duckduckgo.com/html/');
    url.searchParams.set('q', query);
    if (region.trim()) url.searchParams.set('kl', region.trim());
    return url.toString();
  }
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('q', query);
  if (region.toLowerCase().startsWith('us')) {
    url.searchParams.set('cc', 'US');
    url.searchParams.set('mkt', 'en-US');
    url.searchParams.set('setlang', 'en-US');
  } else if (region.trim()) {
    url.searchParams.set('setlang', region.trim());
  }
  return url.toString();
}

export function browserHostSearchSummary(output: BrowserHostSearchOutput, maxResults = 5): string {
  const lines = output.results.slice(0, maxResults).map((result, index) => (
    `${index + 1}. ${result.title} - ${result.url}${result.snippet ? `\n   ${result.snippet}` : ''}`
  ));
  return [
    `BrowserHostSession search: ${output.query}`,
    `Final URL: ${output.finalUrl}`,
    `Results: ${output.results.length}`,
    `Opened source pages: ${(output.sourcePages ?? []).filter((page) => page.status === 'read').length}`,
    ...(output.sourcePages ?? [])
      .filter((page) => page.status === 'read' && page.textRef)
      .slice(0, maxResults)
      .map((page, index) => `Source ${index + 1}: ${page.title} - ${page.finalUrl || page.url}\n   ${page.textRef}`),
    ...lines,
  ].join('\n');
}

export async function genericSearchResultsFromDriver(driver: BrowserHostSessionDriver, limit: number): Promise<BrowserHostSearchResult[]> {
  const text = await driver.text().catch(() => '');
  return text
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .slice(0, limit)
    .map((line, index) => ({ title: line.slice(0, 120), url: driver.url(), snippet: index === 0 ? line : '' }));
}

export function browserHostSearchResultExtractionScript(limit: number): string {
  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit || 5)));
  return `(() => {
    const limit = ${JSON.stringify(safeLimit)};
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const rows = [];
    const seen = new Set();
    const navTitle = /^(?:skip to content|web|images|videos|news|maps|shopping|more|all|search)$/i;
    const add = (title, href, snippet) => {
      const cleanTitle = clean(title);
      const url = String(href || '');
      if (!cleanTitle || !url || seen.has(url) || navTitle.test(cleanTitle)) return;
      seen.add(url);
      rows.push({
        title: cleanTitle,
        url,
        snippet: clean(snippet).replace(cleanTitle, '').trim()
      });
    };
    const resultSelectors = [
      '#b_results > li.b_algo',
      '#b_results > li.b_ans',
      'li.b_algo',
      'article[data-testid="result"]',
      'div[data-testid="result"]',
      'div.result',
      'article.result',
      'div.g',
      'div.MjjYud',
      '[data-sokoban-container]'
    ];
    const titleSelectors = [
      'h2 a[href]',
      'h3 a[href]',
      'a[data-testid="result-title-a"][href]',
      'a.result__a[href]',
      'a[href]'
    ];
    for (const resultSelector of resultSelectors) {
      for (const container of Array.from(document.querySelectorAll(resultSelector))) {
        const anchor = titleSelectors
          .map((selector) => container.querySelector ? container.querySelector(selector) : null)
          .find((candidate) => candidate && candidate.href && clean(candidate.textContent));
        if (!anchor) continue;
        add(anchor.textContent, anchor.href, container.innerText || container.textContent || '');
        if (rows.length >= limit) return rows.slice(0, limit);
      }
    }
    if (rows.length) return rows.slice(0, limit);
    for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
      const container = anchor.closest ? anchor.closest('li, article, div') : null;
      add(anchor.textContent, anchor.href, container && (container.innerText || container.textContent || ''));
      if (rows.length >= limit) break;
    }
    return rows.slice(0, limit);
  })()`;
}

export function nativeSearchResult(value: unknown): BrowserHostSearchResult {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    title: cleanText(typeof record.title === 'string' ? record.title : ''),
    url: typeof record.url === 'string' ? record.url : '',
    snippet: cleanText(typeof record.snippet === 'string' ? record.snippet : ''),
  };
}

export function decodeSearchRedirect(value: string) {
  try {
    const url = new URL(value);
    const uddg = url.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    const target = url.searchParams.get('url') ?? url.searchParams.get('u');
    if (target && /^https?:\/\//i.test(target)) return target;
    const bingTarget = decodeBingRedirectTarget(target);
    if (bingTarget) return bingTarget;
    return url.toString();
  } catch {
    return value;
  }
}

export function boundedSearchResults(rows: Array<Partial<BrowserHostSearchResult>>, limit: number): BrowserHostSearchResult[] {
  const seen = new Set<string>();
  const results: BrowserHostSearchResult[] = [];
  for (const row of rows) {
    const url = typeof row.url === 'string' ? decodeSearchRedirect(row.url.trim()) : '';
    const title = cleanText(String(row.title ?? ''));
    if (!title || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    if (isSearchEngineNavigationUrl(url, title)) continue;
    seen.add(url);
    results.push({
      title: title.slice(0, 180),
      url,
      snippet: cleanText(String(row.snippet ?? '')).slice(0, 320),
    });
    if (results.length >= limit) break;
  }
  return results;
}

function decodeBingRedirectTarget(value: string | null): string | undefined {
  if (!value) return undefined;
  const candidate = value.replace(/^a\d/i, '');
  if (!candidate || candidate === value) return undefined;
  try {
    const decoded = Buffer.from(candidate, 'base64url').toString('utf8');
    return /^https?:\/\//i.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function isSearchEngineNavigationUrl(value: string, title: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (!/(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)google\.[a-z.]+$/i.test(host)) return false;
    if (/^(?:skip to content|web|images|videos|news|maps|shopping|more|all|search)$/i.test(title)) return true;
    if (/(^|\.)bing\.com$/i.test(host)) {
      return path === '/' || path === '/search' || /^\/(?:images|videos|news|maps)\/search/.test(path);
    }
    if (/(^|\.)duckduckgo\.com$/i.test(host)) {
      return path === '/' || path === '/html/' || path === '/html';
    }
    return path === '/search' || path.startsWith('/search/');
  } catch {
    return false;
  }
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
