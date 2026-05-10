import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID,
} from '@sciforge-ui/runtime-contract/capability-evolution';
import {
  type RepairBudgetSnapshot,
  type ValidationFinding,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import {
  buildCapabilityEvolutionCompactSummary,
  CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH,
  readCapabilityEvolutionRecords,
} from '../../src/runtime/capability-evolution-ledger';
import {
  projectValidationRepairAuditSink,
  writeValidationRepairAuditSinkLedgerRecords,
} from '../../src/runtime/gateway/validation-repair-audit-sink';
import { createValidationRepairAuditChain } from '../../src/runtime/gateway/validation-repair-audit-bridge';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-validation-repair-ledger-sink-'));
const createdAt = '2026-05-10T01:00:00.000Z';
const repairBudget: RepairBudgetSnapshot = {
  maxAttempts: 1,
  remainingAttempts: 1,
  maxSupplementAttempts: 1,
  remainingSupplementAttempts: 0,
};

const chain = createValidationRepairAuditChain({
  chainId: 'capability-ledger-sink',
  subject: {
    kind: 'verification-gate',
    id: 'capability-ledger-sink',
    capabilityId: 'sciforge.runtime-verification-gate',
    contractId: 'sciforge.verification-result.v1',
    completedPayloadRef: 'run:capability-ledger-sink/output.json',
    artifactRefs: ['artifact:capability-ledger-sink/report.json'],
    currentRefs: ['current:user-request'],
  },
  findings: [blockingFinding()],
  repairBudget,
  sinkRefs: [
    'appendTaskAttempt:capability-ledger-sink',
    'ledger:capability-ledger-sink',
    'observe-invocation:capability-ledger-sink',
  ],
  telemetrySpanRefs: ['span:validation:capability-ledger-sink'],
  createdAt,
});

const projection = projectValidationRepairAuditSink(chain, { targets: ['ledger'] });
assert.equal(projection.records.length, 1);
assert.equal(projection.records[0]?.target, 'ledger');

const writes = await writeValidationRepairAuditSinkLedgerRecords(chain, {
  workspacePath: workspace,
  now: () => new Date(createdAt),
  sessionId: 'session:capability-ledger-sink',
});
assert.equal(writes.length, 1);
assert.equal(writes[0]?.ref, CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH);
assert.equal(writes[0]?.fact.auditId, chain.audit.auditId);
assert.equal(writes[0]?.fact.contractId, 'sciforge.verification-result.v1');
assert.equal(writes[0]?.fact.failureKind, 'runtime-verification');
assert.equal(writes[0]?.fact.repairAction, chain.repair.action);
assert.ok(writes[0]?.fact.sinkRefs.includes('ledger:capability-ledger-sink'));

const records = await readCapabilityEvolutionRecords({ workspacePath: workspace });
assert.equal(records.length, 1);
const record = records[0]!;
assert.equal(record.schemaVersion, CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID);
assert.equal(record.failureCode, 'runtime-verification');
assert.equal(record.validationResult?.failureCode, 'runtime-verification');
assert.equal(record.validationResult?.validatorId, 'contract:sciforge.verification-result.v1');
assert.equal(record.metadata?.source, 'validation-repair-audit-sink');
assert.equal((record.metadata?.validationRepairAudit as Record<string, unknown> | undefined)?.repairAction, chain.repair.action);
assert.ok(record.recoverActions.includes(`repair-action:${chain.repair.action}`));
assert.ok(record.recoverActions.includes('contract:sciforge.verification-result.v1'));
assert.ok(record.executionUnitRefs.includes('ledger:capability-ledger-sink'));
assert.ok(record.executionUnitRefs.includes(chain.audit.auditId));

const summary = await buildCapabilityEvolutionCompactSummary({
  workspacePath: workspace,
  now: () => new Date(createdAt),
});
assert.equal(summary.totalRecords, 1);
assert.equal(summary.repairRecordCount, 1);
assert.equal(summary.sourceRef, CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH);
const compact = summary.recentRecords[0]!;
assert.equal(compact.recordRef, `${CAPABILITY_EVOLUTION_LEDGER_RELATIVE_PATH}#L1`);
assert.equal(compact.failureCode, 'runtime-verification');
assert.ok(compact.validationSummary?.includes('contract sciforge.verification-result.v1'));
assert.ok(compact.validationSummary?.includes(`repair action ${chain.repair.action}`));
assert.ok(compact.recoverActions.includes(`repair-action:${chain.repair.action}`));
assert.ok(compact.recoverActions.includes('sink-ref:ledger:capability-ledger-sink'));
assert.ok(compact.executionUnitRefs.includes('ledger:capability-ledger-sink'));

console.log('[ok] validation/repair/audit ledger sink writes capability evolution records, compact facts, and readable ledger summaries');

function blockingFinding(): ValidationFinding {
  return {
    id: 'finding:capability-ledger-sink',
    source: 'runtime-verification-result',
    kind: 'runtime-verification',
    severity: 'blocking',
    message: 'Runtime verification failed and should be preserved in the capability evolution ledger.',
    contractId: 'sciforge.verification-result.v1',
    schemaPath: 'packages/contracts/runtime/verification-result.ts#RuntimeVerificationResult',
    capabilityId: 'sciforge.runtime-verification-gate',
    relatedRefs: ['run:capability-ledger-sink/output.json', 'verification:gate'],
    recoverActions: ['preserve failed verification gate result in audit'],
    issues: [{
      path: 'verificationResults[0].verdict',
      message: 'expected pass',
      expected: 'pass',
      actual: 'fail',
    }],
  };
}
