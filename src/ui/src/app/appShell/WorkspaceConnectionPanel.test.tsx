import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceConnectionPanel } from './WorkspaceConnectionPanel';

test('workspace connection panel keeps folder picker and manual path controls', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceConnectionPanel, {
    folderPickerRef: { current: null },
    pathEditDraft: '/tmp/SciForge',
    workspaceStatus: 'Connected',
    onPathEditDraftChange: () => undefined,
    onChooseWorkspaceRootPath: () => undefined,
    onWorkspacePathChange: () => undefined,
  }));

  assert.match(html, /Open Workspace/);
  assert.match(html, /Set path manually/);
  assert.match(html, /\/tmp\/SciForge/);
  assert.match(html, /Set as Current Workspace/);
  assert.match(html, /title="Connected"/);
  assert.match(html, /aria-label="Workspace root path"/);
  assert.doesNotMatch(html, /Create blank project|Use existing folder/);
});

test('workspace connection panel disables empty manual directory switches', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceConnectionPanel, {
    folderPickerRef: { current: null },
    pathEditDraft: '   ',
    workspaceStatus: '',
    onPathEditDraftChange: () => undefined,
    onChooseWorkspaceRootPath: () => undefined,
    onWorkspacePathChange: () => undefined,
  }));

  assert.match(html, /Set as Current Workspace/);
  assert.match(html, /disabled=""/);
});
