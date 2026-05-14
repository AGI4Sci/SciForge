import assert from 'node:assert/strict';
import test from 'node:test';
import { validateArtifactDeliveryContract, type RuntimeArtifact } from './artifacts';

test('artifact delivery contract rejects user-facing json envelopes', () => {
  const artifact: RuntimeArtifact = {
    id: 'report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: '.sciforge/task-results/report.json',
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:report',
      role: 'primary-deliverable',
      declaredMediaType: 'application/json',
      declaredExtension: 'json',
      contentShape: 'json-envelope',
      rawRef: '.sciforge/task-results/report.json',
      previewPolicy: 'inline',
    },
  };

  assert.match(validateArtifactDeliveryContract(artifact).join('\n'), /json-envelope/);
});

test('artifact delivery contract accepts readable markdown with raw audit ref', () => {
  const artifact: RuntimeArtifact = {
    id: 'report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: '.sciforge/task-results/report.md',
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:report',
      role: 'primary-deliverable',
      declaredMediaType: 'text/markdown',
      declaredExtension: 'md',
      contentShape: 'raw-file',
      readableRef: '.sciforge/task-results/report.md',
      rawRef: '.sciforge/task-results/report.json',
      previewPolicy: 'inline',
    },
  };

  assert.deepEqual(validateArtifactDeliveryContract(artifact), []);
});
