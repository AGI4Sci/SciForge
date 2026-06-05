import assert from 'node:assert/strict';
import type { ObjectReference, SciForgeReference } from '../../domain';
import {
  addComposerReferenceWithMarker,
  addPendingComposerReference,
  composerReferenceForObjectReference,
  composerPendingContextItems,
  currentObjectReferenceFromComposerReference,
  promptForComposerSend,
  referenceComposerMarker,
  removeComposerReference,
  withComposerMarker,
} from './composerReferences';

const source: SciForgeReference = {
  id: 'ref-file-1',
  kind: 'file',
  title: 'Report',
  ref: 'file:reports/final.md',
  summary: 'final report',
};

const marked = withComposerMarker(source, []);
assert.equal(referenceComposerMarker(marked), '※1');

const added = addComposerReferenceWithMarker({
  input: 'Continue with this',
  pendingReferences: [],
  reference: source,
});
assert.equal(added.input, 'Continue with this ※1');
assert.equal(added.pendingReferences.length, 1);

const removed = removeComposerReference({
  input: added.input,
  pendingReferences: added.pendingReferences,
  referenceId: source.id,
});
assert.equal(removed.input, 'Continue with this');
assert.equal(removed.pendingReferences.length, 0);
assert.equal(promptForComposerSend('', added.pendingReferences), '请基于已引用对象继续分析。');

const pickedObject: ObjectReference = {
  id: 'object-picked-report',
  kind: 'artifact',
  title: 'Picked report',
  ref: 'artifact:picked-report',
  artifactType: 'research-report',
  status: 'available',
  summary: 'the user explicitly picked this report',
  provenance: { path: '.sciforge/reports/picked.md', producer: 'run-picked' },
};
const pickedComposerReference = addComposerReferenceWithMarker({
  input: '',
  pendingReferences: [],
  reference: composerReferenceForObjectReference(pickedObject),
});
const currentReference = currentObjectReferenceFromComposerReference(pickedComposerReference.reference);
assert.equal(pickedComposerReference.input, '※1');
assert.equal(currentReference?.ref, 'artifact:picked-report');
assert.equal(currentReference?.provenance?.path, '.sciforge/reports/picked.md');
assert.equal(pickedComposerReference.pendingReferences[0].ref, 'artifact:picked-report');

const legacyPickedFile = addComposerReferenceWithMarker({
  input: '基于这个继续',
  pendingReferences: [],
  reference: {
    id: 'ref-file-picked',
    kind: 'file',
    title: 'Picked file',
    ref: 'file:papers/picked.md',
    summary: 'legacy data attribute without objectReference payload',
    payload: { path: 'papers/picked.md' },
  },
});
const inferredCurrentReference = currentObjectReferenceFromComposerReference(legacyPickedFile.reference);
assert.equal(inferredCurrentReference?.kind, 'file');
assert.equal(inferredCurrentReference?.ref, 'file:papers/picked.md');
assert.equal(inferredCurrentReference?.provenance?.path, 'papers/picked.md');

const annotationReference: SciForgeReference = {
  id: 'ref-annotation-browser-1',
  kind: 'ui',
  title: 'Browser annotation',
  ref: 'annotation:browser-host-1',
  summary: 'Annotation pending composer context.',
  payload: {
    screenshotRef: 'screenshot:browser-host-1/frame.png',
    cropRef: 'crop:browser-host-1/selection.json',
    sourceKind: 'browser',
  },
};
const imageReference: SciForgeReference = {
  id: 'ref-image-1',
  kind: 'file-region',
  title: 'Uploaded figure',
  ref: 'image:uploads/session-1/figure.png',
  summary: 'Image pending composer context.',
  payload: {
    path: '.sciforge/uploads/session-1/figure.png',
    dataRef: '.sciforge/uploads/session-1/figure.png',
    mimeType: 'image/png',
  },
};
const annotationAdded = addComposerReferenceWithMarker({
  input: 'Compare these',
  pendingReferences: [],
  reference: annotationReference,
});
const imageAdded = addComposerReferenceWithMarker({
  input: annotationAdded.input,
  pendingReferences: annotationAdded.pendingReferences,
  reference: imageReference,
});
const duplicateAnnotation = addPendingComposerReference(imageAdded.pendingReferences, {
  ...annotationAdded.reference,
  id: 'ref-annotation-browser-duplicate',
});
const annotationObject = currentObjectReferenceFromComposerReference(annotationAdded.reference);
const imageObject = currentObjectReferenceFromComposerReference(imageAdded.reference);
const pendingContext = composerPendingContextItems(imageAdded.pendingReferences);

assert.equal(duplicateAnnotation.length, 2);
assert.equal(annotationObject?.kind, 'artifact');
assert.equal(annotationObject?.artifactType, 'annotation');
assert.equal(annotationObject?.preferredView, 'image-evidence');
assert.equal(annotationObject?.provenance?.screenshotRef, 'screenshot:browser-host-1/frame.png');
assert.equal(imageObject?.kind, 'artifact');
assert.equal(imageObject?.artifactType, 'image');
assert.equal(imageObject?.preferredView, 'preview');
assert.equal(imageObject?.provenance?.path, '.sciforge/uploads/session-1/figure.png');
assert.deepEqual(pendingContext.map((item) => ({
  kind: item.kind,
  marker: item.marker,
  previewRef: item.previewRef,
  objectRef: item.objectReference?.ref,
})), [
  {
    kind: 'annotation',
    marker: '※1',
    previewRef: 'screenshot:browser-host-1/frame.png',
    objectRef: 'annotation:browser-host-1',
  },
  {
    kind: 'image',
    marker: '※2',
    previewRef: '.sciforge/uploads/session-1/figure.png',
    objectRef: 'image:uploads/session-1/figure.png',
  },
]);

console.log('[ok] UI composer references preserve selected ObjectReference payloads and package-owned marker policy');
