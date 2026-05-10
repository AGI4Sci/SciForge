import assert from 'node:assert/strict';

import {
  createAuditRecord,
  createValidationDecision,
  decideRepairPolicy,
  type AuditRecord,
  type RepairBudgetSnapshot,
  type RepairDecision,
  type ValidationDecision,
  type ValidationFinding,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import {
  actionPlanFromRepairDecision,
  executeRepairActionPlan,
  executorActionForRepairDecision,
  REPAIR_EXECUTOR_RESULT_CONTRACT_ID,
  type RepairExecutorAction,
  type RepairExecutorHandlers,
} from '../../src/runtime/gateway/repair-executor';
import { createValidationRepairAuditChain } from '../../src/runtime/gateway/validation-repair-audit-bridge';

const createdAt = '2026-05-10T00:00:00.000Z';
const calls: string[] = [];
const handlers: RepairExecutorHandlers = {
  patch: ({ plan }) => {
    calls.push(`patch:${plan.patchRef}`);
    return { refs: [plan.patchRef, 'executor:patch-log'].filter((ref): ref is string => Boolean(ref)), summary: 'Applied patch plan.' };
  },
  rerun: ({ repair }) => {
    calls.push(`rerun:${repair.decisionId}`);
    return { refs: ['executor:rerun-output'], summary: 'Reran failed work.' };
  },
  supplement: ({ plan }) => {
    calls.push(`supplement:${plan.outputRef}`);
    return { refs: [plan.outputRef, 'executor:supplement-note'].filter((ref): ref is string => Boolean(ref)), summary: 'Collected supplement.' };
  },
  peerHandoff: ({ plan }) => {
    calls.push(`peer:${plan.peerRef}`);
    return { refs: [plan.peerRef, 'executor:peer-handoff'].filter((ref): ref is string => Boolean(ref)), summary: 'Handed repair to peer.' };
  },
};

const rerunCase = buildCase('rerun-case', {
  maxAttempts: 1,
  remainingAttempts: 1,
  maxSupplementAttempts: 0,
  remainingSupplementAttempts: 0,
});
await assertExecutesExistingDecision(rerunCase, 'rerun', ['rerun:repair:rerun-case']);

const supplementCase = buildCase('supplement-case', {
  maxAttempts: 1,
  remainingAttempts: 0,
  maxSupplementAttempts: 1,
  remainingSupplementAttempts: 1,
});
await assertExecutesExistingDecision(supplementCase, 'supplement', ['supplement:ref:supplement-output']);

const humanCase = buildCase('human-case', {
  maxAttempts: 0,
  remainingAttempts: 0,
  maxSupplementAttempts: 0,
  remainingSupplementAttempts: 0,
}, { needsHuman: true, allowHumanEscalation: true });
await assertExecutesExistingDecision(humanCase, 'needs-human', []);

const failClosedCase = buildCase('fail-closed-case', {
  maxAttempts: 0,
  remainingAttempts: 0,
  maxSupplementAttempts: 0,
  remainingSupplementAttempts: 0,
}, { allowSupplement: false, allowHumanEscalation: false });
await assertExecutesExistingDecision(failClosedCase, 'fail-closed', []);

const patchBefore = JSON.stringify(rerunCase.repair);
const patchResult = await executeRepairActionPlan({
  ...rerunCase,
  actionPlan: {
    planId: 'plan:patch-existing-rerun',
    action: 'patch',
    patchRef: 'patch:repair.diff',
    targetRef: 'task:generated.py',
    expectedRefs: ['artifact:patched-output'],
    instructions: ['Apply the provided patch ref only.'],
    createdAt,
  },
}, handlers);
assert.equal(JSON.stringify(rerunCase.repair), patchBefore, 'explicit patch execution must not mutate or replace the strategy decision');
assert.equal(patchResult.action, 'patch');
assert.equal(patchResult.strategyAction, 'repair-rerun');
assert.equal(patchResult.status, 'executed');
assert.ok(patchResult.executedRefs.includes('patch:repair.diff'));
assert.deepEqual(calls.splice(0), ['patch:patch:repair.diff']);

const peerBefore = JSON.stringify(rerunCase.repair);
const peerResult = await executeRepairActionPlan({
  validationDecision: rerunCase.validation,
  repairDecision: rerunCase.repair,
  auditRecord: rerunCase.audit,
  actionPlan: {
    planId: 'plan:peer-handoff',
    action: 'peer-handoff',
    peerRef: 'peer:repair-instance-b',
    targetRef: 'issue:validation-failure',
    instructions: ['Forward the existing audit bundle to the peer instance.'],
    createdAt,
  },
}, handlers);
assert.equal(JSON.stringify(rerunCase.repair), peerBefore, 'peer handoff must not alter the strategy decision');
assert.equal(peerResult.action, 'peer-handoff');
assert.equal(peerResult.strategyAction, 'repair-rerun');
assert.equal(peerResult.status, 'executed');
assert.ok(peerResult.executorRef.executedRefs.includes('peer:repair-instance-b'));
assert.deepEqual(calls.splice(0), ['peer:peer:repair-instance-b']);

const bridgeChain = createValidationRepairAuditChain({
  chainId: 'executor-bridge-chain',
  subject: {
    kind: 'direct-payload',
    id: 'executor-bridge-chain',
    capabilityId: 'agentserver.direct-payload',
    contractId: 'sciforge.tool-payload.v1',
    completedPayloadRef: 'run:bridge/output.json',
    artifactRefs: [],
    currentRefs: ['current:user-request'],
  },
  findings: [blockingFinding('executor-bridge-chain')],
  repairBudget: {
    maxAttempts: 1,
    remainingAttempts: 1,
    maxSupplementAttempts: 0,
    remainingSupplementAttempts: 0,
  },
  sinkRefs: ['appendTaskAttempt:executor-bridge-chain'],
  telemetrySpanRefs: ['span:repair-decision:executor-bridge-chain'],
  createdAt,
});
const bridgeDecisionBefore = JSON.stringify(bridgeChain.repair);
const bridgeResult = await executeRepairActionPlan(bridgeChain, handlers);
assert.equal(JSON.stringify(bridgeChain.repair), bridgeDecisionBefore, 'bridge chain repair decision must remain unchanged');
assert.equal(bridgeResult.contract, REPAIR_EXECUTOR_RESULT_CONTRACT_ID);
assert.equal(bridgeResult.action, executorActionForRepairDecision(bridgeChain.repair.action));
assert.equal(bridgeResult.repairDecisionId, bridgeChain.repair.decisionId);
assert.equal(bridgeResult.validationDecisionId, bridgeChain.validation.decisionId);
assert.equal(bridgeResult.auditId, bridgeChain.audit.auditId);
assert.ok(bridgeResult.executorRef.ref.startsWith('repair-executor-result:repair-executor:'));
assert.ok(bridgeResult.auditTrail.some((entry) => entry.kind === 'strategy-decision' && entry.ref === bridgeChain.repair.decisionId));
assert.deepEqual(calls.splice(0), ['rerun:repair:executor-bridge-chain']);

console.log('[ok] repair executor executes supplied action plans and preserves existing repair strategy decisions');

async function assertExecutesExistingDecision(
  input: { validation: ValidationDecision; repair: RepairDecision; audit: AuditRecord },
  expectedAction: RepairExecutorAction,
  expectedCalls: string[],
) {
  const before = JSON.stringify(input.repair);
  const plan = actionPlanFromRepairDecision(input.repair, {
    outputRef: expectedAction === 'supplement' ? 'ref:supplement-output' : undefined,
  });
  const result = await executeRepairActionPlan({ ...input, actionPlan: plan, createdAt }, handlers);
  assert.equal(JSON.stringify(input.repair), before, `${expectedAction} must not mutate the strategy decision`);
  assert.equal(result.action, expectedAction);
  assert.equal(result.strategyAction, input.repair.action);
  assert.equal(result.repairDecisionId, input.repair.decisionId);
  assert.equal(result.auditId, input.audit.auditId);
  assert.equal(result.executorRef.strategyAction, input.repair.action);
  assert.ok(result.auditTrail.some((entry) => entry.kind === 'strategy-decision'));
  assert.deepEqual(calls.splice(0), expectedCalls);
}

function buildCase(
  id: string,
  budget: RepairBudgetSnapshot,
  options: { needsHuman?: boolean; allowSupplement?: boolean; allowHumanEscalation?: boolean } = {},
) {
  const validation = createValidationDecision({
    decisionId: `validation:${id}`,
    subject: {
      kind: 'direct-payload',
      id,
      capabilityId: 'agentserver.direct-payload',
      contractId: 'sciforge.tool-payload.v1',
      completedPayloadRef: `run:${id}/output.json`,
      artifactRefs: [],
      currentRefs: ['current:user-request'],
    },
    findings: [blockingFinding(id, options.needsHuman)],
    relatedRefs: [`run:${id}/output.json`],
    createdAt,
  });
  const repair = decideRepairPolicy({
    decisionId: `repair:${id}`,
    validation,
    budget,
    allowSupplement: options.allowSupplement,
    allowHumanEscalation: options.allowHumanEscalation,
    createdAt,
  });
  const audit = createAuditRecord({
    auditId: `audit:${id}`,
    validation,
    repair,
    sinkRefs: [`appendTaskAttempt:${id}`],
    telemetrySpanRefs: [`span:repair-decision:${id}`],
    createdAt,
  });
  return { validation, repair, audit };
}

function blockingFinding(id: string, needsHuman = false): ValidationFinding {
  return {
    id: `finding:${id}`,
    source: 'harness',
    kind: needsHuman ? 'runtime-verification' : 'payload-schema',
    severity: needsHuman ? 'warning' : 'blocking',
    message: needsHuman ? 'Manual verification required.' : 'Payload did not satisfy contract.',
    contractId: needsHuman ? 'sciforge.verification-result.v1' : 'sciforge.tool-payload.v1',
    schemaPath: needsHuman
      ? 'packages/contracts/runtime/verification-result.ts#RuntimeVerificationResult'
      : 'src/runtime/gateway/tool-payload-contract.ts',
    capabilityId: 'agentserver.direct-payload',
    relatedRefs: [`run:${id}/output.json`],
    recoverActions: needsHuman ? ['Ask a human reviewer.'] : ['Rerun or repair the payload.'],
    issues: [{
      path: needsHuman ? 'verificationResults[0].verdict' : 'claims',
      message: needsHuman ? 'Verifier requested human review.' : 'claims is missing.',
    }],
  };
}
