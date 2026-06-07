import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import {
  defaultBrowserHostSessionManager,
  type BrowserHostFrameCaptureResult,
  type BrowserHostOpenReadInput,
  type BrowserHostSearchInput,
  type BrowserHostSessionActionInput,
  type BrowserHostSessionManager,
  type BrowserHostSessionStartInput,
} from './browser-host-session.js';
import { executeBrowserHostComputerUseAction, type BrowserHostComputerUseAction } from './browser-host-computer-use.js';
import { isRecord, readJson, writeJson } from './server/http.js';
import { normalizeBrowserHostNativeAdapterUrl } from './workspace-server-health.js';

export const BROWSER_HOST_FRAME_STREAM_SCHEMA = 'sciforge.browser-host-session.frame-stream.v1' as const;
export const BROWSER_HOST_NATIVE_SURFACE_PREFLIGHT_SCHEMA = 'sciforge.browser-host.native-surface.preflight.v1' as const;
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
  if (url.pathname.startsWith('/api/sciforge/browser-host/native-surface/')) {
    return handleBrowserHostNativeSurfaceRoutes(req, res, url);
  }

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

  if (url.pathname === '/api/sciforge/browser-host/open-read' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const root = await options.workspaceRootFromBodyOrRequest(body, url);
      const openRead = await manager.openRead(root, browserHostOpenReadInput(body));
      writeJson(res, 200, { ok: true, workspacePath: root, openRead });
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
      const computerUseAction = browserHostComputerUseAction(body);
      const result = await executeBrowserHostComputerUseAction(manager, root, sessionId, computerUseAction, {
        capture: browserHostSessionCaptureMode(body.capture),
        timeoutMs: numberField(body.timeoutMs),
        actionId: browserHostComputerUseOptionString(body, 'actionId'),
        uiEventReceivedAt: browserHostComputerUseOptionString(body, 'uiEventReceivedAt'),
        adapterSentAt: browserHostComputerUseOptionString(body, 'adapterSentAt'),
        permissionRef: browserHostComputerUseOptionString(body, 'permissionRef', 'permission'),
        cancelRef: browserHostComputerUseOptionString(body, 'cancelRef', 'stopRef', 'controlRef'),
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

async function handleBrowserHostNativeSurfaceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const nativeAdapterUrl = normalizeBrowserHostNativeAdapterUrl(process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL);
  if (url.pathname === '/api/sciforge/browser-host/native-surface/health') {
    if (req.method !== 'GET') {
      writeJson(res, 405, browserHostNativeSurfaceBlockedDiagnostic('health', undefined, `Unsupported native surface health method: ${req.method ?? 'unknown'}`));
      return true;
    }
    if (nativeAdapterUrl) {
      const proxied = await browserHostNativeSurfaceAdapterResponse(nativeAdapterUrl, '/health', 'health');
      writeJson(res, proxied.statusCode, proxied.body);
      return true;
    }
    writeJson(res, 503, browserHostNativeSurfaceBlockedDiagnostic('health'));
    return true;
  }

  if (url.pathname === '/api/sciforge/browser-host/native-surface/attach') {
    if (req.method !== 'POST') {
      writeJson(res, 405, browserHostNativeSurfaceBlockedDiagnostic('attach', undefined, `Unsupported native surface attach method: ${req.method ?? 'unknown'}`));
      return true;
    }
    const body = await readJson(req);
    const sessionId = safeBrowserHostNativeSurfaceSessionId(body.sessionId);
    if (!sessionId) {
      writeJson(res, 503, browserHostNativeSurfaceBlockedDiagnostic('attach', undefined, 'BrowserHostSession native surface attach requires a bounded session id.', 'native-surface-session-invalid'));
      return true;
    }
    if (nativeAdapterUrl) {
      const proxied = await browserHostNativeSurfaceAdapterResponse(
        nativeAdapterUrl,
        `/sessions/${encodeURIComponent(sessionId)}/attach`,
        'attach',
        sessionId,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(browserHostNativeSurfaceAttachBody(body, sessionId)),
        },
      );
      writeJson(res, proxied.statusCode, proxied.body);
      return true;
    }
    writeJson(res, 503, browserHostNativeSurfaceBlockedDiagnostic('attach', sessionId));
    return true;
  }

  if (url.pathname === '/api/sciforge/browser-host/native-surface/resize') {
    if (req.method !== 'POST') {
      writeJson(res, 405, browserHostNativeSurfaceBlockedDiagnostic('resize', undefined, `Unsupported native surface resize method: ${req.method ?? 'unknown'}`));
      return true;
    }
    const body = await readJson(req);
    const sessionId = safeBrowserHostNativeSurfaceSessionId(body.sessionId);
    if (!sessionId) {
      writeJson(res, 503, browserHostNativeSurfaceBlockedDiagnostic('resize', undefined, 'BrowserHostSession native surface resize requires a bounded session id.', 'native-surface-session-invalid'));
      return true;
    }
    if (nativeAdapterUrl) {
      const proxied = await browserHostNativeSurfaceAdapterResponse(
        nativeAdapterUrl,
        `/sessions/${encodeURIComponent(sessionId)}/resize`,
        'resize',
        sessionId,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(browserHostNativeSurfaceAttachBody(body, sessionId)),
        },
      );
      writeJson(res, proxied.statusCode, proxied.body);
      return true;
    }
    writeJson(res, 503, browserHostNativeSurfaceBlockedDiagnostic('resize', sessionId));
    return true;
  }

  if (url.pathname === '/api/sciforge/browser-host/native-surface/detach') {
    if (req.method !== 'POST') {
      writeJson(res, 405, browserHostNativeSurfaceBlockedDiagnostic('detach', undefined, `Unsupported native surface detach method: ${req.method ?? 'unknown'}`));
      return true;
    }
    const body = await readJson(req);
    const sessionId = safeBrowserHostNativeSurfaceSessionId(body.sessionId);
    if (!sessionId) {
      writeJson(res, 503, browserHostNativeSurfaceBlockedDiagnostic('detach', undefined, 'BrowserHostSession native surface detach requires a bounded session id.', 'native-surface-session-invalid'));
      return true;
    }
    if (nativeAdapterUrl) {
      const proxied = await browserHostNativeSurfaceAdapterResponse(
        nativeAdapterUrl,
        `/sessions/${encodeURIComponent(sessionId)}/detach`,
        'detach',
        sessionId,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        },
      );
      writeJson(res, proxied.statusCode, proxied.body);
      return true;
    }
    writeJson(res, 503, browserHostNativeSurfaceBlockedDiagnostic('detach', sessionId));
    return true;
  }

  if (url.pathname === '/api/sciforge/browser-host/native-surface/state') {
    if (req.method !== 'GET') {
      writeJson(res, 405, browserHostNativeSurfaceBlockedDiagnostic('state', undefined, `Unsupported native surface state method: ${req.method ?? 'unknown'}`));
      return true;
    }
    const sessionId = safeBrowserHostNativeSurfaceSessionId(url.searchParams.get('sessionId') ?? undefined);
    if (!sessionId) {
      writeJson(res, 503, browserHostNativeSurfaceBlockedDiagnostic('state', undefined, 'BrowserHostSession native surface state requires a bounded session id.', 'native-surface-session-invalid'));
      return true;
    }
    if (nativeAdapterUrl) {
      const proxied = await browserHostNativeSurfaceAdapterResponse(
        nativeAdapterUrl,
        `/sessions/${encodeURIComponent(sessionId)}/state`,
        'state',
        sessionId,
      );
      writeJson(res, proxied.statusCode, proxied.body);
      return true;
    }
    writeJson(res, 503, browserHostNativeSurfaceBlockedDiagnostic('state', sessionId));
    return true;
  }

  writeJson(res, 404, browserHostNativeSurfaceBlockedDiagnostic('unknown', undefined, 'Unknown native surface preflight route.'));
  return true;
}

function browserHostNativeSurfaceBlockedDiagnostic(
  action: BrowserHostNativeSurfaceAction | 'unknown',
  sessionId?: string,
  message = 'Workspace Writer native surface bridge is unavailable; BrowserHostSession native-embedded attach remains blocked.',
  reason = 'native-bridge-unavailable',
) {
  return {
    ok: false,
    schemaVersion: BROWSER_HOST_NATIVE_SURFACE_PREFLIGHT_SCHEMA,
    service: 'sciforge-workspace-writer',
    capability: 'browser-host-native-surface',
    endpoint: '/api/sciforge/browser-host/native-surface/{health,attach,resize,detach,state}',
    action,
    status: 'blocked',
    reason,
    ready: false,
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    liveSurfaceTransport: 'native-embedded',
    nativeBridge: false,
    rightPaneBridge: false,
    attachAvailable: false,
    detachAvailable: false,
    resizeAvailable: false,
    stateAvailable: false,
    singleInteractiveTruth: false,
    secondTruthSource: false,
    passClaim: false,
    ...(sessionId ? { sessionId } : {}),
    diagnostics: [
      message,
      'No BrowserHostSession-owned native surface bridge is registered in the Workspace Writer process.',
    ],
  };
}

type BrowserHostNativeSurfaceAction = 'health' | 'attach' | 'resize' | 'detach' | 'state';

interface BrowserHostNativeSurfaceAdapterResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

async function browserHostNativeSurfaceAdapterResponse(
  nativeAdapterUrl: string,
  adapterPath: string,
  action: BrowserHostNativeSurfaceAction,
  sessionId?: string,
  init?: RequestInit,
): Promise<BrowserHostNativeSurfaceAdapterResponse> {
  try {
    const response = await fetch(`${nativeAdapterUrl}${adapterPath}`, init);
    const payload = await browserHostNativeSurfaceJson(response);
    const trustIssue = browserHostNativeSurfaceTrustIssue(payload, sessionId);
    if (trustIssue) {
      return {
        statusCode: 503,
        body: browserHostNativeSurfaceBlockedDiagnostic(
          action,
          sessionId,
          'Loopback native adapter response failed BrowserHostSession native surface trust checks.',
          'native-adapter-response-invalid',
        ),
      };
    }
    const body = browserHostNativeSurfaceTrustedBody(payload, action, sessionId);
    return {
      statusCode: body.ok === false || body.status === 'blocked' ? Math.max(response.status, 503) : 200,
      body,
    };
  } catch {
    return {
      statusCode: 503,
      body: browserHostNativeSurfaceBlockedDiagnostic(
        action,
        sessionId,
        'Loopback native adapter did not return a bounded BrowserHostSession native surface response.',
        'native-adapter-unavailable',
      ),
    };
  }
}

async function browserHostNativeSurfaceJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  const json = JSON.parse(text) as unknown;
  return isRecord(json) ? json : {};
}

function browserHostNativeSurfaceTrustIssue(payload: Record<string, unknown>, sessionId?: string): string | undefined {
  if (browserHostNativeSurfaceHasForbiddenEvidence(payload)) return 'forbidden-evidence';
  if (stringField(payload.owner) !== 'BrowserHostSession') return 'owner';
  if (stringField(payload.adapterRole) !== 'display-input-adapter') return 'adapter-role';
  if (stringField(payload.liveSurfaceTransport) !== 'native-embedded') return 'live-surface-transport';
  if (payload.singleInteractiveTruth !== true) return 'single-interactive-truth';
  if (payload.secondTruthSource !== false) return 'second-truth-source';
  if (sessionId) {
    if (stringField(payload.sessionId) !== sessionId) return 'session-id';
    if (stringField(payload.liveSurfaceRef) !== `browser-host-session:${sessionId}/live-surface`) return 'live-surface-ref';
  } else if (payload.sessionId !== undefined || payload.liveSurfaceRef !== undefined) {
    return 'session-scoped-fields';
  }
  return undefined;
}

function browserHostNativeSurfaceTrustedBody(
  payload: Record<string, unknown>,
  action: BrowserHostNativeSurfaceAction,
  sessionId?: string,
): Record<string, unknown> {
  const status = safeBrowserHostNativeSurfaceToken(payload.status) ?? (payload.ok === false ? 'blocked' : 'ready');
  const ok = payload.ok === false || status === 'blocked' ? false : true;
  const reason = ok ? undefined : safeBrowserHostNativeSurfaceToken(payload.reason) ?? 'native-surface-adapter-blocked';
  const body: Record<string, unknown> = {
    ok,
    schemaVersion: BROWSER_HOST_NATIVE_SURFACE_PREFLIGHT_SCHEMA,
    service: 'sciforge-workspace-writer',
    capability: 'browser-host-native-surface',
    endpoint: '/api/sciforge/browser-host/native-surface/{health,attach,resize,detach,state}',
    action,
    status,
    ...(reason ? { reason } : {}),
    ready: ok && payload.ready !== false,
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    liveSurfaceTransport: 'native-embedded',
    nativeBridge: true,
    rightPaneBridge: payload.rightPaneBridge === true,
    attachAvailable: payload.attachAvailable === true,
    detachAvailable: payload.detachAvailable === true,
    resizeAvailable: payload.resizeAvailable === true,
    stateAvailable: payload.stateAvailable === true,
    singleInteractiveTruth: true,
    secondTruthSource: false,
    passClaim: ok && payload.passClaim === true,
  };
  if (sessionId) {
    body.sessionId = sessionId;
    body.liveSurfaceRef = `browser-host-session:${sessionId}/live-surface`;
  }
  const bounds = browserHostNativeSurfaceRect(payload.bounds);
  if (bounds) body.bounds = bounds;
  if (typeof payload.embedded === 'boolean') body.embedded = payload.embedded;
  if (typeof payload.visible === 'boolean') body.visible = payload.visible;
  const diagnostics = boundedBrowserHostNativeSurfaceDiagnostics(payload.diagnostics);
  if (diagnostics.length) body.diagnostics = diagnostics;
  return body;
}

function browserHostNativeSurfaceAttachBody(body: Record<string, unknown>, sessionId: string): Record<string, unknown> {
  const attachBody: Record<string, unknown> = { sessionId };
  const timeoutMs = numberField(body.timeoutMs);
  if (timeoutMs !== undefined) attachBody.timeoutMs = timeoutMs;
  const bounds = browserHostNativeSurfaceRect(body.bounds ?? body.rightPaneBounds);
  if (bounds) attachBody.bounds = bounds;
  return attachBody;
}

function browserHostNativeSurfaceRect(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const x = numberField(value.x);
  const y = numberField(value.y);
  const width = numberField(value.width);
  const height = numberField(value.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height };
}

function boundedBrowserHostNativeSurfaceDiagnostics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const token = safeBrowserHostNativeSurfaceToken(entry);
    return token ? [token] : [];
  }).slice(0, 8);
}

function safeBrowserHostNativeSurfaceToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^[a-z0-9][a-z0-9_.:/-]{0,120}$/i.test(trimmed) ? trimmed : undefined;
}

function browserHostNativeSurfaceHasForbiddenEvidence(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof value === 'string') {
    return /https?:\/\/|data:image|base64|<html|secret|provider|host-stream|frame-stream|canvas|iframe|webview|webrtc/i.test(value);
  }
  if (Array.isArray(value)) return value.some((entry) => browserHostNativeSurfaceHasForbiddenEvidence(entry, depth + 1));
  if (!isRecord(value)) return false;
  for (const [key, entry] of Object.entries(value)) {
    if (/(?:url|dom|screenshot|base64|provider|secret|html|payload)/i.test(key)) return true;
    if (browserHostNativeSurfaceHasForbiddenEvidence(entry, depth + 1)) return true;
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
  if (action === 'native-os-ui-proof') {
    const proofGroup = browserHostNativeOsUiProofGroup(body.proofGroup);
    return {
      action,
      capture: 'none',
      timeoutMs: numberField(body.timeoutMs),
      actionId: browserHostNativeOsUiActionId(body.actionId),
      proofGroup,
      probe: browserHostNativeOsUiProofProbe(body.probe),
      expectedProofNames: browserHostNativeOsUiExpectedProofNames(body.expectedProofNames, proofGroup),
      uiEventReceivedAt: stringField(body.uiEventReceivedAt),
      adapterSentAt: stringField(body.adapterSentAt),
    };
  }
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

function browserHostNativeOsUiProofGroup(value: unknown): BrowserHostSessionActionInput['proofGroup'] | undefined {
  return value === 'cursorCaret' ||
    value === 'mouseContextMenu' ||
    value === 'keyboardImeClipboardSelection' ||
    value === 'rerenderFocus'
    ? value
    : undefined;
}

function browserHostNativeOsUiProofProbe(value: unknown): BrowserHostSessionActionInput['probe'] | undefined {
  return value === 'focus-caret' ||
    value === 'blur-restore' ||
    value === 'mouse-context-menu-owner' ||
    value === 'bounded-keyboard-ime-clipboard-selection' ||
    value === 'bounded-rerender-focus' ||
    value === 'rerender-focus'
    ? value
    : undefined;
}

function browserHostNativeOsUiExpectedProofNames(
  value: unknown,
  proofGroup: BrowserHostSessionActionInput['proofGroup'],
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set(browserHostNativeOsUiProofNamesForGroup(proofGroup));
  const proofNames = [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && allowed.has(entry)))];
  return proofNames.length > 0 ? proofNames : undefined;
}

function browserHostNativeOsUiProofNamesForGroup(
  proofGroup: BrowserHostSessionActionInput['proofGroup'],
): string[] {
  if (proofGroup === 'mouseContextMenu') {
    return [
      'left-click-owner',
      'right-click-context-menu-owner',
      'middle-click-owner',
      'double-click-owner',
      'mouse-down-up-owner',
      'continuous-move-owner',
      'drag-drop-owner',
      'text-selection-range-owner',
      'wheel-vertical-owner',
      'wheel-horizontal-owner',
      'scrollbar-thumb-owner',
    ];
  }
  if (proofGroup === 'keyboardImeClipboardSelection') {
    return [
      'keyboard-backspace-delete-owner',
      'keyboard-enter-owner',
      'keyboard-tab-owner',
      'keyboard-arrow-home-end-page-owner',
      'keyboard-shortcuts-select-copy-paste-cut-owner',
      'keyboard-escape-owner',
      'ime-candidate-window-owner',
      'system-clipboard-round-trip-owner',
      'selection-range-owner',
    ];
  }
  if (proofGroup === 'rerenderFocus') {
    return [
      'native-surface-not-detached',
      'address-bar-rerender-stable',
      'tab-state-rerender-stable',
      'diagnostic-expand-stable',
      'focus-retained-after-rerender',
      'tab-switch-resize-minimize-restore',
    ];
  }
  return [
    'input-caret-visible',
    'focus-blur-restore',
    'pointer-button-link',
    'pointer-default-area',
    'text-cursor-area',
  ];
}

function browserHostNativeOsUiActionId(value: unknown): string | undefined {
  const token = stringField(value);
  if (!token) return undefined;
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(token)
    && !/https?:|file:|data:|blob:|javascript:|<html|<input|endpoint|url:|title:|selector|coords?|payload|provider|secret|api[-_]?key|raw-leak/i.test(token)
    ? token
    : undefined;
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

function browserHostComputerUseOptionString(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  const action = body.computerUseAction ?? body.computer_use_action ?? body.action;
  const actionRecord = isRecord(action) ? action : undefined;
  for (const key of keys) {
    const bodyValue = stringField(body[key]);
    if (bodyValue) return bodyValue;
    const actionValue = actionRecord ? stringField(actionRecord[key]) : undefined;
    if (actionValue) return actionValue;
  }
  return undefined;
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
    sourcePageLimit: numberField(body.sourcePageLimit),
    region: stringField(body.region),
    engine: stringField(body.engine) === 'duckduckgo' ? 'duckduckgo' : 'bing',
    timeoutMs: numberField(body.timeoutMs),
  };
}

function browserHostOpenReadInput(body: Record<string, unknown>): BrowserHostOpenReadInput {
  const url = stringField(body.url);
  if (!url) throw new Error('BrowserHostSession open_read url is required.');
  return {
    url,
    sessionId: stringField(body.sessionId),
    title: stringField(body.title),
    timeoutMs: numberField(body.timeoutMs),
  };
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safeBrowserHostNativeSurfaceSessionId(value: unknown) {
  const sessionId = stringField(value);
  return sessionId && /^[A-Za-z0-9_.:-]{1,128}$/.test(sessionId) ? sessionId : undefined;
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
