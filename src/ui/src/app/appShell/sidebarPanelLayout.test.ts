import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampSidebarPanelHeights,
  defaultSidebarPanelLayout,
  SIDEBAR_PANEL_DEFAULT_THREADS,
  SIDEBAR_PANEL_DEFAULT_TOOLS,
  SIDEBAR_PANEL_MIN_EXPLORER,
  SIDEBAR_PANEL_RESIZE_HANDLE,
} from './sidebarPanelLayout';

test('clampSidebarPanelHeights keeps explorer minimum space when panel body is short', () => {
  const layout = defaultSidebarPanelLayout();
  const available = SIDEBAR_PANEL_DEFAULT_THREADS + SIDEBAR_PANEL_DEFAULT_TOOLS + SIDEBAR_PANEL_MIN_EXPLORER + SIDEBAR_PANEL_RESIZE_HANDLE * 2 - 80;
  const next = clampSidebarPanelHeights(layout, available);
  assert.ok(next.threadsHeight <= layout.threadsHeight);
  assert.ok(next.toolsHeight <= layout.toolsHeight);
  assert.ok(next.threadsHeight + next.toolsHeight + SIDEBAR_PANEL_MIN_EXPLORER + SIDEBAR_PANEL_RESIZE_HANDLE * 2 <= available + 1);
});
