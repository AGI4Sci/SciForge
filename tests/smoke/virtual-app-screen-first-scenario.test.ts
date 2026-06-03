import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildVirtualAppScreenFirstScenarioBundle,
  writeVirtualAppScreenFirstScenarioBundle,
} from '../../tools/computer-use-next/virtual-app-screen-first-scenario.js';

test('VirtualAppScreen first scenario fixture is local, low-risk, and diagnostic-only by default', () => {
  const bundle = buildVirtualAppScreenFirstScenarioBundle({
    runId: 'local-fixture',
    createdAt: '2026-06-01T00:00:00.000Z',
  });

  assert.equal(bundle.schemaVersion, 'sciforge.computer-use.virtual-app-screen-first-scenario.v1');
  assert.equal(bundle.taskId, 'P0-CU-UA-FIRST-SCENARIO');
  assert.equal(bundle.scenarioId, 'virtual-app-screen-local-research-note');
  assert.equal(bundle.localSafety.lowRisk, true);
  assert.equal(bundle.localSafety.requiresExternalAccount, false);
  assert.equal(bundle.localSafety.sendsExternalMessages, false);
  assert.equal(bundle.localSafety.modifiesUserPhysicalDesktop, false);
  assert.equal(bundle.localSafety.networkRequired, false);
  assert.equal(bundle.artifactValidation.ok, true);
  assert.equal(bundle.fixtureBoundary.diagnosticFixture, true);
  assert.equal(bundle.fixtureBoundary.fixtureCanClaimUserAcceptance, false);
  assert.equal(bundle.manifest.status, 'blocked');
  assert.equal(bundle.manifest.diagnosticOnly, true);
  assert.equal(bundle.manifest.userAcceptanceEligible, false);
  assert.deepEqual(bundle.manifest.validation.missingRefs, []);
  assert.ok(bundle.manifest.validation.issues.some((issue) => issue.includes('real VirtualAppScreen')));
  assert.ok(bundle.manifest.validation.issues.some((issue) => issue.includes('diagnosticOnly')));
  assert.ok(bundle.manifest.evidenceClaims.some((claim) => (
    claim.kind === 'target-bound-fixture'
    && claim.status === 'diagnostic-only'
    && claim.userAcceptanceEligible === false
  )));
});

test('VirtualAppScreen first scenario contract real app-screen evidence fields remain blocked without real Host opt-in evidence', () => {
  const bundle = buildVirtualAppScreenFirstScenarioBundle({
    runId: 'real-app-screen-run',
    evidenceMode: 'real-virtual-app-screen',
  });

  assert.equal(bundle.fixtureBoundary.diagnosticFixture, false);
  assert.equal(bundle.artifactValidation.ok, true);
  assert.equal(bundle.manifest.status, 'blocked');
  assert.equal(bundle.manifest.diagnosticOnly, false);
  assert.equal(bundle.manifest.userAcceptanceEligible, false);
  assert.equal(bundle.manifest.validation.ok, false);
  assert.deepEqual(bundle.manifest.validation.missingRefs, []);
  assert.deepEqual(bundle.manifest.validation.rejectedClaimKinds, []);
  assert.ok(bundle.manifest.validation.issues.some((issue) => issue.includes('real VirtualAppScreen action-causality evidence is required')));
  assert.deepEqual(bundle.manifest.targetAppRefs, [bundle.refs.targetAppRef]);
  assert.deepEqual(bundle.manifest.targetWindowRefs, [bundle.refs.targetWindowRef]);
  assert.deepEqual(bundle.manifest.sessionRefs, [bundle.refs.sessionRef]);
  assert.deepEqual(bundle.manifest.verificationRefs, [bundle.refs.artifactValidationRef]);
});

test('VirtualAppScreen first scenario Screen record exposes the minimum user-visible behavior refs', () => {
  const bundle = buildVirtualAppScreenFirstScenarioBundle({
    runId: 'screen-visible-refs',
    evidenceMode: 'real-virtual-app-screen',
  });
  const screen = bundle.screen.data;
  const visibleMinimum = bundle.screen.userVisibleMinimum;
  const timelineRefs = bundle.records.replay.timelineRefs as string[];

  assert.equal(screen.status, 'passed');
  assert.equal(screen.attachState, 'attached');
  assert.equal(screen.targetAppRef, bundle.refs.targetAppRef);
  assert.equal(screen.targetWindowRef, bundle.refs.targetWindowRef);
  assert.equal(screen.sessionRef, bundle.refs.sessionRef);
  assert.equal(screen.currentFrameRef, bundle.refs.afterFrameRef);
  assert.deepEqual(screen.actorCursorRefs, [bundle.refs.userCursorRef, bundle.refs.agentCursorRef]);
  assert.deepEqual(screen.beforeAfterFrameRefs, [bundle.refs.beforeAfterRef]);
  assert.deepEqual(screen.annotationOverlayRefs, [bundle.refs.annotationOverlayRef]);
  assert.deepEqual(screen.annotationProposalRefs, [bundle.refs.annotationProposalRef]);
  assert.deepEqual(screen.inputIntentRefs, [bundle.refs.inputIntentRef]);
  assert.deepEqual(screen.executorEventRefs, [bundle.refs.executorEventRef]);
  assert.deepEqual(screen.artifactRefs, [bundle.refs.artifactRef]);
  assert.deepEqual(screen.guiPresentRefs, [bundle.refs.guiPresentRef]);
  assert.deepEqual(visibleMinimum.targetAppFrameRefs, [bundle.refs.beforeFrameRef, bundle.refs.afterFrameRef]);
  assert.deepEqual(visibleMinimum.beforeAfterFrameRefs, [bundle.refs.beforeAfterRef]);
  assert.deepEqual(visibleMinimum.artifactPreviewRefs, [bundle.refs.artifactRef, bundle.refs.guiPresentRef]);
  assert.ok(timelineRefs.includes(bundle.refs.beforeAfterRef));
  assert.ok(timelineRefs.includes(bundle.refs.artifactRef));
  assert.ok(timelineRefs.includes(bundle.refs.guiPresentRef));
});

test('VirtualAppScreen first scenario artifact validator rejects shell-only and old artifacts', () => {
  const shellOnly = buildVirtualAppScreenFirstScenarioBundle({
    runId: 'shell-only-artifact',
    evidenceMode: 'real-virtual-app-screen',
    shellDirectArtifactWrite: true,
  });
  assert.equal(shellOnly.artifactValidation.ok, false);
  assert.ok(shellOnly.artifactValidation.issues.some((issue) => issue.includes('shell direct artifact writes')));
  assert.equal(shellOnly.manifest.status, 'blocked');
  assert.equal(shellOnly.manifest.userAcceptanceEligible, false);
  assert.ok(shellOnly.manifest.validation.missingRefs.includes('verificationRefs'));
  assert.deepEqual(shellOnly.manifest.validation.rejectedClaimKinds, ['shell-direct-artifact']);

  const oldArtifact = buildVirtualAppScreenFirstScenarioBundle({
    runId: 'old-artifact',
    evidenceMode: 'real-virtual-app-screen',
    oldArtifact: true,
  });
  assert.equal(oldArtifact.artifactValidation.ok, false);
  assert.ok(oldArtifact.artifactValidation.issues.some((issue) => issue.includes('older than the current scenario run')));
  assert.equal(oldArtifact.manifest.status, 'blocked');
  assert.equal(oldArtifact.manifest.userAcceptanceEligible, false);
  assert.ok(oldArtifact.manifest.validation.missingRefs.includes('verificationRefs'));
});

test('VirtualAppScreen first scenario fail-closes without gui.present or before-after evidence', () => {
  const noGuiPresent = buildVirtualAppScreenFirstScenarioBundle({
    runId: 'missing-gui-present',
    evidenceMode: 'real-virtual-app-screen',
    includeGuiPresent: false,
  });
  assert.equal(noGuiPresent.artifactValidation.ok, true);
  assert.equal(noGuiPresent.manifest.status, 'blocked');
  assert.equal(noGuiPresent.manifest.userAcceptanceEligible, false);
  assert.ok(noGuiPresent.manifest.validation.missingRefs.includes('guiPresentRefs'));
  assert.equal(noGuiPresent.screen.data.status, 'blocked');
  assert.equal(noGuiPresent.screen.data.attachState, 'blocked');
  assert.equal(noGuiPresent.records.guiPresent, undefined);

  const noBeforeAfter = buildVirtualAppScreenFirstScenarioBundle({
    runId: 'missing-before-after',
    evidenceMode: 'real-virtual-app-screen',
    includeBeforeAfter: false,
  });
  assert.equal(noBeforeAfter.artifactValidation.ok, false);
  assert.ok(noBeforeAfter.artifactValidation.issues.some((issue) => issue.includes('missing causality ref')));
  assert.equal(noBeforeAfter.manifest.status, 'blocked');
  assert.equal(noBeforeAfter.manifest.userAcceptanceEligible, false);
  assert.ok(noBeforeAfter.manifest.validation.missingRefs.includes('beforeAfterFrameRefs'));
  assert.ok(noBeforeAfter.manifest.validation.missingRefs.includes('verificationRefs'));
  assert.equal(noBeforeAfter.screen.data.status, 'blocked');
  assert.equal(noBeforeAfter.screen.data.attachState, 'blocked');
});

test('VirtualAppScreen first scenario writer materializes a re-checkable local fixture bundle', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vas-first-scenario-'));
  try {
    const bundle = await writeVirtualAppScreenFirstScenarioBundle(workspace, {
      runId: 'materialized-fixture',
    });
    const manifest = JSON.parse(await readFile(join(workspace, 'virtual-app-screen-user-acceptance-manifest.json'), 'utf8')) as Record<string, unknown>;
    const artifact = await readFile(join(workspace, 'artifacts/research-note.md'), 'utf8');
    const verifier = JSON.parse(await readFile(join(workspace, 'verifier/research-note-artifact.json'), 'utf8')) as Record<string, unknown>;
    const agentCursor = JSON.parse(await readFile(join(workspace, 'cursors/agent.json'), 'utf8')) as Record<string, unknown>;
    const scenario = JSON.parse(await readFile(join(workspace, 'scenario-bundle.json'), 'utf8')) as Record<string, unknown>;

    assert.equal(scenario.schemaVersion, bundle.schemaVersion);
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.userAcceptanceEligible, false);
    assert.match(artifact, /Source evidence refs:/);
    assert.match(artifact, /Annotation refs:/);
    assert.equal(verifier.ok, true);
    assert.equal(agentCursor.actor, 'agent');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
