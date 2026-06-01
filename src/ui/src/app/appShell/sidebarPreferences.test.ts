import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultSidebarPreferences,
  markThreadIdsRead,
  moveCurrentProjectDown,
  toggleSidebarVisibleSection,
  togglePinnedThreadId,
} from './sidebarPreferences';

test('togglePinnedThreadId adds and removes pinned thread ids', () => {
  const initial = defaultSidebarPreferences();
  const pinned = togglePinnedThreadId(initial, 'thread-a');
  assert.deepEqual(pinned.pinnedThreadIds, ['thread-a']);
  const unpinned = togglePinnedThreadId(pinned, 'thread-a');
  assert.deepEqual(unpinned.pinnedThreadIds, []);
});

test('markThreadIdsRead records unique read sidebar threads', () => {
  const initial = defaultSidebarPreferences();
  const marked = markThreadIdsRead(initial, ['thread-a', 'thread-b', 'thread-a', '   ']);
  assert.deepEqual(marked.readThreadIds, ['thread-a', 'thread-b']);
  assert.equal(markThreadIdsRead(marked, ['thread-a']), marked);
});

test('moveCurrentProjectDown swaps the current project with the next project', () => {
  const prefs = defaultSidebarPreferences();
  assert.equal(prefs.projectSort, 'manual');
  const next = moveCurrentProjectDown(prefs, ['current', 'peer:a', 'peer:b'], 'current');
  assert.deepEqual(next.projectOrder, ['peer:a', 'current', 'peer:b']);
  assert.equal(next.projectSort, 'manual');
});

test('toggleSidebarVisibleSection changes Cursor-like sidebar filter switches', () => {
  const prefs = defaultSidebarPreferences();
  const withoutSource = toggleSidebarVisibleSection(prefs, 'source');
  assert.equal(withoutSource.visibleSections.source, false);
  assert.equal(withoutSource.visibleSections.status, true);
  const restored = toggleSidebarVisibleSection(withoutSource, 'source');
  assert.equal(restored.visibleSections.source, true);
});
