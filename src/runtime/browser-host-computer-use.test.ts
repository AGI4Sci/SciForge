import assert from 'node:assert/strict';
import test from 'node:test';

import {
  browserHostComputerUseActionReadiness,
  executeBrowserHostComputerUseAction,
  type BrowserHostComputerUseActionReadiness,
  type BrowserHostComputerUseReadinessReason,
} from './browser-host-computer-use.js';
import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
  type BrowserHostSessionManager,
  type BrowserHostSessionState,
} from './browser-host-session.js';

test('BrowserHostSession Computer Use L0 handler returns refs-first action evidence and freshness invalidation', async () => {
  const before = browserHostSession({
    frameRef: 'browser-host-session:live-browser/frame-before.png',
    screenshotRef: 'browser-host-session:live-browser/screenshot-before.png',
  });
  const after = browserHostSession({
    frameRef: 'browser-host-session:live-browser/frame-after.png',
    screenshotRef: 'browser-host-session:live-browser/screenshot-after.png',
    visibleAction: {
      actionId: 'agent-click-save',
      action: 'click',
      riskType: 'click',
      visibleActionRef: 'browser-host-session:live-browser/visible-actions/agent-click-save.json',
    },
  });
  const calls: Array<{ workspacePath: string; sessionId: string; action: string }> = [];
  const manager = {
    async sessionState() {
      return before;
    },
    async act(workspacePath: string, sessionId: string, input: { action: string }) {
      calls.push({ workspacePath, sessionId, action: input.action });
      return after;
    },
  } as unknown as BrowserHostSessionManager;

  const result = await executeBrowserHostComputerUseAction(
    manager,
    '/workspace',
    'live-browser',
    {
      type: 'click',
      x: 48,
      y: 96,
      targetDescription: 'Save button',
      displayGroupId: 'display-group-browser',
      screenId: 'screen-browser',
      windowId: 'browser-window-live',
      beforeEvidenceRefs: ['observation:browser/before-state.json'],
      groundingRefs: ['grounding:browser/save-button.json'],
      verificationRefs: ['verification:browser/save-button-clicked.json'],
      leaseScope: {
        kind: 'window-local',
        displayGroupId: 'display-group-browser',
        screenId: 'screen-browser',
        windowId: 'browser-window-live',
      },
    },
    {
      actionId: 'agent-click-save',
      permissionRef: 'permission:browser-host/low-risk-input',
      cancelRef: 'control:browser-host/live-browser/stop',
      now: '2026-06-06T00:00:02.000Z',
    },
  );

  assert.deepEqual(calls, [{ workspacePath: '/workspace', sessionId: 'live-browser', action: 'click' }]);
  assert.deepEqual(result.beforeEvidenceRefs, [
    'observation:browser/before-state.json',
    'browser-host-session:live-browser/session.json',
    'browser-host-session:live-browser/live-surface',
    'browser-host-session:live-browser/frame-before.png',
    'browser-host-session:live-browser/screenshot-before.png',
  ]);
  assert.deepEqual(result.groundingRefs, ['grounding:browser/save-button.json']);
  assert.equal(result.executorEventRef, 'browser-host-session:live-browser/visible-actions/agent-click-save.json');
  assert.deepEqual(result.afterEvidenceRefs, [
    'browser-host-session:live-browser/session.json',
    'browser-host-session:live-browser/live-surface',
    'browser-host-session:live-browser/frame-after.png',
    'browser-host-session:live-browser/screenshot-after.png',
    'browser-host-session:live-browser/visible-actions/agent-click-save.json',
  ]);
  assert.deepEqual(result.verificationRefs, [
    'verification:browser/save-button-clicked.json',
    'browser-host-session:live-browser/visible-actions/agent-click-save.json',
    'browser-host-session:live-browser/session.json',
  ]);
  assert.equal(result.provenance.executorEventRef, result.executorEventRef);
  assert.equal(result.provenance.approvalState, 'not-required');
  assert.equal(result.freshnessInvalidation.invalidatesVisibleState, true);
  assert.equal(result.freshnessInvalidation.scope.kind, 'window-local');
  assert.equal(result.freshnessInvalidation.scope.windowId, 'browser-window-live');
  assert.ok(result.freshnessInvalidation.staleEvidenceKinds.includes('grounding'));
  assert.ok(result.freshnessInvalidation.preservedEvidenceKinds.includes('verification'));
  assert.doesNotMatch(JSON.stringify(result), /data:image|base64|<html|secret/i);
});

test('BrowserHostSession Computer Use readiness blocks missing unsafe live-action preconditions', () => {
  const ready = browserHostSession();

  assertBlockedReadiness(browserHostComputerUseActionReadiness({
    session: undefined,
    action: { type: 'click', x: 1, y: 2 },
    permissionRef: 'permission:ok',
    cancelRef: 'control:ok',
  }), 'browser-host-session-missing');
  const hiddenReadiness = browserHostComputerUseActionReadiness({
    session: { ...ready, liveSurfaceRef: undefined },
    action: { type: 'click', x: 1, y: 2 },
    permissionRef: 'permission:ok',
    cancelRef: 'control:ok',
  });
  assertBlockedReadiness(hiddenReadiness, 'browser-host-session-hidden');
  const diagnosticReadiness = browserHostComputerUseActionReadiness({
    session: { ...ready, status: 'failed' },
    action: { type: 'click', x: 1, y: 2 },
    permissionRef: 'permission:ok',
    cancelRef: 'control:ok',
  });
  assertBlockedReadiness(diagnosticReadiness, 'browser-host-session-diagnostic-only');
  const staleReadiness = browserHostComputerUseActionReadiness({
    session: { ...ready, updatedAt: '2026-06-06T00:00:00.000Z' },
    action: { type: 'click', x: 1, y: 2 },
    permissionRef: 'permission:ok',
    cancelRef: 'control:ok',
    now: '2026-06-06T00:00:06.500Z',
    maxAgeMs: 5_000,
  });
  assertBlockedReadiness(staleReadiness, 'browser-host-session-stale');
  const missingPermissionReadiness = browserHostComputerUseActionReadiness({
    session: ready,
    action: { type: 'click', x: 1, y: 2 },
    cancelRef: 'control:ok',
    now: '2026-06-06T00:00:02.000Z',
  });
  assertBlockedReadiness(missingPermissionReadiness, 'browser-host-session-permission-missing');
  const missingCancelReadiness = browserHostComputerUseActionReadiness({
    session: ready,
    action: { type: 'click', x: 1, y: 2 },
    permissionRef: 'permission:ok',
    now: '2026-06-06T00:00:02.000Z',
  });
  assertBlockedReadiness(missingCancelReadiness, 'browser-host-session-cancel-path-missing');
  assert.equal(browserHostComputerUseActionReadiness({
    session: ready,
    action: { type: 'click', x: 1, y: 2 },
    permissionRef: 'permission:ok',
    cancelRef: 'control:ok',
    now: '2026-06-06T00:00:02.000Z',
  }).status, 'ready');
});

function assertBlockedReadiness(
  readiness: BrowserHostComputerUseActionReadiness,
  reason: BrowserHostComputerUseReadinessReason,
): void {
  if (readiness.status !== 'blocked') {
    assert.fail(`expected blocked readiness, got ${readiness.status}`);
  }
  assert.equal(readiness.reason, reason);
}

function browserHostSession(overrides: Partial<BrowserHostSessionState> = {}): BrowserHostSessionState {
  return {
    schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
    id: 'live-browser',
    owner: 'host',
    providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
    status: 'ready',
    workspacePath: '/workspace',
    requestedUrl: 'https://example.org/app',
    url: 'https://example.org/app',
    startedAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:01.000Z',
    viewport: { width: 1365, height: 900 },
    canGoBack: false,
    canGoForward: false,
    liveSurfaceRef: 'browser-host-session:live-browser/live-surface',
    diagnostics: [],
    ...overrides,
  };
}
