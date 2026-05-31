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
  assert.match(html, /data-component-id="workspace-file-viewer"/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /placeholder="Search files"/);
});

test('workspace-file-viewer renders useful empty state', () => {
  const html = renderToStaticMarkup(React.createElement(renderWorkspaceFileViewer, emptyWorkspaceFileViewerFixture));

  assert.match(html, /No files to show/);
  assert.match(html, /Select a file to inspect it/);
});

test('workspace-file-viewer package renderer accepts host slot props', () => {
  const html = renderToStaticMarkup(React.createElement(renderWorkspaceFileViewer, {
    slot: {
      componentId: 'workspace-file-viewer',
      props: {
        rootPath: '/workspace/SciForge',
        rootLabel: 'SciForge',
        expandedFolderPaths: ['/workspace/SciForge'],
        selectedPath: '/workspace/SciForge/README.md',
        entriesByFolder: {
          '/workspace/SciForge': [
            { kind: 'file', name: 'README.md', path: '/workspace/SciForge/README.md', size: 12 },
          ],
        },
        file: {
          path: '/workspace/SciForge/README.md',
          name: 'README.md',
          content: '# Read me',
          size: 9,
          language: 'markdown',
        },
        notice: 'Host tree loaded',
        labels: { searchPlaceholder: 'Find in workspace' },
      },
    },
  }));

  assert.match(html, /README\.md/);
  assert.match(html, /# Read me/);
  assert.match(html, /Host tree loaded/);
  assert.match(html, /placeholder="Find in workspace"/);
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

test('workspace-file-viewer defaults to read-only mode with Save unavailable', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceFileViewer, {
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
    onSave: () => {},
    onClose: () => {},
  }));

  assert.match(html, /Read only/);
  assert.match(html, /<textarea[^>]*readOnly=""/);
  assert.match(html, /aria-label="Edit"[^>]*>Edit<\/button>/);
  assert.match(html, /disabled="" title="Save file" aria-label="Save file"/);
  assert.match(html, /aria-label="Close file view"[^>]*>X<\/button>/);
  assert.doesNotMatch(html, /aria-label="Cancel"/);
});

test('workspace-file-viewer enables editing controls only in edit mode', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceFileViewer, {
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
    editMode: true,
    onSave: () => {},
    onCancel: () => {},
    onClose: () => {},
  }));

  assert.match(html, /Editing/);
  assert.doesNotMatch(html, /<textarea[^>]*readOnly=""/);
  assert.match(html, /disabled="" title="Edit" aria-label="Edit"/);
  assert.match(html, /aria-label="Save file"(?:(?!disabled).)*>Save<\/button>/);
  assert.match(html, /aria-label="Cancel"[^>]*>Cancel<\/button>/);
  assert.doesNotMatch(html, /aria-label="Close file view"/);
});
