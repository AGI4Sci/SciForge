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
    if (/^(?:https?:\/\/)?(?:www\.)?(?:bing|duckduckgo)\.com(?:\/|$)/i.test(url)) continue;
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

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
