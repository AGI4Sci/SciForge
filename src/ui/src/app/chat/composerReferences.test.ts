import assert from 'node:assert/strict';
import test from 'node:test';
import type { SciForgeReference } from '../../domain';
import {
  addComposerReferenceWithMarker,
  addPendingComposerReference,
  promptForComposerSend,
  removeComposerReference,
} from './composerReferences';

function reference(id: string, title = id): SciForgeReference {
  return {
    id,
    kind: 'message',
    title,
    ref: `message:${id}`,
  };
}

test('adds pending composer references once and caps the visible state', () => {
  const first = reference('ref-1');
  const duplicated = addPendingComposerReference([first], first);
  const capped = Array.from({ length: 10 }, (_, index) => reference(`ref-${index}`))
    .reduce((current, item) => addPendingComposerReference(current, item), [] as SciForgeReference[]);

  assert.equal(duplicated.length, 1);
  assert.equal(capped.length, 8);
  assert.deepEqual(capped.map((item) => item.id), ['ref-0', 'ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5', 'ref-6', 'ref-7']);
});

test('adds and removes composer markers together with reference state', () => {
  const added = addComposerReferenceWithMarker({
    input: '请分析',
    pendingReferences: [],
    reference: reference('ref-1', 'Figure 1'),
  });
  const removed = removeComposerReference({
    input: added.input,
    pendingReferences: added.pendingReferences,
    referenceId: added.reference.id,
  });

  assert.match(added.input, /※1/);
  assert.equal(added.pendingReferences.length, 1);
  assert.equal(added.pendingReferences[0].title, 'Figure 1');
  assert.equal(removed.input.trim(), '请分析');
  assert.deepEqual(removed.pendingReferences, []);
});

test('derives the send prompt from text or pending references', () => {
  assert.equal(promptForComposerSend('  hello  ', []), 'hello');
  assert.equal(promptForComposerSend('', [reference('ref-1')]), '请基于已引用对象继续分析。');
  assert.equal(promptForComposerSend('   ', []), '');
});
