import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  runCuL3IndependentInputAcceptanceHarness,
} from '../../tools/cu-l3-independent-input-acceptance-harness.js';

const execFileAsync = promisify(execFile);
const fixtureBytes = Buffer.from('fixture evidence');

test('CU L3 independent-input harness projects a non-dry-run package-bridge trace into passable user acceptance', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-pass-'));
  try {
    const tracePath = join(workspace, 'vision-trace.json');
    const adapterPath = join(workspace, 'independent-input-adapter.json');
    const evidence = await writeHarnessEvidenceFiles(workspace);
    await writeFile(join(workspace, 'host-ports.json'), JSON.stringify({ ports: { execute: { provider: 'sciforge-simulated-remote-desktop-input-adapter' } } }));
    await writeFile(join(workspace, 'tool-payload.json'), JSON.stringify({ displayIntent: { kind: 'gui.present' } }));
    await writeFile(join(workspace, 'request.json'), JSON.stringify({ task: 'Create a multi-app acceptance artifact from visible source facts.' }));
    await writeFile(tracePath, JSON.stringify(validTrace({
      runId: 'cu-l3-independent-fixture',
      runRef: '',
    }), null, 2));
    await writeFile(adapterPath, JSON.stringify(validAdapter('cu-l3-independent-fixture'), null, 2));

    const result = await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      adapterPath,
      finalArtifactRef: evidence.finalArtifactRef,
      guiPresentRecordRef: evidence.guiPresentRecordRef,
      guiPresentPayloadRef: evidence.guiPresentPayloadRef,
    });

    assert.equal(result.verifier.status, 'passed');
    assert.equal(result.manifest.status, 'multi-app-workflow-passed');
    assert.equal(result.manifest.level, 'L3');
    assert.deepEqual(result.manifest.appWorkflow.apps, ['Browser', 'Slide Editor', 'File Manager']);
    assert.deepEqual(result.manifest.appWorkflow.windowSwitchTraceRefs, ['vision-trace.json']);
    assert.ok(result.manifest.screenshotRefs.before.includes('step-001-before.png'));
    assert.ok(result.manifest.screenshotRefs.before.includes('step-003-before.png'));
    assert.ok(result.manifest.screenshotRefs.after.includes('step-001-after.png'));
    assert.ok(result.manifest.screenshotRefs.after.includes('step-003-after.png'));
    assert.deepEqual(result.manifest.focusCropRefs, ['step-001-before-focus.png']);
    assert.doesNotMatch(JSON.stringify(result.manifest), new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual(result.manifest.groundingDiagnosticsRefs, ['vision-trace.json']);
    const independentClaim = result.manifest.evidenceClaims.find((claim) => claim.kind === 'independent-input-adapter');
    assert.ok(independentClaim);
    assert.ok(independentClaim.recordRefs?.includes('independent-input-adapter.json'));
    assert.ok(independentClaim.sessionRefs?.includes('independent-input-adapter.json'));
    assert.equal(result.manifest.executorLease.owner, 'sciforge-independent-input-adapter remote-desktop');
    assert.equal(result.manifest.verifierVerdict.ref, 'cu-l3-independent-input-verifier.json');
    assert.ok(result.manifest.guiPresent.displayedRefs?.includes(evidence.finalArtifactRef));
    assert.equal(result.manifest.scenarioId, 'CU-LONG-004');
    assert.equal(result.manifest.completionEvidence?.evidenceKind, 'isolated-L3');
    assert.equal(result.manifest.completionEvidenceRef, 'isolated-desktop-l3-workflow-evidence.json');

    const writtenVerifier = JSON.parse(await readFile(result.paths.verifier, 'utf8'));
    assert.equal(writtenVerifier.schemaVersion, 'sciforge.computer-use.l3-independent-input-verifier.v1');
    assert.deepEqual(writtenVerifier.issueRefs, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness discovers package-bridge gui.present sibling evidence by default', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-siblings-'));
  try {
    const tracePath = join(workspace, 'vision-trace.json');
    const adapterPath = join(workspace, 'independent-input-adapter.json');
    const evidence = await writeHarnessEvidenceFiles(workspace);
    await writeFile(join(workspace, 'host-ports.json'), JSON.stringify({ ports: { execute: { provider: 'sciforge-simulated-remote-desktop-input-adapter' } } }));
    await writeFile(join(workspace, 'tool-payload.json'), JSON.stringify({ displayIntent: { kind: 'gui.present' } }));
    await writeFile(join(workspace, 'computer-use-request.json'), JSON.stringify({ task: 'Create a multi-app acceptance artifact from visible source facts.' }));
    await writeFile(join(workspace, 'gui-present.json'), JSON.stringify({ port: 'gui.present', artifactRef: evidence.finalArtifactRef }));
    await writeFile(tracePath, JSON.stringify(validTrace({
      runId: 'cu-l3-sibling-fixture',
      runRef: workspace,
    }), null, 2));
    await writeFile(adapterPath, JSON.stringify(validAdapter('cu-l3-sibling-fixture'), null, 2));

    const result = await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      adapterPath,
      finalArtifactRef: evidence.finalArtifactRef,
    });

    assert.equal(result.manifest.status, 'multi-app-workflow-passed');
    assert.equal(result.manifest.guiPresent.recordRef, 'gui-present.json');
    assert.equal(result.manifest.guiPresent.payloadRef, 'tool-payload.json');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness discovers generic markdown final artifacts from visible remote evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-visible-md-'));
  try {
    const runId = 'cu-l3-visible-md-fixture';
    const tracePath = join(workspace, 'vision-trace.json');
    const adapterPath = join(workspace, 'independent-input-adapter.json');
    const finalArtifactRef = 'index.md';
    const visibleArtifact = visibleMarkdownArtifact(finalArtifactRef, 'step-003-save');
    await writeHarnessEvidenceFiles(workspace, { completionFinalArtifactRef: finalArtifactRef });
    await writeFile(join(workspace, finalArtifactRef), '# Acceptance index\n\nVisible final markdown artifact.\n');
    await writeFile(join(workspace, 'host-ports.json'), JSON.stringify({ ports: { execute: { provider: 'sciforge-simulated-remote-desktop-input-adapter' } } }));
    await writeFile(join(workspace, 'tool-payload.json'), JSON.stringify({
      displayIntent: { kind: 'gui.present' },
      visibleArtifactRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    }));
    await writeFile(join(workspace, 'computer-use-request.json'), JSON.stringify({ task: 'Create a markdown acceptance artifact from visible source facts.' }));
    await writeFile(join(workspace, 'gui-present.json'), JSON.stringify({
      port: 'gui.present',
      artifactRef: finalArtifactRef,
      visibleArtifactRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    }));
    await writeFile(join(workspace, 'virtual-remote-session.json'), JSON.stringify({
      schemaVersion: 'sciforge.computer-use.virtual-remote-session-trace.v1',
      runId,
      visibleArtifactRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    }));
    const trace = validTrace({ runId, runRef: workspace }) as Record<string, any>;
    trace.request = { task: 'Create a markdown acceptance artifact from visible source facts.' };
    trace.toolPayload = {
      displayIntent: { kind: 'gui.present' },
      visibleArtifactRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    };
    trace.guiPresent = {
      recordRef: 'gui-present.json',
      payloadRef: 'tool-payload.json',
      displayedRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    };
    trace.virtualRemoteSession = {
      sessionRef: 'virtual-remote-session.json',
      visibleArtifactRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    };
    const adapter = validAdapter(runId) as Record<string, any>;
    adapter.virtualRemoteSession = { stateRef: 'virtual-remote-session.json' };
    await writeFile(tracePath, JSON.stringify(trace, null, 2));
    await writeFile(adapterPath, JSON.stringify(adapter, null, 2));

    const result = await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      adapterPath,
    });

    assert.equal(result.verifier.status, 'passed');
    assert.equal(result.manifest.status, 'multi-app-workflow-passed');
    assert.equal(result.manifest.finalArtifactRef, finalArtifactRef);
    assert.equal(result.manifest.guiPresent.recordRef, 'gui-present.json');
    assert.equal(result.manifest.guiPresent.payloadRef, 'tool-payload.json');
    assert.ok(result.manifest.guiPresent.displayedRefs?.includes(finalArtifactRef));
    assert.ok(result.manifest.guiPresent.artifactRefs?.includes(finalArtifactRef));
    const guiPresentClaim = result.manifest.evidenceClaims.find((claim) => claim.kind === 'gui-present-record');
    assert.ok(guiPresentClaim?.artifactRefs?.includes(finalArtifactRef));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness discovers bundle-local final artifacts from sibling sidecars', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-sidecar-final-'));
  try {
    const runId = 'cu-l3-sidecar-final-fixture';
    const tracePath = join(workspace, 'vision-trace.json');
    const adapterPath = join(workspace, 'independent-input-adapter.json');
    const finalArtifactRef = 'report.md';
    const visibleArtifact = visibleMarkdownArtifact(finalArtifactRef, 'step-003-save');
    await writeHarnessEvidenceFiles(workspace, { completionFinalArtifactRef: finalArtifactRef });
    await writeFile(join(workspace, finalArtifactRef), '# Report\n\nVisible sidecar final artifact.\n');
    await writeFile(join(workspace, 'host-ports.json'), JSON.stringify({ ports: { execute: { provider: 'sciforge-simulated-remote-desktop-input-adapter' } } }));
    await writeFile(join(workspace, 'tool-payload.json'), JSON.stringify({
      displayIntent: { kind: 'gui.present' },
      artifacts: [{ path: 'vision-trace.json' }],
      finalArtifactRefs: [finalArtifactRef],
      visibleArtifacts: [visibleArtifact],
    }));
    await writeFile(join(workspace, 'computer-use-request.json'), JSON.stringify({ task: 'Create a report artifact from visible source facts.' }));
    await writeFile(join(workspace, 'gui-present.json'), JSON.stringify({
      port: 'gui.present',
      payload: {
        status: 'completed',
        traceRefs: ['vision-trace.json'],
        artifactRefs: ['vision-trace.json', finalArtifactRef],
      },
    }));
    await writeFile(join(workspace, 'virtual-remote-session.json'), JSON.stringify({
      schemaVersion: 'sciforge.computer-use.virtual-remote-session.v1',
      runId,
      visibleArtifacts: [visibleArtifact],
    }));
    const trace = validTrace({ runId, runRef: workspace }) as Record<string, any>;
    trace.request = { task: 'Create a report artifact from visible source facts.' };
    delete trace.guiPresent;
    await writeFile(tracePath, JSON.stringify(trace, null, 2));
    await writeFile(adapterPath, JSON.stringify(validAdapter(runId), null, 2));

    const result = await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      adapterPath,
    });

    assert.equal(result.verifier.status, 'passed');
    assert.equal(result.manifest.status, 'multi-app-workflow-passed');
    assert.equal(result.manifest.finalArtifactRef, finalArtifactRef);
    assert.ok(result.manifest.guiPresent.displayedRefs?.includes(finalArtifactRef));
    const guiPresentClaim = result.manifest.evidenceClaims.find((claim) => claim.kind === 'gui-present-record');
    assert.ok(guiPresentClaim?.artifactRefs?.includes(finalArtifactRef));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness rejects completion evidence refs outside the current round bundle', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-outside-l3-'));
  const outside = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-outside-source-'));
  try {
    const tracePath = join(workspace, 'vision-trace.json');
    const adapterPath = join(workspace, 'independent-input-adapter.json');
    const outsideCompletionPath = join(outside, 'isolated-desktop-l3-workflow-evidence.json');
    const evidence = await writeHarnessEvidenceFiles(workspace, { writeCompletionEvidence: false });
    const trace = validTrace({
      runId: 'cu-l3-outside-completion-fixture',
      runRef: workspace,
    }) as Record<string, any>;
    trace.completionEvidenceRef = outsideCompletionPath;
    await writeFile(outsideCompletionPath, JSON.stringify(isolatedL3CompletionEvidence(), null, 2));
    await writeFile(join(workspace, 'host-ports.json'), JSON.stringify({ ports: { execute: { provider: 'sciforge-simulated-remote-desktop-input-adapter' } } }));
    await writeFile(join(workspace, 'tool-payload.json'), JSON.stringify({ displayIntent: { kind: 'gui.present' } }));
    await writeFile(join(workspace, 'computer-use-request.json'), JSON.stringify({ task: 'Create a multi-app acceptance artifact from visible source facts.' }));
    await writeFile(join(workspace, 'gui-present.json'), JSON.stringify({ port: 'gui.present', artifactRef: evidence.finalArtifactRef }));
    await writeFile(tracePath, JSON.stringify(trace, null, 2));
    await writeFile(adapterPath, JSON.stringify(validAdapter('cu-l3-outside-completion-fixture'), null, 2));

    const result = await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      adapterPath,
      finalArtifactRef: evidence.finalArtifactRef,
    });

    assert.equal(result.verifier.status, 'blocked');
    assert.ok(result.verifier.issueRefs.includes('completion-evidence-ref-bundle-local'));
    assert.equal(result.manifest.status, 'blocked');
    assert.equal(result.manifest.completionEvidenceRef, undefined);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness rejects cross-round completion evidence refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-cross-round-l3-'));
  const previousRound = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-previous-round-'));
  try {
    const previousCompletionPath = join(previousRound, 'isolated-desktop-l3-workflow-evidence.json');
    await writeFile(previousCompletionPath, JSON.stringify(isolatedL3CompletionEvidence(), null, 2));

    await assertHarnessRejectsCompletionEvidenceRef(
      workspace,
      relative(workspace, previousCompletionPath),
      'cross-round completionEvidenceRef should not satisfy the current round bundle',
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(previousRound, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness rejects reserved completion evidence ref names', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-reserved-l3-'));
  try {
    await writeFile(
      join(workspace, 'cu-user-acceptance-manifest.json'),
      JSON.stringify(isolatedL3CompletionEvidence(), null, 2),
    );

    await assertHarnessRejectsCompletionEvidenceRef(
      workspace,
      'cu-user-acceptance-manifest.json',
      'reserved manifest name should not satisfy completionEvidenceRef',
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness rejects missing completion evidence refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-missing-l3-'));
  try {
    await assertHarnessRejectsCompletionEvidenceRef(
      workspace,
      'missing/isolated-desktop-l3-workflow-evidence.json',
      'missing completionEvidenceRef should not be projected',
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness rejects pseudo completion evidence refs even when a local file exists', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-pseudo-l3-'));
  try {
    await writeFile(
      join(workspace, 'artifact:isolated-desktop-l3-workflow-evidence.json'),
      JSON.stringify(isolatedL3CompletionEvidence(), null, 2),
    );

    await assertHarnessRejectsCompletionEvidenceRef(
      workspace,
      'artifact:isolated-desktop-l3-workflow-evidence.json',
      'pseudo artifact: completionEvidenceRef should not satisfy the current round bundle',
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness rejects canonical completion evidence symlink escapes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-symlink-l3-'));
  const outside = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-symlink-source-'));
  try {
    const outsideCompletionPath = join(outside, 'isolated-desktop-l3-workflow-evidence.json');
    await writeFile(outsideCompletionPath, JSON.stringify(isolatedL3CompletionEvidence(), null, 2));
    await symlink(outsideCompletionPath, join(workspace, 'isolated-desktop-l3-workflow-evidence.json'));

    await assertHarnessRejectsCompletionEvidenceRef(
      workspace,
      'isolated-desktop-l3-workflow-evidence.json',
      'canonical completionEvidenceRef symlink should not satisfy the current round bundle',
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness rejects canonical completion evidence with missing nested refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-missing-nested-l3-'));
  try {
    await writeFile(
      join(workspace, 'isolated-desktop-l3-workflow-evidence.json'),
      JSON.stringify(isolatedL3CompletionEvidence(), null, 2),
    );

    await assertHarnessRejectsCompletionEvidenceRef(
      workspace,
      'isolated-desktop-l3-workflow-evidence.json',
      'canonical completionEvidenceRef with missing nested refs should not satisfy the current round bundle',
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness blocks shared system input traces even with an adapter file nearby', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-blocked-'));
  try {
    const tracePath = join(workspace, 'vision-trace.json');
    const adapterPath = join(workspace, 'independent-input-adapter.json');
    const trace = validTrace({ runId: 'cu-l3-shared-input-fixture', runRef: workspace }) as Record<string, any>;
    trace.genericComputerUse.inputChannelContract = {
      type: 'generic-mouse-keyboard',
      pointerKeyboardOwnership: 'shared-system-pointer-keyboard',
      pointerMode: 'system-cursor-events',
      keyboardMode: 'system-key-events',
      userDeviceImpact: 'may-affect-frontmost-window',
    };
    trace.hostPorts.ports.execute = {
      provider: 'darwin-system-events-generic-gui-executor',
      inputAdapter: 'shared-system-input-acknowledged',
      sharedSystemInputExplicitlyAllowed: true,
    };
    await writeFile(tracePath, JSON.stringify(trace, null, 2));
    await writeFile(adapterPath, JSON.stringify(validAdapter('cu-l3-shared-input-fixture'), null, 2));

    const result = await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      adapterPath,
      finalArtifactRef: '.sciforge/vision-runs/cu-l3-shared-input-fixture/acceptance-slide.pptx',
      guiPresentRecordRef: '.sciforge/vision-runs/cu-l3-shared-input-fixture/gui-present-record.json',
      guiPresentPayloadRef: '.sciforge/vision-runs/cu-l3-shared-input-fixture/tool-payload.json',
    });

    assert.equal(result.verifier.status, 'blocked');
    assert.ok(result.verifier.issueRefs.includes('independent-input-contract'));
    assert.ok(result.verifier.issueRefs.includes('no-shared-system-input-markers'));
    assert.equal(result.manifest.status, 'blocked');
    assert.equal(result.manifest.verifierVerdict.status, 'blocked');
    assert.ok(result.manifest.blockedItems[0]?.reason.includes('verifier pass verdict'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness blocks test action fixture traces even when dryRun is false', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-fixture-mode-'));
  try {
    const tracePath = join(workspace, 'vision-trace.json');
    const adapterPath = join(workspace, 'independent-input-adapter.json');
    const trace = validTrace({ runId: 'cu-l3-test-action-fixture', runRef: workspace }) as Record<string, any>;
    trace.config.testActionFixtureMode = true;
    await writeFile(tracePath, JSON.stringify(trace, null, 2));
    await writeFile(adapterPath, JSON.stringify(validAdapter('cu-l3-test-action-fixture'), null, 2));

    const result = await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      adapterPath,
      finalArtifactRef: '.sciforge/vision-runs/cu-l3-test-action-fixture/acceptance-slide.pptx',
      guiPresentRecordRef: '.sciforge/vision-runs/cu-l3-test-action-fixture/gui-present-record.json',
      guiPresentPayloadRef: '.sciforge/vision-runs/cu-l3-test-action-fixture/tool-payload.json',
    });

    assert.equal(result.verifier.status, 'blocked');
    assert.ok(result.verifier.issueRefs.includes('no-test-action-fixture-mode'));
    assert.equal(result.manifest.status, 'blocked');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness requires structured taskId binding when projecting CU-NEXT evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-task-id-'));
  try {
    const tracePath = join(workspace, 'vision-trace.json');
    const adapterPath = join(workspace, 'independent-input-adapter.json');
    await writeFile(tracePath, JSON.stringify(validTrace({
      runId: 'cu-l3-missing-task-id',
      runRef: workspace,
    }), null, 2));
    await writeFile(adapterPath, JSON.stringify(validAdapter('cu-l3-missing-task-id'), null, 2));

    const result = await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      adapterPath,
      taskId: 'CU-NEXT-07',
      finalArtifactRef: '.sciforge/vision-runs/cu-l3-missing-task-id/acceptance-slide.pptx',
      guiPresentRecordRef: '.sciforge/vision-runs/cu-l3-missing-task-id/gui-present-record.json',
      guiPresentPayloadRef: '.sciforge/vision-runs/cu-l3-missing-task-id/tool-payload.json',
    });

    assert.equal(result.verifier.status, 'blocked');
    assert.ok(result.verifier.issueRefs.includes('task-id-bound'));
    assert.equal(result.manifest.status, 'blocked');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input CLI writes verifier, projected input, and user acceptance manifest', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-cli-'));
  try {
    const tracePath = join(workspace, 'vision-trace.json');
    const adapterPath = join(workspace, 'independent-input-adapter.json');
    const verifierPath = join(workspace, 'verifier.json');
    const inputPath = join(workspace, 'input.json');
    const manifestPath = join(workspace, 'manifest.json');
    const evidence = await writeHarnessEvidenceFiles(workspace);
    await writeFile(tracePath, JSON.stringify(validTrace({
      runId: 'cu-l3-independent-cli',
      runRef: workspace,
    }), null, 2));
    await writeFile(adapterPath, JSON.stringify(validAdapter('cu-l3-independent-cli'), null, 2));

    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-l3-independent-input-acceptance-harness.ts',
      '--scenario-id',
      'CU-LONG-CLI',
      '--trace',
      tracePath,
      '--adapter',
      adapterPath,
      '--verifier-out',
      verifierPath,
      '--input-out',
      inputPath,
      '--manifest-out',
      manifestPath,
      '--final-artifact-ref',
      evidence.finalArtifactRef,
      '--gui-present-record-ref',
      evidence.guiPresentRecordRef,
      '--gui-present-payload-ref',
      evidence.guiPresentPayloadRef,
    ]);

    assert.match(stdout, /\[passed\/multi-app-workflow-passed\]/);
    const verifier = JSON.parse(await readFile(verifierPath, 'utf8'));
    const input = JSON.parse(await readFile(inputPath, 'utf8'));
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(verifier.status, 'passed');
    assert.equal(input.level, 'L3');
    assert.equal(input.scenarioId, 'CU-LONG-CLI');
    assert.equal(input.completionEvidence?.evidenceKind, 'isolated-L3');
    assert.equal(input.completionEvidenceRef, 'isolated-desktop-l3-workflow-evidence.json');
    assert.equal(manifest.status, 'multi-app-workflow-passed');
    assert.equal(manifest.scenarioId, 'CU-LONG-CLI');
    assert.equal(manifest.completionEvidence?.evidenceKind, 'isolated-L3');
    assert.equal(manifest.completionEvidenceRef, 'isolated-desktop-l3-workflow-evidence.json');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

async function assertHarnessRejectsCompletionEvidenceRef(
  workspace: string,
  completionEvidenceRef: string,
  message: string,
) {
  const tracePath = join(workspace, 'vision-trace.json');
  const adapterPath = join(workspace, 'independent-input-adapter.json');
  const evidence = await writeHarnessEvidenceFiles(workspace, { writeCompletionEvidence: false });
  const runId = 'cu-l3-invalid-completion-ref-fixture';
  const trace = validTrace({
    runId,
    runRef: workspace,
  }) as Record<string, any>;
  trace.completionEvidenceRef = completionEvidenceRef;
  await writeFile(join(workspace, 'host-ports.json'), JSON.stringify({ ports: { execute: { provider: 'sciforge-simulated-remote-desktop-input-adapter' } } }));
  await writeFile(join(workspace, 'tool-payload.json'), JSON.stringify({ displayIntent: { kind: 'gui.present' } }));
  await writeFile(join(workspace, 'computer-use-request.json'), JSON.stringify({ task: 'Create a multi-app acceptance artifact from visible source facts.' }));
  await writeFile(join(workspace, 'gui-present.json'), JSON.stringify({ port: 'gui.present', artifactRef: evidence.finalArtifactRef }));
  await writeFile(tracePath, JSON.stringify(trace, null, 2));
  await writeFile(adapterPath, JSON.stringify(validAdapter(runId), null, 2));

  const result = await runCuL3IndependentInputAcceptanceHarness({
    tracePath,
    adapterPath,
    finalArtifactRef: evidence.finalArtifactRef,
  });

  assert.equal(result.verifier.status, 'blocked', message);
  assert.ok(
    result.verifier.issueRefs.some((issueRef) => issueRef.startsWith('completion-evidence-')),
    `${message}: expected a completion-evidence verifier issue, got ${result.verifier.issueRefs.join(', ')}`,
  );
  assert.equal(result.manifest.status, 'blocked', message);
  assert.equal(result.manifest.completionEvidenceRef, undefined, message);
}

async function writeHarnessEvidenceFiles(
  workspace: string,
  options: { writeCompletionEvidence?: boolean; completionFinalArtifactRef?: string } = {},
) {
  const refs = [
    'step-001-before.png',
    'step-001-before-focus.png',
    'step-001-after.png',
    'step-002-before.png',
    'step-002-after.png',
    'step-003-before.png',
    'step-003-after.png',
  ];
  await Promise.all(refs.map((name) => writeFile(join(workspace, name), fixtureBytes)));
  const finalArtifactRef = 'acceptance-slide.pptx';
  const guiPresentRecordRef = 'gui-present-record.json';
  const guiPresentPayloadRef = 'tool-payload.json';
  await writeFile(join(workspace, finalArtifactRef), fixtureBytes);
  await writeFile(join(workspace, guiPresentRecordRef), JSON.stringify({ port: 'gui.present', artifactRef: finalArtifactRef }));
  await writeFile(join(workspace, guiPresentPayloadRef), JSON.stringify({ displayIntent: { kind: 'gui.present' } }));
  if (options.writeCompletionEvidence !== false) {
    const completionEvidence = isolatedL3CompletionEvidence([options.completionFinalArtifactRef ?? finalArtifactRef]);
    await materializeCompletionEvidenceRefs(workspace, completionEvidence);
    await writeFile(
      join(workspace, 'isolated-desktop-l3-workflow-evidence.json'),
      JSON.stringify(completionEvidence, null, 2),
    );
  }
  return { finalArtifactRef, guiPresentRecordRef, guiPresentPayloadRef };
}

async function materializeCompletionEvidenceRefs(workspace: string, completionEvidence: Record<string, unknown>) {
  await Promise.all(collectCompletionEvidenceFileRefs(completionEvidence).map(async (ref) => {
    const path = join(workspace, ref);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, fixtureBytes);
  }));
}

function collectCompletionEvidenceFileRefs(value: unknown, key = ''): string[] {
  if (typeof value === 'string') {
    const ref = completionEvidenceFixtureFileRef(value);
    return ref && looksLikeCompletionEvidenceFileRef(key, value) ? [ref] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectCompletionEvidenceFileRefs(item, key));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([childKey, child]) => collectCompletionEvidenceFileRefs(child, childKey));
}

function looksLikeCompletionEvidenceFileRef(key: string, value: string) {
  const trimmed = value.trim();
  const fileRef = completionEvidenceFixtureFileRef(trimmed);
  return /ref/i.test(key)
    && trimmed.length > 0
    && Boolean(fileRef)
    && /\.[a-z0-9][a-z0-9-]{0,15}$/i.test(fileRef?.split('/').at(-1) ?? '');
}

function completionEvidenceFixtureFileRef(ref: string): string | undefined {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return undefined;
  const fileRef = trimmed.split('#', 1)[0];
  if (!fileRef || fileRef.split(/[\\/]+/).includes('..')) return undefined;
  return fileRef;
}

function validTrace(options: { runId: string; runRef: string }) {
  return {
    schemaVersion: 'sciforge.vision-trace.v1',
    runId: options.runId,
    tool: 'action.sciforge.computer-use',
    runtime: 'sciforge.workspace-runtime.computer-use-package-bridge',
    actionProvider: 'action.sciforge.computer-use',
    createdAt: '2026-05-25T00:00:00.000Z',
    completedAt: '2026-05-25T00:01:00.000Z',
    request: {
      task: 'Create a generic multi-app acceptance artifact from visible source facts.',
      computerUseLong: {
        scenarioId: 'CU-LONG-004',
      },
    },
    completionEvidence: isolatedL3CompletionEvidence(),
    config: {
      dryRun: false,
      inputAdapter: 'remote-desktop',
      independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
    },
    hostPorts: {
      ports: {
        execute: {
          provider: 'sciforge-simulated-remote-desktop-input-adapter',
          inputAdapter: 'remote-desktop',
          independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
        },
      },
    },
    genericComputerUse: {
      inputChannelContract: {
        type: 'generic-mouse-keyboard',
        currentIndependentAdapter: 'remote-desktop',
        independentAdapterStatus: 'ready',
        pointerKeyboardOwnership: 'sciforge-independent-input-adapter',
        pointerMode: 'adapter-window-bound-pointer',
        keyboardMode: 'adapter-window-bound-keyboard',
        userDeviceImpact: 'none',
      },
    },
    finalVisibleScreenshotRef: traceFixtureRef(options.runRef, 'step-003-after.png'),
    guiPresent: {
      recordRef: '.sciforge/vision-runs/generic/gui-present-record.json',
      payloadRef: '.sciforge/vision-runs/generic/tool-payload.json',
    },
    steps: [
      {
        id: 'step-001-browser',
        kind: 'gui-execution',
        status: 'done',
        beforeScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: traceFixtureRef(options.runRef, 'step-001-before.png'),
            windowTarget: { appName: 'Browser' },
          },
          {
            type: 'screenshot',
            captureScope: 'focus-region',
            path: traceFixtureRef(options.runRef, 'step-001-before-focus.png'),
            windowTarget: { appName: 'Browser' },
          },
        ],
        afterScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: traceFixtureRef(options.runRef, 'step-001-after.png'),
            windowTarget: { appName: 'Browser' },
          },
        ],
        plannedAction: { type: 'click', targetDescription: 'visible source summary' },
        grounding: { provider: 'kv-ground', localX: 100, localY: 80 },
      },
      {
        id: 'step-002-slide',
        kind: 'gui-execution',
        status: 'done',
        beforeScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: traceFixtureRef(options.runRef, 'step-002-before.png'),
            windowTarget: { appName: 'Slide Editor' },
          },
        ],
        afterScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: traceFixtureRef(options.runRef, 'step-002-after.png'),
            windowTarget: { appName: 'Slide Editor' },
          },
        ],
        plannedAction: { type: 'type_text' },
      },
      {
        id: 'step-003-save',
        kind: 'gui-execution',
        status: 'done',
        beforeScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: traceFixtureRef(options.runRef, 'step-003-before.png'),
            windowTarget: { appName: 'File Manager' },
          },
        ],
        afterScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: traceFixtureRef(options.runRef, 'step-003-after.png'),
            windowTarget: { appName: 'File Manager' },
          },
        ],
        plannedAction: { type: 'click', targetDescription: 'save button' },
      },
    ],
  };
}

function traceFixtureRef(runRef: string, fileRef: string) {
  const prefix = runRef.replace(/\/+$/, '');
  return prefix ? `${prefix}/${fileRef}` : fileRef;
}

function validAdapter(runId: string) {
  return {
    schemaVersion: 'sciforge.computer-use.independent-input-adapter.v1',
    adapter: 'remote-desktop',
    provider: 'sciforge-simulated-remote-desktop',
    runId,
    userDeviceImpact: 'none',
    systemMouseEvents: 'not-sent',
    systemKeyboardEvents: 'not-sent',
    pointerKeyboardOwnership: 'sciforge-independent-input-adapter',
    targetSession: {
      mode: 'window',
      appName: 'Remote Session',
      coordinateSpace: 'window-local',
    },
    virtualPointer: {
      mode: 'virtual-pointer',
      coordinateSpace: 'window-local',
      x: 100,
      y: 80,
    },
    virtualKeyboard: {
      mode: 'virtual-keyboard',
      pressedKeys: [],
      keyEvents: [],
      typedTextLedger: [{ text: 'Visible source facts' }],
    },
    actions: [
      {
        id: 'step-001-click',
        type: 'click',
        systemMouseEvents: 'not-sent',
        systemKeyboardEvents: 'not-sent',
      },
      {
        id: 'step-002-type',
        type: 'type_text',
        systemMouseEvents: 'not-sent',
        systemKeyboardEvents: 'not-sent',
      },
    ],
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:01:00.000Z',
  };
}

function isolatedL3CompletionEvidence(taskFinalArtifactRefs: string[] = []): Record<string, unknown> {
  const sessionManifestRef = 'evidence/l3/isolated-l3-session/session-manifest.json';
  const currentTaskFinalArtifactRef = taskFinalArtifactRefs[0];
  const sourceFirstScreenshotRef = 'evidence/l3/isolated-l3-session/screenshots/source-editor.png';
  const sourceLastScreenshotRef = 'evidence/l3/isolated-l3-session/screenshots/source-editor-final.png';
  const writerFirstScreenshotRef = 'evidence/l3/isolated-l3-session/screenshots/writer-editor.png';
  const writerLastScreenshotRef = 'evidence/l3/isolated-l3-session/screenshots/writer-saved.png';
  const previewFirstScreenshotRef = 'evidence/l3/isolated-l3-session/screenshots/file-preview-open.png';
  const previewLastScreenshotRef = 'evidence/l3/isolated-l3-session/screenshots/file-preview.png';
  const sourceFactRefs = [
    'evidence/l3/source-facts/recovery.json',
    'evidence/l3/source-facts/cohorts.json',
  ];
  return {
    schemaVersion: 'sciforge.computer-use.isolated-desktop-l3-workflow-evidence.v1',
    evidenceKind: 'isolated-L3',
    status: 'completed',
    acceptanceTier: 'l3-multi-app-workflow',
    targetEnvironmentKind: 'linux-isolated-desktop-session',
    realWindowEvidence: true,
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    errors: [],
    resultRef: 'evidence/l3/computer-use-result.json',
    inputEventLogRef: 'evidence/l3/isolated-l3-session/l3-input-events.json',
    pointerEventLogRef: 'evidence/l3/isolated-l3-session/l3-pointer-events.json',
    keyboardEventLogRef: 'evidence/l3/isolated-l3-session/l3-keyboard-events.json',
    executorCommandEventLogRef: 'evidence/l3/isolated-l3-session/l3-executor-command-events.json',
    backendReadinessProofRef: 'evidence/l3/isolated-l3-session/backend-readiness-proof.json',
    processRef: 'evidence/l3/isolated-l3-session/backend-processes.json',
    resourceAllocationRef: 'evidence/l3/isolated-runtime-resource-allocation.json',
    targetWindowRef: 'evidence/l3/isolated-l3-session/l3-target-window.json',
    windowBoundPointerProofRef: 'evidence/l3/isolated-l3-session/l3-window-bound-pointer-proof.json',
    sessionManifestRef,
    taskFinalArtifactRefs: [
      'index.md',
      'report.md',
      'dense-grounding-export.csv',
      ...taskFinalArtifactRefs,
    ],
    taskArtifactBinding: {
      finalArtifactRef: currentTaskFinalArtifactRef,
      finalArtifactRefs: [
        'index.md',
        'report.md',
        'dense-grounding-export.csv',
        ...taskFinalArtifactRefs,
      ],
      source: 'test-fixture-task-final-artifact-binding',
    },
    finalArtifactRef: 'evidence/l3/isolated-l3-session/filesystem-root/out/source-summary.docx',
    artifactValidationRef: 'evidence/l3/isolated-l3-session/filesystem-root/out/source-summary.docx.validation.json',
    fileListArtifactRef: 'evidence/l3/isolated-l3-session/filesystem-root/out/file-list.json',
    fileListDataRef: 'evidence/l3/isolated-l3-session/filesystem-root/out/file-list-data.json',
    guiPresentRef: 'evidence/l3/gui-present.json',
    viewerManifestRef: 'evidence/l3/visible-run-viewer-manifest.json',
    evidenceLogRef: 'evidence/l3/evidence/evidence-log.jsonl',
    evidenceSnapshotRef: 'evidence/l3/evidence/evidence-snapshot.json',
    evidenceIndexRef: 'evidence/l3/evidence/evidence-index.json',
    screenshotRefs: [
      sourceFirstScreenshotRef,
      writerLastScreenshotRef,
      previewLastScreenshotRef,
    ],
    traceRefs: ['evidence/l3/vision-trace.json'],
    l3Workflow: {
      status: 'completed',
      completed: true,
      sameSession: true,
      sameVirtualSession: true,
      sourceToWriterToPreviewCausality: true,
    },
    workflowRequirements: {
      minimumAppCount: 3,
      minimumActionCount: 6,
      requiredInputModalities: ['pointer', 'keyboard'],
      requiresCurrentStepScreenshots: true,
      forbidPriorRoundCompletionEvidence: true,
      requiresDirectoryEvidence: true,
      requiresArtifactPreview: true,
      requiresWindowBoundPointerProof: true,
    },
    applicationEvidence: [
      {
        appKind: 'source-reader',
        sessionManifestRef,
        firstScreenshotRef: sourceFirstScreenshotRef,
        lastScreenshotRef: sourceLastScreenshotRef,
        windowEvidenceRefs: [sourceFirstScreenshotRef, sourceLastScreenshotRef],
      },
      {
        appKind: 'word-document-writer',
        sessionManifestRef,
        firstScreenshotRef: writerFirstScreenshotRef,
        lastScreenshotRef: writerLastScreenshotRef,
        windowEvidenceRefs: [writerFirstScreenshotRef, writerLastScreenshotRef],
      },
      {
        appKind: 'file-manager-preview',
        sessionManifestRef,
        firstScreenshotRef: previewFirstScreenshotRef,
        lastScreenshotRef: previewLastScreenshotRef,
        windowEvidenceRefs: [previewFirstScreenshotRef, previewLastScreenshotRef],
      },
    ],
    crossAppTransitions: [
      {
        fromAppKind: 'source-reader',
        toAppKind: 'word-document-writer',
        sessionManifestRef,
        screenshotRef: writerFirstScreenshotRef,
      },
      {
        fromAppKind: 'word-document-writer',
        toAppKind: 'file-manager-preview',
        sessionManifestRef,
        screenshotRef: previewFirstScreenshotRef,
      },
    ],
    sourceEvidence: {
      sourceObservationRefs: [sourceLastScreenshotRef],
      sourceFactRefs,
    },
    derivedContentEvidence: {
      supportedFactRefs: sourceFactRefs,
    },
    artifactCausality: {
      savedByActionIndex: 3,
      savedByInputModality: 'keyboard',
      savedByCommandEventRef: 'evidence/l3/isolated-l3-session/l3-executor-command-events.json#events/l3-command-003',
      finalArtifactRef: 'evidence/l3/isolated-l3-session/filesystem-root/out/source-summary.docx',
      artifactValidationRef: 'evidence/l3/isolated-l3-session/filesystem-root/out/source-summary.docx.validation.json',
      savedThroughGui: true,
      shellDirectArtifactWrite: false,
    },
    directoryEvidence: {
      fileListArtifactRef: 'evidence/l3/isolated-l3-session/filesystem-root/out/file-list.json',
      fileListDataRef: 'evidence/l3/isolated-l3-session/filesystem-root/out/file-list-data.json',
      previewObservationRef: previewLastScreenshotRef,
      directoryObservationAfterSaveRef: previewFirstScreenshotRef,
      previewedByActionIndex: 5,
      previewedByInputModality: 'pointer',
      previewedThroughGui: true,
      shellDirectoryListingOnly: false,
    },
    presentationEvidence: {
      guiPresentRef: 'evidence/l3/gui-present.json',
    },
  };
}

function visibleMarkdownArtifact(artifactRef: string, sourceActionId: string): Record<string, unknown> {
  return {
    id: 'visible-markdown-index',
    title: 'Acceptance index',
    artifactRef,
    dataRef: artifactRef,
    path: artifactRef,
    mimeType: 'text/markdown',
    appId: 'Browser',
    delivery: 'virtual-remote-session-artifact',
    status: 'visible-and-saved',
    visibleTexts: ['Acceptance index', 'Visible final markdown artifact'],
    sourceActionIds: [sourceActionId],
  };
}
