import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WorkspaceExplorerStatusPanel,
  conciseWorkspaceOnboardingReason,
} from './WorkspaceExplorerStatusPanel';

test('workspace explorer status panel renders onboarding, notice, and error states', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceExplorerStatusPanel, {
    workspacePath: '/tmp/missing-project',
    workspaceError: 'ENOENT workspace-state.json',
    workspaceStatus: 'Not found',
    workspaceNotice: 'Checking project',
    onInitializeWorkspacePath: () => undefined,
  }));

  assert.match(html, /Initialize workspace/);
  assert.match(html, /Project folder was not found/);
  assert.match(html, /Create workspace/);
  assert.match(html, /role="status"/);
  assert.match(html, /Checking project/);
  assert.match(html, /Project folder was not found|Workspace diagnostic/);
  assert.doesNotMatch(html, /\/tmp\/missing-project/);
});

test('workspace explorer status panel sanitizes upstream notice and error text', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceExplorerStatusPanel, {
    workspacePath: '/Applications/workspace/private-project',
    workspaceError: 'writer stderr token sk-workspace-secret from /Users/alice/private-project; raw JSON {"url":"https://provider.internal/v1"}',
    workspaceStatus: 'failed',
    workspaceNotice: 'checking http://127.0.0.1:6174/health?token=writer-secret for /Applications/workspace/private-project',
    onInitializeWorkspacePath: () => undefined,
  }));

  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /sk-workspace-secret|writer-secret|provider\.internal|127\.0\.0\.1:6174|Applications\/workspace|Users\/alice|raw JSON/i);
});

test('workspace explorer onboarding reason stays concise and user-facing', () => {
  assert.equal(conciseWorkspaceOnboardingReason('', '', ''), 'Choose a project folder to show files here.');
  assert.equal(conciseWorkspaceOnboardingReason('/tmp/project', 'EACCES', ''), 'SciForge cannot read this folder. Check permissions.');
  assert.equal(conciseWorkspaceOnboardingReason('/tmp/project', 'not found', ''), 'Project folder was not found.');
  assert.equal(conciseWorkspaceOnboardingReason('/tmp/project', '', ''), 'Workspace is not initialized yet.');
});
