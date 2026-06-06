import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSidebarFooterStatus, SidebarFooterActions } from './SidebarFooterActions';

test('sidebar footer actions render status feedback and settings commands', () => {
  const html = renderToStaticMarkup(React.createElement(SidebarFooterActions, {
    workspacePath: '/Applications/workspace/SciForge',
    workspaceStatus: 'Connected',
    onFeedbackOpen: () => undefined,
    onSettingsOpen: () => undefined,
  }));

  assert.match(html, /sidebar-footer-actions/);
  assert.match(html, /role="status"/);
  assert.match(html, /data-testid="sidebar-footer-status"/);
  assert.match(html, /data-sidebar-footer-health="connected"/);
  assert.match(html, /SciForge/);
  assert.match(html, /Local runtime/);
  assert.match(html, /Connected/);
  assert.match(html, /nav-item sidebar-command/);
  assert.match(html, />Feedback</);
  assert.match(html, />Settings</);
  assert.doesNotMatch(html, /Applications|workspace\/SciForge/);
});

test('sidebar footer status redacts path and secret-like workspace labels', () => {
  const status = buildSidebarFooterStatus({
    workspacePath: '/tmp/openai-token-secret',
    workspaceStatus: 'Did not find /tmp/openai-token-secret/.sciforge/workspace-state.json',
  });

  assert.equal(status.workspaceLabel, 'Workspace');
  assert.equal(status.health, 'warning');
  assert.equal(status.statusLabel, 'Needs attention');
  assert.doesNotMatch(JSON.stringify(status), /tmp|token|secret|workspace-state/);
});

test('sidebar footer status normalizes connected syncing warning and unavailable states', () => {
  assert.equal(buildSidebarFooterStatus({ workspacePath: '/workspace/p2', workspaceStatus: 'Connected' }).health, 'connected');
  assert.equal(buildSidebarFooterStatus({ workspacePath: '/workspace/p2', workspaceStatus: 'Syncing workspace snapshot' }).health, 'syncing');
  assert.equal(buildSidebarFooterStatus({ workspacePath: '/workspace/p2', workspaceStatus: '已同步到 /workspace/p2/.sciforge' }).health, 'connected');
  assert.equal(buildSidebarFooterStatus({ workspacePath: '/workspace/p2', workspaceStatus: 'Synced to /workspace/p2/.sciforge' }).health, 'connected');
  assert.equal(buildSidebarFooterStatus({ workspacePath: '/workspace/p2', workspaceError: 'writer unavailable' }).health, 'warning');
  assert.equal(buildSidebarFooterStatus({ workspacePath: '', workspaceStatus: 'Connected' }).health, 'unavailable');
});
