import { SCIFORGE_ANNOTATION_REFERENCE_DISPLAY_MODEL } from '../shared/annotation-reference-contract.js';

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

export type DesktopAnnotationOverlayBrowserWindowOptions = {
  transparent: true;
  frame: false;
  alwaysOnTop: true;
  skipTaskbar: true;
  focusable: false;
  resizable: false;
  movable: false;
  show: false;
  bounds: DesktopAnnotationBounds;
  hasShadow: false;
  webPreferences: {
    contextIsolation: true;
    nodeIntegration: false;
    sandbox: true;
  };
};

export type DesktopAnnotationOverlayWindow = {
  show(): void;
  hide(): void;
  isVisible?(): boolean;
  setBounds?(bounds: DesktopAnnotationBounds): void;
  setAlwaysOnTop?(flag: boolean, level?: string): void;
  setIgnoreMouseEvents?(ignore: boolean, options?: { forward?: boolean }): void;
};

export type DesktopAnnotationOverlayScreen = {
  getPrimaryDisplay(): {
    id?: number | string;
    bounds: DesktopAnnotationBounds;
    scaleFactor?: number;
  };
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
  windowBounds: DesktopAnnotationBounds;
  screenBounds: DesktopAnnotationBounds;
  bounds: DesktopAnnotationBounds;
  normalizedBounds: DesktopAnnotationBounds;
  overlayExclusion: {
    hidden: true;
    clickThrough: true;
  };
};

export type DesktopAnnotationCaptureProviderResult = {
  screenshotRef: string;
  cropRef: string;
  imageRef?: string;
  hash?: string;
  capturedAt?: string;
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
  captureIdFactory?: () => string;
  now?: () => string;
};

export type DesktopAnnotationBeginSelectionInput = {
  workspaceId: string;
  sessionId: string;
  windowRef?: string;
  targetRef?: string;
  windowBounds: DesktopAnnotationBounds;
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
  windowBounds: DesktopAnnotationBounds;
  screenBounds: DesktopAnnotationBounds;
  bounds: DesktopAnnotationBounds;
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
  status: 'captured';
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
  windowBounds: DesktopAnnotationBounds;
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
        focusable: false,
        resizable: false,
        movable: false,
        show: false,
        bounds,
        hasShadow: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      overlayWindow.setBounds?.(bounds);
      overlayWindow.setAlwaysOnTop?.(true, options.alwaysOnTopLevel ?? 'screen-saver');
      applyClickThrough(clickThrough);
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
    selectionContext = {
      workspaceId,
      sessionId,
      windowRef,
      targetRef,
      sourceKind,
      coordinateSpace,
      windowBounds: normalizePositiveBounds(input.windowBounds, 'windowBounds'),
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
    const clippedScreenBounds = intersectBounds(normalizedScreenBounds, selectionContext.windowBounds);
    if (!clippedScreenBounds || clippedScreenBounds.width <= 0 || clippedScreenBounds.height <= 0) {
      throw new Error('Desktop annotation selection bounds must overlap the target window.');
    }
    const localBounds = {
      x: roundNumber(clippedScreenBounds.x - selectionContext.windowBounds.x),
      y: roundNumber(clippedScreenBounds.y - selectionContext.windowBounds.y),
      width: roundNumber(clippedScreenBounds.width),
      height: roundNumber(clippedScreenBounds.height),
    };
    const normalizedBounds = {
      x: roundNumber(localBounds.x / selectionContext.windowBounds.width),
      y: roundNumber(localBounds.y / selectionContext.windowBounds.height),
      width: roundNumber(localBounds.width / selectionContext.windowBounds.width),
      height: roundNumber(localBounds.height / selectionContext.windowBounds.height),
    };
    selection = {
      status: 'selecting',
      ...selectionContext,
      screenBounds: clippedScreenBounds,
      bounds: localBounds,
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
        normalizedBounds: submitted.normalizedBounds,
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
        status: 'captured',
        workspaceId: submitted.workspaceId,
        sessionId: submitted.sessionId,
        windowRef: submitted.windowRef,
        targetRef: submitted.targetRef,
        sourceKind: submitted.sourceKind,
        coordinateSpace: submitted.coordinateSpace,
        windowBounds: submitted.windowBounds,
        screenBounds: submitted.screenBounds,
        bounds: submitted.bounds,
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
          windowRef: submitted.windowRef,
          targetRef: submitted.targetRef,
        },
        refs: compactRefs([
          annotationRef,
          providerResult.screenshotRef,
          providerResult.cropRef,
          providerResult.imageRef,
        ]),
        metadata: {
          captureId,
          overlayExcluded: true,
          overlayExclusion: 'hidden-and-click-through',
          refsOnly: true,
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
    const status = submitted ? 'submitted' : selection ? 'selecting' : 'idle';
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
  assertRefsOnlyObject(result);
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
    if (/^(dataUrl|base64|bytes|buffer|rawScreenshot|screenshotBytes|rawPayload|payload)$/i.test(key)) {
      throw new Error(`Capture output must be refs-only; raw screenshot payload key "${key}" is forbidden.`);
    }
    if (typeof nested === 'string') {
      if (/^data:image\//i.test(nested) || /;base64,/i.test(nested)) {
        throw new Error('Capture output must be refs-only; raw screenshot payload strings are forbidden.');
      }
    }
  });
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
