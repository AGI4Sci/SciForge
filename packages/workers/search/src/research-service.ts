import { ArxivResearchProvider } from './providers/arxiv.js';
import { BiorxivResearchProvider } from './providers/biorxiv.js';
import { EuropePmcResearchProvider } from './providers/europe-pmc.js';
import { FallbackWebResearchProvider } from './providers/fallback-web.js';
import { PublicWebResearchProvider } from './providers/public-web.js';
import { SemanticScholarResearchProvider } from './providers/semantic-scholar.js';
import { TavilyResearchProvider } from './providers/tavily.js';
import {
  buildInitialGaps,
  buildSuggestedFollowups,
  buildThemeClusters,
  mergeAndRankPapers,
  mergeAndRankWebResults
} from './ranking.js';
import { planResearchQueries } from './query-planner.js';
import type {
  ResearchPaper,
  ResearchProviderDiagnostic,
  ResearchProviderId,
  ResearchSearchConfig,
  ResearchSearchInput,
  ResearchSearchOutput,
  ResearchSearchProvider,
  ResearchSourceKind,
  ResearchWebResult
} from './types.js';

const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_QUERY_COUNT = 3;
const DEFAULT_CNS_DOMAINS = ['nature.com', 'science.org', 'cell.com'];

type ProviderEntry = {
  source: ResearchSourceKind;
  provider: ResearchSearchProvider;
};

export type ResearchSearchServiceOptions = {
  providers?: Partial<Record<ResearchProviderId, ResearchSearchProvider>>;
  now?: () => Date;
};

export class ResearchSearchService {
  private readonly providers: ProviderEntry[];
  private readonly now: () => Date;

  constructor(
    readonly config: ResearchSearchConfig,
    options: ResearchSearchServiceOptions = {}
  ) {
    this.providers = buildProviderEntries(config, options.providers ?? {});
    this.now = options.now ?? (() => new Date());
  }

  configuredDiagnostics(): ResearchProviderDiagnostic[] {
    return configuredDiagnostics(this.config);
  }

  async search(input: ResearchSearchInput): Promise<ResearchSearchOutput> {
    const query = input.query.trim();
    if (!query) throw new Error('query is required');
    const now = this.now();
    const maxResults = boundedInt(input.maxResults, this.config.maxResults, 1, this.config.maxResults);
    const plan = planResearchQueries({
      query,
      intent: input.intent,
      domain: input.domain,
      maxQueries: MAX_QUERY_COUNT,
      now: () => now
    });
    const sinceYear = boundedYear(
      input.sinceYear,
      this.config.defaultSinceYear ?? (plan.interpretedIntent.intent === 'latest' ? now.getUTCFullYear() - 1 : undefined)
    );
    const sources = normalizeSources(input.sources);
    const activeProviders = this.providers.filter((item) => sources
      ? sources.includes(item.source)
      : plan.interpretedIntent.domain === 'general'
        ? item.source === 'web'
        : true);
    if (activeProviders.length === 0) {
      throw new Error(`no requested research sources are enabled: ${(sources ?? allSources()).join(', ')}`);
    }

    const diagnostics: ResearchProviderDiagnostic[] = [];
    const papers: ResearchPaper[] = [];
    const webResults: ResearchWebResult[] = [];
    const perQueryLimit = Math.max(1, Math.ceil(maxResults / Math.max(1, Math.min(3, plan.generatedQueries.length))));
    const signal = input.signal ?? new AbortController().signal;
    for (const generatedQuery of plan.generatedQueries) {
      const results = await Promise.all(activeProviders.map(({ provider, source }) =>
        provider.search({
          query: generatedQuery,
          intent: plan.interpretedIntent.intent,
          domain: plan.interpretedIntent.domain,
          ...(sinceYear ? { sinceYear } : {}),
          maxResults: source === 'web'
            ? Math.min(30, Math.max(10, maxResults * 2))
            : perQueryLimit,
          timeoutMs: this.config.timeoutMs || DEFAULT_TIMEOUT_MS,
          signal
        })
      ));
      for (const result of results) {
        papers.push(...result.papers);
        webResults.push(...result.webResults);
        diagnostics.push(...(result.diagnostics ?? []));
      }
    }

    const rankedPapers = mergeAndRankPapers({
      papers,
      query,
      intent: plan.interpretedIntent.intent,
      maxResults
    });
    const rankedWebResults = mergeAndRankWebResults({
      webResults,
      query,
      intent: plan.interpretedIntent.intent,
      currentYear: now.getUTCFullYear(),
      maxResults
    });

    return {
      answerGuidance: [
        'Use this tool result as internal evidence.',
        'Answer in the user language.',
        'Summarize the main findings, cite titles/URLs where useful, and mention provider issues or gaps.',
        'When this search resolves a visual_generate context question, merge the evidence into the retained context state and call visual_generate again.',
        'A follow-up research_search is appropriate while budget remains and it targets a specific unresolved question with expected information gain.',
        'Do not repeat an unchanged query or discard evidence and resolved questions from earlier rounds.',
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
      diagnostics: summarizeDiagnostics([...this.configuredDiagnostics(), ...diagnostics]),
      citations: citationsFor(rankedPapers, rankedWebResults)
    };
  }
}

export function createResearchSearchService(
  config: ResearchSearchConfig = researchSearchConfigFromEnv(),
  options: ResearchSearchServiceOptions = {}
): ResearchSearchService {
  return new ResearchSearchService(config, options);
}

export function researchSearchConfigFromEnv(env: Record<string, string | undefined> = process.env): ResearchSearchConfig {
  const tavilyApiKey = stringEnv(env, 'SCIFORGE_RESEARCH_TAVILY_API_KEY') || stringEnv(env, 'TAVILY_API_KEY');
  const semanticScholarApiKey = stringEnv(env, 'SCIFORGE_RESEARCH_SEMANTIC_SCHOLAR_API_KEY');
  return {
    arxivEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_ARXIV_ENABLED', true),
    biorxivEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_BIORXIV_ENABLED', true),
    europePmcEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_EUROPE_PMC_ENABLED', true),
    semanticScholarEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_SEMANTIC_SCHOLAR_ENABLED', true),
    semanticScholarApiKey,
    tavilyEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_TAVILY_ENABLED', Boolean(tavilyApiKey)),
    tavilyApiKey,
    publicWebEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_PUBLIC_WEB_ENABLED', true),
    cnsEnabled: booleanEnv(env, 'SCIFORGE_RESEARCH_CNS_ENABLED', Boolean(tavilyApiKey)),
    cnsDomains: listEnv(env, 'SCIFORGE_RESEARCH_CNS_DOMAINS', DEFAULT_CNS_DOMAINS),
    defaultSinceYear: numberEnv(env, 'SCIFORGE_RESEARCH_DEFAULT_SINCE_YEAR'),
    maxResults: boundedInt(numberEnv(env, 'SCIFORGE_RESEARCH_MAX_RESULTS'), DEFAULT_MAX_RESULTS, 1, 50),
    timeoutMs: boundedInt(numberEnv(env, 'SCIFORGE_RESEARCH_TIMEOUT_MS'), DEFAULT_TIMEOUT_MS, 1_000, 120_000)
  };
}

function buildProviderEntries(
  config: ResearchSearchConfig,
  providers: Partial<Record<ResearchProviderId, ResearchSearchProvider>>
): ProviderEntry[] {
  const entries: ProviderEntry[] = [];
  if (config.arxivEnabled) entries.push({ source: 'arxiv', provider: providers.arxiv ?? new ArxivResearchProvider() });
  if (config.biorxivEnabled) entries.push({ source: 'biorxiv', provider: providers.biorxiv ?? new BiorxivResearchProvider() });
  if (config.europePmcEnabled) {
    entries.push({
      source: 'europe_pmc',
      provider: providers.europe_pmc ?? new EuropePmcResearchProvider()
    });
  }
  if (config.semanticScholarEnabled) {
    entries.push({
      source: 'semantic_scholar',
      provider: providers.semantic_scholar ?? new SemanticScholarResearchProvider(config.semanticScholarApiKey)
    });
  }
  const publicWebEnabled = config.publicWebEnabled !== false;
  const publicWebProvider = providers.public_web ?? new PublicWebResearchProvider();
  if (config.tavilyEnabled) {
    const primary = providers.tavily ?? new TavilyResearchProvider(config.tavilyApiKey);
    entries.push({
      source: 'web',
      provider: publicWebEnabled
        ? new FallbackWebResearchProvider(primary, publicWebProvider)
        : primary
    });
  } else if (publicWebEnabled) {
    entries.push({ source: 'web', provider: publicWebProvider });
  }
  if (config.cnsEnabled) {
    entries.push({
      source: 'cns',
      provider: providers.cns ?? new TavilyResearchProvider(config.tavilyApiKey, {
        id: 'cns',
        includeDomains: config.cnsDomains,
        resultSource: 'cns'
      })
    });
  }
  return entries;
}

function configuredDiagnostics(config: ResearchSearchConfig): ResearchProviderDiagnostic[] {
  return [
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
      id: 'europe_pmc',
      enabled: config.europePmcEnabled,
      available: config.europePmcEnabled
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
      role: 'primary',
      ...(config.tavilyEnabled && !config.tavilyApiKey.trim() ? { reason: 'Tavily API key is required' } : {})
    },
    {
      id: 'public_web',
      enabled: config.publicWebEnabled !== false,
      available: config.publicWebEnabled !== false,
      role: 'fallback',
      ...(config.publicWebEnabled === false ? { reason: 'Keyless public web fallback is disabled' } : {})
    },
    {
      id: 'cns',
      enabled: config.cnsEnabled,
      available: config.cnsEnabled && Boolean(config.tavilyApiKey.trim()),
      ...(config.cnsEnabled && !config.tavilyApiKey.trim()
        ? { reason: 'Tavily API key is required for CNS official-site search' }
        : {})
    }
  ];
}

function normalizeSources(value: unknown): ResearchSourceKind[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out = value.filter((item): item is ResearchSourceKind =>
    item === 'arxiv' ||
    item === 'biorxiv' ||
    item === 'europe_pmc' ||
    item === 'semantic_scholar' ||
    item === 'web' ||
    item === 'cns'
  );
  return out.length ? [...new Set(out)] : null;
}

function summarizeDiagnostics(diagnostics: ResearchProviderDiagnostic[]): ResearchProviderDiagnostic[] {
  const byId = new Map<ResearchProviderId, ResearchProviderDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    byId.set(diagnostic.id, [...(byId.get(diagnostic.id) ?? []), diagnostic]);
  }
  return [...byId.entries()].map(([id, items]) => {
    const runtimeItems = items.filter((item) => item.resultCount != null || item.reason != null);
    const observedItems = runtimeItems.length > 0 ? runtimeItems : items;
    const reason = observedItems.find((item) => item.reason)?.reason;
    const role = items.find((item) => item.role)?.role;
    return {
      id,
      enabled: items.some((item) => item.enabled),
      available: observedItems.some((item) => item.available),
      resultCount: runtimeItems.reduce((sum, item) => sum + (item.resultCount ?? 0), 0),
      ...(role ? { role } : {}),
      ...(reason ? { reason } : {})
    };
  });
}

function citationsFor(
  papers: ResearchPaper[],
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
  ].filter((item) => item.url);
}

function allSources(): ResearchSourceKind[] {
  return ['arxiv', 'biorxiv', 'europe_pmc', 'semantic_scholar', 'web', 'cns'];
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function boundedYear(value: unknown, fallback: number | undefined): number | undefined {
  const year = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  if (!year) return undefined;
  return Math.min(3000, Math.max(1991, year));
}

function stringEnv(env: Record<string, string | undefined>, name: string): string {
  return env[name]?.trim() ?? '';
}

function booleanEnv(env: Record<string, string | undefined>, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(value)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(value)) return false;
  return fallback;
}

function numberEnv(env: Record<string, string | undefined>, name: string): number | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function listEnv(env: Record<string, string | undefined>, name: string, fallback: string[]): string[] {
  const value = env[name]?.trim();
  if (!value) return fallback;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}
