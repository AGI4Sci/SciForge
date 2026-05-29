import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceConnectionPanel } from './WorkspaceConnectionPanel';

test('workspace connection panel keeps folder picker and manual path controls', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceConnectionPanel, {
    folderPickerRef: { current: null },
    pathEditDraft: '/tmp/SciForge',
    workspaceStatus: '已连接',
    onPathEditDraftChange: () => undefined,
    onChooseWorkspaceRootPath: () => undefined,
    onRefreshExplorer: () => undefined,
    onWorkspacePathChange: () => undefined,
  }));

  assert.match(html, /打开其他文件夹/);
  assert.match(html, /手动输入路径/);
  assert.match(html, /\/tmp\/SciForge/);
  assert.match(html, /用作工作区根目录/);
  assert.match(html, /title="已连接"/);
  assert.match(html, /aria-label="项目根路径"/);
});
