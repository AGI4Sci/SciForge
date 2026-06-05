import assert from 'node:assert/strict';
import { test } from 'node:test';
import { objectReferenceForCursorRef } from './cursorProcessObjectReferences';

test('cursor process maps safe trace refs to folded public process objects', () => {
  const reference = objectReferenceForCursorRef('trace:explorer-summary');

  assert.equal(reference?.kind, 'run');
  assert.equal(reference?.ref, 'trace:explorer-summary');
  assert.equal(reference?.preferredView, 'subagent-transcript');
  assert.equal(reference?.presentationRole, 'supporting-evidence');
  assert.equal(reference?.status, 'available');

  for (const unsafeRef of [
    'trace:raw-stream',
    'trace:provider-route',
    'trace:worker-secret-token',
    'trace:.sciforge-session',
    'trace:../private',
    'trace:/Applications/workspace/private.json',
  ]) {
    assert.equal(objectReferenceForCursorRef(unsafeRef), undefined, unsafeRef);
  }
});
