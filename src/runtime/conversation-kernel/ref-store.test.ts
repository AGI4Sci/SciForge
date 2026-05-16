import assert from 'node:assert/strict';
import test from 'node:test';

import { createInMemoryRefStore } from './ref-store';

test('ref store lists descriptors only and reads large bodies on demand', () => {
  const store = createInMemoryRefStore(() => '2026-05-16T00:00:00.000Z');
  const largeBody = 'full ref body\n'.repeat(2000);

  const descriptor = store.registerRef({
    ref: 'artifact:large-report',
    body: largeBody,
    mime: 'text/markdown',
    label: 'Large report',
    kind: 'artifact',
    tags: ['report', 'large'],
  });

  assert.equal(descriptor.ref, 'artifact:large-report');
  assert.equal(descriptor.sizeBytes, new TextEncoder().encode(largeBody).byteLength);
  assert.match(descriptor.digest, /^sha256:/);

  const listed = store.listRefs({ limit: 10 }, { kind: 'artifact', tag: 'report' });
  assert.equal(listed.descriptors.length, 1);
  assert.deepEqual(listed.descriptors[0], descriptor);
  assert.equal('body' in listed.descriptors[0], false);

  const read = store.readRef('artifact:large-report');
  assert.equal(read?.body, largeBody);
  assert.deepEqual(read?.descriptor, descriptor);
});

test('ref store paginates filtered descriptors without exposing bodies', () => {
  const store = createInMemoryRefStore(() => '2026-05-16T00:00:00.000Z');

  store.registerRef({ ref: 'artifact:a', body: 'a', kind: 'artifact', mime: 'text/plain' });
  store.registerRef({ ref: 'artifact:b', body: 'b', kind: 'artifact', mime: 'text/plain' });
  store.registerRef({ ref: 'log:c', body: 'c', kind: 'log', mime: 'text/plain' });

  const firstPage = store.listRefs({ limit: 1 }, { refPrefix: 'artifact:' });
  assert.deepEqual(firstPage.descriptors.map((descriptor) => descriptor.ref), ['artifact:a']);
  assert.equal(firstPage.nextCursor, '1');
  assert.equal('body' in firstPage.descriptors[0], false);

  const secondPage = store.listRefs({ limit: 1, cursor: firstPage.nextCursor }, { refPrefix: 'artifact:' });
  assert.deepEqual(secondPage.descriptors.map((descriptor) => descriptor.ref), ['artifact:b']);
  assert.equal(secondPage.nextCursor, undefined);
  assert.equal(store.readRef('log:c')?.body, 'c');
});
