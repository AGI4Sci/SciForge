import assert from 'node:assert/strict';

import {
  createAuditRecord,
  createValidationDecision,
  decideRepairPolicy,
  type RepairBudgetSnapshot,
  type ValidationFinding,
  type ValidationRepairAuditSinkTarget,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import {
  projectValidationRepairAuditSink,
  validationRepairAuditAttemptMetadataFromPayload,
  validationRepairAuditSinkProjectionFromPayload,
} from '../../src/runtime/gateway/validation-repair-audit-sink';
import { createValidationRepairAuditChain } from '../../src/runtime/gateway/validation-repair-audit-bridge';

const createdAt = '2026-05-10T00:00:00.000Z';
const repairBudget: RepairBudgetSnapshot = {
  maxAttempts: 1,
  remainingAttempts: 1,
  maxSupplementAttempts: 1,
  remainingSupplementAttempts: 0,
};
const expectedTargets: ValidationRepairAuditSinkTarget[] = [
  'appendTaskAttempt',
  'ledger',
  'verification-artifact',
  'observe-invocation',
];

const chain = createValidationRepairAuditChain({
  chainId: 'audit-sink-bridge',
  subject: {
    kind: 'verification-gate',
    id: 'audit-sink-bridge',
    capabilityId: 'sciforge.runtime-verification-gate',
    contractId: 'sciforge.verification-result.v1',
    completedPayloadRef: 'run:audit-sink/output.json',
    artifactRefs: ['artifact:chart'],
    currentRefs: ['current:user-request'],
  },
  findings: [blockingFinding('audit-sink-bridge')],
  repairBudget,
  sinkRefs: [
    'appendTaskAttempt:audit-sink-bridge',
    'ledger:audit-sink-bridge',
    'observe-invocation:audit-sink-bridge',
  ],
  telemetrySpanRefs: ['span:validation:audit-sink-bridge', 'span:repair:audit-sink-bridge'],
  createdAt,
});

const projection = projectValidationRepairAuditSink(chain);
assert.deepEqual(projection.refs.map((ref) => ref.target).sort(), [...expectedTargets].sort());
assert.deepEqual(projection.records.map((record) => record.target).sort(), [...expectedTargets].sort());
assert.equal(projection.auditRecords[0]?.auditId, chain.audit.auditId);
assert.equal(projection.attemptMetadata?.auditRefs[0]?.ref, chain.audit.auditId);
assert.equal(projection.attemptMetadata?.auditRecords[0]?.auditId, chain.audit.auditId);

const appendAttemptRef = projection.refs.find((ref) => ref.target === 'appendTaskAttempt');
assert.equal(appendAttemptRef?.ref, 'appendTaskAttempt:audit-sink-bridge');
assert.equal(appendAttemptRef?.contractId, 'sciforge.verification-result.v1');
assert.equal(appendAttemptRef?.failureKind, 'runtime-verification');
assert.equal(appendAttemptRef?.outcome, 'repair-requested');
assert.ok(appendAttemptRef?.relatedRefs.includes('run:audit-sink/output.json'));

const ledgerRecord = projection.records.find((record) => record.target === 'ledger');
assert.equal(ledgerRecord?.ref, 'ledger:audit-sink-bridge');
assert.equal(ledgerRecord?.auditRecord.auditId, chain.audit.auditId);
assert.equal(ledgerRecord?.validationDecision?.decisionId, chain.validation.decisionId);
assert.equal(ledgerRecord?.repairDecision?.decisionId, chain.repair.decisionId);

const generatedVerificationArtifactRef = projection.refs.find((ref) => ref.target === 'verification-artifact');
assert.equal(
  generatedVerificationArtifactRef?.ref,
  `verification-artifact:${chain.audit.auditId}`,
  'targets without explicit audit.sinkRefs should get deterministic refs',
);

const payloadProjection = validationRepairAuditSinkProjectionFromPayload({
  refs: {
    validationRepairAudit: {
      validationDecision: chain.validation,
      repairDecision: chain.repair,
      auditRecord: chain.audit,
    },
  },
  executionUnits: [{
    refs: {
      validationRepairAudit: {
        validationDecision: chain.validation,
        repairDecision: chain.repair,
        auditRecord: chain.audit,
      },
    },
  }],
});
assert.equal(payloadProjection?.auditRecords.length, 1, 'payload projection should dedupe repeated audit chains');
assert.equal(payloadProjection?.refs.length, expectedTargets.length);

const attemptMetadata = validationRepairAuditAttemptMetadataFromPayload({
  validationRepairAudit: {
    validationDecision: chain.validation,
    repairDecision: chain.repair,
    auditRecord: chain.audit,
  },
});
assert.equal(attemptMetadata?.auditRefs.length, 1);
assert.equal(attemptMetadata?.auditRefs[0]?.sinkRefs.includes('ledger:audit-sink-bridge'), true);
assert.equal(attemptMetadata?.auditRecords[0]?.auditId, chain.audit.auditId);

const validation = createValidationDecision({
  decisionId: 'validation:direct-sink',
  subject: {
    kind: 'direct-payload',
    id: 'direct-sink',
    capabilityId: 'agentserver.direct-payload',
    contractId: 'sciforge.tool-payload.v1',
    completedPayloadRef: 'run:direct-sink/output.json',
    artifactRefs: [],
    currentRefs: ['current:user-request'],
  },
  findings: [blockingFinding('direct-sink')],
  relatedRefs: ['run:direct-sink/output.json'],
  createdAt,
});
const repair = decideRepairPolicy({
  decisionId: 'repair:direct-sink',
  validation,
  budget: repairBudget,
  createdAt,
});
const audit = createAuditRecord({
  auditId: 'audit:direct-sink',
  validation,
  repair,
  sinkRefs: ['appendTaskAttempt:direct-sink'],
  telemetrySpanRefs: ['span:direct-sink'],
  createdAt,
});
const directProjection = projectValidationRepairAuditSink({
  validationDecision: validation,
  repairDecision: repair,
  auditRecord: audit,
});
assert.equal(directProjection.refs.length, expectedTargets.length);
assert.equal(directProjection.records.find((record) => record.target === 'appendTaskAttempt')?.auditRecord.auditId, 'audit:direct-sink');
assert.equal(directProjection.refs.find((ref) => ref.target === 'ledger')?.ref, 'ledger:audit:direct-sink');

console.log('[ok] validation/repair/audit sink projects audit chains into appendTaskAttempt, ledger, verification artifact, and observe invocation refs/records');

function blockingFinding(id: string): ValidationFinding {
  return {
    id: `finding:${id}`,
    source: 'runtime-verification-result',
    kind: 'runtime-verification',
    severity: 'blocking',
    message: 'Runtime verification failed.',
    contractId: 'sciforge.verification-result.v1',
    schemaPath: 'packages/contracts/runtime/verification-result.ts#RuntimeVerificationResult',
    capabilityId: 'sciforge.runtime-verification-gate',
    relatedRefs: [`run:${id}/output.json`, 'verification:gate'],
    recoverActions: ['preserve failed verification gate result in audit'],
    issues: [{
      path: 'verificationResults[0].verdict',
      message: 'expected pass',
      expected: 'pass',
      actual: 'fail',
    }],
  };
}
