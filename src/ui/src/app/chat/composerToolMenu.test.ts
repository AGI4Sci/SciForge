import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyComposerToolDirective,
  buildComposerCapabilityMenu,
  buildComposerToolMenu,
  composerModelSelectionIntents,
  filterComposerCapabilityMenuItems,
  publicComposerModel,
} from './composerToolMenu';

test('composer add menu uses Cursor-like taxonomy and keeps SciForge context actions inside the menu', () => {
  const items = buildComposerToolMenu();
  assert.deepEqual(items.map((item) => item.id), [
    'plan',
    'debug',
    'multitask',
    'ask',
    'image',
    'models',
    'skills',
    'mcp-servers',
    'pick-context',
    'attach-file',
  ]);
  assert.equal(items.find((item) => item.id === 'skills')?.commandPrefix, '/skills ');
  assert.equal(items.find((item) => item.id === 'mcp-servers')?.commandPrefix, '/mcp ');
});

test('composer directives prefix user text without duplicating a selected mode', () => {
  const plan = buildComposerToolMenu().find((item) => item.id === 'plan');
  assert.ok(plan);
  assert.equal(applyComposerToolDirective('summarize the paper', plan), '/plan summarize the paper');
  assert.equal(applyComposerToolDirective('/plan summarize the paper', plan), '/plan summarize the paper');
});

test('composer capability menu exposes public domain, pipeline, tool, and MCP entries', () => {
  const menu = buildComposerCapabilityMenu({
    agentHostCatalog: [
      {
        label: 'Citation verifier',
        kind: 'tool',
        source: 'module.query',
        detail: 'Checks claims against cited evidence',
      },
      {
        title: 'Notebook Connector',
        toolType: 'connector',
        source: 'mcp',
        description: 'http://127.0.0.1/private?token=secret',
      },
    ],
    toolProviderRoutes: {
      'vision-mcp-private-route': {
        source: 'mcp',
        capabilityId: 'Vision MCP',
        primaryProviderId: 'private-provider',
        endpoint: 'http://127.0.0.1:8931/mcp?token=secret',
      },
      'internal-http-route': {
        source: 'http',
        capabilityId: 'http://private/token/raw schema',
        endpoint: 'http://127.0.0.1:9000/private',
      },
    },
  });
  assert.ok(menu.skills.some((item) => item.kind === 'domain-skill' && item.label === 'Literature Research'));
  assert.ok(menu.skills.some((item) => item.kind === 'pipeline-skill'));
  assert.ok(menu.skills.some((item) => item.kind === 'tool-skill' && item.label === 'PubMed'));
  assert.ok(menu.skills.some((item) => item.kind === 'tool-skill' && item.label === 'Citation verifier'));
  assert.ok(menu.mcpServers.some((item) => item.kind === 'connector' && item.label === 'Notebook Connector'));
  assert.ok(menu.mcpServers.some((item) => item.kind === 'mcp-server' && item.label === 'Vision MCP'));
  const pubmed = menu.skills.find((item) => item.label === 'PubMed');
  assert.ok(pubmed);
  assert.equal(applyComposerToolDirective('review cytokine papers', pubmed), '/skills PubMed review cytokine papers');
  const visionMcp = menu.mcpServers.find((item) => item.label === 'Vision MCP');
  assert.ok(visionMcp);
  assert.equal(applyComposerToolDirective('', visionMcp), '/mcp Vision MCP');
  const publicText = JSON.stringify(menu);
  for (const term of ['127.0.0.1', 'token', 'secret', 'private-provider', 'raw schema', 'internal-http-route']) {
    assert.doesNotMatch(publicText, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});

test('composer capability search filters concrete public entries without leaking internals', () => {
  const menu = buildComposerCapabilityMenu({
    toolProviderRoutes: {
      'vision-mcp': {
        source: 'mcp',
        capabilityId: 'Vision MCP',
        endpoint: 'http://127.0.0.1:8931/mcp?token=secret',
      },
    },
  });
  assert.deepEqual(filterComposerCapabilityMenuItems(menu.skills, 'pub').map((item) => item.label), ['PubMed']);
  assert.deepEqual(filterComposerCapabilityMenuItems(menu.mcpServers, 'vision').map((item) => item.label), ['Vision MCP']);
});

test('public composer model hides raw model ids while preserving label and speed', () => {
  assert.deepEqual(publicComposerModel({ model: '' }), {
    label: 'Assistant',
    speed: 'Unset',
    state: 'unset',
  });
  assert.deepEqual(publicComposerModel({ model: 'bailian/deepseek-v4-flash-private' }), {
    label: 'Assistant',
    speed: 'Fast',
    state: 'ready',
  });
  assert.deepEqual(publicComposerModel({ model: 'gpt-5-high-secret' }), {
    label: 'GPT',
    speed: 'High',
    state: 'ready',
  });
});

test('composer model menu exposes public declared intents only', () => {
  const intents = composerModelSelectionIntents();
  assert.deepEqual(intents.map((intent) => intent.id), [
    'auto',
    'max',
    'assistant-auto',
    'assistant-fast',
    'assistant-balanced',
    'assistant-deep',
  ]);
  assert.deepEqual(intents.map((intent) => intent.capabilityTier), ['auto', 'max', 'auto', 'fast', 'balanced', 'deep']);
  const publicText = JSON.stringify(intents);
  for (const term of ['provider', 'apiKey', 'token', 'secret', 'baseUrl', '/Users/', '/Applications/workspace']) {
    assert.doesNotMatch(publicText, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});
