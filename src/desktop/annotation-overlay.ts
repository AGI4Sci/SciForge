import {
  SCIFORGE_ANNOTATION_REFERENCE_DISPLAY_MODEL,
  SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_CANDIDATES,
} from '../shared/annotation-reference-contract.js';

export const DESKTOP_ANNOTATION_OVERLAY_CAPTURE_SCHEMA =
  'sciforge.desktop.annotation-overlay.capture.v1' as const;

export type DesktopAnnotationBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopAnnotationSourceKind = 'window' | 'screen-region' | 'browser' | 'image';
export type DesktopAnnotationCoordinateSpace =
  | 'window-local'
  | 'screen-global'
  | 'browser-viewport'
  | 'image-local';
export type DesktopAnnotationWindowBindingStatus = 'auto-bound' | 'manual-bound' | 'unbound' | 'blocked';

export type DesktopAnnotationDisplayMetadata = {
  id?: number | string;
  bounds: DesktopAnnotationBounds;
  scaleFactor?: number;
};

export type DesktopAnnotationOverlayBrowserWindowOptions = {
  transparent: true;
  frame: false;
  alwaysOnTop: true;
  skipTaskbar: true;
  focusable: boolean;
  resizable: false;
  movable: false;
  show: false;
  bounds: DesktopAnnotationBounds;
  hasShadow: false;
  webPreferences: {
    preload?: string;
    contextIsolation: true;
    nodeIntegration: false;
    sandbox: true;
  };
};

export type DesktopAnnotationOverlayWindow = {
  show(): void;
  hide(): void;
  loadURL?(url: string): Promise<void> | void;
  loadFile?(filePath: string): Promise<void> | void;
  isVisible?(): boolean;
  setBounds?(bounds: DesktopAnnotationBounds): void;
  setAlwaysOnTop?(flag: boolean, level?: string): void;
  setIgnoreMouseEvents?(ignore: boolean, options?: { forward?: boolean }): void;
  webContents?: {
    loadURL?(url: string): Promise<void> | void;
  };
};

export type DesktopAnnotationOverlayScreen = {
  getPrimaryDisplay(): DesktopAnnotationDisplayMetadata;
};

export type DesktopAnnotationCaptureProviderInput = {
  schemaVersion: typeof DESKTOP_ANNOTATION_OVERLAY_CAPTURE_SCHEMA;
  captureId: string;
  workspaceId: string;
  sessionId: string;
  windowRef?: string;
  targetRef: string;
  sourceKind: DesktopAnnotationSourceKind;
  coordinateSpace: DesktopAnnotationCoordinateSpace;
  displayId?: string;
  screenId?: string;
  scale?: number;
  display?: DesktopAnnotationDisplayMetadata;
  windowSummary?: {
    appName?: string;
    bundleId?: string;
    pid?: number;
    title?: string;
  };
  windowBounds?: DesktopAnnotationBounds;
  screenBounds: DesktopAnnotationBounds;
  bounds: DesktopAnnotationBounds;
  windowLocalBounds?: DesktopAnnotationBounds;
  normalizedBounds: DesktopAnnotationBounds;
  overlayExclusion: {
    hidden: true;
    clickThrough: true;
  };
};

export type DesktopAnnotationCaptureProviderResult = {
  status?: 'captured' | 'blocked';
  screenshotRef: string;
  cropRef: string;
  imageRef?: string;
  hash?: string;
  width?: number;
  height?: number;
  dimensions?: {
    width: number;
    height: number;
  };
  capturedAt?: string;
  diagnostics?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

export type DesktopAnnotationCaptureProvider = {
  captureSelection(input: DesktopAnnotationCaptureProviderInput): Promise<DesktopAnnotationCaptureProviderResult>;
};

export type DesktopAnnotationOverlayDeps = {
  createBrowserWindow(options: DesktopAnnotationOverlayBrowserWindowOptions): DesktopAnnotationOverlayWindow;
  screen: DesktopAnnotationOverlayScreen;
  captureProvider: DesktopAnnotationCaptureProvider;
};

export type DesktopAnnotationOverlayControllerOptions = {
  defaultClickThrough?: boolean;
  overlayBounds?: DesktopAnnotationBounds;
  alwaysOnTopLevel?: string;
  overlayPreloadPath?: string;
  overlayRendererUrl?: string;
  overlayRendererHtml?: string;
  captureIdFactory?: () => string;
  now?: () => string;
};

export type DesktopAnnotationBeginSelectionInput = {
  workspaceId: string;
  sessionId: string;
  windowRef?: string;
  targetRef?: string;
  windowBounds?: DesktopAnnotationBounds;
  windowSummary?: {
    appName?: string;
    bundleId?: string;
    pid?: number;
    title?: string;
  };
  sourceKind?: DesktopAnnotationSourceKind;
  coordinateSpace?: DesktopAnnotationCoordinateSpace;
};

export type DesktopAnnotationSelection = {
  status: 'selecting';
  workspaceId: string;
  sessionId: string;
  windowRef?: string;
  targetRef: string;
  sourceKind: DesktopAnnotationSourceKind;
  coordinateSpace: DesktopAnnotationCoordinateSpace;
  display?: DesktopAnnotationDisplayMetadata;
  windowBinding: 'manual-bound' | 'unbound';
  windowBounds?: DesktopAnnotationBounds;
  windowSummary?: {
    appName?: string;
    bundleId?: string;
    pid?: number;
    title?: string;
  };
  screenBounds: DesktopAnnotationBounds;
  bounds: DesktopAnnotationBounds;
  windowLocalBounds?: DesktopAnnotationBounds;
  normalizedBounds: DesktopAnnotationBounds;
};

export type DesktopAnnotationSubmittedComment = Omit<DesktopAnnotationSelection, 'status'> & {
  status: 'submitted';
  comment: string;
  threadId?: string;
  messageDraftId?: string;
};

export type DesktopAnnotationCaptureOutput = Omit<DesktopAnnotationSubmittedComment, 'status'> & {
  schemaVersion: typeof DESKTOP_ANNOTATION_OVERLAY_CAPTURE_SCHEMA;
  displayModel: typeof SCIFORGE_ANNOTATION_REFERENCE_DISPLAY_MODEL;
  status: 'captured' | 'blocked';
  annotationRef: string;
  screenshotRef: string;
  cropRef: string;
  imageRef?: string;
  hash?: string;
  createdAt: string;
  capturedAt: string;
  owner: {
    workspaceId: string;
    sessionId: string;
    windowRef?: string;
    targetRef: string;
  };
  refs: string[];
  metadata: {
    captureId: string;
    overlayExcluded: true;
    overlayExclusion: 'hidden-and-click-through';
    refsOnly: true;
  };
};

export type DesktopAnnotationOverlayControllerState = {
  overlayCreated: boolean;
  visible: boolean;
  clickThrough: boolean;
  status: 'idle' | 'selecting' | 'submitted';
  selection?: DesktopAnnotationSelection;
  submitted?: DesktopAnnotationSubmittedComment;
};

export type DesktopAnnotationOverlayController = {
  create(): DesktopAnnotationOverlayControllerState;
  show(): DesktopAnnotationOverlayControllerState;
  setClickThrough(enabled: boolean): DesktopAnnotationOverlayControllerState;
  beginSelection(input: DesktopAnnotationBeginSelectionInput): DesktopAnnotationOverlayControllerState;
  updateSelection(input: { bounds: DesktopAnnotationBounds }): DesktopAnnotationSelection;
  submitComment(input: {
    comment: string;
    threadId?: string;
    messageDraftId?: string;
  }): DesktopAnnotationSubmittedComment;
  cancel(): { status: 'cancelled'; workspaceId?: string; sessionId?: string; windowRef?: string; targetRef?: string };
  captureSelectionToRefs(): Promise<DesktopAnnotationCaptureOutput>;
  getState(): DesktopAnnotationOverlayControllerState;
};

type SelectionContext = {
  workspaceId: string;
  sessionId: string;
  windowRef?: string;
  targetRef: string;
  sourceKind: DesktopAnnotationSourceKind;
  coordinateSpace: DesktopAnnotationCoordinateSpace;
  display?: DesktopAnnotationDisplayMetadata;
  windowBinding: 'manual-bound' | 'unbound';
  windowBounds?: DesktopAnnotationBounds;
  windowSummary?: {
    appName?: string;
    bundleId?: string;
    pid?: number;
    title?: string;
  };
  selectionBounds: DesktopAnnotationBounds;
};

export function createDesktopAnnotationOverlayController(
  deps: DesktopAnnotationOverlayDeps,
  options: DesktopAnnotationOverlayControllerOptions = {},
): DesktopAnnotationOverlayController {
  let overlayWindow: DesktopAnnotationOverlayWindow | undefined;
  let clickThrough = options.defaultClickThrough ?? true;
  let selectionContext: SelectionContext | undefined;
  let selection: DesktopAnnotationSelection | undefined;
  let submitted: DesktopAnnotationSubmittedComment | undefined;
  let captureCounter = 0;

  function create(): DesktopAnnotationOverlayControllerState {
    if (!overlayWindow) {
      const bounds = normalizePositiveBounds(
        options.overlayBounds ?? deps.screen.getPrimaryDisplay().bounds,
        'overlay bounds',
      );
      overlayWindow = deps.createBrowserWindow({
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: Boolean(options.overlayPreloadPath || options.overlayRendererUrl || options.overlayRendererHtml),
        resizable: false,
        movable: false,
        show: false,
        bounds,
        hasShadow: false,
        webPreferences: {
          ...(options.overlayPreloadPath ? { preload: options.overlayPreloadPath } : {}),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      overlayWindow.setBounds?.(bounds);
      overlayWindow.setAlwaysOnTop?.(true, options.alwaysOnTopLevel ?? 'screen-saver');
      applyClickThrough(clickThrough);
      if (options.overlayPreloadPath || options.overlayRendererUrl || options.overlayRendererHtml) {
        loadOverlayRenderer(bounds);
      }
    }
    return getState();
  }

  function show(): DesktopAnnotationOverlayControllerState {
    create();
    overlayWindow?.show();
    return getState();
  }

  function setClickThrough(enabled: boolean): DesktopAnnotationOverlayControllerState {
    clickThrough = enabled;
    applyClickThrough(enabled);
    return getState();
  }

  function beginSelection(input: DesktopAnnotationBeginSelectionInput): DesktopAnnotationOverlayControllerState {
    const workspaceId = requireNonEmptyString(input.workspaceId, 'workspaceId');
    const sessionId = requireNonEmptyString(input.sessionId, 'sessionId');
    const windowRef = optionalNonEmptyString(input.windowRef, 'windowRef');
    const explicitTargetRef = optionalNonEmptyString(input.targetRef, 'targetRef');
    const targetRef = explicitTargetRef ?? windowRef;
    if (!targetRef) {
      throw new Error('Desktop annotation selection requires windowRef or targetRef ownership.');
    }
    const sourceKind = input.sourceKind ?? 'window';
    const coordinateSpace = input.coordinateSpace ?? defaultCoordinateSpaceFor(sourceKind);
    const isWindowSelection = sourceKind === 'window';
    if (isWindowSelection && (!windowRef || !input.windowBounds)) {
      throw new Error('Desktop annotation app-window selection requires windowRef and windowBounds.');
    }
    const display = isWindowSelection ? undefined : normalizedDisplayMetadata(deps.screen.getPrimaryDisplay());
    const windowBounds = input.windowBounds ? normalizePositiveBounds(input.windowBounds, 'windowBounds') : undefined;
    const windowSummary = normalizedWindowSummary(input.windowSummary);
    const selectionBounds = windowBounds ?? display?.bounds;
    if (!selectionBounds) {
      throw new Error('Desktop annotation selection requires windowBounds or display bounds.');
    }
    selectionContext = {
      workspaceId,
      sessionId,
      windowRef,
      targetRef,
      sourceKind,
      coordinateSpace,
      display,
      windowBinding: isWindowSelection ? 'manual-bound' : 'unbound',
      windowBounds,
      windowSummary,
      selectionBounds,
    };
    selection = undefined;
    submitted = undefined;
    setClickThrough(false);
    return getState();
  }

  function updateSelection(input: { bounds: DesktopAnnotationBounds }): DesktopAnnotationSelection {
    if (!selectionContext) {
      throw new Error('Cannot update desktop annotation selection before beginSelection.');
    }
    const normalizedScreenBounds = normalizeAnyDragBounds(input.bounds, 'selection bounds');
    const clippedScreenBounds = intersectBounds(normalizedScreenBounds, selectionContext.selectionBounds);
    if (!clippedScreenBounds || clippedScreenBounds.width <= 0 || clippedScreenBounds.height <= 0) {
      throw new Error('Desktop annotation selection bounds must overlap the selected target area.');
    }
    const bounds = selectionContext.windowBounds ? {
      x: roundNumber(clippedScreenBounds.x - selectionContext.windowBounds.x),
      y: roundNumber(clippedScreenBounds.y - selectionContext.windowBounds.y),
      width: roundNumber(clippedScreenBounds.width),
      height: roundNumber(clippedScreenBounds.height),
    } : { ...clippedScreenBounds };
    const basisBounds = selectionContext.selectionBounds;
    const basisLocalBounds = {
      x: roundNumber(clippedScreenBounds.x - basisBounds.x),
      y: roundNumber(clippedScreenBounds.y - basisBounds.y),
      width: roundNumber(clippedScreenBounds.width),
      height: roundNumber(clippedScreenBounds.height),
    };
    const normalizedBounds = {
      x: roundNumber(basisLocalBounds.x / basisBounds.width),
      y: roundNumber(basisLocalBounds.y / basisBounds.height),
      width: roundNumber(basisLocalBounds.width / basisBounds.width),
      height: roundNumber(basisLocalBounds.height / basisBounds.height),
    };
    const { selectionBounds: _selectionBounds, ...publicContext } = selectionContext;
    selection = {
      status: 'selecting',
      ...publicContext,
      screenBounds: clippedScreenBounds,
      bounds,
      ...(selectionContext.windowBounds ? { windowLocalBounds: bounds } : {}),
      normalizedBounds,
    };
    submitted = undefined;
    return selection;
  }

  function submitComment(input: {
    comment: string;
    threadId?: string;
    messageDraftId?: string;
  }): DesktopAnnotationSubmittedComment {
    if (!selection) {
      throw new Error('Cannot submit desktop annotation comment before a selection exists.');
    }
    const comment = requireNonEmptyString(input.comment, 'comment');
    submitted = {
      ...selection,
      status: 'submitted',
      comment,
      threadId: optionalNonEmptyString(input.threadId, 'threadId'),
      messageDraftId: optionalNonEmptyString(input.messageDraftId, 'messageDraftId'),
    };
    return submitted;
  }

  function cancel(): { status: 'cancelled'; workspaceId?: string; sessionId?: string; windowRef?: string; targetRef?: string } {
    const cancelled = {
      status: 'cancelled' as const,
      workspaceId: selectionContext?.workspaceId,
      sessionId: selectionContext?.sessionId,
      windowRef: selectionContext?.windowRef,
      targetRef: selectionContext?.targetRef,
    };
    selectionContext = undefined;
    selection = undefined;
    submitted = undefined;
    setClickThrough(true);
    return cancelled;
  }

  async function captureSelectionToRefs(): Promise<DesktopAnnotationCaptureOutput> {
    if (!submitted) {
      throw new Error('Cannot capture desktop annotation refs before submitComment.');
    }
    const captureId = nextCaptureId();
    const wasVisible = isOverlayVisible();
    const wasClickThrough = clickThrough;

    if (overlayWindow) {
      overlayWindow.hide();
      setClickThrough(true);
    }

    try {
      const displayMetadata = primaryDisplayEvidenceMetadata();
      const providerResult = await deps.captureProvider.captureSelection({
        schemaVersion: DESKTOP_ANNOTATION_OVERLAY_CAPTURE_SCHEMA,
        captureId,
        workspaceId: submitted.workspaceId,
        sessionId: submitted.sessionId,
        windowRef: submitted.windowRef,
        targetRef: submitted.targetRef,
        sourceKind: submitted.sourceKind,
        coordinateSpace: submitted.coordinateSpace,
        windowBounds: submitted.windowBounds,
        screenBounds: submitted.screenBounds,
        bounds: submitted.bounds,
        windowLocalBounds: submitted.windowLocalBounds,
        normalizedBounds: submitted.normalizedBounds,
        display: submitted.display,
        windowSummary: submitted.windowSummary,
        ...displayMetadata,
        overlayExclusion: {
          hidden: true,
          clickThrough: true,
        },
      });
      assertRefsOnlyProviderResult(providerResult);
      const annotationRef = `${ownedRefPrefix(submitted.workspaceId, submitted.sessionId)}annotation/${captureId}`;
      const capturedAt = providerResult.capturedAt ?? now();
      const output: DesktopAnnotationCaptureOutput = {
        schemaVersion: DESKTOP_ANNOTATION_OVERLAY_CAPTURE_SCHEMA,
        displayModel: SCIFORGE_ANNOTATION_REFERENCE_DISPLAY_MODEL,
        status: providerResult.status ?? 'captured',
        workspaceId: submitted.workspaceId,
        sessionId: submitted.sessionId,
        windowRef: submitted.windowRef,
        targetRef: submitted.targetRef,
        sourceKind: submitted.sourceKind,
        coordinateSpace: submitted.coordinateSpace,
        display: submitted.display,
        windowBinding: submitted.windowBinding,
        windowBounds: submitted.windowBounds,
        screenBounds: submitted.screenBounds,
        bounds: submitted.bounds,
        windowLocalBounds: submitted.windowLocalBounds,
        normalizedBounds: submitted.normalizedBounds,
        comment: submitted.comment,
        threadId: submitted.threadId,
        messageDraftId: submitted.messageDraftId,
        annotationRef,
        screenshotRef: providerResult.screenshotRef,
        cropRef: providerResult.cropRef,
        imageRef: providerResult.imageRef,
        hash: providerResult.hash,
        createdAt: now(),
        capturedAt,
        owner: {
          workspaceId: submitted.workspaceId,
          sessionId: submitted.sessionId,
          ...(submitted.windowRef ? { windowRef: submitted.windowRef } : {}),
          targetRef: submitted.targetRef,
        },
        refs: compactRefs([
          annotationRef,
          providerResult.screenshotRef,
          providerResult.cropRef,
          providerResult.imageRef,
        ]),
        metadata: {
          ...sanitizedProviderMetadata(providerResult.metadata),
          ...genericEvidenceMetadata(submitted, providerResult, displayMetadata),
          captureId,
          overlayExcluded: true,
          overlayExclusion: 'hidden-and-click-through',
          refsOnly: true,
          ...(providerResult.diagnostics ? { diagnostics: sanitizedProviderDiagnostics(providerResult.diagnostics) } : {}),
        },
      };
      assertOwnedOutputRefs(output);
      assertRefsOnlyObject(output);
      return output;
    } finally {
      if (overlayWindow) {
        setClickThrough(wasClickThrough);
        if (wasVisible) {
          overlayWindow.show();
        }
      }
    }
  }

  function getState(): DesktopAnnotationOverlayControllerState {
    const status = submitted ? 'submitted' : selection || selectionContext ? 'selecting' : 'idle';
    return {
      overlayCreated: Boolean(overlayWindow),
      visible: isOverlayVisible(),
      clickThrough,
      status,
      selection,
      submitted,
    };
  }

  function applyClickThrough(enabled: boolean): void {
    overlayWindow?.setIgnoreMouseEvents?.(enabled, enabled ? { forward: true } : undefined);
  }

  function isOverlayVisible(): boolean {
    return overlayWindow?.isVisible?.() ?? false;
  }

  function loadOverlayRenderer(bounds: DesktopAnnotationBounds): void {
    if (!overlayWindow) return;
    const rendererUrl = options.overlayRendererUrl ?? desktopAnnotationOverlayRendererDataUrl(
      options.overlayRendererHtml ?? desktopAnnotationOverlayRendererHtml(bounds),
    );
    if (overlayWindow.loadURL) {
      void Promise.resolve(overlayWindow.loadURL(rendererUrl)).catch(() => undefined);
      return;
    }
    if (overlayWindow.webContents?.loadURL) {
      void Promise.resolve(overlayWindow.webContents.loadURL(rendererUrl)).catch(() => undefined);
    }
  }

  function nextCaptureId(): string {
    const explicit = options.captureIdFactory?.();
    if (explicit) {
      return sanitizeRefSegment(explicit);
    }
    captureCounter += 1;
    return `${Date.now().toString(36)}-${captureCounter}`;
  }

  function now(): string {
    return options.now?.() ?? new Date().toISOString();
  }

  function primaryDisplayEvidenceMetadata(): { displayId?: string; screenId?: string; scale?: number } {
    const display = normalizedDisplayMetadata(deps.screen.getPrimaryDisplay());
    const displayId = display.id === undefined ? undefined : String(display.id);
    return {
      ...(displayId ? { displayId, screenId: displayId } : {}),
      ...(display.scaleFactor ? { scale: display.scaleFactor } : {}),
    };
  }

  return {
    create,
    show,
    setClickThrough,
    beginSelection,
    updateSelection,
    submitComment,
    cancel,
    captureSelectionToRefs,
    getState,
  };
}

export function desktopAnnotationOverlayRendererDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function desktopAnnotationOverlayRendererHtml(bounds: DesktopAnnotationBounds): string {
  const origin = {
    x: roundNumber(bounds.x),
    y: roundNumber(bounds.y),
  };
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: rgba(12, 18, 24, 0.16);
      color: #f8fafc;
      font: 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      user-select: none;
    }
    body.selecting {
      cursor: crosshair;
    }
    #selection {
      position: fixed;
      box-sizing: border-box;
      display: none;
      border: 2px solid #38bdf8;
      background: rgba(56, 189, 248, 0.15);
      box-shadow: 0 0 0 9999px rgba(2, 6, 23, 0.22);
      pointer-events: none;
    }
    #panel {
      position: fixed;
      left: 50%;
      bottom: 22px;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 8px;
      width: min(620px, calc(100vw - 32px));
      padding: 8px;
      border: 1px solid rgba(148, 163, 184, 0.34);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.92);
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.34);
    }
    #comment {
      min-width: 0;
      flex: 1;
      height: 38px;
      resize: none;
      box-sizing: border-box;
      border: 1px solid rgba(148, 163, 184, 0.38);
      border-radius: 6px;
      padding: 9px 10px;
      background: rgba(15, 23, 42, 0.72);
      color: #f8fafc;
      outline: none;
      font: inherit;
    }
    #comment:focus {
      border-color: #38bdf8;
    }
    button {
      height: 38px;
      border: 1px solid rgba(148, 163, 184, 0.38);
      border-radius: 6px;
      padding: 0 12px;
      background: rgba(30, 41, 59, 0.92);
      color: #f8fafc;
      font: inherit;
    }
    button:disabled {
      opacity: 0.48;
    }
    #save:not(:disabled) {
      border-color: rgba(56, 189, 248, 0.74);
      background: #0369a1;
    }
  </style>
</head>
<body class="selecting">
  <div id="selection"></div>
  <div id="panel">
    <textarea id="comment" placeholder="Comment"></textarea>
    <button id="cancel" type="button" aria-label="Cancel">Cancel</button>
    <button id="save" type="button" aria-label="Save" disabled>Save</button>
  </div>
  <script>
    (() => {
      const api = window.sciforgeAnnotationOverlay;
      const origin = ${JSON.stringify(origin)};
      const body = document.body;
      const box = document.getElementById('selection');
      const panel = document.getElementById('panel');
      const comment = document.getElementById('comment');
      const save = document.getElementById('save');
      const cancel = document.getElementById('cancel');
      let drag = null;
      let selectedBounds = null;

      function isControl(target) {
        return target === panel || panel.contains(target);
      }

      function localRect(start, end) {
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const width = Math.abs(end.x - start.x);
        const height = Math.abs(end.y - start.y);
        return { x, y, width, height };
      }

      function screenRect(rect) {
        return {
          x: Math.round(origin.x + rect.x),
          y: Math.round(origin.y + rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }

      function renderRect(rect) {
        box.style.display = 'block';
        box.style.left = rect.x + 'px';
        box.style.top = rect.y + 'px';
        box.style.width = rect.width + 'px';
        box.style.height = rect.height + 'px';
      }

      function resetSelection() {
        selectedBounds = null;
        save.disabled = true;
        box.style.display = 'none';
      }

      window.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || isControl(event.target)) return;
        drag = { x: event.clientX, y: event.clientY };
        resetSelection();
        body.classList.add('selecting');
        window.getSelection()?.removeAllRanges();
        event.preventDefault();
      });

      window.addEventListener('pointermove', (event) => {
        if (!drag) return;
        const rect = localRect(drag, { x: event.clientX, y: event.clientY });
        renderRect(rect);
        event.preventDefault();
      });

      window.addEventListener('pointerup', (event) => {
        if (!drag) return;
        const rect = localRect(drag, { x: event.clientX, y: event.clientY });
        drag = null;
        if (rect.width >= 4 && rect.height >= 4) {
          renderRect(rect);
          selectedBounds = screenRect(rect);
          save.disabled = false;
          comment.focus();
        } else {
          resetSelection();
        }
        event.preventDefault();
      });

      cancel.addEventListener('click', () => {
        api?.cancelSelection?.();
      });

      save.addEventListener('click', () => {
        if (!selectedBounds) return;
        api?.submitSelection?.({
          bounds: selectedBounds,
          comment: comment.value,
        });
      });

      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          api?.cancelSelection?.();
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && selectedBounds) {
          api?.submitSelection?.({
            bounds: selectedBounds,
            comment: comment.value,
          });
        }
      });
    })();
  </script>
</body>
</html>`;
}

function genericEvidenceMetadata(
  submitted: DesktopAnnotationSubmittedComment,
  providerResult: DesktopAnnotationCaptureProviderResult,
  displayMetadata: { displayId?: string; screenId?: string; scale?: number },
): Record<string, unknown> {
  const providerMetadata = providerResult.metadata ?? {};
  const dimensions = dimensionsFromProviderResult(providerResult) ?? {
    width: submitted.bounds.width,
    height: submitted.bounds.height,
  };
  const displayId = textFromRecord(providerMetadata, 'displayId')
    ?? textFromRecord(providerMetadata, 'screenId')
    ?? displayMetadata.displayId;
  const screenId = textFromRecord(providerMetadata, 'screenId') ?? displayId ?? displayMetadata.screenId;
  const scale = numberFromRecord(providerMetadata, 'scale') ?? displayMetadata.scale;
  return {
    sourceKind: submitted.sourceKind,
    coordinateSpace: submitted.coordinateSpace,
    targetRef: submitted.targetRef,
    ...(submitted.windowRef ? { windowRef: submitted.windowRef } : {}),
    screenBounds: { ...submitted.screenBounds },
    ...(submitted.windowBounds ? { windowBounds: { ...submitted.windowBounds } } : {}),
    ...(submitted.windowLocalBounds ? { windowLocalBounds: { ...submitted.windowLocalBounds } } : {}),
    bounds: { ...submitted.bounds },
    dimensions,
    width: dimensions.width,
    height: dimensions.height,
    ...(providerResult.hash ? { hash: providerResult.hash } : {}),
    ...(displayId ? { displayId } : {}),
    ...(screenId ? { screenId } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(providerMetadata.windowBinding ? {} : { windowBinding: fallbackWindowBinding(submitted, providerResult.status ?? 'captured') }),
  };
}

function fallbackWindowBinding(
  submitted: DesktopAnnotationSubmittedComment,
  status: 'captured' | 'blocked',
): Record<string, unknown> {
  if (status === 'blocked') {
    return {
      status: 'blocked',
      reason: 'Selected annotation target could not be evaluated or captured.',
      ...(submitted.windowRef ? { windowRef: submitted.windowRef } : {}),
      targetRef: submitted.targetRef,
      sourceKind: submitted.sourceKind,
      coordinateSpace: submitted.coordinateSpace,
      ...(submitted.windowRef && submitted.windowBounds
        ? { windowBounds: { ...submitted.windowBounds }, windowLocalBounds: { ...(submitted.windowLocalBounds ?? submitted.bounds) } }
        : {}),
      ...(!submitted.windowRef ? { screenBounds: { ...submitted.screenBounds } } : {}),
    };
  }
  if (submitted.sourceKind === 'window' && submitted.windowRef) {
    return {
      status: 'manual-bound',
      reason: 'App window annotation was explicitly selected by the user.',
      windowRef: submitted.windowRef,
      targetRef: submitted.targetRef,
      sourceKind: submitted.sourceKind,
      coordinateSpace: submitted.coordinateSpace,
      ...(submitted.windowBounds ? { windowBounds: { ...submitted.windowBounds } } : {}),
      windowLocalBounds: { ...(submitted.windowLocalBounds ?? submitted.bounds) },
    };
  }
  return {
    status: 'unbound',
    reason: 'Screen region selection has no high-confidence window binding metadata.',
    targetRef: submitted.targetRef,
    sourceKind: submitted.sourceKind,
    coordinateSpace: submitted.coordinateSpace,
    screenBounds: { ...submitted.screenBounds },
  };
}

function normalizedDisplayMetadata(display: DesktopAnnotationDisplayMetadata): DesktopAnnotationDisplayMetadata {
  return {
    ...(display.id === undefined ? {} : { id: display.id }),
    bounds: normalizePositiveBounds(display.bounds, 'display.bounds'),
    ...(display.scaleFactor === undefined ? {} : { scaleFactor: requireFiniteNumber(display.scaleFactor, 'display.scaleFactor') }),
  };
}

function normalizedWindowSummary(
  summary: DesktopAnnotationBeginSelectionInput['windowSummary'],
): DesktopAnnotationBeginSelectionInput['windowSummary'] | undefined {
  if (!summary || typeof summary !== 'object') return undefined;
  const output: NonNullable<DesktopAnnotationBeginSelectionInput['windowSummary']> = {};
  const appName = boundedMetadataText(summary.appName);
  if (appName) output.appName = appName;
  const bundleId = boundedMetadataText(summary.bundleId);
  if (bundleId) output.bundleId = bundleId;
  if (typeof summary.pid === 'number' && Number.isFinite(summary.pid)) output.pid = Math.trunc(summary.pid);
  const title = boundedMetadataText(summary.title);
  if (title) output.title = title;
  return Object.keys(output).length ? output : undefined;
}

function sanitizedProviderMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isRejectedProviderMetadataKey(key)) continue;
    if (key === 'windowBinding' && isRecord(value)) {
      output[key] = sanitizedWindowBinding(value);
      continue;
    }
    if (key === 'windowBindingCandidates' && Array.isArray(value)) {
      output[key] = value
        .filter(isRecord)
        .slice(0, SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_CANDIDATES)
        .map(sanitizedWindowBindingCandidate);
      continue;
    }
    output[key] = sanitizeProviderMetadataValue(value);
  }
  return output;
}

function sanitizedProviderDiagnostics(diagnostics: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return diagnostics
    .map((diagnostic) => sanitizeProviderMetadataValue(diagnostic))
    .filter(isRecord);
}

function sanitizedWindowBinding(binding: Record<string, unknown>): Record<string, unknown> {
  const output = sanitizeProviderMetadataValue(binding) as Record<string, unknown>;
  if (Array.isArray(output.candidates)) {
    output.candidates = output.candidates
      .filter(isRecord)
      .slice(0, SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_CANDIDATES)
      .map(sanitizedWindowBindingCandidate);
  }
  if (output.status === 'unbound') {
    delete output.windowRef;
  }
  return output;
}

function sanitizedWindowBindingCandidate(candidate: Record<string, unknown>): Record<string, unknown> {
  return sanitizeProviderMetadataValue(candidate) as Record<string, unknown>;
}

function sanitizeProviderMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(sanitizeProviderMetadataValue)
      .filter((entry) => entry !== undefined);
  }
  if (typeof value === 'string') return sanitizedMetadataString(value);
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isRejectedProviderMetadataKey(key)) continue;
    const sanitized = sanitizeProviderMetadataValue(nested);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

function isRejectedProviderMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.startsWith('raw')
    || normalized === 'dataurl'
    || normalized.includes('base64')
    || normalized.includes('bytes')
    || normalized.includes('buffer')
    || normalized.includes('payload')
    || normalized === 'windowactionsession'
    || normalized === 'windowactionsessionref'
    || normalized === 'actionref'
    || normalized === 'guiexecutable'
    || (normalized.includes('screenshot') && !normalized.endsWith('ref') && !normalized.endsWith('refs'));
}

function sanitizedMetadataString(value: string): string | undefined {
  if (/^data:image\//i.test(value) || /;base64,/i.test(value)) return undefined;
  return boundedMetadataText(value);
}

function boundedMetadataText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 240) : undefined;
}

function dimensionsFromProviderResult(
  providerResult: DesktopAnnotationCaptureProviderResult,
): { width: number; height: number } | undefined {
  const directDimensions = providerResult.dimensions;
  if (directDimensions && isPositiveFiniteNumber(directDimensions.width) && isPositiveFiniteNumber(directDimensions.height)) {
    return { width: directDimensions.width, height: directDimensions.height };
  }
  if (isPositiveFiniteNumber(providerResult.width) && isPositiveFiniteNumber(providerResult.height)) {
    return { width: providerResult.width, height: providerResult.height };
  }
  const metadataDimensions = providerResult.metadata?.dimensions;
  if (
    metadataDimensions
    && typeof metadataDimensions === 'object'
    && isPositiveFiniteNumber((metadataDimensions as Record<string, unknown>).width)
    && isPositiveFiniteNumber((metadataDimensions as Record<string, unknown>).height)
  ) {
    return {
      width: (metadataDimensions as { width: number }).width,
      height: (metadataDimensions as { height: number }).height,
    };
  }
  return undefined;
}

function textFromRecord(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function numberFromRecord(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function defaultCoordinateSpaceFor(sourceKind: DesktopAnnotationSourceKind): DesktopAnnotationCoordinateSpace {
  if (sourceKind === 'screen-region') return 'screen-global';
  if (sourceKind === 'browser') return 'browser-viewport';
  if (sourceKind === 'image') return 'image-local';
  return 'window-local';
}

function normalizePositiveBounds(input: DesktopAnnotationBounds, label: string): DesktopAnnotationBounds {
  const bounds = normalizeAnyDragBounds(input, label);
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error(`${label} must have positive width and height.`);
  }
  return bounds;
}

function normalizeAnyDragBounds(input: DesktopAnnotationBounds, label: string): DesktopAnnotationBounds {
  const x = requireFiniteNumber(input?.x, `${label}.x`);
  const y = requireFiniteNumber(input?.y, `${label}.y`);
  const width = requireFiniteNumber(input?.width, `${label}.width`);
  const height = requireFiniteNumber(input?.height, `${label}.height`);
  const left = width < 0 ? x + width : x;
  const top = height < 0 ? y + height : y;
  return {
    x: roundNumber(left),
    y: roundNumber(top),
    width: roundNumber(Math.abs(width)),
    height: roundNumber(Math.abs(height)),
  };
}

function intersectBounds(a: DesktopAnnotationBounds, b: DesktopAnnotationBounds): DesktopAnnotationBounds | undefined {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return undefined;
  return {
    x: roundNumber(left),
    y: roundNumber(top),
    width: roundNumber(right - left),
    height: roundNumber(bottom - top),
  };
}

function assertRefsOnlyProviderResult(result: DesktopAnnotationCaptureProviderResult): void {
  const { metadata, diagnostics, ...refsAndTopLevelEvidence } = result;
  void metadata;
  void diagnostics;
  assertRefsOnlyObject(refsAndTopLevelEvidence);
  requireOwnedRefShape(result.screenshotRef, 'screenshotRef');
  requireOwnedRefShape(result.cropRef, 'cropRef');
  if (result.imageRef !== undefined) {
    requireOwnedRefShape(result.imageRef, 'imageRef');
  }
}

function assertOwnedOutputRefs(output: DesktopAnnotationCaptureOutput): void {
  const prefix = ownedRefPrefix(output.workspaceId, output.sessionId);
  for (const [name, ref] of Object.entries({
    annotationRef: output.annotationRef,
    screenshotRef: output.screenshotRef,
    cropRef: output.cropRef,
    imageRef: output.imageRef,
  })) {
    if (ref !== undefined && !ref.startsWith(prefix)) {
      throw new Error(`${name} must be owned by workspace/session prefix ${prefix}.`);
    }
  }
}

function assertRefsOnlyObject(value: unknown): void {
  visitObject(value, (key, nested) => {
    if (
      isRejectedCaptureOutputKey(key, nested)
    ) {
      throw new Error(`Capture output must be refs-only; raw screenshot payload key "${key}" is forbidden.`);
    }
    if (typeof nested === 'string') {
      if (/^data:image\//i.test(nested) || /;base64,/i.test(nested)) {
        throw new Error('Capture output must be refs-only; raw screenshot payload strings are forbidden.');
      }
    }
  });
}

function isRejectedCaptureOutputKey(key: string, value: unknown): boolean {
  if (/Returned$/i.test(key) && typeof value === 'boolean') return false;
  return /^raw/i.test(key)
    || /(?:base64|bytes|buffer|payload)/i.test(key)
    || /^dataUrl$/i.test(key)
    || (/screenshot/i.test(key) && !/Refs?$/i.test(key));
}

function visitObject(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    visit(key, nested);
    visitObject(nested, visit);
  }
}

function requireOwnedRefShape(value: string, label: string): string {
  const ref = requireNonEmptyString(value, label);
  if (ref.length > 240) {
    throw new Error(`${label} must be a bounded ref of 240 characters or fewer.`);
  }
  if (/^data:/i.test(ref) || /;base64,/i.test(ref)) {
    throw new Error(`${label} must be a ref, not a raw screenshot payload.`);
  }
  return ref;
}

function ownedRefPrefix(workspaceId: string, sessionId: string): string {
  return `desktop-annotation:workspace/${sanitizeRefSegment(workspaceId)}/session/${sanitizeRefSegment(sessionId)}/`;
}

function compactRefs(refs: Array<string | undefined>): string[] {
  return refs.filter((ref): ref is string => Boolean(ref));
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireNonEmptyString(value, label);
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function sanitizeRefSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '') || 'ref';
}

function roundNumber(value: number): number {
  return Number(value.toFixed(6));
}
