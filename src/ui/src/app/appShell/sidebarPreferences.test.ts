import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultSidebarPreferences,
  moveCurrentProjectDown,
  togglePinnedThreadId,
} from './sidebarPreferences';

test('togglePinnedThreadId adds and removes pinned thread ids', () => {
  const initial = defaultSidebarPreferences();
  const pinned = togglePinnedThreadId(initial, 'thread-a');
  assert.deepEqual(pinned.pinnedThreadIds, ['thread-a']);
  const unpinned = togglePinnedThreadId(pinned, 'thread-a');
  assert.deepEqual(unpinned.pinnedThreadIds, []);
});

test('moveCurrentProjectDown swaps the current project with the next project', () => {
  const prefs = defaultSidebarPreferences();
  const next = moveCurrentProjectDown(prefs, ['current', 'peer:a', 'peer:b'], 'current');
  assert.deepEqual(next.projectOrder, ['peer:a', 'current', 'peer:b']);
});
