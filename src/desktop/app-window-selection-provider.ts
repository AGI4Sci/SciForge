import type { DesktopAnnotationBounds } from './annotation-overlay.js';
import {
  createDesktopAnnotationMacosWindowInventoryProvider,
  type DesktopAnnotationMacosWindowInventoryProvider,
} from './macos-window-inventory.js';
import type {
  ScreenRegionBindingPermissionStatus,
  ScreenRegionBindingWindowCandidate,
} from './screen-region-auto-binding.js';

export const DESKTOP_ANNOTATION_APP_WINDOW_SELECTION_RESULT_SCHEMA =
  'sciforge.desktop.annotation.app-window-selection-result.v1' as const;

export type DesktopAnnotationAppWindowSelectionProvider = {
  select(input: unknown): Promise<DesktopAnnotationAppWindowSelectionProviderResult> | DesktopAnnotationAppWindowSelectionProviderResult;
};

export type DesktopAnnotationAppWindowSelectionProviderOptions = {
  windowInventory?: DesktopAnnotationMacosWindowInventoryProvider;
  chooseWindow?: DesktopAnnotationAppWindowChooser;
  maxCandidates?: number;
  maxDiagnosticRefs?: number;
  maxDiagnostics?: number;
  maxTextLength?: number;
};

export type DesktopAnnotationAppWindowChooser = (
  input: DesktopAnnotationAppWindowChooserInput,
) => Promise<DesktopAnnotationAppWindowChooserResult> | DesktopAnnotationAppWindowChooserResult;

export type DesktopAnnotationAppWindowChooserInput = {
  request: Record<string, unknown>;
  candidates: readonly DesktopAnnotationAppWindowCandidate[];
  candidateRefs: readonly string[];
  refsOnly: true;
};

export type DesktopAnnotationAppWindowChooserResult =
  | string
  | number
  | {
      status?: 'selected' | 'cancelled' | 'canceled' | 'blocked';
      windowRef?: unknown;
      targetRef?: unknown;
      candidateId?: unknown;
      id?: unknown;
      reason?: unknown;
      message?: unknown;
    }
  | null
  | undefined;

export type DesktopAnnotationAppWindowSelectionProviderResult =
  | DesktopAnnotationAppWindowSelectionSelectedResult
  | DesktopAnnotationAppWindowSelectionBlockedResult;

export type DesktopAnnotationAppWindowSelectionSelectedResult = {
  schemaVersion: typeof DESKTOP_ANNOTATION_APP_WINDOW_SELECTION_RESULT_SCHEMA;
  status: 'selected';
  windowRef: string;
  targetRef: string;
  refs: string[];
  windowBounds: DesktopAnnotationBounds;
  windowSummary?: DesktopAnnotationAppWindowSummary;
  displayId?: string;
  screenId?: string;
  scale?: number;
  diagnostics: DesktopAnnotationAppWindowSelectionDiagnostic[];
  metadata: DesktopAnnotationAppWindowSelectionMetadata;
};

export type DesktopAnnotationAppWindowSelectionBlockedResult = {
  schemaVersion: typeof DESKTOP_ANNOTATION_APP_WINDOW_SELECTION_RESULT_SCHEMA;
  status: 'blocked';
  code: string;
  reason: string;
  message: string;
  refs: string[];
  diagnostics: DesktopAnnotationAppWindowSelectionDiagnostic[];
  metadata: DesktopAnnotationAppWindowSelectionMetadata;
};

export type DesktopAnnotationAppWindowSelectionDiagnostic = {
  code: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  refsOnly: true;
  refs?: string[];
};

export type DesktopAnnotationAppWindowSelectionMetadata = {
  refsOnly: true;
  sourceKind: 'window';
  coordinateSpace: 'window-local';
  candidateCount: number;
  permissionStatus?: ScreenRegionBindingPermissionStatus;
  windowListPayloadReturned: false;
  screenshotPayloadReturned: false;
  providerPayloadReturned: false;
};

export type DesktopAnnotationAppWindowSummary = {
  appName?: string;
  bundleId?: string;
  pid?: number;
  title?: string;
};

export type DesktopAnnotationAppWindowCandidate = {
  windowRef: string;
  targetRef: string;
  id?: string;
  windowBounds: DesktopAnnotationBounds;
  windowSummary?: DesktopAnnotationAppWindowSummary;
  displayId?: string;
  screenId?: string;
  scale?: number;
};

const DEFAULT_MAX_CANDIDATES = 80;
const DEFAULT_MAX_DIAGNOSTIC_REFS = 5;
const DEFAULT_MAX_DIAGNOSTICS = 5;
const DEFAULT_MAX_TEXT_LENGTH = 200;

export function createDesktopAnnotationAppWindowSelectionProvider(
  options: DesktopAnnotationAppWindowSelectionProviderOptions = {},
): DesktopAnnotationAppWindowSelectionProvider {
  const windowInventory = options.windowInventory ?? createDesktopAnnotationMacosWindowInventoryProvider();
  const maxCandidates = positiveIntegerOrDefault(options.maxCandidates, DEFAULT_MAX_CANDIDATES);
  const maxDiagnosticRefs = positiveIntegerOrDefault(options.maxDiagnosticRefs, DEFAULT_MAX_DIAGNOSTIC_REFS);
  const maxDiagnostics = positiveIntegerOrDefault(options.maxDiagnostics, DEFAULT_MAX_DIAGNOSTICS);
  const maxTextLength = positiveIntegerOrDefault(options.maxTextLength, DEFAULT_MAX_TEXT_LENGTH);

  async function select(input: unknown): Promise<DesktopAnnotationAppWindowSelectionProviderResult> {
    const request = recordOrEmpty(input);
    const permissionStatus = safePermissionStatus(windowInventory);
    if (permissionStatus !== 'granted') {
      return blockedResult({
        code: 'desktop.annotation.app-window-selection-permission-failure',
        reason: 'permission-failure',
        message: 'App window selection requires window enumeration permission before native annotation can start.',
        permissionStatus,
        candidates: [],
        refs: [],
      });
    }

    const rawCandidates = safeWindowCandidates(windowInventory);
    if (!rawCandidates.ok) {
      return blockedResult({
        code: 'desktop.annotation.app-window-selection-inventory-failed',
        reason: 'inventory-failed',
        message: 'App window selection could not enumerate refs-only window candidates.',
        permissionStatus,
        candidates: [],
        refs: [],
      });
    }

    const candidates = rawCandidates.windows
      .slice(0, maxCandidates)
      .flatMap((candidate) => sanitizedCandidate(candidate, { maxTextLength }));
    if (!candidates.length) {
      return blockedResult({
        code: 'desktop.annotation.app-window-selection-no-candidates',
        reason: 'no-candidates',
        message: 'No bounded app-window candidates are available for selection.',
        permissionStatus,
        candidates,
        refs: [],
      });
    }

    const deterministicSelection = requestedCandidateMatcher(request);
    if (deterministicSelection.hasSelector) {
      const selected = candidates.find(deterministicSelection.matches);
      if (!selected) {
        return blockedResult({
          code: 'desktop.annotation.app-window-selection-invalid-window-ref',
          reason: 'invalid-window-ref',
          message: 'The requested app-window candidate ref was not available in the refs-only inventory.',
          permissionStatus,
          candidates,
          refs: candidateRefs(candidates, maxDiagnosticRefs),
        });
      }
      return selectedResult(selected, {
        candidates,
        permissionStatus,
        diagnosticCode: 'desktop.annotation.app-window-selection-selected',
        diagnosticMessage: 'App window selection resolved one deterministic window ref.',
      });
    }

    if (options.chooseWindow) {
      const choice = await options.chooseWindow({
        request,
        candidates,
        candidateRefs: candidateRefs(candidates, maxDiagnosticRefs),
        refsOnly: true,
      });
      const normalizedChoice = normalizeChooserResult(choice);
      if (normalizedChoice.status === 'cancelled') {
        return blockedResult({
          code: 'desktop.annotation.app-window-selection-cancelled',
          reason: 'cancelled',
          message: normalizedChoice.message ?? 'App window annotation was cancelled before a window was selected.',
          permissionStatus,
          candidates,
          refs: candidateRefs(candidates, maxDiagnosticRefs),
        });
      }
      if (normalizedChoice.status === 'blocked') {
        return blockedResult({
          code: 'desktop.annotation.app-window-selection-blocked',
          reason: 'blocked',
          message: normalizedChoice.message ?? 'App window selection was blocked before native annotation could start.',
          permissionStatus,
          candidates,
          refs: candidateRefs(candidates, maxDiagnosticRefs),
        });
      }
      if (normalizedChoice.status !== 'selected') {
        return blockedResult({
          code: 'desktop.annotation.app-window-selection-blocked',
          reason: 'blocked',
          message: 'App window selection was blocked before native annotation could start.',
          permissionStatus,
          candidates,
          refs: candidateRefs(candidates, maxDiagnosticRefs),
        });
      }
      const selected = candidates.find((candidate) => normalizedChoice.matches(candidate));
      if (!selected) {
        return blockedResult({
          code: 'desktop.annotation.app-window-selection-invalid-window-ref',
          reason: 'invalid-window-ref',
          message: 'The app-window chooser returned a candidate that was not available in the refs-only inventory.',
          permissionStatus,
          candidates,
          refs: candidateRefs(candidates, maxDiagnosticRefs),
        });
      }
      return selectedResult(selected, {
        candidates,
        permissionStatus,
        diagnosticCode: 'desktop.annotation.app-window-selection-selected',
        diagnosticMessage: 'App window selection resolved one user-selected window ref.',
      });
    }

    return blockedResult({
      code: 'desktop.annotation.app-window-selection-user-choice-unavailable',
      reason: 'user-choice-unavailable',
      message: 'A real app-window chooser is unavailable, and no deterministic windowRef or candidate id was provided.',
      permissionStatus,
      candidates,
      refs: candidateRefs(candidates, maxDiagnosticRefs),
    });
  }

  function selectedResult(
    candidate: DesktopAnnotationAppWindowCandidate,
    context: {
      candidates: readonly DesktopAnnotationAppWindowCandidate[];
      permissionStatus?: ScreenRegionBindingPermissionStatus;
      diagnosticCode: string;
      diagnosticMessage: string;
    },
  ): DesktopAnnotationAppWindowSelectionSelectedResult {
    return {
      schemaVersion: DESKTOP_ANNOTATION_APP_WINDOW_SELECTION_RESULT_SCHEMA,
      status: 'selected',
      windowRef: candidate.windowRef,
      targetRef: candidate.targetRef,
      refs: compactRefs([candidate.windowRef, candidate.targetRef]),
      windowBounds: { ...candidate.windowBounds },
      ...(candidate.windowSummary ? { windowSummary: { ...candidate.windowSummary } } : {}),
      ...(candidate.displayId ? { displayId: candidate.displayId } : {}),
      ...(candidate.screenId ? { screenId: candidate.screenId } : {}),
      ...(candidate.scale !== undefined ? { scale: candidate.scale } : {}),
      diagnostics: boundedDiagnostics([diagnostic(
        context.diagnosticCode,
        'info',
        context.diagnosticMessage,
        compactRefs([candidate.windowRef, candidate.targetRef]),
      )]),
      metadata: metadata(context.candidates, context.permissionStatus),
    };
  }

  function blockedResult(input: {
    code: string;
    reason: string;
    message: string;
    permissionStatus?: ScreenRegionBindingPermissionStatus;
    candidates: readonly DesktopAnnotationAppWindowCandidate[];
    refs: readonly string[];
  }): DesktopAnnotationAppWindowSelectionBlockedResult {
    return {
      schemaVersion: DESKTOP_ANNOTATION_APP_WINDOW_SELECTION_RESULT_SCHEMA,
      status: 'blocked',
      code: input.code,
      reason: input.reason,
      message: boundedText(input.message, maxTextLength) ?? input.code,
      refs: [],
      diagnostics: boundedDiagnostics([diagnostic(
        input.code,
        input.reason === 'permission-failure' || input.reason === 'inventory-failed' ? 'error' : 'warning',
        input.message,
        input.refs,
      )]),
      metadata: metadata(input.candidates, input.permissionStatus),
    };
  }

  function boundedDiagnostics(
    diagnostics: readonly DesktopAnnotationAppWindowSelectionDiagnostic[],
  ): DesktopAnnotationAppWindowSelectionDiagnostic[] {
    return diagnostics.slice(0, maxDiagnostics);
  }

  function metadata(
    candidates: readonly DesktopAnnotationAppWindowCandidate[],
    permissionStatus?: ScreenRegionBindingPermissionStatus,
  ): DesktopAnnotationAppWindowSelectionMetadata {
    return {
      refsOnly: true,
      sourceKind: 'window',
      coordinateSpace: 'window-local',
      candidateCount: candidates.length,
      ...(permissionStatus ? { permissionStatus } : {}),
      windowListPayloadReturned: false,
      screenshotPayloadReturned: false,
      providerPayloadReturned: false,
    };
  }

  return { select };
}

function safePermissionStatus(
  windowInventory: DesktopAnnotationMacosWindowInventoryProvider,
): ScreenRegionBindingPermissionStatus {
  try {
    return windowInventory.screenRegionBindingPermissionStatus();
  } catch {
    return 'unavailable';
  }
}

function safeWindowCandidates(
  windowInventory: DesktopAnnotationMacosWindowInventoryProvider,
): { ok: true; windows: ScreenRegionBindingWindowCandidate[] } | { ok: false } {
  try {
    return { ok: true, windows: windowInventory.screenRegionBindingWindows() };
  } catch {
    return { ok: false };
  }
}

function sanitizedCandidate(
  candidate: ScreenRegionBindingWindowCandidate,
  options: { maxTextLength: number },
): DesktopAnnotationAppWindowCandidate[] {
  const record = candidate as Record<string, unknown>;
  const windowRef = safeRef(firstText(record.windowRef, record.ref, record.targetWindowRef));
  const windowBounds = normalizedBounds(record.windowBounds ?? record.bounds);
  if (!windowRef || !windowBounds) return [];
  const targetRef = safeRef(firstText(record.targetRef, record.targetWindowRef)) ?? windowRef;
  const summary = compactSummary(record, options.maxTextLength);
  return [{
    windowRef,
    targetRef,
    ...(candidateId(record) ? { id: candidateId(record) } : {}),
    windowBounds,
    ...(summary ? { windowSummary: summary } : {}),
    ...(boundedText(firstText(record.displayId, record.displayID), options.maxTextLength) ? {
      displayId: boundedText(firstText(record.displayId, record.displayID), options.maxTextLength),
    } : {}),
    ...(boundedText(firstText(record.screenId, record.displayId, record.displayID), options.maxTextLength) ? {
      screenId: boundedText(firstText(record.screenId, record.displayId, record.displayID), options.maxTextLength),
    } : {}),
    ...(positiveNumber(record.scale) !== undefined ? { scale: positiveNumber(record.scale) } : {}),
  }];
}

function compactSummary(
  record: Record<string, unknown>,
  maxTextLength: number,
): DesktopAnnotationAppWindowSummary | undefined {
  const summaryRecord = recordOrUndefined(record.windowSummary) ?? {};
  const appName = boundedText(
    firstText(record.appName, record.ownerName, record.name, summaryRecord.appName, summaryRecord.ownerName),
    maxTextLength,
  );
  const bundleId = boundedText(
    firstText(record.bundleId, record.bundleID, record.bundleIdentifier, summaryRecord.bundleId, summaryRecord.bundleID),
    maxTextLength,
  );
  const pid = finiteInteger(record.pid ?? record.processId ?? summaryRecord.pid ?? summaryRecord.processId);
  const title = boundedText(
    firstText(record.title, record.windowTitle, summaryRecord.title, summaryRecord.windowTitle),
    maxTextLength,
  );
  const output: DesktopAnnotationAppWindowSummary = {};
  if (appName) output.appName = appName;
  if (bundleId) output.bundleId = bundleId;
  if (pid !== undefined) output.pid = pid;
  if (title) output.title = title;
  return Object.keys(output).length ? output : undefined;
}

function requestedCandidateMatcher(request: Record<string, unknown>): {
  hasSelector: boolean;
  matches(candidate: DesktopAnnotationAppWindowCandidate): boolean;
} {
  const windowRef = safeRef(firstText(
    request.windowRef,
    request.targetWindowRef,
    recordOrUndefined(request.window)?.windowRef,
    recordOrUndefined(request.selection)?.windowRef,
  ));
  const id = selectorId(request.candidateId ?? request.windowId ?? request.id);
  if (windowRef) {
    return {
      hasSelector: true,
      matches: (candidate) => candidate.windowRef === windowRef || candidate.targetRef === windowRef,
    };
  }
  if (id) {
    return {
      hasSelector: true,
      matches: (candidate) => candidate.id === id,
    };
  }
  return {
    hasSelector: false,
    matches: () => false,
  };
}

function normalizeChooserResult(choice: DesktopAnnotationAppWindowChooserResult): {
  status: 'selected';
  matches(candidate: DesktopAnnotationAppWindowCandidate): boolean;
} | {
  status: 'cancelled' | 'blocked';
  message?: string;
} {
  if (choice === null || choice === undefined) return { status: 'cancelled' };
  if (typeof choice === 'string') {
    const windowRef = safeRef(choice);
    return { status: 'selected', matches: (candidate) => candidate.windowRef === windowRef || candidate.targetRef === windowRef };
  }
  if (typeof choice === 'number') {
    const id = selectorId(choice);
    return { status: 'selected', matches: (candidate) => candidate.id === id };
  }
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return { status: 'blocked' };
  const record = choice as Record<string, unknown>;
  if (record.status === 'cancelled' || record.status === 'canceled') {
    return { status: 'cancelled', message: boundedText(firstText(record.message, record.reason), DEFAULT_MAX_TEXT_LENGTH) };
  }
  if (record.status === 'blocked') {
    return { status: 'blocked', message: boundedText(firstText(record.message, record.reason), DEFAULT_MAX_TEXT_LENGTH) };
  }
  const windowRef = safeRef(firstText(record.windowRef, record.targetRef));
  const id = selectorId(record.candidateId ?? record.id);
  if (windowRef) {
    return { status: 'selected', matches: (candidate) => candidate.windowRef === windowRef || candidate.targetRef === windowRef };
  }
  if (id) {
    return { status: 'selected', matches: (candidate) => candidate.id === id };
  }
  return { status: 'blocked' };
}

function candidateRefs(
  candidates: readonly DesktopAnnotationAppWindowCandidate[],
  maxDiagnosticRefs: number,
): string[] {
  return compactRefs(candidates.slice(0, maxDiagnosticRefs).map((candidate) => candidate.windowRef));
}

function diagnostic(
  code: string,
  level: DesktopAnnotationAppWindowSelectionDiagnostic['level'],
  message: string,
  refs: readonly string[] = [],
): DesktopAnnotationAppWindowSelectionDiagnostic {
  const compactedRefs = compactRefs([...refs]);
  return {
    code,
    level,
    message: boundedText(message, DEFAULT_MAX_TEXT_LENGTH) ?? code,
    refsOnly: true,
    ...(compactedRefs.length ? { refs: compactedRefs } : {}),
  };
}

function compactRefs(refs: readonly unknown[]): string[] {
  return Array.from(new Set(refs.flatMap((ref) => {
    const text = safeRef(typeof ref === 'string' ? ref : undefined);
    return text ? [text] : [];
  })));
}

function candidateId(record: Record<string, unknown>): string | undefined {
  return selectorId(record.candidateId ?? record.id ?? record.windowNumber ?? record.cgWindowId ?? record.macosWindowId);
}

function selectorId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, DEFAULT_MAX_TEXT_LENGTH) : undefined;
}

function normalizedBounds(value: unknown): DesktopAnnotationBounds | undefined {
  const record = recordOrUndefined(value);
  if (!record) return undefined;
  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  const width = finiteNumber(record.width);
  const height = finiteNumber(record.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function safeRef(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : undefined;
  if (!text || containsRawPayloadText(text)) return undefined;
  return text.slice(0, DEFAULT_MAX_TEXT_LENGTH);
}

function boundedText(value: unknown, maxTextLength: number): string | undefined {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : undefined;
  if (!text || containsSensitiveText(text)) return undefined;
  return text.slice(0, maxTextLength);
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number === undefined ? undefined : Math.trunc(number);
}

function positiveNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return recordOrUndefined(value) ?? {};
}

function containsSensitiveText(value: string): boolean {
  return /data:|base64|secret|token|api[-_\s]?key|password|passwd|bearer|<[^>]*>/i.test(value);
}

function containsRawPayloadText(value: string): boolean {
  return /data:|base64|<[^>]*>/i.test(value);
}
