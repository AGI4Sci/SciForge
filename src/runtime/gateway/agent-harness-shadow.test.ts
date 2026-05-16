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
