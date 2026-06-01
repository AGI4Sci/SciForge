import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { WorkspaceTerminalSession } from '../../api/workspaceClient';
import {
  removeRightPaneTerminalSessionForTab,
  setRightPaneTerminalSessionForTab,
} from './rightPaneTerminalController';

test('right pane terminal controller owns ResultsRenderer terminal session lifecycle wiring', () => {
  const controllerSource = readFileSync(new URL('./rightPaneTerminalController.ts', import.meta.url), 'utf8');
  const lifecycleControllerSource = readFileSync(new URL('./rightPaneLifecycleController.ts', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(controllerSource, /export function useRightPaneTerminalController/);
  assert.match(controllerSource, /stopRightPaneTerminalSessionOnce/);
  assert.match(controllerSource, /stopRightPaneTerminalSessionsOnce/);
  assert.match(controllerSource, /RIGHT_PANE_TERMINAL_TAB_CLOSE_STOP_REASON/);
  assert.match(controllerSource, /RIGHT_PANE_TERMINAL_OWNER_CLEANUP_STOP_REASON/);
  assert.match(controllerSource, /rightPaneTerminalOwnerKey/);
  assert.match(lifecycleControllerSource, /closeTerminalTab\(tabId\)/);
  assert.match(rendererSource, /from '.\/results\/rightPaneTerminalController'/);
  assert.match(rendererSource, /from '.\/results\/rightPaneLifecycleController'/);
  assert.doesNotMatch(rendererSource, /rightPaneTerminalController\.closeTerminalTab\(tabId\)/);
  assert.match(rendererSource, /onTerminalSessionChange=\{rightPaneTerminalController\.setActiveTerminalSession\}/);
  assert.doesNotMatch(rendererSource, /stopRightPaneTerminalSessionOnce/);
  assert.doesNotMatch(rendererSource, /stopRightPaneTerminalSessionsOnce/);
  assert.doesNotMatch(rendererSource, /RIGHT_PANE_TERMINAL_TAB_CLOSE_STOP_REASON/);
  assert.doesNotMatch(rendererSource, /RIGHT_PANE_TERMINAL_OWNER_CLEANUP_STOP_REASON/);
  assert.doesNotMatch(rendererSource, /terminalSessionsByTabIdRef/);
  assert.doesNotMatch(rendererSource, /stoppingTerminalSessionIdsRef/);
});

test('right pane terminal controller helpers update tab-scoped sessions without workspace execution', () => {
  const first = terminalSession('terminal-1', 'running');
  const second = terminalSession('terminal-2', 'cancelled');

  const withFirst = setRightPaneTerminalSessionForTab({}, 'terminal-tab-1', first);
  assert.deepEqual(Object.keys(withFirst), ['terminal-tab-1']);
  assert.equal(withFirst['terminal-tab-1'], first);

  const withSecond = setRightPaneTerminalSessionForTab(withFirst, 'terminal-tab-2', second);
  assert.equal(withSecond['terminal-tab-1'], first);
  assert.equal(withSecond['terminal-tab-2'], second);
  assert.notEqual(withSecond, withFirst);

  const unchanged = setRightPaneTerminalSessionForTab(withSecond, '', undefined);
  assert.equal(unchanged, withSecond);

  const removed = removeRightPaneTerminalSessionForTab(withSecond, 'terminal-tab-1');
  assert.equal(removed['terminal-tab-1'], undefined);
  assert.equal(removed['terminal-tab-2'], second);
  assert.notEqual(removed, withSecond);

  const missing = removeRightPaneTerminalSessionForTab(removed, 'missing-tab');
  assert.equal(missing, removed);
});

function terminalSession(id: string, status: WorkspaceTerminalSession['status']): WorkspaceTerminalSession {
  return {
    schemaVersion: 1,
    id,
    status,
    workspacePath: '/tmp/sciforge',
    cwd: '/tmp/sciforge',
    shell: '/bin/zsh',
    transcriptRef: `terminal-transcript:${id}`,
    startedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    webSocketPath: `/api/sciforge/terminal/sessions/${id}/ws`,
  };
}
