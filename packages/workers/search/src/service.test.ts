import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  RESEARCH_SEARCH_WORKER_CAPABILITIES,
  RESEARCH_SEARCH_WORKER_VERSION
} from './contract.js';
import {
  createResearchSearchService,
  createResearchSearchWorkerService,
  researchSearchWorkerDiagnosticsFromProviders
} from './service.js';
import * as publicSurface from './index.js';

test('research search worker diagnostics expose standard shape', () => {
  const diagnostics = researchSearchWorkerDiagnosticsFromProviders([
    { id: 'arxiv', enabled: true, available: true },
    { id: 'biorxiv', enabled: false, available: false },
    { id: 'tavily', enabled: true, available: false, reason: 'Tavily API key is required' }
  ]);

  assert.equal(diagnostics.version, RESEARCH_SEARCH_WORKER_VERSION);
  assert.equal(diagnostics.transport, 'stdio');
  assert.equal(diagnostics.health.status, 'degraded');
  assert.equal(diagnostics.health.available, true);
  assert.equal(diagnostics.health.enabledProviders, 2);
  assert.equal(diagnostics.health.availableProviders, 1);
  assert.equal(diagnostics.recentError, null);
  assert.deepEqual(diagnostics.capabilities, [...RESEARCH_SEARCH_WORKER_CAPABILITIES]);
  assert.equal(diagnostics.providers.length, 3);
});

test('research search worker diagnostics record recent service errors', async () => {
  const worker = createResearchSearchWorkerService({
    arxivEnabled: true,
    biorxivEnabled: false,
    semanticScholarEnabled: false,
    semanticScholarApiKey: '',
    tavilyEnabled: false,
    tavilyApiKey: '',
    cnsEnabled: false,
    cnsDomains: [],
    maxResults: 5,
    timeoutMs: 1000
  });

  await assert.rejects(
    () => worker.search({ query: '   ' }),
    /query is required/
  );

  const diagnostics = worker.diagnostics();
  assert.equal(diagnostics.health.status, 'degraded');
  assert.equal(diagnostics.recentError, 'query is required');
  assert.equal(diagnostics.providers.some((provider) => provider.id === 'arxiv' && provider.available), true);
});

test('service facade preserves research service exports', () => {
  assert.equal(typeof createResearchSearchService, 'function');
});

test('root public surface excludes internal helper exports', () => {
  const rootExportNames = Object.keys(publicSurface);

  assert.equal(rootExportNames.includes('planResearchQueries'), false);
  assert.equal(rootExportNames.includes('buildArxivQuery'), false);
  assert.equal(rootExportNames.includes('buildEuropePmcQuery'), false);
  assert.equal(rootExportNames.includes('parseEuropePmcPapers'), false);
});

test('package metadata declares search worker exports and MCP capability', async () => {
  const metadata = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  ) as {
    exports: Record<string, string>;
    sciforge: Record<string, unknown>;
  };

  assert.equal(metadata.sciforge.lifecycleLayer, 'workers');
  assert.equal(metadata.sciforge.publicContract, true);
  assert.equal(metadata.sciforge.runtimeAdapter, false);
  assert.equal(metadata.sciforge.mcpServer, true);
  assert.equal(metadata.sciforge.sideEffects, 'network');
  assert.equal(metadata.exports['./contract'], './src/contract.ts');
  assert.equal(metadata.exports['./research-service'], './src/research-service.ts');
  assert.equal(metadata.exports['./service'], './src/service.ts');
});
