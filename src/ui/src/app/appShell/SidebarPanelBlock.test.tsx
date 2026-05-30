import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarPanelBlock, SidebarPanelToggleButton } from './SidebarPanelBlock';

test('sidebar panel block renders expanded content and toggle state', () => {
  const html = renderToStaticMarkup(React.createElement(SidebarPanelBlock, {
    title: 'Tools',
    collapsed: false,
    toggleLabel: { collapsed: 'Expand tools', expanded: 'Collapse tools' },
    onToggle: () => undefined,
    children: React.createElement('span', null, 'panel-body'),
  }));

  assert.match(html, /sidebar-panel-block/);
  assert.match(html, />Tools</);
  assert.match(html, /aria-label="Collapse tools"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /panel-body/);
});

test('sidebar panel block hides collapsed content and supports header extras', () => {
  const html = renderToStaticMarkup(React.createElement(SidebarPanelBlock, {
    title: 'Files',
    collapsed: true,
    className: 'sidebar-panel-block-explorer',
    headerExtra: React.createElement(SidebarPanelToggleButton, {
      collapsed: true,
      toggleLabel: { collapsed: 'Expand files', expanded: 'Collapse files' },
      onToggle: () => undefined,
    }),
    toggleLabel: { collapsed: 'Expand files', expanded: 'Collapse files' },
    onToggle: () => undefined,
    children: React.createElement('span', null, 'hidden-body'),
  }));

  assert.match(html, /sidebar-panel-block-explorer/);
  assert.match(html, /is-collapsed/);
  assert.match(html, /sidebar-panel-block-head-actions/);
  assert.match(html, /aria-label="Expand files"/);
  assert.doesNotMatch(html, /hidden-body/);
});
