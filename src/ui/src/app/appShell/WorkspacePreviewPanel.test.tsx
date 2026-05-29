import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspacePreviewPanel } from './WorkspacePreviewPanel';

test('workspace preview panel renders file metadata and save/copy controls', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspacePreviewPanel, {
    file: {
      path: '/tmp/SciForge/report.md',
      name: 'report.md',
      content: '# Report',
      size: 2048,
      language: 'markdown',
      modifiedAt: '2026-05-29T12:00:00.000Z',
    },
    draft: '# Report\nUpdated',
    dirty: true,
    onDraftChange: () => undefined,
    onSave: () => undefined,
    onCopyText: () => undefined,
  }));

  assert.match(html, /文件预览/);
  assert.match(html, /report\.md/);
  assert.match(html, /未保存/);
  assert.match(html, /aria-label="复制路径"/);
  assert.match(html, /aria-label="复制内容"/);
  assert.match(html, /aria-label="保存文件"/);
  assert.match(html, /markdown/);
  assert.match(html, /2\.0 KB/);
  assert.match(html, /report\.md 文件内容/);
});

test('workspace preview panel renders clean state with disabled save', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspacePreviewPanel, {
    file: {
      path: '/tmp/SciForge/notes.txt',
      name: 'notes.txt',
      content: 'Ready',
      size: 5,
      language: 'text',
    },
    draft: 'Ready',
    dirty: false,
    onDraftChange: () => undefined,
    onSave: () => undefined,
    onCopyText: () => undefined,
  }));

  assert.match(html, /已保存/);
  assert.match(html, /disabled=""/);
  assert.match(html, /notes\.txt 文件内容/);
});
