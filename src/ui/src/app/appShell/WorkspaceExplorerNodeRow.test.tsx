import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceExplorerNodeRow } from './WorkspaceExplorerNodeRow';

test('workspace explorer node row renders expanded selected folder with children', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceExplorerNodeRow, {
    entry: { kind: 'folder', path: '/tmp/SciForge/src', name: 'src' },
    depth: 2,
    expanded: true,
    selected: true,
    icon: React.createElement('span', null, 'unused'),
    onEntryClick: () => undefined,
    onEntryContextMenu: () => undefined,
    onToggleFolder: () => undefined,
    children: React.createElement('span', null, 'child-node'),
  }));

  assert.match(html, /role="treeitem"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /is-selected/);
  assert.match(html, /aria-label="折叠"/);
  assert.match(html, /src/);
  assert.match(html, /child-node/);
  assert.match(html, /role="group"/);
});

test('workspace explorer node row renders file without folder controls', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceExplorerNodeRow, {
    entry: { kind: 'file', path: '/tmp/SciForge/report.md', name: 'report.md', size: 64 },
    depth: 1,
    expanded: false,
    selected: false,
    icon: React.createElement('span', { className: 'file-icon' }, 'file-icon'),
    onEntryClick: () => undefined,
    onEntryContextMenu: () => undefined,
    onToggleFolder: () => undefined,
    children: React.createElement('span', null, 'hidden-child'),
  }));

  assert.match(html, /is-file/);
  assert.match(html, /explorer-twistie-placeholder/);
  assert.match(html, /file-icon/);
  assert.match(html, /report\.md/);
  assert.doesNotMatch(html, /aria-expanded/);
  assert.doesNotMatch(html, /hidden-child/);
});
