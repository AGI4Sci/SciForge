import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVirtualAppScreenResearchWorkflowBundle,
  REQUIRED_RESEARCH_ARTIFACT_KINDS,
  REQUIRED_RESEARCH_SCREEN_PROFILE_IDS,
  VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_SCHEMA_VERSION,
  VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_TASK_ID,
} from '../../tools/computer-use-next/virtual-app-screen-research-workflow.js';

test('research workflow fixture covers the first screen profile batch without claiming live acceptance', () => {
  const bundle = buildVirtualAppScreenResearchWorkflowBundle({
    runId: 'research-workflow-fixture-coverage',
  });

  assert.equal(bundle.schemaVersion, VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_SCHEMA_VERSION);
  assert.equal(bundle.taskId, VIRTUAL_APP_SCREEN_RESEARCH_WORKFLOW_TASK_ID);
  assert.equal(bundle.evidenceMode, 'fixture-diagnostic');
  assert.equal(bundle.fixtureBoundary.diagnosticFixture, true);
  assert.equal(bundle.fixtureBoundary.fixtureCanClaimUserAcceptance, false);
  assert.equal(bundle.validation.status, 'blocked');
  assert.equal(bundle.validation.ok, false);
  assert.equal(bundle.manifest.status, 'blocked');
  assert.equal(bundle.manifest.diagnosticOnly, true);
  assert.equal(bundle.manifest.userAcceptanceEligible, false);
  assert.ok(bundle.validation.issues.some((issue) => issue.includes('fixture-diagnostic')));
  assert.deepEqual(bundle.profiles.map((profile) => profile.id), REQUIRED_RESEARCH_SCREEN_PROFILE_IDS);
  assert.deepEqual(bundle.artifactChains.map((chain) => chain.kind), REQUIRED_RESEARCH_ARTIFACT_KINDS);

  for (const profile of bundle.profiles) {
    assert.equal(profile.adapterReadiness.ref, profile.adapterReadinessRef);
    assert.equal(profile.blockedPolicy.status, 'diagnostic-only');
    assert.equal(profile.blockedPolicy.userLevelEligible, false);
    assert.equal(profile.contributionBoundary.disallowCrossScreenWrites, true);
    assert.ok(profile.targetAppRef.startsWith('app:'));
    assert.ok(profile.targetWindowRef.startsWith('window:'));
    assert.ok(profile.sessionRef.startsWith('computer-use-session:'));
    assert.ok(profile.screenFrameRefs.length >= 2);
    assert.ok(profile.inputIntentRefs.length >= 1);
    assert.ok(profile.executorEventRefs.length >= 1);
    assert.ok(profile.beforeAfterFrameRefs.length >= 1);
    assert.ok(profile.annotationProposalRefs.length >= 1);
    assert.ok(profile.contributionBoundary.mayProduceArtifactKinds.length >= 1);
  }

  for (const chain of bundle.artifactChains) {
    assert.equal(chain.verifier.status, 'passed');
    assert.equal(chain.guiPresent.status, 'present');
    assert.equal(chain.userLevelEligible, false);
  }
});

test('research workflow becomes user-level eligible only with explicit real VirtualAppScreen evidence mode', () => {
  const bundle = buildVirtualAppScreenResearchWorkflowBundle({
    runId: 'research-workflow-real-contract',
    evidenceMode: 'real-virtual-app-screen',
  });

  assert.equal(bundle.fixtureBoundary.diagnosticFixture, false);
  assert.equal(bundle.validation.status, 'passed');
  assert.equal(bundle.validation.ok, true);
  assert.deepEqual(bundle.validation.issues, []);
  assert.equal(bundle.manifest.status, 'passed');
  assert.equal(bundle.manifest.userAcceptanceEligible, true);
  assert.equal(bundle.schedulingPlan.strategy, 'isolated-parallel');
  assert.deepEqual(bundle.schedulingPlan.isolatedParallelProfileIds, REQUIRED_RESEARCH_SCREEN_PROFILE_IDS);
  assert.deepEqual(bundle.schedulingPlan.nonIsolatedSerialProfileIds, []);
  assert.deepEqual(bundle.manifest.artifactRefs, bundle.artifactChains.map((chain) => chain.artifactRef));
  assert.deepEqual(bundle.manifest.verificationRefs, bundle.artifactChains.map((chain) => chain.verifierRef));
  assert.deepEqual(bundle.manifest.guiPresentRefs, bundle.artifactChains.map((chain) => chain.guiPresentRef));
  assert.ok(bundle.profiles.every((profile) => profile.blockedPolicy.userLevelEligible));
  assert.ok(bundle.artifactChains.every((chain) => chain.userLevelEligible));
});

test('research workflow validator blocks cross-screen artifact contribution boundary violations', () => {
  const bundle = buildVirtualAppScreenResearchWorkflowBundle({
    runId: 'research-workflow-cross-screen-write',
    evidenceMode: 'real-virtual-app-screen',
    crossScreenArtifactWrite: true,
  });
  const csvChain = bundle.artifactChains.find((chain) => chain.kind === 'csv');

  assert.equal(csvChain?.producerProfileId, 'browser-research');
  assert.equal(csvChain?.userLevelEligible, false);
  assert.equal(bundle.validation.status, 'blocked');
  assert.equal(bundle.validation.ok, false);
  assert.ok(bundle.validation.crossScreenBoundaryViolations.some((issue) => (
    issue.includes('browser-research') && issue.includes('csv')
  )));
  assert.equal(bundle.manifest.status, 'blocked');
  assert.ok(bundle.manifest.validation.missingRefs.includes('artifactRefs'));
});

test('research workflow schedules isolated screens in parallel and non-isolated screens serially', () => {
  const isolated = buildVirtualAppScreenResearchWorkflowBundle({
    runId: 'research-workflow-isolated-scheduling',
    evidenceMode: 'real-virtual-app-screen',
  });
  assert.equal(isolated.schedulingPlan.strategy, 'isolated-parallel');
  assert.deepEqual(isolated.schedulingPlan.nonIsolatedSerialProfileIds, []);

  const nonIsolated = buildVirtualAppScreenResearchWorkflowBundle({
    runId: 'research-workflow-non-isolated-scheduling',
    evidenceMode: 'real-virtual-app-screen',
    nonIsolatedProfiles: ['terminal-experiment'],
  });
  const terminal = nonIsolated.profiles.find((profile) => profile.id === 'terminal-experiment');

  assert.equal(nonIsolated.schedulingPlan.strategy, 'non-isolated-serial');
  assert.deepEqual(nonIsolated.schedulingPlan.nonIsolatedSerialProfileIds, ['terminal-experiment']);
  assert.equal(nonIsolated.schedulingPlan.isolatedParallelProfileIds.includes('terminal-experiment'), false);
  assert.equal(terminal?.adapterReadiness.backgroundRenderable, false);
  assert.equal(terminal?.adapterReadiness.sharedSystemInputUsed, true);
  assert.equal(terminal?.blockedPolicy.status, 'requires-handoff');
  assert.equal(nonIsolated.validation.status, 'requires-handoff');
  assert.equal(nonIsolated.manifest.status, 'requires-handoff');
});

test('research workflow artifact chain fails closed without verifier and gui.present refs', () => {
  const bundle = buildVirtualAppScreenResearchWorkflowBundle({
    runId: 'research-workflow-artifact-chain-fail-closed',
    evidenceMode: 'real-virtual-app-screen',
    missingArtifactVerifierKinds: ['figure'],
    missingArtifactGuiPresentKinds: ['ppt'],
  });
  const figure = bundle.artifactChains.find((chain) => chain.kind === 'figure');
  const ppt = bundle.artifactChains.find((chain) => chain.kind === 'ppt');

  assert.equal(figure?.verifier.status, 'missing');
  assert.equal(ppt?.guiPresent.status, 'missing');
  assert.equal(bundle.validation.status, 'blocked');
  assert.equal(bundle.validation.ok, false);
  assert.ok(bundle.validation.missingArtifactChainRefs.includes('figure:verifierRef'));
  assert.ok(bundle.validation.missingArtifactChainRefs.includes('ppt:guiPresentRef'));
  assert.equal(bundle.manifest.status, 'blocked');
  assert.ok(bundle.manifest.validation.missingRefs.includes('artifactRefs'));
  assert.ok(bundle.manifest.validation.missingRefs.includes('verificationRefs'));
  assert.ok(bundle.manifest.validation.missingRefs.includes('guiPresentRefs'));
});

test('research workflow rejects DOM Playwright and shell-only substitute completion claims', () => {
  const bundle = buildVirtualAppScreenResearchWorkflowBundle({
    runId: 'research-workflow-substitute-rejection',
    evidenceMode: 'real-virtual-app-screen',
    includeDomPlaywrightShellSubstitutes: true,
    shellOnlyArtifactKinds: ['log'],
  });
  const rejectedKinds = new Set(bundle.validation.rejectedClaimKinds);
  const manifestRejectedKinds = new Set(bundle.manifest.validation.rejectedClaimKinds);

  assert.equal(bundle.validation.status, 'blocked');
  assert.equal(bundle.validation.ok, false);
  assert.equal(rejectedKinds.has('dom'), true);
  assert.equal(rejectedKinds.has('playwright'), true);
  assert.equal(rejectedKinds.has('shell-direct-artifact'), true);
  assert.equal(manifestRejectedKinds.has('dom'), true);
  assert.equal(manifestRejectedKinds.has('playwright'), true);
  assert.equal(manifestRejectedKinds.has('shell-direct-artifact'), true);
  assert.ok(bundle.validation.issues.some((issue) => issue.includes('log artifact was produced by a shell direct write')));
  assert.equal(bundle.manifest.userAcceptanceEligible, false);
});
