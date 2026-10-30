import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  createResearchSearchWorkerService,
  researchSearchWorkerDiagnosticsFromProviders
} from './service.js';
import type { ResearchSearchService } from './research-service.js';
import type { ResearchSearchWorkerDiagnostics } from './contract.js';
import type { ResearchDomain, ResearchIntent, ResearchSourceKind } from './types.js';

type ResearchSearchMcpService = Pick<ResearchSearchService, 'config' | 'configuredDiagnostics' | 'search'> & {
  diagnostics?: () => ResearchSearchWorkerDiagnostics;
};

export const RESEARCH_SEARCH_TOOL_DESCRIPTION = [
  'Search external context and research evidence using arXiv, bioRxiv, Europe PMC/PubMed, Semantic Scholar, CNS official sites, and configured web search.',
  'Use it for latest information, standards, style references, comparisons, baselines, SOTA, datasets, code, research gaps, or another specific external-context question.',
  'Each call expands one targeted question and searches multiple enabled sources.',
  'When visual_generate reports needs_context, search its explicit unresolved questions, merge the evidence into the retained context state, and return to visual_generate.',
  'Follow-up searches are appropriate while budget remains and each round targets an unresolved question with expected information gain; do not repeat an unchanged query.',
  'The returned structured data is internal evidence for the assistant; synthesize it instead of showing raw JSON unless requested.'
].join(' ');

export function createResearchSearchMcpServer(
  service: ResearchSearchMcpService = createResearchSearchWorkerService()
): McpServer {
  const server = new McpServer(
    { name: 'sciforge-research-search', version: '0.1.0' },
    { capabilities: { logging: {} } }
  );

  server.registerTool('research_search', {
    description: RESEARCH_SEARCH_TOOL_DESCRIPTION,
    inputSchema: {
      query: z.string().min(1),
      intent: z.enum(['overview', 'latest', 'baseline', 'sota', 'dataset', 'code', 'gap']).optional(),
      domain: z.enum(['ai4s', 'biology', 'chemistry', 'materials', 'physics', 'climate', 'general']).optional(),
      sinceYear: z.number().int().min(1991).max(3000).optional(),
      maxResults: z.number().int().min(1).max(service.config.maxResults).optional(),
      sources: z.array(z.enum(['arxiv', 'biorxiv', 'europe_pmc', 'semantic_scholar', 'web', 'cns'])).optional()
    }
  }, async (args, extra) => {
    try {
      const result = await service.search({
        query: args.query,
        intent: args.intent as ResearchIntent | undefined,
        domain: args.domain as ResearchDomain | undefined,
        sinceYear: args.sinceYear,
        maxResults: args.maxResults,
        sources: args.sources as ResearchSourceKind[] | undefined,
        signal: extra.signal
      });
      return {
        content: [{
          type: 'text',
          text: renderResearchSummary(result)
        }],
        structuredContent: result
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `research_search failed: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });

  server.registerTool('research_search_diagnostics', {
    description: 'Report SciForge research search worker diagnostics, enabled providers, transport, version, recent error, and capabilities.',
    inputSchema: {}
  }, async () => {
    const diagnostics = service.diagnostics?.()
      ?? researchSearchWorkerDiagnosticsFromProviders(service.configuredDiagnostics());
    return {
      content: [{
        type: 'text',
        text: renderWorkerDiagnostics(diagnostics)
      }],
      structuredContent: diagnostics
    };
  });

  return server;
}

export async function startResearchSearchMcpServer(
  service: ResearchSearchMcpService = createResearchSearchWorkerService()
): Promise<void> {
  const server = createResearchSearchMcpServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function renderResearchSummary(result: Awaited<ReturnType<ResearchSearchService['search']>>): string {
  const paperCount = result.papers.length;
  const webCount = result.webResults.length;
  const providers = result.diagnostics
    .filter((diagnostic) => diagnostic.enabled)
    .map((diagnostic) => `${diagnostic.id}:${diagnostic.available ? 'ok' : 'unavailable'}`)
    .join(', ');
  return [
    `Found ${paperCount} paper result(s) and ${webCount} web result(s).`,
    `Intent: ${result.interpretedIntent.intent}; domain: ${result.interpretedIntent.domain}.`,
    providers ? `Providers: ${providers}.` : ''
  ].filter(Boolean).join(' ');
}

function renderWorkerDiagnostics(diagnostics: ResearchSearchWorkerDiagnostics): string {
  const enabled = diagnostics.providers
    .filter((provider) => provider.enabled)
    .map((provider) => `${provider.id}:${provider.available ? 'ok' : 'unavailable'}`)
    .join(', ');
  return [
    `Research search worker ${diagnostics.version} is ${diagnostics.health.status} over ${diagnostics.transport}.`,
    enabled ? `Providers: ${enabled}.` : 'Providers: none enabled.',
    diagnostics.recentError ? `Recent error: ${diagnostics.recentError}.` : ''
  ].filter(Boolean).join(' ');
}
