import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

import { ChatComposer } from './ChatComposer';

test('composer shows Codex-style context hints without provider, model, profile, or raw paths', () => {
  const html = renderToStaticMarkup(React.createElement(ChatComposer, {
    expanded: true,
    input: '',
    isSending: false,
    composerHeight: 58,
    referencePickMode: false,
    pendingReferences: [],
    contextMeter: React.createElement('span', null, 'Context'),
    fileInputRef: React.createRef<HTMLInputElement>(),
    referenceChips: null,
    runtimeContext: {
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      workspacePath: '/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1',
      permissionMode: 'workspace-write',
    },
    onExpand: () => undefined,
    onCollapse: () => undefined,
    onToggleReferencePickMode: () => undefined,
    onFileUpload: () => undefined,
    onInputChange: () => undefined,
    onSend: () => undefined,
    onAbort: () => undefined,
    onBeginResize: () => undefined,
  }));

  assert.match(html, /Workspace/);
  assert.match(html, /Local environment/);
  assert.match(html, /data-local-environment="true"/);
  assert.match(html, /Assistant connected/);
  assert.match(html, /Writable/);
  assert.match(html, /Context/);
  assert.match(html, /Add agents, context, tools/);
  assert.match(html, /MCP Servers/);
  for (const term of [
    'sciforge-deepseek-proxy',
    'bailian/deepseek-v4-flash',
    '/Applications/workspace',
    'workspace-write',
    'provider',
    'runtime codex',
    'run id',
    'workspace command',
  ]) {
    assert.doesNotMatch(html, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.doesNotMatch(html, /\bprofile\b/i);
});

test('composer keeps unset runtime context generic', () => {
  const html = renderToStaticMarkup(React.createElement(ChatComposer, {
    expanded: true,
    input: '',
    isSending: false,
    composerHeight: 58,
    referencePickMode: false,
    pendingReferences: [],
    contextMeter: null,
    fileInputRef: React.createRef<HTMLInputElement>(),
    referenceChips: null,
    runtimeContext: {
      provider: '',
      model: '',
      workspacePath: '',
      permissionMode: '',
    },
    onExpand: () => undefined,
    onCollapse: () => undefined,
    onToggleReferencePickMode: () => undefined,
    onFileUpload: () => undefined,
    onInputChange: () => undefined,
    onSend: () => undefined,
    onAbort: () => undefined,
    onBeginResize: () => undefined,
  }));

  assert.match(html, /No workspace/);
  assert.match(html, /Connection not configured/);
  assert.match(html, /Permission not set/);
  assert.doesNotMatch(html, /provider|runtime codex|run id/i);
  assert.doesNotMatch(html, /\bprofile\b/i);
});

test('composer folds Cursor-like tools, models, skills, and SciForge references into one add menu', () => {
  const html = renderToStaticMarkup(React.createElement(ChatComposer, {
    expanded: true,
    input: '',
    isSending: true,
    composerHeight: 58,
    referencePickMode: false,
    pendingReferences: [],
    queuedGuidanceCount: 2,
    contextMeter: React.createElement('span', null, 'Context 35%'),
    fileInputRef: React.createRef<HTMLInputElement>(),
    referenceChips: null,
    runtimeContext: {
      provider: 'private-provider',
      model: 'gpt-5-fast-private',
      workspacePath: '/Users/private/workspace',
      permissionMode: 'ask',
    },
    toolProviderRoutes: {
      'vision-mcp-private-route': {
        source: 'mcp',
        capabilityId: 'Vision MCP',
        primaryProviderId: 'private-provider',
        endpoint: 'http://127.0.0.1:8931/mcp?token=secret',
      },
    },
    agentHostCatalog: [
      { label: 'Citation verifier', kind: 'tool', source: 'module.query', detail: 'Claim evidence skill' },
      { label: 'Notebook Connector', toolType: 'connector', source: 'mcp', detail: 'Notebook refs' },
    ],
    onExpand: () => undefined,
    onCollapse: () => undefined,
    onToggleReferencePickMode: () => undefined,
    onFileUpload: () => undefined,
    onInputChange: () => undefined,
    onSend: () => undefined,
    onAbort: () => undefined,
    onBeginResize: () => undefined,
  }));

  for (const label of ['Plan', 'Debug', 'Multitask', 'Ask', 'Image', 'Models', 'Skills', 'MCP Servers', 'Pick visible context', 'Attach file']) {
    assert.match(html, new RegExp(label));
  }
  for (const modeId of ['plan', 'debug', 'multitask', 'ask']) {
    assert.match(html, new RegExp(`data-mode-option="${modeId}"`));
    assert.match(html, new RegExp(`data-mode-intent="${modeId}"`));
  }
  for (const label of ['Literature Research', 'Domain skill', 'Pipeline skill', 'PubMed', 'Tool skill', 'Citation verifier', 'Notebook Connector', 'Vision MCP']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /GPT/);
  assert.match(html, /Fast/);
  for (const id of ['auto', 'max', 'assistant-auto', 'assistant-fast', 'assistant-balanced', 'assistant-deep']) {
    assert.match(html, new RegExp(`data-model-option="${id}"`));
  }
  assert.match(html, /data-model-intent="assistant"/);
  assert.match(html, /Stop/);
  assert.match(html, /Queue/);
  assert.match(html, /2 queued/);
  assert.match(html, /Queued guidance/);
  assert.doesNotMatch(html, /gpt-5-fast-private|private-provider|\/Users\/private|127\.0\.0\.1|token|secret|provider|runtime codex|run id|raw schema|manifest/i);
  assert.doesNotMatch(html, /\bprofile\b/i);
  assert.doesNotMatch(html, /\/multitask/i);
});

test('composer renders selected multitask mode as a removable chip and focused placeholder', () => {
  const html = renderToStaticMarkup(React.createElement(ChatComposer, {
    expanded: true,
    input: '',
    isSending: false,
    composerHeight: 58,
    referencePickMode: false,
    pendingReferences: [],
    contextMeter: null,
    fileInputRef: React.createRef<HTMLInputElement>(),
    referenceChips: null,
    selectedModeIntent: {
      id: 'multitask',
      label: 'Multitask',
    },
    copy: {
      placeholder: 'Ask a question, or attach context...',
    },
    onExpand: () => undefined,
    onCollapse: () => undefined,
    onToggleReferencePickMode: () => undefined,
    onFileUpload: () => undefined,
    onInputChange: () => undefined,
    onSend: () => undefined,
    onAbort: () => undefined,
    onClearModeIntent: () => undefined,
    onBeginResize: () => undefined,
  }));

  assert.match(html, /data-selected-mode="multitask"/);
  assert.match(html, /Multitask/);
  assert.match(html, /Remove Multitask mode/);
  assert.match(html, /placeholder="Coordinate parallel tasks\.\.\."/);
  assert.doesNotMatch(html, /\/multitask/i);
  assert.doesNotMatch(html, /Ask a question, or attach context\.\.\./);
});

test('composer source keeps multitask out of slash command injection paths', () => {
  const source = readFileSync(new URL('./ChatComposer.tsx', import.meta.url), 'utf8');
  assert.match(source, /onModeIntentSelect/);
  assert.doesNotMatch(source, /['"`]\/multitask\b/);
});
