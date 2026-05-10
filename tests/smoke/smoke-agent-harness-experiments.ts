import assert from 'node:assert/strict';

import { createHarnessRuntime } from '../../packages/agent-harness/src/runtime';
import type { HarnessContract, HarnessProfileId } from '../../packages/agent-harness/src/contracts';
import {
  capabilityBudgetExhaustionFixture,
  freshResearchFixture,
  repairAfterValidationFailureFixture,
} from '../harness/fixtures/agentHarnessExperimentFixtures';
import {
  assertBlockedRefs,
  assertBudgetTightening,
  assertDecisionMerged,
  assertTraceDecisionIncludes,
  assertTraceStageOrder,
} from '../harness/traceAssertions';

const runtime = createHarnessRuntime();
const profileIds: HarnessProfileId[] = ['fast-answer', 'research-grade', 'privacy-strict'];

const freshResearchResults = await Promise.all(profileIds.map(async (profileId) => ({
  profileId,
  evaluation: await runtime.evaluate({ ...freshResearchFixture.input, profileId }),
})));

const contractsByProfile = new Map(freshResearchResults.map((result) => [result.profileId, result.evaluation.contract]));
const fast = getContract(contractsByProfile, 'fast-answer');
const research = getContract(contractsByProfile, 'research-grade');
const privacy = getContract(contractsByProfile, 'privacy-strict');

assert.notDeepEqual(fast, research, 'fast-answer and research-grade should produce different contracts');
assert.notDeepEqual(research, privacy, 'research-grade and privacy-strict should produce different contracts');
assert.equal(fast.profileId, 'fast-answer');
assert.equal(research.profileId, 'research-grade');
assert.equal(privacy.profileId, 'privacy-strict');
assert.equal(fast.explorationMode, 'minimal');
assert.equal(research.explorationMode, 'deep');
assert.equal(research.verificationPolicy.requireCitations, true);
assert.equal(privacy.capabilityPolicy.sideEffects.network, 'block');
assert.equal(privacy.toolBudget.maxNetworkCalls, 0);
assert.ok(fast.toolBudget.maxWallMs < research.toolBudget.maxWallMs);

for (const { profileId, evaluation } of freshResearchResults) {
  assert.equal(evaluation.trace.schemaVersion, 'sciforge.agent-harness-trace.v1');
  assert.equal(evaluation.contract.traceRef, evaluation.trace.traceId);
  assert.ok(evaluation.trace.stages.length > 0, `${profileId} should record trace stages`);
}

assertTraceStageOrder(getTrace('fast-answer'), [
  { stage: 'setExplorationBudget', callbackId: 'fast-answer.budget' },
  { stage: 'onBudgetAllocate', callbackId: 'fast-answer.budget' },
  { stage: 'beforeUserProgressEvent', callbackId: 'fast-answer.budget' },
], 'fast-answer hook order');
assertDecisionMerged(getTrace('fast-answer'), 'fast-answer.budget', {
  explorationMode: 'minimal',
  toolBudget: { maxToolCalls: 2, maxProviders: 1 },
  progressPlan: { initialStatus: 'Answering' },
}, 'fast-answer decision merge');

assertTraceStageOrder(getTrace('research-grade'), [
  { stage: 'setExplorationBudget', callbackId: 'research-grade.verification' },
  { stage: 'onBudgetAllocate', callbackId: 'research-grade.verification' },
  { stage: 'beforeResultValidation', callbackId: 'research-grade.verification' },
], 'research-grade hook order');
assertDecisionMerged(getTrace('research-grade'), 'research-grade.verification', {
  verificationPolicy: { intensity: 'strict', requireCitations: true },
}, 'research-grade decision merge');

assertTraceStageOrder(getTrace('privacy-strict'), [
  { stage: 'onToolPolicy', callbackId: 'privacy-strict.safety' },
  { stage: 'onBudgetAllocate', callbackId: 'privacy-strict.safety' },
  { stage: 'beforeResultValidation', callbackId: 'privacy-strict.safety' },
], 'privacy-strict hook order');
assertDecisionMerged(getTrace('privacy-strict'), 'privacy-strict.safety', {
  capabilityPolicy: {
    blockedCapabilities: ['external-upload', 'network', 'workspace-write'],
    sideEffects: { network: 'block' },
  },
  toolBudget: { maxNetworkCalls: 0, maxProviders: 0 },
}, 'privacy-strict decision merge');
assertTraceDecisionIncludes(getTrace('privacy-strict'), 'privacy-strict.safety', {
  blockedCapabilities: ['network', 'external-upload', 'workspace-write'],
}, 'privacy-strict trace decision');

const repair = await runtime.evaluate(repairAfterValidationFailureFixture.input);
assertTraceStageOrder(repair.trace, [
  { stage: 'classifyIntent', callbackId: 'debug-repair.policy' },
  { stage: 'onRepairRequired', callbackId: 'debug-repair.policy' },
], 'repair hook order');
assertDecisionMerged(repair.trace, 'debug-repair.policy', {
  intentMode: 'repair',
  repairContextPolicy: { kind: 'repair-rerun', maxAttempts: 2, includeStdoutSummary: true },
}, 'repair decision merge');

const budgetExhausted = await runtime.evaluate({
  ...capabilityBudgetExhaustionFixture.input,
  profileId: 'fast-answer',
});
assertBlockedRefs(budgetExhausted.contract, ['ref:private-upload'], 'budget fixture blocked refs');
assertBudgetTightening(
  budgetExhausted.trace.stages[0].contractSnapshot,
  budgetExhausted.contract,
  'budget fixture tightening across trace',
);
assert.equal(budgetExhausted.contract.toolBudget.maxToolCalls, 0);
assert.equal(budgetExhausted.contract.toolBudget.maxNetworkCalls, 0);
assert.equal(budgetExhausted.contract.toolBudget.exhaustedPolicy, 'fail-with-reason');

const diffSummary = profileIds.map((profileId) => {
  const contract = getContract(contractsByProfile, profileId);
  return {
    profileId,
    explorationMode: contract.explorationMode,
    maxWallMs: contract.toolBudget.maxWallMs,
    maxNetworkCalls: contract.toolBudget.maxNetworkCalls,
    verification: contract.verificationPolicy.intensity,
    network: contract.capabilityPolicy.sideEffects.network,
  };
});

console.log(`[ok] agent harness experiment fixtures/profile diff covered without live backend: ${JSON.stringify(diffSummary)}`);

function getTrace(profileId: HarnessProfileId) {
  const result = freshResearchResults.find((item) => item.profileId === profileId);
  assert.ok(result, `missing ${profileId} result`);
  return result.evaluation.trace;
}

function getContract(contracts: Map<HarnessProfileId, HarnessContract>, profileId: HarnessProfileId): HarnessContract {
  const contract = contracts.get(profileId);
  assert.ok(contract, `missing ${profileId} contract`);
  return contract;
}
