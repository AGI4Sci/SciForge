import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';

import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
  normalizeBrowserHostUrl,
  type BrowserHostFrameCaptureResult,
  type BrowserHostSessionManager,
  type BrowserHostSessionState,
} from '../../src/runtime/browser-host-session.js';
import {
  BROWSER_HOST_FRAME_STREAM_SCHEMA,
  handleBrowserHostSessionRoutes,
  handleBrowserHostSessionUpgrade,
} from '../../src/runtime/workspace-server-browser-host.js';

const PNG_1X1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x04, 0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c,
  0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41,
  0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0x1f, 0x00,
  0x03, 0x03, 0x02, 0x00, 0xef, 0xbf, 0xa7, 0xdb,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

test('BrowserHostSession frame-stream metrics lab reports bounded websocket-binary drop counters without second live surface', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-frame-stream-lab-'));
  const manager = deterministicFrameStreamManager(workspacePath, ['busy', 'recent-input']);
  const routeOptions = {
    manager: manager as unknown as BrowserHostSessionManager,
    workspaceRootFromRequest: async () => workspacePath,
    workspaceRootFromBodyOrRequest: async (body: Record<string, unknown>) => String(body.workspacePath || workspacePath),
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
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
    const session = await postJson(`${baseUrl}/api/sciforge/browser-host/sessions/start`, {
      workspacePath,
      url: 'http://localhost/frame-stream-lab',
      sessionId: 'frame-stream-lab',
    });
    assert.equal(session.session.owner, 'host');
    assert.equal(session.session.providerId, BROWSER_HOST_SESSION_PROVIDER_ID);

    const frame = await readFrame(`${baseUrl.replace(/^http/, 'ws')}/api/sciforge/browser-host/sessions/frame-stream-lab/frame-stream?workspacePath=${encodeURIComponent(workspacePath)}&intervalMs=125&quietWindowMs=80&maxBufferedBytes=65536`);
    assert.equal(frame.message.schemaVersion, BROWSER_HOST_FRAME_STREAM_SCHEMA);
    assert.equal(frame.message.frameTransport, 'websocket-binary');
    assert.equal(frame.message.frameMimeType, 'image/png');
    assert.deepEqual(frame.binary, PNG_1X1);
    assert.equal(frame.message.session?.id, 'frame-stream-lab');
    assert.equal(frame.message.session?.owner, 'host');
    assert.equal(frame.message.session?.singleInteractiveTruth, true);
    assert.equal(frame.message.session?.liveSurfaceTransport, 'host-stream');
    assert.equal(frame.message.session?.frameStreamRef, 'browser-host-session:frame-stream-lab/frame-stream');
    assert.equal(frame.message.frameStreamMetrics?.sequence, 1);
    assert.equal(frame.message.frameStreamMetrics?.frameBytes, PNG_1X1.byteLength);
    assert.equal(frame.message.frameStreamMetrics?.maxBufferedBytes, 65536);
    assert.equal(frame.message.frameStreamMetrics?.skippedBusy, 1);
    assert.equal(frame.message.frameStreamMetrics?.skippedRecentInput, 1);
    assert.equal(frame.message.frameStreamMetrics?.skippedBackpressure, 0);
    assert.equal(frame.message.frameStreamMetrics?.droppedSinceLastFrame, 2);

    const report = {
      schemaVersion: 'sciforge.browser-host-session.frame-stream-lab.v1',
      transport: frame.message.frameTransport,
      liveSurfaceTransport: frame.message.session?.liveSurfaceTransport,
      singleInteractiveTruth: frame.message.session?.singleInteractiveTruth,
      refs: {
        frameRef: frame.message.session?.frameRef,
        frameStreamRef: frame.message.session?.frameStreamRef,
        liveSurfaceRef: frame.message.session?.liveSurfaceRef,
      },
      metrics: frame.message.frameStreamMetrics,
      secondTruthSource: false,
      rawPayloadsCaptured: false,
    };
    const reportPath = join(workspacePath, 'frame-stream-lab-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    const reportText = await readFile(reportPath, 'utf8');
    assert.doesNotMatch(reportText, /data:image|base64|<\s*(?:!doctype|html|body|canvas|iframe|webview)\b/i);
    assert.doesNotMatch(reportText, /\/api\/sciforge\/browser\/proxy|system-browser-window/i);
    assert.equal(report.secondTruthSource, false);
    assert.equal(report.rawPayloadsCaptured, false);

    console.log(`[ok] BrowserHostSession frame-stream metrics lab ${JSON.stringify(report.metrics)}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession frame-stream metrics lab summarizes p95 capture and dropped frames across a bounded stream', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-frame-stream-p95-'));
  const manager = deterministicFrameStreamSequenceManager(workspacePath, [
    'busy',
    'recent-input',
    'capture',
    'busy',
    'busy',
    'capture',
    'recent-input',
    'capture',
  ]);
  const routeOptions = {
    manager: manager as unknown as BrowserHostSessionManager,
    workspaceRootFromRequest: async () => workspacePath,
    workspaceRootFromBodyOrRequest: async (body: Record<string, unknown>) => String(body.workspacePath || workspacePath),
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
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
      url: 'http://localhost/frame-stream-p95',
      sessionId: 'frame-stream-p95',
    });

    const frames = await readFrames(`${baseUrl.replace(/^http/, 'ws')}/api/sciforge/browser-host/sessions/frame-stream-p95/frame-stream?workspacePath=${encodeURIComponent(workspacePath)}&intervalMs=15&quietWindowMs=0&maxBufferedBytes=65536`, 3);
    const metrics = frames.map((frame) => frame.message.frameStreamMetrics ?? {});
    assert.deepEqual(frames.map((frame) => frame.binary), [PNG_1X1, PNG_1X1, PNG_1X1]);
    assert.deepEqual(metrics.map((row) => row.sequence), [1, 2, 3]);
    assert.deepEqual(metrics.map((row) => row.droppedSinceLastFrame), [2, 2, 1]);
    assert.equal(metrics.reduce((total, row) => total + Number(row.skippedBusy ?? 0), 0), 3);
    assert.equal(metrics.reduce((total, row) => total + Number(row.skippedRecentInput ?? 0), 0), 2);

    const captureMs = metrics.map((row) => Number(row.captureMs ?? 0));
    const report = {
      schemaVersion: 'sciforge.browser-host-session.frame-stream-p95-drop-lab.v1',
      transport: 'websocket-binary',
      liveSurfaceTransport: frames.at(-1)?.message.session?.liveSurfaceTransport,
      singleInteractiveTruth: frames.at(-1)?.message.session?.singleInteractiveTruth,
      frameCount: frames.length,
      p95CaptureMs: percentile(captureMs, 0.95),
      totalDroppedFrames: metrics.reduce((total, row) => total + Number(row.droppedSinceLastFrame ?? 0), 0),
      maxFrameBytes: Math.max(...metrics.map((row) => Number(row.frameBytes ?? 0))),
      refs: {
        frameStreamRef: frames.at(-1)?.message.session?.frameStreamRef,
        liveSurfaceRef: frames.at(-1)?.message.session?.liveSurfaceRef,
      },
      rawPayloadsCaptured: false,
      secondTruthSource: false,
    };
    assert.equal(report.liveSurfaceTransport, 'host-stream');
    assert.equal(report.singleInteractiveTruth, true);
    assert.equal(report.totalDroppedFrames, 5);
    assert.equal(report.maxFrameBytes, PNG_1X1.byteLength);
    assert.match(report.refs.frameStreamRef ?? '', /^browser-host-session:frame-stream-p95\/frame-stream$/);
    assert.doesNotMatch(JSON.stringify(report), /data:image|base64|<\s*(?:!doctype|html|body|canvas|iframe|webview)\b/i);

    console.log(`[ok] BrowserHostSession frame-stream p95/drop lab ${JSON.stringify({
      p95CaptureMs: report.p95CaptureMs,
      totalDroppedFrames: report.totalDroppedFrames,
      frameCount: report.frameCount,
    })}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession frame-stream skips stale captures behind mousemove, scroll, and input actions', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-host-frame-stream-input-priority-'));
  const manager = inputPriorityFrameStreamManager(workspacePath);
  const routeOptions = {
    manager: manager as unknown as BrowserHostSessionManager,
    workspaceRootFromRequest: async () => workspacePath,
    workspaceRootFromBodyOrRequest: async (body: Record<string, unknown>) => String(body.workspacePath || workspacePath),
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
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
      url: 'http://localhost/frame-stream-input-priority',
      sessionId: 'frame-stream-input-priority',
    });

    const actionUrl = `${baseUrl}/api/sciforge/browser-host/sessions/frame-stream-input-priority/actions`;
    await postJson(actionUrl, {
      workspacePath,
      action: 'mouse-move',
      x: 120,
      y: 160,
      capture: 'none',
      actionId: 'input-priority-mousemove',
    });
    await postJson(actionUrl, {
      workspacePath,
      action: 'scroll',
      deltaY: 420,
      capture: 'none',
      actionId: 'input-priority-scroll',
    });
    await postJson(actionUrl, {
      workspacePath,
      action: 'type',
      text: 'abc',
      capture: 'none',
      actionId: 'input-priority-type',
    });

    const frame = await readFrame(`${baseUrl.replace(/^http/, 'ws')}/api/sciforge/browser-host/sessions/frame-stream-input-priority/frame-stream?workspacePath=${encodeURIComponent(workspacePath)}&intervalMs=5&quietWindowMs=250&maxBufferedBytes=65536`);
    const metrics = frame.message.frameStreamMetrics ?? {};
    assert.equal(frame.message.frameTransport, 'websocket-binary');
    assert.equal(frame.message.session?.owner, 'host');
    assert.equal(frame.message.session?.singleInteractiveTruth, true);
    assert.equal(frame.message.session?.liveSurfaceTransport, 'host-stream');
    assert.equal(frame.message.session?.frameStreamRef, 'browser-host-session:frame-stream-input-priority/frame-stream');
    assert.equal(metrics.sequence, 1);
    assert.equal(metrics.skippedRecentInput, 3);
    assert.equal(metrics.skippedBusy, 0);
    assert.equal(metrics.skippedBackpressure, 0);
    assert.equal(metrics.droppedSinceLastFrame, 3);
    assert.equal(metrics.frameBytes, PNG_1X1.byteLength);
    assert.deepEqual(manager.actions.map((entry) => `${entry.action}:${entry.capture}`), [
      'mouse-move:none',
      'scroll:none',
      'type:none',
    ]);
    assert.deepEqual(manager.skippedInputActions, ['mouse-move', 'scroll', 'type']);
    const firstCaptureIndex = manager.eventLog.findIndex((entry) => entry === 'capture:frame-stream-input-priority');
    const lastActionIndex = Math.max(...manager.eventLog.map((entry, index) => entry.startsWith('act:') ? index : -1));
    assert.ok(firstCaptureIndex > lastActionIndex, 'frame capture must not be queued ahead of high-frequency input actions');

    const report = {
      schemaVersion: 'sciforge.browser-host-session.frame-stream-input-priority-lab.v1',
      status: 'passed',
      evidenceMode: 'deterministic-route-contract',
      owner: 'BrowserHostSession',
      transport: frame.message.frameTransport,
      hotPathCapture: 'none',
      staleCapturePolicy: 'skip-before-capture-after-mousemove-scroll-type',
      screenshotQueuedBeforeInput: false,
      realUiWebRtcStack: false,
      realP95DropBackpressureLongRun: false,
      refs: {
        hostSessionRef: 'browser-host-session:frame-stream-input-priority',
        frameStreamRef: frame.message.session?.frameStreamRef,
        liveSurfaceRef: frame.message.session?.liveSurfaceRef,
      },
      metrics,
      inputActions: manager.actions,
      skippedInputActions: manager.skippedInputActions,
      rawPayloadsCaptured: false,
      secondTruthSource: false,
      contractBoundary: {
        status: 'contract-only',
        blockedReason: 'real-ui-webrtc-stack-and-long-run-runner-not-exercised-by-this-node-smoke',
        benchmarkClaim: false,
      },
    };
    const reportText = JSON.stringify(report);
    assertNoFrameStreamRawPayloads(reportText);
    assert.equal(report.screenshotQueuedBeforeInput, false);
    assert.equal(report.contractBoundary.benchmarkClaim, false);

    console.log(`[ok] BrowserHostSession input-priority frame-stream contract ${JSON.stringify({
      skippedRecentInput: metrics.skippedRecentInput,
      droppedSinceLastFrame: metrics.droppedSinceLastFrame,
      firstCaptureIndex,
      lastActionIndex,
    })}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspacePath, { recursive: true, force: true });
  }
});

function deterministicFrameStreamManager(
  workspacePath: string,
  skippedReasons: NonNullable<BrowserHostFrameCaptureResult['skippedReason']>[],
) {
  const sessions = new Map<string, BrowserHostSessionState>();
  const framePaths = new Map<string, string>();
  let skipIndex = 0;

  async function captureFrame(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`missing BrowserHostSession ${sessionId}`);
    const framePath = join(workspacePath, `${sessionId}.png`);
    await writeFile(framePath, PNG_1X1);
    framePaths.set(sessionId, framePath);
    session.frameRef = `browser-host-session:${sessionId}/frame.png`;
    session.frameStreamRef = `browser-host-session:${sessionId}/frame-stream`;
    session.liveSurfaceRef = `browser-host-session:${sessionId}/live-surface`;
    session.liveSurfaceTransport = 'host-stream';
    session.singleInteractiveTruth = true;
    session.updatedAt = '2026-06-02T00:00:02.000Z';
    return session;
  }

  return {
    async openSession(root: string, input: { url: string; sessionId?: string }) {
      const id = input.sessionId || 'frame-stream-lab';
      const session: BrowserHostSessionState = {
        schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
        id,
        owner: 'host',
        providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
        status: 'ready',
        workspacePath: root,
        requestedUrl: normalizeBrowserHostUrl(input.url),
        url: normalizeBrowserHostUrl(input.url),
        title: 'Frame stream lab',
        startedAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z',
        viewport: { width: 960, height: 640 },
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
    async framePath(_root: string, sessionId: string) {
      return framePaths.get(sessionId);
    },
    async captureFrame(_root: string, sessionId: string) {
      return captureFrame(sessionId);
    },
    async captureFrameIfIdle(_root: string, sessionId: string) {
      const skippedReason = skippedReasons[skipIndex];
      if (skippedReason) {
        skipIndex += 1;
        const session = sessions.get(sessionId);
        if (!session) throw new Error(`missing BrowserHostSession ${sessionId}`);
        return { session, captured: false, skippedReason };
      }
      return { session: await captureFrame(sessionId), captured: true };
    },
  };
}

function deterministicFrameStreamSequenceManager(
  workspacePath: string,
  sequence: Array<NonNullable<BrowserHostFrameCaptureResult['skippedReason']> | 'capture'>,
) {
  const sessions = new Map<string, BrowserHostSessionState>();
  const framePaths = new Map<string, string>();
  let sequenceIndex = 0;

  async function captureFrame(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`missing BrowserHostSession ${sessionId}`);
    const framePath = join(workspacePath, `${sessionId}-${Date.now()}-${sequenceIndex}.png`);
    await writeFile(framePath, PNG_1X1);
    framePaths.set(sessionId, framePath);
    session.frameRef = `browser-host-session:${sessionId}/frame.png`;
    session.frameStreamRef = `browser-host-session:${sessionId}/frame-stream`;
    session.liveSurfaceRef = `browser-host-session:${sessionId}/live-surface`;
    session.liveSurfaceTransport = 'host-stream';
    session.singleInteractiveTruth = true;
    session.updatedAt = new Date(1780350000000 + sequenceIndex).toISOString();
    return session;
  }

  return {
    async openSession(root: string, input: { url: string; sessionId?: string }) {
      const id = input.sessionId || 'frame-stream-p95';
      const session: BrowserHostSessionState = {
        schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
        id,
        owner: 'host',
        providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
        status: 'ready',
        workspacePath: root,
        requestedUrl: normalizeBrowserHostUrl(input.url),
        url: normalizeBrowserHostUrl(input.url),
        title: 'Frame stream p95 lab',
        startedAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z',
        viewport: { width: 960, height: 640 },
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
    async framePath(_root: string, sessionId: string) {
      return framePaths.get(sessionId);
    },
    async captureFrame(_root: string, sessionId: string) {
      return captureFrame(sessionId);
    },
    async captureFrameIfIdle(_root: string, sessionId: string) {
      const next = sequence[sequenceIndex] ?? 'capture';
      sequenceIndex += 1;
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`missing BrowserHostSession ${sessionId}`);
      if (next !== 'capture') return { session, captured: false, skippedReason: next };
      return { session: await captureFrame(sessionId), captured: true };
    },
  };
}

function inputPriorityFrameStreamManager(workspacePath: string) {
  const sessions = new Map<string, BrowserHostSessionState>();
  const framePaths = new Map<string, string>();
  const actions: Array<{ action: string; capture: string; actionId?: string }> = [];
  const skippedInputActions: string[] = [];
  const eventLog: string[] = [];
  const pendingRecentInputSkips: string[] = [];

  async function captureFrame(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`missing BrowserHostSession ${sessionId}`);
    eventLog.push(`capture:${sessionId}`);
    const framePath = join(workspacePath, `${sessionId}.png`);
    await writeFile(framePath, PNG_1X1);
    framePaths.set(sessionId, framePath);
    session.frameRef = `browser-host-session:${sessionId}/frame.png`;
    session.frameStreamRef = `browser-host-session:${sessionId}/frame-stream`;
    session.liveSurfaceRef = `browser-host-session:${sessionId}/live-surface`;
    session.liveSurfaceTransport = 'host-stream';
    session.singleInteractiveTruth = true;
    session.updatedAt = '2026-06-02T00:00:03.000Z';
    return session;
  }

  return {
    actions,
    skippedInputActions,
    eventLog,
    async openSession(root: string, input: { url: string; sessionId?: string }) {
      const id = input.sessionId || 'frame-stream-input-priority';
      const session: BrowserHostSessionState = {
        schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
        id,
        owner: 'host',
        providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
        status: 'ready',
        workspacePath: root,
        requestedUrl: normalizeBrowserHostUrl(input.url),
        url: normalizeBrowserHostUrl(input.url),
        title: 'Frame stream input priority lab',
        startedAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z',
        viewport: { width: 960, height: 640 },
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
    async act(_root: string, sessionId: string, input: { action: string; capture?: string; actionId?: string }) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`missing BrowserHostSession ${sessionId}`);
      const capture = input.capture || 'default';
      actions.push({ action: input.action, capture, actionId: input.actionId });
      eventLog.push(`act:${input.action}:${capture}`);
      if (input.action === 'mouse-move' || input.action === 'scroll' || input.action === 'type') {
        pendingRecentInputSkips.push(input.action);
      }
      session.updatedAt = new Date(1780350000000 + actions.length).toISOString();
      return session;
    },
    async framePath(_root: string, sessionId: string) {
      return framePaths.get(sessionId);
    },
    async captureFrame(_root: string, sessionId: string) {
      return captureFrame(sessionId);
    },
    async captureFrameIfIdle(_root: string, sessionId: string) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`missing BrowserHostSession ${sessionId}`);
      const skippedInputAction = pendingRecentInputSkips.shift();
      if (skippedInputAction) {
        skippedInputActions.push(skippedInputAction);
        eventLog.push(`skip-recent-input:${skippedInputAction}`);
        return { session, captured: false, skippedReason: 'recent-input' as const };
      }
      return { session: await captureFrame(sessionId), captured: true };
    },
  };
}

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, `${url} should return success`);
  return response.json() as Promise<Record<string, any>>;
}

async function readFrame(url: string): Promise<{ message: Record<string, any>; binary: Buffer }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let message: Record<string, any> | undefined;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timed out waiting for frame-stream binary frame.'));
    }, 3_000);
    ws.on('message', (data, isBinary) => {
      if (isBinary && message) {
        clearTimeout(timeout);
        ws.close();
        resolve({ message, binary: Buffer.from(data as Buffer) });
        return;
      }
      if (isBinary) return;
      const parsed = JSON.parse(String(data)) as Record<string, any>;
      if (parsed.type === 'frame') message = parsed;
    });
    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function readFrames(url: string, count: number): Promise<Array<{ message: Record<string, any>; binary: Buffer }>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames: Array<{ message: Record<string, any>; binary: Buffer }> = [];
    let message: Record<string, any> | undefined;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for ${count} frame-stream binary frames.`));
    }, 5_000);
    ws.on('message', (data, isBinary) => {
      if (isBinary && message) {
        frames.push({ message, binary: Buffer.from(data as Buffer) });
        message = undefined;
        if (frames.length >= count) {
          clearTimeout(timeout);
          ws.close();
          resolve(frames);
        }
        return;
      }
      if (isBinary) return;
      const parsed = JSON.parse(String(data)) as Record<string, any>;
      if (parsed.type === 'frame') message = parsed;
    });
    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function percentile(values: number[], quantile: number): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

function assertNoFrameStreamRawPayloads(text: string): void {
  assert.doesNotMatch(text, /data:image|;base64,|<\s*(?:!doctype|html|body|canvas|iframe|webview)\b/i);
  assert.doesNotMatch(text, /\/api\/sciforge\/browser\/proxy|system-browser-window|html2canvas|image\/(?:png|jpeg|webp)/i);
  assert.doesNotMatch(text, /https?:\/\/|file:\/\/|\.png\b|\.jpe?g\b|\.webp\b/i);
}
