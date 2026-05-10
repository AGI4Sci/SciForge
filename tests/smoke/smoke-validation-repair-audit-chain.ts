import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  type RepairDecision,
  type ValidationDecision,
  type ValidationSubjectKind,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import type { RuntimeVerificationResult } from '@sciforge-ui/runtime-contract/verification-result';
import { normalizeGatewayRequest } from '../../src/runtime/gateway/gateway-request';
import { validateAndNormalizePayload } from '../../src/runtime/gateway/payload-validation';
import { createValidationRepairAuditChain } from '../../src/runtime/gateway/validation-repair-audit-bridge';
import { appendTaskAttempt, readTaskAttempts } from '../../src/runtime/task-attempt-history';
import type { SkillAvailability, TaskAttemptRecord, ToolPayload } from '../../src/runtime/runtime-types';

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

const verificationGateResults: RuntimeVerificationResult[] = [{
  id: 'gate:artifact-consistency',
  verdict: 'fail',
  confidence: 0.88,
  critique: 'Verification gate rejected the completed payload because the cited artifact was not produced.',
  evidenceRefs: ['verification:gate-1', 'artifact:missing-chart', 'run:verification-gate-1/output.json'],
  repairHints: ['rerun with explicit artifact production evidence', 'preserve failed verification gate result in audit'],
  diagnostics: {
    policyId: 'runtime-verification:strict',
    missingArtifactRefs: ['artifact:missing-chart'],
  },
}];

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
  createValidationRepairAuditChain({
    chainId: 'verification-gate-1',
    subject: {
      kind: 'verification-gate',
      id: 'verification-gate-1',
      capabilityId: 'sciforge.runtime-verification-gate',
      completedPayloadRef: 'run:verification-gate-1/output.json',
      artifactRefs: ['artifact:missing-chart'],
      currentRefs: ['current:user-request'],
    },
    runtimeVerificationResults: verificationGateResults,
    repairBudget,
    runtimeVerificationPolicyId: 'runtime-verification:strict',
    relatedRefs: ['verification:policy:runtime-verification:strict'],
    sinkRefs: ['appendTaskAttempt:verification-gate-1'],
    telemetrySpanRefs: ['span:verification-gate:verification-gate-1', 'span:repair-decision:verification-gate-1'],
    createdAt,
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
    'verification-gate:runtime-verification:repair-rerun:repair-requested',
  ],
);
assert.ok(chains[1].audit.relatedRefs.includes('.sciforge/tasks/generated-task.py'));
assert.ok(chains[2].audit.relatedRefs.includes('observe:call-1'));
assert.equal(chains[3].validation.runtimeVerificationGate?.policyId, 'runtime-verification:strict');
assert.ok(chains[3].audit.relatedRefs.includes('verification:gate-1'));
assert.ok(chains[3].audit.relatedRefs.includes('verification:policy:runtime-verification:strict'));
assert.ok(chains[3].audit.recoverActions.includes('preserve failed verification gate result in audit'));
assert.deepEqual(chains[3].audit.sinkRefs, ['appendTaskAttempt:verification-gate-1']);
assert.deepEqual(chains[3].audit.telemetrySpanRefs, ['span:verification-gate:verification-gate-1', 'span:repair-decision:verification-gate-1']);

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-validation-repair-audit-real-'));
try {
  const request = normalizeGatewayRequest({
    skillDomain: 'literature',
    prompt: 'Exercise real payload validation schema failure.',
    workspacePath: workspace,
  });
  const skill: SkillAvailability = {
    id: 'agentserver.generation.literature',
    kind: 'installed',
    available: true,
    reason: 'smoke',
    checkedAt: createdAt,
    manifestPath: 'agentserver',
    manifest: {
      id: 'agentserver.generation.literature',
      kind: 'installed',
      description: 'smoke',
      skillDomains: ['literature'],
      inputContract: {},
      outputArtifactSchema: {},
      entrypoint: { type: 'agentserver-generation' },
      environment: {},
      validationSmoke: {},
      examplePrompts: [],
      promotionHistory: [],
    },
  };
  const payloadRefs = {
    taskRel: 'agentserver://direct-payload',
    outputRel: '.sciforge/task-results/real-schema-failure.json',
    stdoutRel: '.sciforge/logs/real-schema-failure.stdout.log',
    stderrRel: '.sciforge/logs/real-schema-failure.stderr.log',
    runtimeFingerprint: { runtime: 'smoke' },
  };
  const repairPayload = await validateAndNormalizePayload({
    message: 'Schema failure path should produce audit chain refs.',
    confidence: 0.4,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'missing claims array',
    uiManifest: [],
    executionUnits: [],
    artifacts: [],
  } as unknown as ToolPayload, request, skill, payloadRefs);
  const unit = repairPayload.executionUnits[0] as Record<string, unknown>;
  assert.equal(unit.status, 'repair-needed');
  const unitRefs = unit.refs as {
    validationFailure?: { contractId?: string; failureKind?: string };
    validationRepairAudit?: {
      validationDecision?: ValidationDecision;
      repairDecision?: RepairDecision;
      auditRecord?: AuditRecord;
    };
  } | undefined;
  assert.ok(unitRefs?.validationRepairAudit);
  const realChain = unitRefs.validationRepairAudit;
  assert.equal(unitRefs.validationFailure?.contractId, 'sciforge.tool-payload.v1');
  assert.equal(unitRefs.validationFailure?.failureKind, 'payload-schema');
  assert.equal(realChain.validationDecision?.subject.kind, 'direct-payload');
  assert.equal(realChain.validationDecision?.subject.contractId, 'sciforge.tool-payload.v1');
  assert.equal(realChain.auditRecord?.contractId, 'sciforge.tool-payload.v1');
  assert.equal(realChain.auditRecord?.failureKind, 'payload-schema');
  assert.equal(realChain.repairDecision?.action, 'repair-rerun');
  assert.equal(realChain.auditRecord?.outcome, 'repair-requested');
  assert.equal(realChain.auditRecord?.validationDecisionId, realChain.validationDecision?.decisionId);
  assert.equal(realChain.auditRecord?.repairDecisionId, realChain.repairDecision?.decisionId);
  assert.ok(realChain.auditRecord?.relatedRefs.includes(payloadRefs.outputRel));
  assert.ok(realChain.auditRecord?.recoverActions.some((action) => /payload|contract|structured/i.test(action)));
  assert.ok(realChain.auditRecord?.sinkRefs.some((ref) => ref.startsWith('appendTaskAttempt:payload-validation:')));

  await mkdir(join(workspace, '.sciforge/task-results'), { recursive: true });
  await writeFile(join(workspace, payloadRefs.outputRel), JSON.stringify(repairPayload), 'utf8');
  await appendTaskAttempt(workspace, {
    id: 'real-schema-failure',
    prompt: request.prompt,
    skillDomain: request.skillDomain,
    skillId: skill.id,
    attempt: 1,
    status: 'repair-needed',
    outputRef: payloadRefs.outputRel,
    stdoutRef: payloadRefs.stdoutRel,
    stderrRef: payloadRefs.stderrRel,
    failureReason: 'schema failure',
    createdAt,
  });
  const attempts = await readTaskAttempts(workspace, 'real-schema-failure');
  assert.equal(attempts.length, 1);
  const attempt = attempts[0] as TaskAttemptRecord & {
    refs?: { validationRepairAudit?: Array<{ ref?: string; auditId?: string; contractId?: string; failureKind?: string; sinkRefs?: string[] }> };
    validationRepairAuditRecords?: AuditRecord[];
  };
  const attemptAuditRef = attempt.refs?.validationRepairAudit?.[0];
  const attemptAuditRecord = attempt.validationRepairAuditRecords?.[0];
  assert.equal(attemptAuditRef?.ref, realChain.auditRecord?.auditId);
  assert.equal(attemptAuditRef?.contractId, 'sciforge.tool-payload.v1');
  assert.equal(attemptAuditRef?.failureKind, 'payload-schema');
  assert.equal(attemptAuditRecord?.auditId, realChain.auditRecord?.auditId);
  assert.ok(attemptAuditRecord?.sinkRefs.some((ref) => ref.startsWith('appendTaskAttempt:payload-validation:')));
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log(`[ok] validation/repair/audit chain shares shape across direct payload, generated task, observe, and verification gate failures: ${chains.map((chain) => chainShape(chain)).join(', ')}`);

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
