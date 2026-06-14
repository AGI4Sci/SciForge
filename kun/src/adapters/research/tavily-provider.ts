import type {
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest,
  ResearchWebResult
} from '../../ports/research-provider.js'

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'

export class TavilyResearchProvider implements ResearchSearchProvider {
  readonly id: string

  constructor(
    private readonly apiKey: string,
    private readonly options: {
      id?: string
      includeDomains?: string[]
      resultSource?: 'tavily' | 'cns'
    } = {}
  ) {
    this.id = options.id ?? 'tavily'
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
      }
    }
    try {
      const json = await fetchJson(TAVILY_SEARCH_URL, request.timeoutMs, request.signal, {
        api_key: this.apiKey.trim(),
        query: request.query,
        search_depth: request.intent === 'overview' || request.intent === 'gap' ? 'advanced' : 'basic',
        max_results: request.maxResults,
        include_answer: false,
        include_raw_content: false,
        ...(this.options.includeDomains?.length ? { include_domains: this.options.includeDomains } : {})
      })
      const webResults = parseTavilyResults(json, this.options.resultSource ?? 'tavily')
      return {
        papers: [],
        webResults,
        diagnostics: [{
          id: this.id,
          enabled: true,
          available: true,
          resultCount: webResults.length
        }]
      }
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
      }
    }
  }
}

function parseTavilyResults(value: unknown, source: 'tavily' | 'cns'): ResearchWebResult[] {
  const results = asRecord(value).results
  if (!Array.isArray(results)) return []
  return results.map((item, index) => {
    const record = asRecord(item)
    const title = stringValue(record.title) || stringValue(record.url)
    const url = stringValue(record.url)
    if (!title || !url) return null
    return {
      title,
      url,
      snippet: stringValue(record.content),
      source,
      rank: index + 1
    }
  }).filter((item): item is ResearchWebResult => item !== null)
}

async function fetchJson(
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
  body: Record<string, unknown>
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json() as Promise<unknown>
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
