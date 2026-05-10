import assert from 'node:assert/strict';

import { createHarnessRuntime } from '../../packages/agent-harness/src/runtime';
import { harnessProfiles } from '../../packages/agent-harness/src/profiles';
import type { HarnessInput, HarnessProfileId } from '../../packages/agent-harness/src/contracts';
import {
  capabilityBudgetExhaustionFixture,
  fileGroundedSummaryFixture,
  freshResearchFixture,
  repairAfterValidationFailureFixture,
  silentStreamCancelFixture,
} from '../harness/fixtures/agentHarnessExperimentFixtures';

const runtime = createHarnessRuntime();

const profileCoverageCases: Record<string, { fixtureId: string; input: HarnessInput }> = {
  'balanced-default': { fixtureId: silentStreamCancelFixture.id, input: silentStreamCancelFixture.input },
  'fast-answer': { fixtureId: capabilityBudgetExhaustionFixture.id, input: capabilityBudgetExhaustionFixture.input },
  'research-grade': { fixtureId: freshResearchFixture.id, input: freshResearchFixture.input },
  'debug-repair': { fixtureId: repairAfterValidationFailureFixture.id, input: repairAfterValidationFailureFixture.input },
  'low-cost': { fixtureId: fileGroundedSummaryFixture.id, input: fileGroundedSummaryFixture.input },
  'privacy-strict': { fixtureId: freshResearchFixture.id, input: freshResearchFixture.input },
  'high-recall-literature': { fixtureId: freshResearchFixture.id, input: freshResearchFixture.input },
  'scientific-reproduction-research': { fixtureId: freshResearchFixture.id, input: freshResearchFixture.input },
};

assert.deepEqual(
  Object.keys(profileCoverageCases).sort(),
  Object.keys(harnessProfiles).sort(),
  'every harness profile must have a minimal experiment fixture before it ships',
);

const coverageSummary = [];
for (const [profileId, profile] of Object.entries(harnessProfiles)) {
  assert.equal(profile.id, profileId);
  assert.ok(profile.version.trim(), `${profileId} must declare a version`);
  assert.ok(profile.callbacks.length > 0, `${profileId} must own at least one callback`);
  assert.equal(
    new Set(profile.callbacks.map((callback) => callback.id)).size,
    profile.callbacks.length,
    `${profileId} callback ids must be unique`,
  );

  for (const callback of profile.callbacks) {
    assert.ok(callback.id.startsWith(`${profileId}.`), `${callback.id} must be namespaced to its profile`);
    assert.ok(callback.version.trim(), `${callback.id} must declare a version`);
    assert.ok(callback.stages.length > 0, `${callback.id} must declare owned stages`);
    assert.equal(new Set(callback.stages).size, callback.stages.length, `${callback.id} must not duplicate owned stages`);
  }

  const coverage = profileCoverageCases[profileId];
  assert.ok(coverage, `${profileId} must have a coverage fixture`);
  const evaluation = await runtime.evaluate({
    ...coverage.input,
    profileId: profileId as HarnessProfileId,
  });
  const tracedCallbacks = new Set(evaluation.trace.stages.map((stage) => stage.callbackId));
  assert.ok(tracedCallbacks.size > 0, `${profileId} must emit trace stages in its fixture`);
  for (const callback of profile.callbacks) {
    assert.ok(tracedCallbacks.has(callback.id), `${profileId} fixture ${coverage.fixtureId} did not exercise ${callback.id}`);
  }
  if (profileId === 'scientific-reproduction-research') {
    assert.ok(evaluation.contract.requiredContextRefs.includes('paper:crispr-screen-a'), `${profileId} must preserve required scientific refs`);
    assert.ok(
      evaluation.contract.capabilityPolicy.preferredCapabilityIds.includes('scientific-reproduction.verifier'),
      `${profileId} must prefer the scientific reproduction verifier`,
    );
    assert.equal(evaluation.contract.verificationPolicy.intensity, 'strict', `${profileId} must require strict verification`);
    assert.equal(evaluation.contract.verificationPolicy.requireCitations, true, `${profileId} must require citation verification`);
    assert.equal(evaluation.contract.verificationPolicy.requireArtifactRefs, true, `${profileId} must require artifact refs`);
    assert.equal(evaluation.contract.toolBudget.exhaustedPolicy, 'needs-human', `${profileId} exhausted budget must request human handoff`);
    assert.equal(evaluation.contract.repairContextPolicy.kind, 'needs-human', `${profileId} repair policy must preserve needs-human handoff`);
    assert.equal(evaluation.contract.capabilityPolicy.sideEffects.externalMutation, 'block', `${profileId} must block external mutation`);
    assert.equal(evaluation.contract.capabilityPolicy.sideEffects.workspaceWrite, 'requires-approval', `${profileId} must gate workspace writes`);
    assert.ok(evaluation.contract.progressPlan.phaseNames?.includes('reproduction'), `${profileId} must expose reproduction progress phase`);
    assert.ok(evaluation.contract.progressPlan.phaseNames?.includes('handoff'), `${profileId} must expose handoff progress phase`);
    assert.ok(
      evaluation.trace.stages.some((stage) => stage.decision.capabilityHints?.preferredCapabilityIds?.includes('scientific-reproduction.verifier')),
      `${profileId} trace must record verifier preference decision`,
    );
    assert.ok(
      evaluation.trace.stages.some((stage) => stage.contractSnapshot.toolBudget.exhaustedPolicy === 'needs-human'),
      `${profileId} trace snapshots must carry needs-human budget exhaustion policy`,
    );
  }
  coverageSummary.push({
    profileId,
    fixtureId: coverage.fixtureId,
    callbacks: [...tracedCallbacks].sort(),
    stages: evaluation.trace.stages.length,
  });
}

console.log(`[ok] agent harness profiles declare owned stages and have minimal fixture coverage: ${JSON.stringify(coverageSummary)}`);
