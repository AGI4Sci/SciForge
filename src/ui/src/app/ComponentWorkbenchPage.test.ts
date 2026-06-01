import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentWorkbenchPage, type AutomationRecord } from './ComponentWorkbenchPage';

const automationFixture: AutomationRecord[] = [{
  schemaVersion: 1,
  id: 'nightly-literature-scan',
  ref: 'automation:nightly-literature-scan',
  name: 'Nightly literature scan',
  author: 'SciForge',
  enabled: true,
  status: 'successful',
  repositoryRef: 'workspace:current',
  repositoryLabel: 'Workspace',
  trigger: { type: 'schedule', label: 'Daily', schedule: 'Daily' },
  instructions: 'Summarize new papers.',
  tools: ['Search', 'Report'],
  created: 'May 28',
  createdAt: '2026-05-28T00:00:00.000Z',
  updatedAt: '2026-05-29T00:00:00.000Z',
  runs: [{
    id: 'run-1',
    status: 'successful',
    startedAt: '2026-05-29T00:00:00.000Z',
    completedAt: '2026-05-29T00:01:00.000Z',
    operationRef: 'automations:operation:run:run-1',
    summary: 'Completed',
  }],
}, {
  schemaVersion: 1,
  id: 'workspace-health',
  ref: 'automation:workspace-health',
  name: 'Workspace health check',
  author: 'SciForge',
  enabled: true,
  status: 'ready',
  repositoryRef: 'workspace:current',
  repositoryLabel: 'Workspace',
  trigger: { type: 'workspace-event', label: 'Workspace event' },
  instructions: 'Check project health.',
  tools: ['Files', 'Tests'],
  created: 'May 29',
  createdAt: '2026-05-29T00:00:00.000Z',
  updatedAt: '2026-05-30T00:00:00.000Z',
  runs: [],
}];

test('component workbench renders the automations surface from the sidebar action', () => {
  const html = renderToStaticMarkup(React.createElement(ComponentWorkbenchPage, {
    mode: 'automations',
    initialAutomations: automationFixture,
  }));

  assert.match(html, /Automations/);
  assert.match(html, /New Automation/);
  assert.match(html, /Total Automations/);
  assert.match(html, /Successful · 7d/);
  assert.match(html, /Failed · 7d/);
  assert.match(html, /Run History/);
  assert.match(html, /Mine/);
  assert.match(html, /Active/);
  assert.match(html, /Automations<\/span>/);
  assert.match(html, /Nightly literature scan/);
  assert.match(html, /Workspace health check/);
  assert.doesNotMatch(html, /\/tmp|\/Applications|Authorization|secret|token/i);
});

test('component workbench renders an empty real automation list without fixture rows', () => {
  const html = renderToStaticMarkup(React.createElement(ComponentWorkbenchPage, { mode: 'automations' }));

  assert.match(html, /No automations yet/);
  assert.doesNotMatch(html, /Nightly literature scan|Workspace health check|Feedback triage/);
});

test('component workbench renders the customize marketplace from the sidebar action', () => {
  const html = renderToStaticMarkup(React.createElement(ComponentWorkbenchPage, { mode: 'marketplace' }));

  assert.match(html, /Marketplace/);
  assert.match(html, /Search skills, rules, subagents, apps, channels, and tools/);
  assert.match(html, /Featured/);
  assert.match(html, /Infrastructure/);
  assert.match(html, /Channels/);
  assert.match(html, /All Plugins/);
  assert.match(html, /typescript-lsp/);
  assert.match(html, /playwright/);
  assert.match(html, /Feishu CLI/);
  assert.match(html, /Host-managed Feishu intake/);
  assert.match(html, /Managed/);
  assert.match(html, /workspace-file-viewer/);
  assert.match(html, /Get/);
  assert.match(html, /Installed/);
});

test('component workbench exposes channel plugins without importing provider implementations', () => {
  const source = readFileSync(new URL('./ComponentWorkbenchPage.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /@sciforge-connector\/feishu|packages\/connectors\/feishu|lark-cli|@larksuite|lark-oapi/);
});
