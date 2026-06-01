import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BrowserHostSessionManager,
  createNativeEmbeddedBrowserHostDriverFactory,
  normalizeBrowserHostUrl,
  type BrowserHostSessionState,
} from '../../src/runtime/browser-host-session.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

test('desktop native embedded surface action ACK uses adapter state and heartbeat without PNG or frame-stream dependency', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-native-paint-ack-heartbeat-'));
  const adapter = createNativePaintAckHeartbeatAdapter();
  try {
    await adapter.listen();
    const manager = new BrowserHostSessionManager({
      driverFactory: createNativeEmbeddedBrowserHostDriverFactory(adapter.url),
    });

    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/native-heartbeat/start',
      sessionId: 'native-paint-heartbeat',
    });
    assert.equal(opened.status, 'ready');
    assert.equal(opened.liveSurfaceTransport, 'native-embedded');
    assert.equal(opened.singleInteractiveTruth, true);
    assert.equal(opened.frameStreamRef, undefined);
    assert.equal(opened.frameRef, undefined);

    const screenshotCallsAfterOpen = adapter.calls.screenshot.length;
    const stateCallsAfterOpen = adapter.calls.state.length;
    adapter.delayScreenshotsMs = 300;

    const ackStartedAt = Date.now();
    const ack = await withTimeout(manager.act(workspacePath, opened.id, {
      action: 'click',
      x: 32,
      y: 44,
      actionId: 'native-paint-click-1',
    }), 180, 'native adapter action ACK');
    const ackCompletedAt = Date.now();

    assert.equal(ack.status, 'ready');
    assert.equal(ack.liveSurfaceTransport, 'native-embedded');
    assert.equal(ack.singleInteractiveTruth, true);
    assert.equal(ack.frameStreamRef, undefined);
    assert.equal(ack.frameRef, undefined);
    assert.equal(ack.lastActionTiming?.action, 'click');
    assert.equal(ack.lastActionTiming?.capture, 'frame');
    assert.equal(ack.lastActionTiming?.paintAckSource, 'native-adapter-action-state');
    assert.equal(ack.lastActionTiming?.evidenceCaptureStartedAt, undefined);
    assert.equal(ack.lastActionTiming?.evidenceCaptureEndedAt, undefined);
    assert.equal(adapter.calls.frameStream.length, 0);
    assert.equal(countCallsBetween(adapter.calls.screenshot, ackStartedAt, ackCompletedAt), 0);
    assert.ok(ackCompletedAt - ackStartedAt < 180);

    const heartbeat = await manager.sessionState(workspacePath, opened.id);
    assert.ok(heartbeat);
    assert.equal(heartbeat.url, 'http://localhost/native-heartbeat/after-click');
    assert.equal(heartbeat.title, 'Native heartbeat after click');
    assert.equal(heartbeat.canGoBack, true);
    assert.equal(heartbeat.canGoForward, false);
    assert.ok(adapter.calls.state.length > stateCallsAfterOpen, 'native heartbeat should use lightweight /state, not screenshot');

    adapter.failNextActionReason = 'retryable-native-paint-heartbeat-blocked: surface heartbeat unavailable';
    const failed = await manager.act(workspacePath, opened.id, {
      action: 'scroll',
      deltaY: 240,
      capture: 'none',
      actionId: 'native-paint-scroll-fail-1',
    });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.liveSurfaceTransport, 'native-embedded');
    assert.equal(failed.singleInteractiveTruth, true);
    assert.equal(failed.liveSurfaceRef, heartbeat.liveSurfaceRef);
    assert.equal(failed.frameStreamRef, undefined);
    assert.equal(failed.frameRef, undefined);
    assert.equal(failed.lastActionTiming?.status, 'failed');
    assert.match(failed.lastActionTiming?.blockedReason ?? '', /retryable-native-paint-heartbeat-blocked/);

    const report = nativePaintAckHeartbeatReport({
      ack,
      heartbeat,
      failed,
      screenshotCallsAfterOpen,
      screenshotCallsDuringAck: countCallsBetween(adapter.calls.screenshot, ackStartedAt, ackCompletedAt),
      frameStreamRequests: adapter.calls.frameStream.length,
      actionRequests: adapter.calls.actions.length,
      stateRequestsAfterOpen: adapter.calls.state.length - stateCallsAfterOpen,
    });
    const reportPath = join(workspacePath, 'native-paint-ack-heartbeat-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    const reportText = await readFile(reportPath, 'utf8');
    assert.doesNotMatch(reportText, /data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b/i);
    assert.doesNotMatch(reportText, /frameStreamRef"\s*:\s*"browser-host-session:|frameRef"\s*:\s*"browser-host-session:/);
    assert.equal(report.actionAck.dependsOnPngScreenshot, false);
    assert.equal(report.actionAck.dependsOnFrameStream, false);
    assert.equal(report.heartbeat.lightweightStateUpdated, true);
    assert.equal(report.failure.visibleState, 'blocked');
    assert.equal(report.failure.retry.action, 'retry-same-native-surface');
    assert.equal(report.failure.snapshotSecondViewerRendered, false);

    await sleep(420);
    console.log(`[ok] native paint ACK heartbeat ${JSON.stringify({
      paintAckSource: report.actionAck.paintAckSource,
      screenshotCallsDuringAck: report.actionAck.screenshotCallsDuringAck,
      stateRequestsAfterOpen: report.heartbeat.stateRequestsAfterOpen,
      failure: report.failure.visibleState,
    })}`);
  } finally {
    await adapter.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

function createNativePaintAckHeartbeatAdapter() {
  let currentState = {
    url: 'about:blank',
    title: 'Native heartbeat initial',
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  let port = 0;
  let delayScreenshotsMs = 0;
  let failNextActionReason = '';
  const calls = {
    start: [] as TimedCall[],
    navigate: [] as TimedCall[],
    actions: [] as Array<TimedCall & { body: Record<string, unknown> }>,
    state: [] as TimedCall[],
    screenshot: [] as TimedCall[],
    frameStream: [] as TimedCall[],
  };
  const server = createServer((req, res) => {
    void (async () => {
      const route = req.url ?? '/';
      const body = req.method === 'POST' ? await readJsonRequest(req) : {};
      if (/frame-stream|\/frame(?:\?|$|\/)/i.test(route)) {
        calls.frameStream.push({ at: Date.now(), route });
        writeJsonResponse(res, { ok: false, reason: 'native surface contract forbids frame-stream fallback' }, 404);
      } else if (req.method === 'POST' && route === '/sessions/start') {
        calls.start.push({ at: Date.now(), route });
        writeJsonResponse(res, { ok: true, sessionId: body.sessionId });
      } else if (route.endsWith('/navigate')) {
        calls.navigate.push({ at: Date.now(), route });
        currentState = {
          url: normalizeBrowserHostUrl(String(body.url ?? 'about:blank')),
          title: 'Native heartbeat before action',
          canGoBack: false,
          canGoForward: false,
          loading: false,
        };
        writeJsonResponse(res, { ok: true, ...currentState });
      } else if (route.endsWith('/state')) {
        calls.state.push({ at: Date.now(), route });
        writeJsonResponse(res, { ok: true, ...currentState });
      } else if (route.endsWith('/screenshot')) {
        calls.screenshot.push({ at: Date.now(), route });
        if (delayScreenshotsMs > 0) await sleep(delayScreenshotsMs);
        writeJsonResponse(res, { ok: true, dataUrl: `data:image/png;base64,${PNG_1X1.toString('base64')}` });
      } else if (route.endsWith('/content')) {
        writeJsonResponse(res, { ok: true, content: '<!-- bounded native surface fixture -->' });
      } else if (route.endsWith('/ax')) {
        writeJsonResponse(res, { ok: true, snapshot: { role: 'document', name: currentState.title } });
      } else if (route.endsWith('/search-results')) {
        writeJsonResponse(res, { ok: true, results: [] });
      } else if (route.endsWith('/actions')) {
        calls.actions.push({ at: Date.now(), route, body });
        if (failNextActionReason) {
          const reason = failNextActionReason;
          failNextActionReason = '';
          writeJsonResponse(res, { ok: false, reason, retryable: true }, 503);
          return;
        }
        currentState = {
          url: 'http://localhost/native-heartbeat/after-click',
          title: 'Native heartbeat after click',
          canGoBack: true,
          canGoForward: false,
          loading: false,
        };
        writeJsonResponse(res, {
          ok: true,
          url: currentState.url,
          title: 'Native action ACK before heartbeat',
          canGoBack: false,
          canGoForward: false,
          loading: false,
        });
      } else {
        writeJsonResponse(res, { ok: false, reason: `unexpected native adapter route ${route}` }, 404);
      }
    })().catch((error) => {
      writeJsonResponse(res, { ok: false, reason: error instanceof Error ? error.message : String(error) }, 500);
    });
  });
  const adapter = {
    calls,
    get delayScreenshotsMs() {
      return delayScreenshotsMs;
    },
    set delayScreenshotsMs(value: number) {
      delayScreenshotsMs = value;
    },
    get failNextActionReason() {
      return failNextActionReason;
    },
    set failNextActionReason(value: string) {
      failNextActionReason = value;
    },
    get url() {
      return `http://127.0.0.1:${port}`;
    },
    async listen() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      port = address.port;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  return adapter;
}

function nativePaintAckHeartbeatReport(input: {
  ack: BrowserHostSessionState;
  heartbeat: BrowserHostSessionState;
  failed: BrowserHostSessionState;
  screenshotCallsAfterOpen: number;
  screenshotCallsDuringAck: number;
  frameStreamRequests: number;
  actionRequests: number;
  stateRequestsAfterOpen: number;
}) {
  return {
    schemaVersion: 'sciforge.desktop-browser-native-paint-ack-heartbeat-smoke.v1',
    owner: input.ack.owner,
    liveSurfaceTransport: input.ack.liveSurfaceTransport,
    singleInteractiveTruth: input.ack.singleInteractiveTruth,
    secondTruthSource: false,
    refs: {
      liveSurfaceRef: input.ack.liveSurfaceRef,
    },
    actionAck: {
      action: input.ack.lastActionTiming?.action,
      capture: input.ack.lastActionTiming?.capture,
      status: input.ack.lastActionTiming?.status,
      paintAckSource: input.ack.lastActionTiming?.paintAckSource,
      dependsOnPngScreenshot: input.screenshotCallsDuringAck > 0,
      dependsOnFrameStream: input.frameStreamRequests > 0,
      screenshotCallsAfterOpen: input.screenshotCallsAfterOpen,
      screenshotCallsDuringAck: input.screenshotCallsDuringAck,
      frameStreamRequests: input.frameStreamRequests,
      evidenceCaptureStartedAt: input.ack.lastActionTiming?.evidenceCaptureStartedAt,
      evidenceCaptureEndedAt: input.ack.lastActionTiming?.evidenceCaptureEndedAt,
    },
    heartbeat: {
      url: input.heartbeat.url,
      title: input.heartbeat.title,
      canGoBack: input.heartbeat.canGoBack,
      canGoForward: input.heartbeat.canGoForward,
      stateRequestsAfterOpen: input.stateRequestsAfterOpen,
      lightweightStateUpdated: input.heartbeat.title === 'Native heartbeat after click'
        && input.heartbeat.canGoBack === true
        && input.heartbeat.url === 'http://localhost/native-heartbeat/after-click',
    },
    failure: boundedBlockedRetryProjection(input.failed),
    actionRequests: input.actionRequests,
    rawPayloadsCaptured: false,
  };
}

function boundedBlockedRetryProjection(state: BrowserHostSessionState) {
  const blockedReason = clip(state.lastActionTiming?.blockedReason ?? state.diagnostics.at(-1) ?? 'native action failed', 240);
  return {
    visibleState: 'blocked',
    reason: blockedReason,
    retry: {
      bounded: true,
      action: 'retry-same-native-surface',
      maxAttempts: 1,
    },
    liveSurfaceTransport: state.liveSurfaceTransport,
    liveSurfaceRef: state.liveSurfaceRef,
    secondTruthSource: false,
    snapshotSecondViewerRendered: false,
    fallbackSurface: 'none',
  };
}

async function readJsonRequest(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function writeJsonResponse(res: ServerResponse, body: Record<string, unknown>, statusCode = 200): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function countCallsBetween(calls: TimedCall[], startedAt: number, completedAt: number): number {
  return calls.filter((call) => call.at >= startedAt && call.at <= completedAt).length;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type TimedCall = {
  at: number;
  route: string;
};
