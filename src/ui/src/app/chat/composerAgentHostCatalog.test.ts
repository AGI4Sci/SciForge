import assert from 'node:assert/strict';
import test from 'node:test';

import type { SciForgeSession } from '../../domain';
import { composerAgentHostCatalogForSession } from './composerAgentHostCatalog';
import { buildComposerCapabilityMenu } from './composerToolMenu';

test('composer catalog extracts module.query/read capability results without leaking internals', () => {
  const session = {
    runs: [{
      id: 'run-catalog',
      raw: {
        capabilityDiscoveryToolResults: [{
          toolName: 'module.query',
          result: {
            candidates: [
              { title: 'Literature graph builder', kind: 'pipeline', capabilityId: 'literature.graph' },
              { label: 'Private Provider Raw Schema', capabilityId: 'https://private.example/token/raw schema' },
            ],
          },
        }],
        moduleReadResults: [{
          toolName: 'module.read',
          result: {
            skills: [{ name: 'Citation verifier', kind: 'tool', description: 'Validate claim evidence' }],
            mcpServers: [{ name: 'Playwright MCP', source: 'mcp', endpoint: 'http://127.0.0.1:8931/mcp?token=secret' }],
            connectors: [{ name: 'Notebook Connector', toolType: 'connector' }],
          },
        }],
      },
    }],
  } as SciForgeSession;

  const catalog = composerAgentHostCatalogForSession(session);
  const menu = buildComposerCapabilityMenu({ agentHostCatalog: catalog });
  const publicText = JSON.stringify(menu);

  assert.ok(menu.skills.some((item) => item.label === 'Literature graph builder' && item.kind === 'pipeline-skill'));
  assert.ok(menu.skills.some((item) => item.label === 'Citation verifier' && item.kind === 'tool-skill'));
  assert.ok(menu.mcpServers.some((item) => item.label === 'Playwright MCP' && item.kind === 'mcp-server'));
  assert.ok(menu.mcpServers.some((item) => item.label === 'Notebook Connector' && item.kind === 'connector'));
  assert.equal(menu.skills.find((item) => item.label === 'Citation verifier')?.commandPrefix, '/skills Citation verifier ');
  assert.equal(menu.mcpServers.find((item) => item.label === 'Playwright MCP')?.commandPrefix, '/mcp Playwright MCP ');
  for (const term of ['https://private.example', '127.0.0.1', 'token', 'secret', 'Raw Schema']) {
    assert.doesNotMatch(publicText, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});
