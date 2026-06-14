import type { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import type {
  ResearchPaper,
  ResearchProviderDiagnostic,
  ResearchSearchProvider,
  ResearchSourceKind,
  ResearchWebResult
} from '../../ports/research-provider.js'
import type { CapabilityToolProvider } from '../tool/capability-registry.js'
import { LocalToolHost } from '../tool/local-tool-host.js'
import { ArxivResearchProvider } from './arxiv-provider.js'
import { BiorxivResearchProvider } from './biorxiv-provider.js'
import {
  buildInitialGaps,
  buildSuggestedFollowups,
  buildThemeClusters,
  mergeAndRankPapers,
  mergeAndRankWebResults
} from './paper-ranking.js'
import { planResearchQueries } from './query-planner.js'
import { SemanticScholarResearchProvider } from './semantic-scholar-provider.js'
import { TavilyResearchProvider } from './tavily-provider.js'

const DEFAULT_MAX_RESULTS = 10
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_QUERY_COUNT = 3

export type ResearchToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: ResearchProviderDiagnostic[]
  arxivAvailable: boolean
  semanticScholarAvailable: boolean
  tavilyAvailable: boolean
  biorxivAvailable: boolean
  cnsAvailable: boolean
}

export type ResearchToolProviderOptions = {
  providers?: Partial<Record<'arxiv' | 'biorxiv' | 'semantic_scholar' | 'tavily' | 'cns', ResearchSearchProvider>>
}

export function buildResearchToolProviders(
  config: KunCapabilitiesConfig['research'] | undefined,
  options: ResearchToolProviderOptions = {}
): ResearchToolProviderBuildResult {
  if (!config?.enabled) {
    return {
      providers: [],
      diagnostics: [],
      arxivAvailable: false,
      biorxivAvailable: false,
      semanticScholarAvailable: false,
      tavilyAvailable: false,
      cnsAvailable: false
    }
  }
  const arxivProvider = options.providers?.arxiv ?? new ArxivResearchProvider()
  const biorxivProvider = options.providers?.biorxiv ?? new BiorxivResearchProvider()
  const semanticScholarProvider = options.providers?.semantic_scholar ??
    new SemanticScholarResearchProvider(config.semanticScholarApiKey)
  const tavilyProvider = options.providers?.tavily ?? new TavilyResearchProvider(config.tavilyApiKey)
  const cnsProvider = options.providers?.cns ?? new TavilyResearchProvider(config.tavilyApiKey, {
    id: 'cns',
    includeDomains: config.cnsDomains,
    resultSource: 'cns'
  })
  const enabledProviders: Array<{ source: ResearchSourceKind; provider: ResearchSearchProvider }> = []
  if (config.arxivEnabled) enabledProviders.push({ source: 'arxiv', provider: arxivProvider })
  if (config.biorxivEnabled) enabledProviders.push({ source: 'biorxiv', provider: biorxivProvider })
  if (config.semanticScholarEnabled) {
    enabledProviders.push({ source: 'semantic_scholar', provider: semanticScholarProvider })
  }
  if (config.tavilyEnabled) enabledProviders.push({ source: 'web', provider: tavilyProvider })
  if (config.cnsEnabled) enabledProviders.push({ source: 'cns', provider: cnsProvider })
  const diagnostics: ResearchProviderDiagnostic[] = [
    {
      id: 'arxiv',
      enabled: config.arxivEnabled,
      available: config.arxivEnabled
    },
    {
      id: 'biorxiv',
      enabled: config.biorxivEnabled,
      available: config.biorxivEnabled
    },
    {
      id: 'semantic_scholar',
      enabled: config.semanticScholarEnabled,
      available: config.semanticScholarEnabled
    },
    {
      id: 'tavily',
      enabled: config.tavilyEnabled,
      available: config.tavilyEnabled && Boolean(config.tavilyApiKey.trim()),
      ...(config.tavilyEnabled && !config.tavilyApiKey.trim() ? { reason: 'Tavily API key is required' } : {})
    },
    {
      id: 'cns',
      enabled: config.cnsEnabled,
      available: config.cnsEnabled && Boolean(config.tavilyApiKey.trim()),
      ...(config.cnsEnabled && !config.tavilyApiKey.trim() ? { reason: 'Tavily API key is required for CNS official-site search' } : {})
    }
  ]
  return {
    providers: enabledProviders.length
      ? [{
          id: 'research',
          kind: 'web',
          enabled: true,
          available: true,
          tools: [createResearchSearchTool({
            providers: enabledProviders,
            defaultSinceYear: config.defaultSinceYear,
            maxResults: config.maxResults,
            timeoutMs: config.timeoutMs
          })]
        }]
      : [],
    diagnostics,
    arxivAvailable: config.arxivEnabled,
    biorxivAvailable: config.biorxivEnabled,
    semanticScholarAvailable: config.semanticScholarEnabled,
    tavilyAvailable: config.tavilyEnabled && Boolean(config.tavilyApiKey.trim()),
    cnsAvailable: config.cnsEnabled && Boolean(config.tavilyApiKey.trim())
  }
}

function createResearchSearchTool(options: {
  providers: Array<{ source: ResearchSourceKind; provider: ResearchSearchProvider }>
  defaultSinceYear?: number
  maxResults: number
  timeoutMs: number
}) {
  return LocalToolHost.defineTool({
    name: 'research_search',
    description: [
      'Explore an AI4S or scientific research direction using arXiv, bioRxiv, Semantic Scholar, CNS official sites, and configured web search.',
      'Use it for latest progress, baselines, SOTA, datasets, code, or research gap discovery.',
      'One call already expands the query and searches multiple enabled sources; normally call this tool once per user request, then synthesize the result.',
      'Only call it again if the first result explicitly shows a missing source, provider failure, or the user asks for a second targeted search.',
      'The returned structured data is internal evidence for the assistant; synthesize it into a concise natural-language answer instead of showing raw JSON unless the user explicitly asks for raw data.'
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        intent: {
          type: 'string',
          enum: ['overview', 'latest', 'baseline', 'sota', 'dataset', 'code', 'gap']
        },
        domain: {
          type: 'string',
          enum: ['ai4s', 'biology', 'chemistry', 'materials', 'physics', 'climate', 'general']
        },
        sinceYear: { type: 'number' },
        maxResults: { type: 'number' },
        sources: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['arxiv', 'biorxiv', 'semantic_scholar', 'web', 'cns']
          }
        }
      },
      required: ['query'],
      additionalProperties: false
    },
    policy: 'untrusted',
    execute: async (args, context) => {
      const query = stringArg(args.query)
      if (!query) return { output: { error: 'query is required' }, isError: true }
      const maxResults = boundedInt(args.maxResults, options.maxResults || DEFAULT_MAX_RESULTS, 1, options.maxResults || DEFAULT_MAX_RESULTS)
      const sinceYear = boundedYear(args.sinceYear, options.defaultSinceYear)
      const plan = planResearchQueries({
        query,
        intent: stringArg(args.intent),
        domain: stringArg(args.domain),
        maxQueries: MAX_QUERY_COUNT
      })
      const sources = normalizeSources(args.sources)
      const activeProviders = options.providers.filter((item) =>
        !sources || sources.includes(item.source)
      )
      if (activeProviders.length === 0) {
        return {
          output: {
            error: 'no requested research sources are enabled',
            requestedSources: sources ?? ['arxiv', 'biorxiv', 'semantic_scholar', 'web', 'cns']
          },
          isError: true
        }
      }
      const diagnostics: ResearchProviderDiagnostic[] = []
      const papers: ResearchPaper[] = []
      const webResults: ResearchWebResult[] = []
      const perQueryLimit = Math.max(1, Math.ceil(maxResults / Math.max(1, Math.min(3, plan.generatedQueries.length))))
      for (const generatedQuery of plan.generatedQueries) {
        const results = await Promise.all(activeProviders.map(({ provider }) =>
          provider.search({
            query: generatedQuery,
            intent: plan.interpretedIntent.intent,
            domain: plan.interpretedIntent.domain,
            ...(sinceYear ? { sinceYear } : {}),
            maxResults: perQueryLimit,
            timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
            signal: context.abortSignal
          })
        ))
        for (const result of results) {
          papers.push(...result.papers)
          webResults.push(...result.webResults)
          diagnostics.push(...(result.diagnostics ?? []))
        }
      }
      const rankedPapers = mergeAndRankPapers({
        papers,
        query,
        intent: plan.interpretedIntent.intent,
        maxResults
      })
      const rankedWebResults = mergeAndRankWebResults({
        webResults,
        maxResults
      })
      return {
        output: {
          answerGuidance: [
            'Use this tool result as internal evidence.',
            'Answer in the user language.',
            'Summarize the main findings, cite titles/URLs where useful, and mention provider issues or gaps.',
            'Do not call research_search again unless a required source failed or the user explicitly asks for a follow-up search.',
            'Do not paste raw structured JSON unless the user explicitly requested raw output.'
          ].join(' '),
          interpretedIntent: plan.interpretedIntent,
          generatedQueries: plan.generatedQueries,
          papers: rankedPapers,
          webResults: rankedWebResults,
          themes: buildThemeClusters(rankedPapers),
          gaps: buildInitialGaps({ papers: rankedPapers, webResults: rankedWebResults }),
          suggestedFollowups: buildSuggestedFollowups({
            query,
            intent: plan.interpretedIntent.intent,
            papers: rankedPapers
          }),
          diagnostics: summarizeDiagnostics(diagnostics),
          citations: citationsFor(rankedPapers, rankedWebResults)
        }
      }
    }
  })
}

function normalizeSources(value: unknown): ResearchSourceKind[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const out = value.filter((item): item is ResearchSourceKind =>
    item === 'arxiv' || item === 'biorxiv' || item === 'semantic_scholar' || item === 'web' || item === 'cns'
  )
  return out.length ? [...new Set(out)] : null
}

function summarizeDiagnostics(diagnostics: ResearchProviderDiagnostic[]): ResearchProviderDiagnostic[] {
  const byId = new Map<string, ResearchProviderDiagnostic>()
  for (const diagnostic of diagnostics) {
    const current = byId.get(diagnostic.id)
    byId.set(diagnostic.id, {
      id: diagnostic.id,
      enabled: current?.enabled ?? diagnostic.enabled,
      available: (current?.available ?? false) || diagnostic.available,
      resultCount: (current?.resultCount ?? 0) + (diagnostic.resultCount ?? 0),
      ...(diagnostic.reason && !(current?.available) ? { reason: diagnostic.reason } : {})
    })
  }
  return [...byId.values()]
}

function citationsFor(
  papers: ReturnType<typeof mergeAndRankPapers>,
  webResults: Array<{ title: string; url: string; source: string }>
) {
  return [
    ...papers.map((paper) => ({
      title: paper.title,
      url: paper.url ?? paper.pdfUrl ?? '',
      source: paper.source.join(',')
    })),
    ...webResults.map((result) => ({
      title: result.title,
      url: result.url,
      source: result.source
    }))
  ].filter((item) => item.url)
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function boundedYear(value: unknown, fallback: number | undefined): number | undefined {
  const year = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  if (!year) return undefined
  return Math.min(3000, Math.max(1991, year))
}
