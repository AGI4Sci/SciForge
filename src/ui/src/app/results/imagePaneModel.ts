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
  targetRef?: string;
  windowRef?: string;
  browserSessionRef?: string;
  artifactRef?: string;
  redactionRef?: string;
  bounds?: ImageEvidenceBounds;
  cropBounds?: ImageEvidenceBounds;
  status?: ImageEvidenceStatus;
  provenanceRefs?: string[];
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
  return normalizeImageEvidencePayload({
    ref: reference.ref,
    imageRef: reference.ref,
    title: reference.title,
    artifactType: reference.artifactType,
    preferredView: reference.preferredView,
    status: reference.status,
    artifactRef: reference.kind === 'artifact' ? reference.ref : undefined,
    targetRef: reference.provenance?.screenshotRef,
    provenanceRef: reference.provenance?.dataRef,
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
    sha256: normalizedSha256(record.sha256),
    createdAt: firstNonEmptyString(asString(record.createdAt), asString(record.capturedAt), asString(record.timestamp)),
    provenanceRef: evidenceLedgerRef ?? provenanceRefs[0],
    annotationRefs: refList(
      asStringList(record.annotationRefs).map(safeRef),
      asStringList(record.annotationOverlayRefs).map(safeRef),
      asStringList(record.annotationProposalRefs).map(safeRef),
    ),
    targetRef: firstNonEmptyString(
      safeRef(asString(record.targetRef)),
      windowRef,
      safeRef(asString(record.targetAppRef)),
    ),
    windowRef,
    browserSessionRef,
    artifactRef,
    redactionRef: safeRef(asString(record.redactionRef)),
    bounds: imageBounds(record.bounds),
    cropBounds: imageBounds(record.cropBounds) ?? imageBounds(record.crop),
    status: asString(record.status),
    provenanceRefs,
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
    'targetRef',
    'windowRef',
    'browserSessionRef',
    'artifactRef',
    'redactionRef',
    'bounds',
    'cropBounds',
    'status',
  ] as const) {
    const value = payload[key];
    if (value !== undefined) Object.assign(compacted, { [key]: value });
  }
  if (payload.annotationRefs?.length) compacted.annotationRefs = payload.annotationRefs;
  if (payload.provenanceRefs?.length) compacted.provenanceRefs = payload.provenanceRefs;
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

function normalizedSha256(value: unknown) {
  const text = asString(value);
  return text && /^[a-f0-9]{64}$/i.test(text) ? text : undefined;
}

function safeRef(value: string | undefined) {
  if (!value) return undefined;
  const ref = value.trim();
  if (!ref) return undefined;
  if (/^data:/i.test(ref)) return undefined;
  if (/^https?:\/\//i.test(ref)) return undefined;
  if (/^\/api\/.*(?:preview|provider|executor|route)/i.test(ref)) return undefined;
  return ref;
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

function firstNonEmptyString(...values: Array<string | undefined>) {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return undefined;
}
