import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceExplorerToolbar } from './WorkspaceExplorerToolbar';

test('workspace explorer toolbar keeps file, folder, refresh, and collapse commands accessible', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceExplorerToolbar, {
    onCreateFile: () => undefined,
    onCreateFolder: () => undefined,
    onRefresh: () => undefined,
    onCollapseAll: () => undefined,
  }));

  assert.match(html, /aria-label="新建文件"/);
  assert.match(html, /aria-label="新建文件夹"/);
  assert.match(html, /aria-label="刷新"/);
  assert.match(html, /aria-label="全部折叠"/);
  assert.match(html, /explorer-view-toolbar/);
});
