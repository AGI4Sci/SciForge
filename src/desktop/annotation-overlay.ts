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

export type DesktopAnnotationPoint = {
  x: number;
  y: number;
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
  displayId?: string;
  screenId?: string;
  bounds: DesktopAnnotationBounds;
  scaleFactor?: number;
  scale?: number;
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
  enableLargerThanScreen: true;
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
  close?(): void;
  destroy?(): void;
  focus?(): void;
  loadURL?(url: string): Promise<void> | void;
  loadFile?(filePath: string): Promise<void> | void;
  isVisible?(): boolean;
  setBounds?(bounds: DesktopAnnotationBounds): void;
  setAlwaysOnTop?(flag: boolean, level?: string): void;
  setIgnoreMouseEvents?(ignore: boolean, options?: { forward?: boolean }): void;
  webContents?: {
    loadURL?(url: string): Promise<void> | void;
    send?(channel: string, value: unknown): void;
    focus?(): void;
  };
};

export type DesktopAnnotationOverlayScreen = {
  getPrimaryDisplay(): DesktopAnnotationDisplayMetadata;
  getAllDisplays?(): DesktopAnnotationDisplayMetadata[];
  getCursorScreenPoint?(): DesktopAnnotationPoint;
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
  updateSelection(input: { bounds: DesktopAnnotationBounds; display?: DesktopAnnotationDisplayMetadata }): DesktopAnnotationSelection;
  submitComment(input: {
    comment: string;
    threadId?: string;
    messageDraftId?: string;
  }): DesktopAnnotationSubmittedComment;
  setActiveDisplay(input: { display?: DesktopAnnotationDisplayMetadata }): DesktopAnnotationOverlayControllerState;
  setDragState(input: {
    active: boolean;
    display?: DesktopAnnotationDisplayMetadata;
  }): DesktopAnnotationOverlayControllerState;
  cancel(): { status: 'cancelled'; workspaceId?: string; sessionId?: string; windowRef?: string; targetRef?: string };
  captureSelectionToRefs(): Promise<DesktopAnnotationCaptureOutput>;
  getState(): DesktopAnnotationOverlayControllerState;
};

type OverlayWindowEntry = {
  window: DesktopAnnotationOverlayWindow;
  bounds: DesktopAnnotationBounds;
  display: DesktopAnnotationDisplayMetadata;
  displayId: string;
};

const DESKTOP_ANNOTATION_OVERLAY_ACTIVE_DISPLAY_CHANNEL =
  'desktop:annotation-overlay:active-display' as const;
const DESKTOP_ANNOTATION_OVERLAY_CURSOR_TRACKING_INTERVAL_MS = 50;

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
  let overlayWindows: OverlayWindowEntry[] = [];
  let clickThrough = options.defaultClickThrough ?? true;
  let selectionContext: SelectionContext | undefined;
  let selection: DesktopAnnotationSelection | undefined;
  let submitted: DesktopAnnotationSubmittedComment | undefined;
  let captureCounter = 0;
  let overlayDisplaySignatureValue: string | undefined;
  let activeDisplay: DesktopAnnotationDisplayMetadata | undefined;
  let overlayDisplaySwitchLocked = false;
  let overlayCursorTrackingTimer: ReturnType<typeof setInterval> | undefined;

  function create(): DesktopAnnotationOverlayControllerState {
    ensureOverlayWindows();
    return getState();
  }

  function ensureOverlayWindows(): void {
    const displays = overlayDisplays();
    const signature = overlayDisplaySignature(displays);
    if (overlayWindows.length > 0 && overlayDisplaySignatureValue === signature) {
      return;
    }

    disposeOverlayWindows();
    overlayDisplaySignatureValue = signature;
    activeDisplay = activeDisplayForTopology(activeDisplay, displays);

    overlayWindows = displays.map((display, index) => {
      const bounds = normalizePositiveBounds(
        options.overlayBounds ?? display.bounds,
        'overlay bounds',
      );
      const displayId = rendererDisplayMetadata(display, index).id;
      const overlayWindow = deps.createBrowserWindow({
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: Boolean(options.overlayPreloadPath || options.overlayRendererUrl || options.overlayRendererHtml),
        resizable: false,
        movable: false,
        show: false,
        bounds,
        enableLargerThanScreen: true,
        hasShadow: false,
        webPreferences: {
          ...(options.overlayPreloadPath ? { preload: options.overlayPreloadPath } : {}),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      overlayWindow.setAlwaysOnTop?.(true, options.alwaysOnTopLevel ?? 'screen-saver');
      overlayWindow.setIgnoreMouseEvents?.(clickThrough, clickThrough ? { forward: true } : undefined);
      const entry = { window: overlayWindow, bounds, display, displayId };
      applyOverlayBounds(entry);
      if (options.overlayPreloadPath || options.overlayRendererUrl || options.overlayRendererHtml) {
        loadOverlayRenderer(entry, displays);
      }
      return entry;
    });
  }

  function show(): DesktopAnnotationOverlayControllerState {
    ensureOverlayWindows();
    applyOverlayBounds();
    updateActiveDisplayFromCursor();
    syncVisibleOverlayWindow(true);
    startOverlayCursorTracking();
    scheduleActiveOverlayFocus();
    return getState();
  }

  function setClickThrough(enabled: boolean): DesktopAnnotationOverlayControllerState {
    clickThrough = enabled;
    applyClickThrough(enabled);
    if (!enabled) {
      updateActiveDisplayFromCursor();
      syncVisibleOverlayWindow();
    }
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
    focusActiveOverlayWindow();
    scheduleActiveOverlayFocus();
    return getState();
  }

  function updateSelection(input: { bounds: DesktopAnnotationBounds; display?: DesktopAnnotationDisplayMetadata }): DesktopAnnotationSelection {
    if (!selectionContext) {
      throw new Error('Cannot update desktop annotation selection before beginSelection.');
    }
    let effectiveContext = selectionContext;
    if (!selectionContext.windowBounds && input.display) {
      const display = normalizedDisplayMetadata(input.display);
      effectiveContext = {
        ...selectionContext,
        display,
        selectionBounds: display.bounds,
      };
      selectionContext = effectiveContext;
    }
    const normalizedScreenBounds = normalizeAnyDragBounds(input.bounds, 'selection bounds');
    const clippedScreenBounds = intersectBounds(normalizedScreenBounds, effectiveContext.selectionBounds);
    if (!clippedScreenBounds || clippedScreenBounds.width <= 0 || clippedScreenBounds.height <= 0) {
      throw new Error('Desktop annotation selection bounds must overlap the selected target area.');
    }
    const bounds = effectiveContext.windowBounds ? {
      x: roundNumber(clippedScreenBounds.x - effectiveContext.windowBounds.x),
      y: roundNumber(clippedScreenBounds.y - effectiveContext.windowBounds.y),
      width: roundNumber(clippedScreenBounds.width),
      height: roundNumber(clippedScreenBounds.height),
    } : { ...clippedScreenBounds };
    const basisBounds = effectiveContext.selectionBounds;
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
    const { selectionBounds: _selectionBounds, ...publicContext } = effectiveContext;
    selection = {
      status: 'selecting',
      ...publicContext,
      screenBounds: clippedScreenBounds,
      bounds,
      ...(effectiveContext.windowBounds ? { windowLocalBounds: bounds } : {}),
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
    overlayDisplaySwitchLocked = false;
    setClickThrough(true);
    hideOverlayWindows();
    return cancelled;
  }

  async function captureSelectionToRefs(): Promise<DesktopAnnotationCaptureOutput> {
    if (!submitted) {
      throw new Error('Cannot capture desktop annotation refs before submitComment.');
    }
    const captureId = nextCaptureId();
    hideOverlayWindows();
    setClickThrough(true);

    try {
      const displayMetadata = displayEvidenceMetadata(submitted.display);
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
      selectionContext = undefined;
      selection = undefined;
      submitted = undefined;
      overlayDisplaySwitchLocked = false;
      setClickThrough(true);
      hideOverlayWindows();
    }
  }

  function getState(): DesktopAnnotationOverlayControllerState {
    const status = submitted ? 'submitted' : selection || selectionContext ? 'selecting' : 'idle';
    return {
      overlayCreated: overlayWindows.length > 0,
      visible: isOverlayVisible(),
      clickThrough,
      status,
      selection,
      submitted,
    };
  }

  function applyClickThrough(enabled: boolean): void {
    for (const entry of overlayWindows) {
      entry.window.setIgnoreMouseEvents?.(enabled, enabled ? { forward: true } : undefined);
    }
  }

  function isOverlayVisible(): boolean {
    return overlayWindows.some((entry) => entry.window.isVisible?.() ?? false);
  }

  function loadOverlayRenderer(entry: OverlayWindowEntry, displays: DesktopAnnotationDisplayMetadata[]): void {
    const rendererUrl = options.overlayRendererUrl ?? desktopAnnotationOverlayRendererDataUrl(
      options.overlayRendererHtml ?? desktopAnnotationOverlayRendererHtml(entry.bounds, displays, {
        windowDisplayId: entry.displayId,
        initialActiveDisplayId: activeDisplay ? displayIdForDisplay(activeDisplay, displays) : entry.displayId,
      }),
    );
    if (entry.window.loadURL) {
      void Promise.resolve(entry.window.loadURL(rendererUrl))
        .then(() => scheduleOverlayBoundsCorrection(entry))
        .catch(() => undefined);
      return;
    }
    if (entry.window.webContents?.loadURL) {
      void Promise.resolve(entry.window.webContents.loadURL(rendererUrl))
        .then(() => scheduleOverlayBoundsCorrection(entry))
        .catch(() => undefined);
    }
  }

  function applyOverlayBounds(entry?: OverlayWindowEntry): void {
    if (entry) {
      entry.window.setBounds?.(entry.bounds);
      return;
    }
    for (const overlayEntry of overlayWindows) {
      overlayEntry.window.setBounds?.(overlayEntry.bounds);
    }
  }

  function scheduleOverlayBoundsCorrection(entry: OverlayWindowEntry): void {
    for (const delayMs of [0, 150, 350]) {
      const timer = setTimeout(() => {
        if (!(entry.window.isVisible?.() ?? false)) applyOverlayBounds(entry);
      }, delayMs);
      if (typeof timer === 'object' && timer && 'unref' in timer && typeof timer.unref === 'function') {
        timer.unref();
      }
    }
  }

  function hideOverlayWindows(): void {
    stopOverlayCursorTracking();
    for (const entry of overlayWindows) {
      entry.window.hide();
    }
  }

  function disposeOverlayWindows(): void {
    stopOverlayCursorTracking();
    for (const entry of overlayWindows) {
      try {
        entry.window.hide();
      } catch {
        // Best-effort cleanup for stale overlay windows.
      }
      try {
        if (entry.window.destroy) {
          entry.window.destroy();
        } else {
          entry.window.close?.();
        }
      } catch {
        // Best-effort cleanup for display-topology changes.
      }
    }
    overlayWindows = [];
  }

  function setActiveDisplay(input: { display?: DesktopAnnotationDisplayMetadata }): DesktopAnnotationOverlayControllerState {
    if (!input.display) return getState();
    const display = canonicalDisplayForTopology(input.display);
    activeDisplay = display;
    syncVisibleOverlayWindow();
    return getState();
  }

  function setDragState(input: {
    active: boolean;
    display?: DesktopAnnotationDisplayMetadata;
  }): DesktopAnnotationOverlayControllerState {
    overlayDisplaySwitchLocked = input.active;
    if (input.active && input.display) {
      activeDisplay = canonicalDisplayForTopology(input.display);
      syncVisibleOverlayWindow();
      return getState();
    }
    if (!input.active) {
      updateActiveDisplayFromCursor();
      syncVisibleOverlayWindow();
    }
    return getState();
  }

  function broadcastActiveDisplay(display: DesktopAnnotationDisplayMetadata): void {
    const payload = rendererDisplayMetadataForTopology(display);
    for (const entry of overlayWindows) {
      entry.window.webContents?.send?.(DESKTOP_ANNOTATION_OVERLAY_ACTIVE_DISPLAY_CHANNEL, payload);
    }
  }

  function focusActiveOverlayWindow(): void {
    const activeEntry = activeOverlayEntry();
    focusOverlayWindow(activeEntry);
  }

  function focusOverlayWindow(entry: OverlayWindowEntry | undefined): void {
    if (entry?.window.isVisible && !entry.window.isVisible()) return;
    entry?.window.focus?.();
    entry?.window.webContents?.focus?.();
  }

  function scheduleActiveOverlayFocus(): void {
    for (const delayMs of [0, 50, 150]) {
      const timer = setTimeout(() => {
        focusActiveOverlayWindow();
      }, delayMs);
      if (typeof timer === 'object' && timer && 'unref' in timer && typeof timer.unref === 'function') {
        timer.unref();
      }
    }
  }

  function syncVisibleOverlayWindow(forceShow = false): void {
    const activeEntry = activeOverlayEntry();
    if (!activeEntry) return;
    const shouldShowActive = forceShow || isOverlayVisible();
    for (const entry of overlayWindows) {
      if (entry === activeEntry) {
        if (shouldShowActive) {
          entry.window.show();
        }
      } else if (entry.window.isVisible?.() ?? false) {
        entry.window.hide();
      }
    }
    broadcastActiveDisplay(activeEntry.display);
    focusOverlayWindow(activeEntry);
    scheduleActiveOverlayFocus();
  }

  function activeOverlayEntry(): OverlayWindowEntry | undefined {
    if (!activeDisplay) return overlayWindows[0];
    const activeId = displayIdForDisplay(activeDisplay, overlayWindows.map((entry) => entry.display));
    return overlayWindows.find((entry) => entry.displayId === activeId)
      ?? overlayWindows.find((entry) => sameDisplayBounds(entry.display.bounds, activeDisplay?.bounds ?? entry.display.bounds))
      ?? overlayWindows[0];
  }

  function updateActiveDisplayFromCursor(): void {
    if (overlayDisplaySwitchLocked) return;
    const point = cursorScreenPoint();
    if (!point) return;
    const entry = overlayWindows.find((candidate) => containsScreenPoint(candidate.display.bounds, point));
    if (!entry) return;
    const previous = activeOverlayEntry();
    activeDisplay = entry.display;
    if (previous !== entry || !isOverlayVisible()) {
      syncVisibleOverlayWindow(isOverlayVisible());
    }
  }

  function cursorScreenPoint(): DesktopAnnotationPoint | undefined {
    try {
      const point = deps.screen.getCursorScreenPoint?.();
      if (!point) return undefined;
      const x = requireFiniteNumber(point.x, 'cursor.x');
      const y = requireFiniteNumber(point.y, 'cursor.y');
      return { x: roundNumber(x), y: roundNumber(y) };
    } catch {
      return undefined;
    }
  }

  function startOverlayCursorTracking(): void {
    if (overlayCursorTrackingTimer) return;
    overlayCursorTrackingTimer = setInterval(() => {
      if (!isOverlayVisible()) {
        stopOverlayCursorTracking();
        return;
      }
      updateActiveDisplayFromCursor();
    }, DESKTOP_ANNOTATION_OVERLAY_CURSOR_TRACKING_INTERVAL_MS);
    if (typeof overlayCursorTrackingTimer === 'object'
      && overlayCursorTrackingTimer
      && 'unref' in overlayCursorTrackingTimer
      && typeof overlayCursorTrackingTimer.unref === 'function') {
      overlayCursorTrackingTimer.unref();
    }
  }

  function stopOverlayCursorTracking(): void {
    if (!overlayCursorTrackingTimer) return;
    clearInterval(overlayCursorTrackingTimer);
    overlayCursorTrackingTimer = undefined;
  }

  function canonicalDisplayForTopology(display: DesktopAnnotationDisplayMetadata): DesktopAnnotationDisplayMetadata {
    const normalized = normalizedDisplayMetadata(display);
    const identity = displayIdentityMetadata(normalized);
    const byDisplayId = identity.displayId
      ? overlayWindows.find((entry) => entry.displayId === identity.displayId)
      : undefined;
    const byScreenId = identity.screenId && identity.screenId !== identity.displayId
      ? overlayWindows.find((entry) => entry.displayId === identity.screenId)
      : undefined;
    const byBounds = overlayWindows.find((entry) => sameDisplayBounds(entry.display.bounds, normalized.bounds));
    return (byDisplayId ?? byScreenId ?? byBounds)?.display ?? normalized;
  }

  function rendererDisplayMetadataForTopology(display: DesktopAnnotationDisplayMetadata): {
    id: string;
    bounds: DesktopAnnotationBounds;
    scaleFactor?: number;
  } {
    const canonical = canonicalDisplayForTopology(display);
    const index = overlayWindows.findIndex((entry) => sameDisplayBounds(entry.display.bounds, canonical.bounds));
    return rendererDisplayMetadata(canonical, index >= 0 ? index : 0);
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

  function displayEvidenceMetadata(display?: DesktopAnnotationDisplayMetadata): { displayId?: string; screenId?: string; scale?: number } {
    const normalized = display ? normalizedDisplayMetadata(display) : normalizedDisplayMetadata(deps.screen.getPrimaryDisplay());
    return displayIdentityMetadata(normalized);
  }

  function overlayDisplays(): DesktopAnnotationDisplayMetadata[] {
    const allDisplays = deps.screen.getAllDisplays?.();
    const displays = Array.isArray(allDisplays) ? allDisplays : undefined;
    const candidates = displays?.length ? displays : [deps.screen.getPrimaryDisplay()];
    const normalized = candidates
      .map((display) => {
        try {
          return normalizedDisplayMetadata(display);
        } catch {
          return undefined;
        }
      })
      .filter((display): display is DesktopAnnotationDisplayMetadata => Boolean(display));
    return normalized.length ? normalized : [normalizedDisplayMetadata(deps.screen.getPrimaryDisplay())];
  }

  function overlayDisplaySignature(displays: DesktopAnnotationDisplayMetadata[]): string {
    return JSON.stringify(displays.map((display, index) => ({
      id: rendererDisplayMetadata(display, index).id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      scale: display.scale,
    })));
  }

  function activeDisplayForTopology(
    current: DesktopAnnotationDisplayMetadata | undefined,
    displays: DesktopAnnotationDisplayMetadata[],
  ): DesktopAnnotationDisplayMetadata | undefined {
    if (!displays.length) return undefined;
    if (!current) return displays[0];
    const currentId = displayIdForDisplay(current, displays);
    return displays.find((display, index) => rendererDisplayMetadata(display, index).id === currentId)
      ?? displays[0];
  }

  function displayIdForDisplay(
    display: DesktopAnnotationDisplayMetadata,
    displays: DesktopAnnotationDisplayMetadata[],
  ): string {
    const normalized = normalizedDisplayMetadata(display);
    const identity = displayIdentityMetadata(normalized);
    if (identity.displayId) return identity.displayId;
    const matchIndex = displays.findIndex((candidate) => sameDisplayBounds(candidate.bounds, normalized.bounds));
    return `display-${matchIndex >= 0 ? matchIndex + 1 : 1}`;
  }

  return {
    create,
    show,
    setClickThrough,
    beginSelection,
    updateSelection,
    submitComment,
    setActiveDisplay,
    setDragState,
    cancel,
    captureSelectionToRefs,
    getState,
  };
}

export function desktopAnnotationOverlayRendererDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function desktopAnnotationOverlayRendererHtml(
  bounds: DesktopAnnotationBounds,
  displays: DesktopAnnotationDisplayMetadata[] = [{ bounds, scaleFactor: 1 }],
  rendererOptions: {
    windowDisplayId?: string;
    initialActiveDisplayId?: string;
  } = {},
): string {
  const origin = {
    x: roundNumber(bounds.x),
    y: roundNumber(bounds.y),
  };
  const rendererConfig = {
    origin,
    displays: displays.map(rendererDisplayMetadata),
    ...(rendererOptions.windowDisplayId ? { windowDisplayId: rendererOptions.windowDisplayId } : {}),
    ...(rendererOptions.initialActiveDisplayId ? { initialActiveDisplayId: rendererOptions.initialActiveDisplayId } : {}),
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
    #active-display {
      position: fixed;
      box-sizing: border-box;
      display: none;
      border: 1px solid rgba(125, 211, 252, 0.74);
      background: rgba(14, 165, 233, 0.06);
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.18);
      pointer-events: none;
    }
    #selection {
      position: fixed;
      box-sizing: border-box;
      display: none;
      border: 2px solid #38bdf8;
      background: rgba(56, 189, 248, 0.15);
      box-shadow: 0 0 0 1px rgba(2, 6, 23, 0.34);
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
  <div id="active-display"></div>
  <div id="selection"></div>
  <div id="panel">
    <textarea id="comment" placeholder="Comment"></textarea>
    <button id="cancel" type="button" aria-label="Cancel">Cancel</button>
    <button id="save" type="button" aria-label="Save" disabled>Save</button>
  </div>
  <script>
    (() => {
	      const api = window.sciforgeAnnotationOverlay;
	      const config = ${JSON.stringify(rendererConfig)};
	      const origin = config.origin;
	      const windowDisplayId = config.windowDisplayId ? String(config.windowDisplayId) : null;
	      const initialActiveDisplayId = config.initialActiveDisplayId ? String(config.initialActiveDisplayId) : windowDisplayId;
	      const displays = config.displays.map((display, index) => {
	        const bounds = display.bounds;
	        return {
	          id: String(display.id ?? 'display-' + (index + 1)),
	          bounds,
	          localBounds: {
	            x: Math.round(bounds.x - origin.x),
	            y: Math.round(bounds.y - origin.y),
	            width: Math.round(bounds.width),
	            height: Math.round(bounds.height),
	          },
	          scaleFactor: Number.isFinite(display.scaleFactor) ? display.scaleFactor : undefined,
	        };
	      });
	      const body = document.body;
	      const box = document.getElementById('selection');
	      const activeBox = document.getElementById('active-display');
	      const panel = document.getElementById('panel');
	      const comment = document.getElementById('comment');
	      const save = document.getElementById('save');
	      const cancel = document.getElementById('cancel');
	      let drag = null;
	      let activeDisplay = null;
	      let lockedDisplay = null;
	      let selectedDisplay = null;
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

	      function displayPayload(display) {
	        if (!display) return undefined;
	        return {
	          id: display.id,
	          bounds: { ...display.bounds },
	          ...(display.scaleFactor !== undefined ? { scaleFactor: display.scaleFactor } : {}),
	        };
	      }

	      function sameDisplay(left, right) {
	        return Boolean(left && right && left.id === right.id);
	      }

	      function isWindowDisplay(display) {
	        return Boolean(display) && (!windowDisplayId || display.id === windowDisplayId);
	      }

	      function displayFromPayload(payload) {
	        if (!payload) return null;
	        const payloadId = payload.id === undefined ? null : String(payload.id);
	        if (payloadId) {
	          const byId = displays.find((display) => display.id === payloadId);
	          if (byId) return byId;
	        }
	        const bounds = payload.bounds;
	        if (!bounds) return null;
	        return displays.find((display) => display.bounds.x === bounds.x
	          && display.bounds.y === bounds.y
	          && display.bounds.width === bounds.width
	          && display.bounds.height === bounds.height) ?? null;
	      }

	      function containsPoint(bounds, point) {
	        return point.x >= bounds.x
	          && point.y >= bounds.y
	          && point.x < bounds.x + bounds.width
	          && point.y < bounds.y + bounds.height;
	      }

	      function intersectLocalRect(rect, display) {
	        const bounds = display.localBounds;
	        const left = Math.max(rect.x, bounds.x);
	        const top = Math.max(rect.y, bounds.y);
	        const right = Math.min(rect.x + rect.width, bounds.x + bounds.width);
	        const bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height);
	        if (right <= left || bottom <= top) return null;
	        return {
	          x: Math.round(left),
	          y: Math.round(top),
	          width: Math.round(right - left),
	          height: Math.round(bottom - top),
	        };
	      }

	      function screenPoint(event) {
	        return {
	          x: Math.round(origin.x + event.clientX),
	          y: Math.round(origin.y + event.clientY),
	        };
	      }

	      function displayAtEvent(event) {
	        const point = screenPoint(event);
	        return displays.find((display) => containsPoint(display.bounds, point)) ?? null;
	      }

	      function renderActiveDisplay() {
	        if (!isWindowDisplay(activeDisplay)) {
	          activeBox.style.display = 'none';
	          delete activeBox.dataset.displayId;
	          renderPanel();
	          return;
	        }
	        const bounds = activeDisplay.localBounds;
	        activeBox.dataset.displayId = activeDisplay.id;
	        activeBox.style.display = 'block';
	        activeBox.style.left = bounds.x + 'px';
	        activeBox.style.top = bounds.y + 'px';
	        activeBox.style.width = bounds.width + 'px';
	        activeBox.style.height = bounds.height + 'px';
	        renderPanel();
	      }

	      function focusComment() {
	        try {
	          comment.focus({ preventScroll: true });
	        } catch {
	          comment.focus();
	        }
	      }

	      function positionPanel(display) {
	        if (!display) return;
	        const bounds = display.localBounds;
	        const margin = 22;
	        const panelHeight = 56;
	        const availableWidth = Math.max(120, bounds.width - 32);
	        const width = Math.round(Math.min(620, availableWidth));
	        const top = Math.round(Math.max(bounds.y + 12, bounds.y + bounds.height - panelHeight - margin));
	        panel.style.left = Math.round(bounds.x + bounds.width / 2) + 'px';
	        panel.style.top = top + 'px';
	        panel.style.bottom = '';
	        panel.style.width = width + 'px';
	      }

	      function panelDisplay() {
	        return selectedDisplay ?? activeDisplay;
	      }

	      function renderPanel() {
	        const display = panelDisplay();
	        if (!isWindowDisplay(display)) {
	          panel.style.display = 'none';
	          return;
	        }
	        panel.style.display = 'flex';
	        positionPanel(display);
	      }

	      function updateActiveDisplay(event) {
	        const display = displayAtEvent(event);
	        if (display) {
	          activeDisplay = display;
	          api?.setActiveDisplay?.(displayPayload(display));
	        }
	        renderActiveDisplay();
	        if (display) focusComment();
	        return display ?? activeDisplay;
	      }

	      function clampPointToDisplay(point, display) {
	        const bounds = display.localBounds;
	        return {
	          x: Math.min(Math.max(point.x, bounds.x), bounds.x + bounds.width),
	          y: Math.min(Math.max(point.y, bounds.y), bounds.y + bounds.height),
	        };
	      }

	      function renderRect(rect, display) {
	        const clipped = display ? intersectLocalRect(rect, display) : rect;
	        if (!clipped) {
	          box.style.display = 'none';
	          return null;
	        }
	        box.style.display = 'block';
	        box.style.left = clipped.x + 'px';
	        box.style.top = clipped.y + 'px';
	        box.style.width = clipped.width + 'px';
	        box.style.height = clipped.height + 'px';
	        return clipped;
	      }

	      function updateSaveState() {
	        save.disabled = !selectedBounds || comment.value.trim().length === 0;
	      }

	      function resetSelection() {
	        selectedBounds = null;
	        selectedDisplay = null;
	        save.disabled = true;
	        box.style.display = 'none';
	        renderPanel();
	      }

	      function submitSelected() {
	        if (!selectedBounds) return;
	        if (comment.value.trim().length === 0) {
	          comment.focus();
	          updateSaveState();
	          return;
	        }
	        api?.submitSelection?.({
	          bounds: selectedBounds,
	          comment: comment.value,
	          display: displayPayload(selectedDisplay),
	        });
	      }

	      if (displays.length > 0) {
	        activeDisplay = displays.find((display) => display.id === initialActiveDisplayId)
	          ?? displays.find((display) => display.id === windowDisplayId)
	          ?? displays[0];
	        renderActiveDisplay();
	      }

	      window.addEventListener('pointerdown', (event) => {
	        if (event.button !== 0 || isControl(event.target)) return;
	        const display = updateActiveDisplay(event);
	        if (!display) return;
	        lockedDisplay = display;
	        drag = clampPointToDisplay({ x: event.clientX, y: event.clientY }, display);
	        api?.setDragState?.({ active: true, display: displayPayload(display) });
	        resetSelection();
	        body.classList.add('selecting');
	        window.getSelection()?.removeAllRanges();
	        try {
	          body.setPointerCapture?.(event.pointerId);
	        } catch {}
	        event.preventDefault();
	      });

	      window.addEventListener('pointermove', (event) => {
	        if (!drag) {
	          updateActiveDisplay(event);
	          return;
	        }
	        const rect = localRect(drag, { x: event.clientX, y: event.clientY });
	        renderRect(rect, lockedDisplay);
	        event.preventDefault();
	      });

	      window.addEventListener('pointerup', (event) => {
	        if (!drag) return;
	        const rect = localRect(drag, { x: event.clientX, y: event.clientY });
	        const display = lockedDisplay;
	        drag = null;
	        lockedDisplay = null;
	        try {
	          body.releasePointerCapture?.(event.pointerId);
	        } catch {}
	        const clipped = display ? renderRect(rect, display) : renderRect(rect, null);
	        if (clipped && clipped.width >= 4 && clipped.height >= 4) {
	          selectedBounds = screenRect(clipped);
	          selectedDisplay = display;
	          updateSaveState();
	          renderPanel();
	          focusComment();
	        } else {
	          resetSelection();
        }
        api?.setDragState?.({ active: false, display: displayPayload(selectedDisplay ?? display) });
        event.preventDefault();
	      });

	      window.addEventListener('pointercancel', () => {
	        drag = null;
	        lockedDisplay = null;
	        api?.setDragState?.({ active: false, display: displayPayload(selectedDisplay ?? activeDisplay) });
	      });

	      api?.onActiveDisplayChanged?.((payload) => {
	        const display = displayFromPayload(payload);
	        if (!display) return;
	        activeDisplay = display;
	        renderActiveDisplay();
	        if (!selectedDisplay && isWindowDisplay(display)) focusComment();
	      });

	      comment.addEventListener('input', updateSaveState);

	      cancel.addEventListener('click', () => {
	        api?.cancelSelection?.();
	      });

	      save.addEventListener('click', () => {
	        submitSelected();
	      });

	      window.addEventListener('keydown', (event) => {
	        if (event.key === 'Escape') {
	          event.preventDefault();
	          api?.cancelSelection?.();
	          return;
	        }
	        if (event.key === 'Enter') {
	          if (event.shiftKey && event.target === comment) return;
	          event.preventDefault();
	          if (selectedBounds) submitSelected();
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
    windowListPayloadReturned: false,
    screenshotPayloadReturned: false,
    providerPayloadReturned: false,
    ...(providerMetadata.windowBinding ? {} : {
      windowBinding: fallbackWindowBinding(submitted, providerResult.status ?? 'captured', displayMetadata),
    }),
  };
}

function fallbackWindowBinding(
  submitted: DesktopAnnotationSubmittedComment,
  status: 'captured' | 'blocked',
  displayMetadata: { displayId?: string; screenId?: string; scale?: number },
): Record<string, unknown> {
  const displayBindingMetadata = submitted.windowRef ? {} : displayMetadata;
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
      ...displayBindingMetadata,
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
    ...displayBindingMetadata,
  };
}

function normalizedDisplayMetadata(display: DesktopAnnotationDisplayMetadata): DesktopAnnotationDisplayMetadata {
  const displayId = boundedMetadataText(display.displayId);
  const screenId = boundedMetadataText(display.screenId);
  const scale = display.scale === undefined ? undefined : requireFiniteNumber(display.scale, 'display.scale');
  return {
    ...(display.id === undefined ? {} : { id: display.id }),
    ...(displayId ? { displayId } : {}),
    ...(screenId ? { screenId } : {}),
    bounds: normalizePositiveBounds(display.bounds, 'display.bounds'),
    ...(display.scaleFactor === undefined ? {} : { scaleFactor: requireFiniteNumber(display.scaleFactor, 'display.scaleFactor') }),
    ...(scale === undefined ? {} : { scale }),
  };
}

function unionBounds(displays: DesktopAnnotationDisplayMetadata[]): DesktopAnnotationBounds {
  const normalized = displays.map((display) => normalizedDisplayMetadata(display));
  const first = normalized[0];
  if (!first) {
    throw new Error('Desktop annotation overlay requires at least one display.');
  }
  let left = first.bounds.x;
  let top = first.bounds.y;
  let right = first.bounds.x + first.bounds.width;
  let bottom = first.bounds.y + first.bounds.height;
  for (const display of normalized.slice(1)) {
    left = Math.min(left, display.bounds.x);
    top = Math.min(top, display.bounds.y);
    right = Math.max(right, display.bounds.x + display.bounds.width);
    bottom = Math.max(bottom, display.bounds.y + display.bounds.height);
  }
  return {
    x: roundNumber(left),
    y: roundNumber(top),
    width: roundNumber(right - left),
    height: roundNumber(bottom - top),
  };
}

function sameDisplayBounds(left: DesktopAnnotationBounds, right: DesktopAnnotationBounds): boolean {
  return roundNumber(left.x) === roundNumber(right.x)
    && roundNumber(left.y) === roundNumber(right.y)
    && roundNumber(left.width) === roundNumber(right.width)
    && roundNumber(left.height) === roundNumber(right.height);
}

function containsScreenPoint(bounds: DesktopAnnotationBounds, point: DesktopAnnotationPoint): boolean {
  return point.x >= bounds.x
    && point.y >= bounds.y
    && point.x < bounds.x + bounds.width
    && point.y < bounds.y + bounds.height;
}

function displayIdentityMetadata(display: DesktopAnnotationDisplayMetadata): { displayId?: string; screenId?: string; scale?: number } {
  const displayId = boundedMetadataText(display.displayId)
    ?? boundedMetadataText(display.id === undefined ? undefined : String(display.id));
  const screenId = boundedMetadataText(display.screenId) ?? displayId;
  const scale = display.scale ?? display.scaleFactor;
  return {
    ...(displayId ? { displayId } : {}),
    ...(screenId ? { screenId } : {}),
    ...(scale !== undefined ? { scale } : {}),
  };
}

function rendererDisplayMetadata(
  display: DesktopAnnotationDisplayMetadata,
  index: number,
): { id: string; bounds: DesktopAnnotationBounds; scaleFactor?: number } {
  const normalized = normalizedDisplayMetadata(display);
  const identity = displayIdentityMetadata(normalized);
  return {
    id: identity.displayId ?? identity.screenId ?? `display-${index + 1}`,
    bounds: { ...normalized.bounds },
    ...(normalized.scaleFactor !== undefined ? { scaleFactor: normalized.scaleFactor } : {}),
    ...(normalized.scaleFactor === undefined && normalized.scale !== undefined ? { scaleFactor: normalized.scale } : {}),
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
