import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarToolsStrip } from './SidebarToolsStrip';

test('sidebar tools strip renders app entry and automation placeholder', () => {
  const html = renderToStaticMarkup(React.createElement(SidebarToolsStrip, {
    onOpenComponents: () => undefined,
  }));

  assert.match(html, /aria-label="Tools"/);
  assert.match(html, /sidebar-tool-item/);
  assert.match(html, />Apps</);
  assert.match(html, /aria-label="Automations"/);
  assert.match(html, />Automations</);
  assert.match(html, />Soon</);
});
