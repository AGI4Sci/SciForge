import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarFooterActions } from './SidebarFooterActions';

test('sidebar footer actions render settings command', () => {
  const html = renderToStaticMarkup(React.createElement(SidebarFooterActions, {
    onSettingsOpen: () => undefined,
  }));

  assert.match(html, /sidebar-footer-actions/);
  assert.match(html, /nav-item sidebar-command/);
  assert.match(html, />设置</);
});
