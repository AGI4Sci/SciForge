import type {
  DesktopAnnotationCaptureProvider,
  DesktopAnnotationCaptureProviderInput,
  DesktopAnnotationCaptureProviderResult,
} from './annotation-overlay.js';
import {
  captureSelectedDesktopWindowTarget,
  type CaptureSelectedDesktopWindowTargetOptions,
  type DesktopWindowCaptureDiagnostic,
  type DesktopWindowCaptureSelection,
} from './window-capture.js';
import {
  bindScreenRegionToWindow,
  type ScreenRegionAutoBindingCandidateSummary,
  type ScreenRegionAutoBindingDiagnostic,
  type ScreenRegionAutoBindingResult,
  type ScreenRegionBindingPermissionStatus,
  type ScreenRegionBindingWindowCandidate,
} from './screen-region-auto-binding.js';
import {
  SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_CANDIDATES,
  SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_DIAGNOSTICS,
} from '../shared/annotation-reference-contract.js';

const DEFAULT_SCREEN_REGION_BINDING_MIN_OVERLAP_RATIO = 0.7;

type ScreenRegionBindingWindowSource =
  | readonly ScreenRegionBindingWindowCandidate[]
  | ((input: DesktopAnnotationCaptureProviderInput) => readonly ScreenRegionBindingWindowCandidate[] | Promise<readonly ScreenRegionBindingWindowCandidate[]>);

type ScreenRegionBindingPermissionSource =
  | ScreenRegionBindingPermissionStatus
  | ((input: DesktopAnnotationCaptureProviderInput) => ScreenRegionBindingPermissionStatus | Promise<ScreenRegionBindingPermissionStatus>);

export type DesktopAnnotationWindowCaptureProviderOptions =
  CaptureSelectedDesktopWindowTargetOptions & {
    screenId?: string;
    scale?: number;
    screenRegionBindingWindows?: ScreenRegionBindingWindowSource;
    screenRegionBindingPermissionStatus?: ScreenRegionBindingPermissionSource;
    screenRegionBindingExcludedOwnerIds?: readonly string[];
    screenRegionBindingMinOverlapRatio?: number;
    screenRegionBindingMinScoreLeadRatio?: number;
    screenRegionBindingMaxCandidates?: number;
    screenRegionBindingMaxDiagnostics?: number;
    screenRegionBindingMaxInputCandidates?: number;
    screenRegionBindingMinWindowWidth?: number;
    screenRegionBindingMinWindowHeight?: number;
    screenRegionBindingMinWindowArea?: number;
  };

export function createDesktopAnnotationWindowCaptureProvider(
  options: DesktopAnnotationWindowCaptureProviderOptions = {},
): DesktopAnnotationCaptureProvider {
  return {
    async captureSelection(input) {
      const owned = ownedAnnotationCaptureRefs(input);
      const selection = windowCaptureSelectionForAnnotation(input, options);
      const result = await captureSelectedDesktopWindowTarget({
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        selection,
      }, {
        ...options,
        createWindowActionSession: false,
      });
      const provenanceRefs = result.status === 'captured'
        ? compactRefs([
          provenanceRefForWindowCaptureResult(result.captureRef),
          provenanceRefForWindowCaptureResult(result.imageRef),
        ])
        : [
          `${owned.prefix}window-capture/blocked/${sanitizeRefSegment(input.captureId)}`,
          `${owned.prefix}window-capture/blocked/${sanitizeRefSegment(input.captureId)}/diagnostics`,
        ];
      const windowBinding = await annotationWindowBindingMetadata(input, result.status, result.screenId, result.scale, options);
      const bindingWindowRef = bindingWindowRefForMetadata(windowBinding);
      const bindingWindowBounds = boundsFromMetadata(windowBinding.windowBounds);
      const bindingWindowLocalBounds = boundsFromMetadata(windowBinding.windowLocalBounds);
      const windowBindingCandidates = Array.isArray(windowBinding.candidates) && windowBinding.candidates.length
        ? windowBinding.candidates
        : undefined;
      const providerDiagnostics = diagnosticsWithRefs([
        ...result.diagnostics,
        ...desktopDiagnosticsFromWindowBinding(windowBinding),
      ], provenanceRefs);

      return {
        status: result.status,
        screenshotRef: owned.screenshotRef,
        cropRef: owned.cropRef,
        imageRef: owned.imageRef,
        hash: result.hash ?? undefined,
        capturedAt: result.capturedAt ?? undefined,
        diagnostics: providerDiagnostics,
        metadata: {
          refsOnly: true,
          status: result.status,
          providerId: result.providerId,
          targetRef: result.targetRef,
          windowRef: result.windowRef ?? bindingWindowRef,
          regionRef: result.regionRef,
          screenId: result.screenId,
          displayId: result.screenId ?? undefined,
          bounds: result.bounds,
          screenBounds: { ...input.screenBounds },
          ...(input.windowRef ? { windowBounds: { ...input.windowBounds }, windowLocalBounds: { ...input.bounds } } : {}),
          ...(!input.windowRef && bindingWindowBounds ? { windowBounds: bindingWindowBounds } : {}),
          ...(!input.windowRef && bindingWindowLocalBounds ? { windowLocalBounds: bindingWindowLocalBounds } : {}),
          dimensions: { width: input.bounds.width, height: input.bounds.height },
          width: input.bounds.width,
          height: input.bounds.height,
          ...(result.hash ? { hash: result.hash } : {}),
          scale: result.scale,
          privacy: result.privacy,
          provenanceRefs,
          windowCaptureRef: result.captureRef,
          windowCaptureImageRef: result.imageRef,
          windowBinding,
          ...(windowBindingCandidates ? { windowBindingCandidates } : {}),
          diagnostics: providerDiagnostics,
        },
      } satisfies DesktopAnnotationCaptureProviderResult;
    },
  };
}

async function annotationWindowBindingMetadata(
  input: DesktopAnnotationCaptureProviderInput,
  status: 'captured' | 'blocked',
  screenId: string | null,
  scale: number | null,
  options: DesktopAnnotationWindowCaptureProviderOptions,
): Promise<Record<string, unknown>> {
  const displayMetadata = {
    ...(screenId ? { displayId: screenId, screenId } : {}),
    ...(scale ? { scale } : {}),
  };
  if (status === 'blocked') {
    return {
      status: 'blocked',
      reason: input.windowRef
        ? 'Selected window capture could not be evaluated or captured.'
        : 'Selected screen region capture could not be evaluated or captured.',
      ...(input.windowRef ? { windowRef: input.windowRef, targetRef: input.windowRef } : { targetRef: input.targetRef }),
      sourceKind: input.sourceKind,
      coordinateSpace: input.coordinateSpace,
      ...(input.windowRef
        ? { windowBounds: { ...input.windowBounds }, windowLocalBounds: { ...input.bounds }, ...windowSummaryMetadata(input) }
        : { screenBounds: { ...input.screenBounds } }),
      ...displayMetadata,
    };
  }
  if (input.sourceKind === 'screen-region' && !input.windowRef) {
    const { binding, windows } = await bindScreenRegionForAnnotation(input, screenId, scale, options);
    if (binding.status === 'bound') {
      const summary = windowSummaryForBinding(binding.windowRef, windows, { includeTitle: true });
      return compactObject({
        status: 'auto-bound',
        confidence: binding.candidates[0]?.score,
        reason: 'Screen region selection matched one high-confidence app window.',
        windowRef: binding.windowRef,
        targetRef: input.targetRef,
        sourceKind: input.sourceKind,
        coordinateSpace: input.coordinateSpace,
        screenBounds: { ...input.screenBounds },
        windowBounds: binding.windowBounds ? { ...binding.windowBounds } : undefined,
        windowLocalBounds: binding.windowBounds ? windowLocalBounds(input.screenBounds, binding.windowBounds) : undefined,
        ...summary,
        ...displayMetadata,
        candidates: binding.candidates.map((candidate) => bindingCandidateMetadata(candidate, input.screenBounds, windows)),
        diagnostics: bindingDiagnosticsMetadata(binding.diagnostics),
      });
    }
    if (binding.bindingStatus === 'permission-failure' || binding.bindingStatus === 'invalid-selection') {
      return compactObject({
        status: 'blocked',
        reason: binding.bindingStatus,
        targetRef: input.targetRef,
        sourceKind: input.sourceKind,
        coordinateSpace: input.coordinateSpace,
        screenBounds: { ...input.screenBounds },
        ...displayMetadata,
        diagnostics: bindingDiagnosticsMetadata(binding.diagnostics),
      });
    }
    const hasWindowBindingEvidence = binding.candidates.length > 0;
    if (!hasWindowBindingEvidence) {
      return compactObject({
        status: 'unbound',
        reason: binding.bindingStatus,
        targetRef: input.targetRef,
        sourceKind: input.sourceKind,
        coordinateSpace: input.coordinateSpace,
        screenBounds: { ...input.screenBounds },
        ...displayMetadata,
        diagnostics: bindingDiagnosticsMetadata(binding.diagnostics),
      });
    }
    return compactObject({
      status: 'unbound',
      confidence: binding.candidates[0]?.score,
      reason: binding.bindingStatus,
      targetRef: input.targetRef,
      sourceKind: input.sourceKind,
      coordinateSpace: input.coordinateSpace,
      screenBounds: { ...input.screenBounds },
      ...displayMetadata,
      candidates: binding.candidates.map((candidate) => bindingCandidateMetadata(candidate, input.screenBounds, windows)),
      diagnostics: bindingDiagnosticsMetadata(binding.diagnostics),
    });
  }
  if (input.sourceKind !== 'window' || !input.windowRef) {
    return {
      status: 'unbound',
      reason: 'Selection has no explicit app-window binding metadata.',
      targetRef: input.targetRef,
      sourceKind: input.sourceKind,
      coordinateSpace: input.coordinateSpace,
      screenBounds: { ...input.screenBounds },
      ...displayMetadata,
    };
  }
  return {
    status: 'manual-bound',
    reason: 'App window annotation was explicitly selected by the user.',
    windowRef: input.windowRef,
    targetRef: input.windowRef,
    sourceKind: input.sourceKind,
    coordinateSpace: input.coordinateSpace,
    windowBounds: { ...input.windowBounds },
    windowLocalBounds: { ...input.bounds },
    ...windowSummaryMetadata(input),
    ...displayMetadata,
  };
}

async function bindScreenRegionForAnnotation(
  input: DesktopAnnotationCaptureProviderInput,
  screenId: string | null,
  scale: number | null,
  options: DesktopAnnotationWindowCaptureProviderOptions,
): Promise<{ binding: ScreenRegionAutoBindingResult; windows: readonly ScreenRegionBindingWindowCandidate[] }> {
  const windows = Array.from(await resolveScreenRegionBindingWindows(input, options));
  const permissionStatus = await resolveScreenRegionBindingPermissionStatus(
    input,
    options.screenRegionBindingPermissionStatus,
  );
  const binding = bindScreenRegionToWindow({
    screenBounds: input.screenBounds,
    screenId: screenId ?? undefined,
    scale: scale ?? undefined,
    windows,
    excludedOwnerIds: resolveScreenRegionBindingExcludedOwnerIds(input, options),
    permissionStatus,
    minOverlapRatio: options.screenRegionBindingMinOverlapRatio
      ?? DEFAULT_SCREEN_REGION_BINDING_MIN_OVERLAP_RATIO,
    minScoreLeadRatio: options.screenRegionBindingMinScoreLeadRatio,
    minWindowWidth: options.screenRegionBindingMinWindowWidth,
    minWindowHeight: options.screenRegionBindingMinWindowHeight,
    minWindowArea: options.screenRegionBindingMinWindowArea,
    maxCandidates: options.screenRegionBindingMaxCandidates
      ?? SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_CANDIDATES,
    maxDiagnostics: options.screenRegionBindingMaxDiagnostics
      ?? SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_DIAGNOSTICS,
  });
  return { binding, windows };
}

async function resolveScreenRegionBindingWindows(
  input: DesktopAnnotationCaptureProviderInput,
  options: DesktopAnnotationWindowCaptureProviderOptions,
): Promise<readonly ScreenRegionBindingWindowCandidate[]> {
  const optionCandidates = await resolveScreenRegionBindingWindowSource(input, options.screenRegionBindingWindows);
  const inputCandidates = inputScreenRegionBindingWindowSources(input)
    .flatMap(screenRegionBindingWindowCandidatesFromUnknown);
  const maxInputCandidates = positiveIntegerOrDefault(
    options.screenRegionBindingMaxInputCandidates,
    Math.max(options.screenRegionBindingMaxCandidates ?? SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_CANDIDATES, 25),
  );
  return [
    ...screenRegionBindingWindowCandidatesFromUnknown(optionCandidates),
    ...inputCandidates,
  ].slice(0, maxInputCandidates);
}

async function resolveScreenRegionBindingPermissionStatus(
  input: DesktopAnnotationCaptureProviderInput,
  source: ScreenRegionBindingPermissionSource | undefined,
): Promise<ScreenRegionBindingPermissionStatus | undefined> {
  const status = source
    ? typeof source === 'function' ? await source(input) : source
    : undefined;
  return status ?? screenRegionBindingPermissionStatusFromInput(input);
}

async function resolveScreenRegionBindingWindowSource(
  input: DesktopAnnotationCaptureProviderInput,
  source: ScreenRegionBindingWindowSource | undefined,
): Promise<unknown> {
  if (!source) return undefined;
  return typeof source === 'function' ? await source(input) : source;
}

function inputScreenRegionBindingWindowSources(input: DesktopAnnotationCaptureProviderInput): unknown[] {
  const record = input as Record<string, unknown>;
  const metadata = recordOrUndefined(record.metadata);
  const binding = recordOrUndefined(record.windowBinding) ?? recordOrUndefined(metadata?.windowBinding);
  return [
    record.screenRegionBindingWindows,
    record.windowBindingCandidates,
    metadata?.screenRegionBindingWindows,
    metadata?.windowBindingCandidates,
    binding?.candidates,
  ];
}

function screenRegionBindingWindowCandidatesFromUnknown(value: unknown): ScreenRegionBindingWindowCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(screenRegionBindingWindowCandidateFromUnknown)
    .filter((candidate): candidate is ScreenRegionBindingWindowCandidate => Boolean(candidate));
}

function screenRegionBindingWindowCandidateFromUnknown(value: unknown): ScreenRegionBindingWindowCandidate | undefined {
  const record = recordOrUndefined(value);
  if (!record) return undefined;
  const bounds = boundsFromMetadata(record.bounds) ?? boundsFromMetadata(record.windowBounds);
  if (!bounds) return undefined;
  return {
    ...(record as ScreenRegionBindingWindowCandidate),
    bounds,
  };
}

function resolveScreenRegionBindingExcludedOwnerIds(
  input: DesktopAnnotationCaptureProviderInput,
  options: DesktopAnnotationWindowCaptureProviderOptions,
): readonly string[] | undefined {
  const record = input as Record<string, unknown>;
  const metadata = recordOrUndefined(record.metadata);
  const inputOwnerIds = stringArrayFromUnknown(
    record.screenRegionBindingExcludedOwnerIds ?? metadata?.screenRegionBindingExcludedOwnerIds,
  );
  return [
    ...(options.screenRegionBindingExcludedOwnerIds ?? []),
    ...inputOwnerIds,
  ];
}

function screenRegionBindingPermissionStatusFromInput(
  input: DesktopAnnotationCaptureProviderInput,
): ScreenRegionBindingPermissionStatus | undefined {
  const record = input as Record<string, unknown>;
  const metadata = recordOrUndefined(record.metadata);
  return screenRegionBindingPermissionStatusFromUnknown(
    record.screenRegionBindingPermissionStatus ?? metadata?.screenRegionBindingPermissionStatus,
  );
}

function screenRegionBindingPermissionStatusFromUnknown(
  value: unknown,
): ScreenRegionBindingPermissionStatus | undefined {
  return value === 'granted'
    || value === 'prompt'
    || value === 'unknown'
    || value === 'denied'
    || value === 'restricted'
    || value === 'unavailable'
    ? value
    : undefined;
}

function windowSummaryForBinding(
  windowRef: string | undefined,
  windows: readonly ScreenRegionBindingWindowCandidate[],
  options: { includeTitle?: boolean } = {},
): Record<string, unknown> {
  const window = windowRef ? findBindingWindowCandidate(windowRef, windows) : undefined;
  if (!window) return {};
  return {
    ...(boundedText(window.appName ?? window.name ?? window.app) ? { appName: boundedText(window.appName ?? window.name ?? window.app) } : {}),
    ...(boundedText(window.bundleId) ? { bundleId: boundedText(window.bundleId) } : {}),
    ...(finiteNumber(window.pid ?? window.processId) !== undefined ? { pid: Math.trunc(finiteNumber(window.pid ?? window.processId) as number) } : {}),
    ...(options.includeTitle && boundedTitle(window.title ?? window.windowTitle)
      ? { title: boundedTitle(window.title ?? window.windowTitle) }
      : {}),
  };
}

function bindingCandidateMetadata(
  candidate: ScreenRegionAutoBindingCandidateSummary,
  screenBounds: { x: number; y: number; width: number; height: number },
  windows: readonly ScreenRegionBindingWindowCandidate[],
): Record<string, unknown> {
  const summary = windowSummaryForBinding(candidate.windowRef, windows);
  return compactObject({
    windowRef: candidate.windowRef,
    confidence: candidate.score,
    reason: candidate.centerInside ? 'contains selected region center' : 'overlaps selected region',
    windowBounds: { ...candidate.bounds },
    windowLocalBounds: windowLocalBounds(screenBounds, candidate.bounds),
    ...summary,
  });
}

function bindingDiagnosticsMetadata(
  diagnostics: ScreenRegionAutoBindingDiagnostic[],
): Array<Record<string, unknown>> | undefined {
  return diagnostics.length ? diagnostics.map((diagnostic) => compactObject({
    code: diagnostic.code,
    level: diagnostic.level,
    message: diagnostic.message,
    refs: diagnostic.refs,
  })) : undefined;
}

function findBindingWindowCandidate(
  windowRef: string,
  windows: readonly ScreenRegionBindingWindowCandidate[],
): ScreenRegionBindingWindowCandidate | undefined {
  return windows.find((candidate) => candidateRef(candidate) === windowRef);
}

function windowLocalBounds(
  screenBounds: { x: number; y: number; width: number; height: number },
  windowBounds: { x: number; y: number; width: number; height: number },
) {
  return {
    x: roundNumber(screenBounds.x - windowBounds.x),
    y: roundNumber(screenBounds.y - windowBounds.y),
    width: roundNumber(screenBounds.width),
    height: roundNumber(screenBounds.height),
  };
}

function windowSummaryMetadata(input: DesktopAnnotationCaptureProviderInput): Record<string, unknown> {
  const summary = input.windowSummary;
  if (!summary) return {};
  return {
    ...(boundedText(summary.appName) ? { appName: boundedText(summary.appName) } : {}),
    ...(boundedText(summary.bundleId) ? { bundleId: boundedText(summary.bundleId) } : {}),
    ...(typeof summary.pid === 'number' && Number.isFinite(summary.pid) ? { pid: Math.trunc(summary.pid) } : {}),
    ...(boundedText(summary.title) ? { title: boundedText(summary.title) } : {}),
  };
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 160) : undefined;
}

function boundedTitle(value: unknown): string | undefined {
  const title = boundedText(value);
  if (!title || containsSensitiveText(title)) return undefined;
  return title;
}

function containsSensitiveText(value: string): boolean {
  return /data:|base64|secret|token|api[-_\s]?key|password|passwd|bearer|<[^>]*>/i.test(value);
}

function windowCaptureSelectionForAnnotation(
  input: DesktopAnnotationCaptureProviderInput,
  options: DesktopAnnotationWindowCaptureProviderOptions,
): DesktopWindowCaptureSelection {
  const screenId = input.screenId ?? input.displayId ?? options.screenId ?? 'primary';
  const scale = input.scale ?? options.scale ?? 1;
  if (input.windowRef) {
    const windowBounds = input.windowBounds;
    if (!windowBounds) {
      throw new Error('Desktop annotation window capture requires windowBounds for window selections.');
    }
    return {
      kind: 'window',
      selectionSource: 'user',
      windowRef: input.windowRef,
      screenId,
      bounds: cloneBounds(windowBounds),
      scale,
    };
  }
  return {
    kind: 'region',
    selectionSource: 'user',
    regionRef: input.targetRef,
    screenId,
    bounds: cloneBounds(input.screenBounds),
    scale,
  };
}

function cloneBounds(bounds: DesktopAnnotationCaptureProviderInput['screenBounds']): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function ownedAnnotationCaptureRefs(input: DesktopAnnotationCaptureProviderInput) {
  const prefix = `desktop-annotation:workspace/${sanitizeRefSegment(input.workspaceId)}/session/${sanitizeRefSegment(input.sessionId)}/`;
  const captureId = sanitizeRefSegment(input.captureId);
  return {
    prefix,
    screenshotRef: `${prefix}screenshot/${captureId}`,
    cropRef: `${prefix}crop/${captureId}`,
    imageRef: `${prefix}image/${captureId}`,
  };
}

function provenanceRefForWindowCaptureResult(ref: string | null): string | undefined {
  if (!ref) return undefined;
  return ref.includes(':desktop-window-capture:')
    ? ref
    : ref.replace(/^([^:]+):/, '$1:desktop-window-capture:');
}

function diagnosticsWithRefs(
  diagnostics: DesktopWindowCaptureDiagnostic[],
  refs: string[],
): Array<Record<string, unknown>> {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    refs: compactRefs([...(diagnostic.refs ?? []), ...refs]),
  }));
}

function desktopDiagnosticsFromWindowBinding(metadata: Record<string, unknown>): DesktopWindowCaptureDiagnostic[] {
  if (!Array.isArray(metadata.diagnostics)) return [];
  return metadata.diagnostics.flatMap((diagnostic): DesktopWindowCaptureDiagnostic[] => {
    const record = recordOrUndefined(diagnostic);
    if (!record) return [];
    const code = boundedText(record.code);
    const message = boundedText(record.message);
    const level = desktopDiagnosticLevel(record.level);
    if (!code || !message || !level) return [];
    return [{
      code,
      level,
      message,
      refs: stringArrayFromUnknown(record.refs),
    }];
  });
}

function desktopDiagnosticLevel(value: unknown): DesktopWindowCaptureDiagnostic['level'] | undefined {
  return value === 'info' || value === 'warning' || value === 'error' ? value : undefined;
}

function compactRefs(refs: Array<string | undefined>): string[] {
  return Array.from(new Set(refs.filter((ref): ref is string => Boolean(ref))));
}

function bindingWindowRefForMetadata(metadata: Record<string, unknown>): string | undefined {
  return (metadata.status === 'auto-bound' || metadata.status === 'manual-bound') && typeof metadata.windowRef === 'string'
    ? metadata.windowRef
    : undefined;
}

function boundsFromMetadata(value: unknown): { x: number; y: number; width: number; height: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  const width = finiteNumber(record.width);
  const height = finiteNumber(record.height);
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { x, y, width, height };
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function candidateRef(candidate: ScreenRegionBindingWindowCandidate): string | undefined {
  const value = candidate.windowRef ?? candidate.id;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function roundNumber(value: number): number {
  return Number(value.toFixed(6));
}

function compactObject<T extends Record<string, unknown>>(input: T): T {
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}

function sanitizeRefSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '') || 'ref';
}
