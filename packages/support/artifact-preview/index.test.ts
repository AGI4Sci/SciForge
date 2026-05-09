import assert from 'node:assert/strict';
import test from 'node:test';
import type { PreviewDescriptor } from './index';
import { descriptorWithDiagnostic, mergePreviewDescriptors, normalizePreviewDerivative, uniquePreviewStrings } from './index';

test('merges descriptor derivatives and diagnostics without owning preview policy', () => {
  const local: PreviewDescriptor = {
    kind: 'image',
    source: 'artifact',
    ref: 'plot.png',
    inlinePolicy: 'stream',
    actions: ['open-inline'],
  };
  const merged = mergePreviewDescriptors(local, {
    ...local,
    rawUrl: 'data:image/png;base64,abc',
    derivatives: [{ kind: 'thumb', ref: 'thumb://plot', status: 'available' }],
    diagnostics: ['hydrated'],
  });
  assert.equal(merged.rawUrl, 'data:image/png;base64,abc');
  assert.equal(merged.derivatives?.[0]?.kind, 'thumb');
  assert.deepEqual(merged.diagnostics, ['hydrated']);
  assert.match(descriptorWithDiagnostic(merged, new Error('boom')).diagnostics?.join('\n') ?? '', /boom/);
});

test('normalizes derivative records and unique strings as contract helpers', () => {
  assert.deepEqual(uniquePreviewStrings(['text', 'text', 'thumb']), ['text', 'thumb']);
  assert.deepEqual(normalizePreviewDerivative({ kind: 'text', ref: 'report.md#text', status: 'lazy' }), {
    kind: 'text',
    ref: 'report.md#text',
    mimeType: undefined,
    sizeBytes: undefined,
    hash: undefined,
    generatedAt: undefined,
    status: 'lazy',
    diagnostics: [],
  });
  assert.equal(normalizePreviewDerivative({ kind: 'text' }), undefined);
});
