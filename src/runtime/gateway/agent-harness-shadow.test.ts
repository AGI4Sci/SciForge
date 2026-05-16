import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types';
import { requestWithAgentHarnessShadow } from './agent-harness-shadow';

test('transport continue policy seeds Agent Harness continuation intent', async () => {
  const request = await requestWithAgentHarnessShadow({
    skillDomain: 'literature',
    prompt: 'Continue from the current projection only.',
    artifacts: [],
    uiState: {
      contextReusePolicy: {
        mode: 'continue',
        historyReuse: { allowed: true },
      },
    },
  } as GatewayRequest, {}, { status: 'allowed' });

  const agentHarness = request.uiState?.agentHarness as {
    contract?: { intentMode?: string };
    summary?: { intentMode?: string };
  } | undefined;
  assert.equal(agentHarness?.contract?.intentMode, 'continuation');
  assert.equal(agentHarness?.summary?.intentMode, 'continuation');
});

test('transport repair policy seeds Agent Harness repair intent', async () => {
  const request = await requestWithAgentHarnessShadow({
    skillDomain: 'literature',
    prompt: 'Repair the failed evidence run.',
    artifacts: [],
    uiState: {
      contextReusePolicy: {
        mode: 'repair',
        historyReuse: { allowed: true },
      },
    },
  } as GatewayRequest, {}, { status: 'allowed' });

  const agentHarness = request.uiState?.agentHarness as {
    contract?: { intentMode?: string };
    summary?: { intentMode?: string };
  } | undefined;
  assert.equal(agentHarness?.contract?.intentMode, 'repair');
  assert.equal(agentHarness?.summary?.intentMode, 'repair');
});

test('direct-context harness verification is visible but non-required for read-only answers', async () => {
  const request = await requestWithAgentHarnessShadow({
    skillDomain: 'literature',
    prompt: 'Using only the selected reproduction report, tell me whether this toy reproduction is credible and list the exact metrics plus one next validation step.',
    artifacts: [],
    uiState: directContextUiState(),
  } as GatewayRequest, {}, { status: 'allowed' });

  const audit = request.uiState?.agentHarnessVerificationPolicy as { required?: boolean } | undefined;
  assert.equal(request.verificationPolicy?.mode, 'lightweight');
  assert.equal(request.verificationPolicy?.riskLevel, 'medium');
  assert.equal(request.verificationPolicy?.required, false);
  assert.match(request.verificationPolicy?.reason ?? '', /direct-context answer records visible verification/);
  assert.equal(audit?.required, false);
});

test('direct-context harness verification remains required for explicit verification requests', async () => {
  const request = await requestWithAgentHarnessShadow({
    skillDomain: 'literature',
    prompt: 'Required verification must pass before you answer from the selected report.',
    artifacts: [],
    uiState: directContextUiState(),
  } as GatewayRequest, {}, { status: 'allowed' });

  assert.equal(request.verificationPolicy?.mode, 'lightweight');
  assert.equal(request.verificationPolicy?.required, true);
});

test('harness light verification follows nonblocking latency policy for generated work', async () => {
  const request = await requestWithAgentHarnessShadow({
    skillDomain: 'literature',
    prompt: 'Generate a mini grant research package with brief, decision log, risk register, timeline, and budget.',
    artifacts: [],
    uiState: {
      conversationPolicy: {
        latencyPolicy: { blockOnVerification: false },
      },
    },
  } as GatewayRequest, {}, { status: 'allowed' });

  const audit = request.uiState?.agentHarnessVerificationPolicy as { required?: boolean } | undefined;
  assert.equal(request.verificationPolicy?.mode, 'lightweight');
  assert.equal(request.verificationPolicy?.required, false);
  assert.match(request.verificationPolicy?.reason ?? '', /non-blocking background verification/);
  assert.equal(audit?.required, false);
});

function directContextUiState(): GatewayRequest['uiState'] {
  return {
    conversationPolicy: {
      executionModePlan: { executionMode: 'direct-context-answer' },
      responsePlan: { initialResponseMode: 'direct-context-answer' },
      capabilityPolicy: { preferredCapabilityIds: ['runtime.direct-context-answer'] },
    },
    turnExecutionConstraints: {
      contextOnly: true,
      preferredCapabilityIds: ['runtime.direct-context-answer'],
      executionModeHint: 'direct-context-answer',
      initialResponseModeHint: 'direct-context-answer',
    },
  };
}
