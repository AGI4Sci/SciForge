import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ResultPaneTabInstance } from './ResultShell';
import { closeRightPaneResultTab } from './rightPaneLifecycleController';

test('right pane lifecycle controller owns cross-pane close wiring extraction from ResultsRenderer', () => {
  const controllerSource = readFileSync(new URL('./rightPaneLifecycleController.ts', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(controllerSource, /export function useRightPaneLifecycleController/);
  assert.match(controllerSource, /canCloseWorkspaceFileTab/);
  assert.match(controllerSource, /closeTerminalTab\(tabId\)/);
  assert.match(controllerSource, /cleanupClosedWorkspaceFileTab\(tabId\)/);
  assert.doesNotMatch(controllerSource, /stopRightPaneTerminalSessionOnce|window\.confirm|localStorage/);
  assert.match(rendererSource, /from '.\/results\/rightPaneLifecycleController'/);
  assert.match(rendererSource, /onCloseResultTab=\{rightPaneLifecycleController\.closeResultTab\}/);
  assert.doesNotMatch(rendererSource, /function handleCloseResultTab/);
  assert.doesNotMatch(rendererSource, /closeRightPaneTab\(tabId,\s*\{/);
  assert.doesNotMatch(rendererSource, /rightPaneTerminalController\.closeTerminalTab\(tabId\)/);
  assert.doesNotMatch(rendererSource, /cleanupClosedWorkspaceFileTab\(tabId\)/);
});

test('right pane lifecycle controller lets Files dirty veto stop Terminal and Files cleanup', () => {
  const events: string[] = [];

  closeRightPaneResultTab('base:files', {
    closeRightPaneTab: (tabId, options = {}) => {
      events.push(`request:${tabId}`);
      const canClose = options.canCloseTab?.(tabId, filesTab()) ?? true;
      events.push(`can:${canClose}`);
      if (!canClose) return;
      options.onClosingTab?.(tabId, filesTab());
      events.push('transition');
    },
    canCloseWorkspaceFileTab: () => {
      events.push('files:can-close');
      return false;
    },
    closeTerminalTab: () => events.push('terminal:close'),
    cleanupClosedWorkspaceFileTab: () => events.push('files:cleanup'),
  });

  assert.deepEqual(events, [
    'request:base:files',
    'files:can-close',
    'can:false',
  ]);
});

test('right pane lifecycle controller treats unknown tabs as no-op before side effects', () => {
  const events: string[] = [];

  closeRightPaneResultTab('missing-tab', {
    closeRightPaneTab: (tabId, options = {}) => {
      events.push(`request:${tabId}`);
      const canClose = options.canCloseTab?.(tabId, undefined) ?? true;
      events.push(`can:${canClose}`);
      if (!canClose) return;
      options.onClosingTab?.(tabId, undefined);
      events.push('transition');
    },
    canCloseWorkspaceFileTab: () => {
      events.push('files:can-close');
      return true;
    },
    closeTerminalTab: () => events.push('terminal:close'),
    cleanupClosedWorkspaceFileTab: () => events.push('files:cleanup'),
  });

  assert.deepEqual(events, [
    'request:missing-tab',
    'can:false',
  ]);
});

test('right pane lifecycle controller runs Terminal stop only on terminal close', () => {
  const events: string[] = [];

  closeRightPaneResultTab('base:terminal', {
    closeRightPaneTab: (tabId, options = {}) => {
      events.push(`request:${tabId}`);
      const canClose = options.canCloseTab?.(tabId, terminalTab()) ?? true;
      events.push(`can:${canClose}`);
      if (!canClose) return;
      options.onClosingTab?.(tabId, terminalTab());
      events.push('transition');
    },
    canCloseWorkspaceFileTab: () => {
      events.push('files:can-close');
      return true;
    },
    closeTerminalTab: (tabId) => events.push(`terminal:close:${tabId}`),
    cleanupClosedWorkspaceFileTab: (tabId) => events.push(`files:cleanup:${tabId}`),
  });

  assert.deepEqual(events, [
    'request:base:terminal',
    'can:true',
    'terminal:close:base:terminal',
    'transition',
  ]);
});

test('right pane lifecycle controller keeps Terminal stop and Files cleanup pane-scoped', () => {
  const events: string[] = [];

  closeRightPaneResultTab('base:files', {
    closeRightPaneTab: (tabId, options = {}) => {
      events.push(`request:${tabId}`);
      const canClose = options.canCloseTab?.(tabId, filesTab()) ?? true;
      events.push(`can:${canClose}`);
      if (!canClose) return;
      options.onClosingTab?.(tabId, filesTab());
      events.push('transition');
    },
    canCloseWorkspaceFileTab: () => {
      events.push('files:can-close');
      return true;
    },
    closeTerminalTab: (tabId) => events.push(`terminal:close:${tabId}`),
    cleanupClosedWorkspaceFileTab: (tabId) => events.push(`files:cleanup:${tabId}`),
  });

  assert.deepEqual(events, [
    'request:base:files',
    'files:can-close',
    'can:true',
    'files:cleanup:base:files',
    'transition',
  ]);
});

function filesTab(): ResultPaneTabInstance {
  return { id: 'base:files', kind: 'files', label: 'Files', closable: true };
}

function terminalTab(): ResultPaneTabInstance {
  return { id: 'base:terminal', kind: 'terminal', label: 'Terminal', closable: true };
}
