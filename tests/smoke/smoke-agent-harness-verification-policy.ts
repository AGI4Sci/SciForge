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

const shadowOnly = await requestWithAgentHarnessShadow({
  ...baseRequest,
  uiState: {
    harnessProfileId: 'research-grade',
  },
}, {}, { status: 'applied' });
assert.equal(shadowOnly.verificationPolicy, undefined, 'harness shadow mode must not change verification policy by default');

const consumed = await requestWithAgentHarnessShadow({
  ...baseRequest,
  uiState: {
    harnessProfileId: 'research-grade',
    agentHarnessVerificationPolicyEnabled: true,
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
    agentHarnessVerificationPolicyEnabled: true,
  },
}, {}, { status: 'applied' });

assert.equal(tightened.verificationPolicy?.required, true);
assert.equal(tightened.verificationPolicy?.mode, 'hybrid');
assert.equal(tightened.verificationPolicy?.riskLevel, 'high');
assert.deepEqual(tightened.verificationPolicy?.selectedVerifierIds, ['schema.verifier']);
assert.match(tightened.verificationPolicy?.reason ?? '', /caller supplied a lightweight policy/);
assert.match(tightened.verificationPolicy?.reason ?? '', /Harness policy consumed/);

console.log('[ok] agent harness verification policy can opt in to tighten runtime verification without changing shadow defaults');
