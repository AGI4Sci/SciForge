import assert from 'node:assert/strict';
import test from 'node:test';
import type { PreviewDescriptor } from './index';
import {
  STRUCTURE_BUNDLE_PREVIEW_DERIVATIVE_KIND,
  descriptorWithDiagnostic,
  derivativeDescriptorsForPreviewTarget,
  inlinePolicyForPreviewKind,
  locatorHintsForPreviewKind,
  mergePreviewDescriptors,
  normalizePreviewDerivative,
  previewActionsForPreviewKind,
  previewDerivativeExtensionForKind,
  previewDerivativeMimeTypeForKind,
  previewDescriptorKindForPath,
  previewDescriptorKindForExtension,
  previewFileExtensionForPath,
  previewPathHasRecognizedFileExtension,
  previewPathHasStableDeliverableExtension,
  previewStructureBundleStatus,
  uniquePreviewStrings,
} from './index';

test('merges descriptor derivatives and diagnostics', () => {
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

test('owns file preview kind, derivative, action, and locator policy', () => {
  assert.equal(previewDescriptorKindForPath('report.md'), 'markdown');
  assert.equal(previewDescriptorKindForExtension('.cif'), 'structure');
  assert.equal(previewFileExtensionForPath('reports/final.csv?download=1'), 'csv');
  assert.equal(previewPathHasRecognizedFileExtension('src/runtime/payload-validation.ts'), true);
  assert.equal(previewPathHasStableDeliverableExtension('src/runtime/payload-validation.ts'), false);
  assert.equal(previewPathHasStableDeliverableExtension('reports/final.csv?download=1'), true);
  assert.equal(previewDescriptorKindForPath('1crn.cif'), 'structure');
  assert.equal(inlinePolicyForPreviewKind('markdown', 512), 'inline');
  assert.equal(inlinePolicyForPreviewKind('structure', 512), 'external');
  assert.deepEqual(derivativeDescriptorsForPreviewTarget('1crn.cif', 'structure', 10), [
    { kind: 'metadata', ref: '1crn.cif#metadata', mimeType: 'application/json', status: 'lazy' },
    { kind: STRUCTURE_BUNDLE_PREVIEW_DERIVATIVE_KIND, ref: '1crn.cif#structure-bundle', mimeType: 'application/json', status: 'lazy' },
  ]);
  assert.equal(previewDerivativeExtensionForKind(STRUCTURE_BUNDLE_PREVIEW_DERIVATIVE_KIND, 'structure', '1crn.cif'), 'json');
  assert.equal(previewDerivativeMimeTypeForKind(STRUCTURE_BUNDLE_PREVIEW_DERIVATIVE_KIND, 'structure', 'chemical/x-cif'), 'application/json');
  assert.ok(previewActionsForPreviewKind('table').includes('select-rows'));
  assert.deepEqual(locatorHintsForPreviewKind('table'), ['row-range', 'column-range']);
  assert.equal(previewStructureBundleStatus('structure'), 'metadata-only-bundle');
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
