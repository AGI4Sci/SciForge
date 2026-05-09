import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConversationTurnComposition } from './conversation-service-plan.js';

test('turn composition scopes session facts for isolated turns', () => {
  const composition = buildConversationTurnComposition({
    policyInput: {
      session: {
        messages: [{ id: 'm1', content: 'prior task' }],
        artifacts: [{ id: 'old-artifact' }],
        executionUnits: [{ id: 'old-unit' }],
        runs: [{ id: 'old-run' }],
      },
      references: [],
    },
    contextPolicy: { mode: 'isolate', historyReuse: { allowed: false } },
    memoryPlan: { currentReferenceFocus: [] },
    currentReferenceDigests: [{ id: 'digest-1', path: 'file:reports/current.md' }],
  });

  assert.deepEqual(composition.contextSession.artifacts, []);
  assert.deepEqual(composition.contextSession.executionUnits, []);
  assert.deepEqual(composition.contextSession.runs, []);
  assert.deepEqual(composition.contextSession.messages, [{ id: 'm1', content: 'prior task' }]);
  assert.deepEqual(composition.currentReferences, [{
    kind: 'file',
    ref: 'reports/current.md',
    title: 'current.md',
    source: 'python-reference-digest',
    digestId: 'digest-1',
  }]);
});

test('turn composition keeps session for continuation and preserves explicit refs', () => {
  const session = {
    artifacts: [{ id: 'report' }],
    executionUnits: [{ id: 'unit' }],
    runs: [{ id: 'run' }],
  };
  const explicitRef = { kind: 'file', ref: 'inputs/current.csv', title: 'current.csv' };
  const composition = buildConversationTurnComposition({
    policyInput: { session, references: [explicitRef] },
    contextPolicy: { mode: 'continue', historyReuse: { allowed: true } },
    memoryPlan: { currentReferenceFocus: ['inputs/current.csv'] },
    currentReferenceDigests: [{ id: 'digest-ignored', path: 'file:reports/current.md' }],
  });

  assert.equal(composition.contextSession, session);
  assert.deepEqual(composition.currentReferences, [explicitRef]);
});
