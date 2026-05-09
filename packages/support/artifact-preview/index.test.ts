import assert from 'node:assert/strict';
import test from 'node:test';
import type { PreviewDescriptor } from './index';
import {
  STRUCTURE_BUNDLE_PREVIEW_DERIVATIVE_KIND,
  descriptorWithDiagnostic,
  derivativeDescriptorsForPreviewTarget,
  inlinePolicyForPreviewKind,
  locatorHintsForPreviewKind,
  lightweightPreviewNoticeForDescriptor,
  mergePreviewDescriptors,
  normalizeArtifactPreviewDescriptor,
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
  unsupportedPreviewNoticeModel,
  uniquePreviewStrings,
  uploadedArtifactPreview,
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

test('normalizes artifact preview descriptors from payload shape and path policy', () => {
  const markdown = normalizeArtifactPreviewDescriptor({
    id: 'report-1',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Result' },
  });
  assert.equal(markdown?.kind, 'markdown');
  assert.ok(markdown?.actions.includes('extract-text'));

  const structure = normalizeArtifactPreviewDescriptor({
    id: 'structure-1',
    type: 'workspace-artifact',
    producerScenario: 'structure-exploration',
    schemaVersion: '1',
    path: 'workspace/1crn.cif',
  });
  assert.equal(structure?.kind, 'structure');
  assert.equal(structure?.inlinePolicy, 'external');
  assert.ok(structure?.derivatives?.some((derivative) => derivative.kind === STRUCTURE_BUNDLE_PREVIEW_DERIVATIVE_KIND));

  const table = normalizeArtifactPreviewDescriptor({
    id: 'table-1',
    type: 'workspace-artifact',
    producerScenario: 'knowledge-graph-mining',
    schemaVersion: '1',
    data: { rows: [{ gene: 'TP53' }] },
  });
  assert.equal(table?.kind, 'table');
  assert.ok(table?.actions.includes('select-rows'));

  const unknown = normalizeArtifactPreviewDescriptor({
    id: 'opaque-1',
    type: 'workspace-artifact',
    producerScenario: 'general',
    schemaVersion: '1',
    path: 'outputs/model.weights',
  });
  assert.equal(unknown?.kind, 'binary');
  assert.equal(unknown?.inlinePolicy, 'unsupported');
});

test('normalizes uploaded artifact data-url preview payloads', () => {
  const preview = uploadedArtifactPreview({
    id: 'upload-1',
    type: 'uploaded-image',
    producerScenario: 'general',
    schemaVersion: '1',
    metadata: { title: 'Gel image', size: 12 },
    data: { previewKind: 'image', dataUrl: 'data:image/png;base64,abc' },
  });
  assert.equal(preview?.kind, 'image');
  assert.equal(preview?.title, 'Gel image');
  assert.equal(preview?.size, 12);
});

test('builds package-owned preview notice copy from contract actions', () => {
  const descriptor: PreviewDescriptor = {
    kind: 'binary',
    source: 'path',
    ref: 'outputs/archive.bin',
    inlinePolicy: 'unsupported',
    actions: ['system-open', 'copy-ref', 'inspect-metadata'],
  };
  assert.match(lightweightPreviewNoticeForDescriptor(descriptor), /metadata\/system-open\/copy-ref|system-open\/copy-ref\/metadata/);
  const notice = unsupportedPreviewNoticeModel({
    reference: { ref: 'file:outputs/archive.bin', artifactType: 'workspace-file' },
    path: 'outputs/archive.bin',
    descriptor,
  });
  assert.equal(notice.kindLabel, 'binary');
  assert.equal(notice.requestLabel, '让 Agent 设计 preview package 并重试');
  assert.deepEqual(notice.codeLabels, ['outputs/archive.bin', 'inlinePolicy: unsupported']);
});
