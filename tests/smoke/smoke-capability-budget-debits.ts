import assert from 'node:assert/strict';

import {
  CAPABILITY_BUDGET_DEBIT_CONTRACT_ID,
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
} from '@sciforge-ui/runtime-contract/capability-budget';

const debitLines: CapabilityBudgetDebitLine[] = [
  {
    dimension: 'toolCalls',
    amount: 1,
    limit: 3,
    remaining: 2,
    reason: 'capability invocation called one tool',
    sourceRef: 'tool:pubmed.search',
  },
  {
    dimension: 'networkCalls',
    amount: 1,
    limit: 1,
    remaining: 0,
    reason: 'provider request consumed the remaining network call budget',
    sourceRef: 'provider:pubmed',
  },
  {
    dimension: 'resultItems',
    amount: 0,
    limit: 30,
    remaining: 30,
  },
];

const record = createCapabilityBudgetDebitRecord({
  debitId: 'budget-debit:invoke-1',
  invocationId: 'capability-invocation:1',
  capabilityId: 'tool.pubmed-search',
  candidateId: 'candidate:tool.pubmed-search',
  manifestRef: 'capability:tool.pubmed-search',
  subjectRefs: ['run:research-1', 'run:research-1', 'artifact:evidence-matrix'],
  debitLines,
  sinkRefs: {
    executionUnitRef: 'executionUnit:research-1',
    workEvidenceRefs: ['workEvidence:provider-attempt-1', 'workEvidence:provider-attempt-1'],
    auditRefs: ['audit:capability-broker-1'],
  },
  createdAt: '2026-05-10T00:00:00.000Z',
  metadata: {
    profileId: 'research-grade',
  },
});

assert.equal(record.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
assert.equal(record.schemaVersion, 1);
assert.equal(record.capabilityId, 'tool.pubmed-search');
assert.equal(record.invocationId, 'capability-invocation:1');
assert.deepEqual(record.subjectRefs, ['run:research-1', 'artifact:evidence-matrix']);
assert.deepEqual(record.debitLines.map((line) => line.dimension), ['toolCalls', 'networkCalls']);
assert.equal(record.debitLines.find((line) => line.dimension === 'toolCalls')?.amount, 1);
assert.equal(record.exceeded, false);
assert.deepEqual(record.exhaustedDimensions, ['networkCalls']);
assert.equal(record.sinkRefs.executionUnitRef, 'executionUnit:research-1');
assert.deepEqual(record.sinkRefs.workEvidenceRefs, ['workEvidence:provider-attempt-1']);
assert.deepEqual(record.sinkRefs.auditRefs, ['audit:capability-broker-1']);
assert.equal(record.metadata?.profileId, 'research-grade');

console.log('[ok] capability invocation budget debit record is contract-shaped and sink-addressable');
