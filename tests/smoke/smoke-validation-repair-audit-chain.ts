import assert from 'node:assert/strict';

import { contractValidationFailureFromErrors } from '@sciforge-ui/runtime-contract/validation-failure';
import type { ObserveResponse } from '@sciforge-ui/runtime-contract/observe';
import {
  VALIDATION_REPAIR_AUDIT_CHAIN_CONTRACT_ID,
  createAuditRecord,
  createValidationDecision,
  decideRepairPolicy,
  validationFindingsFromContractFailure,
  validationFindingsFromObserveResponse,
  type AuditRecord,
  type RepairBudgetSnapshot,
  type ValidationDecision,
  type ValidationSubjectKind,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';

const createdAt = '2026-05-10T00:00:00.000Z';
const repairBudget: RepairBudgetSnapshot = {
  maxAttempts: 2,
  remainingAttempts: 1,
  maxSupplementAttempts: 1,
  remainingSupplementAttempts: 1,
};

const directFailure = contractValidationFailureFromErrors(['missing claims'], {
  capabilityId: 'agentserver.direct-payload',
  failureKind: 'payload-schema',
  schemaPath: 'src/runtime/gateway/tool-payload-contract.ts',
  contractId: 'sciforge.tool-payload.v1',
  relatedRefs: ['run:direct-1/output.json'],
});

const generatedTaskFailure = contractValidationFailureFromErrors(['artifacts[0].type must be a non-empty string'], {
  capabilityId: 'agentserver.generated-task',
  failureKind: 'artifact-schema',
  schemaPath: 'src/runtime/gateway/tool-payload-contract.ts#artifacts',
  contractId: 'sciforge.artifact.v1',
  relatedRefs: ['run:generated-1/output.json', '.sciforge/tasks/generated-task.py'],
});

const observeResponse: ObserveResponse = {
  schemaVersion: 1,
  providerId: 'local.vision-sense',
  status: 'failed',
  textResponse: 'Could not inspect the requested window.',
  failureMode: 'provider-unavailable',
  confidence: 0,
  artifactRefs: ['artifact:screen-before'],
  traceRef: 'observe:call-1',
  diagnostics: ['provider local.vision-sense unavailable'],
};

const chains = [
  buildChain({
    kind: 'direct-payload',
    id: 'direct-1',
    capabilityId: 'agentserver.direct-payload',
    contractId: directFailure.contractId,
    completedPayloadRef: 'run:direct-1/output.json',
    artifactRefs: [],
    findings: validationFindingsFromContractFailure(directFailure, { idPrefix: 'direct' }),
  }),
  buildChain({
    kind: 'generated-task-result',
    id: 'generated-1',
    capabilityId: 'agentserver.generated-task',
    contractId: generatedTaskFailure.contractId,
    completedPayloadRef: 'run:generated-1/output.json',
    generatedTaskRef: '.sciforge/tasks/generated-task.py',
    artifactRefs: ['artifact:broken-report'],
    findings: validationFindingsFromContractFailure(generatedTaskFailure, { idPrefix: 'generated' }),
  }),
  buildChain({
    kind: 'observe-result',
    id: 'observe-1',
    capabilityId: 'local.vision-sense',
    contractId: 'sciforge.observe-response.v1',
    observeTraceRef: observeResponse.traceRef,
    artifactRefs: observeResponse.artifactRefs,
    findings: validationFindingsFromObserveResponse(observeResponse, {
      id: 'observe:local.vision-sense:provider-unavailable',
      capabilityId: 'local.vision-sense',
    }),
  }),
];

for (const chain of chains) {
  assert.equal(chain.validation.contract, VALIDATION_REPAIR_AUDIT_CHAIN_CONTRACT_ID);
  assert.equal(chain.repair.contract, VALIDATION_REPAIR_AUDIT_CHAIN_CONTRACT_ID);
  assert.equal(chain.audit.contract, VALIDATION_REPAIR_AUDIT_CHAIN_CONTRACT_ID);
  assert.equal(chain.validation.status, 'failed');
  assert.equal(chain.repair.action, 'repair-rerun');
  assert.equal(chain.audit.outcome, 'repair-requested');
  assert.equal(chain.audit.validationDecisionId, chain.validation.decisionId);
  assert.equal(chain.audit.repairDecisionId, chain.repair.decisionId);
  assert.ok(chain.audit.relatedRefs.length > 0, `${chain.validation.subject.kind} must preserve related refs`);
  assert.equal(chain.audit.repairBudget.remainingAttempts, 1);
  assert.ok(chain.audit.contractId.startsWith('sciforge.'), `${chain.validation.subject.kind} contract id should be explicit`);
  assert.ok(chain.audit.failureKind, `${chain.validation.subject.kind} failure kind should be audit-visible`);
}

assert.deepEqual(
  chains.map((chain) => chainShape(chain)),
  [
    'direct-payload:payload-schema:repair-rerun:repair-requested',
    'generated-task-result:artifact-schema:repair-rerun:repair-requested',
    'observe-result:observe-trace:repair-rerun:repair-requested',
  ],
);
assert.ok(chains[1].audit.relatedRefs.includes('.sciforge/tasks/generated-task.py'));
assert.ok(chains[2].audit.relatedRefs.includes('observe:call-1'));

console.log(`[ok] validation/repair/audit chain shares shape across direct payload, generated task, and observe failures: ${chains.map((chain) => chainShape(chain)).join(', ')}`);

function buildChain(input: {
  kind: ValidationSubjectKind;
  id: string;
  capabilityId: string;
  contractId: string;
  completedPayloadRef?: string;
  generatedTaskRef?: string;
  observeTraceRef?: string;
  artifactRefs: string[];
  findings: Parameters<typeof createValidationDecision>[0]['findings'];
}) {
  const validation = createValidationDecision({
    decisionId: `validation:${input.id}`,
    subject: {
      kind: input.kind,
      id: input.id,
      capabilityId: input.capabilityId,
      contractId: input.contractId,
      completedPayloadRef: input.completedPayloadRef,
      generatedTaskRef: input.generatedTaskRef,
      observeTraceRef: input.observeTraceRef,
      artifactRefs: input.artifactRefs,
      currentRefs: ['current:user-request'],
    },
    findings: input.findings,
    workEvidence: [{
      kind: 'validate',
      status: 'failed',
      provider: 'validation-repair-audit-smoke',
      outputSummary: `${input.kind} failed validation`,
      evidenceRefs: [input.completedPayloadRef, input.generatedTaskRef, input.observeTraceRef].filter((ref): ref is string => Boolean(ref)),
      failureReason: input.findings?.[0]?.message,
      recoverActions: input.findings?.flatMap((finding) => finding.recoverActions) ?? [],
    }],
    relatedRefs: [input.completedPayloadRef, input.generatedTaskRef, input.observeTraceRef].filter((ref): ref is string => Boolean(ref)),
    createdAt,
  });
  const repair = decideRepairPolicy({
    decisionId: `repair:${input.id}`,
    validation,
    budget: repairBudget,
    createdAt,
  });
  const audit = createAuditRecord({
    auditId: `audit:${input.id}`,
    validation,
    repair,
    sinkRefs: [`appendTaskAttempt:${input.id}`],
    telemetrySpanRefs: [`span:payload-validation:${input.id}`, `span:repair-decision:${input.id}`],
    createdAt,
  });
  return { validation, repair, audit };
}

function chainShape(chain: { validation: ValidationDecision; repair: ReturnType<typeof decideRepairPolicy>; audit: AuditRecord }) {
  return `${chain.validation.subject.kind}:${chain.audit.failureKind}:${chain.repair.action}:${chain.audit.outcome}`;
}
