import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';

import {
  BROWSER_HOST_LOADING_PROGRESS_SCHEMA,
  BROWSER_HOST_SEARCH_SCHEMA,
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
  BrowserHostSessionManager,
  browserHostNavigationCommittedAfterTimeout,
  browserHostSearchSummary,
  browserHostSearchUrl,
  browserHostSessionDir,
  createNativeEmbeddedBrowserHostDriverFactory,
  normalizeBrowserHostUrl,
  type BrowserHostFrameCaptureResult,
  type BrowserHostMouseButton,
  type BrowserHostOpenReadInput,
  type BrowserHostOpenReadOutput,
  type BrowserHostSearchInput,
  type BrowserHostSearchOutput,
  type BrowserHostSessionDriver,
  type BrowserHostSessionDriverFactory,
  type BrowserHostSessionLoadingProgressReason,
  type BrowserHostSessionLoadingProgressSource,
  type BrowserHostSessionLoadingProgressState,
  type BrowserHostSessionState,
} from './browser-host-session.js';
import {
  BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
  browserHostComputerUseActionReadiness,
  browserHostActionFromComputerUse,
  executeBrowserHostComputerUseAction,
} from './browser-host-computer-use.js';
import {
  BROWSER_HOST_FRAME_STREAM_SCHEMA,
  handleBrowserHostSessionRoutes,
  handleBrowserHostSessionUpgrade,
} from './workspace-server-browser-host.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

test('BrowserHostSessionManager captures refs-first frame, DOM, AX, and redacted logs with a host-owned driver', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-'));
  const { factory, drivers } = fakeDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });

    const session = await manager.openSession(workspacePath, {
      url: 'example.org/start',
      sessionId: 'Session A',
      width: 400,
      height: 300,
    });

    assert.equal(session.id, 'session-a');
    assert.equal(session.owner, 'host');
    assert.equal(session.providerId, BROWSER_HOST_SESSION_PROVIDER_ID);
    assert.equal(session.schemaVersion, BROWSER_HOST_SESSION_SCHEMA);
    assert.equal(session.status, 'ready');
    assert.equal(session.url, 'https://example.org/start');
    assert.deepEqual(session.viewport, { width: 640, height: 480 });
    assert.equal(session.loadingProgress?.schemaVersion, BROWSER_HOST_LOADING_PROGRESS_SCHEMA);
    assert.equal(session.loadingProgress?.state, 'network-quiet');
    assert.equal(session.loadingProgress?.reason, 'host-ready');
    assert.equal(session.loadingProgress?.source, 'host-session');
    assert.equal(session.loadingProgress?.status, 'ready');
    assert.equal(session.loadingProgress?.action, 'open');
    assert.equal(session.loadingProgress?.refs.session, 'browser-host-session:session-a/session.json');
    assert.equal(session.liveSurfaceTransport, undefined);
    assert.equal(session.frameStreamRef, undefined);
    assert.equal(session.frameRef, undefined);
    assert.match(session.screenshotRef ?? '', /^browser-host-session:session-a\/screenshot-/);
    assert.match(session.domSnapshotRef ?? '', /^browser-host-session:session-a\/dom-/);
    assert.match(session.axSnapshotRef ?? '', /^browser-host-session:session-a\/ax-/);
    assert.match(session.consoleLogRef ?? '', /^browser-host-session:session-a\/console-/);
    assert.match(session.networkLogRef ?? '', /^browser-host-session:session-a\/network-/);
    assert.equal(session.lastActionTiming?.action, 'open');
    assert.equal(session.lastActionTiming?.capture, 'full');
    assert.equal(session.lastActionTiming?.status, 'ok');
    assert.ok((session.lastActionTiming?.totalMs ?? -1) >= 0);
    assert.equal(session.lastActionTiming?.paintAckSource, 'none');
    assert.ok(session.actionTimingSummary?.some((row) => row.action === 'open' && row.count === 1));

    const framePath = await manager.framePath(workspacePath, 'session-a');
    assert.ok(framePath?.endsWith('/frame.png'));
    assert.ok(framePath);
    assert.deepEqual(await readFile(framePath), PNG_1X1);

    const sessionDir = browserHostSessionDir(workspacePath, 'session-a');
    const manifest = JSON.parse(await readFile(join(sessionDir, 'session.json'), 'utf8')) as BrowserHostSessionState;
    assert.equal(manifest.url, 'https://example.org/start');
    assert.equal(manifest.loadingProgress?.state, 'network-quiet');
    assert.equal(manifest.liveSurfaceTransport, undefined);
    assert.equal(manifest.frameStreamRef, undefined);
    assert.equal(manifest.frameRef, undefined);
    assert.equal(manifest.loadingProgress?.refs.frameStream, undefined);
    assert.equal(manifest.loadingProgress?.refs.frame, undefined);
    assert.doesNotMatch(JSON.stringify(manifest), /base64|data:image/i);

    const consoleLog = await readRefFile(sessionDir, session.consoleLogRef);
    const networkLog = await readRefFile(sessionDir, session.networkLogRef);
    assert.match(consoleLog, /\[redacted\]/);
    assert.doesNotMatch(consoleLog, /secret-value/);
    assert.match(networkLog, /\[redacted\]/);
    assert.doesNotMatch(networkLog, /Bearer secret/);

    await manager.act(workspacePath, 'session-a', { action: 'navigate', url: 'localhost:5173/app' });
    const navigated = await manager.sessionState(workspacePath, 'session-a');
    assert.equal(navigated?.url, 'http://localhost:5173/app');
    assert.equal(navigated?.loadingProgress?.state, 'network-quiet');
    assert.equal(navigated?.loadingProgress?.reason, 'host-ready');
    assert.equal(navigated?.loadingProgress?.source, 'host-session');
    assert.equal(navigated?.loadingProgress?.action, 'navigate');
    assert.equal(drivers[0]?.actions.includes('goto:http://localhost:5173/app'), true);
    const heavyCaptureCountBeforeInput = {
      content: drivers[0]?.contentCalls,
      ax: drivers[0]?.axSnapshotCalls,
      screenshotRef: navigated?.screenshotRef,
      domSnapshotRef: navigated?.domSnapshotRef,
      axSnapshotRef: navigated?.axSnapshotRef,
      consoleLogRef: navigated?.consoleLogRef,
      networkLogRef: navigated?.networkLogRef,
    };

    const timedClick = await manager.act(workspacePath, 'session-a', {
      action: 'click',
      x: 10,
      y: 20,
      actionId: 'ui-click-1',
      uiEventReceivedAt: '2026-06-02T00:00:00.000Z',
      adapterSentAt: '2026-06-02T00:00:00.010Z',
    });
    assert.equal(timedClick.lastActionTiming?.actionId, 'ui-click-1');
    assert.equal(timedClick.lastActionTiming?.action, 'click');
    assert.equal(timedClick.lastActionTiming?.uiEventReceivedAt, '2026-06-02T00:00:00.000Z');
    assert.equal(timedClick.lastActionTiming?.adapterSentAt, '2026-06-02T00:00:00.010Z');
    assert.ok(timedClick.actionTimingSummary?.some((row) => row.action === 'click' && row.p95Ms >= row.p50Ms));
    await manager.act(workspacePath, 'session-a', { action: 'double-click', x: 11, y: 21 });
    await manager.act(workspacePath, 'session-a', { action: 'mouse-down', x: 30, y: 40, button: 'left' });
    await manager.act(workspacePath, 'session-a', { action: 'mouse-move', x: 35, y: 45 });
    await manager.act(workspacePath, 'session-a', { action: 'mouse-up', x: 50, y: 60, button: 'left' });
    await manager.act(workspacePath, 'session-a', { action: 'drag', path: [{ x: 70, y: 80 }, { x: 90, y: 100 }, { x: 110, y: 120 }], button: 'left' });
    await manager.act(workspacePath, 'session-a', { action: 'type', text: 'hello' });
    await manager.act(workspacePath, 'session-a', { action: 'type', text: ' ' });
    await manager.act(workspacePath, 'session-a', { action: 'press', key: 'Enter' });
    await manager.act(workspacePath, 'session-a', { action: 'scroll', x: 300, y: 420, deltaY: 240 });
    const cursorState = await manager.act(workspacePath, 'session-a', { action: 'cursor', x: 12, y: 24 });
    assert.equal(cursorState.cursor, 'pointer');
    assert.deepEqual(drivers[0]?.actions.slice(-14), [
      'click:10,20',
      'double-click:11,21',
      'mouse-down:left:30,40',
      'mouse-move:35,45',
      'mouse-up:left:50,60',
      'mouse-down:left:70,80',
      'mouse-move:90,100',
      'mouse-move:110,120',
      'mouse-up:left:110,120',
      'type:hello',
      'type: ',
      'press:Enter',
      'scroll:0,240@300,420',
      'cursor:12,24',
    ]);
    const afterInput = await manager.sessionState(workspacePath, 'session-a');
    assert.equal(drivers[0]?.contentCalls, heavyCaptureCountBeforeInput.content);
    assert.equal(drivers[0]?.axSnapshotCalls, heavyCaptureCountBeforeInput.ax);
    assert.equal(afterInput?.screenshotRef, heavyCaptureCountBeforeInput.screenshotRef);
    assert.equal(afterInput?.domSnapshotRef, heavyCaptureCountBeforeInput.domSnapshotRef);
    assert.equal(afterInput?.axSnapshotRef, heavyCaptureCountBeforeInput.axSnapshotRef);
    assert.equal(afterInput?.consoleLogRef, heavyCaptureCountBeforeInput.consoleLogRef);
    assert.equal(afterInput?.networkLogRef, heavyCaptureCountBeforeInput.networkLogRef);

    const fullCaptureType = await manager.act(workspacePath, 'session-a', { action: 'type', text: '!', capture: 'full' });
    assert.equal(fullCaptureType.lastActionTiming?.capture, 'full');
    assert.equal(fullCaptureType.lastActionTiming?.evidenceCaptureStartedAt, undefined);
    assert.equal(drivers[0]?.contentCalls, heavyCaptureCountBeforeInput.content);
    assert.equal(drivers[0]?.axSnapshotCalls, heavyCaptureCountBeforeInput.ax);
    await waitFor(() => drivers[0]?.contentCalls === (heavyCaptureCountBeforeInput.content ?? 0) + 1);
    await waitFor(() => drivers[0]?.axSnapshotCalls === (heavyCaptureCountBeforeInput.ax ?? 0) + 1);

    const closed = await manager.act(workspacePath, 'session-a', { action: 'close' });
    assert.equal(closed.status, 'closed');
    assert.equal(drivers[0]?.closed, true);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSessionManager gives drivers an ignored workspace browser profile without exposing it publicly', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-profile-'));
  const { factory, createInputs } = fakeDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });

    const session = await manager.openSession(workspacePath, {
      url: 'https://profile.example/start',
      sessionId: 'profile-session',
    });

    const expectedProfileDir = join(workspacePath, '.sciforge', 'browser-host', 'profile');
    assert.equal(createInputs[0]?.workspaceProfileDir, expectedProfileDir);
    assert.equal(createInputs[0]?.workspacePath, workspacePath);
    assert.equal((await stat(expectedProfileDir)).isDirectory(), true);

    const sessionDir = browserHostSessionDir(workspacePath, 'profile-session');
    const manifest = await readFile(join(sessionDir, 'session.json'), 'utf8');
    assert.doesNotMatch(manifest, /browser-host\/profile/);
    assert.doesNotMatch(JSON.stringify(session), /browser-host\/profile/);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession publishes bounded visible action and risk ledger without raw URL or text', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-visible-action-'));
  const { factory } = fakeDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'https://visible.example/start?token=secret-value',
      sessionId: 'visible-action-session',
    });

    assert.equal(opened.visibleAction?.action, 'open');
    assert.equal(opened.visibleAction?.riskType, 'credential');
    assert.match(opened.visibleAction?.visibleActionRef ?? '', /^browser-host-session:visible-action-session\/visible-actions\//);
    assert.equal(opened.visibleAction?.actorCursorRef, undefined);
    assert.deepEqual(opened.riskLedger?.map((entry) => [entry.action, entry.riskType]), [
      ['open', 'credential'],
    ]);

    const clicked = await manager.act(workspacePath, opened.id, {
      action: 'click',
      x: 12,
      y: 24,
      actionId: 'ui-click-visible',
      capture: 'none',
    });
    assert.deepEqual(clicked.visibleAction, {
      actionId: 'ui-click-visible',
      action: 'click',
      riskType: 'click',
      visibleActionRef: 'browser-host-session:visible-action-session/visible-actions/ui-click-visible.json',
    });

    const scrolled = await manager.act(workspacePath, opened.id, {
      action: 'scroll',
      x: 300,
      y: 420,
      deltaY: 240,
      actionId: 'ui-scroll-visible',
    });
    assert.equal(scrolled.visibleAction?.action, 'scroll');
    assert.equal(scrolled.visibleAction?.riskType, 'scroll');
    assert.equal(scrolled.visibleAction?.visibleActionRef, 'browser-host-session:visible-action-session/visible-actions/ui-scroll-visible.json');

    const typed = await manager.act(workspacePath, opened.id, {
      action: 'type',
      text: 'secret search text should never appear',
      actionId: 'ui-type-visible',
    });
    assert.equal(typed.visibleAction?.action, 'type');
    assert.equal(typed.visibleAction?.riskType, 'credential');

    const cursor = await manager.act(workspacePath, opened.id, {
      action: 'cursor',
      x: 18,
      y: 36,
      actionId: 'ui-cursor-visible',
    });
    assert.equal(cursor.visibleAction?.action, 'cursor');
    assert.equal(cursor.visibleAction?.riskType, 'click');
    assert.equal(cursor.visibleAction?.actorCursorRef, 'browser-host-session:visible-action-session/actor-cursors/ui-cursor-visible.json');
    assert.equal(cursor.visibleAction?.visibleActionRef, undefined);

    const actorClicked = await manager.act(workspacePath, opened.id, {
      action: 'click',
      x: 32,
      y: 48,
      actionId: 'agent-click-visible',
      capture: 'none',
      actorCursor: {
        agentId: 'agent-window-action',
        cursorId: 'cursor-shared-browser',
        color: '#22c55e',
        label: 'Window action',
      },
    });
    assert.deepEqual(actorClicked.actorCursor, {
      agentId: 'agent-window-action',
      cursorId: 'cursor-shared-browser',
      color: '#22c55e',
      label: 'Window action',
      status: 'acting',
      target: {
        type: 'browser-pane',
        sessionId: 'visible-action-session',
        windowRef: 'browser-host-session:visible-action-session',
      },
      lastAction: {
        action: 'click',
        status: 'completed',
        evidenceRefs: [
          'browser-host-session:visible-action-session/visible-actions/agent-click-visible.json',
          'browser-host-session:visible-action-session/actions/agent-click-visible/verification/verifier.json',
          'browser-host-session:visible-action-session/actions/agent-click-visible/freshness-invalidation.json',
        ],
      },
      evidenceRefs: [
        'browser-host-session:visible-action-session/actor-cursors/cursor-shared-browser.json',
        'browser-host-session:visible-action-session/actions/agent-click-visible/verification/verifier.json',
        'browser-host-session:visible-action-session/actions/agent-click-visible/freshness-invalidation.json',
      ],
    });
    assert.deepEqual(actorClicked.actorCursors, [actorClicked.actorCursor]);

    const navigated = await manager.act(workspacePath, opened.id, {
      action: 'navigate',
      url: 'https://payments.example/checkout?card=4111111111111111',
      actionId: 'ui-nav-visible',
      capture: 'none',
    });
    assert.equal(navigated.visibleAction?.action, 'navigate');
    assert.equal(navigated.visibleAction?.riskType, 'payment');
    const deleted = await manager.act(workspacePath, opened.id, {
      action: 'click',
      actionId: 'delete-account-submit',
      capture: 'none',
      riskType: 'destructive',
      x: 44,
      y: 60,
    });
    assert.equal(deleted.visibleAction?.riskType, 'destructive');
    assert.deepEqual(navigated.riskLedger?.slice(-6).map((entry) => [entry.action, entry.riskType]), [
      ['click', 'click'],
      ['scroll', 'scroll'],
      ['type', 'credential'],
      ['cursor', 'click'],
      ['click', 'click'],
      ['navigate', 'payment'],
    ]);
    assert.deepEqual(deleted.riskLedger?.slice(-3).map((entry) => [entry.action, entry.riskType]), [
      ['click', 'click'],
      ['navigate', 'payment'],
      ['click', 'destructive'],
    ]);

    const sessionDir = browserHostSessionDir(workspacePath, opened.id);
    const manifest = JSON.parse(await readFile(join(sessionDir, 'session.json'), 'utf8')) as BrowserHostSessionState;
    const boundedActions = JSON.stringify({
      visibleAction: manifest.visibleAction,
      riskLedger: manifest.riskLedger,
      loadingProgress: manifest.loadingProgress,
    });
    const visibleActionRefPayload = await readFile(join(sessionDir, 'visible-actions', basename(deleted.visibleAction?.visibleActionRef ?? '')), 'utf8');
    const actorCursorRefPayload = await readFile(join(sessionDir, 'actor-cursors', basename(actorClicked.actorCursor?.evidenceRefs?.[0] ?? '')), 'utf8');
    assert.doesNotMatch(`${boundedActions}\n${visibleActionRefPayload}\n${actorCursorRefPayload}`, /visible\.example|payments\.example|secret-value|secret search text|4111111111111111|<html/i);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession emits bounded refs-first loadingProgress for host navigation lifecycle', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-progress-'));
  const { factory, drivers } = fakeDriverFactory({ holdNavigation: true });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opening = manager.openSession(workspacePath, {
      url: 'https://progress.example/start?token=secret-value',
      sessionId: 'progress-session',
    });
    await waitFor(() => drivers[0]?.isHoldingAction() === true);

    const openingState = await manager.sessionState(workspacePath, 'progress-session');
    assert.equal(openingState?.status, 'loading');
    assert.equal(openingState?.loadingProgress?.state, 'navigation-start');
    assert.equal(openingState?.loadingProgress?.reason, 'navigation-requested');
    assert.equal(openingState?.loadingProgress?.source, 'host-navigation');
    assert.equal(openingState?.loadingProgress?.action, 'open');
    assert.equal(openingState?.loadingProgress?.refs.session, 'browser-host-session:progress-session/session.json');
    assert.equal(openingState?.loadingProgress?.refs.liveSurface, 'browser-host-session:progress-session/live-surface');
    assert.equal(openingState?.loadingProgress?.urls?.requested?.length, 'https://progress.example/start?token=secret-value'.length);
    assert.match(openingState?.loadingProgress?.urls?.requested?.sha1 ?? '', /^[a-f0-9]{40}$/);
    assert.equal(openingState?.loadingProgress?.urls?.final, undefined);
    assert.doesNotMatch(JSON.stringify(openingState?.loadingProgress), /progress\.example|secret-value|<html|Ready/);

    drivers[0]?.releaseHeldAction();
    const opened = await opening;
    assert.equal(opened.status, 'ready');
    assert.equal(opened.loadingProgress?.state, 'network-quiet');
    assert.equal(opened.loadingProgress?.reason, 'host-ready');
    assert.equal(opened.loadingProgress?.source, 'host-session');
    assert.equal(opened.loadingProgress?.action, 'open');
    assert.equal(opened.loadingProgress?.refs.frame, opened.frameRef);
    assert.deepEqual(opened.loadingProgress?.urls?.final, opened.loadingProgress?.urls?.current);
    assert.match(opened.loadingProgress?.urls?.current?.sha1 ?? '', /^[a-f0-9]{40}$/);

    drivers[0]?.holdNextNavigation();
    const navigating = manager.act(workspacePath, opened.id, {
      action: 'navigate',
      url: 'https://progress.example/next?token=secret-value',
    });
    await waitFor(() => drivers[0]?.isHoldingAction() === true);

    const navigatingState = await manager.sessionState(workspacePath, opened.id);
    assert.equal(navigatingState?.status, 'loading');
    assert.equal(navigatingState?.loadingProgress?.state, 'navigation-start');
    assert.equal(navigatingState?.loadingProgress?.reason, 'navigation-requested');
    assert.equal(navigatingState?.loadingProgress?.source, 'host-navigation');
    assert.equal(navigatingState?.loadingProgress?.action, 'navigate');
    assert.equal(navigatingState?.loadingProgress?.urls?.requested?.length, 'https://progress.example/next?token=secret-value'.length);
    assert.equal(navigatingState?.loadingProgress?.urls?.final, undefined);
    assert.doesNotMatch(JSON.stringify(navigatingState?.loadingProgress), /progress\.example|secret-value|<html|Ready/);

    drivers[0]?.emitNavigationProgress({
      state: 'navigation-committed',
      reason: 'navigation-committed',
      source: 'host-lifecycle',
    });
    await waitFor(() => drivers[0]?.lastProgressState === 'navigation-committed');
    const committedState = await manager.sessionState(workspacePath, opened.id);
    assert.equal(committedState?.status, 'loading');
    assert.equal(committedState?.loadingProgress?.state, 'navigation-committed');
    assert.equal(committedState?.loadingProgress?.reason, 'navigation-committed');
    assert.equal(committedState?.loadingProgress?.source, 'host-lifecycle');
    assert.equal(committedState?.loadingProgress?.action, 'navigate');
    assert.doesNotMatch(JSON.stringify(committedState?.loadingProgress), /progress\.example|secret-value|<html|Ready/);

    drivers[0]?.emitNavigationProgress({
      state: 'interactive',
      reason: 'page-interactive',
      source: 'host-lifecycle',
    });
    const interactiveState = await manager.sessionState(workspacePath, opened.id);
    assert.equal(interactiveState?.status, 'loading');
    assert.equal(interactiveState?.loadingProgress?.state, 'interactive');
    assert.equal(interactiveState?.loadingProgress?.reason, 'page-interactive');

    drivers[0]?.emitNavigationProgress({
      state: 'load',
      reason: 'page-load',
      source: 'host-lifecycle',
    });
    const loadState = await manager.sessionState(workspacePath, opened.id);
    assert.equal(loadState?.status, 'loading');
    assert.equal(loadState?.loadingProgress?.state, 'load');
    assert.equal(loadState?.loadingProgress?.reason, 'page-load');

    drivers[0]?.emitNavigationProgress({
      state: 'stalled',
      reason: 'navigation-stalled',
      source: 'host-progress',
      canRetry: true,
    });
    const stalledState = await manager.sessionState(workspacePath, opened.id);
    assert.equal(stalledState?.status, 'loading');
    assert.equal(stalledState?.loadingProgress?.state, 'stalled');
    assert.equal(stalledState?.loadingProgress?.reason, 'navigation-stalled');
    assert.equal(stalledState?.loadingProgress?.canRetry, true);
    assert.equal(stalledState?.loadingProgress?.urls?.final, undefined);
    assert.doesNotMatch(JSON.stringify(stalledState?.loadingProgress), /progress\.example|secret-value|<html|Ready/);

    drivers[0]?.releaseHeldAction();
    const navigated = await navigating;
    assert.equal(navigated.status, 'ready');
    assert.equal(navigated.loadingProgress?.state, 'stalled');
    assert.equal(navigated.loadingProgress?.reason, 'navigation-stalled');
    assert.equal(navigated.loadingProgress?.source, 'host-progress');
    assert.equal(navigated.loadingProgress?.action, 'navigate');
    assert.equal(navigated.loadingProgress?.status, 'ready');
    assert.deepEqual(navigated.loadingProgress?.urls?.final, navigated.loadingProgress?.urls?.current);

    drivers[0]?.emitNavigationProgress({
      state: 'network-quiet',
      reason: 'network-quiet',
      source: 'host-progress',
    });
    const settled = await manager.act(workspacePath, opened.id, { action: 'state' });
    assert.equal(settled.status, 'ready');
    assert.equal(settled.loadingProgress?.state, 'network-quiet');
    assert.equal(settled.loadingProgress?.reason, 'network-quiet');
    assert.equal(settled.loadingProgress?.source, 'host-progress');
    assert.deepEqual(settled.loadingProgress?.urls?.final, settled.loadingProgress?.urls?.current);

    for (const action of ['back', 'forward', 'reload'] as const) {
      const state = await manager.act(workspacePath, opened.id, { action });
      assert.equal(state.loadingProgress?.state, 'network-quiet');
      assert.equal(state.loadingProgress?.reason, 'host-ready');
      assert.equal(state.loadingProgress?.source, 'host-session');
      assert.equal(state.loadingProgress?.action, action);
    }
    const stopped = await manager.act(workspacePath, opened.id, { action: 'stop' });
    assert.equal(stopped.status, 'ready');
    assert.equal(stopped.loadingProgress?.state, 'network-quiet');
    assert.equal(stopped.loadingProgress?.reason, 'host-ready');
    assert.equal(stopped.loadingProgress?.source, 'host-session');
    assert.equal(stopped.loadingProgress?.action, 'stop');
    assert.deepEqual(stopped.loadingProgress?.urls?.final, stopped.loadingProgress?.urls?.current);
    assert.doesNotMatch(JSON.stringify(stopped.loadingProgress), /progress\.example|secret-value|<html|Ready/);
  } finally {
    drivers[0]?.releaseHeldAction();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession completes committed navigation when network quiet stalls', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-committed-stall-'));
  const { factory, drivers } = fakeDriverFactory({ holdNavigation: true, failScreenshots: true });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opening = manager.openSession(workspacePath, {
      url: 'https://progress.example/slow?token=secret-value',
      sessionId: 'committed-stall-session',
    });
    await waitFor(() => drivers[0]?.isHoldingAction() === true);

    drivers[0]?.emitNavigationProgress({
      state: 'navigation-committed',
      reason: 'navigation-committed',
      source: 'host-lifecycle',
    });
    drivers[0]?.emitNavigationProgress({
      state: 'interactive',
      reason: 'page-interactive',
      source: 'host-lifecycle',
    });
    drivers[0]?.emitNavigationProgress({
      state: 'stalled',
      reason: 'navigation-stalled',
      source: 'host-progress',
      canRetry: true,
    });
    drivers[0]?.releaseHeldAction();

    const opened = await opening;
    assert.equal(opened.status, 'ready');
    assert.equal(opened.url, 'https://progress.example/slow?token=secret-value');
    assert.equal(opened.loadingProgress?.state, 'stalled');
    assert.equal(opened.loadingProgress?.reason, 'navigation-stalled');
    assert.equal(opened.loadingProgress?.source, 'host-progress');
    assert.equal(opened.loadingProgress?.status, 'ready');
    assert.equal(opened.loadingProgress?.canRetry, true);
    assert.deepEqual(opened.loadingProgress?.urls?.final, opened.loadingProgress?.urls?.current);
    assert.doesNotMatch(JSON.stringify(opened.loadingProgress), /progress\.example|secret-value|<html|Ready/);
    assert.match(opened.diagnostics.join('\n'), /BrowserHostSession screenshot capture placeholder/);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession loadingProgress failure state is bounded and does not carry raw URL or DOM details', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-progress-failed-'));
  const { factory } = fakeDriverFactory({ failNavigation: true });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const failed = await manager.openSession(workspacePath, {
      url: 'https://secret.example/fail?token=secret-value',
      sessionId: 'failed-progress-session',
    });

    assert.equal(failed.status, 'failed');
    assert.equal(failed.loadingProgress?.state, 'blocked');
    assert.equal(failed.loadingProgress?.reason, 'host-error');
    assert.equal(failed.loadingProgress?.source, 'host-error');
    assert.equal(failed.loadingProgress?.action, 'open');
    assert.equal(failed.loadingProgress?.blocked, true);
    assert.equal(failed.loadingProgress?.canRetry, true);
    assert.doesNotMatch(JSON.stringify(failed.loadingProgress), /secret\.example|secret-value|<html|secret DOM|Bearer/);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession keeps ready status for same-URL interactive heartbeat after non-navigation input', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-interactive-heartbeat-'));
  const { factory, drivers } = fakeDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'https://heartbeat.example/input',
      sessionId: 'interactive-heartbeat-session',
    });
    assert.equal(opened.status, 'ready');
    drivers[0]?.emitNavigationProgress({
      state: 'interactive',
      reason: 'page-interactive',
      source: 'host-lifecycle',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const state = await manager.sessionState(workspacePath, opened.id);
    assert.ok(state);
    assert.equal(state.status, 'ready');
    assert.equal(state.loadingProgress?.state, 'network-quiet');
    assert.equal(state.loadingProgress?.reason, 'host-ready');
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession stop publishes an immediate bounded control state before driver ACK', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-stop-progress-'));
  const { factory, drivers } = fakeDriverFactory({ holdStop: true });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'https://progress.example/slow?token=secret-value',
      sessionId: 'stop-progress-session',
    });

    const stopping = manager.act(workspacePath, opened.id, { action: 'stop' });
    await waitFor(() => drivers[0]?.isHoldingAction() === true);

    const stoppingState = await manager.sessionState(workspacePath, opened.id);
    assert.equal(stoppingState?.status, 'loading');
    assert.equal(stoppingState?.loadingProgress?.state, 'stalled');
    assert.equal(stoppingState?.loadingProgress?.reason, 'navigation-stalled');
    assert.equal(stoppingState?.loadingProgress?.source, 'host-action-timing');
    assert.equal(stoppingState?.loadingProgress?.action, 'stop');
    assert.equal(stoppingState?.loadingProgress?.canRetry, true);
    assert.doesNotMatch(JSON.stringify(stoppingState?.loadingProgress), /progress\.example|secret-value|<html|Ready/);

    drivers[0]?.releaseHeldAction();
    const stopped = await stopping;
    assert.equal(stopped.status, 'ready');
    assert.equal(stopped.loadingProgress?.state, 'network-quiet');
    assert.equal(stopped.loadingProgress?.action, 'stop');
  } finally {
    drivers[0]?.releaseHeldAction();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession navigation controls publish immediate bounded URL digests before driver ACK', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-control-progress-'));
  const { factory, drivers } = fakeDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'https://progress.example/controls?token=secret-value',
      sessionId: 'control-progress-session',
    });

    for (const action of ['reload', 'back', 'forward'] as const) {
      drivers[0]?.holdNextNavigation();
      const pending = manager.act(workspacePath, opened.id, { action });
      await waitFor(() => drivers[0]?.isHoldingAction() === true);

      const controlState = await manager.sessionState(workspacePath, opened.id);
      assert.equal(controlState?.status, 'loading', action);
      assert.equal(controlState?.loadingProgress?.state, 'navigation-start', action);
      assert.equal(controlState?.loadingProgress?.reason, 'navigation-requested', action);
      assert.equal(controlState?.loadingProgress?.source, 'host-navigation', action);
      assert.equal(controlState?.loadingProgress?.action, action);
      assert.equal(controlState?.loadingProgress?.urls?.requested?.length, opened.url.length, action);
      assert.equal(controlState?.loadingProgress?.urls?.current?.length, opened.url.length, action);
      assert.equal(controlState?.loadingProgress?.urls?.final, undefined, action);
      assert.match(controlState?.loadingProgress?.urls?.current?.sha1 ?? '', /^[a-f0-9]{40}$/, action);
      assert.doesNotMatch(JSON.stringify(controlState?.loadingProgress), /progress\.example|secret-value|<html|Ready/, action);

      drivers[0]?.releaseHeldAction();
      const completed = await pending;
      assert.equal(completed.status, 'ready', action);
      assert.equal(completed.loadingProgress?.action, action);
    }
  } finally {
    drivers[0]?.releaseHeldAction();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSessionManager can drive a native embedded BrowserHostSession adapter without frame-stream live fallback', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-native-'));
  const calls: Array<{ method: string; route: string; body: Record<string, unknown> }> = [];
  const evidenceBridgeResponses: Array<Record<string, unknown>> = [];
  let currentUrl = 'about:blank';
  let currentProgress: Record<string, unknown> | undefined;
  const server = createServer((req, res) => {
    void (async () => {
      const route = req.url ?? '/';
      const body = req.method === 'POST' ? await readJsonRequest(req) : {};
      calls.push({ method: req.method ?? 'GET', route, body });
      if (route === '/sessions/start') writeJsonResponse(res, { ok: true, sessionId: body.sessionId });
      else if (route.endsWith('/navigate')) {
        currentUrl = normalizeBrowserHostUrl(String(body.url ?? 'about:blank'));
        currentProgress = { state: 'network-quiet', reason: 'network-quiet', source: 'host-state' };
        writeJsonResponse(res, { ok: true, url: currentUrl, title: 'Native embedded page', canGoBack: false, canGoForward: false, loadingProgress: currentProgress });
      } else if (route.endsWith('/state')) {
        writeJsonResponse(res, { ok: true, url: currentUrl, title: 'Native embedded page', canGoBack: false, canGoForward: false, progress: currentProgress });
      } else if (route.endsWith('/screenshot')) {
        const payload = await writeNativeEvidenceResponse(route, body, 'screenshot', PNG_1X1);
        evidenceBridgeResponses.push(payload);
        writeJsonResponse(res, payload, req.method === 'POST' ? 200 : 405);
      } else if (route.endsWith('/content')) {
        const payload = await writeNativeEvidenceResponse(route, body, 'dom', '<html><body data-provider="provider-payload"><a href="https://example.org/result?token=secret-token">Result</a></body></html>');
        evidenceBridgeResponses.push(payload);
        writeJsonResponse(res, payload, req.method === 'POST' ? 200 : 405);
      } else if (route.endsWith('/text')) {
        const payload = await writeNativeEvidenceResponse(route, body, 'text', 'Native embedded page text secret-token provider-payload');
        evidenceBridgeResponses.push(payload);
        writeJsonResponse(res, payload, req.method === 'POST' ? 200 : 405);
      } else if (route.endsWith('/ax')) {
        const payload = await writeNativeEvidenceResponse(route, body, 'ax', JSON.stringify({ role: 'document', name: 'Native embedded page', text: 'AX secret-token provider-payload' }, null, 2));
        evidenceBridgeResponses.push(payload);
        writeJsonResponse(res, payload, req.method === 'POST' ? 200 : 405);
      } else if (route.includes('/search-results')) {
        writeJsonResponse(res, { ok: true, results: [{ title: 'Result', url: 'https://example.org/result', snippet: 'Native result' }] });
      } else if (route.endsWith('/actions')) {
        if (body.action === 'reload') currentProgress = { state: 'stalled', reason: 'navigation-stalled', source: 'host-state', canRetry: true };
        writeJsonResponse(res, {
          ok: true,
          url: currentUrl,
          title: 'Native embedded page',
          canGoBack: false,
          canGoForward: false,
          diagnostics: body.action === 'cursor' ? ['cursor:pointer'] : [],
          nativeOsUiProof: body.action === 'native-os-ui-proof'
            ? {
              schemaVersion: 'sciforge.browser-host-session.native-os-ui-proof.v1',
              boundedEvidenceOnly: true,
              rawDomRecorded: false,
              rawTextRecorded: false,
              rawUrlRecorded: false,
              rawTitleRecorded: false,
              rawSelectorRecorded: false,
              rawCoordsRecorded: false,
              rawPayloadRecorded: false,
              source: 'native-embedded-action-state',
              proofGroup: 'cursorCaret',
              actionId: 'focus-input-caret',
              observedProofNames: ['input-caret-visible', 'focus-blur-restore', 'keyboard-enter-owner'],
              evidenceTokens: [
                'proof:input-caret-visible:observed',
                'proof:focus-blur-restore:observed',
                'proof:keyboard-enter-owner:observed',
                'caret:active-editable:true',
                'caret:visible:true',
                'focus:blurred:true',
                'focus:restored:true',
                'native-surface:attached:true',
              ],
              diagnostics: [
                'proof:input-caret-visible:observed',
                'proof:focus-blur-restore:observed',
                'url:https://example.invalid/raw-leak',
                'dom:<html>raw leak</html>',
                'payload:secret-value',
              ],
            }
            : undefined,
          navigation: currentProgress,
        });
      } else {
        writeJsonResponse(res, { ok: false, reason: `unexpected route ${route}` }, 404);
      }
    })().catch((error) => writeJsonResponse(res, { ok: false, reason: error instanceof Error ? error.message : String(error) }, 500));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const manager = new BrowserHostSessionManager({
      driverFactory: createNativeEmbeddedBrowserHostDriverFactory(`http://127.0.0.1:${address.port}`),
    });

    const session = await manager.openSession(workspacePath, {
      url: 'example.org/native',
      sessionId: 'native-session',
    });
    const clicked = await manager.act(workspacePath, 'native-session', {
      action: 'click',
      x: 12,
      y: 24,
      capture: 'none',
    });
    const cursor = await manager.act(workspacePath, 'native-session', {
      action: 'cursor',
      x: 12,
      y: 24,
      capture: 'none',
    });
    const contentCallsBeforeProof = calls.filter((call) => call.route.endsWith('/content')).length;
    const axCallsBeforeProof = calls.filter((call) => call.route.endsWith('/ax')).length;
    const proofed = await manager.act(workspacePath, 'native-session', {
      action: 'native-os-ui-proof',
      proofGroup: 'cursorCaret',
      probe: 'focus-caret',
      expectedProofNames: ['input-caret-visible', 'focus-blur-restore', 'keyboard-enter-owner'],
      actionId: 'focus-input-caret',
      capture: 'full',
    });
    const contentCallsAfterProof = calls.filter((call) => call.route.endsWith('/content')).length;
    const axCallsAfterProof = calls.filter((call) => call.route.endsWith('/ax')).length;
    const reloaded = await manager.act(workspacePath, 'native-session', {
      action: 'reload',
      capture: 'none',
    });

    assert.equal(session.status, 'ready');
    assert.equal(session.url, 'https://example.org/native');
    assert.equal(session.liveSurfaceTransport, 'native-embedded');
    assert.equal(session.nativeAdapterUrl, `http://127.0.0.1:${address.port}`);
    assert.equal(session.singleInteractiveTruth, true);
    assert.equal(session.secondTruthSource, false);
    assert.equal(session.frameStreamRef, undefined);
    assert.match(session.liveSurfaceRef ?? '', /^browser-host-session:native-session\/live-surface$/);
    assert.equal(session.frameRef, undefined);
    assert.match(session.screenshotRef ?? '', /^browser-host-session:native-session\/screenshot-/);
    const evidenceCalls = calls.filter((call) => call.method === 'POST' && /\/(?:screenshot|content|text|ax)(?:\?|$)/.test(call.route));
    assert.ok(evidenceCalls.length >= 3);
    assert.ok(
      evidenceCalls.every((call) => call.method === 'POST' && typeof call.body.outputPath === 'string'),
      JSON.stringify(evidenceCalls),
    );
    for (const response of evidenceBridgeResponses) {
      assertNoRawNativeBridgePayload(JSON.stringify(response));
      assert.equal(Object.hasOwn(response, 'outputPath'), false);
      assert.equal(typeof response.bytesWritten, 'number');
      assert.match(String(response.sha256), /^[a-f0-9]{64}$/i);
    }
    assert.equal(clicked.liveSurfaceTransport, 'native-embedded');
    assert.equal(clicked.secondTruthSource, false);
    assert.equal(clicked.frameStreamRef, undefined);
    assert.equal(clicked.lastActionTiming?.action, 'click');
    assert.equal(clicked.lastActionTiming?.capture, 'none');
    assert.equal(clicked.lastActionTiming?.paintAckSource, 'native-adapter-action-state');
    assert.equal(proofed.lastActionTiming?.action, 'native-os-ui-proof');
    assert.equal(proofed.lastActionTiming?.capture, 'none');
    assert.equal(contentCallsAfterProof, contentCallsBeforeProof);
    assert.equal(axCallsAfterProof, axCallsBeforeProof);
    assert.equal(proofed.nativeOsUiProof?.schemaVersion, 'sciforge.browser-host-session.native-os-ui-proof.v1');
    assert.equal(proofed.nativeOsUiProof?.boundedEvidenceOnly, true);
    assert.equal(proofed.nativeOsUiProof?.rawDomRecorded, false);
    assert.equal(proofed.nativeOsUiProof?.rawTextRecorded, false);
    assert.equal(proofed.nativeOsUiProof?.rawUrlRecorded, false);
    assert.equal(proofed.nativeOsUiProof?.rawTitleRecorded, false);
    assert.equal(proofed.nativeOsUiProof?.rawSelectorRecorded, false);
    assert.equal(proofed.nativeOsUiProof?.rawCoordsRecorded, false);
    assert.equal(proofed.nativeOsUiProof?.rawPayloadRecorded, false);
    assert.deepEqual(proofed.nativeOsUiProof?.observedProofNames, ['input-caret-visible', 'focus-blur-restore']);
    assert.ok(proofed.nativeOsUiProof?.evidenceTokens.includes('proof:input-caret-visible:observed'));
    assert.ok(proofed.nativeOsUiProof?.evidenceTokens.includes('proof:focus-blur-restore:observed'));
    assert.ok(!proofed.nativeOsUiProof?.observedProofNames.includes('keyboard-enter-owner'));
    assert.doesNotMatch(JSON.stringify(proofed.nativeOsUiProof), /secret|<html|data:image|https?:|selector:|coords:|payload:|"x"|"y"|"url"|"title"|raw-leak/i);
    assert.equal(cursor.cursor, 'pointer');
    assert.equal(reloaded.loadingProgress?.state, 'stalled');
    assert.equal(reloaded.loadingProgress?.reason, 'navigation-stalled');
    assert.equal(reloaded.loadingProgress?.source, 'host-state');
    assert.equal(reloaded.loadingProgress?.canRetry, true);
    assert.equal(reloaded.loadingProgress?.refs.frameStream, undefined);
    assert.equal(reloaded.loadingProgress?.refs.frame, undefined);
    assert.match(reloaded.loadingProgress?.urls?.current?.sha1 ?? '', /^[a-f0-9]{40}$/);
    assert.doesNotMatch(JSON.stringify(reloaded.loadingProgress), /example\.org\/native|<html|base64|data:image/i);
    assert.deepEqual(calls.find((call) => call.route === '/sessions/start')?.body.sessionId, 'native-session');
    assert.ok(calls.some((call) => call.route.endsWith('/actions') && call.body.action === 'click'));
    const nativeProofCall = calls.find((call) => call.route.endsWith('/actions') && call.body.action === 'native-os-ui-proof');
    assert.ok(nativeProofCall);
    assert.equal(nativeProofCall.body.capture, 'none');
    assert.deepEqual(nativeProofCall.body.expectedProofNames, ['input-caret-visible', 'focus-blur-restore']);
  } finally {
    server.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession native loading state ACK drives lifecycle and missing loading signal blocks instead of faking ready', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-native-loading-'));
  let currentUrl = 'about:blank';
  let actionResponseMode: 'loading-false' | 'missing-loading' = 'loading-false';
  const server = createServer((req, res) => {
    void (async () => {
      const route = req.url ?? '/';
      const body = req.method === 'POST' ? await readJsonRequest(req) : {};
      if (route === '/sessions/start') {
        writeJsonResponse(res, { ok: true, sessionId: body.sessionId });
      } else if (route.endsWith('/navigate')) {
        currentUrl = normalizeBrowserHostUrl(String(body.url ?? 'about:blank'));
        writeJsonResponse(res, {
          ok: true,
          url: currentUrl,
          title: 'Native loading state page',
          canGoBack: false,
          canGoForward: false,
          loading: false,
        });
      } else if (route.endsWith('/state')) {
        writeJsonResponse(res, {
          ok: true,
          url: currentUrl,
          title: 'Native loading state page',
          canGoBack: true,
          canGoForward: false,
          loading: false,
        });
      } else if (route.endsWith('/screenshot')) {
        writeJsonResponse(res, await writeNativeEvidenceResponse(route, body, 'screenshot', PNG_1X1), req.method === 'POST' ? 200 : 405);
      } else if (route.endsWith('/content')) {
        writeJsonResponse(res, await writeNativeEvidenceResponse(route, body, 'dom', '<!-- bounded native loading fixture -->'), req.method === 'POST' ? 200 : 405);
      } else if (route.endsWith('/text')) {
        writeJsonResponse(res, await writeNativeEvidenceResponse(route, body, 'text', 'Native loading state page'), req.method === 'POST' ? 200 : 405);
      } else if (route.endsWith('/ax')) {
        writeJsonResponse(res, await writeNativeEvidenceResponse(route, body, 'ax', JSON.stringify({ role: 'document', name: 'Native loading state page' })), req.method === 'POST' ? 200 : 405);
      } else if (route.endsWith('/actions')) {
        currentUrl = 'https://example.org/native-loading/reloaded';
        if (actionResponseMode === 'missing-loading') {
          writeJsonResponse(res, {
            ok: true,
            url: currentUrl,
            title: 'Native loading signal missing',
            canGoBack: true,
            canGoForward: false,
          });
        } else {
          writeJsonResponse(res, {
            ok: true,
            url: currentUrl,
            title: 'Native loading state ACK',
            canGoBack: true,
            canGoForward: false,
            loading: false,
          });
        }
      } else {
        writeJsonResponse(res, { ok: false, reason: `unexpected route ${route}` }, 404);
      }
    })().catch((error) => writeJsonResponse(res, { ok: false, reason: error instanceof Error ? error.message : String(error) }, 500));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const manager = new BrowserHostSessionManager({
      driverFactory: createNativeEmbeddedBrowserHostDriverFactory(`http://127.0.0.1:${address.port}`),
    });

    const opened = await manager.openSession(workspacePath, {
      url: 'example.org/native-loading?token=secret-value',
      sessionId: 'native-loading-session',
    });
    assert.equal(opened.status, 'ready');
    assert.equal(opened.loadingProgress?.state, 'network-quiet');
    assert.equal(opened.loadingProgress?.reason, 'network-quiet');
    assert.equal(opened.loadingProgress?.source, 'host-state');
    assert.equal(opened.loadingProgress?.refs.frameStream, undefined);
    assert.equal(opened.loadingProgress?.refs.frame, undefined);

    const reloaded = await manager.act(workspacePath, opened.id, { action: 'reload', capture: 'none' });
    assert.equal(reloaded.status, 'ready');
    assert.equal(reloaded.url, 'https://example.org/native-loading/reloaded');
    assert.equal(reloaded.loadingProgress?.state, 'network-quiet');
    assert.equal(reloaded.loadingProgress?.reason, 'network-quiet');
    assert.equal(reloaded.loadingProgress?.source, 'host-state');
    assert.deepEqual(reloaded.loadingProgress?.urls?.final, reloaded.loadingProgress?.urls?.current);

    actionResponseMode = 'missing-loading';
    const blocked = await manager.act(workspacePath, opened.id, { action: 'reload', capture: 'none' });
    assert.equal(blocked.status, 'failed');
    assert.equal(blocked.loadingProgress?.state, 'blocked');
    assert.equal(blocked.loadingProgress?.reason, 'host-diagnostic');
    assert.equal(blocked.loadingProgress?.source, 'host-state');
    assert.equal(blocked.loadingProgress?.blocked, true);
    assert.equal(blocked.loadingProgress?.canRetry, true);
    assert.equal(blocked.loadingProgress?.requiresHandoff, undefined);
    assert.equal(blocked.loadingProgress?.refs.frameStream, undefined);
    assert.equal(blocked.loadingProgress?.refs.frame, undefined);
    assert.match(blocked.loadingProgress?.urls?.current?.sha1 ?? '', /^[a-f0-9]{40}$/);
    assert.doesNotMatch(JSON.stringify(blocked.loadingProgress), /example\.org\/native-loading|secret-value|<html|base64|data:image/i);
  } finally {
    server.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSessionManager default product path blocks when native adapter is missing', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-missing-native-'));
  const previousNativeAdapterUrl = process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
  try {
    delete process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
    const manager = new BrowserHostSessionManager();
    const session = await manager.openSession(workspacePath, {
      url: 'example.org/no-native',
      sessionId: 'missing-native-session',
    });

    assert.equal(session.status, 'failed');
    assert.equal(session.liveSurfaceTransport, undefined);
    assert.equal(session.nativeAdapterUrl, undefined);
    assert.equal(session.frameStreamRef, undefined);
    assert.equal(session.frameRef, undefined);
    assert.equal(session.loadingProgress?.state, 'handoff');
    assert.equal(session.loadingProgress?.blocked, true);
    assert.equal(session.loadingProgress?.requiresHandoff, true);
    assert.equal(session.loadingProgress?.refs.frameStream, undefined);
    assert.equal(session.loadingProgress?.refs.frame, undefined);
    assert.match(session.diagnostics.join('\n'), /Native embedded BrowserHostSession adapter is required/);
    assert.match(session.diagnostics.join('\n'), /Legacy host-stream fallback is disabled/);
  } finally {
    if (previousNativeAdapterUrl === undefined) delete process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
    else process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL = previousNativeAdapterUrl;
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search persists bounded search refs and excludes search-engine self links', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-search-'));
  const { factory, drivers } = fakeDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'browser host session',
      engine: 'duckduckgo',
      region: 'us-en',
      limit: 3,
    });

    assert.equal(output.schemaVersion, BROWSER_HOST_SEARCH_SCHEMA);
    assert.equal(output.engine, 'duckduckgo');
    assert.match(output.searchUrl, /^https:\/\/duckduckgo\.com\/html\/\?/);
    assert.equal(output.results.length, 2);
    assert.deepEqual(output.results.map((row) => row.url), [
      'https://example.org/browser-host',
      'https://developer.mozilla.org/docs/Web/API',
    ]);
    assert.equal(output.sourcePages?.length, 2);
    assert.deepEqual(output.sourcePages?.map((page) => [page.resultIndex, page.status, page.url]), [
      [0, 'read', 'https://example.org/browser-host'],
      [1, 'read', 'https://developer.mozilla.org/docs/Web/API'],
    ]);
    assert.match(output.sourcePages?.[0]?.textPreview ?? '', /Browser Host/);
    assert.match(output.sourcePages?.[0]?.sourcePageRef ?? '', /^browser-host-session:[^/]+\/source-pages\/source-1-[a-f0-9]+\.source\.json$/);
    assert.match(output.sourcePages?.[0]?.textRef ?? '', /^browser-host-session:[^/]+\/source-pages\/source-1-[a-f0-9]+\.txt$/);
    assert.ok(drivers[0]?.actions.some((action) => action === 'goto:https://example.org/browser-host'));
    assert.ok(drivers[0]?.actions.some((action) => action === 'goto:https://developer.mozilla.org/docs/Web/API'));
    const firstSourceText = await readFile(join(browserHostSessionDir(workspacePath, output.session.id), 'source-pages', basename(output.sourcePages?.[0]?.textRef ?? '')), 'utf8');
    assert.match(firstSourceText, /Browser Host/);
    const firstSourceMetadata = JSON.parse(await readFile(join(browserHostSessionDir(workspacePath, output.session.id), 'source-pages', basename(output.sourcePages?.[0]?.sourcePageRef ?? '')), 'utf8')) as { textRef?: string };
    assert.equal(firstSourceMetadata.textRef, output.sourcePages?.[0]?.textRef);
    assert.match(output.searchResultRef, /^browser-host-session:/);
    assert.match(browserHostSearchSummary(output), /BrowserHostSession search: browser host session/);
    assert.match(browserHostSearchSummary(output), /Opened source pages: 2/);
    assert.equal(output.automationSummary?.schemaVersion, 'sciforge.browser-runtime.automation-summary.v1');
    assert.equal(output.automationSummary?.kind, 'scrape');
    assert.equal(output.automationSummary?.boundedRefsOnly, true);
    assert.equal(output.automationSummary?.refs.some((ref) => ref.kind === 'search-result' && ref.ref === output.searchResultRef), true);
    assert.match(output.automationSummary?.summary ?? '', /2 bounded result/);
    assert.doesNotMatch(JSON.stringify(output.automationSummary), /duckduckgo\.com|browser host session|<html|secret/i);

    const visible = await manager.openSession(workspacePath, { url: 'https://example.org/visible', sessionId: 'visible-search-session' });
    const reused = await manager.search(workspacePath, {
      query: 'visible browser',
      sessionId: visible.id,
      limit: 1,
    });
    assert.equal(reused.session.id, visible.id);
    assert.equal(reused.sourcePages?.length, 1);
    assert.equal(reused.session.automationSummary?.kind, 'scrape');
    assert.equal(reused.session.automationSummary?.refs.some((ref) => ref.kind === 'search-result' && ref.ref === reused.searchResultRef), true);
    assert.equal(drivers.length, 2);
    assert.ok(drivers[1]?.actions.some((action) => action.startsWith('goto:https://www.bing.com/search?')));
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession openRead persists source page metadata and page text refs for a Host URL', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-open-read-'));
  const { factory, drivers } = fakeDriverFactory({
    textByUrl: {
      'https://example.org/open-read': 'Open Read\nCurrent page text evidence',
    },
  });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.openRead(workspacePath, {
      url: 'https://example.org/open-read',
      sessionId: 'open-read-session',
      title: 'Host provided source',
    });

    assert.equal(output.session.id, 'open-read-session');
    assert.equal(output.sourcePage.status, 'read');
    assert.equal(output.sourcePage.title, 'Host provided source');
    assert.equal(output.sourcePage.url, 'https://example.org/open-read');
    assert.equal(output.sourcePage.finalUrl, 'https://example.org/open-read');
    assert.match(output.sourcePage.sourcePageRef ?? '', /^browser-host-session:open-read-session\/source-pages\/source-1-[a-f0-9]+\.source\.json$/);
    assert.match(output.sourcePage.textRef ?? '', /^browser-host-session:open-read-session\/source-pages\/source-1-[a-f0-9]+\.txt$/);
    assert.ok(drivers[0]?.actions.some((action) => action === 'goto:https://example.org/open-read'));
    const sourceText = await readFile(join(browserHostSessionDir(workspacePath, output.session.id), 'source-pages', basename(output.sourcePage.textRef ?? '')), 'utf8');
    assert.match(sourceText, /Current page text evidence/);
    const sourceMetadata = JSON.parse(await readFile(join(browserHostSessionDir(workspacePath, output.session.id), 'source-pages', basename(output.sourcePage.sourcePageRef ?? '')), 'utf8')) as { textRef?: string; finalUrl?: string };
    assert.equal(sourceMetadata.textRef, output.sourcePage.textRef);
    assert.equal(sourceMetadata.finalUrl, 'https://example.org/open-read');
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession openRead falls back to public source text fetch when browser text extraction fails', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-open-read-fetch-fallback-'));
  const sourceUrl = 'https://platform.openai.com/docs/changelog';
  const { factory } = fakeDriverFactory({
    failTextUrls: [sourceUrl],
  });
  const fetchedUrls: string[] = [];
  try {
    const manager = new BrowserHostSessionManager({
      driverFactory: factory,
      sourceTextFetcher: async (url) => {
        fetchedUrls.push(url);
        return {
          finalUrl: 'https://developers.openai.com/api/docs/changelog',
          text: 'Changelog June, 2026 Jun 4 Feature Added moderation scores to the Responses API and Chat Completions API.',
        };
      },
    });
    const output = await manager.openRead(workspacePath, {
      url: sourceUrl,
      sessionId: 'open-read-fetch-fallback-session',
      title: 'OpenAI API changelog',
    });

    assert.deepEqual(fetchedUrls, [sourceUrl]);
    assert.equal(output.sourcePage.status, 'read');
    assert.equal(output.sourcePage.url, sourceUrl);
    assert.equal(output.sourcePage.finalUrl, 'https://developers.openai.com/api/docs/changelog');
    assert.match(output.sourcePage.sourcePageRef ?? '', /^browser-host-session:open-read-fetch-fallback-session\/source-pages\/source-1-[a-f0-9]+\.source\.json$/);
    assert.match(output.sourcePage.textRef ?? '', /^browser-host-session:open-read-fetch-fallback-session\/source-pages\/source-1-[a-f0-9]+\.txt$/);
    assert.match(output.sourcePage.textSummary ?? output.sourcePage.textPreview ?? '', /Jun 4.*moderation scores/);
    assert.match(output.session.diagnostics.join('\n'), /public source text fetch/i);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession openRead falls back to public source text fetch when browser driver is unavailable', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-open-read-no-driver-fallback-'));
  const previousNativeAdapterUrl = process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
  delete process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
  const sourceUrl = 'https://platform.openai.com/docs/changelog';
  const fetchedUrls: string[] = [];
  try {
    const manager = new BrowserHostSessionManager({
      sourceTextFetcher: async (url) => {
        fetchedUrls.push(url);
        return {
          finalUrl: 'https://developers.openai.com/api/docs/changelog',
          text: 'Changelog June, 2026 Jun 4 Feature Added moderation scores to the Responses API and Chat Completions API.',
        };
      },
    });
    const output = await manager.openRead(workspacePath, {
      url: sourceUrl,
      sessionId: 'open-read-no-driver-fallback-session',
      title: 'OpenAI API changelog',
    });

    assert.deepEqual(fetchedUrls, [sourceUrl]);
    assert.equal(output.sourcePage.status, 'read');
    assert.equal(output.sourcePage.finalUrl, 'https://developers.openai.com/api/docs/changelog');
    assert.match(output.sourcePage.sourcePageRef ?? '', /^browser-host-session:open-read-no-driver-fallback-session\/source-pages\/source-1-[a-f0-9]+\.source\.json$/);
    assert.match(output.sourcePage.textRef ?? '', /^browser-host-session:open-read-no-driver-fallback-session\/source-pages\/source-1-[a-f0-9]+\.txt$/);
    assert.match(output.session.diagnostics.join('\n'), /no active browser driver/i);
    assert.match(output.session.diagnostics.join('\n'), /public source text fetch/i);
  } finally {
    if (previousNativeAdapterUrl === undefined) delete process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
    else process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL = previousNativeAdapterUrl;
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search prioritizes preferred official results before reading source pages', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-preferred-search-'));
  const { factory, drivers } = fakeDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'Hugging Face Daily Papers 今天热门论文',
      limit: 3,
      sourcePageLimit: 1,
      preferredResults: [{
        title: 'Hugging Face Daily Papers API',
        url: 'https://huggingface.co/api/daily_papers?sort=trending',
        snippet: 'Official Hugging Face Daily Papers API.',
      }],
    });

    assert.equal(output.results[0]?.title, 'Hugging Face Daily Papers API');
    assert.equal(output.results[0]?.url, 'https://huggingface.co/api/daily_papers?sort=trending');
    assert.equal(output.sourcePages?.[0]?.url, 'https://huggingface.co/api/daily_papers?sort=trending');
    assert.ok(drivers[0]?.actions.some((action) => action === 'goto:https://huggingface.co/api/daily_papers?sort=trending'));
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search enforces explicit site constraints without synthesizing sources', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-site-filter-'));
  const { factory, drivers } = fakeDriverFactory({
    searchResults: [
      { title: 'Agentic RL blog', url: 'https://example.org/agentic-rl', snippet: 'Wrong host' },
      { title: 'Agentic RL notes', url: 'https://zhuanlan.zhihu.com/p/agentic-rl', snippet: 'Wrong host' },
    ],
  });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'site:arxiv.org agentic rl',
      limit: 4,
      sourcePageLimit: 2,
    });

    assert.equal(output.results.length, 0);
    assert.deepEqual(output.sourcePages, []);
    assert.ok(drivers[0]?.actions.every((action) => !/arxiv\.org\/search/.test(action)));
    assert.doesNotMatch(JSON.stringify(output.results), /example\.org|zhihu/i);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search filters source-constrained results after a wider raw extraction window', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-site-filter-window-'));
  const arxivAbsUrl = 'https://arxiv.org/abs/2509.02547';
  const { factory } = fakeDriverFactory({
    searchResults: [
      { title: 'Wrong host 1', url: 'https://example.org/1', snippet: 'agentic rl' },
      { title: 'Wrong host 2', url: 'https://example.org/2', snippet: 'agentic rl' },
      { title: 'Wrong host 3', url: 'https://example.org/3', snippet: 'agentic rl' },
      { title: 'Wrong host 4', url: 'https://example.org/4', snippet: 'agentic rl' },
      { title: 'Wrong host 5', url: 'https://example.org/5', snippet: 'agentic rl' },
      { title: 'The Landscape of Agentic Reinforcement Learning', url: arxivAbsUrl, snippet: 'arXiv source result' },
    ],
    textByUrl: {
      [arxivAbsUrl]: [
        'Title: The Landscape of Agentic Reinforcement Learning',
        'Authors: Example Author',
        '[Submitted on 2 Sep 2025]',
        'Abstract: A survey of agentic reinforcement learning.',
      ].join('\n'),
    },
  });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'site:arxiv.org agentic rl',
      limit: 3,
      sourcePageLimit: 1,
    });

    assert.equal(output.results.length, 1);
    assert.equal(output.results[0]?.url, arxivAbsUrl);
    assert.equal(output.sourcePages?.[0]?.status, 'read');
    assert.equal(output.sourcePages?.[0]?.url, arxivAbsUrl);
    assert.match(output.sourcePages?.[0]?.textSummary ?? '', /Landscape of Agentic Reinforcement Learning/);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search retries relaxed constrained queries when strict site search returns no usable results', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-relaxed-site-retry-'));
  const arxivAbsUrl = 'https://arxiv.org/abs/2606.05296';
  const arxivHomeUrl = 'https://arxiv.org/';
  const arxivSearchUrl = 'https://arxiv.org/search/?query=agentic+rl&searchtype=all';
  const { factory, drivers } = fakeDriverFactory({
    searchResultsByQuery: {
      'site:arxiv.org agentic rl': [],
      'arxiv.org agentic rl': [
        { title: 'arXiv.org e-Print archive', url: arxivHomeUrl, snippet: 'Right host but only the home page' },
        { title: 'Wrong host', url: 'https://example.org/agentic-rl', snippet: 'Search engine drift' },
      ],
    },
    contentByUrl: {
      [arxivHomeUrl]: [
        '<html><body>',
        '<form method="GET" action="/search">',
        '<input type="text" name="query">',
        '<select name="searchtype"><option value="all" selected>All fields</option></select>',
        '<button>Search</button>',
        '</form>',
        '</body></html>',
      ].join(''),
      [arxivSearchUrl]: [
        '<html><body>',
        '<a href="/abs/2606.05296">Agentic Monte Carlo: Simulating Reinforcement Learning for Black-Box Agents</a>',
        '</body></html>',
      ].join(''),
    },
    textByUrl: {
      [arxivAbsUrl]: [
        'Title: Agentic Monte Carlo: Simulating Reinforcement Learning for Black-Box Agents',
        'Authors: Dae Yon Hwang, Raunaq Suri',
        '[Submitted on 3 Jun 2026]',
        'Abstract: Simulates reinforcement learning-style exploration for black-box LLM agents.',
      ].join('\n'),
    },
  });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'site:arxiv.org agentic rl',
      limit: 4,
      sourcePageLimit: 1,
    });

    assert.equal(output.query, 'site:arxiv.org agentic rl');
    assert.equal(output.engine, 'bing');
    assert.equal(output.results.length, 1);
    assert.equal(output.results[0]?.url, arxivAbsUrl);
    assert.equal(output.sourcePages?.[0]?.status, 'read');
    assert.equal(output.sourcePages?.[0]?.url, arxivAbsUrl);
    assert.match(output.sourcePages?.[0]?.textSummary ?? '', /Agentic Monte Carlo/);
    assert.ok(drivers[0]?.actions.some((action) => action.includes('q=site%3Aarxiv.org+agentic+rl')));
    assert.ok(drivers[0]?.actions.some((action) => action.includes('q=arxiv.org+agentic+rl')));
    assert.equal(output.searchUrl, arxivSearchUrl);
    assert.match(output.session.diagnostics.join('\n'), /relaxed constrained query/i);
    assert.match(output.session.diagnostics.join('\n'), /source-site search form/i);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search treats arXiv root and login constrained results as low-information before source-site discovery', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-arxiv-low-info-discovery-'));
  const arxivHomeUrl = 'https://arxiv.org/';
  const arxivLoginUrl = 'https://arxiv.org/login';
  const arxivSearchUrl = 'https://arxiv.org/search/?query=agentic+rl&searchtype=all';
  const arxivAbsUrl = 'https://arxiv.org/abs/2606.05296';
  const { factory } = fakeDriverFactory({
    searchResultsByQuery: {
      'site:arxiv.org agentic rl': [
        { title: 'arXiv.org e-Print archive', url: arxivHomeUrl, snippet: 'Right host but only the home page' },
        { title: 'Log in to arXiv', url: arxivLoginUrl, snippet: 'Right host but only login' },
      ],
    },
    contentByUrl: {
      [arxivHomeUrl]: [
        '<html><body>',
        '<form method="GET" action="/search">',
        '<input type="text" name="query">',
        '<select name="searchtype"><option value="all" selected>All fields</option></select>',
        '<button>Search</button>',
        '</form>',
        '</body></html>',
      ].join(''),
      [arxivSearchUrl]: [
        '<html><body>',
        '<a href="/abs/2606.05296">Agentic Monte Carlo: Simulating Reinforcement Learning for Black-Box Agents</a>',
        '</body></html>',
      ].join(''),
    },
    textByUrl: {
      [arxivAbsUrl]: [
        'Title: Agentic Monte Carlo: Simulating Reinforcement Learning for Black-Box Agents',
        'Authors: Dae Yon Hwang, Raunaq Suri',
        '[Submitted on 3 Jun 2026]',
        'Abstract: Simulates reinforcement learning-style exploration for black-box LLM agents.',
      ].join('\n'),
    },
  });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'site:arxiv.org agentic rl',
      limit: 4,
      sourcePageLimit: 2,
    });

    assert.deepEqual(output.results.map((result) => result.url), [arxivAbsUrl]);
    assert.deepEqual(output.sourcePages?.filter((page) => !page.discoveryOnly).map((page) => page.url), [arxivAbsUrl]);
    assert.equal(output.sourcePages?.some((page) => page.url === arxivHomeUrl || page.url === arxivLoginUrl), false);
    assert.match(output.session.diagnostics.join('\n'), /low-information constrained search results/i);
    assert.match(output.session.diagnostics.join('\n'), /source-site search form/i);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search marks arXiv root and login pages discoveryOnly when no task source is found', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-arxiv-low-info-pages-'));
  const arxivHomeUrl = 'https://arxiv.org/';
  const arxivLoginUrl = 'https://arxiv.org/login';
  const { factory } = fakeDriverFactory({
    searchResultsByQuery: {
      'site:arxiv.org virtual cell': [
        { title: 'arXiv.org e-Print archive', url: arxivHomeUrl, snippet: 'Right host but only the home page' },
        { title: 'Log in to arXiv', url: arxivLoginUrl, snippet: 'Right host but only login' },
      ],
    },
    contentByUrl: {
      [arxivHomeUrl]: '<html><body><nav>arXiv home</nav></body></html>',
      [arxivLoginUrl]: '<html><body><form><input name="username"><input name="password"></form></body></html>',
    },
    textByUrl: {
      [arxivHomeUrl]: 'Skip to main content arXiv is a free distribution service and open-access archive.',
      [arxivLoginUrl]: 'Log in to arXiv e-print repository username password.',
    },
  });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'site:arxiv.org virtual cell',
      limit: 4,
      sourcePageLimit: 2,
    });

    assert.deepEqual(output.results.map((result) => result.url), [arxivHomeUrl, arxivLoginUrl]);
    assert.deepEqual(output.sourcePages?.map((page) => [page.url, page.discoveryOnly]), [
      [arxivHomeUrl, true],
      [arxivLoginUrl, true],
    ]);
    assert.equal(output.sourcePages?.filter((page) => page.status === 'read' && !page.discoveryOnly).length, 0);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search isolates source-page reads when visible search navigation stays on search page', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-isolated-source-read-'));
  const arxivSearchUrl = 'https://arxiv.org/search/?query=agentic+rl&searchtype=all&abstracts=show&order=-announced_date_first&size=25';
  const arxivAbsUrl = 'https://arxiv.org/abs/2606.05296';
  const { factory, drivers } = fakeDriverFactory({
    stayOnSearchPageForSourceNavigation: true,
    searchResults: [
      { title: 'Agentic RL blog', url: 'https://example.org/agentic-rl', snippet: 'Wrong host' },
      { title: 'arXiv search: agentic rl', url: arxivSearchUrl, snippet: 'Official listing' },
    ],
    textByUrl: {
      [arxivSearchUrl]: [
        'Showing 1-25 of 6,080 results for all: agentic rl',
        'arXiv:2606.05296 [pdf, ps, other] cs.LG cs.AI Agentic Monte Carlo: Simulating Reinforcement Learning for Black-Box Agents Authors: Dae Yon Hwang, Raunaq Suri Abstract: LLM agents operate in open-weight and black-box regimes. Submitted 3 June, 2026; originally announced June 2026.',
      ].join('\n'),
      [arxivAbsUrl]: [
        'Title: Agentic Monte Carlo: Simulating Reinforcement Learning for Black-Box Agents',
        'Authors: Dae Yon Hwang, Raunaq Suri',
        '[Submitted on 3 Jun 2026]',
        'Abstract: Simulates reinforcement learning-style exploration for black-box LLM agents.',
        'Subjects: Artificial Intelligence (cs.AI)',
      ].join('\n'),
    },
  });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'site:arxiv.org agentic rl',
      limit: 4,
      sourcePageLimit: 1,
    });

    const discoveryPage = output.sourcePages?.[0];
    const sourcePage = output.sourcePages?.[1];
    assert.equal(discoveryPage?.status, 'read');
    assert.equal(discoveryPage?.discoveryOnly, true);
    assert.equal(discoveryPage?.url, arxivSearchUrl);
    assert.deepEqual(discoveryPage?.discoveredSourceUrls, [arxivAbsUrl]);
    assert.equal(sourcePage?.status, 'read');
    assert.equal(sourcePage?.discoveryOnly, undefined);
    assert.equal(sourcePage?.url, arxivAbsUrl);
    assert.match(sourcePage?.textSummary ?? '', /Agentic Monte Carlo/);
    assert.match(sourcePage?.sourcePageRef ?? '', /^browser-host-session:[^/]+\/source-pages\/source-2-[a-f0-9]+\.source\.json$/);
    assert.match(sourcePage?.textRef ?? '', /^browser-host-session:[^/]+\/source-pages\/source-2-[a-f0-9]+\.txt$/);
    assert.ok(drivers.length >= 3);
    assert.ok(drivers[0]?.actions.filter((action) => action === `goto:${arxivSearchUrl}`).length >= 2);
    assert.ok(drivers[1]?.actions.some((action) => action === `goto:${arxivSearchUrl}`));
    assert.ok(drivers[1]?.closed);
    assert.ok(drivers.some((driver) => driver.actions.some((action) => action === `goto:${arxivAbsUrl}`)));
    assert.match(output.session.diagnostics.join('\n'), /isolated source-page reader/i);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search falls back to public source text fetch when browser source navigation fails', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-source-fetch-fallback-'));
  const sourceUrl = 'https://example.org/research/source-paper';
  const { factory } = fakeDriverFactory({
    failNavigationUrls: [sourceUrl],
    searchResults: [
      { title: 'Source paper', url: sourceUrl, snippet: 'A relevant source result' },
    ],
  });
  const fetchedUrls: string[] = [];
  try {
    const manager = new BrowserHostSessionManager({
      driverFactory: factory,
      sourceTextFetcher: async (url) => {
        fetchedUrls.push(url);
        return {
          finalUrl: url,
          text: 'Title: Source Paper\nAuthors: Ada Example\nAbstract: Source-backed fallback text.',
        };
      },
    });
    const output = await manager.search(workspacePath, {
      query: 'source paper',
      limit: 1,
      sourcePageLimit: 1,
    });

    const sourcePage = output.sourcePages?.[0];
    assert.deepEqual(fetchedUrls, [sourceUrl]);
    assert.equal(sourcePage?.status, 'read');
    assert.equal(sourcePage?.url, sourceUrl);
    assert.match(sourcePage?.textPreview ?? '', /Source-backed fallback text/);
    assert.match(sourcePage?.sourcePageRef ?? '', /^browser-host-session:[^/]+\/source-pages\/source-1-[a-f0-9]+\.source\.json$/);
    assert.match(output.session.diagnostics.join('\n'), /public source text fetch/i);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search treats bare public domains as source constraints', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-bare-domain-filter-'));
  const { factory, drivers } = fakeDriverFactory({
    searchResults: [
      { title: 'Agentic RL blog', url: 'https://example.org/agentic-rl', snippet: 'Wrong host' },
      { title: 'Agentic RL notes', url: 'https://zhuanlan.zhihu.com/p/agentic-rl', snippet: 'Wrong host' },
      { title: 'arXiv homepage', url: 'https://arxiv.org/', snippet: 'Right host but less specific' },
    ],
    textByUrl: {
      'https://arxiv.org/': 'arXiv homepage',
    },
  });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'arxiv.org agentic reinforcement learning 2026-06-07',
      limit: 4,
      sourcePageLimit: 2,
    });

    assert.equal(output.results.length, 1);
    assert.equal(output.results[0]?.url, 'https://arxiv.org/');
    assert.equal(output.sourcePages?.[0]?.url, 'https://arxiv.org/');
    assert.match(output.sourcePages?.[0]?.textPreview ?? '', /arXiv homepage/);
    assert.ok(drivers[0]?.actions.some((action) => action === 'goto:https://arxiv.org/'));
    assert.doesNotMatch(JSON.stringify(output.results), /example\.org|zhihu/i);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search leaves source aliases to Host query policy instead of filtering locally', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-source-alias-filter-'));
  const { factory, drivers } = fakeDriverFactory({
    searchResults: [
      { title: 'arXiv.org e-Print archive', url: 'https://arxiv.org/', snippet: 'Right host but less specific' },
      { title: 'arXiv 是期刊吗？', url: 'https://zhuanlan.zhihu.com/p/2019340359319209416', snippet: 'Wrong host' },
      { title: 'Tsinghua arXiv news', url: 'https://lib.tsinghua.edu.cn/info/1377/7955.htm', snippet: 'Wrong host' },
    ],
    textByUrl: {
      'https://arxiv.org/': 'arXiv homepage',
    },
  });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'arxiv agentic reinforcement learning 2026-06-07',
      limit: 4,
      sourcePageLimit: 2,
    });

    assert.equal(output.results.length, 3);
    assert.equal(output.results[0]?.url, 'https://arxiv.org/');
    assert.match(JSON.stringify(output.results), /zhihu|tsinghua/i);
    assert.equal(output.sourcePages?.[0]?.url, 'https://arxiv.org/');
    assert.ok(drivers[0]?.actions.some((action) => action === 'goto:https://arxiv.org/'));
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search stores a bounded readable summary for Hugging Face Daily Papers API source pages', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-daily-papers-summary-'));
  const dailyPapersApiUrl = 'https://huggingface.co/api/daily_papers?sort=trending';
  const dailyPapersJson = JSON.stringify([
    {
      paper: {
        id: '2606.03264',
        authors: [
          { _id: 'author-secret-1', name: 'Zelun Zhang', hidden: false },
          { _id: 'author-secret-2', name: 'Hongen Liu', hidden: false },
        ],
        publishedAt: '2026-06-02T00:00:00.000Z',
        title: 'PaddleOCR-VL-1.6: Expanding the Frontier of Document Parsing',
        summary: 'We introduce PaddleOCR-VL-1.6, an upgraded compact document parsing model with region-aware data optimization and progressive post-training.',
        upvotes: 13,
      },
      publishedAt: '2026-06-01T20:00:00.000Z',
      title: 'PaddleOCR-VL-1.6: Expanding the Frontier of Document Parsing',
      summary: 'Outer duplicate summary should not change the structured answer.',
      numComments: 1,
    },
    {
      paper: {
        id: '2412.20138',
        authors: [
          { _id: 'author-secret-3', name: 'Yijia Xiao', hidden: false },
          { _id: 'author-secret-4', name: 'Edward Sun', hidden: false },
        ],
        publishedAt: '2024-12-28T12:54:06.000Z',
        title: 'TradingAgents: Multi-Agents LLM Financial Trading Framework',
        summary: 'TradingAgents proposes a stock trading framework inspired by trading firms with LLM-powered analysts, researchers, risk managers, and traders.',
        upvotes: 86,
      },
      publishedAt: '2024-12-28T07:54:06.000Z',
      title: 'TradingAgents: Multi-Agents LLM Financial Trading Framework',
      summary: 'Outer duplicate summary should not leak raw JSON details.',
      numComments: 4,
    },
  ]);
  const { factory } = fakeDriverFactory({
    textByUrl: {
      [dailyPapersApiUrl]: dailyPapersJson,
    },
  });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'Hugging Face Daily Papers 今天热门论文',
      limit: 1,
      sourcePageLimit: 1,
      preferredResults: [{
        title: 'Hugging Face Daily Papers API',
        url: dailyPapersApiUrl,
        snippet: 'Official Hugging Face Daily Papers API.',
      }],
    });

    const sourcePage = output.sourcePages?.[0];
    assert.equal(sourcePage?.url, dailyPapersApiUrl);
    assert.match(sourcePage?.textSummary ?? '', /PaddleOCR-VL-1\.6/);
    assert.match(sourcePage?.textSummary ?? '', /TradingAgents/);
    assert.match(sourcePage?.textSummary ?? '', /Zelun Zhang/);
    assert.match(sourcePage?.textSummary ?? '', /86 upvotes/);
    assert.doesNotMatch(sourcePage?.textSummary ?? '', /\{"paper"|author-secret|"_id"/);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search writes compact Daily Papers API source artifacts instead of truncated raw JSON', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-daily-papers-large-summary-'));
  const dailyPapersApiUrl = 'https://huggingface.co/api/daily_papers?date=2026-06-05';
  const dailyPapersJson = JSON.stringify(Array.from({ length: 40 }, (_, index) => ({
    paper: {
      id: `2606.${String(index + 1).padStart(5, '0')}`,
      authors: [
        { _id: `secret-author-${index}-1`, name: `Author ${index + 1}A` },
        { _id: `secret-author-${index}-2`, name: `Author ${index + 1}B` },
      ],
      submittedOnDailyAt: '2026-06-05T09:00:00.000Z',
      title: `Large Daily Paper ${index + 1}`,
      summary: index < 3
        ? `A concise research summary for large daily paper ${index + 1}. It covers repository context, evaluation detail, and implementation notes.`
        : `A concise research summary for large daily paper ${index + 1}. ${'Repository context, evaluation detail, and implementation notes. '.repeat(70)}`,
      upvotes: 80 - index,
    },
    numComments: index + 1,
  })));
  assert.ok(dailyPapersJson.length > 60_000);
  const { factory } = fakeDriverFactory({
    textByUrl: {
      [dailyPapersApiUrl]: dailyPapersJson,
    },
  });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'Hugging Face Daily Papers 今天热门论文',
      limit: 1,
      sourcePageLimit: 1,
      preferredResults: [{
        title: 'Hugging Face Daily Papers API (2026-06-05)',
        url: dailyPapersApiUrl,
        snippet: 'Official Hugging Face Daily Papers API fallback for 2026-06-05.',
      }],
    });

    const sourcePage = output.sourcePages?.[0];
    const sourceText = await readFile(join(browserHostSessionDir(workspacePath, output.session.id), 'source-pages', basename(sourcePage?.textRef ?? '')), 'utf8');
    assert.match(sourcePage?.textSummary ?? '', /Large Daily Paper 1/);
    assert.match(sourceText, /Hugging Face Daily Papers API/);
    assert.match(sourceText, /Large Daily Paper 1/);
    assert.match(sourceText, /Large Daily Paper 3/);
    assert.doesNotMatch(sourceText, /^\[\{/);
    assert.doesNotMatch(sourceText, /"_id"|secret-author/);
    assert.ok(sourceText.length < 10_000);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search summarizes empty Hugging Face Daily Papers date API responses without raw JSON', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-daily-papers-empty-summary-'));
  const dailyPapersApiUrl = 'https://huggingface.co/api/daily_papers?date=2026-06-06';
  const { factory } = fakeDriverFactory({
    textByUrl: {
      [dailyPapersApiUrl]: '[]',
    },
  });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const output = await manager.search(workspacePath, {
      query: 'Hugging Face Daily Papers 今天热门论文',
      limit: 1,
      sourcePageLimit: 1,
      preferredResults: [{
        title: 'Hugging Face Daily Papers API (2026-06-06)',
        url: dailyPapersApiUrl,
        snippet: 'Official Hugging Face Daily Papers API for 2026-06-06.',
      }],
    });

    const sourcePage = output.sourcePages?.[0];
    assert.equal(sourcePage?.url, dailyPapersApiUrl);
    assert.match(sourcePage?.textSummary ?? '', /no entries|2026-06-06/i);
    assert.doesNotMatch(sourcePage?.textSummary ?? '', /^\[\]$/);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession keeps ready state with placeholder evidence refs when screenshots fail', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-screenshot-placeholder-'));
  const { factory } = fakeDriverFactory({ failScreenshots: true });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const session = await manager.openSession(workspacePath, {
      url: 'example.org/slow-fonts',
      sessionId: 'placeholder-session',
    });

    assert.equal(session.status, 'ready');
    assert.equal(session.frameStreamRef, undefined);
    assert.equal(session.frameRef, undefined);
    assert.match(session.screenshotRef ?? '', /^browser-host-session:placeholder-session\/screenshot-/);
    assert.match(session.diagnostics.join('\n'), /capture placeholder|timeout placeholder evidence ref/);
    assert.doesNotMatch(session.diagnostics.join('\n'), /secret-value/);

    const framePath = await manager.framePath(workspacePath, 'placeholder-session');
    assert.ok(framePath);
    assert.deepEqual(await readFile(framePath), PNG_1X1);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession HTTP routes expose start, state, action, search, and missing frame responses', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-routes-'));
  const manager = createRouteManager(workspacePath);
  const routeOptions = {
    manager: manager as unknown as BrowserHostSessionManager,
    workspaceRootFromRequest: async () => workspacePath,
    workspaceRootFromBodyOrRequest: async (body: Record<string, unknown>) => String(body.workspacePath || workspacePath),
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleBrowserHostSessionRoutes(req, res, url, routeOptions).then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not found' }));
      }
    });
  });
  server.on('upgrade', (req, socket, head) => {
    if (!handleBrowserHostSessionUpgrade(req, socket, head, routeOptions)) socket.destroy();
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const started = await postJson(`${baseUrl}/api/sciforge/browser-host/sessions/start`, {
      workspacePath,
      url: 'example.org',
      sessionId: 'route-session',
    });
    assert.equal(started.ok, true);
    assert.equal(started.session.id, 'route-session');
    assert.equal(started.session.url, 'https://example.org');

    const stateResponse = await fetch(`${baseUrl}/api/sciforge/browser-host/sessions/route-session/state?workspacePath=${encodeURIComponent(workspacePath)}`);
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json() as { ok: boolean; session: BrowserHostSessionState };
    assert.equal(state.ok, true);
    assert.equal(state.session.id, 'route-session');

    const action = await postJson(`${baseUrl}/api/sciforge/browser-host/sessions/route-session/actions`, {
      workspacePath,
      action: 'navigate',
      url: 'localhost:4173/result',
    });
    assert.equal(action.session.url, 'http://localhost:4173/result');

    const nativeProof = await postJson(`${baseUrl}/api/sciforge/browser-host/sessions/route-session/actions`, {
      workspacePath,
      action: 'native-os-ui-proof',
      capture: 'full',
      proofGroup: 'cursorCaret',
      probe: 'focus-caret',
      expectedProofNames: ['input-caret-visible', 'focus-blur-restore', 'https://raw.example/proof'],
      actionId: 'route-focus-input-caret',
      url: 'https://secret.example/proof?token=secret-value',
      x: 12,
      y: 24,
      text: 'raw clipboard text',
      clipboard: 'raw clipboard text',
      dom: '<html>raw DOM</html>',
      payload: { token: 'secret-value' },
    });
    assert.equal(nativeProof.session.nativeOsUiProof?.schemaVersion, 'sciforge.browser-host-session.native-os-ui-proof.v1');
    assert.equal(nativeProof.session.nativeOsUiProof?.boundedEvidenceOnly, true);
    assert.deepEqual(nativeProof.session.nativeOsUiProof?.observedProofNames, ['input-caret-visible', 'focus-blur-restore']);
    assert.doesNotMatch(JSON.stringify(nativeProof.session.nativeOsUiProof), /secret|<html|https?:|clipboard text|payload:/i);

    const proofActionInput = manager.actionInputs.find((entry) => entry.input.action === 'native-os-ui-proof')?.input;
    assert.ok(proofActionInput);
    assert.equal(proofActionInput.capture, 'none');
    assert.equal(proofActionInput.proofGroup, 'cursorCaret');
    assert.equal(proofActionInput.probe, 'focus-caret');
    assert.deepEqual(proofActionInput.expectedProofNames, ['input-caret-visible', 'focus-blur-restore']);
    assert.equal(proofActionInput.actionId, 'route-focus-input-caret');
    assert.equal(proofActionInput.url, undefined);
    assert.equal(proofActionInput.x, undefined);
    assert.equal(proofActionInput.y, undefined);
    assert.equal(proofActionInput.text, undefined);
    assert.equal(proofActionInput.clipboard, undefined);
    assert.equal(proofActionInput.dom, undefined);
    assert.equal(proofActionInput.payload, undefined);

    const computerUseAction = await postJson(`${baseUrl}/api/sciforge/browser-host/sessions/route-session/computer-use-actions`, {
      workspacePath,
      action: {
        type: 'click',
        x: 22,
        y: 33,
        permissionRef: 'permission:turn/route-session/ordinary-navigation',
        cancelRef: 'cancel:runtime-turn/route-session',
      },
      capture: 'none',
    });
    assert.equal(computerUseAction.result.providerId, BROWSER_HOST_COMPUTER_USE_PROVIDER_ID);
    assert.equal(computerUseAction.result.inputChannel, 'browser-host-session');
    assert.equal(computerUseAction.result.userDeviceImpact, 'none');
    assert.equal(computerUseAction.result.hostAction.action, 'click');
    assert.equal(computerUseAction.result.hostAction.capture, 'none');

    const search = await postJson(`${baseUrl}/api/sciforge/browser-host/search`, {
      workspacePath,
      query: 'query text',
      sessionId: 'route-session',
      limit: 2,
    });
    assert.equal(search.search.schemaVersion, BROWSER_HOST_SEARCH_SCHEMA);
    assert.equal(search.search.session.id, 'route-session');
    assert.equal(search.search.results.length, 1);

    const openRead = await postJson(`${baseUrl}/api/sciforge/browser-host/open-read`, {
      workspacePath,
      url: 'https://example.org/open-read',
      sessionId: 'route-session',
      title: 'Route Open Read',
      timeoutMs: 1234,
    });
    assert.equal(openRead.ok, true);
    assert.equal(openRead.openRead.session.id, 'route-session');
    assert.equal(openRead.openRead.sourcePage.status, 'read');
    assert.equal(openRead.openRead.sourcePage.title, 'Route Open Read');
    assert.match(openRead.openRead.sourcePage.sourcePageRef ?? '', /^browser-host-session:route-session\/source-pages\/source-1-route\.source\.json$/);
    assert.match(openRead.openRead.sourcePage.textRef ?? '', /^browser-host-session:route-session\/source-pages\/source-1-route\.txt$/);
    assert.equal(manager.openReadInputs[0]?.input.title, 'Route Open Read');
    assert.equal(manager.openReadInputs[0]?.input.timeoutMs, 1234);
    assert.doesNotMatch(JSON.stringify(openRead), /FULL_ROUTE_PAGE_TEXT_SHOULD_NOT_INLINE|rawHtml|secret-value/i);

    const invalidOpenReadResponse = await fetch(`${baseUrl}/api/sciforge/browser-host/open-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath,
        title: 'Missing URL',
        text: 'FULL_ROUTE_PAGE_TEXT_SHOULD_NOT_INLINE',
        rawHtml: '<html>secret-value</html>',
      }),
    });
    assert.equal(invalidOpenReadResponse.status, 400);
    const invalidOpenRead = await invalidOpenReadResponse.json() as { ok: boolean; error?: string };
    assert.equal(invalidOpenRead.ok, false);
    assert.match(invalidOpenRead.error ?? '', /open_read url is required/);
    assert.equal(manager.openReadInputs.length, 1);

    const missingFrame = await fetch(`${baseUrl}/api/sciforge/browser-host/sessions/route-session/frame?workspacePath=${encodeURIComponent(workspacePath)}`);
    assert.equal(missingFrame.status, 404);

    const streamFrame = await readBrowserHostFrameStreamFrame(`${baseUrl.replace(/^http/, 'ws')}/api/sciforge/browser-host/sessions/route-session/frame-stream?workspacePath=${encodeURIComponent(workspacePath)}&intervalMs=1000`);
    assert.equal(streamFrame.message.schemaVersion, BROWSER_HOST_FRAME_STREAM_SCHEMA);
    assert.equal(streamFrame.message.type, 'frame');
    assert.equal(streamFrame.message.captured, true);
    assert.equal(streamFrame.message.frameTransport, 'websocket-binary');
    assert.equal(streamFrame.message.frameMimeType, 'image/png');
    assert.match(streamFrame.message.binaryFrameId, /^route-session:/);
    assert.equal(streamFrame.message.frameStreamMetrics?.sequence, 1);
    assert.equal(streamFrame.message.frameStreamMetrics?.frameBytes, PNG_1X1.byteLength);
    assert.equal(streamFrame.message.frameStreamMetrics?.skippedBackpressure, 0);
    assert.equal(streamFrame.message.frameStreamMetrics?.droppedSinceLastFrame, 0);
    assert.equal(streamFrame.message.session?.id, 'route-session');
    assert.equal(streamFrame.message.session?.singleInteractiveTruth, true);
    assert.equal(streamFrame.message.session?.frameStreamRef, 'browser-host-session:route-session/frame-stream');
    assert.deepEqual(streamFrame.binary, PNG_1X1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession native surface routes fail closed with bounded blocked diagnostics', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-native-surface-routes-'));
  const manager = createRouteManager(workspacePath);
  const routeOptions = {
    manager: manager as unknown as BrowserHostSessionManager,
    workspaceRootFromRequest: async () => workspacePath,
    workspaceRootFromBodyOrRequest: async (body: Record<string, unknown>) => String(body.workspacePath || workspacePath),
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleBrowserHostSessionRoutes(req, res, url, routeOptions).then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not found' }));
      }
    });
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const healthResponse = await fetch(`${baseUrl}/api/sciforge/browser-host/native-surface/health`);
    assert.equal(healthResponse.status, 503);
    const health = await healthResponse.json() as Record<string, unknown>;
    assert.equal(health.ok, false);
    assert.equal(health.schemaVersion, 'sciforge.browser-host.native-surface.preflight.v1');
    assert.equal(health.status, 'blocked');
    assert.equal(health.reason, 'native-bridge-unavailable');
    assert.equal(health.capability, 'browser-host-native-surface');
    assert.equal(health.owner, 'BrowserHostSession');
    assert.equal(health.liveSurfaceTransport, 'native-embedded');
    assert.equal(health.rightPaneBridge, false);
    assert.equal(health.ready, false);

    const attachResponse = await fetch(`${baseUrl}/api/sciforge/browser-host/native-surface/attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath, sessionId: 'native-route-session' }),
    });
    assert.equal(attachResponse.status, 503);
    const attach = await attachResponse.json() as Record<string, unknown>;
    assert.equal(attach.ok, false);
    assert.equal(attach.status, 'blocked');
    assert.equal(attach.action, 'attach');
    assert.equal(attach.sessionId, 'native-route-session');
    assert.equal(attach.rightPaneBridge, false);
    assert.doesNotMatch(JSON.stringify(attach), /frame-stream|webrtc|iframe|proxy/i);

    for (const action of ['resize', 'detach'] as const) {
      const response = await fetch(`${baseUrl}/api/sciforge/browser-host/native-surface/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, sessionId: 'native-route-session', bounds: { x: 1, y: 2, width: 300, height: 200 } }),
      });
      assert.equal(response.status, 503, action);
      const blocked = await response.json() as Record<string, unknown>;
      assert.equal(blocked.ok, false, action);
      assert.equal(blocked.status, 'blocked', action);
      assert.equal(blocked.action, action, action);
      assert.equal(blocked.sessionId, 'native-route-session', action);
      assert.equal(blocked.rightPaneBridge, false, action);
      assert.equal(blocked.detachAvailable, false, action);
      assert.equal(blocked.resizeAvailable, false, action);
    }

    const stateResponse = await fetch(`${baseUrl}/api/sciforge/browser-host/native-surface/state?sessionId=native-route-session`);
    assert.equal(stateResponse.status, 503);
    const state = await stateResponse.json() as Record<string, unknown>;
    assert.equal(state.ok, false);
    assert.equal(state.status, 'blocked');
    assert.equal(state.action, 'state');
    assert.equal(state.sessionId, 'native-route-session');
    assert.equal(state.rightPaneBridge, false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession native surface routes proxy only trusted session-scoped loopback adapter responses', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-native-surface-proxy-'));
  const previousNativeAdapterUrl = process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
  const adapterCalls: Array<{ route: string; method: string; body: Record<string, unknown> }> = [];
  const adapterServer = createServer((req, res) => {
    void (async () => {
      const route = req.url ?? '/';
      const body = req.method === 'POST' ? await readJsonRequest(req) : {};
      adapterCalls.push({ route, method: req.method ?? 'GET', body });
      if (route === '/health' && req.method === 'GET') {
        writeJsonResponse(res, {
          ok: true,
          status: 'ready',
          ready: true,
          owner: 'BrowserHostSession',
          adapterRole: 'display-input-adapter',
          liveSurfaceTransport: 'native-embedded',
          singleInteractiveTruth: true,
          secondTruthSource: false,
          attachAvailable: true,
          detachAvailable: true,
          resizeAvailable: true,
          stateAvailable: true,
          rightPaneBridge: false,
        });
        return;
      }
      if (route === '/sessions/proxy-session/attach' && req.method === 'POST') {
        writeJsonResponse(res, {
          ok: false,
          status: 'blocked',
          reason: 'main-window-unavailable',
          ready: false,
          passClaim: false,
          owner: 'BrowserHostSession',
          adapterRole: 'display-input-adapter',
          liveSurfaceTransport: 'native-embedded',
          singleInteractiveTruth: true,
          secondTruthSource: false,
          sessionId: 'proxy-session',
          liveSurfaceRef: 'browser-host-session:proxy-session/live-surface',
          attachAvailable: true,
          detachAvailable: true,
          resizeAvailable: true,
          stateAvailable: true,
          diagnostics: ['main-window-unavailable'],
        }, 503);
        return;
      }
      if (route === '/sessions/proxy-session/resize' && req.method === 'POST') {
        writeJsonResponse(res, {
          ok: true,
          status: 'resized',
          ready: true,
          passClaim: true,
          owner: 'BrowserHostSession',
          adapterRole: 'display-input-adapter',
          liveSurfaceTransport: 'native-embedded',
          singleInteractiveTruth: true,
          secondTruthSource: false,
          sessionId: 'proxy-session',
          liveSurfaceRef: 'browser-host-session:proxy-session/live-surface',
          attachAvailable: true,
          detachAvailable: true,
          resizeAvailable: true,
          stateAvailable: true,
          bounds: body.bounds,
          embedded: true,
          visible: true,
        });
        return;
      }
      if (route === '/sessions/proxy-session/detach' && req.method === 'POST') {
        writeJsonResponse(res, {
          ok: true,
          status: 'detached',
          ready: true,
          passClaim: false,
          owner: 'BrowserHostSession',
          adapterRole: 'display-input-adapter',
          liveSurfaceTransport: 'native-embedded',
          singleInteractiveTruth: true,
          secondTruthSource: false,
          sessionId: 'proxy-session',
          liveSurfaceRef: 'browser-host-session:proxy-session/live-surface',
          attachAvailable: true,
          detachAvailable: true,
          resizeAvailable: true,
          stateAvailable: true,
          embedded: false,
          visible: false,
        });
        return;
      }
      if (route === '/sessions/forged-session/attach' && req.method === 'POST') {
        writeJsonResponse(res, {
          ok: true,
          status: 'attached',
          ready: true,
          owner: 'BrowserHostSession',
          adapterRole: 'display-input-adapter',
          liveSurfaceTransport: 'native-embedded',
          secondTruthSource: false,
          sessionId: 'forged-session',
          liveSurfaceRef: 'browser-host-session:forged-session/live-surface',
        });
        return;
      }
      if (route === '/sessions/wrong-ref/state' && req.method === 'GET') {
        writeJsonResponse(res, {
          ok: true,
          status: 'ready',
          ready: true,
          owner: 'BrowserHostSession',
          adapterRole: 'display-input-adapter',
          liveSurfaceTransport: 'native-embedded',
          singleInteractiveTruth: true,
          secondTruthSource: false,
          sessionId: 'wrong-ref',
          liveSurfaceRef: 'browser-host-session:other-session/live-surface',
        });
        return;
      }
      if (route === '/sessions/raw-session/attach' && req.method === 'POST') {
        writeJsonResponse(res, {
          ok: true,
          status: 'attached',
          ready: true,
          owner: 'BrowserHostSession',
          adapterRole: 'display-input-adapter',
          liveSurfaceTransport: 'native-embedded',
          singleInteractiveTruth: true,
          secondTruthSource: false,
          sessionId: 'raw-session',
          liveSurfaceRef: 'browser-host-session:raw-session/live-surface',
          currentUrl: 'https://example.test/secret-token',
          providerPayload: 'secret-provider',
          screenshotDataUrl: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
        });
        return;
      }
      writeJsonResponse(res, { ok: false, reason: `unexpected native surface route ${route}` }, 404);
    })().catch((error) => writeJsonResponse(res, { ok: false, reason: error instanceof Error ? error.message : String(error) }, 500));
  });
  const manager = createRouteManager(workspacePath);
  const routeOptions = {
    manager: manager as unknown as BrowserHostSessionManager,
    workspaceRootFromRequest: async () => workspacePath,
    workspaceRootFromBodyOrRequest: async (body: Record<string, unknown>) => String(body.workspacePath || workspacePath),
  };
  const routeServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleBrowserHostSessionRoutes(req, res, url, routeOptions).then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not found' }));
      }
    });
  });

  try {
    await new Promise<void>((resolve) => adapterServer.listen(0, '127.0.0.1', resolve));
    const adapterAddress = adapterServer.address();
    assert.ok(adapterAddress && typeof adapterAddress === 'object');
    process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL = `http://127.0.0.1:${adapterAddress.port}`;

    await new Promise<void>((resolve) => routeServer.listen(0, '127.0.0.1', resolve));
    const routeAddress = routeServer.address();
    assert.ok(routeAddress && typeof routeAddress === 'object');
    const baseUrl = `http://127.0.0.1:${routeAddress.port}`;

    const healthResponse = await fetch(`${baseUrl}/api/sciforge/browser-host/native-surface/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json() as Record<string, unknown>;
    assert.equal(health.ok, true);
    assert.equal(health.status, 'ready');
    assert.equal(health.owner, 'BrowserHostSession');
    assert.equal(health.adapterRole, 'display-input-adapter');
    assert.equal(health.liveSurfaceTransport, 'native-embedded');
    assert.equal(health.singleInteractiveTruth, true);
    assert.equal(health.secondTruthSource, false);
    assert.equal(health.rightPaneBridge, false);

    const attachResponse = await fetch(`${baseUrl}/api/sciforge/browser-host/native-surface/attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath, sessionId: 'proxy-session' }),
    });
    assert.equal(attachResponse.status, 503);
    const attach = await attachResponse.json() as Record<string, unknown>;
    assert.equal(attach.ok, false);
    assert.equal(attach.status, 'blocked');
    assert.equal(attach.reason, 'main-window-unavailable');
    assert.equal(attach.passClaim, false);
    assert.equal(attach.sessionId, 'proxy-session');
    assert.equal(attach.liveSurfaceRef, 'browser-host-session:proxy-session/live-surface');
    assert.equal(attach.singleInteractiveTruth, true);
    assert.equal(attach.secondTruthSource, false);
    assert.equal(attach.detachAvailable, true);
    assert.equal(attach.resizeAvailable, true);

    const resizeResponse = await fetch(`${baseUrl}/api/sciforge/browser-host/native-surface/resize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath,
        sessionId: 'proxy-session',
        bounds: { x: 8, y: 13, width: 987, height: 610 },
      }),
    });
    assert.equal(resizeResponse.status, 200);
    const resize = await resizeResponse.json() as Record<string, unknown>;
    assert.equal(resize.ok, true);
    assert.equal(resize.status, 'resized');
    assert.equal(resize.action, 'resize');
    assert.deepEqual(resize.bounds, { x: 8, y: 13, width: 987, height: 610 });
    assert.equal(resize.liveSurfaceRef, 'browser-host-session:proxy-session/live-surface');
    assert.equal(resize.passClaim, true);
    assert.doesNotMatch(JSON.stringify(resize), /data:image|base64|<html|secret|provider|frame-stream/i);

    const detachResponse = await fetch(`${baseUrl}/api/sciforge/browser-host/native-surface/detach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath, sessionId: 'proxy-session' }),
    });
    assert.equal(detachResponse.status, 200);
    const detach = await detachResponse.json() as Record<string, unknown>;
    assert.equal(detach.ok, true);
    assert.equal(detach.status, 'detached');
    assert.equal(detach.action, 'detach');
    assert.equal(detach.embedded, false);
    assert.equal(detach.visible, false);
    assert.equal(detach.passClaim, false);
    assert.equal(detach.liveSurfaceRef, 'browser-host-session:proxy-session/live-surface');

    const forgedResponse = await fetch(`${baseUrl}/api/sciforge/browser-host/native-surface/attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath, sessionId: 'forged-session' }),
    });
    assert.equal(forgedResponse.status, 503);
    const forged = await forgedResponse.json() as Record<string, unknown>;
    assert.equal(forged.ok, false);
    assert.equal(forged.status, 'blocked');
    assert.equal(forged.reason, 'native-adapter-response-invalid');
    assert.equal(forged.passClaim, false);

    const wrongRefResponse = await fetch(`${baseUrl}/api/sciforge/browser-host/native-surface/state?sessionId=wrong-ref`);
    assert.equal(wrongRefResponse.status, 503);
    const wrongRef = await wrongRefResponse.json() as Record<string, unknown>;
    assert.equal(wrongRef.ok, false);
    assert.equal(wrongRef.reason, 'native-adapter-response-invalid');

    const rawResponse = await fetch(`${baseUrl}/api/sciforge/browser-host/native-surface/attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath, sessionId: 'raw-session' }),
    });
    assert.equal(rawResponse.status, 503);
    const raw = await rawResponse.json() as Record<string, unknown>;
    assert.equal(raw.ok, false);
    assert.equal(raw.reason, 'native-adapter-response-invalid');
    assert.doesNotMatch(JSON.stringify(raw), /example\.test|secret-token|provider|data:image|base64|screenshot/i);

    assert.deepEqual(adapterCalls.map((call) => `${call.method} ${call.route}`), [
      'GET /health',
      'POST /sessions/proxy-session/attach',
      'POST /sessions/proxy-session/resize',
      'POST /sessions/proxy-session/detach',
      'POST /sessions/forged-session/attach',
      'GET /sessions/wrong-ref/state',
      'POST /sessions/raw-session/attach',
    ]);
    assert.deepEqual(adapterCalls.find((call) => call.route === '/sessions/proxy-session/resize')?.body.bounds, {
      x: 8,
      y: 13,
      width: 987,
      height: 610,
    });
  } finally {
    if (previousNativeAdapterUrl === undefined) delete process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
    else process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL = previousNativeAdapterUrl;
    await new Promise<void>((resolve) => routeServer.close(() => resolve()));
    await new Promise<void>((resolve) => adapterServer.close(() => resolve()));
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession frame stream aggregates skipped capture metrics into the next binary frame', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-stream-metrics-'));
  const manager = createRouteManager(workspacePath, { frameStreamSkips: ['busy', 'recent-input'] });
  const routeOptions = {
    manager: manager as unknown as BrowserHostSessionManager,
    workspaceRootFromRequest: async () => workspacePath,
    workspaceRootFromBodyOrRequest: async (body: Record<string, unknown>) => String(body.workspacePath || workspacePath),
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleBrowserHostSessionRoutes(req, res, url, routeOptions).then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not found' }));
      }
    });
  });
  server.on('upgrade', (req, socket, head) => {
    if (!handleBrowserHostSessionUpgrade(req, socket, head, routeOptions)) socket.destroy();
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await postJson(`${baseUrl}/api/sciforge/browser-host/sessions/start`, {
      workspacePath,
      url: 'example.org',
      sessionId: 'metrics-session',
    });
    const streamFrame = await readBrowserHostFrameStreamFrame(`${baseUrl.replace(/^http/, 'ws')}/api/sciforge/browser-host/sessions/metrics-session/frame-stream?workspacePath=${encodeURIComponent(workspacePath)}&intervalMs=125&quietWindowMs=80`);

    assert.equal(streamFrame.message.frameTransport, 'websocket-binary');
    assert.deepEqual(streamFrame.binary, PNG_1X1);
    assert.equal(streamFrame.message.frameStreamMetrics?.sequence, 1);
    assert.equal(streamFrame.message.frameStreamMetrics?.skippedBusy, 1);
    assert.equal(streamFrame.message.frameStreamMetrics?.skippedRecentInput, 1);
    assert.equal(streamFrame.message.frameStreamMetrics?.skippedBackpressure, 0);
    assert.equal(streamFrame.message.frameStreamMetrics?.droppedSinceLastFrame, 2);
    assert.equal(streamFrame.message.frameStreamMetrics?.frameBytes, PNG_1X1.byteLength);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession URL and search helpers normalize user-facing targets', () => {
  assert.equal(normalizeBrowserHostUrl('example.org'), 'https://example.org');
  assert.equal(normalizeBrowserHostUrl('localhost:5173/app'), 'http://localhost:5173/app');
  assert.equal(normalizeBrowserHostUrl('about:blank'), 'about:blank');
  assert.match(browserHostSearchUrl('bing', 'cell atlas', 'us-en'), /^https:\/\/www\.bing\.com\/search\?/);
  assert.match(browserHostSearchUrl('duckduckgo', 'cell atlas', 'wt-wt'), /^https:\/\/duckduckgo\.com\/html\/\?/);
});

test('BrowserHostSession navigation timeout can continue after a committed HTTP navigation', () => {
  assert.equal(browserHostNavigationCommittedAfterTimeout('https://example.org', 'https://example.org/search'), true);
  assert.equal(browserHostNavigationCommittedAfterTimeout('https://example.org', 'http://example.org/'), true);
  assert.equal(browserHostNavigationCommittedAfterTimeout('https://example.org', 'https://sub.example.org/'), true);
  assert.equal(browserHostNavigationCommittedAfterTimeout('https://example.org', 'about:blank'), false);
  assert.equal(browserHostNavigationCommittedAfterTimeout('https://example.org', 'chrome-error://chromewebdata/'), false);
  assert.equal(browserHostNavigationCommittedAfterTimeout('https://example.org', 'https://other.example/'), false);
});

test('BrowserHostSession click and Enter-style press wait through possible page navigation before frame capture', async () => {
  const source = await readFile(new URL('./browser-host-session.ts', import.meta.url), 'utf8');
  assert.match(source, /waitForInteractiveNavigationOrSettle\(beforeUrl\)/);
  assert.match(source, /SCIFORGE_BROWSER_HOST_INTERACTIVE_DOMCONTENTLOADED_SETTLE_MS/);
  assert.match(source, /SCIFORGE_BROWSER_HOST_INTERACTIVE_NAVIGATION_SETTLE_MS/);
});

test('BrowserHostSession screenshots skip blocking web-font readiness before writing placeholder evidence', async () => {
  const source = await readFile(new URL('./browser-host-session.ts', import.meta.url), 'utf8');
  assert.match(source, /PW_TEST_SCREENSHOT_NO_FONTS_READY/);
  assert.match(source, /SCIFORGE_BROWSER_HOST_SCREENSHOT_TIMEOUT_MS/);
});

test('BrowserHostSession full capture reuses the frame screenshot and bounds heavy snapshot work', async () => {
  const source = await readFile(new URL('./browser-host-session.ts', import.meta.url), 'utf8');
  assert.match(source, /copyFile\(frameFile, screenshotFile\)/);
  assert.match(source, /SCIFORGE_BROWSER_HOST_DOM_SNAPSHOT_TIMEOUT_MS/);
  assert.match(source, /SCIFORGE_BROWSER_HOST_AX_SNAPSHOT_TIMEOUT_MS/);
});

test('BrowserHostSession cursor action performs host-owned hit testing without frame capture', async () => {
  const source = await readFile(new URL('./browser-host-session.ts', import.meta.url), 'utf8');
  assert.match(source, /input\.action === 'cursor'/);
  assert.match(source, /document\.elementFromPoint\(x, y\)/);
  assert.match(source, /cursor !== 'auto' && cursor !== 'default'/);
  assert.match(source, /normalizeBrowserHostCursor/);
  assert.match(source, /if \(action === 'cursor'\) return 'none'/);
});

test('BrowserHostSession exposes host-owned low-level mouse operations for real browser gestures', async () => {
  const source = await readFile(new URL('./browser-host-session.ts', import.meta.url), 'utf8');
  assert.match(source, /input\.action === 'mouse-down'/);
  assert.match(source, /input\.action === 'mouse-move'/);
  assert.match(source, /input\.action === 'mouse-up'/);
  assert.match(source, /input\.action === 'drag'/);
  assert.match(source, /page\.mouse\.down/);
  assert.match(source, /page\.mouse\.move/);
  assert.match(source, /page\.mouse\.up/);
  assert.match(source, /nextMouseClickCount/);
  assert.match(source, /clickCount/);
  assert.match(source, /if \(action === 'mouse-down' \|\| action === 'mouse-move'\) return 'none'/);
});

test('BrowserHostSession keeps typing and scrolling low latency for browser surfing', async () => {
  const source = await readFile(new URL('./browser-host-session.ts', import.meta.url), 'utf8');
  assert.match(source, /async type\(text: string\): Promise<void> \{\n    await this\.page\.keyboard\.insertText\(text\);\n    this\.recordNavigation\(\);\n  \}/);
  assert.match(source, /async scroll\(deltaX: number, deltaY: number, x\?: number, y\?: number\): Promise<void> \{\n    if \(x !== undefined && y !== undefined\) await this\.page\.mouse\.move\(x, y\);\n    await this\.page\.mouse\.wheel\(deltaX, deltaY\);\n  \}/);
});

test('BrowserHostSession frame stream skips capture instead of queueing behind active input', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-stream-idle-'));
  const { factory, drivers } = fakeDriverFactory({ holdType: true });
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const session = await manager.openSession(workspacePath, {
      url: 'example.org/stream',
      sessionId: 'stream-session',
    });
    const driver = drivers[0];
    assert.ok(driver);
    const screenshotCallsAfterOpen = driver.screenshotCalls;

    const typing = manager.act(workspacePath, session.id, {
      action: 'type',
      text: 'stream should not block input',
      capture: 'none',
    });
    await waitFor(() => driver.actions.includes('type:stream should not block input'));

    const skipped = await manager.captureFrameIfIdle(workspacePath, session.id, { quietWindowMs: 0 });
    assert.equal(skipped.captured, false);
    assert.equal(skipped.skippedReason, 'busy');
    assert.equal(driver.screenshotCalls, screenshotCallsAfterOpen);
    assert.equal(skipped.session.frameStreamRef, undefined);

    driver.releaseHeldAction();
    await typing;

    const recentInput = await manager.captureFrameIfIdle(workspacePath, session.id, { quietWindowMs: 500 });
    assert.equal(recentInput.captured, false);
    assert.equal(recentInput.skippedReason, 'recent-input');
    assert.equal(driver.screenshotCalls, screenshotCallsAfterOpen);

    const captured = await manager.captureFrameIfIdle(workspacePath, session.id, { quietWindowMs: 0 });
    assert.equal(captured.captured, true);
    assert.equal(driver.screenshotCalls, screenshotCallsAfterOpen + 1);
  } finally {
    drivers[0]?.releaseHeldAction();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession maps Computer Use generic actions onto the host-owned browser without system input', async () => {
  assert.deepEqual(browserHostActionFromComputerUse({ type: 'click', x: 12, y: 34 }), {
    action: 'click',
    x: 12,
    y: 34,
    capture: 'frame',
    timeoutMs: undefined,
  });
  assert.deepEqual(browserHostActionFromComputerUse({ type: 'double_click', x: 12, y: 34 }), {
    action: 'double-click',
    x: 12,
    y: 34,
    capture: 'frame',
    timeoutMs: undefined,
  });
  assert.deepEqual(browserHostActionFromComputerUse({ type: 'type_text', text: 'query text' }), {
    action: 'type',
    text: 'query text',
    capture: 'none',
    timeoutMs: undefined,
  });
  assert.deepEqual(browserHostActionFromComputerUse({ type: 'press_key', key: 'Return' }), {
    action: 'press',
    key: 'Enter',
    capture: 'frame',
    timeoutMs: undefined,
  });
  assert.deepEqual(browserHostActionFromComputerUse({ type: 'scroll', direction: 'down', amount: 300 }), {
    action: 'scroll',
    deltaX: 0,
    deltaY: 300,
    capture: 'none',
    timeoutMs: undefined,
  });
  assert.deepEqual(browserHostActionFromComputerUse({ type: 'mouse_down', x: 7, y: 8, button: 'right' }), {
    action: 'mouse-down',
    x: 7,
    y: 8,
    button: 'right',
    capture: 'none',
    timeoutMs: undefined,
  });
  assert.deepEqual(browserHostActionFromComputerUse({ type: 'mouse_move', x: 9, y: 10 }), {
    action: 'mouse-move',
    x: 9,
    y: 10,
    capture: 'none',
    timeoutMs: undefined,
  });
  assert.deepEqual(browserHostActionFromComputerUse({ type: 'mouse_up', x: 11, y: 12, button: 'middle' }), {
    action: 'mouse-up',
    x: 11,
    y: 12,
    button: 'middle',
    capture: 'frame',
    timeoutMs: undefined,
  });
  assert.deepEqual(browserHostActionFromComputerUse({ type: 'wheel', x: 12.4, y: 88.6, deltaX: 3.2, deltaY: -4.8 }), {
    action: 'scroll',
    x: 12,
    y: 89,
    deltaX: 3,
    deltaY: -5,
    capture: 'none',
    timeoutMs: undefined,
  });
  assert.deepEqual(browserHostActionFromComputerUse({ type: 'cursor', x: 1, y: 2 }), {
    action: 'cursor',
    x: 1,
    y: 2,
    capture: 'none',
    timeoutMs: undefined,
  });
  const drag = browserHostActionFromComputerUse({ type: 'drag', fromX: 0, fromY: 0, toX: 80, toY: 40 });
  assert.equal(drag.action, 'drag');
  assert.equal(drag.path?.length, 9);
  assert.deepEqual(drag.path?.[0], { x: 0, y: 0 });
  assert.deepEqual(drag.path?.[8], { x: 80, y: 40 });
  assert.deepEqual(browserHostComputerUseActionReadiness({
    session: {
      schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
      id: 'hidden-session',
      owner: 'host',
      providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
      status: 'ready',
      workspacePath: '/tmp/workspace',
      requestedUrl: 'https://example.org',
      url: 'https://example.org',
      startedAt: '2026-06-06T00:00:00.000Z',
      updatedAt: '2026-06-06T00:00:00.000Z',
      viewport: { width: 1365, height: 900 },
      canGoBack: false,
      canGoForward: false,
      diagnostics: [],
    },
    action: { type: 'click', x: 1, y: 2 },
    permissionRef: 'permission:turn/hidden-session/ordinary-navigation',
    cancelRef: 'cancel:runtime-turn/hidden-session',
    now: '2026-06-06T00:00:00.000Z',
  }), { status: 'blocked', reason: 'browser-host-session-hidden' });

  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-cu-'));
  const { factory, drivers } = fakeDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const session = await manager.openSession(workspacePath, {
      url: 'example.org/computer-use',
      sessionId: 'cu-session',
    });
    await assert.rejects(
      () => executeBrowserHostComputerUseAction(manager, workspacePath, session.id, { type: 'type_text', text: 'fluid search' }, {
        now: session.updatedAt,
      }),
      /browser-host-session-permission-missing/,
    );
    const result = await executeBrowserHostComputerUseAction(manager, workspacePath, session.id, { type: 'type_text', text: 'fluid search' }, {
      actionId: 'cu-type-action',
      permissionRef: 'permission:turn/cu-session/ordinary-navigation',
      cancelRef: 'cancel:runtime-turn/cu-session',
      now: session.updatedAt,
    });
    assert.equal(result.providerId, BROWSER_HOST_COMPUTER_USE_PROVIDER_ID);
    assert.equal(result.inputChannel, 'browser-host-session');
    assert.equal(result.sharedSystemInputUsed, false);
    assert.equal(result.systemMouseEvents, 'not-sent');
    assert.equal(result.systemKeyboardEvents, 'not-sent');
    assert.equal(result.liveBrowserOwner, 'BrowserHostSession');
    assert.equal(result.singleInteractiveTruth, true);
    assert.equal(result.hostAction.capture, 'none');
    assert.equal(drivers[0]?.actions.at(-1), 'type:fluid search');
    assert.ok(result.session.actorCursor?.lastAction.evidenceRefs.includes('browser-host-session:cu-session/actions/cu-type-action/verification/verifier.json'));
    assert.ok(result.session.actorCursor?.lastAction.evidenceRefs.includes('browser-host-session:cu-session/actions/cu-type-action/freshness-invalidation.json'));
    const verificationJson = await readFile(
      join(browserHostSessionDir(workspacePath, 'cu-session'), 'actions', 'cu-type-action', 'verification', 'verifier.json'),
      'utf8',
    );
    assert.deepEqual(JSON.parse(verificationJson).status, 'recorded');
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

interface FakeBrowserHostDriverOptions {
  failScreenshots?: boolean;
  holdType?: boolean;
  holdNavigation?: boolean;
  holdStop?: boolean;
  failNavigation?: boolean;
  failNavigationUrls?: string[];
  failTextUrls?: string[];
  stayOnSearchPageForSourceNavigation?: boolean;
  contentByUrl?: Record<string, string>;
  textByUrl?: Record<string, string>;
  searchResults?: Array<{ title: string; url: string; snippet: string }>;
  searchResultsByQuery?: Record<string, Array<{ title: string; url: string; snippet: string }>>;
  searchResultsByUrl?: Record<string, Array<{ title: string; url: string; snippet: string }>>;
}

function fakeDriverFactory(options: FakeBrowserHostDriverOptions = {}): {
  factory: BrowserHostSessionDriverFactory;
  drivers: FakeBrowserHostDriver[];
  createInputs: Array<{ sessionId: string; viewport: unknown; timeoutMs: number; workspacePath?: string; workspaceProfileDir?: string }>;
} {
  const drivers: FakeBrowserHostDriver[] = [];
  const createInputs: Array<{ sessionId: string; viewport: unknown; timeoutMs: number; workspacePath?: string; workspaceProfileDir?: string }> = [];
  return {
    drivers,
    createInputs,
    factory: {
      async create(input) {
        createInputs.push(input);
        const driver = new FakeBrowserHostDriver(options);
        drivers.push(driver);
        return driver;
      },
    },
  };
}

class FakeBrowserHostDriver implements BrowserHostSessionDriver {
  currentUrl = 'about:blank';
  actions: string[] = [];
  closed = false;
  contentCalls = 0;
  axSnapshotCalls = 0;
  screenshotCalls = 0;
  lastProgressState?: BrowserHostSessionLoadingProgressState;
  private readonly consoleListeners = new Set<(entry: Record<string, unknown>) => void>();
  private readonly networkListeners = new Set<(entry: Record<string, unknown>) => void>();
  private readonly navigationProgressListeners = new Set<(progress: {
    state: BrowserHostSessionLoadingProgressState;
    reason: BrowserHostSessionLoadingProgressReason;
    source?: BrowserHostSessionLoadingProgressSource;
    canRetry?: boolean;
    blocked?: boolean;
    requiresHandoff?: boolean;
  }) => void>();
  private heldActionResolve?: () => void;
  private heldActionPromise?: Promise<void>;
  private holdNavigation: boolean;

  constructor(private readonly options: FakeBrowserHostDriverOptions = {}) {
    this.holdNavigation = options.holdNavigation === true;
  }

  async goto(url: string): Promise<void> {
    this.actions.push(`goto:${url}`);
    if (this.options.failNavigation) throw new Error(`navigation failed for ${url}: <html><body>secret DOM token=secret-value</body></html>`);
    if (this.options.failNavigationUrls?.includes(url)) throw new Error(`navigation failed for ${url}`);
    if (this.options.stayOnSearchPageForSourceNavigation && isSearchEngineTestUrl(this.currentUrl) && !isSearchEngineTestUrl(url)) {
      this.emitConsole({ level: 'info', text: 'token:secret-value should not leak' });
      this.emitNetwork({ event: 'request', authorization: 'Bearer secret' });
      await this.maybeHoldNavigation();
      return;
    }
    this.currentUrl = normalizeBrowserHostUrl(url);
    this.emitConsole({ level: 'info', text: 'token:secret-value should not leak' });
    this.emitNetwork({ event: 'request', authorization: 'Bearer secret' });
    await this.maybeHoldNavigation();
  }

  url(): string {
    return this.currentUrl;
  }

  async title(): Promise<string> {
    return `Title for ${this.currentUrl}`;
  }

  async content(): Promise<string> {
    this.contentCalls += 1;
    const custom = this.options.contentByUrl?.[this.currentUrl];
    if (custom !== undefined) return custom;
    return '<html><body><a href="https://example.org/browser-host">Browser Host</a><p>Ready</p></body></html>';
  }

  async text(): Promise<string> {
    if (this.options.failTextUrls?.some((url) => normalizeBrowserHostUrl(url) === this.currentUrl)) throw new Error(`text extraction failed for ${this.currentUrl}`);
    const custom = this.options.textByUrl?.[this.currentUrl];
    if (custom !== undefined) return custom;
    return 'Browser Host\nhttps://example.org/browser-host\nReady';
  }

  async screenshot(path: string): Promise<void> {
    this.screenshotCalls += 1;
    if (this.options.failScreenshots) throw new Error('page.screenshot timeout token=secret-value');
    await writeFile(path, PNG_1X1);
  }

  async axSnapshot(): Promise<unknown> {
    this.axSnapshotCalls += 1;
    return { role: 'document', name: 'Fake browser host' };
  }

  async searchResults(): Promise<Array<{ title: string; url: string; snippet: string }>> {
    if (this.options.searchResultsByUrl?.[this.currentUrl]) return this.options.searchResultsByUrl[this.currentUrl];
    const query = searchQueryFromTestUrl(this.currentUrl);
    if (query && this.options.searchResultsByQuery?.[query]) return this.options.searchResultsByQuery[query];
    if (this.options.searchResults) return this.options.searchResults;
    return [
      { title: 'Browser Host', url: 'https://example.org/browser-host', snippet: 'First result' },
      { title: 'Duplicate Browser Host', url: 'https://example.org/browser-host', snippet: 'Duplicate' },
      { title: 'DuckDuckGo self', url: 'https://duckduckgo.com/html/?q=browser-host', snippet: 'Self link' },
      { title: 'MDN Web APIs', url: 'https://developer.mozilla.org/docs/Web/API', snippet: 'Reference docs' },
    ];
  }

  async canGoBack(): Promise<boolean> {
    return this.actions.filter((action) => action.startsWith('goto:')).length > 1;
  }

  async canGoForward(): Promise<boolean> {
    return false;
  }

  async back(): Promise<void> {
    this.actions.push('back');
    await this.maybeHoldNavigation();
  }

  async forward(): Promise<void> {
    this.actions.push('forward');
    await this.maybeHoldNavigation();
  }

  async reload(): Promise<void> {
    this.actions.push('reload');
    await this.maybeHoldNavigation();
  }

  async stop(): Promise<void> {
    this.actions.push('stop');
    if (this.options.holdStop) await this.holdAction();
  }

  async click(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.actions.push(button === 'left' ? `click:${x},${y}` : `click:${button}:${x},${y}`);
  }

  async doubleClick(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.actions.push(button === 'left' ? `double-click:${x},${y}` : `double-click:${button}:${x},${y}`);
  }

  async mouseDown(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.actions.push(`mouse-down:${button}:${x},${y}`);
  }

  async mouseMove(x: number, y: number): Promise<void> {
    this.actions.push(`mouse-move:${x},${y}`);
  }

  async mouseUp(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.actions.push(`mouse-up:${button}:${x},${y}`);
  }

  async drag(path: Array<{ x: number; y: number }>, button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.actions.push(`drag:${button}:${path.map((point) => `${point.x},${point.y}`).join('->')}`);
  }

  async type(text: string): Promise<void> {
    this.actions.push(`type:${text}`);
    if (this.options.holdType) await this.holdAction();
  }

  async press(key: string): Promise<void> {
    this.actions.push(`press:${key}`);
  }

  async scroll(deltaX: number, deltaY: number, x?: number, y?: number): Promise<void> {
    this.actions.push(x !== undefined && y !== undefined ? `scroll:${deltaX},${deltaY}@${x},${y}` : `scroll:${deltaX},${deltaY}`);
  }

  async cursor(x: number, y: number): Promise<string> {
    this.actions.push(`cursor:${x},${y}`);
    return 'pointer';
  }

  async close(): Promise<void> {
    this.closed = true;
    this.actions.push('close');
  }

  onConsole(listener: (entry: Record<string, unknown>) => void): void {
    this.consoleListeners.add(listener);
  }

  onNetwork(listener: (entry: Record<string, unknown>) => void): void {
    this.networkListeners.add(listener);
  }

  onNavigationProgress(listener: (progress: {
    state: BrowserHostSessionLoadingProgressState;
    reason: BrowserHostSessionLoadingProgressReason;
    source?: BrowserHostSessionLoadingProgressSource;
    canRetry?: boolean;
    blocked?: boolean;
    requiresHandoff?: boolean;
  }) => void): void {
    this.navigationProgressListeners.add(listener);
  }

  emitNavigationProgress(progress: {
    state: BrowserHostSessionLoadingProgressState;
    reason: BrowserHostSessionLoadingProgressReason;
    source?: BrowserHostSessionLoadingProgressSource;
    canRetry?: boolean;
    blocked?: boolean;
    requiresHandoff?: boolean;
  }): void {
    this.lastProgressState = progress.state;
    for (const listener of this.navigationProgressListeners) listener(progress);
  }

  private emitConsole(entry: Record<string, unknown>) {
    for (const listener of this.consoleListeners) listener(entry);
  }

  private emitNetwork(entry: Record<string, unknown>) {
    for (const listener of this.networkListeners) listener(entry);
  }

  releaseHeldAction(): void {
    this.heldActionResolve?.();
    this.heldActionResolve = undefined;
    this.heldActionPromise = undefined;
  }

  holdNextNavigation(): void {
    this.holdNavigation = true;
  }

  isHoldingAction(): boolean {
    return this.heldActionResolve !== undefined;
  }

  private async maybeHoldNavigation(): Promise<void> {
    if (!this.holdNavigation) return;
    this.holdNavigation = false;
    await this.holdAction();
  }

  private holdAction(): Promise<void> {
    this.heldActionPromise ??= new Promise<void>((resolve) => {
      this.heldActionResolve = resolve;
    });
    return this.heldActionPromise;
  }
}

function searchQueryFromTestUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.searchParams.get('q') ?? undefined;
  } catch {
    return undefined;
  }
}

function isSearchEngineTestUrl(value: string) {
  try {
    const url = new URL(value);
    return /(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)google\.[a-z.]+$/i.test(url.hostname);
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const startedAt = Date.now();
  while (!await predicate()) {
    if (Date.now() - startedAt > 1000) throw new Error('Timed out waiting for BrowserHostSession test condition.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createRouteManager(
  workspacePath: string,
  options: { frameStreamSkips?: NonNullable<BrowserHostFrameCaptureResult['skippedReason']>[] } = {},
) {
  const sessions = new Map<string, BrowserHostSessionState>();
  const framePaths = new Map<string, string>();
  const actionInputs: Array<{ root: string; sessionId: string; input: Record<string, unknown> }> = [];
  const openReadInputs: Array<{ root: string; input: BrowserHostOpenReadInput }> = [];
  let frameStreamSkipIndex = 0;
  const captureFrame = async (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`missing ${sessionId}`);
    const framePath = join(workspacePath, `${sessionId}-frame.png`);
    await writeFile(framePath, PNG_1X1);
    framePaths.set(sessionId, framePath);
    session.frameRef = `browser-host-session:${sessionId}/frame.png`;
    session.frameStreamRef = `browser-host-session:${sessionId}/frame-stream`;
    session.liveSurfaceRef = `browser-host-session:${sessionId}/live-surface`;
    session.liveSurfaceTransport = 'host-stream';
    session.singleInteractiveTruth = true;
    session.updatedAt = new Date().toISOString();
    return session;
  };
  return {
    actionInputs,
    openReadInputs,
    async openSession(root: string, input: { url: string; sessionId?: string }) {
      const id = input.sessionId || 'route-session';
      const session: BrowserHostSessionState = {
        schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
        id,
        owner: 'host',
        providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
        status: 'ready',
        workspacePath: root,
        requestedUrl: normalizeBrowserHostUrl(input.url),
        url: normalizeBrowserHostUrl(input.url),
        startedAt: '2026-06-01T00:00:00.000Z',
        updatedAt: new Date().toISOString(),
        viewport: { width: 1365, height: 900 },
        canGoBack: false,
        canGoForward: false,
        liveSurfaceRef: `browser-host-session:${id}/live-surface`,
        singleInteractiveTruth: true,
        diagnostics: [],
      };
      sessions.set(id, session);
      return session;
    },
    async sessionState(_root: string, sessionId: string) {
      return sessions.get(sessionId);
    },
    async act(root: string, sessionId: string, input: Record<string, unknown>) {
      actionInputs.push({
        root,
        sessionId,
        input: {
          ...input,
          expectedProofNames: Array.isArray(input.expectedProofNames) ? input.expectedProofNames.slice() : input.expectedProofNames,
        },
      });
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`missing ${sessionId}`);
      if (input.action === 'navigate' && input.url) session.url = normalizeBrowserHostUrl(String(input.url));
      if (
        input.action === 'native-os-ui-proof' &&
        input.proofGroup === 'cursorCaret' &&
        input.probe === 'focus-caret' &&
        Array.isArray(input.expectedProofNames) &&
        input.expectedProofNames.includes('input-caret-visible') &&
        input.expectedProofNames.includes('focus-blur-restore')
      ) {
        session.nativeOsUiProof = {
          schemaVersion: 'sciforge.browser-host-session.native-os-ui-proof.v1',
          boundedEvidenceOnly: true,
          rawDomRecorded: false,
          rawTextRecorded: false,
          rawUrlRecorded: false,
          rawTitleRecorded: false,
          rawSelectorRecorded: false,
          rawCoordsRecorded: false,
          rawPayloadRecorded: false,
          source: 'native-embedded-action-state',
          proofGroup: 'cursorCaret',
          actionId: typeof input.actionId === 'string' ? input.actionId : 'route-native-proof',
          observedProofNames: ['input-caret-visible', 'focus-blur-restore'],
          evidenceTokens: ['proof:input-caret-visible:observed', 'proof:focus-blur-restore:observed'],
          diagnostics: ['proof:input-caret-visible:observed'],
        };
      }
      session.updatedAt = new Date().toISOString();
      return session;
    },
    async search(_root: string, input: BrowserHostSearchInput) {
      const session = input.sessionId && sessions.get(input.sessionId)
        ? await this.act(workspacePath, input.sessionId, { action: 'navigate', url: 'https://www.bing.com/search?q=query' })
        : await this.openSession(workspacePath, { url: 'https://www.bing.com/search?q=query', sessionId: 'search-route' });
      const search: BrowserHostSearchOutput = {
        schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
        query: 'query text',
        engine: 'bing',
        searchUrl: 'https://www.bing.com/search?q=query',
        finalUrl: session.url,
        searchedAt: '2026-06-01T00:00:01.000Z',
        results: [{ title: 'Result', url: 'https://example.org/result', snippet: 'Snippet' }],
        session,
        searchResultRef: 'browser-host-session:search-route/search-results.json',
      };
      return search;
    },
    async openRead(root: string, input: BrowserHostOpenReadInput): Promise<BrowserHostOpenReadOutput> {
      openReadInputs.push({ root, input: { ...input } });
      const session = input.sessionId && sessions.get(input.sessionId)
        ? await this.act(workspacePath, input.sessionId, { action: 'navigate', url: input.url })
        : await this.openSession(workspacePath, { url: input.url, sessionId: input.sessionId ?? 'open-read-route' });
      return {
        sourcePage: {
          resultIndex: 0,
          title: input.title ?? input.url,
          url: normalizeBrowserHostUrl(input.url),
          finalUrl: session.url,
          openedAt: '2026-06-01T00:00:02.000Z',
          status: 'read',
          sourcePageRef: `browser-host-session:${session.id}/source-pages/source-1-route.source.json`,
          textRef: `browser-host-session:${session.id}/source-pages/source-1-route.txt`,
          textPreview: 'Route open_read page text evidence',
          textArtifactKind: 'page-text',
          textCharCount: 34,
        },
        session,
      };
    },
    async framePath(_root: string, sessionId: string) {
      return framePaths.get(sessionId);
    },
    async captureFrame(_root: string, sessionId: string) {
      return captureFrame(sessionId);
    },
    async captureFrameIfIdle(_root: string, sessionId: string) {
      const skippedReason = options.frameStreamSkips?.[frameStreamSkipIndex];
      if (skippedReason) {
        frameStreamSkipIndex += 1;
        const session = sessions.get(sessionId);
        if (!session) throw new Error(`missing ${sessionId}`);
        return { session, captured: false, skippedReason };
      }
      return { session: await captureFrame(sessionId), captured: true };
    },
  };
}

async function readBrowserHostFrameStreamFrame(url: string): Promise<{ message: Record<string, any>; binary: Buffer }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let frameMessage: Record<string, any> | undefined;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timed out waiting for BrowserHostSession frame stream message.'));
    }, 3000);
    ws.on('message', (data, isBinary) => {
      if (isBinary && frameMessage) {
        clearTimeout(timeout);
        ws.close();
        resolve({ message: frameMessage, binary: Buffer.from(data as Buffer) });
        return;
      }
      if (isBinary) return;
      const message = JSON.parse(String(data)) as Record<string, any>;
      if (message.type !== 'frame') return;
      frameMessage = message;
      if (message.frameTransport !== 'websocket-binary') {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`Expected websocket-binary BrowserHostSession frame, got ${String(message.frameTransport)}`));
      }
    });
    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function readRefFile(sessionDir: string, ref: string | undefined) {
  assert.ok(ref);
  return readFile(join(sessionDir, basename(ref)), 'utf8');
}

async function readJsonRequest(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

async function writeNativeEvidenceResponse(
  route: string,
  body: Record<string, unknown>,
  outputKind: 'screenshot' | 'dom' | 'text' | 'ax',
  bytes: Buffer | string,
): Promise<Record<string, unknown>> {
  const outputPath = typeof body.outputPath === 'string' ? body.outputPath : '';
  const sessionId = /\/sessions\/([^/]+)\//.exec(route)?.[1] ?? 'unknown';
  if (!outputPath) {
    return {
      ok: false,
      sessionId,
      outputKind,
      reason: 'raw-native-evidence-route-disabled',
    };
  }
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
  return {
    ok: true,
    sessionId: decodeURIComponent(sessionId),
    outputKind,
    bytesWritten: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

function assertNoRawNativeBridgePayload(serialized: string): void {
  assert.doesNotMatch(
    serialized,
    /data:image|;base64|iVBORw0KGgo|<\s*(?:!doctype|html|body|input)\b|secret-token|provider-payload|Native embedded page text|AX secret-token|https:\/\/example\.org\/result/i,
  );
}

function writeJsonResponse(res: ServerResponse, body: Record<string, unknown>, statusCode = 200): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status !== 200) assert.fail(await response.text());
  return response.json() as Promise<Record<string, any>>;
}
