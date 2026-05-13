import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types';
import { agentServerContextPolicy, currentTurnReferences, requestNeedsAgentServerContinuity } from './agentserver-context-window';

test('digest-only current turn is isolated from AgentServer continuity context', () => {
  const request = {
    skillDomain: 'literature',
    prompt: 'Summarize the current digest only.',
    artifacts: [],
    uiState: {
      sessionId: 'session-1',
      currentReferenceDigests: [{
        id: 'digest-1',
        status: 'ok',
        sourceRef: 'file:current.md',
        digestRef: '.sciforge/digests/current.md',
        digestText: 'Current bounded digest.',
      }],
    },
  } as GatewayRequest;

  assert.equal(currentTurnReferences(request).length, 1);
  assert.equal(requestNeedsAgentServerContinuity(request), false);
  assert.deepEqual(agentServerContextPolicy(request), {
    includeCurrentWork: false,
    includeRecentTurns: false,
    includePersistent: false,
    includeMemory: false,
    persistRunSummary: false,
    persistExtractedConstraints: false,
    maxContextWindowTokens: undefined,
    contextWindowLimit: undefined,
    modelContextWindow: undefined,
  });
});
