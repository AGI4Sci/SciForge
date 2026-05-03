import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeArtifact } from '../../src/ui/src/domain';
import { descriptorWithDiagnostic, mergePreviewDescriptors, normalizeArtifactPreviewDescriptor, shouldHydratePreviewDescriptor } from './index';

test('normalizes artifact preview descriptors from file metadata', () => {
  const artifact: RuntimeArtifact = {
    id: 'pdf-1',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    path: 'workspace/report.pdf',
    metadata: { title: 'Report PDF', size: 2048 },
  };
  const descriptor = normalizeArtifactPreviewDescriptor(artifact);
  assert.equal(descriptor?.kind, 'pdf');
  assert.equal(descriptor?.inlinePolicy, 'stream');
  assert.ok(descriptor?.actions.includes('system-open'));
  assert.ok(descriptor?.actions.includes('select-page'));
});

test('keeps explicit preview descriptors unchanged', () => {
  const artifact: RuntimeArtifact = {
    id: 'table-1',
    type: 'data-table',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    previewDescriptor: {
      kind: 'table',
      source: 'artifact',
      ref: 'artifact:table-1',
      inlinePolicy: 'extract',
      actions: ['select-rows'],
    },
  };
  assert.deepEqual(normalizeArtifactPreviewDescriptor(artifact), artifact.previewDescriptor);
});

test('merges hydrated descriptor derivatives and diagnostics', () => {
  const local = normalizeArtifactPreviewDescriptor({
    id: 'image-1',
    type: 'image',
    producerScenario: 'structure-exploration',
    schemaVersion: '1',
    path: 'plot.png',
  });
  assert.ok(local);
  const merged = mergePreviewDescriptors(local, {
    ...local,
    rawUrl: 'data:image/png;base64,abc',
    derivatives: [{ kind: 'thumb', ref: 'thumb://plot', status: 'available' }],
    diagnostics: ['hydrated'],
  });
  assert.equal(merged.rawUrl, 'data:image/png;base64,abc');
  assert.equal(merged.derivatives?.[0]?.kind, 'thumb');
  assert.deepEqual(merged.diagnostics, ['hydrated']);
  assert.equal(shouldHydratePreviewDescriptor(merged, 'plot.png'), false);
  assert.match(descriptorWithDiagnostic(merged, new Error('boom')).diagnostics?.join('\n') ?? '', /boom/);
});
