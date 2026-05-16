import assert from 'node:assert/strict';
import test from 'node:test';

import {
  artifactDeliveryVisibilityVerifierInput,
  buildArtifactDeliveryVisibilityCase,
  verifyArtifactDeliveryVisibilityCase,
} from './artifact-delivery-visibility.js';

test('SA-WEB-09 keeps audit diagnostic and internal artifacts out of the main browser result', async () => {
  const { fixture, input } = await buildArtifactDeliveryVisibilityCase();

  assert.deepEqual(input.browserVisibleState.visibleArtifactRefs, [
    ...fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
    ...fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
  ]);
  assert.ok(fixture.expectedProjection.artifactDelivery.auditRefs.length > 0);
  assert.ok(fixture.expectedProjection.artifactDelivery.diagnosticRefs.length > 0);
  assert.ok(fixture.expectedProjection.artifactDelivery.internalRefs.length > 0);
  assert.equal(verifyArtifactDeliveryVisibilityCase(input).ok, true);
});

test('SA-WEB-09 fails closed when audit-only artifacts are visible in the main result', async () => {
  const { fixture } = await buildArtifactDeliveryVisibilityCase();
  const input = artifactDeliveryVisibilityVerifierInput(fixture, {
    auditRefs: [...fixture.expectedProjection.artifactDelivery.auditRefs],
    diagnosticRefs: [...fixture.expectedProjection.artifactDelivery.diagnosticRefs],
    internalRefs: [...fixture.expectedProjection.artifactDelivery.internalRefs],
  });

  const result = verifyArtifactDeliveryVisibilityCase(input);

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /browser audit refs leaked audit-only refs/);
  assert.match(result.failures.join('\n'), /browser diagnostic refs leaked audit-only refs/);
  assert.match(result.failures.join('\n'), /browser internal refs leaked audit-only refs/);
});
