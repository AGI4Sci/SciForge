import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SA_WEB_08_DEGRADED_REASON,
  assertBackendDidNotReceiveRawHistory,
  assertRefsFirstDegradedPacket,
  assertSaWeb08DegradedAgentServerCase,
  createSaWeb08DegradedAgentServerCase,
} from './degraded-agentserver.js';
import { assertWebE2eContract } from '../contract-verifier.js';

test('SA-WEB-08 builds refs-first DegradedHandoffPacket when AgentServer context API is unavailable', async () => {
  const scenario = await createSaWeb08DegradedAgentServerCase();
  try {
    assertSaWeb08DegradedAgentServerCase(scenario);
    assertRefsFirstDegradedPacket(scenario.degradedPacket, scenario.serializedDegradedPacket);

    assert.equal(scenario.degradedPacket.degradedReason.owner, 'agentserver');
    assert.equal(scenario.degradedPacket.degradedReason.reason, SA_WEB_08_DEGRADED_REASON);
    assert.deepEqual(scenario.degradedPacket.availableRetrievalTools, [
      'read_ref',
      'retrieve',
      'workspace_search',
      'list_session_artifacts',
    ]);
    assert.deepEqual(
      scenario.degradedPacket.boundedArtifactIndex.map((ref) => ref.ref),
      [
        'message:msg-sa-web-08-user-current',
        'artifact:fixture-old-report',
        'artifact:fixture-current-report',
        'file:.sciforge/artifacts/expression-summary.csv',
      ],
    );
  } finally {
    await scenario.close();
  }
});

test('SA-WEB-08 contract verifier sees degraded reason in UI and no raw history in backend request', async () => {
  const scenario = await createSaWeb08DegradedAgentServerCase();
  try {
    assertWebE2eContract(scenario.verifierInput);
    assert.match(scenario.browserVisibleState.visibleAnswerText ?? '', /AgentServer context API unavailable/);
    assert.equal(scenario.verifierInput.expected.conversationProjection.visibleAnswer?.status, 'degraded-result');
    assert.equal(scenario.verifierInput.expected.conversationProjection.visibleAnswer?.diagnostic, undefined);
    assert.equal(scenario.server.requests.context.length, 0, 'unavailable context API path must not be recorded as a healthy context request');
    assert.equal(scenario.server.requests.runs.length, 1, 'runtime should make exactly one backend degraded run request');
    assertBackendDidNotReceiveRawHistory(scenario.backendRunRequest, scenario.rawHistorySentinel);
    assertBackendDidNotReceiveRawHistory(scenario.server.requests.runs[0]?.body, scenario.rawHistorySentinel);
  } finally {
    await scenario.close();
  }
});
