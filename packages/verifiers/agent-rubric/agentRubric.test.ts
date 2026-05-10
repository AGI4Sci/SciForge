import assert from 'node:assert/strict';
import test from 'node:test';

import { CAPABILITY_BUDGET_DEBIT_CONTRACT_ID } from '@sciforge-ui/runtime-contract/capability-budget';

import { agentVerifierRequestFixture } from './fixture.js';
import { createMockAgentVerifierProvider } from './index.js';

test('mock agent verifier applies rubric over goal, artifact refs and trace refs', async () => {
  const verifier = createMockAgentVerifierProvider();
  const result = await verifier.verify(agentVerifierRequestFixture);

  assert.equal(result.schemaVersion, 'sciforge.agent-verifier-rubric.v1');
  assert.equal(result.verdict, 'pass');
  assert.equal(result.reward, 1);
  assert.deepEqual(result.evidenceRefs.sort(), ['artifact:report-json', 'result:final-answer', 'trace:run-001']);
  assert.equal(result.repairHints.length, 0);
  assert.equal(result.criterionScores.length, agentVerifierRequestFixture.rubric.criteria.length);
  assert.ok(result.resultRef.startsWith('verifier-result:agent-rubric:'));
  assert.ok(result.auditRefs[0]?.startsWith('audit:agent-rubric-verifier:'));
  assert.deepEqual(result.budgetDebitRefs, [result.budgetDebits[0]?.debitId]);
  assert.equal(result.budgetDebits[0]?.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
  assert.equal(result.budgetDebits[0]?.capabilityId, 'verifier.agent-rubric');
  assert.ok(result.budgetDebits[0]?.subjectRefs.includes(result.resultRef));
  assert.ok(result.budgetDebits[0]?.subjectRefs.includes('result:final-answer'));
  assert.deepEqual(result.budgetDebits[0]?.sinkRefs.auditRefs, result.auditRefs);
  assert.ok(result.budgetDebits[0]?.debitLines.some((line) => line.dimension === 'providers' && line.amount === 1));
});

test('mock agent verifier emits repair hints when required trace refs are absent', async () => {
  const verifier = createMockAgentVerifierProvider();
  const result = await verifier.verify({
    ...agentVerifierRequestFixture,
    traceRefs: [],
    providerHints: {
      maxVerifierProviders: 1,
      maxVerifierCostUnits: 2,
    },
  });

  assert.equal(result.verdict, 'needs-human');
  assert.ok(result.reward < 1);
  assert.ok(result.repairHints.some((hint) => hint.includes('trace')));
  assert.ok(result.budgetDebits[0]?.exhaustedDimensions.includes('providers'));
  assert.ok(result.budgetDebits[0]?.exhaustedDimensions.includes('costUnits'));
  assert.equal(result.budgetDebits[0]?.exceeded, true);
  assert.ok(result.budgetDebits[0]?.debitLines.some((line) => line.dimension === 'costUnits' && line.remaining === -1));
});
