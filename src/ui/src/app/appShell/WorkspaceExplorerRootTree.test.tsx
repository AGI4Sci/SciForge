import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceExplorerRootTree } from './WorkspaceExplorerRootTree';

test('workspace explorer root tree renders selected expanded root and children', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceExplorerRootTree, {
    workspaceRoot: '/tmp/SciForge',
    rootLabel: 'SciForge',
    expanded: true,
    selected: true,
    onRootClick: () => undefined,
    onRootContextMenu: () => undefined,
    onToggleRoot: () => undefined,
    children: React.createElement('span', null, 'child-node'),
  }));

  assert.match(html, /role="treeitem"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /is-selected/);
  assert.match(html, /aria-label="折叠"/);
  assert.match(html, /SciForge/);
  assert.match(html, /child-node/);
  assert.match(html, /role="group"/);
});

test('workspace explorer root tree hides children when collapsed', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceExplorerRootTree, {
    workspaceRoot: '/tmp/SciForge',
    rootLabel: '',
    expanded: false,
    selected: false,
    onRootClick: () => undefined,
    onRootContextMenu: () => undefined,
    onToggleRoot: () => undefined,
    children: React.createElement('span', null, 'child-node'),
  }));

  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="展开"/);
  assert.match(html, /\/tmp\/SciForge/);
  assert.doesNotMatch(html, /child-node/);
});
