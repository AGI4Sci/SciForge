import assert from 'node:assert/strict';

import { requestWithAgentHarnessShadow } from '../../src/runtime/gateway/agent-harness-shadow.js';
import { normalizeGatewayRequest } from '../../src/runtime/gateway/gateway-request.js';

const baseRequest = normalizeGatewayRequest({
  skillDomain: 'literature',
  prompt: 'Audit current references before final answer.',
  workspacePath: process.cwd(),
  expectedArtifactTypes: ['research-report'],
  selectedComponentIds: ['report-viewer'],
  artifacts: [],
});

const defaultConsumed = await requestWithAgentHarnessShadow({
  ...baseRequest,
  uiState: {
    harnessProfileId: 'research-grade',
  },
}, {}, { status: 'applied' });
assert.equal(defaultConsumed.verificationPolicy?.required, true, 'harness verification policy should tighten by default');
assert.equal(defaultConsumed.verificationPolicy?.mode, 'hybrid');
assert.equal(defaultConsumed.verificationPolicy?.riskLevel, 'high');
assert.equal(
  (defaultConsumed.uiState?.agentHarnessVerificationPolicy as Record<string, unknown> | undefined)?.harnessIntensity,
  'strict',
);

const legacyRelaxed = await requestWithAgentHarnessShadow(normalizeGatewayRequest({
  skillDomain: 'literature',
  prompt: 'Audit current references before final answer.',
  workspacePath: process.cwd(),
  verificationPolicy: { required: false, mode: 'none', reason: 'legacy relaxed body policy' },
  uiState: {
    harnessProfileId: 'research-grade',
    verificationPolicy: { required: false, mode: 'none', reason: 'legacy relaxed ui policy' },
    scenarioOverride: {
      verificationPolicy: { required: false, mode: 'none', reason: 'legacy relaxed scenario policy' },
    },
  },
  artifacts: [],
}), {}, { status: 'applied' });
assert.equal(legacyRelaxed.verificationPolicy?.required, true, 'legacy relaxed policy should not bypass harness tightening');
assert.equal(legacyRelaxed.verificationPolicy?.mode, 'hybrid');
assert.equal(legacyRelaxed.verificationPolicy?.riskLevel, 'high');
assert.deepEqual(
  (legacyRelaxed.uiState?.ignoredLegacyVerificationPolicySources as Array<Record<string, unknown>> | undefined)?.map((entry) => entry.source),
  [
    'request.verificationPolicy',
    'request.uiState.verificationPolicy',
    'request.uiState.scenarioOverride.verificationPolicy',
  ],
);
assert.equal((legacyRelaxed.uiState?.scenarioOverride as Record<string, unknown> | undefined)?.verificationPolicy, undefined);

const disabled = await requestWithAgentHarnessShadow({
  ...baseRequest,
  uiState: {
    harnessProfileId: 'research-grade',
    agentHarnessVerificationPolicyDisabled: true,
  },
}, {}, { status: 'applied' });
assert.equal(disabled.verificationPolicy, undefined, 'explicit kill switch should preserve shadow-only verification behavior');

const consumed = await requestWithAgentHarnessShadow({
  ...baseRequest,
  uiState: {
    harnessProfileId: 'research-grade',
  },
}, {}, { status: 'applied' });

assert.equal(consumed.verificationPolicy?.required, true);
assert.equal(consumed.verificationPolicy?.mode, 'hybrid');
assert.equal(consumed.verificationPolicy?.riskLevel, 'high');
assert.match(consumed.verificationPolicy?.reason ?? '', /contractRef=/);
const audit = consumed.uiState?.agentHarnessVerificationPolicy as Record<string, unknown> | undefined;
assert.equal(audit?.schemaVersion, 'sciforge.runtime-verification-policy-projection.v1');
assert.equal(audit?.source, 'request.uiState.agentHarness.contract.verificationPolicy');
assert.equal(audit?.profileId, 'research-grade');
assert.equal(audit?.harnessIntensity, 'strict');
assert.equal(audit?.mode, 'hybrid');

const tightened = await requestWithAgentHarnessShadow({
  ...baseRequest,
  verificationPolicy: {
    required: false,
    mode: 'lightweight',
    riskLevel: 'low',
    reason: 'caller supplied a lightweight policy',
    selectedVerifierIds: ['schema.verifier'],
  },
  uiState: {
    harnessProfileId: 'research-grade',
  },
}, {}, { status: 'applied' });

assert.equal(tightened.verificationPolicy?.required, true);
assert.equal(tightened.verificationPolicy?.mode, 'hybrid');
assert.equal(tightened.verificationPolicy?.riskLevel, 'high');
assert.deepEqual(tightened.verificationPolicy?.selectedVerifierIds, ['schema.verifier']);
assert.match(tightened.verificationPolicy?.reason ?? '', /caller supplied a lightweight policy/);
assert.match(tightened.verificationPolicy?.reason ?? '', /Harness policy consumed/);

console.log('[ok] agent harness verification policy tightens runtime verification by default with an explicit kill switch');
