import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimeArtifact, UIComponentManifest } from '@sciforge-ui/runtime-contract';
import {
  componentConsumesPresentationInput,
  resolvePresentationInputForArtifact,
} from './presentation-input-policy';

test('presentation input resolves readable markdown from ArtifactDelivery only', () => {
  const artifact: RuntimeArtifact = {
    id: 'report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { content: '# JSON envelope should not be rendered directly' },
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:report',
      role: 'primary-deliverable',
      declaredMediaType: 'text/markdown',
      declaredExtension: 'md',
      contentShape: 'raw-file',
      readableRef: '.sciforge/session/report.md',
      rawRef: '.sciforge/session/output.json',
      previewPolicy: 'inline',
    },
  };

  const input = resolvePresentationInputForArtifact(artifact);

  assert.equal(input?.kind, 'markdown');
  assert.equal(input?.ref, '.sciforge/session/report.md');
  assert.equal(input?.rawRef, '.sciforge/session/output.json');
});

test('presentation input keeps audit deliveries out of primary rendering', () => {
  const artifact: RuntimeArtifact = {
    id: 'raw',
    type: 'runtime-payload',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:raw',
      role: 'internal',
      declaredMediaType: 'application/json',
      declaredExtension: 'json',
      contentShape: 'json-envelope',
      rawRef: '.sciforge/session/output.json',
      previewPolicy: 'audit-only',
    },
  };

  assert.equal(resolvePresentationInputForArtifact(artifact), undefined);
});

test('component consumes contract matches kind/media/extension policy', () => {
  const module = {
    componentId: 'report-viewer',
    moduleId: 'research-report-document',
    title: 'Report',
    consumes: [{ kinds: ['markdown'], mediaTypes: ['text/markdown'], extensions: ['md'], previewPolicies: ['inline'] }],
  } as UIComponentManifest;

  assert.equal(componentConsumesPresentationInput(module, {
    kind: 'markdown',
    ref: 'report.md',
    mediaType: 'text/markdown',
    extension: 'md',
    previewPolicy: 'inline',
  }), true);
  assert.equal(componentConsumesPresentationInput(module, {
    kind: 'table',
    ref: 'rows.csv',
    format: 'csv',
    mediaType: 'text/csv',
    extension: 'csv',
    previewPolicy: 'inline',
  }), false);
});
