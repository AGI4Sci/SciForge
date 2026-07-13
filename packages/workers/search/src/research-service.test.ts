import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createResearchSearchService,
  researchSearchConfigFromEnv
} from './research-service.js';
import { RESEARCH_SEARCH_TOOL_DESCRIPTION } from './mcp-server.js';
import { buildArxivQuery } from './providers/arxiv.js';
import {
  buildEuropePmcQuery,
  parseEuropePmcPapers
} from './providers/europe-pmc.js';
import { planResearchQueries } from './query-planner.js';
import type {
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest
} from './types.js';

class FakeProvider implements ResearchSearchProvider {
  readonly id;

  constructor(
    id: ResearchSearchProvider['id'],
    private readonly handler: (request: ResearchSearchRequest) => ResearchSearchProviderResult
  ) {
    this.id = id;
  }

  async search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult> {
    return this.handler(request);
  }
}

describe('research search service', () => {
  it('describes budgeted context-loop follow-up searches without a one-call restriction', () => {
    assert.match(RESEARCH_SEARCH_TOOL_DESCRIPTION, /visual_generate reports needs_context/);
    assert.match(RESEARCH_SEARCH_TOOL_DESCRIPTION, /while budget remains/);
    assert.doesNotMatch(RESEARCH_SEARCH_TOOL_DESCRIPTION, /once per user request|normally call it once/i);
  });

  it('plans domain and intent query expansions', () => {
    const plan = planResearchQueries({
      query: 'latest protein foundation model benchmark',
      maxQueries: 4
    });

    assert.equal(plan.interpretedIntent.intent, 'latest');
    assert.equal(plan.interpretedIntent.domain, 'biology');
    assert.ok(plan.generatedQueries.some((query) => query.includes('computational biology')));
  });

  it('uses wet-biology query expansions for meiotic entry searches', () => {
    const plan = planResearchQueries({
      query: 'STRA8 MEIOSIN meiosis initiation mammalian germ cells',
      maxQueries: 4
    });

    assert.equal(plan.interpretedIntent.domain, 'biology');
    assert.ok(plan.generatedQueries.some((query) => query.includes('PubMed Europe PMC')));
    assert.ok(plan.generatedQueries.some((query) => query.includes('meiotic entry retinoic acid')));
    assert.ok(!plan.generatedQueries.some((query) => query.includes('protein design')));
  });

  it('builds arXiv queries with date filters', () => {
    assert.match(
      buildArxivQuery('AI for protein design latest 2026', 2024),
      /submittedDate:\[202401010000 TO 299912312359\]/
    );
  });

  it('builds and parses Europe PMC paper results', () => {
    assert.match(
      buildEuropePmcQuery('STRA8 MEIOSIN meiosis initiation', 2024),
      /FIRST_PDATE:\[2024-01-01 TO \d{4}-\d{2}-\d{2}\]/
    );

    const papers = parseEuropePmcPapers({
      resultList: {
        result: [{
          id: '41287933',
          source: 'MED',
          pmid: '41287933',
          doi: '10.1242/dev.205037',
          title: 'MEIOC prevents continued mitotic cycling and promotes meiotic entry during mouse oogenesis.',
          authorString: 'Ushuhuda EG, Nguyen JT.',
          pubYear: '2026',
          journalInfo: { journal: { title: 'Development' } },
          abstractText: '<p>MEIOC promotes meiotic entry.</p>',
          citedByCount: '2'
        }]
      }
    });

    assert.equal(papers.length, 1);
    assert.equal(papers[0]?.source[0], 'europe_pmc');
    assert.equal(papers[0]?.year, 2026);
    assert.equal(papers[0]?.venue, 'Development');
    assert.equal(papers[0]?.citationCount, 2);
    assert.equal(papers[0]?.url, 'https://europepmc.org/article/MED/41287933');
  });

  it('reads provider toggles from environment', () => {
    const config = researchSearchConfigFromEnv({
      SCIFORGE_RESEARCH_ARXIV_ENABLED: 'false',
      SCIFORGE_RESEARCH_TAVILY_API_KEY: 'tvly-key',
      SCIFORGE_RESEARCH_MAX_RESULTS: '7'
    });

    assert.equal(config.arxivEnabled, false);
    assert.equal(config.europePmcEnabled, true);
    assert.equal(config.tavilyEnabled, true);
    assert.equal(config.cnsEnabled, true);
    assert.equal(config.maxResults, 7);
  });

  it('searches selected sources and merges duplicate papers', async () => {
    const service = createResearchSearchService({
      arxivEnabled: true,
      biorxivEnabled: false,
      europePmcEnabled: true,
      semanticScholarEnabled: true,
      semanticScholarApiKey: '',
      tavilyEnabled: true,
      tavilyApiKey: 'key',
      cnsEnabled: false,
      cnsDomains: [],
      maxResults: 5,
      timeoutMs: 1000
    }, {
      providers: {
        arxiv: new FakeProvider('arxiv', () => ({
          papers: [{
            title: 'Foundation Models for Molecules',
            authors: ['A. Author'],
            year: 2025,
            doi: '10.1234/example',
            abstract: 'molecular generation benchmark',
            url: 'https://arxiv.org/abs/2501.00001',
            source: ['arxiv']
          }],
          webResults: [],
          diagnostics: [{ id: 'arxiv', enabled: true, available: true, resultCount: 1 }]
        })),
        semantic_scholar: new FakeProvider('semantic_scholar', () => ({
          papers: [{
            title: 'Foundation Models for Molecules',
            authors: ['A. Author', 'B. Author'],
            year: 2025,
            doi: '10.1234/example',
            citationCount: 12,
            abstract: 'molecular generation benchmark and evaluation',
            url: 'https://example.test/paper',
            source: ['semantic_scholar']
          }],
          webResults: [],
          diagnostics: [{ id: 'semantic_scholar', enabled: true, available: true, resultCount: 1 }]
        })),
        europe_pmc: new FakeProvider('europe_pmc', () => ({
          papers: [{
            title: 'Foundation Models for Molecules',
            authors: ['A. Author', 'C. Curator'],
            year: 2025,
            doi: '10.1234/example',
            citationCount: 2,
            abstract: 'molecular generation benchmark curated in Europe PMC',
            url: 'https://europepmc.org/article/MED/123',
            source: ['europe_pmc']
          }],
          webResults: [],
          diagnostics: [{ id: 'europe_pmc', enabled: true, available: true, resultCount: 1 }]
        })),
        tavily: new FakeProvider('tavily', () => ({
          papers: [],
          webResults: [{
            title: 'Project page',
            url: 'https://example.test/project?utm=1',
            snippet: 'Open source implementation',
            source: 'tavily',
            rank: 1
          }],
          diagnostics: [{ id: 'tavily', enabled: true, available: true, resultCount: 1 }]
        }))
      }
    });

    const result = await service.search({
      query: 'molecular generation benchmark',
      sources: ['arxiv', 'europe_pmc', 'semantic_scholar', 'web'],
      maxResults: 5
    });

    assert.equal(result.papers.length, 1);
    assert.deepEqual(result.papers[0]?.source.sort(), ['arxiv', 'europe_pmc', 'semantic_scholar']);
    assert.equal(result.webResults.length, 1);
    assert.ok(result.citations.some((citation) => citation.source === 'arxiv,europe_pmc,semantic_scholar'));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.id === 'tavily' && diagnostic.available));
    assert.match(result.answerGuidance, /merge the evidence.*visual_generate again/i);
    assert.match(result.answerGuidance, /while budget remains/i);
    assert.doesNotMatch(result.answerGuidance, /Do not call research_search again/i);
  });
});
