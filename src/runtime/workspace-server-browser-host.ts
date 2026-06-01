import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import {
  defaultBrowserHostSessionManager,
  type BrowserHostFrameCaptureResult,
  type BrowserHostSearchInput,
  type BrowserHostSessionActionInput,
  type BrowserHostSessionManager,
  type BrowserHostSessionStartInput,
} from './browser-host-session.js';
import { executeBrowserHostComputerUseAction, type BrowserHostComputerUseAction } from './browser-host-computer-use.js';
import { isRecord, readJson, writeJson } from './server/http.js';

export const BROWSER_HOST_FRAME_STREAM_SCHEMA = 'sciforge.browser-host-session.frame-stream.v1' as const;
const BROWSER_HOST_FRAME_STREAM_DEFAULT_MAX_BUFFERED_BYTES = 2_000_000;

const browserHostFrameStreamWss = new WebSocketServer({ noServer: true });

interface BrowserHostFrameStreamMetricsState {
  sequence: number;
  skippedBusy: number;
  skippedRecentInput: number;
  skippedBackpressure: number;
  droppedSinceLastFrame: number;
}

export interface BrowserHostSessionRouteHandlerOptions {
  manager?: BrowserHostSessionManager;
  workspaceRootFromRequest(url: URL): Promise<string>;
  workspaceRootFromBodyOrRequest(body: Record<string, unknown>, url: URL): Promise<string>;
}

export function handleBrowserHostSessionUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: Omit<BrowserHostSessionRouteHandlerOptions, 'workspaceRootFromBodyOrRequest'>,
): boolean {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const match = /^\/api\/sciforge\/browser-host\/sessions\/([^/]+)\/frame-stream$/.exec(url.pathname);
  if (!match) return false;
  const manager = options.manager ?? defaultBrowserHostSessionManager();
  browserHostFrameStreamWss.handleUpgrade(req, socket, head, (ws) => {
    void connectBrowserHostFrameStream(ws, manager, decodeURIComponent(match[1]), url, options).catch((error: unknown) => {
      browserHostFrameStreamSend(ws, {
        type: 'error',
        schemaVersion: BROWSER_HOST_FRAME_STREAM_SCHEMA,
        message: error instanceof Error ? error.message : String(error),
      });
      ws.close(1011, 'browser host frame stream unavailable');
    });
  });
  return true;
}

export async function handleBrowserHostSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: BrowserHostSessionRouteHandlerOptions,
): Promise<boolean> {
  const manager = options.manager ?? defaultBrowserHostSessionManager();
  if (url.pathname === '/api/sciforge/browser-host/sessions/start' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = await options.workspaceRootFromBodyOrRequest(body, url);
      const session = await manager.openSession(root, browserHostSessionStartInput(body));
      writeJson(res, 200, { ok: true, workspacePath: root, session });
    } catch (error) {
      writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sciforge/browser-host/search' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = await options.workspaceRootFromBodyOrRequest(body, url);
      const search = await manager.search(root, browserHostSearchInput(body));
      writeJson(res, 200, { ok: true, workspacePath: root, search });
    } catch (error) {
      writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const match = /^\/api\/sciforge\/browser-host\/sessions\/([^/]+)\/(state|actions|computer-use-actions|frame)$/.exec(url.pathname);
  if (!match) return false;
  const sessionId = decodeURIComponent(match[1]);
  const action = match[2];

  try {
    if (action === 'state' && req.method === 'GET') {
      const root = await options.workspaceRootFromRequest(url);
      const session = await manager.sessionState(root, sessionId);
      writeJson(res, session ? 200 : 404, session ? { ok: true, workspacePath: root, session } : { ok: false, error: `BrowserHostSession not found: ${sessionId}` });
      return true;
    }
    if (action === 'actions' && req.method === 'POST') {
      const body = await readJson(req);
      const root = await options.workspaceRootFromBodyOrRequest(body, url);
      const session = await manager.act(root, sessionId, browserHostSessionActionInput(body));
      writeJson(res, 200, { ok: true, workspacePath: root, session });
      return true;
    }
    if (action === 'computer-use-actions' && req.method === 'POST') {
      const body = await readJson(req);
      const root = await options.workspaceRootFromBodyOrRequest(body, url);
      const result = await executeBrowserHostComputerUseAction(manager, root, sessionId, browserHostComputerUseAction(body), {
        capture: browserHostSessionCaptureMode(body.capture),
        timeoutMs: numberField(body.timeoutMs),
        actionId: stringField(body.actionId),
        uiEventReceivedAt: stringField(body.uiEventReceivedAt),
        adapterSentAt: stringField(body.adapterSentAt),
      });
      writeJson(res, 200, { ok: true, workspacePath: root, result, session: result.session });
      return true;
    }
    if (action === 'frame' && req.method === 'GET') {
      const root = await options.workspaceRootFromRequest(url);
      const framePath = await manager.framePath(root, sessionId);
      if (!framePath) {
        writeJson(res, 404, { ok: false, error: `BrowserHostSession frame not found: ${sessionId}` });
        return true;
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'X-SciForge-Ref': `browser-host-session:${sessionId}/${basename(framePath)}`,
      });
      createReadStream(framePath).pipe(res);
      return true;
    }
  } catch (error) {
    writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    return true;
  }
  return false;
}

function browserHostSessionStartInput(body: Record<string, unknown>): BrowserHostSessionStartInput {
  return {
    url: stringField(body.url) || stringField(body.startUrl) || 'about:blank',
    sessionId: stringField(body.sessionId),
    width: numberField(body.width),
    height: numberField(body.height),
    timeoutMs: numberField(body.timeoutMs),
  };
}

function browserHostSessionActionInput(body: Record<string, unknown>): BrowserHostSessionActionInput {
  const action = stringField(body.action);
  if (!action) throw new Error('BrowserHostSession action is required.');
  return {
    action: action as BrowserHostSessionActionInput['action'],
    capture: browserHostSessionCaptureMode(body.capture),
    url: stringField(body.url),
    x: numberField(body.x),
    y: numberField(body.y),
    button: browserHostMouseButton(body.button),
    path: browserHostMousePath(body.path),
    text: textField(body.text),
    key: stringField(body.key),
    deltaX: numberField(body.deltaX),
    deltaY: numberField(body.deltaY),
    timeoutMs: numberField(body.timeoutMs),
    actionId: stringField(body.actionId),
    uiEventReceivedAt: stringField(body.uiEventReceivedAt),
    adapterSentAt: stringField(body.adapterSentAt),
  };
}

function browserHostSessionCaptureMode(value: unknown): BrowserHostSessionActionInput['capture'] | undefined {
  return value === 'full' || value === 'frame' || value === 'none' ? value : undefined;
}

function browserHostMouseButton(value: unknown): BrowserHostSessionActionInput['button'] | undefined {
  return value === 'left' || value === 'right' || value === 'middle' ? value : undefined;
}

function browserHostMousePath(value: unknown): BrowserHostSessionActionInput['path'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const path = value.flatMap((point) => {
    if (!point || typeof point !== 'object') return [];
    const record = point as Record<string, unknown>;
    const x = numberField(record.x);
    const y = numberField(record.y);
    return x === undefined || y === undefined ? [] : [{ x, y }];
  });
  return path.length ? path : undefined;
}

function browserHostComputerUseAction(body: Record<string, unknown>): BrowserHostComputerUseAction {
  const action = body.computerUseAction ?? body.computer_use_action ?? body.action;
  if (!isRecord(action)) throw new Error('BrowserHostSession Computer Use action is required.');
  return action as unknown as BrowserHostComputerUseAction;
}

async function connectBrowserHostFrameStream(
  ws: WebSocket,
  manager: BrowserHostSessionManager,
  sessionId: string,
  url: URL,
  options: Omit<BrowserHostSessionRouteHandlerOptions, 'workspaceRootFromBodyOrRequest'>,
) {
  const root = await options.workspaceRootFromRequest(url);
  const intervalMs = browserHostFrameStreamIntervalMs(url);
  const quietWindowMs = browserHostFrameStreamQuietWindowMs(url);
  const maxBufferedBytes = browserHostFrameStreamMaxBufferedBytes(url);
  const metrics: BrowserHostFrameStreamMetricsState = {
    sequence: 0,
    skippedBusy: 0,
    skippedRecentInput: 0,
    skippedBackpressure: 0,
    droppedSinceLastFrame: 0,
  };
  let closed = false;
  ws.on('close', () => {
    closed = true;
  });
  browserHostFrameStreamSend(ws, {
    type: 'hello',
    schemaVersion: BROWSER_HOST_FRAME_STREAM_SCHEMA,
    sessionId,
    transport: 'host-stream',
    singleInteractiveTruth: true,
    intervalMs,
    quietWindowMs,
    maxBufferedBytes,
  });
  while (!closed && ws.readyState === WebSocket.OPEN) {
    if (browserHostFrameStreamBackpressured(ws, maxBufferedBytes)) {
      metrics.skippedBackpressure += 1;
      metrics.droppedSinceLastFrame += 1;
      await sleep(Math.min(intervalMs, 75));
      continue;
    }
    const captureStartedAt = Date.now();
    const capture = await browserHostFrameStreamCapture(manager, root, sessionId, quietWindowMs);
    if (!capture.captured) {
      if (capture.skippedReason === 'busy') metrics.skippedBusy += 1;
      if (capture.skippedReason === 'recent-input') metrics.skippedRecentInput += 1;
      metrics.droppedSinceLastFrame += 1;
      await sleep(Math.min(intervalMs, 75));
      continue;
    }
    const captureMs = Date.now() - captureStartedAt;
    const session = capture.session;
    const binaryFrame = await browserHostFrameStreamBinaryFrame(manager, root, sessionId);
    const frameStreamMetrics = browserHostFrameStreamMetricsPayload(metrics, {
      captureMs,
      frameBytes: binaryFrame?.byteLength ?? 0,
      bufferedBytesBeforeSend: ws.bufferedAmount,
      maxBufferedBytes,
    });
    browserHostFrameStreamSend(ws, {
      type: 'frame',
      schemaVersion: BROWSER_HOST_FRAME_STREAM_SCHEMA,
      session,
      frameRef: session.frameRef,
      frameStreamRef: session.frameStreamRef,
      updatedAt: session.updatedAt,
      captured: true,
      frameTransport: binaryFrame ? 'websocket-binary' : 'host-stream-metadata',
      binaryFrameId: binaryFrame ? `${session.id}:${session.updatedAt}` : undefined,
      frameMimeType: binaryFrame ? 'image/png' : undefined,
      frameStreamMetrics,
    });
    browserHostFrameStreamResetDroppedMetrics(metrics);
    if (binaryFrame && ws.readyState === WebSocket.OPEN) ws.send(binaryFrame);
    await sleep(intervalMs);
  }
}

function browserHostFrameStreamBackpressured(ws: WebSocket, maxBufferedBytes: number) {
  return maxBufferedBytes >= 0 && ws.bufferedAmount > maxBufferedBytes;
}

function browserHostFrameStreamMetricsPayload(
  metrics: BrowserHostFrameStreamMetricsState,
  frame: { captureMs: number; frameBytes: number; bufferedBytesBeforeSend: number; maxBufferedBytes: number },
) {
  return {
    sequence: metrics.sequence + 1,
    captureMs: frame.captureMs,
    frameBytes: frame.frameBytes,
    bufferedBytesBeforeSend: frame.bufferedBytesBeforeSend,
    maxBufferedBytes: frame.maxBufferedBytes,
    skippedBusy: metrics.skippedBusy,
    skippedRecentInput: metrics.skippedRecentInput,
    skippedBackpressure: metrics.skippedBackpressure,
    droppedSinceLastFrame: metrics.droppedSinceLastFrame,
  };
}

function browserHostFrameStreamResetDroppedMetrics(metrics: BrowserHostFrameStreamMetricsState) {
  metrics.sequence += 1;
  metrics.skippedBusy = 0;
  metrics.skippedRecentInput = 0;
  metrics.skippedBackpressure = 0;
  metrics.droppedSinceLastFrame = 0;
}

async function browserHostFrameStreamCapture(
  manager: BrowserHostSessionManager,
  root: string,
  sessionId: string,
  quietWindowMs: number,
): Promise<BrowserHostFrameCaptureResult> {
  if (typeof manager.captureFrameIfIdle === 'function') {
    return manager.captureFrameIfIdle(root, sessionId, { quietWindowMs });
  }
  return { session: await manager.captureFrame(root, sessionId), captured: true };
}

async function browserHostFrameStreamBinaryFrame(
  manager: BrowserHostSessionManager,
  root: string,
  sessionId: string,
): Promise<Buffer | undefined> {
  const framePath = await manager.framePath(root, sessionId);
  if (!framePath) return undefined;
  try {
    return await readFile(framePath);
  } catch {
    return undefined;
  }
}

function browserHostFrameStreamSend(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function browserHostFrameStreamIntervalMs(url: URL) {
  const explicit = Number(url.searchParams.get('intervalMs') ?? '');
  const fps = Number(url.searchParams.get('fps') ?? '');
  const fromFps = Number.isFinite(fps) && fps > 0 ? Math.round(1000 / fps) : undefined;
  return Math.max(125, Math.min(1000, Number.isFinite(explicit) && explicit > 0 ? Math.round(explicit) : fromFps ?? 200));
}

function browserHostFrameStreamQuietWindowMs(url: URL) {
  const explicit = Number(url.searchParams.get('quietWindowMs') ?? url.searchParams.get('quietMs') ?? '');
  return Math.max(0, Math.min(500, Number.isFinite(explicit) && explicit >= 0 ? Math.round(explicit) : 80));
}

function browserHostFrameStreamMaxBufferedBytes(url: URL) {
  const explicit = Number(url.searchParams.get('maxBufferedBytes') ?? '');
  return Math.max(0, Math.min(16_000_000, Number.isFinite(explicit) && explicit >= 0
    ? Math.round(explicit)
    : BROWSER_HOST_FRAME_STREAM_DEFAULT_MAX_BUFFERED_BYTES));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function browserHostSearchInput(body: Record<string, unknown>): BrowserHostSearchInput {
  return {
    query: stringField(body.query) || '',
    sessionId: stringField(body.sessionId),
    limit: numberField(body.limit),
    region: stringField(body.region),
    engine: stringField(body.engine) === 'duckduckgo' ? 'duckduckgo' : 'bing',
    timeoutMs: numberField(body.timeoutMs),
  };
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function textField(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function isBrowserHostSessionRouteBody(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
