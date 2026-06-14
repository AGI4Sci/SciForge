import { describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { buildResearchToolProviders } from '../src/adapters/research/research-tool-provider.js'
import { planResearchQueries } from '../src/adapters/research/query-planner.js'
import { KunCapabilitiesConfig } from '../src/contracts/capabilities.js'
import type {
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest
} from '../src/ports/research-provider.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

function buildContext(): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace: '/tmp/project',
    threadMode: 'agent',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

class FakeResearchProvider implements ResearchSearchProvider {
  constructor(
    readonly id: string,
    private readonly handler: (request: ResearchSearchRequest) => Promise<ResearchSearchProviderResult>
  ) {}

  async search(request: ResearchSearchRequest) {
    return this.handler(request)
  }
}

describe('research search', () => {
  it('plans intent, domain, and expanded queries for AI4S topics', () => {
    const plan = planResearchQueries({
      query: 'latest diffusion models for molecular generation',
      maxQueries: 6
    })

    expect(plan.interpretedIntent).toMatchObject({
      intent: 'latest',
      domain: 'chemistry'
    })
    expect(plan.generatedQueries[0]).toBe('latest diffusion models for molecular generation')
    expect(plan.generatedQueries.some((query) => query.includes('molecular generation'))).toBe(true)
  })

  it('does not advertise research tools when disabled', () => {
    const config = KunCapabilitiesConfig.parse({})
    const built = buildResearchToolProviders(config.research)

    expect(built.providers).toEqual([])
    expect(built.arxivAvailable).toBe(false)
  })

  it('executes research_search, merges duplicate papers, and returns structured output', async () => {
    const config = KunCapabilitiesConfig.parse({
      research: {
        enabled: true,
        arxivEnabled: true,
        biorxivEnabled: true,
        semanticScholarEnabled: true,
        tavilyEnabled: true,
        cnsEnabled: true,
        tavilyApiKey: 'test-key',
        maxResults: 5
      }
    })
    const arxiv = new FakeResearchProvider('arxiv', async () => ({
      papers: [{
        title: 'Diffusion Models for Molecular Generation',
        authors: ['Alice'],
        year: 2025,
        abstract: 'A diffusion approach for molecule design.',
        arxivId: '2501.00001',
        url: 'https://arxiv.org/abs/2501.00001',
        source: ['arxiv']
      }],
      webResults: [],
      diagnostics: [{ id: 'arxiv', enabled: true, available: true, resultCount: 1 }]
    }))
    const semanticScholar = new FakeResearchProvider('semantic_scholar', async () => ({
      papers: [{
        title: 'Diffusion Models for Molecular Generation',
        authors: ['Alice', 'Bob'],
        year: 2025,
        venue: 'ICLR',
        tldr: 'Diffusion for molecular generation.',
        arxivId: '2501.00001',
        semanticScholarId: 's2-1',
        citationCount: 42,
        source: ['semantic_scholar']
      }],
      webResults: [],
      diagnostics: [{ id: 'semantic_scholar', enabled: true, available: true, resultCount: 1 }]
    }))
    const biorxiv = new FakeResearchProvider('biorxiv', async () => ({
      papers: [{
        title: 'bioRxiv Molecule Design Preprint',
        authors: ['Carol'],
        year: 2026,
        venue: 'bioRxiv',
        doi: '10.1101/2026.01.01.000001',
        url: 'https://www.biorxiv.org/content/10.1101/2026.01.01.000001v1',
        source: ['biorxiv']
      }],
      webResults: [],
      diagnostics: [{ id: 'biorxiv', enabled: true, available: true, resultCount: 1 }]
    }))
    const tavily = new FakeResearchProvider('tavily', async () => ({
      papers: [],
      webResults: [{
        title: 'Project page',
        url: 'https://example.test/project',
        snippet: 'Code and benchmark for molecule generation.',
        source: 'tavily',
        rank: 1
      }],
      diagnostics: [{ id: 'tavily', enabled: true, available: true, resultCount: 1 }]
    }))
    const cns = new FakeResearchProvider('cns', async () => ({
      papers: [],
      webResults: [
        {
          title: 'Nature molecule generation article',
          url: 'https://www.nature.com/articles/example',
          snippet: 'Official Nature result.',
          source: 'cns',
          rank: 1
        },
        {
          title: 'Nature molecule generation article duplicate',
          url: 'https://www.nature.com/articles/example?utm_source=test',
          snippet: 'Duplicate official Nature result.',
          source: 'cns',
          rank: 2
        }
      ],
      diagnostics: [{ id: 'cns', enabled: true, available: true, resultCount: 1 }]
    }))
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildResearchToolProviders(config.research, {
        providers: {
          arxiv,
          biorxiv,
          semantic_scholar: semanticScholar,
          tavily,
          cns
        }
      }).providers)
    })

    const tools = await host.listTools(buildContext())
    expect(tools.map((tool) => tool.name)).toEqual(['research_search'])

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'research_search',
      arguments: {
        query: 'latest diffusion models for molecular generation',
        sources: ['arxiv', 'biorxiv', 'semantic_scholar', 'web', 'cns']
      }
    }, buildContext())

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      const output = result.item.output as {
        papers: Array<{
          title: string
          source: string[]
          venue?: string
          citationCount?: number
        }>
        webResults: Array<{ url: string }>
        diagnostics: Array<{ id: string; resultCount: number }>
        citations: Array<{ url: string }>
        generatedQueries: string[]
      }
      expect(output.generatedQueries.length).toBeLessThanOrEqual(3)
      expect(output.papers).toHaveLength(2)
      expect(output.papers[0]).toMatchObject({
        title: 'Diffusion Models for Molecular Generation',
        source: ['arxiv', 'semantic_scholar'],
        venue: 'ICLR',
        citationCount: 42
      })
      expect(output.webResults[0]?.url).toBe('https://example.test/project')
      expect(output.webResults.some((item) => item.url === 'https://www.nature.com/articles/example')).toBe(true)
      expect(output.webResults.filter((item) => item.url.includes('nature.com/articles/example'))).toHaveLength(1)
      expect(output.diagnostics.find((item) => item.id === 'biorxiv')?.resultCount).toBeGreaterThan(0)
      expect(output.citations.some((item) => item.url === 'https://arxiv.org/abs/2501.00001')).toBe(true)
    }
  })

  it('reports Tavily as unavailable when enabled without an API key', () => {
    const config = KunCapabilitiesConfig.parse({
      research: {
        enabled: true,
        arxivEnabled: false,
        semanticScholarEnabled: false,
        tavilyEnabled: true
      }
    })
    const built = buildResearchToolProviders(config.research)

    expect(built.tavilyAvailable).toBe(false)
    expect(built.diagnostics.find((item) => item.id === 'tavily')).toMatchObject({
      enabled: true,
      available: false,
      reason: 'Tavily API key is required'
    })
  })
})
