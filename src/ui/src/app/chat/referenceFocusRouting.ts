import type { ObjectReference, SciForgeReference } from '../../domain';
import { focusResultPaneRouteForObjectReference } from '../results/resultPaneContract';
import {
  currentObjectReferenceFromComposerReference,
  withInferredCurrentObjectReference,
} from './composerReferences';

export function imageObjectReferenceForReferenceFocus(reference: SciForgeReference): ObjectReference | undefined {
  const objectReference = currentObjectReferenceFromComposerReference(withInferredCurrentObjectReference(reference));
  if (!objectReference) return undefined;
  return focusResultPaneRouteForObjectReference(objectReference).pane === 'image'
    ? objectReference
    : undefined;
}
