import type { SciForgeReference } from '../../domain';
import {
  appendReferenceMarkerToInput,
  removeReferenceMarkerFromInput,
  withComposerMarker,
} from '../../../../../packages/object-references';

const MAX_COMPOSER_REFERENCES = 8;

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
  const referenceWithMarker = withComposerMarker(reference, pendingReferences);
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
