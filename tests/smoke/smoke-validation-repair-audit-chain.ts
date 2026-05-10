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
  type ActionResultValidationProjection,
  type AuditRecord,
  type RepairBudgetSnapshot,
  type RepairDecision,
  type ValidationDecision,
  type ValidationSubjectKind,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import type { RuntimeVerificationResult } from '@sciforge-ui/runtime-contract/verification-result';
import { normalizeGatewayRequest } from '../../src/runtime/gateway/gateway-request';
import { validateAndNormalizePayload } from '../../src/runtime/gateway/payload-validation';
import { applyRuntimeVerificationPolicy } from '../../src/runtime/gateway/verification-policy';
import {
  agentHarnessRepairPolicyBridgeFromRuntimeState,
  createValidationRepairAuditChain,
} from '../../src/runtime/gateway/validation-repair-audit-bridge';
import { annotateGeneratedTaskGuardValidationFailurePayload } from '../../src/runtime/gateway/generated-task-runner-validation-lifecycle';
import { appendTaskAttempt, readTaskAttempts } from '../../src/runtime/task-attempt-history';
import type { SkillAvailability, TaskAttemptRecord, ToolPayload } from '../../src/runtime/runtime-types';

const createdAt = '2026-05-10T00:00:00.000Z';
const repairBudget: RepairBudgetSnapshot = {
  maxAttempts: 2,
  remainingAttempts: 1,
  maxSupplementAttempts: 1,
  remainingSupplementAttempts: 1,
};
const exhaustedRepairBudget: RepairBudgetSnapshot = {
  maxAttempts: 1,
  remainingAttempts: 0,
  maxSupplementAttempts: 0,
  remainingSupplementAttempts: 0,
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

const actionResult: ActionResultValidationProjection = {
  status: 'failed',
  actionId: 'publish:dry-run',
  providerId: 'external.action-provider',
  message: 'Action provider failed before returning a durable completion receipt.',
  failureMode: 'provider-unavailable',
  traceRef: 'action:call-1',
  artifactRefs: ['artifact:publish-request'],
  relatedRefs: ['run:action-1/output.json'],
  diagnostics: ['provider external.action-provider unavailable'],
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
  createValidationRepairAuditChain({
    chainId: 'observe-1',
    subject: {
      kind: 'observe-result',
      id: 'observe-1',
      capabilityId: 'local.vision-sense',
      contractId: 'sciforge.observe-response.v1',
      observeTraceRef: observeResponse.traceRef,
      artifactRefs: observeResponse.artifactRefs,
      currentRefs: ['current:user-request'],
    },
    repairBudget,
    observeResponse,
    sinkRefs: ['appendTaskAttempt:observe-1'],
    telemetrySpanRefs: ['span:observe:observe-1', 'span:repair-decision:observe-1'],
    createdAt,
  }),
  createValidationRepairAuditChain({
    chainId: 'action-1',
    subject: {
      kind: 'action-result',
      id: 'action-1',
      capabilityId: 'external.action-provider',
      contractId: 'sciforge.action-response.v1',
      actionTraceRef: actionResult.traceRef,
      artifactRefs: actionResult.artifactRefs ?? [],
      currentRefs: ['current:user-request'],
    },
    repairBudget,
    actionResult,
    sinkRefs: ['appendTaskAttempt:action-1'],
    telemetrySpanRefs: ['span:action:action-1', 'span:repair-decision:action-1'],
    createdAt,
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

const repairRerunAcceptedChain = createValidationRepairAuditChain({
  chainId: 'repair-rerun-1',
  subject: {
    kind: 'repair-rerun-result',
    id: 'repair-rerun-1',
    capabilityId: 'agentserver.generated-task',
    contractId: 'sciforge.repair-rerun-result.v1',
    completedPayloadRef: 'run:generated-1-attempt-2/output.json',
    generatedTaskRef: '.sciforge/tasks/generated-task.py',
    artifactRefs: ['artifact:repaired-report'],
    currentRefs: ['current:user-request'],
  },
  findingProjections: [{
    source: 'work-evidence',
    kind: 'work-evidence',
    status: 'done',
    contractId: 'sciforge.repair-rerun-result.v1',
    capabilityId: 'agentserver.generated-task',
    relatedRefs: ['run:generated-1-attempt-2/output.json'],
  }],
  relatedRefs: ['run:generated-1-attempt-2/output.json', '.sciforge/tasks/generated-task.py'],
  repairBudget: {
    maxAttempts: 1,
    remainingAttempts: 0,
    maxSupplementAttempts: 0,
    remainingSupplementAttempts: 0,
  },
  sinkRefs: ['appendTaskAttempt:repair-rerun-1'],
  telemetrySpanRefs: ['span:repair-rerun:repair-rerun-1', 'span:repair-decision:repair-rerun-1'],
  createdAt,
});

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
    'action-result:action-trace:repair-rerun:repair-requested',
    'verification-gate:runtime-verification:repair-rerun:repair-requested',
  ],
);
assert.ok(chains[1].audit.relatedRefs.includes('.sciforge/tasks/generated-task.py'));
assert.ok(chains[2].audit.relatedRefs.includes('observe:call-1'));
assert.equal(chains[2].validation.findings[0]?.source, 'observe-response');
assert.ok(chains[3].audit.relatedRefs.includes('action:call-1'));
assert.equal(chains[3].validation.findings[0]?.source, 'action-response');
assert.ok(chains[3].audit.recoverActions.includes('retry with fallback action provider'));
assert.equal(chains[4].validation.runtimeVerificationGate?.policyId, 'runtime-verification:strict');
assert.ok(chains[4].audit.relatedRefs.includes('verification:gate-1'));
assert.ok(chains[4].audit.relatedRefs.includes('verification:policy:runtime-verification:strict'));
assert.ok(chains[4].audit.recoverActions.includes('preserve failed verification gate result in audit'));
assert.deepEqual(chains[4].audit.sinkRefs, ['appendTaskAttempt:verification-gate-1']);
assert.deepEqual(chains[4].audit.telemetrySpanRefs, ['span:verification-gate:verification-gate-1', 'span:repair-decision:verification-gate-1']);
assert.equal(repairRerunAcceptedChain.validation.subject.kind, 'repair-rerun-result');
assert.equal(repairRerunAcceptedChain.validation.status, 'pass');
assert.equal(repairRerunAcceptedChain.repair.action, 'none');
assert.equal(repairRerunAcceptedChain.audit.outcome, 'accepted');
assert.equal(repairRerunAcceptedChain.audit.contractId, 'sciforge.repair-rerun-result.v1');
assert.deepEqual(repairRerunAcceptedChain.audit.telemetrySpanRefs, ['span:repair-rerun:repair-rerun-1', 'span:repair-decision:repair-rerun-1']);

const harnessShadowOnlyChain = createValidationRepairAuditChain({
  chainId: 'agent-harness-shadow-only',
  subject: {
    kind: 'verification-gate',
    id: 'agent-harness-shadow-only',
    capabilityId: 'sciforge.runtime-verification-gate',
    artifactRefs: [],
    currentRefs: ['current:user-request'],
  },
  runtimeVerificationResults: verificationGateResults,
  repairBudget,
  agentHarnessRepairPolicy: {
    enabled: false,
    contractRef: 'runtime://agent-harness/contracts/shadow-only',
    traceRef: 'runtime://agent-harness/traces/shadow-only',
    profileId: 'debug-repair',
    contract: {
      repairContextPolicy: { kind: 'fail-closed', maxAttempts: 0 },
      verificationPolicy: { intensity: 'audit', requireCurrentRefs: true },
    },
  },
  createdAt,
});
assert.equal(harnessShadowOnlyChain.repair.action, 'repair-rerun', 'shadow-only bridge input must not affect repair action');
assert.equal(harnessShadowOnlyChain.audit.repairBudget.remainingAttempts, 1, 'shadow-only bridge input must not tighten budget');
assert.equal(
  harnessShadowOnlyChain.audit.relatedRefs.some((ref) => ref.includes('agent-policy-')),
  false,
  'shadow-only bridge input must not add audit metadata',
);
assert.equal(
  agentHarnessRepairPolicyBridgeFromRuntimeState({
    harnessProfileId: 'debug-repair',
    agentHarness: {
      contractRef: 'runtime://agent-harness/contracts/default-off',
      traceRef: 'runtime://agent-harness/traces/default-off',
      contract: {
        schemaVersion: 'sciforge.agent-harness-contract.v1',
        repairContextPolicy: { kind: 'fail-closed', maxAttempts: 0 },
        verificationPolicy: { intensity: 'audit', requireCurrentRefs: true },
      },
    },
  })?.consume,
  false,
  'runtime uiState bridge must keep repair behavior default-off even when audit metadata is projected',
);

const harnessDefaultAuditPolicy = agentHarnessRepairPolicyBridgeFromRuntimeState({
  harnessProfileId: 'debug-repair',
  agentHarness: {
    contractRef: 'runtime://agent-harness/contracts/default-audit',
    traceRef: 'runtime://agent-harness/traces/default-audit',
    contract: {
      schemaVersion: 'sciforge.agent-harness-contract.v1',
      repairContextPolicy: { kind: 'fail-closed', maxAttempts: 0 },
      verificationPolicy: {
        intensity: 'audit',
        requireCurrentRefs: true,
      },
    },
  },
});
assert.ok(harnessDefaultAuditPolicy, 'canonical harness contract repair policy should project by default for audit');
assert.equal(harnessDefaultAuditPolicy.consume, false);
const harnessDefaultAuditChain = createValidationRepairAuditChain({
  chainId: 'agent-harness-repair-default-audit',
  subject: {
    kind: 'verification-gate',
    id: 'agent-harness-repair-default-audit',
    capabilityId: 'sciforge.runtime-verification-gate',
    artifactRefs: [],
    currentRefs: ['current:user-request'],
  },
  runtimeVerificationResults: verificationGateResults,
  repairBudget,
  agentHarnessRepairPolicy: harnessDefaultAuditPolicy,
  createdAt,
});
assert.equal(harnessDefaultAuditChain.repair.action, 'repair-rerun', 'default harness repair policy audit must not consume repair behavior');
assert.equal(harnessDefaultAuditChain.audit.outcome, 'repair-requested');
assert.equal(harnessDefaultAuditChain.audit.repairBudget.maxAttempts, 2, 'default audit-only policy must not tighten max attempts');
assert.equal(harnessDefaultAuditChain.audit.repairBudget.remainingAttempts, 1, 'default audit-only policy must not tighten remaining attempts');
assert.ok(harnessDefaultAuditChain.audit.relatedRefs.includes('agent-policy-repair-kind:fail-closed'));
assert.ok(harnessDefaultAuditChain.audit.relatedRefs.includes('agent-policy-repair-max-attempts:0'));
assert.ok(harnessDefaultAuditChain.audit.relatedRefs.includes('agent-harness-contract:runtime://agent-harness/contracts/default-audit'));
assert.ok(harnessDefaultAuditChain.audit.relatedRefs.includes('agent-harness-trace:runtime://agent-harness/traces/default-audit'));
assert.ok(harnessDefaultAuditChain.audit.sinkRefs.includes('agent-policy-repair:runtime://agent-harness/contracts/default-audit'));

assert.equal(
  agentHarnessRepairPolicyBridgeFromRuntimeState({
    harnessProfileId: 'debug-repair',
    agentHarnessRepairPolicyDisabled: true,
    agentHarness: {
      contractRef: 'runtime://agent-harness/contracts/disabled',
      traceRef: 'runtime://agent-harness/traces/disabled',
      contract: {
        schemaVersion: 'sciforge.agent-harness-contract.v1',
        repairContextPolicy: { kind: 'fail-closed', maxAttempts: 0 },
        verificationPolicy: { intensity: 'audit', requireCurrentRefs: true },
      },
    },
  }),
  undefined,
  'repair policy disabled kill switch must suppress default audit projection',
);
assert.equal(
  agentHarnessRepairPolicyBridgeFromRuntimeState({
    harnessProfileId: 'debug-repair',
    agentHarnessRepairPolicy: 'off',
    agentHarness: {
      contractRef: 'runtime://agent-harness/contracts/off',
      traceRef: 'runtime://agent-harness/traces/off',
      contract: {
        schemaVersion: 'sciforge.agent-harness-contract.v1',
        repairContextPolicy: { kind: 'fail-closed', maxAttempts: 0 },
        verificationPolicy: { intensity: 'audit', requireCurrentRefs: true },
      },
    },
  }),
  undefined,
  'repair policy off kill switch must suppress default audit projection',
);
assert.equal(
  agentHarnessRepairPolicyBridgeFromRuntimeState({
    harnessProfileId: 'debug-repair',
    agentHarnessRepairPolicyAuditEnabled: false,
    agentHarness: {
      contractRef: 'runtime://agent-harness/contracts/audit-disabled',
      traceRef: 'runtime://agent-harness/traces/audit-disabled',
      contract: {
        schemaVersion: 'sciforge.agent-harness-contract.v1',
        repairContextPolicy: { kind: 'fail-closed', maxAttempts: 0 },
        verificationPolicy: { intensity: 'audit', requireCurrentRefs: true },
      },
    },
  }),
  undefined,
  'repair policy audit enabled=false kill switch must suppress default audit projection',
);

const harnessHandoffAuditPolicy = agentHarnessRepairPolicyBridgeFromRuntimeState({
  agentHarnessHandoff: {
    schemaVersion: 'sciforge.agent-harness-handoff.v1',
    harnessProfileId: 'debug-repair',
    harnessContractRef: 'runtime://agent-harness/contracts/handoff-default-audit',
    harnessTraceRef: 'runtime://agent-harness/traces/handoff-default-audit',
    repairContextPolicy: { kind: 'repair-rerun', maxAttempts: 1 },
  },
});
assert.ok(harnessHandoffAuditPolicy, 'canonical handoff repair policy should project by default for audit');
assert.equal(harnessHandoffAuditPolicy.consume, false);
const harnessHandoffAuditChain = createValidationRepairAuditChain({
  chainId: 'agent-harness-repair-handoff-default-audit',
  subject: {
    kind: 'verification-gate',
    id: 'agent-harness-repair-handoff-default-audit',
    capabilityId: 'sciforge.runtime-verification-gate',
    artifactRefs: [],
    currentRefs: ['current:user-request'],
  },
  runtimeVerificationResults: verificationGateResults,
  repairBudget,
  agentHarnessRepairPolicy: harnessHandoffAuditPolicy,
  createdAt,
});
assert.equal(harnessHandoffAuditChain.repair.action, 'repair-rerun');
assert.equal(harnessHandoffAuditChain.audit.repairBudget.maxAttempts, 2);
assert.ok(harnessHandoffAuditChain.audit.relatedRefs.includes('agent-policy-repair-max-attempts:1'));
assert.ok(harnessHandoffAuditChain.audit.relatedRefs.includes('agent-harness-contract:runtime://agent-harness/contracts/handoff-default-audit'));
assert.ok(harnessHandoffAuditChain.audit.sinkRefs.includes('agent-policy-repair:runtime://agent-harness/contracts/handoff-default-audit'));

const harnessOptInChain = createValidationRepairAuditChain({
  chainId: 'agent-harness-repair-opt-in',
  subject: {
    kind: 'verification-gate',
    id: 'agent-harness-repair-opt-in',
    capabilityId: 'sciforge.runtime-verification-gate',
    artifactRefs: [],
    currentRefs: ['current:user-request'],
  },
  runtimeVerificationResults: verificationGateResults,
  repairBudget,
  agentHarnessRepairPolicy: {
    enabled: true,
    contractRef: 'runtime://agent-harness/contracts/repair-opt-in',
    traceRef: 'runtime://agent-harness/traces/repair-opt-in',
    profileId: 'debug-repair',
    source: 'request.uiState.agentHarness.contract',
    contract: {
      schemaVersion: 'sciforge.agent-harness-contract.v1',
      repairContextPolicy: { kind: 'fail-closed', maxAttempts: 0 },
      verificationPolicy: {
        intensity: 'audit',
        requireCitations: true,
        requireCurrentRefs: true,
        requireArtifactRefs: true,
      },
    },
  },
  createdAt,
});
assert.equal(harnessOptInChain.repair.action, 'fail-closed');
assert.equal(harnessOptInChain.audit.outcome, 'failed-closed');
assert.equal(harnessOptInChain.audit.repairBudget.maxAttempts, 0);
assert.equal(harnessOptInChain.audit.repairBudget.remainingAttempts, 0);
assert.ok(harnessOptInChain.audit.relatedRefs.includes('agent-policy-repair-kind:fail-closed'));
assert.ok(harnessOptInChain.audit.relatedRefs.includes('agent-policy-verification-intensity:audit'));
assert.ok(harnessOptInChain.audit.relatedRefs.includes('agent-policy-verification-require-current-refs:true'));
assert.ok(harnessOptInChain.audit.relatedRefs.includes('agent-harness-contract:runtime://agent-harness/contracts/repair-opt-in'));
assert.ok(harnessOptInChain.audit.relatedRefs.includes('agent-harness-trace:runtime://agent-harness/traces/repair-opt-in'));
assert.ok(harnessOptInChain.audit.relatedRefs.includes('agent-harness-profile:debug-repair'));
assert.ok(harnessOptInChain.audit.sinkRefs.includes('agent-policy-repair:runtime://agent-harness/contracts/repair-opt-in'));
assert.ok(harnessOptInChain.audit.sinkRefs.includes('agent-policy-verification:audit'));

const harnessLooseRuntimePolicy = agentHarnessRepairPolicyBridgeFromRuntimeState({
  agentHarnessRepairPolicyEnabled: true,
  harnessProfileId: 'debug-repair',
  agentHarness: {
    summary: {
      contractRef: 'runtime://agent-harness/contracts/loose-opt-in',
      traceRef: 'runtime://agent-harness/traces/loose-opt-in',
    },
    contract: {
      schemaVersion: 'sciforge.agent-harness-contract.v1',
      repairContextPolicy: { kind: 'repair-rerun', maxAttempts: 99 },
      verificationPolicy: {
        intensity: 'audit',
        requireCitations: false,
        requireCurrentRefs: true,
      },
    },
  },
});
assert.ok(harnessLooseRuntimePolicy, 'runtime uiState bridge should project only under explicit opt-in');
assert.equal(harnessLooseRuntimePolicy.contractRef, 'runtime://agent-harness/contracts/loose-opt-in');
assert.equal(harnessLooseRuntimePolicy.traceRef, 'runtime://agent-harness/traces/loose-opt-in');
assert.equal(harnessLooseRuntimePolicy.profileId, 'debug-repair');

const harnessLooseOptInChain = createValidationRepairAuditChain({
  chainId: 'agent-harness-repair-loose-opt-in',
  subject: {
    kind: 'verification-gate',
    id: 'agent-harness-repair-loose-opt-in',
    capabilityId: 'sciforge.runtime-verification-gate',
    artifactRefs: [],
    currentRefs: ['current:user-request'],
  },
  runtimeVerificationResults: verificationGateResults,
  repairBudget: exhaustedRepairBudget,
  allowSupplement: false,
  agentHarnessRepairPolicy: harnessLooseRuntimePolicy,
  createdAt,
});
assert.equal(harnessLooseOptInChain.repair.action, 'fail-closed', 'opt-in harness policy must not reopen exhausted repair budget');
assert.equal(harnessLooseOptInChain.audit.outcome, 'failed-closed');
assert.equal(harnessLooseOptInChain.audit.repairBudget.maxAttempts, 1, 'looser harness maxAttempts must not increase base maxAttempts');
assert.equal(harnessLooseOptInChain.audit.repairBudget.remainingAttempts, 0, 'looser harness maxAttempts must not increase remaining attempts');
assert.ok(harnessLooseOptInChain.audit.relatedRefs.includes('agent-policy-repair-max-attempts:99'));
assert.ok(harnessLooseOptInChain.audit.relatedRefs.includes('agent-harness-contract:runtime://agent-harness/contracts/loose-opt-in'));
assert.ok(harnessLooseOptInChain.audit.relatedRefs.includes('agent-harness-trace:runtime://agent-harness/traces/loose-opt-in'));
assert.ok(harnessLooseOptInChain.audit.relatedRefs.includes('agent-harness-profile:debug-repair'));

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
    inputRel: '.sciforge/task-inputs/real-guard-failure.json',
    outputRel: '.sciforge/task-results/real-schema-failure.json',
    stdoutRel: '.sciforge/logs/real-schema-failure.stdout.log',
    stderrRel: '.sciforge/logs/real-schema-failure.stderr.log',
    runtimeFingerprint: { runtime: 'smoke' },
  };
  const workEvidenceGuardPayload = await annotateGeneratedTaskGuardValidationFailurePayload({
    payload: {
      message: 'Claim verified.',
      confidence: 0.91,
      claimType: 'fact',
      evidenceLevel: 'verified',
      reasoningTrace: 'Marked verified without durable evidence refs.',
      claims: [{ text: 'The generated result is verified.', status: 'verified', confidence: 0.91 }],
      uiManifest: [],
      executionUnits: [{ id: 'EU-work-evidence-guard', status: 'done', tool: 'agentserver.direct' }],
      artifacts: [],
    },
    workspacePath: workspace,
    request,
    skill,
    refs: payloadRefs,
  }) as ToolPayload & {
    refs?: {
      validationRepairAudit?: {
        validationDecision?: ValidationDecision;
        repairDecision?: RepairDecision;
        auditRecord?: AuditRecord;
      };
      validationRepairTelemetry?: Array<{ spanKinds?: string[] }>;
    };
  };
  const workEvidenceGuardChain = workEvidenceGuardPayload.refs?.validationRepairAudit;
  assert.equal(workEvidenceGuardChain?.validationDecision?.findings[0]?.kind, 'work-evidence');
  assert.equal(workEvidenceGuardChain?.validationDecision?.findings[0]?.source, 'work-evidence');
  assert.equal(workEvidenceGuardChain?.auditRecord?.contractId, 'sciforge.work-evidence.v1');
  assert.equal(workEvidenceGuardChain?.auditRecord?.failureKind, 'work-evidence');
  assert.equal(workEvidenceGuardChain?.repairDecision?.action, 'repair-rerun');
  assert.ok(workEvidenceGuardChain?.auditRecord?.sinkRefs.some((ref) => ref.startsWith('appendTaskAttempt:validation-guard:')));
  assert.ok(workEvidenceGuardChain?.auditRecord?.sinkRefs.some((ref) => ref.startsWith('ledger:validation-guard:')));
  assert.equal(workEvidenceGuardPayload.budgetDebits?.[0]?.capabilityId, 'sciforge.validation-guard');
  assert.ok(hasBudgetDebitRef(workEvidenceGuardPayload.executionUnits[0], workEvidenceGuardPayload.budgetDebits?.[0]?.debitId ?? ''));
  assert.ok(workEvidenceGuardPayload.refs?.validationRepairTelemetry?.[0]?.spanKinds?.includes('work-evidence'));

  const guidanceGuardPayload = await annotateGeneratedTaskGuardValidationFailurePayload({
    payload: {
      message: 'Guidance was handled.',
      confidence: 0.88,
      claimType: 'fact',
      evidenceLevel: 'runtime',
      reasoningTrace: 'No guidanceDecisions were emitted.',
      claims: [],
      uiManifest: [],
      executionUnits: [{ id: 'EU-guidance-guard', status: 'done', tool: 'agentserver.direct' }],
      artifacts: [],
    },
    workspacePath: workspace,
    request: {
      ...request,
      uiState: {
        userGuidanceQueue: [{ id: 'scope', status: 'queued', message: 'Use the narrower scope.' }],
      },
    },
    skill,
    refs: {
      ...payloadRefs,
      outputRel: '.sciforge/task-results/real-guidance-guard-failure.json',
    },
  }) as ToolPayload & {
    refs?: {
      validationRepairAudit?: {
        validationDecision?: ValidationDecision;
        repairDecision?: RepairDecision;
        auditRecord?: AuditRecord;
      };
    };
  };
  const guidanceGuardChain = guidanceGuardPayload.refs?.validationRepairAudit;
  assert.equal(guidanceGuardChain?.validationDecision?.findings[0]?.kind, 'guidance-adoption');
  assert.equal(guidanceGuardChain?.auditRecord?.contractId, 'sciforge.guidance-adoption.v1');
  assert.equal(guidanceGuardChain?.auditRecord?.failureKind, 'guidance-adoption');
  assert.equal(guidanceGuardPayload.budgetDebits?.[0]?.capabilityId, 'sciforge.validation-guard');

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
    validationRepairAuditSinkRecords?: Array<{ target?: string; ref?: string; auditRecord?: AuditRecord }>;
  };
  const attemptAuditRef = attempt.refs?.validationRepairAudit?.[0];
  const attemptAuditRecord = attempt.validationRepairAuditRecords?.[0];
  assert.equal(attemptAuditRef?.ref, realChain.auditRecord?.auditId);
  assert.equal(attemptAuditRef?.contractId, 'sciforge.tool-payload.v1');
  assert.equal(attemptAuditRef?.failureKind, 'payload-schema');
  assert.equal(attemptAuditRecord?.auditId, realChain.auditRecord?.auditId);
  assert.ok(attemptAuditRecord?.sinkRefs.some((ref) => ref.startsWith('appendTaskAttempt:payload-validation:')));
  const sinkRefs = (attempt.refs as {
    validationRepairAuditSink?: Array<{ target?: string; ref?: string; auditId?: string; contractId?: string; failureKind?: string }>;
  } | undefined)?.validationRepairAuditSink ?? [];
  assert.deepEqual(
    sinkRefs.map((ref) => ref.target).sort(),
    ['appendTaskAttempt', 'ledger', 'observe-invocation', 'verification-artifact'].sort(),
  );
  assert.equal(sinkRefs.find((ref) => ref.target === 'appendTaskAttempt')?.auditId, realChain.auditRecord?.auditId);
  assert.equal(sinkRefs.find((ref) => ref.target === 'appendTaskAttempt')?.contractId, 'sciforge.tool-payload.v1');
  assert.equal(sinkRefs.find((ref) => ref.target === 'appendTaskAttempt')?.failureKind, 'payload-schema');
  assert.ok(sinkRefs.find((ref) => ref.target === 'ledger')?.ref?.startsWith('ledger:'));
  assert.ok(sinkRefs.find((ref) => ref.target === 'verification-artifact')?.ref?.startsWith('verification-artifact:'));
  assert.ok(sinkRefs.find((ref) => ref.target === 'observe-invocation')?.ref?.startsWith('observe-invocation:'));
  assert.deepEqual(
    attempt.validationRepairAuditSinkRecords?.map((record) => record.target).sort(),
    ['appendTaskAttempt', 'ledger', 'observe-invocation', 'verification-artifact'].sort(),
  );
  assert.equal(
    attempt.validationRepairAuditSinkRecords?.find((record) => record.target === 'ledger')?.auditRecord?.auditId,
    realChain.auditRecord?.auditId,
  );

  const verificationOutputRel = '.sciforge/task-results/real-verification-gate-failure.json';
  const verificationPayload: ToolPayload = {
    message: 'Provider says a high-risk publish action completed.',
    confidence: 0.91,
    claimType: 'execution',
    evidenceLevel: 'provider',
    reasoningTrace: 'provider self-report before runtime verification gate',
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: 'EU-verification-gate',
      status: 'done',
      tool: 'external.action-provider',
      outputRef: verificationOutputRel,
      stdoutRef: '.sciforge/logs/real-verification-gate-failure.stdout.log',
      stderrRef: '.sciforge/logs/real-verification-gate-failure.stderr.log',
      params: JSON.stringify({ action: 'publish' }),
    }],
    artifacts: [],
  };
  const verificationRequest = normalizeGatewayRequest({
    skillDomain: 'knowledge',
    prompt: 'Publish this high-risk update after verification.',
    workspacePath: workspace,
    verificationPolicy: { required: true, mode: 'hybrid', riskLevel: 'high', reason: 'high-risk external side effect' },
  });
  await writeFile(join(workspace, verificationOutputRel), JSON.stringify(verificationPayload), 'utf8');
  await appendTaskAttempt(workspace, {
    id: 'real-verification-gate-failure',
    prompt: verificationRequest.prompt,
    skillDomain: verificationRequest.skillDomain,
    skillId: skill.id,
    attempt: 1,
    status: 'done',
    outputRef: verificationOutputRel,
    createdAt,
  });
  const gatedPayload = await applyRuntimeVerificationPolicy(verificationPayload, verificationRequest) as ToolPayload & { refs?: Record<string, unknown> };
  const gatedUnitRefs = gatedPayload.executionUnits[0].refs as {
    validationFailure?: { contractId?: string; failureKind?: string };
    validationRepairAudit?: {
      validationDecision?: ValidationDecision;
      repairDecision?: RepairDecision;
      auditRecord?: AuditRecord;
    };
  } | undefined;
  assert.equal(gatedPayload.verificationResults?.[0]?.verdict, 'needs-human');
  assert.equal(gatedPayload.executionUnits[0].status, 'needs-human');
  assert.equal(gatedUnitRefs?.validationFailure?.contractId, 'sciforge.verification-result.v1');
  assert.equal(gatedUnitRefs?.validationFailure?.failureKind, 'verifier');
  assert.equal(gatedUnitRefs?.validationRepairAudit?.validationDecision?.subject.kind, 'verification-gate');
  assert.equal(gatedUnitRefs?.validationRepairAudit?.validationDecision?.subject.completedPayloadRef, verificationOutputRel);
  assert.equal(gatedUnitRefs?.validationRepairAudit?.repairDecision?.action, 'needs-human');
  assert.equal(gatedUnitRefs?.validationRepairAudit?.auditRecord?.failureKind, 'runtime-verification');
  assert.equal(gatedUnitRefs?.validationRepairAudit?.auditRecord?.outcome, 'needs-human');
  assert.ok(gatedPayload.refs?.validationRepairAudit);

  const verificationAttempts = await readTaskAttempts(workspace, 'real-verification-gate-failure');
  const verificationAttempt = verificationAttempts[0] as TaskAttemptRecord & {
    refs?: {
      validationRepairAudit?: Array<{ contractId?: string; failureKind?: string; outcome?: string; subject?: { kind?: string } }>;
      validationRepairAuditSink?: Array<{ target?: string; failureKind?: string }>;
    };
    validationRepairAuditRecords?: AuditRecord[];
  };
  assert.equal(verificationAttempt.status, 'done');
  assert.equal(verificationAttempt.refs?.validationRepairAudit?.[0]?.contractId, 'sciforge.verification-result.v1');
  assert.equal(verificationAttempt.refs?.validationRepairAudit?.[0]?.failureKind, 'runtime-verification');
  assert.equal(verificationAttempt.refs?.validationRepairAudit?.[0]?.outcome, 'needs-human');
  assert.equal(verificationAttempt.refs?.validationRepairAudit?.[0]?.subject?.kind, 'verification-gate');
  assert.ok(verificationAttempt.refs?.validationRepairAuditSink?.some((ref) => ref.target === 'verification-artifact'));
  assert.equal(verificationAttempt.validationRepairAuditRecords?.[0]?.failureKind, 'runtime-verification');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log(`[ok] validation/repair/audit chain shares shape across direct payload, generated task, observe, action, and verification gate failures: ${chains.map((chain) => chainShape(chain)).join(', ')}`);

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

function hasBudgetDebitRef(record: unknown, debitId: string) {
  return Boolean(
    debitId
    && record
    && typeof record === 'object'
    && Array.isArray((record as { budgetDebitRefs?: unknown }).budgetDebitRefs)
    && ((record as { budgetDebitRefs: unknown[] }).budgetDebitRefs).includes(debitId),
  );
}
