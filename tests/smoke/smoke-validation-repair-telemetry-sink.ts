import assert from 'node:assert/strict';

import {
  type RepairBudgetSnapshot,
  type ValidationFinding,
  type ValidationRepairTelemetrySpanKind,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import { executeRepairActionPlan } from '../../src/runtime/gateway/repair-executor';
import {
  projectValidationRepairTelemetrySpans,
  validationRepairTelemetrySpansFromPayload,
} from '../../src/runtime/gateway/validation-repair-telemetry-sink';
import { createValidationRepairAuditChain } from '../../src/runtime/gateway/validation-repair-audit-bridge';

const createdAt = '2026-05-10T00:00:00.000Z';
const repairBudget: RepairBudgetSnapshot = {
  maxAttempts: 1,
  remainingAttempts: 1,
  maxSupplementAttempts: 0,
  remainingSupplementAttempts: 0,
};
const expectedKinds: ValidationRepairTelemetrySpanKind[] = [
  'generation/request',
  'materialize',
  'payload-validation',
  'work-evidence',
  'verification-gate',
  'repair-decision',
  'repair-rerun',
  'ledger-write',
  'observe-invocation',
];

const chain = createValidationRepairAuditChain({
  chainId: 'telemetry-sink',
  subject: {
    kind: 'generated-task-result',
    id: 'telemetry-sink',
    capabilityId: 'agentserver.direct-payload',
    contractId: 'sciforge.tool-payload.v1',
    completedPayloadRef: 'run:telemetry/output.json',
    generatedTaskRef: 'task:telemetry/request.py',
    observeTraceRef: 'observe:telemetry-trace',
    actionTraceRef: 'action:telemetry-trace',
    artifactRefs: ['artifact:telemetry-report'],
    currentRefs: ['current:user-request'],
  },
  findings: [blockingFinding('telemetry-sink')],
  workEvidence: [{
    kind: 'validate',
    status: 'repair-needed',
    provider: 'validation-repair-telemetry-smoke',
    outputSummary: 'Payload validation failed and produced repair evidence.',
    evidenceRefs: ['run:telemetry/output.json', 'artifact:telemetry-report'],
    failureReason: 'claims missing',
    recoverActions: ['rerun the failed generation request'],
    rawRef: 'work-evidence:telemetry-sink',
  }],
  runtimeVerificationResults: [{
    id: 'verification:telemetry-gate',
    verdict: 'fail',
    confidence: 0.8,
    critique: 'Generated report missed required claim evidence.',
    evidenceRefs: ['verification:telemetry-artifact'],
    repairHints: ['rerun with evidence refs'],
  }],
  repairBudget,
  sinkRefs: [
    'appendTaskAttempt:telemetry-sink',
    'ledger:telemetry-sink',
    'observe-invocation:telemetry-sink',
  ],
  telemetrySpanRefs: [
    'span:payload-validation:telemetry-sink',
    'span:repair-decision:telemetry-sink',
  ],
  runtimeVerificationPolicyId: 'verification-policy:telemetry',
  relatedRefs: ['request:telemetry-generation'],
  createdAt,
});

const executorResult = await executeRepairActionPlan({
  validationDecision: chain.validation,
  repairDecision: chain.repair,
  auditRecord: chain.audit,
  actionPlan: {
    planId: 'plan:telemetry-rerun',
    action: 'rerun',
    targetRef: 'task:telemetry/request.py',
    outputRef: 'run:telemetry/rerun-output.json',
    expectedRefs: ['artifact:telemetry-rerun-report'],
    createdAt,
  },
  createdAt,
}, {
  rerun: () => ({
    refs: ['run:telemetry/rerun-output.json', 'artifact:telemetry-rerun-report'],
    summary: 'Reran failed generation for telemetry projection.',
  }),
});

const projection = projectValidationRepairTelemetrySpans({
  validationDecision: chain.validation,
  repairDecision: chain.repair,
  auditRecord: chain.audit,
  executorResult,
});
const actualKinds = projection.spans.map((span) => span.spanKind).sort();
assert.deepEqual(actualKinds, [...expectedKinds].sort());
assert.equal(projection.spanRefs.length, expectedKinds.length);
assert.ok(projection.sourceRefs.includes('run:telemetry/output.json'));
assert.ok(projection.sourceRefs.includes('run:telemetry/rerun-output.json'));
assert.ok(projection.auditRefs.includes(chain.audit.auditId));
assert.ok(projection.auditRefs.includes('ledger:telemetry-sink'));
assert.ok(projection.repairRefs.includes(chain.repair.decisionId));
assert.ok(projection.repairRefs.includes(executorResult.executorRef.ref));

const payloadValidation = projection.spans.find((span) => span.spanKind === 'payload-validation');
assert.equal(payloadValidation?.ref, 'span:payload-validation:telemetry-sink');
assert.equal(payloadValidation?.status, 'failed');
assert.equal(payloadValidation?.validationDecisionId, chain.validation.decisionId);
assert.equal(payloadValidation?.repairDecisionId, chain.repair.decisionId);
assert.equal(payloadValidation?.auditId, chain.audit.auditId);
assert.equal(payloadValidation?.executorResultId, executorResult.executorResultId);
assert.ok(payloadValidation?.sourceRefs.includes('run:telemetry/output.json'));
assert.ok(payloadValidation?.auditRefs.includes(chain.audit.auditId));
assert.ok(payloadValidation?.repairRefs.includes(chain.repair.decisionId));

const repairRerun = projection.spans.find((span) => span.spanKind === 'repair-rerun');
assert.equal(repairRerun?.status, 'executed');
assert.equal(repairRerun?.action, 'rerun');
assert.ok(repairRerun?.sourceRefs.includes('run:telemetry/rerun-output.json'));
assert.ok(repairRerun?.relatedRefs.includes('artifact:telemetry-rerun-report'));

const observe = projection.spans.find((span) => span.spanKind === 'observe-invocation');
assert.ok(observe?.sourceRefs.includes('observe:telemetry-trace'));
assert.ok(observe?.sourceRefs.includes('observe-invocation:telemetry-sink'));

const payloadProjection = validationRepairTelemetrySpansFromPayload({
  refs: {
    validationRepairAudit: {
      validationDecision: chain.validation,
      repairDecision: chain.repair,
      auditRecord: chain.audit,
      executorResult,
    },
  },
  executionUnits: [{
    refs: {
      validationRepairAudit: {
        validationDecision: chain.validation,
        repairDecision: chain.repair,
        auditRecord: chain.audit,
        executorResult,
      },
    },
  }],
});
assert.equal(payloadProjection?.spans.length, expectedKinds.length, 'payload projection should dedupe repeated telemetry chains');
assert.ok(payloadProjection?.spans.every((span) => span.auditRefs.includes(chain.audit.auditId)));
assert.ok(payloadProjection?.spans.every((span) => span.repairRefs.includes(chain.repair.decisionId)));

const repairOnlyProjection = projectValidationRepairTelemetrySpans(executorResult, { spanKinds: ['repair-rerun'] });
assert.equal(repairOnlyProjection.spans.length, 1);
assert.equal(repairOnlyProjection.spans[0]?.spanKind, 'repair-rerun');
assert.equal(repairOnlyProjection.spans[0]?.repairDecisionId, chain.repair.decisionId);

console.log('[ok] validation/repair telemetry sink projects audit chains and repair executor results into stable spans');

function blockingFinding(id: string): ValidationFinding {
  return {
    id: `finding:${id}`,
    source: 'harness',
    kind: 'payload-schema',
    severity: 'blocking',
    message: 'Payload did not satisfy the required schema.',
    contractId: 'sciforge.tool-payload.v1',
    schemaPath: 'src/runtime/gateway/tool-payload-contract.ts',
    capabilityId: 'agentserver.direct-payload',
    relatedRefs: [`run:${id}/output.json`, 'payload-validation:failed'],
    recoverActions: ['rerun the generation request', 'preserve payload validation failure in audit'],
    issues: [{
      path: 'claims',
      message: 'claims is missing.',
      expected: 'non-empty claims array',
      actual: 'undefined',
    }],
  };
}
