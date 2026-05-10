import assert from 'node:assert/strict';
import test from 'node:test';

import { CAPABILITY_BUDGET_DEBIT_CONTRACT_ID } from '@sciforge-ui/runtime-contract/capability-budget';

import { createHumanApprovalFixtureProvider, type HumanApprovalVerifierRequest } from './human-approval.js';

const humanApprovalRequestFixture: HumanApprovalVerifierRequest = {
  goal: 'Confirm the high-risk action trace is acceptable.',
  resultRefs: ['result:final-answer'],
  artifactRefs: ['artifact:approval-summary'],
  traceRefs: ['trace:action-run-001'],
  stateRefs: ['state:desktop-after-action'],
  verificationPolicy: {
    required: true,
    mode: 'human',
    riskLevel: 'high',
  },
  decision: {
    decision: 'accept',
    decisionRef: 'human-approval:decision-001',
    approverRef: 'user:reviewer-001',
    confidence: 0.93,
    comment: 'Approved after reviewing the trace and result.',
    evidenceRefs: ['artifact:signed-approval'],
  },
};

test('human approval fixture maps acceptance into a budget-debited verifier result', async () => {
  const verifier = createHumanApprovalFixtureProvider();
  const result = await verifier.verify(humanApprovalRequestFixture);

  assert.equal(result.schemaVersion, 'sciforge.verification.result.v1');
  assert.equal(result.verdict, 'pass');
  assert.equal(result.reward, 1);
  assert.equal(result.confidence, 0.93);
  assert.deepEqual(result.evidenceRefs.sort(), [
    'artifact:approval-summary',
    'artifact:signed-approval',
    'result:final-answer',
    'state:desktop-after-action',
    'trace:action-run-001',
  ]);
  assert.ok(result.resultRef.startsWith('verifier-result:human-approval:'));
  assert.ok(result.auditRefs[0]?.startsWith('audit:human-approval-verifier:'));
  assert.deepEqual(result.budgetDebitRefs, [result.budgetDebits[0]?.debitId]);
  assert.equal(result.budgetDebits[0]?.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
  assert.equal(result.budgetDebits[0]?.capabilityId, 'verifier.fixture.human-approval');
  assert.ok(result.budgetDebits[0]?.subjectRefs.includes(result.resultRef));
  assert.ok(result.budgetDebits[0]?.subjectRefs.includes('result:final-answer'));
  assert.ok(result.budgetDebits[0]?.subjectRefs.includes('artifact:approval-summary'));
  assert.ok(result.budgetDebits[0]?.subjectRefs.includes('trace:action-run-001'));
  assert.ok(result.budgetDebits[0]?.subjectRefs.includes('artifact:signed-approval'));
  assert.deepEqual(result.budgetDebits[0]?.sinkRefs.auditRefs, result.auditRefs);
  assert.ok(result.budgetDebits[0]?.debitLines.some((line) => line.dimension === 'providers' && line.amount === 1));
  assert.ok(result.budgetDebits[0]?.debitLines.some((line) => line.dimension === 'costUnits' && line.amount === 1));
});

test('human approval fixture debits needs-human timeout against provider budgets', async () => {
  const verifier = createHumanApprovalFixtureProvider();
  const result = await verifier.verify({
    ...humanApprovalRequestFixture,
    decision: {
      decision: 'timeout',
      decisionRef: 'human-approval:decision-timeout',
    },
    providerHints: {
      maxVerifierProviders: 1,
      maxVerifierCostUnits: 0,
    },
  });

  assert.equal(result.verdict, 'needs-human');
  assert.ok(result.repairHints.some((hint) => hint.includes('human approval')));
  assert.ok(result.budgetDebits[0]?.exhaustedDimensions.includes('providers'));
  assert.equal(result.budgetDebits[0]?.exceeded, true);
  assert.ok(result.budgetDebits[0]?.debitLines.some((line) => line.dimension === 'costUnits' && line.remaining === -1));
});
