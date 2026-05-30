import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { basicWorkspaceFileViewerFixture } from './fixtures/basic';
import { emptyWorkspaceFileViewerFixture } from './fixtures/empty';
import { manifest } from './manifest';
import { renderWorkspaceFileViewer, WorkspaceFileViewer } from './render';

test('workspace-file-viewer package exposes manifest and renders tree plus draft editor', () => {
  assert.equal(manifest.componentId, 'workspace-file-viewer');
  const html = renderToStaticMarkup(React.createElement(renderWorkspaceFileViewer, basicWorkspaceFileViewerFixture));

  assert.match(html, /PROJECT\.md/);
  assert.match(html, /textarea/);
  assert.match(html, /Workspace file viewer demo/);
  assert.match(html, /workspace-file-viewer-tree/);
  assert.match(html, /workspace-file-viewer-editor/);
});

test('workspace-file-viewer renders useful empty state', () => {
  const html = renderToStaticMarkup(React.createElement(renderWorkspaceFileViewer, emptyWorkspaceFileViewerFixture));

  assert.match(html, /No files to show/);
  assert.match(html, /Select a file to inspect it/);
});

test('workspace-file-viewer expresses copy and save through callbacks', () => {
  let copiedPath = '';
  let copiedContents = '';
  let saved = false;
  const element = React.createElement(WorkspaceFileViewer, {
    rootPath: '/workspace/SciForge',
    rootLabel: 'SciForge',
    expandedFolderPaths: ['/workspace/SciForge'],
    entriesByFolder: { '/workspace/SciForge': [] },
    selectedPath: '/workspace/SciForge/PROJECT.md',
    file: {
      path: '/workspace/SciForge/PROJECT.md',
      name: 'PROJECT.md',
      content: '# old',
      size: 5,
      language: 'markdown',
    },
    draft: '# new',
    dirty: true,
    onCopyPath: (path) => {
      copiedPath = path;
    },
    onCopyContents: (content) => {
      copiedContents = content;
    },
    onSave: () => {
      saved = true;
    },
  });
  const html = renderToStaticMarkup(element);

  assert.match(html, /Unsaved/);
  assert.equal(copiedPath, '');
  assert.equal(copiedContents, '');
  assert.equal(saved, false);
});
