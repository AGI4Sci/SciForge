import assert from 'node:assert/strict';

import {
  artifactDeliveryVisibilityVerifierInput,
  buildArtifactDeliveryVisibilityCase,
  verifyArtifactDeliveryVisibilityCase,
} from './web-e2e/cases/artifact-delivery-visibility.js';
import { buildDirectContextGateCase } from './web-e2e/cases/direct-context-gate.js';
import { verifyWebE2eContract } from './web-e2e/contract-verifier.js';

const deliveryCase = await buildArtifactDeliveryVisibilityCase();

const projectionWins = verifyWebE2eContract(deliveryCase.input);
assert.equal(projectionWins.ok, true, projectionWins.failures.join('\n'));

const staleStreamDelta = verifyWebE2eContract({
  ...deliveryCase.input,
  browserVisibleState: {
    ...deliveryCase.input.browserVisibleState,
    visibleAnswerText: 'Transient stale answer-delta that must lose to terminal Projection.',
  },
});
assert.equal(staleStreamDelta.ok, false);
assert.match(
  staleStreamDelta.failures.join('\n'),
  /browser visible answer text does not contain expected Projection visibleAnswer\.text/,
);

const auditLeak = verifyArtifactDeliveryVisibilityCase(artifactDeliveryVisibilityVerifierInput(
  deliveryCase.fixture,
  {
    auditRefs: [...deliveryCase.fixture.expectedProjection.artifactDelivery.auditRefs],
    diagnosticRefs: [...deliveryCase.fixture.expectedProjection.artifactDelivery.diagnosticRefs],
    internalRefs: [...deliveryCase.fixture.expectedProjection.artifactDelivery.internalRefs],
  },
));
assert.equal(auditLeak.ok, false);
assert.match(auditLeak.failures.join('\n'), /browser audit refs leaked audit-only refs/);
assert.match(auditLeak.failures.join('\n'), /browser diagnostic refs leaked audit-only refs/);
assert.match(auditLeak.failures.join('\n'), /browser internal refs leaked audit-only refs/);

const directContextCase = await buildDirectContextGateCase();
try {
  assert.equal(directContextCase.directStatus.route, 'direct-context-answer');
  assert.equal(directContextCase.directStatus.decision.sufficiency, 'sufficient');
  assert.equal(directContextCase.directStatus.serverRequests, 0);

  const routedScenarios = directContextCase.routed.map((scenario) => scenario.scenario).sort();
  assert.deepEqual(routedScenarios, ['generation', 'repair', 'tool-status-insufficient']);
  for (const routed of directContextCase.routed) {
    assert.equal(routed.route, 'route-to-agentserver');
    assert.equal(routed.decision.sufficiency, 'insufficient');
    assert.equal(routed.decision.allowDirectContext, false);
    assert.equal(routed.directPayload, undefined);
    assert.ok(routed.agentServerRun, `${routed.scenario} must route to AgentServer`);
    assert.ok(
      routed.agentServerRun.events.some((event) => event.type === 'status' && event.status === 'route-to-agentserver'),
      `${routed.scenario} must expose a route-to-agentserver stream event`,
    );
  }
} finally {
  await directContextCase.server.close();
}

console.log('[ok] web final conformance smoke covered Projection-over-delta, ArtifactDelivery audit-only visibility, and insufficient direct-context routing');
