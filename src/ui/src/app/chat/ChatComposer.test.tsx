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
    contextMeter: React.createElement('span', null, '当前上下文'),
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

  assert.match(html, /当前项目/);
  assert.match(html, /助手已连接/);
  assert.match(html, /可写工作区/);
  assert.match(html, /当前上下文/);
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

  assert.match(html, /项目未选择/);
  assert.match(html, /连接待配置/);
  assert.match(html, /权限待确认/);
  assert.doesNotMatch(html, /provider|model|profile|runtime codex|run id/i);
});
