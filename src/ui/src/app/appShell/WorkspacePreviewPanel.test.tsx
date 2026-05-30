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

  assert.match(html, /File preview/);
  assert.match(html, /report\.md/);
  assert.match(html, /Unsaved/);
  assert.match(html, /aria-label="Copy path"/);
  assert.match(html, /aria-label="Copy contents"/);
  assert.match(html, /aria-label="Save file"/);
  assert.match(html, /markdown/);
  assert.match(html, /2\.0 KB/);
  assert.match(html, /report\.md contents/);
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

  assert.match(html, /Saved/);
  assert.match(html, /disabled=""/);
  assert.match(html, /notes\.txt contents/);
});
