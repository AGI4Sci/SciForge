import assert from 'node:assert/strict';
import type { ObjectReference, SciForgeReference } from '../../domain';
import {
  addComposerReferenceWithMarker,
  composerReferenceForObjectReference,
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
assert.equal(removed.input, 'Continue with this ');
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

console.log('[ok] UI composer references preserve selected ObjectReference payloads and package-owned marker policy');
