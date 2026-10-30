import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const runE2e = process.env.SCIFORGE_RESEARCH_E2E === '1';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clients: Client[] = [];

describe('research search MCP e2e', { skip: runE2e ? false : 'set SCIFORGE_RESEARCH_E2E=1 to run networked MCP search' }, () => {
  after(async () => {
    await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
  });

  it('serves research_search over stdio and returns real bioRxiv results', async () => {
    const client = new Client({ name: 'research-search-e2e', version: '0.1.0' });
    clients.push(client);
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/cli.ts', '--quiet'],
      cwd: packageRoot,
      env: {
        SCIFORGE_RESEARCH_ARXIV_ENABLED: 'false',
        SCIFORGE_RESEARCH_BIORXIV_ENABLED: 'true',
        SCIFORGE_RESEARCH_SEMANTIC_SCHOLAR_ENABLED: 'false',
        SCIFORGE_RESEARCH_TAVILY_ENABLED: 'false',
        SCIFORGE_RESEARCH_CNS_ENABLED: 'false',
        SCIFORGE_RESEARCH_MAX_RESULTS: '2',
        SCIFORGE_RESEARCH_TIMEOUT_MS: '30000'
      },
      stderr: 'pipe'
    }), { timeout: 20_000 });

    const listed = await client.listTools(undefined, { timeout: 20_000 });
    assert.ok(listed.tools.some((tool) => tool.name === 'research_search'));

    const result = await client.callTool({
      name: 'research_search',
      arguments: {
        query: 'protein',
        intent: 'latest',
        domain: 'biology',
        sinceYear: 2025,
        maxResults: 1,
        sources: ['biorxiv']
      }
    }, undefined, { timeout: 60_000 });

    const structured = asRecord(result.structuredContent);
    const papers = Array.isArray(structured.papers) ? structured.papers : [];
    assert.ok(papers.length > 0, `expected bioRxiv papers, got ${JSON.stringify(result).slice(0, 1000)}`);
    assert.ok(papers.some((paper) => typeof asRecord(paper).url === 'string'));
  });
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
