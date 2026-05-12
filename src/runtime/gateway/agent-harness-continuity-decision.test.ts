import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types';
import { agentHarnessContinuityDecision } from './agent-harness-continuity-decision';

test('reuse policy alone stays fresh for a new current-turn task', () => {
  const decision = agentHarnessContinuityDecision({
    skillDomain: 'literature',
    prompt: 'Find new papers and write a report.',
    artifacts: [],
    uiState: {
      sessionId: 'session-1',
      contextReusePolicy: {
        mode: 'continue',
        historyReuse: { allowed: true },
      },
    },
  } as GatewayRequest);

  assert.equal(decision.useContinuity, false);
  assert.equal(decision.decision, 'fresh');
  assert.equal(decision.runtimeSignals.policyReuseIsAdvisory, true);
  assert.ok(decision.reasons.includes('reuse-policy-advisory'));
});

test('explicit continuation signals still reuse AgentServer context', () => {
  const decision = agentHarnessContinuityDecision({
    skillDomain: 'literature',
    prompt: 'Continue the previous run.',
    artifacts: [],
    uiState: {
      agentHarness: {
        contract: {
          intentMode: 'continuation',
        },
      },
    },
  } as GatewayRequest);

  assert.equal(decision.useContinuity, true);
  assert.equal(decision.decision, 'continuity');
  assert.ok(decision.reasons.includes('intent-continuity'));
});

test('current-turn references still get scoped continuity handling', () => {
  const decision = agentHarnessContinuityDecision({
    skillDomain: 'literature',
    prompt: 'Summarize this selected paper.',
    artifacts: [],
    uiState: {
      currentReferences: [{ ref: 'file:paper.pdf', title: 'paper.pdf' }],
    },
  } as GatewayRequest);

  assert.equal(decision.useContinuity, true);
  assert.equal(decision.decision, 'continuity');
  assert.ok(decision.reasons.includes('current-reference'));
});
