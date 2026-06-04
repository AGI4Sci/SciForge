export const SCIFORGE_ANNOTATION_REFERENCE_DISPLAY_MODEL =
  'sciforge.annotation-reference.v1' as const;

export const SCIFORGE_ANNOTATION_WINDOW_BINDING_CONTRACT =
  'sciforge.annotation-reference.window-binding.v1' as const;

export const SCIFORGE_ANNOTATION_SOURCE_KINDS = [
  'browser',
  'window',
  'screen-region',
  'image',
] as const;

export const SCIFORGE_ANNOTATION_COORDINATE_SPACES = [
  'browser-viewport',
  'window-local',
  'screen-global',
  'image-local',
] as const;

export const SCIFORGE_ANNOTATION_WINDOW_BINDING_STATUSES = [
  'auto-bound',
  'manual-bound',
  'unbound',
  'blocked',
] as const;

export const SCIFORGE_ANNOTATION_WINDOW_BINDING_HIGH_CONFIDENCE_THRESHOLD = 0.9;
export const SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_CANDIDATES = 5;
export const SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_DIAGNOSTICS = 5;
export const SCIFORGE_ANNOTATION_WINDOW_BINDING_TEXT_MAX_LENGTH = 200;

export type SciForgeAnnotationSourceKind =
  typeof SCIFORGE_ANNOTATION_SOURCE_KINDS[number];

export type SciForgeAnnotationCoordinateSpace =
  typeof SCIFORGE_ANNOTATION_COORDINATE_SPACES[number];

export type SciForgeAnnotationBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SciForgeAnnotationWindowBindingStatus =
  typeof SCIFORGE_ANNOTATION_WINDOW_BINDING_STATUSES[number];

export type SciForgeAnnotationMinimumRefs = {
  annotationRef: string;
  targetRef: string;
  cropRef: string;
  screenshotRef: string;
};

export type SciForgeAnnotationWindowBindingDiagnostic = {
  code: string;
  reason?: string;
  message?: string;
  confidence?: number;
};

export type SciForgeAnnotationWindowBindingCandidate = {
  windowRef: string;
  confidence?: number;
  reason?: string;
  appName?: string;
  bundleId?: string;
  pid?: number;
  title?: string;
  windowBounds?: SciForgeAnnotationBounds;
  windowLocalBounds?: SciForgeAnnotationBounds;
};

export type SciForgeAnnotationWindowBinding = {
  status: SciForgeAnnotationWindowBindingStatus;
  confidence?: number;
  reason?: string;
  targetRef?: string;
  sourceKind?: SciForgeAnnotationSourceKind;
  coordinateSpace?: SciForgeAnnotationCoordinateSpace;
  windowRef?: string;
  appName?: string;
  bundleId?: string;
  pid?: number;
  title?: string;
  screenBounds?: SciForgeAnnotationBounds;
  windowBounds?: SciForgeAnnotationBounds;
  windowLocalBounds?: SciForgeAnnotationBounds;
  displayId?: string;
  screenId?: string;
  scale?: number;
  candidates?: SciForgeAnnotationWindowBindingCandidate[];
  diagnostics?: SciForgeAnnotationWindowBindingDiagnostic[];
};

export type SciForgeAnnotationReferenceMetadata = SciForgeAnnotationMinimumRefs & {
  imageRef?: string;
  sourceKind: SciForgeAnnotationSourceKind;
  coordinateSpace: SciForgeAnnotationCoordinateSpace;
  bounds: SciForgeAnnotationBounds;
  screenBounds?: SciForgeAnnotationBounds;
  windowBounds?: SciForgeAnnotationBounds;
  windowLocalBounds?: SciForgeAnnotationBounds;
  comment?: string;
  createdAt?: string;
  threadId?: string;
  messageDraftId?: string;
  windowRef?: string;
  browserSessionRef?: string;
  actorCursorRef?: string;
  domRef?: string;
  accessibilityRef?: string;
  hash?: string;
  redactionRef?: string;
  windowBinding?: SciForgeAnnotationWindowBinding;
  windowBindingCandidates?: SciForgeAnnotationWindowBindingCandidate[];
};

export function isSciForgeAnnotationSourceKind(value: unknown): value is SciForgeAnnotationSourceKind {
  return typeof value === 'string' && (SCIFORGE_ANNOTATION_SOURCE_KINDS as readonly string[]).includes(value);
}

export function isSciForgeAnnotationCoordinateSpace(value: unknown): value is SciForgeAnnotationCoordinateSpace {
  return typeof value === 'string' && (SCIFORGE_ANNOTATION_COORDINATE_SPACES as readonly string[]).includes(value);
}

export function annotationCoordinateSpaceForSourceKind(
  sourceKind: SciForgeAnnotationSourceKind,
): SciForgeAnnotationCoordinateSpace {
  if (sourceKind === 'browser') return 'browser-viewport';
  if (sourceKind === 'window') return 'window-local';
  if (sourceKind === 'screen-region') return 'screen-global';
  return 'image-local';
}

export function boundedAnnotationWindowBindingCandidates(
  binding: unknown,
): SciForgeAnnotationWindowBindingCandidate[] {
  const candidates = Array.isArray(binding)
    ? binding
    : recordOrUndefined(binding)?.candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates
    .slice(0, SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_CANDIDATES)
    .map(annotationWindowBindingCandidate)
    .filter((candidate): candidate is SciForgeAnnotationWindowBindingCandidate => Boolean(candidate));
}

export function boundedAnnotationWindowBindingDiagnostics(
  binding: unknown,
): SciForgeAnnotationWindowBindingDiagnostic[] {
  const diagnostics = Array.isArray(binding)
    ? binding
    : recordOrUndefined(binding)?.diagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics
    .slice(0, SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_DIAGNOSTICS)
    .map(annotationWindowBindingDiagnostic)
    .filter((diagnostic): diagnostic is SciForgeAnnotationWindowBindingDiagnostic => Boolean(diagnostic));
}

export function compactAnnotationWindowBinding(value: unknown): SciForgeAnnotationWindowBinding | undefined {
  const record = recordOrUndefined(value);
  if (!record) return undefined;
  const status = textOrUndefined(record.status);
  if (!isAnnotationWindowBindingStatus(status)) return undefined;

  const binding = compactObject<SciForgeAnnotationWindowBinding>({
    status,
    confidence: finiteNumber(record.confidence),
    reason: boundedText(record.reason),
    targetRef: safeRef(textOrUndefined(record.targetRef)),
    sourceKind: isSciForgeAnnotationSourceKind(record.sourceKind) ? record.sourceKind : undefined,
    coordinateSpace: isSciForgeAnnotationCoordinateSpace(record.coordinateSpace) ? record.coordinateSpace : undefined,
    windowRef: safeRef(textOrUndefined(record.windowRef)),
    appName: boundedText(firstText(record.appName, record.name)),
    bundleId: boundedText(record.bundleId),
    pid: finiteNumber(record.pid),
    title: boundedText(record.title),
    screenBounds: annotationBounds(record.screenBounds),
    windowBounds: annotationBounds(record.windowBounds),
    windowLocalBounds: annotationBounds(record.windowLocalBounds),
    displayId: boundedText(firstText(record.displayId, record.displayID)),
    screenId: boundedText(firstText(record.screenId, record.displayId, record.displayID)),
    scale: finiteNumber(record.scale),
    candidates: boundedAnnotationWindowBindingCandidates(record),
    diagnostics: boundedAnnotationWindowBindingDiagnostics(record),
  });

  if (!binding.candidates?.length) delete binding.candidates;
  if (!binding.diagnostics?.length) delete binding.diagnostics;
  return binding;
}

export function compactAnnotationReferenceMetadata(input: unknown): SciForgeAnnotationReferenceMetadata | undefined {
  const record = recordOrUndefined(input);
  if (!record) return undefined;

  const annotationRef = safeRef(textOrUndefined(record.annotationRef));
  const targetRef = safeRef(textOrUndefined(record.targetRef));
  const cropRef = safeRef(textOrUndefined(record.cropRef));
  const screenshotRef = safeRef(textOrUndefined(record.screenshotRef));
  if (!annotationRef || !targetRef || !cropRef || !screenshotRef) return undefined;

  const sourceKind = textOrUndefined(record.sourceKind);
  if (!isSciForgeAnnotationSourceKind(sourceKind)) return undefined;
  const coordinateSpace = textOrUndefined(record.coordinateSpace);
  if (!isSciForgeAnnotationCoordinateSpace(coordinateSpace)) return undefined;
  if (coordinateSpace !== annotationCoordinateSpaceForSourceKind(sourceKind)) return undefined;

  const bounds = annotationBounds(record.bounds);
  if (!bounds) return undefined;

  const metadata = compactObject<SciForgeAnnotationReferenceMetadata>({
    annotationRef,
    targetRef,
    cropRef,
    screenshotRef,
    imageRef: safeRef(textOrUndefined(record.imageRef)),
    sourceKind,
    coordinateSpace,
    bounds,
    screenBounds: annotationBounds(record.screenBounds),
    windowBounds: annotationBounds(record.windowBounds),
    windowLocalBounds: annotationBounds(record.windowLocalBounds),
    comment: boundedText(record.comment, 2_000),
    createdAt: boundedText(record.createdAt),
    threadId: boundedText(record.threadId),
    messageDraftId: boundedText(record.messageDraftId),
    windowRef: safeRef(textOrUndefined(record.windowRef)),
    browserSessionRef: safeRef(textOrUndefined(record.browserSessionRef)),
    actorCursorRef: safeRef(textOrUndefined(record.actorCursorRef)),
    domRef: safeRef(textOrUndefined(record.domRef)),
    accessibilityRef: safeRef(textOrUndefined(record.accessibilityRef)),
    hash: boundedText(record.hash),
    redactionRef: safeRef(textOrUndefined(record.redactionRef)),
    windowBinding: compactAnnotationWindowBinding(record.windowBinding),
    windowBindingCandidates: boundedAnnotationWindowBindingCandidates(record.windowBindingCandidates),
  });

  if (!metadata.windowBindingCandidates?.length) delete metadata.windowBindingCandidates;
  return metadata;
}

export function isAnnotationWindowBindingOperationTarget(
  binding: SciForgeAnnotationWindowBinding | undefined,
  options: { highConfidenceThreshold?: number } = {},
): boolean {
  if (!binding?.windowRef) return false;
  if (binding.status === 'manual-bound') return true;
  if (binding.status !== 'auto-bound') return false;
  return Number(binding.confidence) >= (
    options.highConfidenceThreshold ?? SCIFORGE_ANNOTATION_WINDOW_BINDING_HIGH_CONFIDENCE_THRESHOLD
  );
}

export function isAnnotationReferenceWindowOperationTarget(
  metadata: SciForgeAnnotationReferenceMetadata,
  options: { highConfidenceThreshold?: number } = {},
): boolean {
  const binding = metadata.windowBinding;
  if (metadata.sourceKind === 'window') {
    return binding?.status === 'manual-bound' && isAnnotationWindowBindingOperationTarget(binding, options);
  }
  if (metadata.sourceKind === 'screen-region') {
    return binding?.status === 'auto-bound' && isAnnotationWindowBindingOperationTarget(binding, options);
  }
  return false;
}

function isAnnotationWindowBindingStatus(value: unknown): value is SciForgeAnnotationWindowBindingStatus {
  return typeof value === 'string' && (SCIFORGE_ANNOTATION_WINDOW_BINDING_STATUSES as readonly string[]).includes(value);
}

function annotationWindowBindingCandidate(value: unknown): SciForgeAnnotationWindowBindingCandidate | undefined {
  const record = recordOrUndefined(value);
  if (!record) return undefined;
  const windowRef = safeRef(textOrUndefined(record.windowRef));
  if (!windowRef) return undefined;
  return compactObject<SciForgeAnnotationWindowBindingCandidate>({
    windowRef,
    confidence: finiteNumber(record.confidence),
    reason: boundedText(record.reason),
    appName: boundedText(firstText(record.appName, record.name)),
    bundleId: boundedText(record.bundleId),
    pid: finiteNumber(record.pid),
    title: boundedText(record.title),
    windowBounds: annotationBounds(record.windowBounds),
    windowLocalBounds: annotationBounds(record.windowLocalBounds),
  });
}

function annotationWindowBindingDiagnostic(value: unknown): SciForgeAnnotationWindowBindingDiagnostic | undefined {
  const record = recordOrUndefined(value);
  if (!record) return undefined;
  const code = boundedText(record.code, 80);
  if (!code) return undefined;
  return compactObject<SciForgeAnnotationWindowBindingDiagnostic>({
    code,
    reason: boundedText(record.reason),
    message: boundedText(record.message),
    confidence: finiteNumber(record.confidence),
  });
}

function annotationBounds(value: unknown): SciForgeAnnotationBounds | undefined {
  const record = recordOrUndefined(value);
  if (!record) return undefined;
  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  const width = finiteNumber(record.width);
  const height = finiteNumber(record.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height };
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = textOrUndefined(value);
    if (text) return text;
  }
  return undefined;
}

function boundedText(value: unknown, maxLength = SCIFORGE_ANNOTATION_WINDOW_BINDING_TEXT_MAX_LENGTH): string | undefined {
  const text = textOrUndefined(value);
  if (!text) return undefined;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function safeRef(value: string | undefined): string | undefined {
  const ref = value?.trim();
  if (!ref) return undefined;
  if (/^data:/i.test(ref)) return undefined;
  if (/^https?:\/\//i.test(ref)) return undefined;
  return ref;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function compactObject<T extends Record<string, unknown>>(input: T): T {
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}
