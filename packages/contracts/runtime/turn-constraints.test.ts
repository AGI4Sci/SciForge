import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeTurnExecutionConstraints,
  TURN_EXECUTION_CONSTRAINTS_SCHEMA_VERSION,
} from './turn-constraints.js';

test('turn constraints normalize only versioned structured records', () => {
  const constraints = structuredTurnConstraints();

  assert.deepEqual(normalizeTurnExecutionConstraints(constraints), constraints);
  assert.equal(normalizeTurnExecutionConstraints({ schemaVersion: 'old' }), undefined);
  assert.equal(normalizeTurnExecutionConstraints('Do not execute or call AgentServer'), undefined);
});

test('turn constraints do not infer policy from prompt-only records', () => {
  assert.equal(normalizeTurnExecutionConstraints({
    prompt: '不要重跑、不要执行，也不要调用 AgentServer。只基于当前会话 refs/digest 列出证据缺口。',
    referenceCount: 1,
  }), undefined);
});

test('turn constraints normalize optional hint and evidence fields safely', () => {
  const constraints = normalizeTurnExecutionConstraints({
    ...structuredTurnConstraints(),
    preferredCapabilityIds: ['runtime.direct-context-answer', '', 42],
    executionModeHint: 'direct-context-answer',
    initialResponseModeHint: 'direct-context-answer',
    reasons: ['policy contract', '', 42],
    evidence: {
      hasPriorContext: true,
      referenceCount: 2,
      artifactCount: -1,
      executionRefCount: 1.5,
      runCount: 1,
    },
  });

  assert.ok(constraints);
  assert.deepEqual(constraints.preferredCapabilityIds, ['runtime.direct-context-answer']);
  assert.deepEqual(constraints.reasons, ['policy contract']);
  assert.deepEqual(constraints.evidence, {
    hasPriorContext: true,
    referenceCount: 2,
    artifactCount: 0,
    executionRefCount: 0,
    runCount: 1,
  });
});

function structuredTurnConstraints() {
  return {
    schemaVersion: TURN_EXECUTION_CONSTRAINTS_SCHEMA_VERSION,
    policyId: 'sciforge.current-turn-execution-constraints.v1',
    source: 'runtime-contract.turn-constraints',
    contextOnly: true,
    agentServerForbidden: true,
    workspaceExecutionForbidden: true,
    externalIoForbidden: true,
    codeExecutionForbidden: true,
    preferredCapabilityIds: ['runtime.direct-context-answer'],
    executionModeHint: 'direct-context-answer',
    initialResponseModeHint: 'direct-context-answer',
    reasons: ['upstream policy forbids execution'],
    evidence: {
      hasPriorContext: true,
      referenceCount: 1,
      artifactCount: 0,
      executionRefCount: 0,
      runCount: 0,
    },
  };
}
