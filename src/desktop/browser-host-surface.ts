import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, isAbsolute } from 'node:path';
import {
  BROWSER_HOST_NATIVE_OS_UI_PROOF_SCHEMA,
  type BrowserHostSessionNativeOsUiProof,
} from '../runtime/browser-host-session-types.js';
import { browserHostDiscoveryResultExtractionScript } from '../runtime/browser-host-session-search.js';

export type DesktopBrowserHostSurfaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopBrowserHostSurfaceClaimScope = 'visible-product-surface' | 'hidden-or-diagnostic';

export type DesktopBrowserHostSurfaceEvidence = {
  refsFirst: true;
  boundedEvidenceOnly: true;
  evidenceMode: 'bounded-refs-and-summaries';
  sessionRef: string;
  liveSurfaceRef: string;
  surfaceRef: string;
  visibleEvidenceRef: string;
  readinessEvidenceRef: string;
  passClaimRef: string;
  diagnosticRef?: string;
  visible: boolean;
  embedded: boolean;
  productSurface: boolean;
  missingNativeSurface: boolean;
  diagnosticOnly: boolean;
  passClaim: boolean;
  evidenceRefs: string[];
  diagnostics: string[];
  payloadPolicy: {
    rawScreenshot: false;
    dataUrl: false;
    inlineBinaryPayload: false;
  };
};

export type DesktopBrowserHostSurfaceState = {
  ok: boolean;
  sessionId: string;
  owner: 'BrowserHostSession';
  adapterRole: 'display-input-adapter';
  surface: 'electron-web-contents-view';
  liveSurfaceTransport: 'native-embedded';
  singleInteractiveTruth: true;
  ready: boolean;
  nativeBridge: true;
  rightPaneBridge: true;
  attachAvailable: true;
  detachAvailable: true;
  resizeAvailable: true;
  stateAvailable: true;
  liveSurfaceRef: string;
  status: 'attached' | 'detached';
  embedded: boolean;
  secondTruthSource: false;
  passClaim: boolean;
  claimScope: DesktopBrowserHostSurfaceClaimScope;
  diagnosticOnly: boolean;
  surfaceRef: string;
  visibleEvidenceRef: string;
  readinessEvidenceRef: string;
  passClaimRef: string;
  diagnosticRef?: string;
  surfaceEvidence: DesktopBrowserHostSurfaceEvidence;
  url?: string;
  title?: string;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  bounds?: DesktopBrowserHostSurfaceBounds;
  visible?: boolean;
  reason?: string;
  diagnostics?: string[];
  nativeOsUiProof?: BrowserHostSessionNativeOsUiProof;
};

export type DesktopBrowserHostSurfaceEvidenceOutputKind = 'screenshot' | 'dom' | 'text' | 'ax';

export type DesktopBrowserHostSurfaceEvidenceWriteResult = {
  ok: boolean;
  sessionId: string;
  owner: 'BrowserHostSession';
  adapterRole: 'display-input-adapter';
  liveSurfaceTransport: 'native-embedded';
  nativeBridge: true;
  rightPaneBridge: true;
  outputKind: DesktopBrowserHostSurfaceEvidenceOutputKind;
  mimeType?: 'image/png' | 'text/html' | 'text/plain' | 'application/json';
  bytesWritten?: number;
  sha256?: string;
  reason?: string;
};

export const DESKTOP_BROWSER_HOST_SURFACE_AUDIT_SCHEMA = 'sciforge.desktop.browser-host-surface.audit.v1' as const;

const NATIVE_OS_UI_PROOF_NAMES_BY_GROUP = {
  cursorCaret: [
    'input-caret-visible',
    'pointer-button-link',
    'pointer-default-area',
    'text-cursor-area',
    'focus-blur-restore',
  ],
  mouseContextMenu: [
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
  ],
  keyboardImeClipboardSelection: [
    'keyboard-backspace-delete-owner',
    'keyboard-enter-owner',
    'keyboard-tab-owner',
    'keyboard-arrow-home-end-page-owner',
    'keyboard-shortcuts-select-copy-paste-cut-owner',
    'keyboard-escape-owner',
    'ime-candidate-window-owner',
    'system-clipboard-round-trip-owner',
    'selection-range-owner',
  ],
  rerenderFocus: [
    'native-surface-not-detached',
    'address-bar-rerender-stable',
    'tab-state-rerender-stable',
    'diagnostic-expand-stable',
    'focus-retained-after-rerender',
    'tab-switch-resize-minimize-restore',
  ],
} as const satisfies Record<BrowserHostSessionNativeOsUiProof['proofGroup'], readonly string[]>;

export type DesktopBrowserHostSurfaceAuditRoute =
  | 'health'
  | 'start'
  | 'navigate'
  | 'attach'
  | 'detach'
  | 'resize'
  | 'actions'
  | 'state'
  | 'screenshot'
  | 'content'
  | 'text'
  | 'ax'
  | 'search-results'
  | 'frame-stream'
  | 'audit'
  | 'unknown';

export type DesktopBrowserHostSurfaceAudit = {
  schemaVersion: typeof DESKTOP_BROWSER_HOST_SURFACE_AUDIT_SCHEMA;
  ok: true;
  owner: 'BrowserHostSession';
  adapterRole: 'display-input-adapter';
  liveSurfaceTransport: 'native-embedded';
  singleInteractiveTruth: true;
  secondTruthSource: false;
  counters: Record<DesktopBrowserHostSurfaceAuditRoute, number>;
  recentRequests: Array<{
    at: string;
    method: string;
    route: DesktopBrowserHostSurfaceAuditRoute;
    sessionId?: string;
  }>;
};

export type DesktopBrowserHostSurfaceWindow = {
  contentView?: DesktopBrowserHostSurfaceViewContainer;
  focus?(): void;
  isDestroyed?(): boolean;
};

export type DesktopBrowserHostSurfaceViewContainer = {
  addChildView?(view: DesktopBrowserHostSurfaceViewLike, index?: number): void;
  removeChildView?(view: DesktopBrowserHostSurfaceViewLike): void;
};

export type DesktopBrowserHostSurfaceViewLike = {
  setBounds?(bounds: DesktopBrowserHostSurfaceBounds): void;
  getBounds?(): DesktopBrowserHostSurfaceBounds;
  setVisible?(visible: boolean): void;
  webContents: DesktopBrowserHostSurfaceWebContentsLike;
};

export type DesktopBrowserHostSurfaceWebContentsLike = {
  loadURL?(url: string, options?: unknown): Promise<void>;
  setWindowOpenHandler?(handler: (details: { url?: string }) => { action: 'allow' | 'deny' }): void;
  getURL?(): string;
  getTitle?(): string;
  canGoBack?(): boolean;
  canGoForward?(): boolean;
  isLoading?(): boolean;
  isLoadingMainFrame?(): boolean;
  goBack?(): void;
  goForward?(): void;
  reload?(): void;
  stop?(): void;
  focus?(): void;
  close?(): void;
  capturePage?(): Promise<{ toDataURL?(): string; toPNG?(): Uint8Array }>;
  executeJavaScript?<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
  insertText?(text: string): Promise<void> | void;
  sendInputEvent?(event: Record<string, unknown>): Promise<void> | void;
  on?(event: string, listener: (...args: unknown[]) => void): void;
};

export type DesktopBrowserHostSurfaceElectron = {
  WebContentsView?: new(options?: {
    webPreferences?: {
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      sandbox?: boolean;
      webSecurity?: boolean;
      partition?: string;
    };
  }) => DesktopBrowserHostSurfaceViewLike;
};

export type DesktopBrowserHostSurfaceController = ReturnType<typeof createDesktopBrowserHostSurfaceController>;
export type DesktopBrowserHostSurfaceStartOptions = {
  url?: string;
  port?: number;
};

type DesktopBrowserHostSurfaceSession = {
  id: string;
  view: DesktopBrowserHostSurfaceViewLike;
  webContents: DesktopBrowserHostSurfaceWebContentsLike;
  viewport: { width: number; height: number };
  attachedWindow?: DesktopBrowserHostSurfaceWindow;
  bounds?: DesktopBrowserHostSurfaceBounds;
  visible: boolean;
  updatedAt: string;
  lastMouse: { x: number; y: number };
  diagnostics: string[];
  url?: string;
  title?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  history: string[];
  historyIndex: number;
  profilePartition: string;
  pendingHistoryAction?: 'back' | 'forward';
};

export function createDesktopBrowserHostSurfaceController(
  electron: DesktopBrowserHostSurfaceElectron,
  options: { mainWindow?: () => DesktopBrowserHostSurfaceWindow | undefined } = {},
) {
  const sessions = new Map<string, DesktopBrowserHostSurfaceSession>();
  const audit = createSurfaceAudit();
  let mainWindowProvider = options.mainWindow;
  let server: Server | undefined;
  let serverUrl: string | undefined;

  function setMainWindow(window: DesktopBrowserHostSurfaceWindow | undefined): void {
    mainWindowProvider = () => window;
  }

  async function startServer(options: DesktopBrowserHostSurfaceStartOptions = {}): Promise<{ ok: true; url: string }> {
    if (serverUrl) return { ok: true, url: serverUrl };
    const requestedPort = requestedLoopbackPort(options);
    server = createServer((req, res) => {
      void handleRequest(req, res).catch((error) => {
        writeJson(res, 500, { ok: false, error: surfaceErrorMessage(error) });
      });
    });
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject);
      server?.listen(requestedPort ?? 0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${address.port}`;
    return { ok: true, url: serverUrl };
  }

  async function stopServer(): Promise<void> {
    for (const session of sessions.values()) closeSession(session);
    sessions.clear();
    if (!server) return;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    serverUrl = undefined;
  }

  function startSession(input: { sessionId: string; width?: number; height?: number; workspaceProfileDir?: string }): DesktopBrowserHostSurfaceState {
    if (!electron.WebContentsView) {
      return nativeSurfaceUnavailableState(requiredSessionId(input.sessionId));
    }
    const session = ensureSession(input.sessionId, {
      width: numberOr(input.width, 1365),
      height: numberOr(input.height, 900),
    }, input.workspaceProfileDir);
    return stateForSession(session);
  }

  async function navigate(sessionId: string, input: { url: string; timeoutMs?: number }): Promise<DesktopBrowserHostSurfaceState> {
    if (!sessions.has(sessionId) && !electron.WebContentsView) return nativeSurfaceUnavailableState(requiredSessionId(sessionId));
    const session = ensureSession(sessionId);
    const targetUrl = normalizeDesktopBrowserHostSurfaceUrl(input.url);
    if (!session.webContents.loadURL) return stateForSession(session, 'native-embedded-load-url-unavailable');
    await withTimeout(session.webContents.loadURL(targetUrl), numberOr(input.timeoutMs, 30_000), () => {
      session.webContents.stop?.();
    }).catch((error) => {
      if (!session.webContents.getURL?.()) throw error;
      pushDiagnostic(session, `native embedded navigation settled after timeout: ${surfaceErrorMessage(error)}`);
    });
    session.updatedAt = new Date().toISOString();
    return stateForSession(session);
  }

  function attach(input: {
    sessionId: string;
    bounds: DesktopBrowserHostSurfaceBounds;
    visible?: boolean;
    focus?: boolean;
  }): DesktopBrowserHostSurfaceState {
    if (!sessions.has(input.sessionId) && !electron.WebContentsView) return nativeSurfaceUnavailableState(requiredSessionId(input.sessionId));
    const session = ensureSession(input.sessionId);
    const window = mainWindowProvider?.();
    if (!window || window.isDestroyed?.() === true || !window.contentView?.addChildView) {
      return stateForSession(session, 'native-embedded-main-window-unavailable');
    }
    if (session.attachedWindow !== window) {
      session.attachedWindow?.contentView?.removeChildView?.(session.view);
      window.contentView.addChildView(session.view);
      session.attachedWindow = window;
    }
    const bounds = normalizeBounds(input.bounds);
    session.view.setBounds?.(bounds);
    session.view.setVisible?.(input.visible !== false);
    session.bounds = bounds;
    session.visible = input.visible !== false;
    session.updatedAt = new Date().toISOString();
    if (input.focus) {
      window.focus?.();
      session.webContents.focus?.();
    }
    return stateForSession(session);
  }

  function detach(sessionId: string): DesktopBrowserHostSurfaceState {
    const session = sessions.get(sessionId);
    if (!session) return missingState(sessionId);
    session.view.setVisible?.(false);
    session.attachedWindow?.contentView?.removeChildView?.(session.view);
    session.attachedWindow = undefined;
    session.visible = false;
    session.updatedAt = new Date().toISOString();
    return stateForSession(session);
  }

  function resize(input: {
    sessionId: string;
    bounds: DesktopBrowserHostSurfaceBounds;
    visible?: boolean;
  }): DesktopBrowserHostSurfaceState {
    const session = sessions.get(input.sessionId);
    if (!session) return missingState(input.sessionId);
    const bounds = normalizeBounds(input.bounds);
    session.view.setBounds?.(bounds);
    if (input.visible !== undefined) {
      session.view.setVisible?.(input.visible);
      session.visible = input.visible;
    }
    session.bounds = bounds;
    session.updatedAt = new Date().toISOString();
    return stateForSession(session);
  }

  async function action(sessionId: string, input: Record<string, unknown>): Promise<DesktopBrowserHostSurfaceState> {
    if (!sessions.has(sessionId) && !electron.WebContentsView) return nativeSurfaceUnavailableState(requiredSessionId(sessionId));
    const session = ensureSession(sessionId);
    const action = typeof input.action === 'string' ? input.action : '';
    if (action === 'back') {
      session.pendingHistoryAction = 'back';
      session.webContents.goBack?.();
      if (session.pendingHistoryAction === 'back') {
        session.canGoForward = true;
        session.pendingHistoryAction = undefined;
      }
    } else if (action === 'forward') {
      session.pendingHistoryAction = 'forward';
      session.webContents.goForward?.();
      if (session.pendingHistoryAction === 'forward') {
        session.canGoBack = true;
        session.pendingHistoryAction = undefined;
      }
    } else if (action === 'reload') {
      session.loading = true;
      session.webContents.reload?.();
    } else if (action === 'stop') {
      session.webContents.stop?.();
      session.loading = false;
    }
    else if (action === 'click') await sendMouseClick(session, numberOr(input.x, 0), numberOr(input.y, 0), mouseButton(input.button), 1);
    else if (action === 'double-click') await sendMouseClick(session, numberOr(input.x, 0), numberOr(input.y, 0), mouseButton(input.button), 2);
    else if (action === 'mouse-down') await sendMouseEvent(session, 'mouseDown', numberOr(input.x, 0), numberOr(input.y, 0), mouseButton(input.button));
    else if (action === 'mouse-move') await sendMouseEvent(session, 'mouseMove', numberOr(input.x, 0), numberOr(input.y, 0), mouseButton(input.button));
    else if (action === 'mouse-up') await sendMouseEvent(session, 'mouseUp', numberOr(input.x, 0), numberOr(input.y, 0), mouseButton(input.button));
    else if (action === 'drag') await sendDrag(session, input.path, mouseButton(input.button));
    else if (action === 'type') await session.webContents.insertText?.(typeof input.text === 'string' ? input.text : '');
    else if (action === 'press') await sendKeyPress(session, typeof input.key === 'string' ? input.key : 'Enter');
    else if (action === 'scroll') await sendWheel(session, numberOr(input.deltaX, 0), numberOr(input.deltaY, 800));
    else if (action === 'cursor') {
      const cursor = await cursorAt(session, numberOr(input.x, -1), numberOr(input.y, -1));
      return { ...stateForSession(session), diagnostics: [...session.diagnostics.slice(-10), `cursor:${cursor}`] };
    } else if (action === 'native-os-ui-proof') {
      return {
        ...stateForSession(session),
        nativeOsUiProof: await nativeOsUiProofForSession(session, input),
      };
    } else if (action === 'close') {
      closeSession(session);
      sessions.delete(session.id);
      return { ...stateForSession(session), ok: true, visible: false };
    } else {
      return stateForSession(session, `unsupported-native-embedded-action:${action || 'missing'}`);
    }
    session.updatedAt = new Date().toISOString();
    return stateForSession(session);
  }

  async function screenshot(sessionId: string): Promise<DesktopBrowserHostSurfaceState & { mimeType?: 'image/png'; dataUrl?: string }> {
    const session = sessions.get(sessionId);
    if (!session) return missingState(sessionId);
    const image = await session.webContents.capturePage?.();
    const dataUrl = image?.toDataURL?.();
    if (!dataUrl) return stateForSession(session, 'native-embedded-screenshot-unavailable');
    return { ...stateForSession(session), mimeType: 'image/png', dataUrl };
  }

  async function writeScreenshot(sessionId: string, outputPath: unknown): Promise<DesktopBrowserHostSurfaceEvidenceWriteResult> {
    const session = sessions.get(sessionId);
    const path = nativeEvidenceOutputPath(outputPath);
    if (!path) return evidenceWriteResult(sessionId, 'screenshot', 'native-embedded-evidence-output-path-invalid');
    if (!session) return evidenceWriteResult(sessionId, 'screenshot', 'native-embedded-session-not-found');
    const image = await session.webContents.capturePage?.();
    const buffer = image?.toPNG
      ? Buffer.from(image.toPNG())
      : dataUrlPngBuffer(image?.toDataURL?.());
    if (!buffer?.length) return evidenceWriteResult(sessionId, 'screenshot', 'native-embedded-screenshot-unavailable');
    return writeEvidenceOutput(session.id, 'screenshot', path, buffer, 'image/png');
  }

  async function content(sessionId: string): Promise<{ ok: boolean; content: string; reason?: string }> {
    const session = sessions.get(sessionId);
    if (!session) return { ok: false, content: '', reason: 'native-embedded-session-not-found' };
    const value = await executeJavaScript<string>(session, 'document.documentElement ? document.documentElement.outerHTML : ""', '');
    return { ok: true, content: value };
  }

  async function writeContent(sessionId: string, outputPath: unknown): Promise<DesktopBrowserHostSurfaceEvidenceWriteResult> {
    const session = sessions.get(sessionId);
    const path = nativeEvidenceOutputPath(outputPath);
    if (!path) return evidenceWriteResult(sessionId, 'dom', 'native-embedded-evidence-output-path-invalid');
    if (!session) return evidenceWriteResult(sessionId, 'dom', 'native-embedded-session-not-found');
    const value = await executeJavaScript<string>(session, 'document.documentElement ? document.documentElement.outerHTML : ""', '');
    return writeEvidenceOutput(session.id, 'dom', path, Buffer.from(value, 'utf8'), 'text/html');
  }

  async function text(sessionId: string): Promise<{ ok: boolean; text: string; reason?: string }> {
    const session = sessions.get(sessionId);
    if (!session) return { ok: false, text: '', reason: 'native-embedded-session-not-found' };
    const value = await executeJavaScript<string>(session, 'document.body ? document.body.innerText : ""', '');
    return { ok: true, text: cleanText(value) };
  }

  async function writeText(sessionId: string, outputPath: unknown): Promise<DesktopBrowserHostSurfaceEvidenceWriteResult> {
    const session = sessions.get(sessionId);
    const path = nativeEvidenceOutputPath(outputPath);
    if (!path) return evidenceWriteResult(sessionId, 'text', 'native-embedded-evidence-output-path-invalid');
    if (!session) return evidenceWriteResult(sessionId, 'text', 'native-embedded-session-not-found');
    const value = await executeJavaScript<string>(session, 'document.body ? document.body.innerText : ""', '');
    return writeEvidenceOutput(session.id, 'text', path, Buffer.from(cleanText(value), 'utf8'), 'text/plain');
  }

  async function axSnapshot(sessionId: string): Promise<{ ok: boolean; snapshot: unknown; reason?: string }> {
    const session = sessions.get(sessionId);
    if (!session) return { ok: false, snapshot: {}, reason: 'native-embedded-session-not-found' };
    const snapshot = await executeJavaScript(session, `(() => ({
      role: 'document',
      name: document.title || '',
      text: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 4000)
    }))()`, {});
    return { ok: true, snapshot };
  }

  async function writeAxSnapshot(sessionId: string, outputPath: unknown): Promise<DesktopBrowserHostSurfaceEvidenceWriteResult> {
    const session = sessions.get(sessionId);
    const path = nativeEvidenceOutputPath(outputPath);
    if (!path) return evidenceWriteResult(sessionId, 'ax', 'native-embedded-evidence-output-path-invalid');
    if (!session) return evidenceWriteResult(sessionId, 'ax', 'native-embedded-session-not-found');
    const snapshot = await executeJavaScript(session, `(() => ({
      role: 'document',
      name: document.title || '',
      text: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 4000)
    }))()`, {});
    return writeEvidenceOutput(session.id, 'ax', path, Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8'), 'application/json');
  }

  async function searchResults(sessionId: string, limit: number): Promise<{ ok: boolean; results: Array<{ title: string; url: string; snippet: string }>; reason?: string }> {
    const session = sessions.get(sessionId);
    if (!session) return { ok: false, results: [], reason: 'native-embedded-session-not-found' };
    const results = await executeJavaScript<Array<{ title: string; url: string; snippet: string }>>(session, `(() => {
      return ${browserHostDiscoveryResultExtractionScript(limit)};
    })()`, []);
    return { ok: true, results };
  }

  function state(sessionId: string): DesktopBrowserHostSurfaceState {
    const session = sessions.get(sessionId);
    return session ? stateForSession(session) : missingState(sessionId);
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    recordAuditRequest(audit, req.method ?? 'GET', url.pathname);
    if (req.method === 'GET' && url.pathname === '/health') {
      const ready = Boolean(electron.WebContentsView);
      writeJson(res, 200, {
        ok: ready,
        service: 'sciforge-desktop-browser-host-surface',
        status: ready ? 'ready' : 'blocked',
        ready,
        surface: 'electron-web-contents-view',
        liveSurfaceTransport: 'native-embedded',
        owner: 'BrowserHostSession',
        adapterRole: 'display-input-adapter',
        nativeBridge: true,
        rightPaneBridge: true,
        attachAvailable: true,
        detachAvailable: true,
        resizeAvailable: true,
        stateAvailable: true,
        singleInteractiveTruth: true,
        secondTruthSource: false,
        passClaim: ready,
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/audit') {
      writeJson(res, 200, surfaceAuditSnapshot(audit));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/sessions/start') {
      const body = await readJsonBody(req);
      writeJson(res, 200, startSession({
        sessionId: requiredSessionId(body.sessionId),
        width: numberOr(body.width, 1365),
        height: numberOr(body.height, 900),
      }));
      return;
    }
    const match = /^\/sessions\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (!match) {
      writeJson(res, 404, { ok: false, error: `Unknown native embedded browser route: ${url.pathname}` });
      return;
    }
    const sessionId = decodeURIComponent(match[1]);
    const route = match[2];
    if (req.method === 'GET' && route === 'state') writeJson(res, 200, state(sessionId));
    else if (req.method === 'GET' && isRawEvidenceRoute(route)) writeJson(res, 405, blockedRawEvidenceRoute(sessionId, route));
    else if (req.method === 'POST' && route === 'screenshot') {
      const body = await readJsonBody(req);
      writeJson(res, 200, await writeScreenshot(sessionId, body.outputPath));
    } else if (req.method === 'POST' && route === 'content') {
      const body = await readJsonBody(req);
      writeJson(res, 200, await writeContent(sessionId, body.outputPath));
    } else if (req.method === 'POST' && route === 'text') {
      const body = await readJsonBody(req);
      writeJson(res, 200, await writeText(sessionId, body.outputPath));
    } else if (req.method === 'POST' && route === 'ax') {
      const body = await readJsonBody(req);
      writeJson(res, 200, await writeAxSnapshot(sessionId, body.outputPath));
    }
    else if (req.method === 'GET' && route === 'search-results') writeJson(res, 200, await searchResults(sessionId, Number(url.searchParams.get('limit') ?? '5')));
    else if (req.method === 'GET' && route === 'audit') writeJson(res, 200, surfaceAuditSnapshot(audit, sessionId));
    else if (req.method === 'POST' && route === 'attach') writeJson(res, 200, attach({ sessionId, ...(await readJsonBody(req)) as { bounds: DesktopBrowserHostSurfaceBounds; visible?: boolean; focus?: boolean } }));
    else if (req.method === 'POST' && route === 'detach') writeJson(res, 200, detach(sessionId));
    else if (req.method === 'POST' && route === 'resize') writeJson(res, 200, resize({ sessionId, ...(await readJsonBody(req)) as { bounds: DesktopBrowserHostSurfaceBounds; visible?: boolean } }));
    else if (req.method === 'POST' && route === 'navigate') writeJson(res, 200, await navigate(sessionId, await readJsonBody(req) as { url: string; timeoutMs?: number }));
    else if (req.method === 'POST' && route === 'actions') writeJson(res, 200, await action(sessionId, await readJsonBody(req)));
    else writeJson(res, 405, { ok: false, error: `Unsupported native embedded browser method: ${req.method} ${url.pathname}` });
  }

  function ensureSession(
    sessionId: string,
    viewport: { width: number; height: number } = { width: 1365, height: 900 },
    workspaceProfileDir?: string,
  ): DesktopBrowserHostSurfaceSession {
    const safeId = requiredSessionId(sessionId);
    const current = sessions.get(safeId);
    if (current) return current;
    if (!electron.WebContentsView) throw new Error('Electron WebContentsView is unavailable for native embedded BrowserHostSession surfaces.');
    const profilePartition = browserHostSurfaceProfilePartition(safeId, workspaceProfileDir);
    const view = new electron.WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: profilePartition,
      },
    });
    view.setVisible?.(false);
    const session: DesktopBrowserHostSurfaceSession = {
      id: safeId,
      view,
      webContents: view.webContents,
      viewport,
      visible: false,
      updatedAt: new Date().toISOString(),
      lastMouse: { x: 0, y: 0 },
      diagnostics: [],
      url: 'about:blank',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      history: ['about:blank'],
      historyIndex: 0,
      profilePartition,
    };
    installWebContentsWindowOpenPolicy(session);
    installWebContentsStateListeners(session);
    sessions.set(safeId, session);
    return session;
  }

  return {
    attach,
    detach,
    navigate,
    action,
    resize,
    screenshot,
    content,
    text,
    axSnapshot,
    searchResults,
    state,
    startSession,
    startServer,
    stopServer,
    setMainWindow,
    serverUrl: () => serverUrl,
  };
}

async function sendMouseClick(session: DesktopBrowserHostSurfaceSession, x: number, y: number, button: string, clickCount: number): Promise<void> {
  await sendMouseEvent(session, 'mouseDown', x, y, button, clickCount);
  await sendMouseEvent(session, 'mouseUp', x, y, button, clickCount);
}

async function sendMouseEvent(
  session: DesktopBrowserHostSurfaceSession,
  type: 'mouseDown' | 'mouseMove' | 'mouseUp',
  x: number,
  y: number,
  button = 'left',
  clickCount = 1,
): Promise<void> {
  session.lastMouse = { x, y };
  await session.webContents.sendInputEvent?.({
    type,
    x,
    y,
    button,
    clickCount,
  });
}

async function sendDrag(session: DesktopBrowserHostSurfaceSession, value: unknown, button: string): Promise<void> {
  const path = Array.isArray(value) ? value.filter(isMousePoint) : [];
  if (path.length < 2) return;
  const [first, ...rest] = path;
  await sendMouseEvent(session, 'mouseDown', first.x, first.y, button);
  for (const point of rest) await sendMouseEvent(session, 'mouseMove', point.x, point.y, button);
  const last = path[path.length - 1];
  await sendMouseEvent(session, 'mouseUp', last.x, last.y, button);
}

async function sendWheel(session: DesktopBrowserHostSurfaceSession, deltaX: number, deltaY: number): Promise<void> {
  await session.webContents.sendInputEvent?.({
    type: 'mouseWheel',
    x: session.lastMouse.x,
    y: session.lastMouse.y,
    deltaX,
    deltaY,
  });
}

async function sendKeyPress(session: DesktopBrowserHostSurfaceSession, key: string): Promise<void> {
  const parsed = parseKeyPress(key);
  await session.webContents.sendInputEvent?.({
    type: 'keyDown',
    keyCode: parsed.keyCode,
    modifiers: parsed.modifiers,
  });
  await session.webContents.sendInputEvent?.({
    type: 'keyUp',
    keyCode: parsed.keyCode,
    modifiers: parsed.modifiers,
  });
}

async function cursorAt(session: DesktopBrowserHostSurfaceSession, x: number, y: number): Promise<string> {
  if (x < 0 || y < 0) return 'default';
  return executeJavaScript<string>(session, `(() => {
    const element = document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)});
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return 'default';
    const cursor = getComputedStyle(element).cursor;
    if (cursor && cursor !== 'auto' && cursor !== 'default') return cursor;
    if (element.closest('input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"], [contenteditable=""]')) return 'text';
    if (element.closest('a[href], button:not(:disabled), summary, select, label, [role="button"], [role="link"], [role="menuitem"], input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"]')) return 'pointer';
    return 'default';
  })()`, 'default');
}

async function nativeOsUiProofForSession(
  session: DesktopBrowserHostSurfaceSession,
  input: Record<string, unknown>,
): Promise<BrowserHostSessionNativeOsUiProof> {
  const proofGroup = nativeOsUiProofGroup(input.proofGroup);
  const actionId = boundedNativeOsUiToken(input.actionId) ?? 'native-os-ui-proof';
  const expectedProofNames = expectedNativeOsUiProofNames(input.expectedProofNames, proofGroup);
  const observed: string[] = [];
  const evidenceTokens = [
    session.attachedWindow ? 'native-surface:attached:true' : undefined,
  ];
  if (proofGroup === 'cursorCaret') {
    const raw = await executeJavaScript<Record<string, unknown>>(session, `(() => {
      const active = document.activeElement;
      const activeEditable = active instanceof HTMLInputElement
        || active instanceof HTMLTextAreaElement
        || Boolean(active && active.isContentEditable);
      let caretVisible = false;
      if (activeEditable && active && typeof active.selectionStart === 'number') {
        caretVisible = true;
      } else if (activeEditable && document.getSelection) {
        caretVisible = Boolean(document.getSelection()?.rangeCount);
      }
      let blurred = false;
      let restored = false;
      if (active && typeof active.blur === 'function' && typeof active.focus === 'function') {
        active.blur();
        blurred = document.activeElement !== active;
        active.focus();
        restored = document.activeElement === active;
      }
      return { activeEditable, caretVisible, blurred, restored };
    })()`, {});
    const activeEditable = raw.activeEditable === true;
    const caretVisible = raw.caretVisible === true;
    const blurred = raw.blurred === true;
    const restored = raw.restored === true;
    if (activeEditable && caretVisible) observed.push('input-caret-visible');
    if (blurred && restored) observed.push('focus-blur-restore');
    evidenceTokens.push(
      activeEditable ? 'caret:active-editable:true' : undefined,
      caretVisible ? 'caret:visible:true' : undefined,
      blurred ? 'focus:blurred:true' : undefined,
      restored ? 'focus:restored:true' : undefined,
      restored ? 'focus:restored-same-logical-target:true' : undefined,
    );
  }
  const observedProofNames = observed.filter((proofName) => (
    expectedProofNames.length === 0 || expectedProofNames.includes(proofName)
  ));
  const boundedEvidenceTokens = [
    ...evidenceTokens,
    ...observedProofNames.map((proofName) => `proof:${proofName}:observed`),
  ].filter((token): token is string => Boolean(token));
  return {
    schemaVersion: BROWSER_HOST_NATIVE_OS_UI_PROOF_SCHEMA,
    boundedEvidenceOnly: true,
    rawDomRecorded: false,
    rawTextRecorded: false,
    rawUrlRecorded: false,
    rawTitleRecorded: false,
    rawSelectorRecorded: false,
    rawCoordsRecorded: false,
    rawPayloadRecorded: false,
    source: 'native-embedded-action-state',
    proofGroup,
    actionId,
    observedProofNames,
    evidenceTokens: boundedEvidenceTokens,
    diagnostics: boundedEvidenceTokens.filter((token) => token.startsWith('proof:')),
  };
}

async function executeJavaScript<T>(session: DesktopBrowserHostSurfaceSession, code: string, fallback: T): Promise<T> {
  if (!session.webContents.executeJavaScript) return fallback;
  return session.webContents.executeJavaScript<T>(code, true).catch(() => fallback);
}

function stateForSession(session: DesktopBrowserHostSurfaceSession, reason?: string): DesktopBrowserHostSurfaceState {
  const ok = !reason;
  const embedded = Boolean(session.attachedWindow);
  const loading = session.webContents.isLoadingMainFrame?.() ?? session.webContents.isLoading?.() ?? session.loading;
  const canGoBack = session.webContents.canGoBack?.() ?? session.canGoBack;
  const canGoForward = session.webContents.canGoForward?.() ?? session.canGoForward;
  const productSurface = ok && embedded && session.visible === true;
  const diagnosticReasons = surfaceDiagnosticReasons({
    reason,
    embedded,
    visible: session.visible,
    missingNativeSurface: false,
  });
  const diagnostics = boundedSurfaceDiagnostics(session.diagnostics, diagnosticReasons);
  const refs = surfaceEvidenceRefs(session.id);
  return {
    ok,
    sessionId: session.id,
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    surface: 'electron-web-contents-view',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    ready: productSurface,
    nativeBridge: true,
    rightPaneBridge: true,
    attachAvailable: true,
    detachAvailable: true,
    resizeAvailable: true,
    stateAvailable: true,
    liveSurfaceRef: refs.liveSurfaceRef,
    status: embedded ? 'attached' : 'detached',
    embedded,
    secondTruthSource: false,
    passClaim: productSurface,
    claimScope: productSurface ? 'visible-product-surface' : 'hidden-or-diagnostic',
    diagnosticOnly: !productSurface,
    surfaceRef: refs.surfaceRef,
    visibleEvidenceRef: refs.visibleEvidenceRef,
    readinessEvidenceRef: refs.readinessEvidenceRef,
    passClaimRef: refs.passClaimRef,
    diagnosticRef: productSurface ? undefined : refs.diagnosticRef,
    surfaceEvidence: surfaceEvidenceFor({
      refs,
      visible: session.visible === true,
      embedded,
      productSurface,
      missingNativeSurface: false,
      diagnostics,
    }),
    url: session.webContents.getURL?.() || session.url || undefined,
    title: session.webContents.getTitle?.() || session.title || undefined,
    loading,
    canGoBack,
    canGoForward,
    bounds: session.bounds,
    visible: session.visible,
    reason,
    diagnostics,
  };
}

function installWebContentsStateListeners(session: DesktopBrowserHostSurfaceSession): void {
  const on = session.webContents.on?.bind(session.webContents);
  if (!on) return;
  on('did-start-loading', () => {
    session.loading = true;
    touchSession(session);
  });
  on('did-stop-loading', () => {
    session.loading = false;
    touchSession(session);
  });
  on('did-start-navigation', (...args) => {
    const url = firstString(args);
    if (url) session.url = url;
    session.loading = true;
    touchSession(session);
  });
  on('did-navigate', (...args) => {
    const url = firstString(args);
    if (url) recordCommittedNavigation(session, url);
    session.loading = false;
    touchSession(session);
  });
  on('did-navigate-in-page', (...args) => {
    const url = firstString(args);
    if (url) recordCommittedNavigation(session, url);
    touchSession(session);
  });
  on('page-title-updated', (...args) => {
    const title = firstString(args);
    if (title) session.title = title;
    touchSession(session);
  });
  on('did-finish-load', () => {
    session.loading = false;
    const url = session.webContents.getURL?.() || session.url;
    if (url) recordCommittedNavigation(session, url);
    const title = session.webContents.getTitle?.() || session.title;
    if (title) session.title = title;
    touchSession(session);
  });
  on('did-fail-load', (...args) => {
    const code = firstNumber(args);
    const description = firstStringAfterNumber(args) ?? 'unknown';
    const url = lastString(args);
    if (url) session.url = url;
    session.loading = false;
    pushDiagnostic(session, `native embedded load failed: ${description} (${code ?? 'unknown'})`);
    touchSession(session);
  });
}

function installWebContentsWindowOpenPolicy(session: DesktopBrowserHostSurfaceSession): void {
  if (session.webContents.setWindowOpenHandler) {
    session.webContents.setWindowOpenHandler((details) => {
      navigateWindowOpenInPlace(session, details.url);
      return { action: 'deny' };
    });
    pushDiagnostic(session, 'native embedded window open policy installed');
  }

  const on = session.webContents.on?.bind(session.webContents);
  if (!on) return;
  on('did-create-window', (...args) => {
    closeCreatedWindow(args);
    navigateWindowOpenInPlace(session, windowOpenUrlFromDidCreateWindowArgs(args));
  });
}

function navigateWindowOpenInPlace(session: DesktopBrowserHostSurfaceSession, rawUrl: unknown): void {
  const targetUrl = normalizeDesktopBrowserHostSurfaceUrl(typeof rawUrl === 'string' ? rawUrl : 'about:blank');
  session.url = targetUrl;
  session.loading = true;
  touchSession(session);
  pushDiagnostic(session, 'native embedded window open denied and redirected in-place');
  const loaded = session.webContents.loadURL?.(targetUrl);
  if (loaded && typeof loaded.catch === 'function') {
    loaded.catch((error) => {
      session.loading = false;
      pushDiagnostic(session, `native embedded window open redirect failed: ${surfaceErrorMessage(error)}`);
      touchSession(session);
    });
  }
}

function windowOpenUrlFromDidCreateWindowArgs(args: unknown[]): string | undefined {
  for (const arg of args) {
    if (arg && typeof arg === 'object' && 'url' in arg) {
      const url = (arg as { url?: unknown }).url;
      if (typeof url === 'string' && url.length > 0) return url;
    }
  }
  return firstString(args);
}

function closeCreatedWindow(args: unknown[]): void {
  for (const arg of args) {
    if (arg && typeof arg === 'object' && 'close' in arg && typeof (arg as { close?: unknown }).close === 'function') {
      (arg as { close(): void }).close();
      return;
    }
  }
}

function recordCommittedNavigation(session: DesktopBrowserHostSurfaceSession, url: string): void {
  session.url = url;
  if (session.pendingHistoryAction === 'back') {
    if (session.historyIndex > 0) session.historyIndex -= 1;
    session.canGoBack = session.historyIndex > 0;
    session.canGoForward = true;
    session.pendingHistoryAction = undefined;
    return;
  }
  if (session.pendingHistoryAction === 'forward') {
    if (session.historyIndex < session.history.length - 1) session.historyIndex += 1;
    session.canGoBack = true;
    session.canGoForward = session.historyIndex >= 0 && session.historyIndex < session.history.length - 1;
    session.pendingHistoryAction = undefined;
    return;
  }
  if (session.history[session.historyIndex] === url) {
    updateHistoryState(session);
    return;
  }
  if (session.historyIndex < session.history.length - 1) session.history.splice(session.historyIndex + 1);
  session.history.push(url);
  session.historyIndex = session.history.length - 1;
  updateHistoryState(session);
}

function updateHistoryState(session: DesktopBrowserHostSurfaceSession): void {
  session.canGoBack = session.historyIndex > 0;
  session.canGoForward = session.historyIndex >= 0 && session.historyIndex < session.history.length - 1;
}

function pushDiagnostic(session: DesktopBrowserHostSurfaceSession, diagnostic: string): void {
  session.diagnostics.push(diagnostic);
  if (session.diagnostics.length > 40) session.diagnostics.splice(0, session.diagnostics.length - 40);
}

function touchSession(session: DesktopBrowserHostSurfaceSession): void {
  session.updatedAt = new Date().toISOString();
}

function firstString(args: unknown[]): string | undefined {
  return args.find((arg): arg is string => typeof arg === 'string' && arg.length > 0);
}

function lastString(args: unknown[]): string | undefined {
  return args.findLast((arg): arg is string => typeof arg === 'string' && arg.length > 0);
}

function firstNumber(args: unknown[]): number | undefined {
  return args.find((arg): arg is number => typeof arg === 'number' && Number.isFinite(arg));
}

function firstStringAfterNumber(args: unknown[]): string | undefined {
  const numberIndex = args.findIndex((arg) => typeof arg === 'number' && Number.isFinite(arg));
  if (numberIndex < 0) return undefined;
  return args.slice(numberIndex + 1).find((arg): arg is string => typeof arg === 'string' && arg.length > 0);
}

function missingState(sessionId: string): DesktopBrowserHostSurfaceState {
  const refs = surfaceEvidenceRefs(sessionId);
  const diagnostics = boundedSurfaceDiagnostics([], ['native-embedded-session-not-found']);
  return {
    ok: false,
    sessionId,
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    surface: 'electron-web-contents-view',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    ready: false,
    nativeBridge: true,
    rightPaneBridge: true,
    attachAvailable: true,
    detachAvailable: true,
    resizeAvailable: true,
    stateAvailable: true,
    liveSurfaceRef: refs.liveSurfaceRef,
    status: 'detached',
    embedded: false,
    secondTruthSource: false,
    passClaim: false,
    claimScope: 'hidden-or-diagnostic',
    diagnosticOnly: true,
    surfaceRef: refs.surfaceRef,
    visibleEvidenceRef: refs.visibleEvidenceRef,
    readinessEvidenceRef: refs.readinessEvidenceRef,
    passClaimRef: refs.passClaimRef,
    diagnosticRef: refs.diagnosticRef,
    surfaceEvidence: surfaceEvidenceFor({
      refs,
      visible: false,
      embedded: false,
      productSurface: false,
      missingNativeSurface: false,
      diagnostics,
    }),
    reason: 'native-embedded-session-not-found',
    diagnostics,
  };
}

function nativeSurfaceUnavailableState(sessionId: string): DesktopBrowserHostSurfaceState {
  const refs = surfaceEvidenceRefs(sessionId);
  const reason = 'native-embedded-web-contents-view-unavailable';
  const diagnostics = boundedSurfaceDiagnostics([], [reason]);
  return {
    ok: false,
    sessionId,
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    surface: 'electron-web-contents-view',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    ready: false,
    nativeBridge: true,
    rightPaneBridge: true,
    attachAvailable: true,
    detachAvailable: true,
    resizeAvailable: true,
    stateAvailable: true,
    liveSurfaceRef: refs.liveSurfaceRef,
    status: 'detached',
    embedded: false,
    secondTruthSource: false,
    passClaim: false,
    claimScope: 'hidden-or-diagnostic',
    diagnosticOnly: true,
    surfaceRef: refs.surfaceRef,
    visibleEvidenceRef: refs.visibleEvidenceRef,
    readinessEvidenceRef: refs.readinessEvidenceRef,
    passClaimRef: refs.passClaimRef,
    diagnosticRef: refs.diagnosticRef,
    surfaceEvidence: surfaceEvidenceFor({
      refs,
      visible: false,
      embedded: false,
      productSurface: false,
      missingNativeSurface: true,
      diagnostics,
    }),
    reason,
    diagnostics,
  };
}

function surfaceEvidenceRefs(sessionId: string): {
  sessionRef: string;
  liveSurfaceRef: string;
  surfaceRef: string;
  visibleEvidenceRef: string;
  readinessEvidenceRef: string;
  passClaimRef: string;
  diagnosticRef: string;
} {
  const root = `browser-host-session:${sessionId}`;
  return {
    sessionRef: `${root}/session.json`,
    liveSurfaceRef: `${root}/live-surface`,
    surfaceRef: `${root}/surface/electron-web-contents-view`,
    visibleEvidenceRef: `${root}/surface/visibility`,
    readinessEvidenceRef: `${root}/surface/readiness`,
    passClaimRef: `${root}/surface/pass-claim`,
    diagnosticRef: `${root}/surface/diagnostics`,
  };
}

function surfaceEvidenceFor(input: {
  refs: ReturnType<typeof surfaceEvidenceRefs>;
  visible: boolean;
  embedded: boolean;
  productSurface: boolean;
  missingNativeSurface: boolean;
  diagnostics: string[];
}): DesktopBrowserHostSurfaceEvidence {
  const diagnosticOnly = !input.productSurface;
  const evidenceRefs = [
    input.refs.surfaceRef,
    input.refs.liveSurfaceRef,
    input.refs.visibleEvidenceRef,
    input.refs.readinessEvidenceRef,
    input.refs.passClaimRef,
    diagnosticOnly ? input.refs.diagnosticRef : undefined,
  ].filter((ref): ref is string => Boolean(ref));
  return {
    refsFirst: true,
    boundedEvidenceOnly: true,
    evidenceMode: 'bounded-refs-and-summaries',
    sessionRef: input.refs.sessionRef,
    liveSurfaceRef: input.refs.liveSurfaceRef,
    surfaceRef: input.refs.surfaceRef,
    visibleEvidenceRef: input.refs.visibleEvidenceRef,
    readinessEvidenceRef: input.refs.readinessEvidenceRef,
    passClaimRef: input.refs.passClaimRef,
    diagnosticRef: diagnosticOnly ? input.refs.diagnosticRef : undefined,
    visible: input.visible,
    embedded: input.embedded,
    productSurface: input.productSurface,
    missingNativeSurface: input.missingNativeSurface,
    diagnosticOnly,
    passClaim: input.productSurface,
    evidenceRefs,
    diagnostics: input.diagnostics,
    payloadPolicy: {
      rawScreenshot: false,
      dataUrl: false,
      inlineBinaryPayload: false,
    },
  };
}

function surfaceDiagnosticReasons(input: {
  reason?: string;
  embedded: boolean;
  visible: boolean;
  missingNativeSurface: boolean;
}): string[] {
  return [
    input.reason,
    input.missingNativeSurface ? 'native-embedded-web-contents-view-unavailable' : undefined,
    input.embedded ? undefined : 'native-embedded-surface-detached',
    input.embedded && !input.visible ? 'native-embedded-surface-hidden' : undefined,
  ].filter((entry): entry is string => Boolean(entry));
}

function boundedSurfaceDiagnostics(diagnostics: string[], reasons: string[] = []): string[] {
  const entries: string[] = [];
  for (const raw of [...diagnostics, ...reasons]) {
    const diagnostic = boundedSurfaceDiagnostic(raw);
    if (diagnostic && !entries.includes(diagnostic)) entries.push(diagnostic);
  }
  return entries.slice(-20);
}

function boundedSurfaceDiagnostic(value: string): string {
  const sanitized = value
    .replace(/data:[^\s"'<>]+/gi, '[redacted-data-url]')
    .replace(/\bbase64\b\s*[:,=]?\s*[a-z0-9+/=._-]*/gi, 'base64:[redacted]')
    .replace(/[a-z0-9+/]{96,}={0,2}/gi, '[redacted-long-token]')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized.length > 180 ? `${sanitized.slice(0, 177)}...` : sanitized;
}

function closeSession(session: DesktopBrowserHostSurfaceSession): void {
  session.view.setVisible?.(false);
  session.attachedWindow?.contentView?.removeChildView?.(session.view);
  session.attachedWindow = undefined;
  session.visible = false;
  session.webContents.close?.();
}

function normalizeDesktopBrowserHostSurfaceUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'about:blank';
  if (/^about:blank$/i.test(trimmed)) return 'about:blank';
  if (/^(?:https?:|file:|about:)/i.test(trimmed)) return trimmed;
  if (/^(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

function normalizeBounds(bounds: DesktopBrowserHostSurfaceBounds): DesktopBrowserHostSurfaceBounds {
  return {
    x: Math.max(0, Math.round(numberOr(bounds?.x, 0))),
    y: Math.max(0, Math.round(numberOr(bounds?.y, 0))),
    width: Math.max(1, Math.round(numberOr(bounds?.width, 1))),
    height: Math.max(1, Math.round(numberOr(bounds?.height, 1))),
  };
}

function nativeOsUiProofGroup(value: unknown): BrowserHostSessionNativeOsUiProof['proofGroup'] {
  if (value === 'mouseContextMenu' || value === 'keyboardImeClipboardSelection' || value === 'rerenderFocus') return value;
  return 'cursorCaret';
}

function expectedNativeOsUiProofNames(value: unknown, proofGroup: BrowserHostSessionNativeOsUiProof['proofGroup']): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(NATIVE_OS_UI_PROOF_NAMES_BY_GROUP[proofGroup]);
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && allowed.has(entry)))];
}

function boundedNativeOsUiToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(token)) return undefined;
  if (/https?:|file:|data:|blob:|javascript:|<html|<input|endpoint|url:|title:|selector|coords?|payload|provider|secret|api[-_]?key|raw-leak/i.test(token)) return undefined;
  return token;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.reduce((sum, item) => sum + item.length, 0) > 1024 * 1024) throw new Error('Native browser host request body is too large.');
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function writeJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': 'http://localhost',
  });
  res.end(JSON.stringify(body));
}

function createSurfaceAudit(): DesktopBrowserHostSurfaceAudit {
  return {
    schemaVersion: DESKTOP_BROWSER_HOST_SURFACE_AUDIT_SCHEMA,
    ok: true,
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    counters: Object.fromEntries(SURFACE_AUDIT_ROUTES.map((route) => [route, 0])) as Record<DesktopBrowserHostSurfaceAuditRoute, number>,
    recentRequests: [],
  };
}

function surfaceAuditSnapshot(audit: DesktopBrowserHostSurfaceAudit, sessionId?: string): DesktopBrowserHostSurfaceAudit {
  return {
    ...audit,
    counters: { ...audit.counters },
    recentRequests: audit.recentRequests
      .filter((entry) => !sessionId || entry.sessionId === sessionId || entry.route === 'health' || entry.route === 'audit')
      .slice(-80),
  };
}

function recordAuditRequest(audit: DesktopBrowserHostSurfaceAudit, method: string, pathname: string): void {
  const classified = classifyAuditRoute(pathname);
  audit.counters[classified.route] += 1;
  audit.recentRequests.push({
    at: new Date().toISOString(),
    method: method.slice(0, 12).toUpperCase(),
    route: classified.route,
    sessionId: classified.sessionId,
  });
  if (audit.recentRequests.length > 120) audit.recentRequests.splice(0, audit.recentRequests.length - 120);
}

function classifyAuditRoute(pathname: string): { route: DesktopBrowserHostSurfaceAuditRoute; sessionId?: string } {
  if (pathname === '/health') return { route: 'health' };
  if (pathname === '/audit') return { route: 'audit' };
  if (pathname === '/sessions/start') return { route: 'start' };
  if (/frame-stream|\/frame(?:\/|$)/i.test(pathname)) return { route: 'frame-stream' };
  const match = /^\/sessions\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!match) return { route: 'unknown' };
  const route = SURFACE_AUDIT_ROUTES.includes(match[2] as DesktopBrowserHostSurfaceAuditRoute)
    ? match[2] as DesktopBrowserHostSurfaceAuditRoute
    : 'unknown';
  return { route, sessionId: decodeURIComponent(match[1]) };
}

const SURFACE_AUDIT_ROUTES: DesktopBrowserHostSurfaceAuditRoute[] = [
  'health',
  'start',
  'navigate',
  'attach',
  'detach',
  'resize',
  'actions',
  'state',
  'screenshot',
  'content',
  'text',
  'ax',
  'search-results',
  'frame-stream',
  'audit',
  'unknown',
];

function requiredSessionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw new Error('Native embedded BrowserHostSession requires a safe sessionId.');
  return value;
}

function browserHostSurfaceProfilePartition(sessionId: string, workspaceProfileDir: unknown): string {
  const profileDir = typeof workspaceProfileDir === 'string' ? workspaceProfileDir.trim() : '';
  const source = profileDir || `session:${sessionId}`;
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 16);
  return profileDir ? `persist:sciforge-browser-host-${digest}` : `sciforge-browser-host-${digest}`;
}

function requestedLoopbackPort(options: DesktopBrowserHostSurfaceStartOptions): number | undefined {
  const explicitPort = validTcpPort(options.port);
  if (explicitPort) return explicitPort;
  const value = options.url?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) return undefined;
    return validTcpPort(Number(url.port));
  } catch {
    return undefined;
  }
}

function validTcpPort(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535 ? value : undefined;
}

function isLoopbackHost(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[|\]$/g, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function mouseButton(value: unknown): string {
  return value === 'right' || value === 'middle' ? value : 'left';
}

function isMousePoint(value: unknown): value is { x: number; y: number } {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as { x?: unknown }).x === 'number'
    && typeof (value as { y?: unknown }).y === 'number';
}

function parseKeyPress(value: string): { keyCode: string; modifiers: string[] } {
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
  const key = parts.pop() || 'Enter';
  const modifiers = parts
    .map((part) => part === 'Control' ? 'control' : part === 'Meta' ? 'meta' : part === 'Alt' ? 'alt' : part === 'Shift' ? 'shift' : '')
    .filter(Boolean);
  const keyCode = key === 'Space' ? ' ' : key;
  return { keyCode, modifiers };
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function nativeEvidenceOutputPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('\0') || trimmed.length > 4096) return undefined;
  return isAbsolute(trimmed) ? trimmed : undefined;
}

function dataUrlPngBuffer(value: unknown): Buffer | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(value);
  if (!match) return undefined;
  return Buffer.from(match[1], 'base64');
}

async function writeEvidenceOutput(
  sessionId: string,
  outputKind: DesktopBrowserHostSurfaceEvidenceOutputKind,
  outputPath: string,
  bytes: Buffer,
  mimeType: NonNullable<DesktopBrowserHostSurfaceEvidenceWriteResult['mimeType']>,
): Promise<DesktopBrowserHostSurfaceEvidenceWriteResult> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  return {
    ok: true,
    sessionId,
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    liveSurfaceTransport: 'native-embedded',
    nativeBridge: true,
    rightPaneBridge: true,
    outputKind,
    mimeType,
    bytesWritten: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function evidenceWriteResult(
  sessionId: string,
  outputKind: DesktopBrowserHostSurfaceEvidenceOutputKind,
  reason: string,
): DesktopBrowserHostSurfaceEvidenceWriteResult {
  return {
    ok: false,
    sessionId,
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    liveSurfaceTransport: 'native-embedded',
    nativeBridge: true,
    rightPaneBridge: true,
    outputKind,
    reason,
  };
}

function isRawEvidenceRoute(route: string): boolean {
  return route === 'screenshot' || route === 'content' || route === 'text' || route === 'ax';
}

function blockedRawEvidenceRoute(sessionId: string, route: string): Record<string, unknown> {
  return {
    ok: false,
    sessionId,
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    liveSurfaceTransport: 'native-embedded',
    nativeBridge: true,
    rightPaneBridge: true,
    outputKind: route,
    reason: 'native-embedded-raw-evidence-route-blocked',
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout();
          reject(new Error(`native embedded browser operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function surfaceErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
