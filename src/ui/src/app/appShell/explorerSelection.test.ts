import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceEntry } from '../../api/workspaceClient';
import {
  applyExplorerEntryClickSelection,
  collectVisibleExplorerEntries,
  explorerSelectedEntryFromWorkspaceEntry,
  resolveExplorerContextMenuSelection,
} from './explorerSelection';

const folderChildren: Record<string, WorkspaceEntry[]> = {
  '/w': [
    { kind: 'folder', path: '/w/a', name: 'a' },
    { kind: 'file', path: '/w/b.ts', name: 'b.ts', size: 1 },
    { kind: 'file', path: '/w/c.ts', name: 'c.ts', size: 1 },
  ],
  '/w/a': [
    { kind: 'file', path: '/w/a/x.md', name: 'x.md', size: 1 },
  ],
};

test('collectVisibleExplorerEntries walks expanded folders in display order', () => {
  const visible = collectVisibleExplorerEntries('/w', folderChildren, new Set(['/w', '/w/a']));
  assert.deepEqual(visible.map((entry) => entry.path), ['/w', '/w/a', '/w/a/x.md', '/w/b.ts', '/w/c.ts']);
});

test('shift click selects a contiguous visible range from the anchor', () => {
  const visible = collectVisibleExplorerEntries('/w', folderChildren, new Set(['/w']));
  const anchor = explorerSelectedEntryFromWorkspaceEntry(folderChildren['/w'][0]);
  const target = explorerSelectedEntryFromWorkspaceEntry(folderChildren['/w'][2]);
  const { selection } = applyExplorerEntryClickSelection({
    entry: target,
    visibleEntries: visible,
    currentSelection: [anchor],
    anchorPath: anchor.path,
    metaKey: false,
    shiftKey: true,
  });
  assert.deepEqual(selection.map((entry) => entry.path), ['/w/a', '/w/b.ts', '/w/c.ts']);
});

test('meta click toggles individual explorer entries', () => {
  const first = explorerSelectedEntryFromWorkspaceEntry(folderChildren['/w'][0]);
  const second = explorerSelectedEntryFromWorkspaceEntry(folderChildren['/w'][1]);
  const added = applyExplorerEntryClickSelection({
    entry: second,
    visibleEntries: collectVisibleExplorerEntries('/w', folderChildren, new Set(['/w'])),
    currentSelection: [first],
    anchorPath: first.path,
    metaKey: true,
    shiftKey: false,
  });
  assert.deepEqual(added.selection.map((entry) => entry.path), ['/w/a', '/w/b.ts']);

  const removed = applyExplorerEntryClickSelection({
    entry: first,
    visibleEntries: collectVisibleExplorerEntries('/w', folderChildren, new Set(['/w'])),
    currentSelection: added.selection,
    anchorPath: second.path,
    metaKey: true,
    shiftKey: false,
  });
  assert.deepEqual(removed.selection.map((entry) => entry.path), ['/w/b.ts']);
});

test('context menu keeps an existing multi selection when right clicking a selected entry', () => {
  const first = explorerSelectedEntryFromWorkspaceEntry(folderChildren['/w'][0]);
  const second = explorerSelectedEntryFromWorkspaceEntry(folderChildren['/w'][1]);
  const selection = resolveExplorerContextMenuSelection(first, [first, second]);
  assert.deepEqual(selection.map((entry) => entry.path), ['/w/a', '/w/b.ts']);
});

test('context menu replaces selection when right clicking an unselected entry', () => {
  const first = explorerSelectedEntryFromWorkspaceEntry(folderChildren['/w'][0]);
  const second = explorerSelectedEntryFromWorkspaceEntry(folderChildren['/w'][1]);
  const selection = resolveExplorerContextMenuSelection(second, [first]);
  assert.deepEqual(selection.map((entry) => entry.path), ['/w/b.ts']);
});
