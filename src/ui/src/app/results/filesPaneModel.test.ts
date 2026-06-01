import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObjectReference } from '../../domain';
import {
  cancelWorkspaceFileEditorEdit,
  planWorkspaceFileTabOpen,
  removeWorkspaceFileEditorForTab,
  setWorkspaceFileEditorForTab,
  shouldTryRepoRootWorkspaceFallback,
  tooLargeWorkspaceFileFromEntry,
  workspaceFileEditorCanEditFile,
  workspaceFileEditorIsDirty,
  workspaceFileEditorUnsupportedKind,
  workspaceFileFocusRequestKey,
  workspaceFileOpenTabsForRightPaneTabs,
  workspaceFileWithInlinePolicy,
  type WorkspaceFileEditorState,
} from './filesPaneModel';

test('files pane model allows repo-root fallback only for safe relative file refs', () => {
  const replyReference: ObjectReference = {
    id: 'reply-file',
    kind: 'file',
    title: 'agentserver-stream.ts',
    ref: 'file:src/runtime/gateway/agentserver-stream.ts',
    status: 'available',
    provenance: { path: 'src/runtime/gateway/agentserver-stream.ts', producer: 'message-inline-reference' },
  };

  assert.equal(shouldTryRepoRootWorkspaceFallback(replyReference, 'src/runtime/gateway/agentserver-stream.ts'), true);
  assert.equal(shouldTryRepoRootWorkspaceFallback(replyReference, '../config.local.json'), false);
  assert.equal(shouldTryRepoRootWorkspaceFallback(replyReference, '.env'), false);
  assert.equal(shouldTryRepoRootWorkspaceFallback(replyReference, '.sciforge/workspace-state.json'), false);
  assert.equal(shouldTryRepoRootWorkspaceFallback(replyReference, '/Applications/workspace/SciForge/PROJECT.md'), false);
});

test('files pane model keeps focus request keys stable while browsing another file', () => {
  const reference: ObjectReference = {
    id: 'process-file',
    kind: 'file',
    title: 'agentserver-stream.ts',
    ref: 'file:src/runtime/gateway/agentserver-stream.ts',
    runId: 'run-a',
    status: 'available',
    provenance: { path: 'src/runtime/gateway/agentserver-stream.ts', producer: 'cursor-agent-process' },
  };
  const key = workspaceFileFocusRequestKey(reference, 'src/runtime/gateway/agentserver-stream.ts');
  const browsedEditor: WorkspaceFileEditorState = {
    file: {
      path: '/tmp/sciforge-repo/src/runtime/gateway/capability-broker.ts',
      name: 'capability-broker.ts',
      content: 'export {};\n',
      size: 11,
      language: 'typescript',
    },
    draft: 'export {};\n',
    workspacePath: '/tmp/sciforge-repo',
    focusRequestKey: key,
  };

  assert.equal(browsedEditor.focusRequestKey, key);
  assert.notEqual(browsedEditor.file.path, '/tmp/sciforge-repo/src/runtime/gateway/agentserver-stream.ts');
  assert.notEqual(workspaceFileFocusRequestKey({ ...reference, id: 'other-file' }, 'src/runtime/gateway/agentserver-stream.ts'), key);
});

test('files pane model scopes editor state and open-file tabs by right-pane tab id', () => {
  const first: WorkspaceFileEditorState = {
    file: {
      path: '/tmp/sciforge/first.md',
      name: 'first.md',
      content: '# First\n',
      size: 8,
      language: 'markdown',
    },
    draft: '# First draft\n',
    workspacePath: '/tmp/sciforge',
    editMode: true,
  };
  const second: WorkspaceFileEditorState = {
    file: {
      path: '/tmp/sciforge/second.md',
      name: 'second.md',
      content: '# Second\n',
      size: 9,
      language: 'markdown',
    },
    draft: '# Second draft\n',
    workspacePath: '/tmp/sciforge',
    editMode: true,
  };

  const withFirst = setWorkspaceFileEditorForTab({}, 'base:files', first);
  const withBoth = setWorkspaceFileEditorForTab(withFirst, 'custom:files:2', second);
  const changedFirst = setWorkspaceFileEditorForTab(withBoth, 'base:files', { ...first, draft: '# First changed\n' });
  const closedFirst = removeWorkspaceFileEditorForTab(changedFirst, 'base:files');

  assert.equal(changedFirst['base:files']?.draft, '# First changed\n');
  assert.equal(changedFirst['custom:files:2']?.draft, '# Second draft\n');
  assert.equal(closedFirst['base:files'], undefined);
  assert.equal(closedFirst['custom:files:2']?.file.path, '/tmp/sciforge/second.md');

  const openTabs = workspaceFileOpenTabsForRightPaneTabs([
    { id: 'base:files', kind: 'files', label: 'Files', closable: true },
    { id: 'custom:files:2', kind: 'files', label: 'Files 2', closable: true },
    { id: 'base:browser', kind: 'browser', label: 'Browser', closable: true },
  ], changedFirst);
  assert.deepEqual(openTabs.map((tab) => ({ name: tab.name, dirty: tab.dirty, readOnly: tab.readOnly })), [
    { name: 'first.md', dirty: true, readOnly: false },
    { name: 'second.md', dirty: true, readOnly: false },
  ]);
});

test('files pane model cancel restores original draft without closing the file tab', () => {
  const file = {
    path: '/tmp/sciforge/PROJECT.md',
    name: 'PROJECT.md',
    content: '# Original\n',
    size: 11,
    language: 'markdown',
  };
  const cancelled = cancelWorkspaceFileEditorEdit({
    file,
    draft: '# Changed\n',
    workspacePath: '/tmp/sciforge',
    editMode: true,
  });

  assert.equal(cancelled.file, file);
  assert.equal(cancelled.draft, '# Original\n');
  assert.equal(cancelled.editMode, false);
});

test('files pane model plans Cursor-like file tab focus, reuse, and dirty-safe open', () => {
  const first: WorkspaceFileEditorState = {
    file: {
      path: '/tmp/sciforge/src/first.md',
      name: 'first.md',
      content: '# First\n',
      size: 8,
      language: 'markdown',
    },
    draft: '# First draft\n',
    workspacePath: '/tmp/sciforge',
    editMode: true,
  };
  const second: WorkspaceFileEditorState = {
    file: {
      path: '/tmp/sciforge/src/second.md',
      name: 'second.md',
      content: '# Second\n',
      size: 9,
      language: 'markdown',
    },
    draft: '# Second\n',
    workspacePath: '/tmp/sciforge',
  };
  const tabs = [
    { id: 'base:files', kind: 'files' as const, label: 'Files', closable: true },
    { id: 'custom:files:2', kind: 'files' as const, label: 'Files 2', closable: true },
  ];

  assert.equal(workspaceFileEditorIsDirty(first), true);
  assert.equal(workspaceFileEditorIsDirty(second), false);
  assert.deepEqual(planWorkspaceFileTabOpen({
    tabs,
    editorsByTabId: { 'base:files': first },
    activeTabId: 'base:files',
    workspaceRoot: '/tmp/sciforge',
    nextEditor: first,
  }), { action: 'focus-existing', tabId: 'base:files' });
  assert.deepEqual(planWorkspaceFileTabOpen({
    tabs,
    editorsByTabId: { 'base:files': first },
    activeTabId: 'base:files',
    workspaceRoot: '/tmp/sciforge',
    nextEditor: second,
  }), { action: 'reuse-active', tabId: 'custom:files:2' });
  assert.deepEqual(planWorkspaceFileTabOpen({
    tabs: [tabs[0]!],
    editorsByTabId: { 'base:files': first },
    activeTabId: 'base:files',
    workspaceRoot: '/tmp/sciforge',
    nextEditor: second,
  }), { action: 'open-new' });
  assert.deepEqual(planWorkspaceFileTabOpen({
    tabs: [tabs[0]!],
    editorsByTabId: { 'base:files': second },
    activeTabId: 'base:files',
    workspaceRoot: '/tmp/sciforge',
    nextEditor: first,
  }), { action: 'reuse-active', tabId: 'base:files' });
});

test('files pane model projects binary and too-large files as typed read-only states', () => {
  const binary = workspaceFileWithInlinePolicy({
    path: '/tmp/sciforge/plot.png',
    name: 'plot.png',
    content: 'iVBORw0KGgo=',
    size: 12,
    encoding: 'base64',
    language: 'binary',
    mimeType: 'image/png',
  });
  assert.equal(workspaceFileEditorUnsupportedKind(binary), 'binary');
  assert.equal(workspaceFileEditorCanEditFile(binary), false);
  assert.equal(binary.content, '');
  assert.equal(binary.readOnly, true);

  const tooLarge = tooLargeWorkspaceFileFromEntry({
    path: '/tmp/sciforge/data/full.csv',
    name: 'full.csv',
    kind: 'file',
    size: 2 * 1024 * 1024,
  });
  assert.ok(tooLarge);
  assert.equal(tooLarge.unsupportedKind, 'too-large');
  assert.equal(tooLarge.contentUnavailable, true);
  assert.equal(workspaceFileEditorCanEditFile(tooLarge), false);
});
