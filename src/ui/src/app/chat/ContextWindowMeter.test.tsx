import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildContextWindowMeterModel } from '../../contextWindow';
import type { AgentContextWindowState } from '../../domain';
import { ContextWindowMeter } from './ContextWindowMeter';

const state: AgentContextWindowState = {
  source: 'native',
  status: 'healthy',
  usedTokens: 70500,
  windowTokens: 200000,
  ratio: 0.3525,
  input: 51000,
  cache: 7500,
  output: 12000,
  provider: 'private-provider',
  model: 'private/model-name',
  backend: 'codex',
  compactCapability: 'native',
  breakdown: {
    systemPrompt: 501,
    toolDefinitions: 7500,
    rules: 3100,
    skills: 1500,
    mcp: 3100,
    subagentDefinitions: 577,
    conversation: 54100,
  },
  budget: {
    normalizedTokens: 42000,
    rawTokens: 90000,
    savedTokens: 48000,
    rawRef: '/Users/private/.sciforge/context/raw.json',
  },
};

test('context window meter exposes Cursor-like read-only inspector details', () => {
  const html = renderToStaticMarkup(React.createElement(ContextWindowMeter, {
    state,
    running: false,
    locale: 'en-US',
  }));

  assert.match(html, /Open context window details/);
  assert.match(html, /Context usage details/);
  assert.match(html, /Close context details/);
  assert.match(html, /35\.3%/);
  assert.match(html, /70\.5k \/ 200k Tokens/);
  for (const label of ['System prompt', 'Tool definitions', 'Rules', 'Skills', 'MCP', 'Subagent definitions', 'Conversation']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /data-context-segment="conversation"/);
  assert.match(html, /data-context-retention="selected-objects-preserved"/);
  for (const privateTerm of ['private-provider', 'private/model-name', '/Users/private', 'raw.json']) {
    assert.doesNotMatch(html, new RegExp(privateTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('context window meter model keeps usage rows read-only and bounded to public values', () => {
  const model = buildContextWindowMeterModel(state, false, 'en-US');

  assert.deepEqual(model.usageRows.map((row) => row.label), [
    'System prompt',
    'Tool definitions',
    'Rules',
    'Skills',
    'MCP',
    'Subagent definitions',
    'Conversation',
  ]);
  assert.deepEqual(model.usageRows.map((row) => row.value), [
    '501 tokens',
    '7.5k tokens',
    '3.1k tokens',
    '1.5k tokens',
    '3.1k tokens',
    '577 tokens',
    '54.1k tokens',
  ]);
  assert.ok(model.usageSegments.some((segment) => segment.kind === 'conversation' && segment.width === '27.05%'));
});

test('context window meter warns near limit without dropping selected refs or exposing private config', () => {
  const html = renderToStaticMarkup(React.createElement(ContextWindowMeter, {
    state: {
      ...state,
      status: 'near-limit',
      usedTokens: 182000,
      ratio: 0.91,
      provider: 'private-provider-never-render',
      model: 'private-model-never-render',
    },
    running: true,
    locale: 'en-US',
  }));

  assert.match(html, /data-context-level="near-limit"/);
  assert.match(html, /data-context-warning="near-limit"/);
  assert.match(html, /added guidance queues and selected objects stay attached/);
  assert.match(html, /selected-objects-preserved/);
  assert.doesNotMatch(html, /private-provider-never-render|private-model-never-render/);
});
