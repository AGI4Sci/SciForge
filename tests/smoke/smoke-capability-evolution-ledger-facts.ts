import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID,
  type CapabilityEvolutionRecord,
  type CapabilityEvolutionRecordStatus,
} from '../../packages/contracts/runtime/capability-evolution.js';
import {
  appendCapabilityEvolutionRecord,
  readCapabilityEvolutionLedgerFacts,
} from '../../src/runtime/capability-evolution-ledger.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-capability-ledger-facts-'));
const recordedAt = '2026-05-10T02:00:00.000Z';

await appendCapabilityEvolutionRecord({ workspacePath: workspace }, record('success', 'succeeded'));
await appendCapabilityEvolutionRecord({
  workspacePath: workspace,
}, record('fallback-success', 'fallback-succeeded', {
  composedResult: {
    status: 'fallback-succeeded',
    failureCode: 'provider-unavailable',
    fallbackable: true,
    recoverActions: ['used atomic fallback'],
    atomicTrace: [{
      capabilityId: 'capability.atomic.search',
      providerId: 'provider:offline',
      status: 'succeeded',
      executionUnitRefs: ['unit:fallback-success:atomic'],
      artifactRefs: ['artifact:fallback-success:atomic.json'],
    }],
    relatedRefs: {
      executionUnitRefs: ['unit:fallback-success:atomic'],
      artifactRefs: ['artifact:fallback-success:atomic.json'],
    },
  },
}));
await appendCapabilityEvolutionRecord({
  workspacePath: workspace,
}, record('repair-failed', 'repair-failed', {
  failureCode: 'schema-invalid',
  repairAttempts: [{
    id: 'repair:repair-failed',
    status: 'attempted',
    reason: 'schema repair rerun did not produce required artifact',
    executionUnitRefs: ['unit:repair-failed:repair'],
    artifactRefs: ['artifact:repair-failed/report.json'],
    startedAt: recordedAt,
    completedAt: recordedAt,
  }],
  validationResult: {
    verdict: 'fail',
    validatorId: 'contract:report',
    failureCode: 'schema-invalid',
    summary: 'required field missing',
    resultRef: 'validation:repair-failed',
  },
}));
await appendCapabilityEvolutionRecord({ workspacePath: workspace }, record('needs-human', 'needs-human'));

const facts = await readCapabilityEvolutionLedgerFacts({ workspacePath: workspace });
assert.equal(facts.length, 4);
assert.deepEqual(facts.map((fact) => fact.recordRef), [
  '.sciforge/capability-evolution-ledger/records.jsonl#L1',
  '.sciforge/capability-evolution-ledger/records.jsonl#L2',
  '.sciforge/capability-evolution-ledger/records.jsonl#L3',
  '.sciforge/capability-evolution-ledger/records.jsonl#L4',
]);

const success = facts.find((fact) => fact.recordId === 'success')!;
assert.deepEqual(success.factKinds, ['success']);
assert.deepEqual(success.selectedCapabilityIds, ['capability.primary.success']);

const fallback = facts.find((fact) => fact.recordId === 'fallback-success')!;
assert.deepEqual(fallback.factKinds, ['fallback', 'success']);
assert.equal(fallback.failureCode, 'provider-unavailable');
assert.equal(fallback.fallbackable, true);
assert.ok(fallback.executionUnitRefs.includes('unit:fallback-success:primary'));

const repair = facts.find((fact) => fact.recordId === 'repair-failed')!;
assert.deepEqual(repair.factKinds, ['failure', 'repair']);
assert.equal(repair.repairAttemptCount, 1);
assert.equal(repair.failureCode, 'schema-invalid');
assert.equal(repair.validationSummary, 'required field missing');

const human = facts.find((fact) => fact.recordId === 'needs-human')!;
assert.deepEqual(human.factKinds, ['failure', 'needs-human']);
assert.equal(human.finalStatus, 'needs-human');

console.log('[ok] capability evolution ledger projects success, failure, fallback, repair, and needs-human records into compact facts');

function record(
  id: string,
  finalStatus: CapabilityEvolutionRecordStatus,
  overrides: Partial<CapabilityEvolutionRecord> = {},
): CapabilityEvolutionRecord {
  return {
    schemaVersion: CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID,
    id,
    recordedAt,
    runId: `run:${id}`,
    sessionId: 'session:ledger-facts',
    goalSummary: `ledger fact ${id}`,
    selectedCapabilities: [{
      id: `capability.primary.${id}`,
      role: 'primary',
      providerId: 'provider:offline',
    }],
    providers: [{
      id: 'provider:offline',
      kind: 'local-runtime',
    }],
    inputSchemaRefs: ['schema:input'],
    outputSchemaRefs: ['schema:output'],
    executionUnitRefs: [`unit:${id}:primary`],
    artifactRefs: [`artifact:${id}/report.json`],
    recoverActions: [],
    repairAttempts: [],
    finalStatus,
    ...overrides,
  };
}
