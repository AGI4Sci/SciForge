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
  if (current.some((item) => item.id === reference.id)) return current;
  return [...current, reference].slice(0, limit);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
