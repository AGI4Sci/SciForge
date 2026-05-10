import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type RepairBudgetSnapshot,
  type ValidationFinding,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import {
  buildValidationRepairAuditSinkVerificationArtifactSummary,
  projectValidationRepairAuditSink,
  readValidationRepairAuditSinkVerificationArtifacts,
  VALIDATION_REPAIR_AUDIT_VERIFICATION_ARTIFACT_CONTRACT_ID,
  VALIDATION_REPAIR_AUDIT_VERIFICATION_ARTIFACTS_RELATIVE_DIR,
  writeValidationRepairAuditSinkVerificationArtifacts,
} from '../../src/runtime/gateway/validation-repair-audit-sink';
import { createValidationRepairAuditChain } from '../../src/runtime/gateway/validation-repair-audit-bridge';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-validation-repair-verification-artifact-sink-'));
const createdAt = '2026-05-10T02:00:00.000Z';
const repairBudget: RepairBudgetSnapshot = {
  maxAttempts: 1,
  remainingAttempts: 1,
  maxSupplementAttempts: 1,
  remainingSupplementAttempts: 0,
};

const chain = createValidationRepairAuditChain({
  chainId: 'verification-artifact-sink',
  subject: {
    kind: 'verification-gate',
    id: 'verification-artifact-sink',
    capabilityId: 'sciforge.runtime-verification-gate',
    contractId: 'sciforge.verification-result.v1',
    completedPayloadRef: 'run:verification-artifact-sink/output.json',
    artifactRefs: ['verifications/verification-artifact-sink/result.json'],
    currentRefs: ['current:user-request'],
  },
  findings: [blockingFinding()],
  repairBudget,
  sinkRefs: [
    'appendTaskAttempt:verification-artifact-sink',
    'verification-artifact:verifications/verification-artifact-sink/result.json',
    'ledger:verification-artifact-sink',
  ],
  telemetrySpanRefs: ['span:verification-gate:verification-artifact-sink'],
  createdAt,
});

const projection = projectValidationRepairAuditSink(chain, { targets: ['verification-artifact'] });
assert.equal(projection.records.length, 1);
assert.equal(projection.records[0]?.target, 'verification-artifact');
assert.equal(
  projection.records[0]?.ref,
  'verification-artifact:verifications/verification-artifact-sink/result.json',
);

const writes = await writeValidationRepairAuditSinkVerificationArtifacts(chain, {
  workspacePath: workspace,
  now: () => new Date(createdAt),
});
assert.equal(writes.length, 1);
const write = writes[0]!;
assert.equal(write.ref, `${VALIDATION_REPAIR_AUDIT_VERIFICATION_ARTIFACTS_RELATIVE_DIR}/audit-verification-artifact-sink.json`);
assert.equal(write.artifact.contract, VALIDATION_REPAIR_AUDIT_VERIFICATION_ARTIFACT_CONTRACT_ID);
assert.equal(write.artifact.auditId, chain.audit.auditId);
assert.equal(write.artifact.contractId, 'sciforge.verification-result.v1');
assert.equal(write.artifact.failureKind, 'runtime-verification');
assert.equal(write.artifact.sourceSinkRef, 'verification-artifact:verifications/verification-artifact-sink/result.json');
assert.equal(write.fact.auditId, chain.audit.auditId);
assert.equal(write.fact.contractId, 'sciforge.verification-result.v1');
assert.equal(write.fact.failureKind, 'runtime-verification');
assert.equal(write.fact.sourceSinkRef, 'verification-artifact:verifications/verification-artifact-sink/result.json');
assert.ok(write.fact.sinkRefs.includes('verification-artifact:verifications/verification-artifact-sink/result.json'));
assert.ok(write.fact.sinkRefs.includes('ledger:verification-artifact-sink'));

const artifactStat = await stat(write.path);
assert.ok(artifactStat.isFile());
const raw = await readFile(write.path, 'utf8');
const persisted = JSON.parse(raw) as typeof write.artifact;
assert.equal(persisted.auditId, chain.audit.auditId);
assert.equal(persisted.validationDecisionId, chain.validation.decisionId);
assert.equal(persisted.repairDecisionId, chain.repair.decisionId);
assert.ok(persisted.relatedRefs.includes('run:verification-artifact-sink/output.json'));
assert.ok(persisted.telemetrySpanRefs.includes('span:verification-gate:verification-artifact-sink'));

const artifacts = await readValidationRepairAuditSinkVerificationArtifacts({ workspacePath: workspace });
assert.equal(artifacts.length, 1);
assert.equal(artifacts[0]?.auditId, chain.audit.auditId);
assert.equal(artifacts[0]?.contractId, 'sciforge.verification-result.v1');
assert.equal(artifacts[0]?.failureKind, 'runtime-verification');
assert.ok(artifacts[0]?.sinkRefs.includes('verification-artifact:verifications/verification-artifact-sink/result.json'));

const summary = await buildValidationRepairAuditSinkVerificationArtifactSummary({
  workspacePath: workspace,
  now: () => new Date('2026-05-10T02:00:01.000Z'),
});
assert.equal(summary.kind, 'validation-repair-audit-sink-artifact-summary');
assert.equal(summary.target, 'verification-artifact');
assert.equal(summary.sourceRef, VALIDATION_REPAIR_AUDIT_VERIFICATION_ARTIFACTS_RELATIVE_DIR);
assert.equal(summary.generatedAt, '2026-05-10T02:00:01.000Z');
assert.equal(summary.totalArtifacts, 1);
assert.deepEqual(summary.auditIds, [chain.audit.auditId]);
assert.equal(summary.failureKindCounts['runtime-verification'], 1);
assert.ok(summary.sourceSinkRefs.includes('verification-artifact:verifications/verification-artifact-sink/result.json'));

console.log('[ok] validation/repair/audit verification artifact sink writes stable readable artifact json and compact facts');

function blockingFinding(): ValidationFinding {
  return {
    id: 'finding:verification-artifact-sink',
    source: 'runtime-verification-result',
    kind: 'runtime-verification',
    severity: 'blocking',
    message: 'Runtime verification failed and should be preserved as a verification artifact.',
    contractId: 'sciforge.verification-result.v1',
    schemaPath: 'packages/contracts/runtime/verification-result.ts#RuntimeVerificationResult',
    capabilityId: 'sciforge.runtime-verification-gate',
    relatedRefs: ['run:verification-artifact-sink/output.json', 'verification:gate'],
    recoverActions: ['preserve failed verification gate result in artifact'],
    issues: [{
      path: 'verificationResults[0].verdict',
      message: 'expected pass',
      expected: 'pass',
      actual: 'fail',
    }],
  };
}
