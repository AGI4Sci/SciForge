import type { ObjectReference, ObjectReferenceKind, SciForgeReference, SciForgeReferenceKind } from '../../domain';
import {
  appendReferenceMarkerToInput,
  removeReferenceMarkerFromInput,
  referenceComposerMarker,
  referenceForObjectReference,
  withComposerMarker,
} from '../../../../../packages/support/object-references';

const MAX_COMPOSER_REFERENCES = 8;

export { appendReferenceMarkerToInput, removeReferenceMarkerFromInput, referenceComposerMarker, withComposerMarker };

export type ComposerPendingContextKind = 'annotation' | 'image' | 'reference';

export interface ComposerPendingContextItem {
  id: string;
  title: string;
  ref: string;
  marker: string;
  kind: ComposerPendingContextKind;
  previewRef?: string;
  reference: SciForgeReference;
  objectReference?: ObjectReference;
}

export function composerReferenceForObjectReference(
  objectReference: ObjectReference,
  kind?: SciForgeReferenceKind,
): SciForgeReference {
  return withCurrentObjectReferencePayload(referenceForObjectReference(objectReference, kind), objectReference);
}

export function withCurrentObjectReferencePayload(
  reference: SciForgeReference,
  objectReference: ObjectReference,
): SciForgeReference {
  const payload = isRecord(reference.payload) ? reference.payload : {};
  return {
    ...reference,
    title: objectReference.title || reference.title,
    ref: objectReference.ref || reference.ref,
    sourceId: objectReference.id || reference.sourceId,
    runId: objectReference.runId ?? reference.runId,
    payload: {
      ...payload,
      currentReference: objectReference,
      objectReference,
    },
  };
}

export function currentObjectReferenceFromComposerReference(reference: SciForgeReference): ObjectReference | undefined {
  const payload = isRecord(reference.payload) ? reference.payload : undefined;
  const currentReference = payload?.currentReference ?? payload?.objectReference;
  return isObjectReference(currentReference) ? currentReference : undefined;
}

export function withInferredCurrentObjectReference(reference: SciForgeReference): SciForgeReference {
  if (currentObjectReferenceFromComposerReference(reference)) return reference;
  const objectReference = inferredObjectReferenceForComposerReference(reference);
  return objectReference ? withCurrentObjectReferencePayload(reference, objectReference) : reference;
}

export function addPendingComposerReference(
  current: SciForgeReference[],
  reference: SciForgeReference,
  limit = MAX_COMPOSER_REFERENCES,
) {
  const referenceKey = composerReferenceIdentityKey(reference);
  if (current.some((item) => item.id === reference.id || composerReferenceIdentityKey(item) === referenceKey)) return current;
  return [...current, reference].slice(0, limit);
}

export function composerPendingContextItems(references: SciForgeReference[]): ComposerPendingContextItem[] {
  return references.map((reference) => {
    const normalized = withInferredCurrentObjectReference(reference);
    const objectReference = currentObjectReferenceFromComposerReference(normalized);
    return {
      id: reference.id,
      title: objectReference?.title || reference.title,
      ref: objectReference?.ref || reference.ref,
      marker: referenceComposerMarker(reference),
      kind: pendingContextKindForReference(normalized, objectReference),
      previewRef: pendingContextPreviewRef(normalized, objectReference),
      reference: normalized,
      objectReference,
    };
  });
}

export function addComposerReferenceWithMarker({
  input,
  pendingReferences,
  reference,
}: {
  input: string;
  pendingReferences: SciForgeReference[];
  reference: SciForgeReference;
}) {
  const referenceWithMarker = withComposerMarker(withInferredCurrentObjectReference(reference), pendingReferences);
  return {
    input: appendReferenceMarkerToInput(input, referenceWithMarker),
    pendingReferences: addPendingComposerReference(pendingReferences, referenceWithMarker),
    reference: referenceWithMarker,
  };
}

export function removeComposerReference({
  input,
  pendingReferences,
  referenceId,
}: {
  input: string;
  pendingReferences: SciForgeReference[];
  referenceId: string;
}) {
  const reference = pendingReferences.find((item) => item.id === referenceId);
  const nextReferences = pendingReferences.filter((item) => item.id !== referenceId);
  return {
    input: reference ? removeReferenceMarkerFromInput(input, reference) : input,
    pendingReferences: nextReferences,
    removedReference: reference,
  };
}

export function promptForComposerSend(input: string, pendingReferences: SciForgeReference[]) {
  return input.trim() || (pendingReferences.length ? '请基于已引用对象继续分析。' : '');
}

function isObjectReference(value: unknown): value is ObjectReference {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.kind === 'string'
    && typeof value.ref === 'string';
}

function inferredObjectReferenceForComposerReference(reference: SciForgeReference): ObjectReference | undefined {
  const pendingContextObjectReference = inferredPendingContextObjectReference(reference);
  if (pendingContextObjectReference) return pendingContextObjectReference;
  const kind = objectReferenceKindFromRef(reference.ref);
  if (!kind) return undefined;
  const payload = isRecord(reference.payload) ? reference.payload : {};
  const provenance = isRecord(payload.provenance) ? payload.provenance : {};
  return {
    id: reference.sourceId || reference.id,
    title: reference.title || reference.ref,
    kind,
    ref: reference.ref,
    artifactType: typeof payload.artifactType === 'string' ? payload.artifactType : undefined,
    runId: reference.runId,
    preferredView: typeof payload.preferredView === 'string' ? payload.preferredView : undefined,
    status: typeof payload.status === 'string' ? payload.status as ObjectReference['status'] : undefined,
    summary: reference.summary,
    provenance: {
      dataRef: typeof payload.dataRef === 'string' ? payload.dataRef : typeof provenance.dataRef === 'string' ? provenance.dataRef : undefined,
      path: typeof payload.path === 'string' ? payload.path : typeof provenance.path === 'string' ? provenance.path : undefined,
      producer: typeof provenance.producer === 'string' ? provenance.producer : undefined,
      version: typeof provenance.version === 'string' ? provenance.version : undefined,
      hash: typeof provenance.hash === 'string' ? provenance.hash : undefined,
      size: typeof provenance.size === 'number' ? provenance.size : undefined,
      screenshotRef: typeof provenance.screenshotRef === 'string' ? provenance.screenshotRef : undefined,
    },
  };
}

function inferredPendingContextObjectReference(reference: SciForgeReference): ObjectReference | undefined {
  const payload = isRecord(reference.payload) ? reference.payload : {};
  const kind = pendingContextKindForReference(reference);
  if (kind === 'reference') return undefined;
  const path = stringField(payload.path);
  const dataRef = stringField(payload.dataRef)
    ?? stringField(payload.annotationRef)
    ?? stringField(payload.imageRef)
    ?? (kind === 'annotation' ? reference.ref : path ?? reference.ref);
  const screenshotRef = stringField(payload.screenshotRef)
    ?? (kind === 'image' && /^screenshot:/i.test(reference.ref) ? reference.ref : undefined);
  return {
    id: reference.sourceId || `object-${reference.id}`,
    title: reference.title || reference.ref,
    kind: 'artifact',
    ref: reference.ref,
    artifactType: kind,
    runId: reference.runId,
    preferredView: kind === 'annotation' ? 'image-evidence' : 'preview',
    presentationRole: 'supporting-evidence',
    status: 'available',
    summary: reference.summary,
    provenance: {
      dataRef,
      path,
      producer: stringField(payload.source) ?? stringField(payload.sourceKind) ?? stringField(payload.producer),
      screenshotRef,
    },
  };
}

function pendingContextKindForReference(
  reference: SciForgeReference,
  objectReference?: ObjectReference,
): ComposerPendingContextKind {
  const payload = isRecord(reference.payload) ? reference.payload : {};
  const haystack = [
    reference.ref,
    reference.kind,
    reference.title,
    reference.summary,
    objectReference?.ref,
    objectReference?.artifactType,
    objectReference?.preferredView,
    stringField(payload.annotationRef),
    stringField(payload.cropRef),
    stringField(payload.screenshotRef),
    stringField(payload.imageRef),
    stringField(payload.mimeType),
  ].filter(Boolean).join(' ');
  if (/^(?:annotation|crop):/i.test(reference.ref) || /\b(?:annotation|crop|browser-annotation|desktop-annotation)\b/i.test(haystack)) {
    return 'annotation';
  }
  if (/^(?:image|screenshot):/i.test(reference.ref)
    || /\bimage\//i.test(haystack)
    || /(?:^|\b)(?:uploaded-image|image-evidence|screenshot)(?:\b|$)/i.test(haystack)
    || /\.(?:png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(haystack)) {
    return 'image';
  }
  return 'reference';
}

function pendingContextPreviewRef(reference: SciForgeReference, objectReference?: ObjectReference) {
  const payload = isRecord(reference.payload) ? reference.payload : {};
  const kind = pendingContextKindForReference(reference, objectReference);
  if (kind === 'annotation') {
    return stringField(payload.screenshotRef)
      ?? objectReference?.provenance?.screenshotRef
      ?? stringField(payload.cropRef)
      ?? stringField(payload.imageRef)
      ?? objectReference?.provenance?.dataRef
      ?? reference.ref;
  }
  if (kind === 'image') {
    return objectReference?.provenance?.path
      ?? objectReference?.provenance?.dataRef
      ?? stringField(payload.path)
      ?? stringField(payload.dataRef)
      ?? stringField(payload.imageRef)
      ?? reference.ref;
  }
  return objectReference?.provenance?.path
    ?? objectReference?.provenance?.dataRef
    ?? reference.ref;
}

function objectReferenceKindFromRef(ref: string): ObjectReferenceKind | undefined {
  const prefix = ref.match(/^([a-z-]+)::?/i)?.[1]?.toLowerCase();
  if (prefix === 'artifact'
    || prefix === 'file'
    || prefix === 'folder'
    || prefix === 'run'
    || prefix === 'execution-unit'
    || prefix === 'url'
    || prefix === 'scenario-package') {
    return prefix;
  }
  if (/^https?:\/\//i.test(ref)) return 'url';
  return undefined;
}

function composerReferenceIdentityKey(reference: SciForgeReference) {
  const objectReference = currentObjectReferenceFromComposerReference(withInferredCurrentObjectReference(reference));
  return normalizeReferenceIdentity(
    objectReference?.provenance?.path
      ?? objectReference?.provenance?.dataRef
      ?? objectReference?.ref
      ?? reference.ref
      ?? reference.id,
  ) || reference.id;
}

function normalizeReferenceIdentity(value: string | undefined) {
  return value
    ?.trim()
    .replace(/^(?:file|folder|artifact|image|annotation|crop|screenshot)::?/i, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
