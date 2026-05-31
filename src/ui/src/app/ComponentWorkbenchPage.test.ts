import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentWorkbenchPage } from './ComponentWorkbenchPage';

test('component workbench renders the automations surface from the sidebar action', () => {
  const html = renderToStaticMarkup(React.createElement(ComponentWorkbenchPage, { mode: 'automations' }));

  assert.match(html, /Automations/);
  assert.match(html, /New Automation/);
  assert.match(html, /Total Automations/);
  assert.match(html, /Successful · 7d/);
  assert.match(html, /Failed · 7d/);
  assert.match(html, /Run History/);
  assert.match(html, /Mine/);
  assert.match(html, /Team/);
  assert.match(html, /Automations<\/span>/);
  assert.match(html, /Nightly literature scan/);
  assert.match(html, /Workspace health check/);
});

test('component workbench renders the customize marketplace from the sidebar action', () => {
  const html = renderToStaticMarkup(React.createElement(ComponentWorkbenchPage, { mode: 'marketplace' }));

  assert.match(html, /Marketplace/);
  assert.match(html, /Search skills, rules, subagents, apps, and tools/);
  assert.match(html, /Featured/);
  assert.match(html, /Infrastructure/);
  assert.match(html, /All Plugins/);
  assert.match(html, /typescript-lsp/);
  assert.match(html, /playwright/);
  assert.match(html, /workspace-file-viewer/);
  assert.match(html, /Get/);
  assert.match(html, /Installed/);
});
