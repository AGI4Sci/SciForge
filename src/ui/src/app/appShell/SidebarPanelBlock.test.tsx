import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarPanelBlock, SidebarPanelToggleButton } from './SidebarPanelBlock';

test('sidebar panel block renders expanded content and toggle state', () => {
  const html = renderToStaticMarkup(React.createElement(SidebarPanelBlock, {
    title: '工具',
    collapsed: false,
    toggleLabel: { collapsed: '展开工具区', expanded: '折叠工具区' },
    onToggle: () => undefined,
    children: React.createElement('span', null, 'panel-body'),
  }));

  assert.match(html, /sidebar-panel-block/);
  assert.match(html, />工具</);
  assert.match(html, /aria-label="折叠工具区"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /panel-body/);
});

test('sidebar panel block hides collapsed content and supports header extras', () => {
  const html = renderToStaticMarkup(React.createElement(SidebarPanelBlock, {
    title: '项目',
    collapsed: true,
    className: 'sidebar-panel-block-explorer',
    headerExtra: React.createElement(SidebarPanelToggleButton, {
      collapsed: true,
      toggleLabel: { collapsed: '展开项目区', expanded: '折叠项目区' },
      onToggle: () => undefined,
    }),
    toggleLabel: { collapsed: '展开项目区', expanded: '折叠项目区' },
    onToggle: () => undefined,
    children: React.createElement('span', null, 'hidden-body'),
  }));

  assert.match(html, /sidebar-panel-block-explorer/);
  assert.match(html, /is-collapsed/);
  assert.match(html, /sidebar-panel-block-head-actions/);
  assert.match(html, /aria-label="展开项目区"/);
  assert.doesNotMatch(html, /hidden-body/);
});
