import type { ResearchSearchProvider, ResearchSearchProviderResult, ResearchSearchRequest, ResearchWebResult } from '../types.js';
import { errorMessage, fetchJson } from '../http.js';

const DUCKDUCKGO_URL = 'https://api.duckduckgo.com/';

/** Public web-search fallback that requires no API key. */
export class DuckDuckGoResearchProvider implements ResearchSearchProvider {
  readonly id = 'tavily' as const;

  async search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult> {
    const url = new URL(DUCKDUCKGO_URL);
    url.searchParams.set('q', request.query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('no_redirect', '1');
    url.searchParams.set('skip_disambig', '1');
    try {
      const json = await fetchJson(url.href, request.timeoutMs, request.signal, {
        headers: { Accept: 'application/json', 'User-Agent': 'SciForge research search' }
      });
      const webResults = parseResults(json).slice(0, request.maxResults);
      return { papers: [], webResults, diagnostics: [{ id: this.id, enabled: true, available: true, resultCount: webResults.length }] };
    } catch (error) {
      return { papers: [], webResults: [], diagnostics: [{ id: this.id, enabled: true, available: false, reason: errorMessage(error) }] };
    }
  }
}

function parseResults(value: unknown): ResearchWebResult[] {
  const record = asRecord(value);
  const results: ResearchWebResult[] = [];
  const abstract = stringValue(record.AbstractText);
  const abstractUrl = stringValue(record.AbstractURL);
  const heading = stringValue(record.Heading);
  if (abstract && abstractUrl) results.push({ title: heading || abstractUrl, url: abstractUrl, snippet: abstract, source: 'tavily', rank: 1 });
  const related = record.RelatedTopics;
  if (Array.isArray(related)) {
    for (const item of related) {
      const row = asRecord(item);
      const url = stringValue(row.FirstURL);
      const text = stringValue(row.Text);
      if (!url || !text || results.some((result) => result.url === url)) continue;
      results.push({ title: text.split(' - ')[0] || url, url, snippet: text, source: 'tavily', rank: results.length + 1 });
    }
  }
  return results;
}

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
