import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artifactHasUserFacingDelivery,
  validateArtifactDeliveryContract,
  type ArtifactDeliveryPreviewPolicy,
  type ArtifactDeliveryRole,
  type RuntimeArtifact,
} from './artifacts';

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
  assert.equal(artifactHasUserFacingDelivery(artifact), false);
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
  assert.equal(artifactHasUserFacingDelivery(artifact), true);
});

test('artifact delivery contract helper identifies readable user-facing deliveries only', () => {
  assert.equal(artifactHasUserFacingDelivery(deliveryFixture({ role: 'primary-deliverable', previewPolicy: 'inline', readableRef: 'report.md' })), true);
  assert.equal(artifactHasUserFacingDelivery(deliveryFixture({ role: 'supporting-evidence', previewPolicy: 'open-system', path: 'table.xlsx' })), true);
  assert.equal(artifactHasUserFacingDelivery(deliveryFixture({ role: 'primary-deliverable', previewPolicy: 'inline', data: 'inline report' })), true);
  assert.equal(artifactHasUserFacingDelivery(deliveryFixture({ role: 'primary-deliverable', previewPolicy: 'inline' })), false);
});

test('artifact delivery contract helper keeps audit and unsupported deliveries out of user-facing projection', () => {
  const blockedRoles: ArtifactDeliveryRole[] = ['audit', 'diagnostic', 'internal'];
  for (const role of blockedRoles) {
    assert.equal(
      artifactHasUserFacingDelivery(deliveryFixture({ role, previewPolicy: 'inline', readableRef: `${role}.md` })),
      false,
      `${role} must not be user-facing`,
    );
  }

  const blockedPreviewPolicies: ArtifactDeliveryPreviewPolicy[] = ['audit-only', 'unsupported'];
  for (const previewPolicy of blockedPreviewPolicies) {
    assert.equal(
      artifactHasUserFacingDelivery(deliveryFixture({ role: 'primary-deliverable', previewPolicy, readableRef: `${previewPolicy}.md` })),
      false,
      `${previewPolicy} must not be user-facing`,
    );
  }
});

function deliveryFixture(input: {
  role: ArtifactDeliveryRole;
  previewPolicy: ArtifactDeliveryPreviewPolicy;
  readableRef?: string;
  data?: unknown;
  dataRef?: string;
  path?: string;
}): RuntimeArtifact {
  return {
    id: 'artifact',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: input.data,
    dataRef: input.dataRef,
    path: input.path,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:artifact',
      role: input.role,
      declaredMediaType: 'text/markdown',
      declaredExtension: 'md',
      contentShape: 'raw-file',
      readableRef: input.readableRef,
      rawRef: 'output.json',
      previewPolicy: input.previewPolicy,
    },
  };
}
