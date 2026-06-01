import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { basicWorkspaceFileViewerFixture } from './fixtures/basic';
import { emptyWorkspaceFileViewerFixture } from './fixtures/empty';
import { manifest } from './manifest';
import { renderWorkspaceFileViewer, WorkspaceFileViewer, workspaceFileViewerCanEditFile, workspaceFileViewerPathSegments, workspaceFileViewerUnsupportedKind } from './render';

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

test('workspace-file-viewer can render workspace-relative display paths', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceFileViewer, {
    rootPath: '/workspace/SciForge',
    rootLabel: 'SciForge',
    expandedFolderPaths: ['/workspace/SciForge'],
    selectedPath: '/workspace/SciForge/docs/README.md',
    entriesByFolder: {
      '/workspace/SciForge': [
        { kind: 'folder', name: 'docs', path: '/workspace/SciForge/docs', size: 0 },
      ],
      '/workspace/SciForge/docs': [
        { kind: 'file', name: 'README.md', path: '/workspace/SciForge/docs/README.md', size: 9 },
      ],
    },
    file: {
      path: '/workspace/SciForge/docs/README.md',
      name: 'README.md',
      content: '# Read me',
      size: 9,
      language: 'markdown',
    },
    displayPathForPath: (path) => path.replace('/workspace/SciForge/', '').replace('/workspace/SciForge', '.'),
    copyPathForPath: (path) => `file:${path.replace('/workspace/SciForge/', '').replace('/workspace/SciForge', '.')}`,
    onCopyPath: () => {},
  }));

  assert.match(html, /title="docs\/README\.md"/);
  assert.doesNotMatch(html, /title="\/workspace\/SciForge/);
});

test('workspace-file-viewer renders workspace-relative breadcrumbs for selected files', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceFileViewer, {
    rootPath: '/workspace/SciForge',
    rootLabel: 'SciForge',
    expandedFolderPaths: ['/workspace/SciForge'],
    selectedPath: '/workspace/SciForge/src/app/ResultsRenderer.tsx',
    entriesByFolder: { '/workspace/SciForge': [] },
    file: {
      path: '/workspace/SciForge/src/app/ResultsRenderer.tsx',
      name: 'ResultsRenderer.tsx',
      content: 'export {};\n',
      size: 10,
      language: 'typescript',
    },
    draft: 'export {};\n',
    onToggleFolder: () => {},
  }));

  assert.deepEqual(workspaceFileViewerPathSegments('/workspace/SciForge', '/workspace/SciForge/src/app/ResultsRenderer.tsx').map((segment) => segment.label), [
    'SciForge',
    'src',
    'app',
    'ResultsRenderer.tsx',
  ]);
  assert.match(html, /class="workspace-file-viewer-breadcrumb"/);
  assert.match(html, /aria-label="File path"/);
  assert.match(html, /title="\/workspace\/SciForge\/src"/);
  assert.match(html, /aria-current="page" title="\/workspace\/SciForge\/src\/app\/ResultsRenderer\.tsx"/);
});

test('workspace-file-viewer package renderer preserves display and copy path helpers', () => {
  const html = renderToStaticMarkup(React.createElement(renderWorkspaceFileViewer, {
    slot: {
      componentId: 'workspace-file-viewer',
      props: {
        rootPath: '/workspace/SciForge',
        rootLabel: 'SciForge',
        expandedFolderPaths: ['/workspace/SciForge'],
        selectedPath: '/workspace/SciForge/docs/README.md',
        entriesByFolder: {
          '/workspace/SciForge': [
            { kind: 'file', name: 'README.md', path: '/workspace/SciForge/docs/README.md', size: 9 },
          ],
        },
        file: {
          path: '/workspace/SciForge/docs/README.md',
          name: 'README.md',
          content: '# Read me',
          size: 9,
          language: 'markdown',
        },
        displayPathForPath: (path: string) => path.replace('/workspace/SciForge/', '').replace('/workspace/SciForge', '.'),
        copyPathForPath: (path: string) => `file:${path.replace('/workspace/SciForge/', '').replace('/workspace/SciForge', '.')}`,
        onCopyPath: () => {},
      },
    },
  }));

  assert.match(html, /title="docs\/README\.md"/);
  assert.doesNotMatch(html, /title="\/workspace\/SciForge\/docs\/README\.md"/);
});

test('workspace-file-viewer limits large folders and renders typed continuation controls', () => {
  const entries = Array.from({ length: 65 }, (_, index) => ({
    kind: 'file' as const,
    name: `file-${String(index).padStart(3, '0')}.txt`,
    path: `/workspace/SciForge/file-${String(index).padStart(3, '0')}.txt`,
    size: index,
  }));
  const html = renderToStaticMarkup(React.createElement(WorkspaceFileViewer, {
    rootPath: '/workspace/SciForge',
    rootLabel: 'SciForge',
    expandedFolderPaths: ['/workspace/SciForge'],
    entriesByFolder: { '/workspace/SciForge': entries },
    treePageSize: 10,
  }));

  assert.match(html, /file-000\.txt/);
  assert.match(html, /file-009\.txt/);
  assert.doesNotMatch(html, /file-010\.txt/);
  assert.match(html, /data-folder-continuation-state="available"/);
  assert.match(html, /data-folder-offset="10"/);
  assert.match(html, /data-folder-limit="10"/);
  assert.match(html, /data-folder-total="65"/);
  assert.match(html, /Showing 10 of 65/);
  assert.match(html, />Load more<\/button>/);
});

test('workspace-file-viewer renders host-provided folder continuation metadata', () => {
  const entries = Array.from({ length: 10 }, (_, index) => ({
    kind: 'file' as const,
    name: `chunk-${String(index).padStart(2, '0')}.txt`,
    path: `/workspace/SciForge/chunk-${String(index).padStart(2, '0')}.txt`,
    size: index,
  }));
  const html = renderToStaticMarkup(React.createElement(WorkspaceFileViewer, {
    rootPath: '/workspace/SciForge',
    rootLabel: 'SciForge',
    expandedFolderPaths: ['/workspace/SciForge'],
    entriesByFolder: { '/workspace/SciForge': entries },
    treePageSize: 10,
    folderContinuations: {
      '/workspace/SciForge': {
        offset: 10,
        limit: 10,
        total: 65,
        hasMore: true,
        commandLabel: 'Load next chunk',
      },
    },
  }));

  assert.match(html, /chunk-09\.txt/);
  assert.match(html, /data-folder-offset="10"/);
  assert.match(html, /data-folder-total="65"/);
  assert.match(html, /Load next chunk/);
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

test('workspace-file-viewer renders Cursor-like open file tabs and host-provided preview mode', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceFileViewer, {
    rootPath: '/workspace/SciForge',
    rootLabel: 'SciForge',
    expandedFolderPaths: ['/workspace/SciForge'],
    entriesByFolder: { '/workspace/SciForge': [] },
    selectedPath: '/workspace/SciForge/PROJECT.md',
    openFileTabs: [
      { path: '/workspace/SciForge/README.md', name: 'README.md', dirty: true },
      { path: '/workspace/SciForge/PROJECT.md', name: 'PROJECT.md' },
    ],
    file: {
      path: '/workspace/SciForge/PROJECT.md',
      name: 'PROJECT.md',
      content: '# raw source should stay behind source mode',
      previewContent: '<h1>Host preview</h1>',
      size: 38,
      language: 'markdown',
      mimeType: 'text/markdown',
    },
    draft: '# raw source should stay behind source mode',
    viewMode: 'preview',
    onSelectOpenFile: () => {},
    onCloseOpenFile: () => {},
    onViewModeChange: () => {},
  }));

  assert.match(html, /role="tablist" aria-label="Open files"/);
  assert.match(html, /data-open-file-tab="\/workspace\/SciForge\/README\.md"/);
  assert.match(html, /data-open-file-state="dirty"/);
  assert.match(html, /role="tab" aria-selected="true" title="\/workspace\/SciForge\/PROJECT\.md"/);
  assert.match(html, /data-file-view-mode-command="source"/);
  assert.match(html, /data-file-view-mode-command="preview" aria-pressed="true"/);
  assert.match(html, /data-file-view-mode="preview"/);
  assert.match(html, /&lt;h1&gt;Host preview&lt;\/h1&gt;/);
  assert.doesNotMatch(html, /raw source should stay behind source mode/);
  assert.doesNotMatch(html, /<textarea/);
});

test('workspace-file-viewer forces source mode while editing and disables preview switching', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceFileViewer, {
    rootPath: '/workspace/SciForge',
    rootLabel: 'SciForge',
    expandedFolderPaths: ['/workspace/SciForge'],
    entriesByFolder: { '/workspace/SciForge': [] },
    selectedPath: '/workspace/SciForge/PROJECT.md',
    file: {
      path: '/workspace/SciForge/PROJECT.md',
      name: 'PROJECT.md',
      content: '# editable',
      previewContent: '<h1>Host preview</h1>',
      size: 10,
      language: 'markdown',
    },
    draft: '# editable draft',
    editMode: true,
    viewMode: 'preview',
    onSave: () => {},
    onCancel: () => {},
    onViewModeChange: () => {},
  }));

  assert.match(html, /data-file-view-mode="source"/);
  assert.match(html, /# editable draft/);
  assert.match(html, /data-file-view-mode-command="preview"[^>]*disabled=""/);
  assert.doesNotMatch(html, /Host preview/);
});

test('workspace-file-viewer renders binary files as typed unsupported read-only previews', () => {
  const file = {
    path: '/workspace/SciForge/assets/plot.png',
    name: 'plot.png',
    content: 'iVBORw0KGgo=',
    size: 12,
    language: 'image',
    encoding: 'base64' as const,
    mimeType: 'image/png',
  };
  const html = renderToStaticMarkup(React.createElement(WorkspaceFileViewer, {
    rootPath: '/workspace/SciForge',
    rootLabel: 'SciForge',
    expandedFolderPaths: ['/workspace/SciForge'],
    entriesByFolder: { '/workspace/SciForge': [] },
    selectedPath: file.path,
    file,
    draft: file.content,
    editMode: true,
    onSave: () => {},
    onCopyContents: () => {},
  }));

  assert.equal(workspaceFileViewerUnsupportedKind(file), 'binary');
  assert.equal(workspaceFileViewerCanEditFile(file), false);
  assert.match(html, /data-file-preview-state="unsupported-binary"/);
  assert.match(html, /Binary files are read-only in this viewer/);
  assert.match(html, /image\/png/);
  assert.doesNotMatch(html, /iVBORw0KGgo/);
  assert.doesNotMatch(html, /<textarea/);
  assert.match(html, /disabled="" title="Edit" aria-label="Edit"/);
  assert.match(html, /disabled="" title="Save file" aria-label="Save file"/);
});

test('workspace-file-viewer treats oversized loaded text as typed large-file state', () => {
  const file = {
    path: '/workspace/SciForge/logs/full.log',
    name: 'full.log',
    content: 'raw content should not render',
    size: 2048,
    language: 'log',
    mimeType: 'text/plain',
  };
  const html = renderToStaticMarkup(React.createElement(WorkspaceFileViewer, {
    rootPath: '/workspace/SciForge',
    rootLabel: 'SciForge',
    expandedFolderPaths: ['/workspace/SciForge'],
    entriesByFolder: { '/workspace/SciForge': [] },
    selectedPath: file.path,
    file,
    draft: file.content,
    editMode: true,
    inlineTextLimitBytes: 1024,
    onSave: () => {},
    onCopyPath: () => {},
  }));

  assert.equal(workspaceFileViewerUnsupportedKind(file, 1024), 'too-large');
  assert.equal(workspaceFileViewerCanEditFile(file, 1024), false);
  assert.match(html, /data-file-preview-state="unsupported-too-large"/);
  assert.match(html, /data-file-size-bytes="2048"/);
  assert.match(html, /data-inline-limit-bytes="1024"/);
  assert.match(html, /Large file/);
  assert.match(html, /Inline limit: 1\.0 KB/);
  assert.match(html, /Copy path/);
  assert.doesNotMatch(html, /raw content should not render/);
  assert.doesNotMatch(html, /<textarea/);
});

test('workspace-file-viewer renders host-provided large file segment as read-only preview', () => {
  const file = {
    path: '/workspace/SciForge/logs/full.log',
    name: 'full.log',
    content: 'full payload should stay host-owned',
    size: 4096,
    language: 'log',
    mimeType: 'text/plain',
    previewContent: 'line 1\nline 2\n',
    previewSegment: {
      offset: 1024,
      length: 14,
      total: 4096,
      hasMore: true,
      label: 'Log segment 2',
    },
  };
  const html = renderToStaticMarkup(React.createElement(WorkspaceFileViewer, {
    rootPath: '/workspace/SciForge',
    rootLabel: 'SciForge',
    expandedFolderPaths: ['/workspace/SciForge'],
    entriesByFolder: { '/workspace/SciForge': [] },
    selectedPath: file.path,
    file,
    draft: file.content,
    editMode: true,
    inlineTextLimitBytes: 1024,
    onSave: () => {},
    onCopyContents: () => {},
  }));

  assert.match(html, /data-file-preview-state="unsupported-too-large"/);
  assert.match(html, /class="workspace-file-viewer-segment-preview"/);
  assert.match(html, /data-file-segment-offset="1024"/);
  assert.match(html, /data-file-segment-length="14"/);
  assert.match(html, /data-file-segment-total="4096"/);
  assert.match(html, /data-file-segment-has-more="true"/);
  assert.match(html, /aria-label="Log segment 2"/);
  assert.match(html, /line 1/);
  assert.match(html, /line 2/);
  assert.match(html, /aria-label="Copy contents"(?:(?!disabled).)*>Copy<\/button>/);
  assert.doesNotMatch(html, /full payload should stay host-owned/);
  assert.doesNotMatch(html, /<textarea/);
});

test('workspace-file-viewer renders oversized metadata without an editable draft', () => {
  const file = {
    path: '/workspace/SciForge/data/table.csv',
    name: 'table.csv',
    content: '',
    size: 2 * 1024 * 1024,
    language: 'unsupported',
    contentUnavailable: true,
    unsupportedKind: 'too-large' as const,
  };
  const html = renderToStaticMarkup(React.createElement(WorkspaceFileViewer, {
    rootPath: '/workspace/SciForge',
    rootLabel: 'SciForge',
    expandedFolderPaths: ['/workspace/SciForge'],
    entriesByFolder: { '/workspace/SciForge': [] },
    selectedPath: file.path,
    file,
    draft: '',
    editMode: true,
    onSave: () => {},
    onDraftChange: () => {},
  }));

  assert.equal(workspaceFileViewerUnsupportedKind(file), 'too-large');
  assert.equal(workspaceFileViewerCanEditFile(file), false);
  assert.match(html, /data-file-preview-state="unsupported-too-large"/);
  assert.match(html, /data-inline-limit-bytes="1048576"/);
  assert.match(html, /This file is too large for inline editing/);
  assert.match(html, /2\.0 MB/);
  assert.match(html, /Inline limit: 1\.0 MB/);
  assert.doesNotMatch(html, /<textarea/);
});
