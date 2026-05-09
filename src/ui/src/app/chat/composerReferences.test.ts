import assert from 'node:assert/strict';
import type { SciForgeReference } from '../../domain';
import {
  addComposerReferenceWithMarker,
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

console.log('[ok] UI composer references delegate package-owned marker policy');
