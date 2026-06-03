import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  BROWSER_HOST_NATIVE_OS_UI_PROOF_SCHEMA,
  type BrowserHostSessionNativeOsUiProof,
} from '../runtime/browser-host-session-types.js';

export type DesktopBrowserHostSurfaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
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
  stateAvailable: true;
  embedded: boolean;
  secondTruthSource: false;
  passClaim: boolean;
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
    };
  }) => DesktopBrowserHostSurfaceViewLike;
};

export type DesktopBrowserHostSurfaceController = ReturnType<typeof createDesktopBrowserHostSurfaceController>;

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

  async function startServer(): Promise<{ ok: true; url: string }> {
    if (serverUrl) return { ok: true, url: serverUrl };
    server = createServer((req, res) => {
      void handleRequest(req, res).catch((error) => {
        writeJson(res, 500, { ok: false, error: surfaceErrorMessage(error) });
      });
    });
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject);
      server?.listen(0, '127.0.0.1', () => resolve());
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

  function startSession(input: { sessionId: string; width?: number; height?: number }): DesktopBrowserHostSurfaceState {
    const session = ensureSession(input.sessionId, {
      width: numberOr(input.width, 1365),
      height: numberOr(input.height, 900),
    });
    return stateForSession(session);
  }

  async function navigate(sessionId: string, input: { url: string; timeoutMs?: number }): Promise<DesktopBrowserHostSurfaceState> {
    const session = ensureSession(sessionId);
    const targetUrl = normalizeDesktopBrowserHostSurfaceUrl(input.url);
    if (!session.webContents.loadURL) return stateForSession(session, 'native-embedded-load-url-unavailable');
    await withTimeout(session.webContents.loadURL(targetUrl), numberOr(input.timeoutMs, 30_000), () => {
      session.webContents.stop?.();
    }).catch((error) => {
      if (!session.webContents.getURL?.()) throw error;
      session.diagnostics.push(`native embedded navigation settled after timeout: ${surfaceErrorMessage(error)}`);
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

  async function action(sessionId: string, input: Record<string, unknown>): Promise<DesktopBrowserHostSurfaceState> {
    const session = ensureSession(sessionId);
    const action = typeof input.action === 'string' ? input.action : '';
    if (action === 'back') session.webContents.goBack?.();
    else if (action === 'forward') session.webContents.goForward?.();
    else if (action === 'reload') session.webContents.reload?.();
    else if (action === 'stop') session.webContents.stop?.();
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

  async function content(sessionId: string): Promise<{ ok: boolean; content: string; reason?: string }> {
    const session = sessions.get(sessionId);
    if (!session) return { ok: false, content: '', reason: 'native-embedded-session-not-found' };
    const value = await executeJavaScript<string>(session, 'document.documentElement ? document.documentElement.outerHTML : ""', '');
    return { ok: true, content: value };
  }

  async function text(sessionId: string): Promise<{ ok: boolean; text: string; reason?: string }> {
    const session = sessions.get(sessionId);
    if (!session) return { ok: false, text: '', reason: 'native-embedded-session-not-found' };
    const value = await executeJavaScript<string>(session, 'document.body ? document.body.innerText : ""', '');
    return { ok: true, text: cleanText(value) };
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

  async function searchResults(sessionId: string, limit: number): Promise<{ ok: boolean; results: Array<{ title: string; url: string; snippet: string }>; reason?: string }> {
    const session = sessions.get(sessionId);
    if (!session) return { ok: false, results: [], reason: 'native-embedded-session-not-found' };
    const results = await executeJavaScript<Array<{ title: string; url: string; snippet: string }>>(session, `(() => {
      return Array.from(document.querySelectorAll('a[href]')).map((node) => {
        const anchor = node;
        const container = anchor.closest('li, article, div');
        return {
          title: (anchor.textContent || '').replace(/\\s+/g, ' ').trim(),
          url: anchor.href,
          snippet: ((container && container.innerText) || '').replace(/\\s+/g, ' ').trim()
        };
      }).filter((row) => row.title && row.url).slice(0, ${JSON.stringify(clamp(limit, 5, 1, 10))});
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
    else if (req.method === 'GET' && route === 'screenshot') writeJson(res, 200, await screenshot(sessionId));
    else if (req.method === 'GET' && route === 'content') writeJson(res, 200, await content(sessionId));
    else if (req.method === 'GET' && route === 'text') writeJson(res, 200, await text(sessionId));
    else if (req.method === 'GET' && route === 'ax') writeJson(res, 200, await axSnapshot(sessionId));
    else if (req.method === 'GET' && route === 'search-results') writeJson(res, 200, await searchResults(sessionId, Number(url.searchParams.get('limit') ?? '5')));
    else if (req.method === 'GET' && route === 'audit') writeJson(res, 200, surfaceAuditSnapshot(audit, sessionId));
    else if (req.method === 'POST' && route === 'attach') writeJson(res, 200, attach({ sessionId, ...(await readJsonBody(req)) as { bounds: DesktopBrowserHostSurfaceBounds; visible?: boolean; focus?: boolean } }));
    else if (req.method === 'POST' && route === 'detach') writeJson(res, 200, detach(sessionId));
    else if (req.method === 'POST' && route === 'navigate') writeJson(res, 200, await navigate(sessionId, await readJsonBody(req) as { url: string; timeoutMs?: number }));
    else if (req.method === 'POST' && route === 'actions') writeJson(res, 200, await action(sessionId, await readJsonBody(req)));
    else writeJson(res, 405, { ok: false, error: `Unsupported native embedded browser method: ${req.method} ${url.pathname}` });
  }

  function ensureSession(sessionId: string, viewport: { width: number; height: number } = { width: 1365, height: 900 }): DesktopBrowserHostSurfaceSession {
    const safeId = requiredSessionId(sessionId);
    const current = sessions.get(safeId);
    if (current) return current;
    if (!electron.WebContentsView) throw new Error('Electron WebContentsView is unavailable for native embedded BrowserHostSession surfaces.');
    const view = new electron.WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
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
    };
    sessions.set(safeId, session);
    return session;
  }

  return {
    attach,
    detach,
    navigate,
    action,
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
  return {
    ok,
    sessionId: session.id,
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    surface: 'electron-web-contents-view',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    ready: ok,
    nativeBridge: true,
    rightPaneBridge: true,
    attachAvailable: true,
    stateAvailable: true,
    embedded,
    secondTruthSource: false,
    passClaim: ok && embedded,
    url: session.webContents.getURL?.() || undefined,
    title: session.webContents.getTitle?.() || undefined,
    loading: session.webContents.isLoadingMainFrame?.() ?? session.webContents.isLoading?.() ?? false,
    canGoBack: session.webContents.canGoBack?.() ?? false,
    canGoForward: session.webContents.canGoForward?.() ?? false,
    bounds: session.bounds,
    visible: session.visible,
    reason,
    diagnostics: session.diagnostics.slice(-20),
  };
}

function missingState(sessionId: string): DesktopBrowserHostSurfaceState {
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
    stateAvailable: true,
    embedded: false,
    secondTruthSource: false,
    passClaim: false,
    reason: 'native-embedded-session-not-found',
  };
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
