import test from 'node:test';

import {
  PROVIDER_READY_CONTINUE_PROMPT,
  PROVIDER_TRANSITION_PROMPT,
  assertFailClosedBeforeAgentServerDispatch,
  assertNoProviderEndpointShapeLeaks,
  assertReadyRoundDispatchesToAgentServer,
  createProviderUnavailableAvailableHarness,
  markWebProvidersReady,
  runProviderTransitionRound,
} from './provider-unavailable-available.js';

test('SA-WEB-05 fails closed without web providers, then dispatches the same task once mock providers are ready', async () => {
  const harness = await createProviderUnavailableAvailableHarness();
  try {
    const unavailableRound = await runProviderTransitionRound(harness, PROVIDER_TRANSITION_PROMPT);
    assertFailClosedBeforeAgentServerDispatch(unavailableRound);
    assertNoProviderEndpointShapeLeaks(unavailableRound.visiblePreflightPayload);

    markWebProvidersReady(harness);

    const readyRound = await runProviderTransitionRound(harness, PROVIDER_READY_CONTINUE_PROMPT);
    assertReadyRoundDispatchesToAgentServer(readyRound);
    assertNoProviderEndpointShapeLeaks(readyRound.handoffRoutes);
    assertNoProviderEndpointShapeLeaks(readyRound.dispatchRequest);
    assertNoProviderEndpointShapeLeaks(readyRound.dispatchRun);
  } finally {
    await harness.close();
  }
});
