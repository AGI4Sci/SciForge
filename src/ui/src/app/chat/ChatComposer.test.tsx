import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
  assert.match(html, /Assistant connected/);
  assert.match(html, /Writable/);
  assert.match(html, /Context/);
  for (const term of [
    'sciforge-deepseek-proxy',
    'bailian/deepseek-v4-flash',
    '/Applications/workspace',
    'workspace-write',
    'provider',
    'model',
    'profile',
    'runtime codex',
    'run id',
    'workspace command',
  ]) {
    assert.doesNotMatch(html, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
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
  assert.doesNotMatch(html, /provider|model|profile|runtime codex|run id/i);
});
