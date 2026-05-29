import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarToolsStrip } from './SidebarToolsStrip';

test('sidebar tools strip renders app entry and automation placeholder', () => {
  const html = renderToStaticMarkup(React.createElement(SidebarToolsStrip, {
    onOpenComponents: () => undefined,
  }));

  assert.match(html, /aria-label="工具"/);
  assert.match(html, /sidebar-tool-item/);
  assert.match(html, />应用</);
  assert.match(html, /aria-label="自动化"/);
  assert.match(html, />自动化</);
  assert.match(html, /即将推出/);
});
