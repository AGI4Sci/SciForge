import type {
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest,
  ResearchWebResult
} from '../types.js';
import { errorMessage, fetchJson } from '../http.js';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

export class TavilyResearchProvider implements ResearchSearchProvider {
  readonly id: 'tavily' | 'cns';

  constructor(
    private readonly apiKey: string,
    private readonly options: {
      id?: 'tavily' | 'cns';
      includeDomains?: string[];
      resultSource?: 'tavily' | 'cns';
    } = {}
  ) {
    this.id = options.id ?? 'tavily';
  }

  async search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult> {
    if (!this.apiKey.trim()) {
      return {
        papers: [],
        webResults: [],
        diagnostics: [{
          id: this.id,
          enabled: true,
          available: false,
          reason: 'Tavily API key is required'
        }]
      };
    }
    try {
      const json = await fetchJson(TAVILY_SEARCH_URL, request.timeoutMs, request.signal, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: this.apiKey.trim(),
          query: request.query,
          search_depth: request.intent === 'overview' || request.intent === 'gap' ? 'advanced' : 'basic',
          max_results: request.maxResults,
          include_answer: false,
          include_raw_content: false,
          ...(this.options.includeDomains?.length ? { include_domains: this.options.includeDomains } : {})
        })
      });
      const webResults = parseTavilyResults(json, this.options.resultSource ?? 'tavily');
      return {
        papers: [],
        webResults,
        diagnostics: [{
          id: this.id,
          enabled: true,
          available: true,
          resultCount: webResults.length
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

function parseTavilyResults(value: unknown, source: 'tavily' | 'cns'): ResearchWebResult[] {
  const results = asRecord(value).results;
  if (!Array.isArray(results)) return [];
  return results.map((item, index) => {
    const record = asRecord(item);
    const title = stringValue(record.title) || stringValue(record.url);
    const url = stringValue(record.url);
    if (!title || !url) return null;
    return {
      title,
      url,
      snippet: stringValue(record.content),
      source,
      rank: index + 1
    };
  }).filter((item): item is ResearchWebResult => item !== null);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
