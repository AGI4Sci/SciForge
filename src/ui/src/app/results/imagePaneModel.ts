import type { ObjectReference, RuntimeArtifact, SciForgeRun, SciForgeSession } from '../../domain';
import {
  asNumber,
  asString,
  asStringList,
  isRecord,
} from './resultArtifactHelpers';
import { artifactsForRun } from './executionUnitsForRun';

export const IMAGE_EVIDENCE_SOURCE_KINDS = [
  'annotation-crop',
  'screenshot',
  'browser-evidence',
  'window-capture',
  'screen-region',
  'artifact',
  'replay',
] as const;

export type ImageEvidenceSourceKind = typeof IMAGE_EVIDENCE_SOURCE_KINDS[number];
export type ImageEvidenceStatus = 'ready' | 'processing' | 'blocked' | 'error' | 'empty' | string;

export interface ImageEvidenceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageEvidenceDomTarget {
  selector?: string;
  stableSelector?: string;
  domPath?: string;
  role?: string;
  label?: string;
  textSnippet?: string;
  rect?: ImageEvidenceBounds;
}

export type ImageEvidenceWindowBindingStatus = 'auto-bound' | 'manual-bound' | 'unbound' | 'blocked';

export interface ImageEvidenceWindowBindingCandidate {
  windowRef?: string;
  appName?: string;
  bundleId?: string;
  pid?: number;
  title?: string;
  confidence?: number;
  reason?: string;
  windowBounds?: ImageEvidenceBounds;
  windowLocalBounds?: ImageEvidenceBounds;
}

export interface ImageEvidenceWindowBinding extends ImageEvidenceWindowBindingCandidate {
  status: ImageEvidenceWindowBindingStatus;
  candidates?: ImageEvidenceWindowBindingCandidate[];
}

export interface ImageEvidencePayload {
  sourceKind: ImageEvidenceSourceKind;
  imageRef: string;
  ref: string;
  mime?: string;
  width?: number;
  height?: number;
  sha256?: string;
  createdAt?: string;
  provenanceRef?: string;
  annotationRefs?: string[];
  beforeScreenshotRef?: string;
  afterScreenshotRef?: string;
  artifactPreviewRef?: string;
  actionTimelineRefs?: string[];
  targetRef?: string;
  windowRef?: string;
  browserSessionRef?: string;
  artifactRef?: string;
  redactionRef?: string;
  bounds?: ImageEvidenceBounds;
  cropBounds?: ImageEvidenceBounds;
  domTarget?: ImageEvidenceDomTarget;
  selector?: string;
  domPath?: string;
  selectedText?: string;
  screenBounds?: ImageEvidenceBounds;
  windowBounds?: ImageEvidenceBounds;
  windowLocalBounds?: ImageEvidenceBounds;
  displayId?: string;
  scale?: number;
  status?: ImageEvidenceStatus;
  provenanceRefs?: string[];
  windowBinding?: ImageEvidenceWindowBinding;
}

export function rightPaneImageEvidencePayload(
  session: SciForgeSession,
  activeRun: SciForgeRun | undefined,
  focusedObjectReference?: ObjectReference,
): ImageEvidencePayload | undefined {
  const focusedPayload = imageEvidencePayloadFromObjectReference(focusedObjectReference);
  if (focusedPayload) return focusedPayload;
  const artifacts = activeRun ? artifactsForRun(session, activeRun) : session.artifacts;
  return artifacts
    .map(imageEvidencePayloadFromArtifact)
    .find((payload): payload is ImageEvidencePayload => Boolean(payload));
}

export function imageEvidencePayloadFromObjectReference(reference: ObjectReference | undefined): ImageEvidencePayload | undefined {
  if (!reference) return undefined;
  const focusedScreenshotRef = focusedObjectScreenshotRef(reference.provenance?.screenshotRef);
  const focusedImageRef = focusedScreenshotRef
    ?? genericImagePreviewRefForObjectReference(reference)
    ?? imageEvidenceRefForObjectReference(reference.ref)
    ?? imageArtifactRefFallback(reference);
  if (!focusedImageRef) return undefined;
  return normalizeImageEvidencePayload({
    ref: focusedImageRef,
    imageRef: focusedImageRef,
    title: reference.title,
    artifactType: reference.artifactType,
    preferredView: reference.preferredView,
    status: reference.status,
    artifactRef: reference.kind === 'artifact' ? reference.ref : undefined,
    targetRef: focusedScreenshotRef ? reference.ref : reference.provenance?.screenshotRef,
    provenanceRef: reference.provenance?.dataRef ?? reference.provenance?.path,
    sha256: reference.provenance?.hash,
  });
}

export function imageEvidencePayloadFromArtifact(artifact: RuntimeArtifact): ImageEvidencePayload | undefined {
  const data = isRecord(artifact.data) ? artifact.data : {};
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return normalizeImageEvidencePayload({
    ...metadata,
    ...data,
    artifactType: artifact.type,
    producerScenario: artifact.producerScenario,
    artifactRef: firstNonEmptyString(
      safeRef(asString(data.artifactRef)),
      safeRef(asString(metadata.artifactRef)),
      artifact.id ? `artifact:${artifact.id}` : undefined,
    ),
    dataRef: artifact.dataRef,
    deliveryRef: artifact.delivery?.readableRef,
  });
}

export function normalizeImageEvidencePayload(input: unknown): ImageEvidencePayload | undefined {
  const record = isRecord(input) ? input : {};
  const frameRecord = firstFrameEvidenceRecord(record);
  const frameDimensions = isRecord(frameRecord?.dimensions) ? frameRecord.dimensions : {};
  const screenDimensions = isRecord(record.screen) ? record.screen : {};
  const dimensions = isRecord(record.dimensions) ? record.dimensions : {};
  const displayRecord = isRecord(record.display) ? record.display : {};
  const imageRef = firstNonEmptyString(
    safeRef(asString(record.imageRef)),
    safeRef(asString(record.ref)),
    safeRef(asString(record.screenshotRef)),
    safeRef(asString(record.currentFrameRef)),
    safeRef(asString(record.frameRef)),
    safeRef(asString(frameRecord?.imageRef)),
    safeRef(asString(frameRecord?.ref)),
    safeRef(asString(frameRecord?.screenshotRef)),
    safeRef(asString(frameRecord?.currentFrameRef)),
    safeRef(asString(frameRecord?.frameRef)),
    safeRef(asString(record.currentImageRef)),
    safeRef(asString(record.cropRef)),
    safeRef(asString(record.previewRef)),
    safeRef(asString(record.beforeFrameRef)),
    safeRef(asString(record.afterFrameRef)),
  );
  if (!imageRef) return undefined;

  const replayRef = safeRef(asString(record.replayRef));
  const beforeScreenshotRef = firstNonEmptyString(
    safeRef(asString(record.beforeScreenshotRef)),
    safeRef(asString(record.beforeFrameRef)),
    safeRef(asString(record.beforeImageRef)),
    safeRef(asString(frameRecord?.beforeScreenshotRef)),
    safeRef(asString(frameRecord?.beforeFrameRef)),
    safeRef(asString(frameRecord?.beforeImageRef)),
  );
  const afterScreenshotRef = firstNonEmptyString(
    safeRef(asString(record.afterScreenshotRef)),
    safeRef(asString(record.afterFrameRef)),
    safeRef(asString(record.afterImageRef)),
    safeRef(asString(frameRecord?.afterScreenshotRef)),
    safeRef(asString(frameRecord?.afterFrameRef)),
    safeRef(asString(frameRecord?.afterImageRef)),
  );
  const artifactPreviewRef = firstNonEmptyString(
    safeRef(asString(record.artifactPreviewRef)),
    safeRef(asString(record.artifactPreviewImageRef)),
    safeRef(asString(record.previewArtifactRef)),
  );
  const actionTimelineRefs = refList(
    asStringList(record.actionTimelineRefs).map(safeRef),
    asStringList(record.timelineRefs).map(safeRef),
    asStringList(record.actionRefs).map(safeRef),
    refsFromRecordList(record.actionTimeline, ['ref', 'timelineRef', 'actionRef', 'eventRef']),
    refsFromRecordList(record.actionTimelineItems, ['ref', 'timelineRef', 'actionRef', 'eventRef']),
    refsFromRecordList(record.actions, ['ref', 'actionRef', 'timelineRef', 'eventRef']),
    refsFromRecordList(record.events, ['ref', 'eventRef', 'timelineRef', 'actionRef']),
  );
  const evidenceLedgerRef = safeRef(firstNonEmptyString(
    asString(record.provenanceRef),
    asString(record.evidenceLedgerRef),
    asString(record.evidenceRef),
    asString(record.ledgerRef),
  ));
  const provenanceRefs = refList(
    replayRef,
    evidenceLedgerRef,
    safeRef(asString(record.domSnapshotRef)),
    safeRef(asString(record.axSnapshotRef)),
    safeRef(asString(record.frameStreamRef)),
    safeRef(asString(record.frameDataRef)),
    safeRef(asString(frameRecord?.frameDataRef)),
    safeRef(asString(frameRecord?.beforeEvidenceRef)),
    safeRef(asString(frameRecord?.afterEvidenceRef)),
    asStringList(record.provenanceRefs).map(safeRef),
    asStringList(record.verificationRefs).map(safeRef),
  );
  const browserSessionRef = firstNonEmptyString(
    safeRef(asString(record.browserSessionRef)),
    safeRef(asString(record.browserHostSessionRef)),
  );
  const windowRef = firstNonEmptyString(
    safeRef(asString(record.windowRef)),
    safeRef(asString(record.targetWindowRef)),
  );
  const windowBinding = imageWindowBinding(record.windowBinding);
  const boundWindowRef = windowBinding && isBoundWindowBindingStatus(windowBinding.status)
    ? windowBinding.windowRef
    : undefined;
  const boundWindowBounds = windowBinding && isBoundWindowBindingStatus(windowBinding.status)
    ? windowBinding.windowBounds
    : undefined;
  const boundWindowLocalBounds = windowBinding && isBoundWindowBindingStatus(windowBinding.status)
    ? windowBinding.windowLocalBounds
    : undefined;
  const artifactRef = firstNonEmptyString(
    safeRef(asString(record.artifactRef)),
    safeRef(asString(record.artifactPreviewRef)),
  );
  const payload: ImageEvidencePayload = {
    sourceKind: imageEvidenceSourceKind(record),
    imageRef,
    ref: imageRef,
    mime: firstNonEmptyString(asString(record.mime), asString(record.mimeType), asString(record.contentType)),
    width: asNumber(record.width) ?? asNumber(dimensions.width) ?? asNumber(frameRecord?.width) ?? asNumber(frameDimensions.width) ?? asNumber(screenDimensions.width),
    height: asNumber(record.height) ?? asNumber(dimensions.height) ?? asNumber(frameRecord?.height) ?? asNumber(frameDimensions.height) ?? asNumber(screenDimensions.height),
    sha256: normalizedSha256(firstNonEmptyString(asString(record.sha256), asString(record.hash))),
    createdAt: firstNonEmptyString(asString(record.createdAt), asString(record.capturedAt), asString(record.timestamp)),
    provenanceRef: evidenceLedgerRef ?? provenanceRefs[0],
    annotationRefs: refList(
      asStringList(record.annotationRefs).map(safeRef),
      asStringList(record.annotationOverlayRefs).map(safeRef),
      asStringList(record.annotationProposalRefs).map(safeRef),
    ),
    beforeScreenshotRef,
    afterScreenshotRef,
    artifactPreviewRef,
    actionTimelineRefs,
    targetRef: firstNonEmptyString(
      safeRef(asString(record.targetRef)),
      windowRef,
      boundWindowRef,
      safeRef(asString(record.targetAppRef)),
    ),
    windowRef: windowRef ?? boundWindowRef,
    browserSessionRef,
    artifactRef,
    redactionRef: safeRef(asString(record.redactionRef)),
    bounds: imageBounds(record.bounds),
    cropBounds: imageBounds(record.cropBounds) ?? imageBounds(record.crop),
    domTarget: imageDomTarget(record.domTarget),
    selector: boundedString(record.selector),
    domPath: boundedString(record.domPath),
    selectedText: boundedString(record.selectedText),
    screenBounds: imageBounds(record.screenBounds),
    windowBounds: imageBounds(record.windowBounds) ?? boundWindowBounds,
    windowLocalBounds: imageBounds(record.windowLocalBounds) ?? boundWindowLocalBounds,
    displayId: firstNonEmptyString(
      asString(record.displayId),
      asString(record.screenId),
      asString(displayRecord.id),
    ),
    scale: asNumber(record.scale) ?? asNumber(record.displayScale) ?? asNumber(record.devicePixelRatio),
    status: asString(record.status),
    provenanceRefs,
    windowBinding,
  };
  return compactImageEvidencePayload(payload);
}

function firstFrameEvidenceRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const key of ['currentFrame', 'frame', 'latestFrame']) {
    const value = record[key];
    if (isRecord(value)) return value;
  }
  for (const key of ['frames', 'frameRefs', 'beforeAfterFrameRefs']) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (isRecord(item)) return item;
      const ref = safeRef(asString(item));
      if (ref) return { ref };
    }
  }
  return undefined;
}

function compactImageEvidencePayload(payload: ImageEvidencePayload): ImageEvidencePayload {
  const compacted: ImageEvidencePayload = {
    sourceKind: payload.sourceKind,
    imageRef: payload.imageRef,
    ref: payload.ref,
  };
  for (const key of [
    'mime',
    'width',
    'height',
    'sha256',
    'createdAt',
    'provenanceRef',
    'beforeScreenshotRef',
    'afterScreenshotRef',
    'artifactPreviewRef',
    'targetRef',
    'windowRef',
    'browserSessionRef',
    'artifactRef',
    'redactionRef',
    'bounds',
    'cropBounds',
    'domTarget',
    'selector',
    'domPath',
    'selectedText',
    'screenBounds',
    'windowBounds',
    'windowLocalBounds',
    'displayId',
    'scale',
    'status',
  ] as const) {
    const value = payload[key];
    if (value !== undefined) Object.assign(compacted, { [key]: value });
  }
  if (payload.annotationRefs?.length) compacted.annotationRefs = payload.annotationRefs;
  if (payload.actionTimelineRefs?.length) compacted.actionTimelineRefs = payload.actionTimelineRefs;
  if (payload.provenanceRefs?.length) compacted.provenanceRefs = payload.provenanceRefs;
  if (payload.windowBinding) compacted.windowBinding = payload.windowBinding;
  return compacted;
}

function imageEvidenceSourceKind(record: Record<string, unknown>): ImageEvidenceSourceKind {
  const explicit = asString(record.sourceKind);
  if (explicit && isImageEvidenceSourceKind(explicit)) return explicit;
  const haystack = [
    record.type,
    record.artifactType,
    record.producerScenario,
    record.preferredView,
    record.source,
    record.kind,
  ].map((value) => asString(value) ?? '').join(' ');
  if (/\b(annotation|crop)\b/i.test(haystack)) return 'annotation-crop';
  if (/\b(browser|webpage|web-page|dom-snapshot)\b/i.test(haystack)) return 'browser-evidence';
  if (/\b(window)\b/i.test(haystack)) return 'window-capture';
  if (/\b(region)\b/i.test(haystack)) return 'screen-region';
  if (/\b(artifact|preview|figure|plot|image-preview)\b/i.test(haystack)) return 'artifact';
  if (safeRef(asString(record.replayRef)) || /\b(replay|computer-use|virtual-screen|desktop-frame)\b/i.test(haystack)) return 'replay';
  return 'screenshot';
}

function isImageEvidenceSourceKind(value: string): value is ImageEvidenceSourceKind {
  return (IMAGE_EVIDENCE_SOURCE_KINDS as readonly string[]).includes(value);
}

function imageBounds(value: unknown): ImageEvidenceBounds | undefined {
  if (!isRecord(value)) return undefined;
  const x = asNumber(value.x);
  const y = asNumber(value.y);
  const width = asNumber(value.width);
  const height = asNumber(value.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height };
}

function imageDomTarget(value: unknown): ImageEvidenceDomTarget | undefined {
  if (!isRecord(value)) return undefined;
  const target: ImageEvidenceDomTarget = {};
  for (const key of ['selector', 'stableSelector', 'domPath', 'role', 'label', 'textSnippet'] as const) {
    const text = boundedString(value[key]);
    if (text !== undefined) Object.assign(target, { [key]: text });
  }
  const rect = imageBounds(value.rect);
  if (rect) target.rect = rect;
  return Object.keys(target).length ? target : undefined;
}

function imageWindowBinding(value: unknown): ImageEvidenceWindowBinding | undefined {
  if (!isRecord(value)) return undefined;
  const status = asString(value.status);
  if (!status || !isWindowBindingStatus(status)) return undefined;
  const binding = imageWindowBindingSummary(value, { includeWindowRef: isBoundWindowBindingStatus(status) });
  const candidates = boundedWindowBindingCandidates(value.candidates);
  return compactWindowBinding({
    status,
    ...binding,
    ...(candidates.length ? { candidates } : {}),
  });
}

function boundedWindowBindingCandidates(value: unknown): ImageEvidenceWindowBindingCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 5)
    .map((candidate) => imageWindowBindingSummary(candidate, { includeWindowRef: true }))
    .filter((candidate): candidate is ImageEvidenceWindowBindingCandidate => Boolean(candidate));
}

function imageWindowBindingSummary(
  value: unknown,
  options: { includeWindowRef: boolean },
): ImageEvidenceWindowBindingCandidate | undefined {
  if (!isRecord(value)) return undefined;
  const summary = compactWindowBindingCandidate({
    windowRef: options.includeWindowRef ? safeRef(asString(value.windowRef)) : undefined,
    appName: firstNonEmptyString(asString(value.appName), asString(value.name)),
    bundleId: asString(value.bundleId),
    pid: asNumber(value.pid),
    title: asString(value.title),
    confidence: asNumber(value.confidence),
    reason: asString(value.reason),
    windowBounds: imageBounds(value.windowBounds),
    windowLocalBounds: imageBounds(value.windowLocalBounds),
  });
  return Object.keys(summary).length ? summary : undefined;
}

function compactWindowBinding(binding: ImageEvidenceWindowBinding): ImageEvidenceWindowBinding {
  return compactWindowBindingCandidate(binding) as ImageEvidenceWindowBinding;
}

function compactWindowBindingCandidate(
  candidate: ImageEvidenceWindowBindingCandidate | ImageEvidenceWindowBinding,
): ImageEvidenceWindowBindingCandidate | ImageEvidenceWindowBinding {
  const compacted: ImageEvidenceWindowBindingCandidate | ImageEvidenceWindowBinding =
    'status' in candidate ? { status: candidate.status } : {};
  for (const key of [
    'windowRef',
    'appName',
    'bundleId',
    'pid',
    'title',
    'confidence',
    'reason',
    'windowBounds',
    'windowLocalBounds',
  ] as const) {
    const value = candidate[key];
    if (value !== undefined) Object.assign(compacted, { [key]: value });
  }
  if ('candidates' in candidate && candidate.candidates?.length) {
    Object.assign(compacted, { candidates: candidate.candidates });
  }
  return compacted;
}

const WINDOW_BINDING_STATUSES = ['auto-bound', 'manual-bound', 'unbound', 'blocked'] as const;

function isWindowBindingStatus(value: string): value is ImageEvidenceWindowBindingStatus {
  return (WINDOW_BINDING_STATUSES as readonly string[]).includes(value);
}

function isBoundWindowBindingStatus(value: ImageEvidenceWindowBindingStatus) {
  return value === 'auto-bound' || value === 'manual-bound';
}

function normalizedSha256(value: unknown) {
  const text = asString(value)?.trim();
  const hash = text?.replace(/^sha256:/i, '');
  return hash && /^[a-f0-9]{64}$/i.test(hash) ? hash.toLowerCase() : undefined;
}

function boundedString(value: unknown, maxLength = 500) {
  const text = asString(value)?.trim();
  if (!text) return undefined;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function safeRef(value: string | undefined) {
  if (!value) return undefined;
  const ref = value.trim();
  if (!ref) return undefined;
  if (ref.length > 500) return undefined;
  const lower = ref.toLowerCase();
  if (/^data:/i.test(ref)) return undefined;
  if (/^https?:\/\//i.test(ref)) return undefined;
  if (/^(?:blob|file|javascript):/i.test(ref)) return undefined;
  if (/^\/api\/.*(?:preview|provider|executor|route)/i.test(ref)) return undefined;
  if (
    lower.includes('base64') ||
    lower.includes('rawscreenshot') ||
    lower.includes('raw_screenshot') ||
    lower.includes('rawprovider') ||
    lower.includes('providerpayload') ||
    lower.includes('provider-payload') ||
    lower.includes('stdout') ||
    lower.includes('stderr') ||
    lower.includes('<html') ||
    lower.includes('authorization') ||
    lower.includes('bearer') ||
    lower.includes('api-key') ||
    lower.includes('apikey') ||
    lower.includes('password') ||
    lower.includes('secret') ||
    lower.includes('token')
  ) return undefined;
  return ref;
}

function genericImagePreviewRefForObjectReference(reference: ObjectReference) {
  return [
    reference.provenance?.path,
    reference.provenance?.dataRef,
    reference.ref,
    reference.title,
  ]
    .map(safeRef)
    .find(isImageFileRef);
}

function imageEvidenceRefForObjectReference(value: string | undefined) {
  const ref = safeRef(value);
  if (!ref) return undefined;
  return /^(?:image|image-evidence|screenshot|annotation|crop|browser-evidence|window-capture|screen-region|screen|virtual-app-screen):/i.test(ref)
    || /^computer-use:frames?/i.test(ref)
    ? ref
    : undefined;
}

function imageArtifactRefFallback(reference: ObjectReference) {
  const ref = safeRef(reference.ref);
  if (!ref || !isImageLikeObjectReference(reference)) return undefined;
  return ref;
}

function isImageLikeObjectReference(reference: ObjectReference) {
  const haystack = [
    reference.artifactType,
    reference.preferredView,
    reference.title,
    reference.summary,
    reference.ref,
  ].filter(Boolean).join(' ');
  return /\b(?:uploaded-image|image|image-evidence|screenshot|annotation|crop|browser-evidence|window-capture|screen-region|artifact-preview|replay-frame)\b/i.test(haystack)
    || isImageFileRef(reference.provenance?.path)
    || isImageFileRef(reference.provenance?.dataRef)
    || isImageFileRef(reference.ref);
}

function isImageFileRef(value: string | undefined) {
  if (!value) return false;
  const text = value.replace(/^file::?/i, '').trim();
  return /\.(?:png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(text);
}

function focusedObjectScreenshotRef(value: string | undefined) {
  const ref = safeRef(value);
  if (!ref) return undefined;
  if (/^feedback-bundle:[^#?]+\/screenshots\/[^#?]+\.(?:png|jpe?g|webp)$/i.test(ref)) return ref;
  if (/^desktop-annotation:workspace\/[^#?]+\/session\/[^#?]+\/(?:screenshot|image|crop)\/[^#?]+$/i.test(ref)) return ref;
  return undefined;
}

function refList(...values: Array<string | undefined | Array<string | undefined>>): string[] {
  const refs: string[] = [];
  for (const value of values) {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      const ref = safeRef(entry);
      if (ref) refs.push(ref);
    }
  }
  return Array.from(new Set(refs));
}

function refsFromRecordList(value: unknown, keys: string[]) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === 'string') {
      const ref = safeRef(entry);
      return ref ? [ref] : [];
    }
    if (!isRecord(entry)) return [];
    for (const key of keys) {
      const ref = safeRef(asString(entry[key]));
      if (ref) return [ref];
    }
    return [];
  });
}

function firstNonEmptyString(...values: Array<string | undefined>) {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return undefined;
}
