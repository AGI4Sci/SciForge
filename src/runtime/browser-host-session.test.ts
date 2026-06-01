import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
  type BrowserHostSearchInput,
  type BrowserHostSearchOutput,
  type BrowserHostSessionDriver,
  type BrowserHostSessionDriverFactory,
  type BrowserHostSessionState,
} from './browser-host-session.js';
import {
  BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
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
    assert.match(session.frameRef ?? '', /^browser-host-session:session-a\/frame\.png$/);
    assert.match(session.screenshotRef ?? '', /^browser-host-session:session-a\/screenshot-/);
    assert.match(session.domSnapshotRef ?? '', /^browser-host-session:session-a\/dom-/);
    assert.match(session.axSnapshotRef ?? '', /^browser-host-session:session-a\/ax-/);
    assert.match(session.consoleLogRef ?? '', /^browser-host-session:session-a\/console-/);
    assert.match(session.networkLogRef ?? '', /^browser-host-session:session-a\/network-/);
    assert.equal(session.lastActionTiming?.action, 'open');
    assert.equal(session.lastActionTiming?.capture, 'full');
    assert.equal(session.lastActionTiming?.status, 'ok');
    assert.ok((session.lastActionTiming?.totalMs ?? -1) >= 0);
    assert.equal(session.lastActionTiming?.paintAckSource, 'host-stream-frame');
    assert.ok(session.actionTimingSummary?.some((row) => row.action === 'open' && row.count === 1));

    const framePath = await manager.framePath(workspacePath, 'session-a');
    assert.ok(framePath?.endsWith('/frame.png'));
    assert.ok(framePath);
    assert.deepEqual(await readFile(framePath), PNG_1X1);

    const sessionDir = browserHostSessionDir(workspacePath, 'session-a');
    const manifest = JSON.parse(await readFile(join(sessionDir, 'session.json'), 'utf8')) as BrowserHostSessionState;
    assert.equal(manifest.url, 'https://example.org/start');
    assert.equal(manifest.loadingProgress?.state, 'network-quiet');
    assert.equal(manifest.loadingProgress?.refs.frame, manifest.frameRef);
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
    await manager.act(workspacePath, 'session-a', { action: 'scroll', deltaY: 240 });
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
      'scroll:0,240',
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
    assert.doesNotMatch(JSON.stringify(openingState?.loadingProgress), /progress\.example|secret-value|<html|Ready/);

    drivers[0]?.releaseHeldAction();
    const opened = await opening;
    assert.equal(opened.status, 'ready');
    assert.equal(opened.loadingProgress?.state, 'network-quiet');
    assert.equal(opened.loadingProgress?.reason, 'host-ready');
    assert.equal(opened.loadingProgress?.source, 'host-session');
    assert.equal(opened.loadingProgress?.action, 'open');
    assert.equal(opened.loadingProgress?.refs.frame, opened.frameRef);

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
    assert.doesNotMatch(JSON.stringify(navigatingState?.loadingProgress), /progress\.example|secret-value|<html|Ready/);

    drivers[0]?.releaseHeldAction();
    const navigated = await navigating;
    assert.equal(navigated.status, 'ready');
    assert.equal(navigated.loadingProgress?.state, 'network-quiet');
    assert.equal(navigated.loadingProgress?.reason, 'host-ready');
    assert.equal(navigated.loadingProgress?.source, 'host-session');
    assert.equal(navigated.loadingProgress?.action, 'navigate');

    for (const action of ['back', 'forward', 'reload'] as const) {
      const state = await manager.act(workspacePath, opened.id, { action });
      assert.equal(state.loadingProgress?.state, 'network-quiet');
      assert.equal(state.loadingProgress?.reason, 'host-ready');
      assert.equal(state.loadingProgress?.source, 'host-session');
      assert.equal(state.loadingProgress?.action, action);
    }
  } finally {
    drivers[0]?.releaseHeldAction();
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

test('BrowserHostSessionManager can drive a native embedded BrowserHostSession adapter without frame-stream live fallback', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-native-'));
  const calls: Array<{ route: string; body: Record<string, unknown> }> = [];
  let currentUrl = 'about:blank';
  const server = createServer((req, res) => {
    void (async () => {
      const route = req.url ?? '/';
      const body = req.method === 'POST' ? await readJsonRequest(req) : {};
      calls.push({ route, body });
      if (route === '/sessions/start') writeJsonResponse(res, { ok: true, sessionId: body.sessionId });
      else if (route.endsWith('/navigate')) {
        currentUrl = normalizeBrowserHostUrl(String(body.url ?? 'about:blank'));
        writeJsonResponse(res, { ok: true, url: currentUrl, title: 'Native embedded page', canGoBack: false, canGoForward: false });
      } else if (route.endsWith('/state')) {
        writeJsonResponse(res, { ok: true, url: currentUrl, title: 'Native embedded page', canGoBack: false, canGoForward: false });
      } else if (route.endsWith('/screenshot')) {
        writeJsonResponse(res, { ok: true, dataUrl: `data:image/png;base64,${PNG_1X1.toString('base64')}` });
      } else if (route.endsWith('/content')) {
        writeJsonResponse(res, { ok: true, content: '<html><body><a href="https://example.org/result">Result</a></body></html>' });
      } else if (route.endsWith('/text')) {
        writeJsonResponse(res, { ok: true, text: 'Native embedded page text' });
      } else if (route.endsWith('/ax')) {
        writeJsonResponse(res, { ok: true, snapshot: { role: 'document', name: 'Native embedded page' } });
      } else if (route.includes('/search-results')) {
        writeJsonResponse(res, { ok: true, results: [{ title: 'Result', url: 'https://example.org/result', snippet: 'Native result' }] });
      } else if (route.endsWith('/actions')) {
        writeJsonResponse(res, { ok: true, url: currentUrl, title: 'Native embedded page', canGoBack: false, canGoForward: false, diagnostics: body.action === 'cursor' ? ['cursor:pointer'] : [] });
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

    assert.equal(session.status, 'ready');
    assert.equal(session.url, 'https://example.org/native');
    assert.equal(session.liveSurfaceTransport, 'native-embedded');
    assert.equal(session.nativeAdapterUrl, `http://127.0.0.1:${address.port}`);
    assert.equal(session.singleInteractiveTruth, true);
    assert.equal(session.frameStreamRef, undefined);
    assert.match(session.liveSurfaceRef ?? '', /^browser-host-session:native-session\/live-surface$/);
    assert.equal(session.frameRef, undefined);
    assert.match(session.screenshotRef ?? '', /^browser-host-session:native-session\/screenshot-/);
    assert.equal(clicked.liveSurfaceTransport, 'native-embedded');
    assert.equal(clicked.frameStreamRef, undefined);
    assert.equal(clicked.lastActionTiming?.action, 'click');
    assert.equal(clicked.lastActionTiming?.capture, 'none');
    assert.equal(clicked.lastActionTiming?.paintAckSource, 'native-adapter-action-state');
    assert.equal(cursor.cursor, 'pointer');
    assert.deepEqual(calls.find((call) => call.route === '/sessions/start')?.body.sessionId, 'native-session');
    assert.ok(calls.some((call) => call.route.endsWith('/actions') && call.body.action === 'click'));
  } finally {
    server.close();
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
    assert.match(output.searchResultRef, /^browser-host-session:/);
    assert.match(browserHostSearchSummary(output), /BrowserHostSession search: browser host session/);

    const visible = await manager.openSession(workspacePath, { url: 'https://example.org/visible', sessionId: 'visible-search-session' });
    const reused = await manager.search(workspacePath, {
      query: 'visible browser',
      sessionId: visible.id,
      limit: 1,
    });
    assert.equal(reused.session.id, visible.id);
    assert.equal(drivers.length, 2);
    assert.ok(drivers[1]?.actions.some((action) => action.startsWith('goto:https://www.bing.com/search?')));
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
    assert.match(session.frameRef ?? '', /^browser-host-session:placeholder-session\/frame\.png$/);
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

    const computerUseAction = await postJson(`${baseUrl}/api/sciforge/browser-host/sessions/route-session/computer-use-actions`, {
      workspacePath,
      action: { type: 'click', x: 22, y: 33 },
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
  assert.match(source, /async scroll\(deltaX: number, deltaY: number\): Promise<void> \{\n    await this\.page\.mouse\.wheel\(deltaX, deltaY\);\n  \}/);
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
    assert.equal(skipped.session.frameStreamRef, 'browser-host-session:stream-session/frame-stream');

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
  assert.deepEqual(browserHostActionFromComputerUse({ type: 'wheel', deltaX: 3.2, deltaY: -4.8 }), {
    action: 'scroll',
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

  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-cu-'));
  const { factory, drivers } = fakeDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const session = await manager.openSession(workspacePath, {
      url: 'example.org/computer-use',
      sessionId: 'cu-session',
    });
    const result = await executeBrowserHostComputerUseAction(manager, workspacePath, session.id, { type: 'type_text', text: 'fluid search' });
    assert.equal(result.providerId, BROWSER_HOST_COMPUTER_USE_PROVIDER_ID);
    assert.equal(result.inputChannel, 'browser-host-session');
    assert.equal(result.sharedSystemInputUsed, false);
    assert.equal(result.systemMouseEvents, 'not-sent');
    assert.equal(result.systemKeyboardEvents, 'not-sent');
    assert.equal(result.liveBrowserOwner, 'BrowserHostSession');
    assert.equal(result.singleInteractiveTruth, true);
    assert.equal(result.hostAction.capture, 'none');
    assert.equal(drivers[0]?.actions.at(-1), 'type:fluid search');
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

function fakeDriverFactory(options: { failScreenshots?: boolean; holdType?: boolean; holdNavigation?: boolean; failNavigation?: boolean } = {}): { factory: BrowserHostSessionDriverFactory; drivers: FakeBrowserHostDriver[] } {
  const drivers: FakeBrowserHostDriver[] = [];
  return {
    drivers,
    factory: {
      async create() {
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
  private readonly consoleListeners = new Set<(entry: Record<string, unknown>) => void>();
  private readonly networkListeners = new Set<(entry: Record<string, unknown>) => void>();
  private heldActionResolve?: () => void;
  private heldActionPromise?: Promise<void>;
  private holdNavigation: boolean;

  constructor(private readonly options: { failScreenshots?: boolean; holdType?: boolean; holdNavigation?: boolean; failNavigation?: boolean } = {}) {
    this.holdNavigation = options.holdNavigation === true;
  }

  async goto(url: string): Promise<void> {
    this.actions.push(`goto:${url}`);
    if (this.options.failNavigation) throw new Error(`navigation failed for ${url}: <html><body>secret DOM token=secret-value</body></html>`);
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
    return '<html><body><a href="https://example.org/browser-host">Browser Host</a><p>Ready</p></body></html>';
  }

  async text(): Promise<string> {
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

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    this.actions.push(`scroll:${deltaX},${deltaY}`);
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

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
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
    session.updatedAt = '2026-06-01T00:00:02.000Z';
    return session;
  };
  return {
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
        updatedAt: '2026-06-01T00:00:00.000Z',
        viewport: { width: 1365, height: 900 },
        canGoBack: false,
        canGoForward: false,
        diagnostics: [],
      };
      sessions.set(id, session);
      return session;
    },
    async sessionState(_root: string, sessionId: string) {
      return sessions.get(sessionId);
    },
    async act(_root: string, sessionId: string, input: { action: string; url?: string }) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`missing ${sessionId}`);
      if (input.action === 'navigate' && input.url) session.url = normalizeBrowserHostUrl(input.url);
      session.updatedAt = '2026-06-01T00:00:01.000Z';
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
        results: [{ title: 'Result', url: 'https://example.org/result', snippet: 'Snippet' }],
        session,
        searchResultRef: 'browser-host-session:search-route/search-results.json',
      };
      return search;
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
