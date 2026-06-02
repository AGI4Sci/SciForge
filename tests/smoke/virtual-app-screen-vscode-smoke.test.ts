import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  buildVirtualAppScreenVsCodeSmokeBundle,
  writeVirtualAppScreenVsCodeSmokeBundle,
} from '../../tools/computer-use-next/virtual-app-screen-vscode-smoke.js';

const execFileAsync = promisify(execFile);

test('VSCode VirtualAppScreen smoke defaults to fail-closed provider probe evidence', () => {
  const bundle = buildVirtualAppScreenVsCodeSmokeBundle({
    runId: 'vscode-provider-missing',
    platform: 'darwin',
    nodePackageAvailability: { 'node-mac-virtual-display': false },
  });

  assert.equal(bundle.schemaVersion, 'sciforge.computer-use.virtual-app-screen-vscode-smoke.v1');
  assert.equal(bundle.taskId, 'P0-CU-UA-VSCODE-MINIMAL-LOOP');
  assert.equal(bundle.editorProfile.profileId, 'vscode-editor-low-risk');
  assert.equal(bundle.editorProfile.appIdentity.appKind, 'vscode');
  assert.equal(bundle.editorProfile.workspaceTarget.mode, 'temp-workspace');
  assert.equal(bundle.editorProfile.workspaceTarget.writesOutsideWorkspace, false);
  assert.equal(bundle.editorProfile.windowPlacement.requireTargetWindowRef, true);
  assert.equal(bundle.editorProfile.inputIntentPolicy.nonDestructive, true);
  assert.ok(bundle.editorProfile.allowedActions.includes('type_text'));
  assert.ok(bundle.editorProfile.disallowedActions.includes('send-shared-system-input'));
  assert.equal(bundle.providerReady, false);
  assert.equal(bundle.executionEvidenceComplete, false);
  assert.equal(bundle.userAcceptanceEvidenceComplete, false);
  assert.equal(bundle.screenPayload.status, 'blocked');
  assert.equal(bundle.screenPayload.attachState, 'adapter-unavailable');
  assert.equal(bundle.screenPayload.currentFrameRef, undefined);
  assert.ok(['blocked', 'requires-handoff'].includes(bundle.manifest.status));
  assert.equal(bundle.manifest.diagnosticOnly, true);
  assert.equal(bundle.manifest.userAcceptanceEligible, false);
  assert.match(String(bundle.blockedReason), /not installed|No isolated VirtualDisplayProvider/);
  assert.ok(bundle.providerProbeBundle.probes.some((probe) => probe.description.providerId === 'virtual-display.macos.cgvirtualdisplay-screencapturekit'));
});

test('VSCode VirtualAppScreen smoke ignores web app-surface availability and requires local native readiness', () => {
  const bundle = buildVirtualAppScreenVsCodeSmokeBundle({
    runId: 'vscode-serve-web-ignored',
    platform: 'darwin',
    commandAvailability: {
      'code-server': true,
      'openvscode-server': false,
      'vscode-cli-serve-web': false,
    },
    nodePackageAvailability: { 'node-mac-virtual-display': false },
  });

  assert.equal(bundle.providerReady, false);
  assert.equal(bundle.executionEvidenceComplete, false);
  assert.equal(bundle.providerProbeBundle.selectedProviderId, 'virtual-display.macos.cgvirtualdisplay-screencapturekit');
  assert.equal(bundle.screenPayload.attachState, 'adapter-unavailable');
  assert.equal(bundle.screenPayload.liveSurfaceRef, undefined);
  assert.ok(['blocked', 'requires-handoff'].includes(bundle.manifest.status));
  assert.equal(bundle.manifest.userAcceptanceEligible, false);
  assert.match(String(bundle.blockedReason), /not installed/);
});

test('VSCode VirtualAppScreen smoke requires execution evidence even when local native provider is ready', () => {
  const bundle = buildVirtualAppScreenVsCodeSmokeBundle({
    runId: 'vscode-provider-ready-probe-only',
    platform: 'darwin',
    nodePackageAvailability: { 'node-mac-virtual-display': true },
    permissionGrants: {
      'permission:macos/screen-recording': true,
      'permission:macos/accessibility': true,
    },
  });

  assert.equal(bundle.providerReady, true);
  assert.equal(bundle.executionEvidenceComplete, false);
  assert.equal(bundle.providerProbeBundle.selectedProviderId, 'virtual-display.macos.cgvirtualdisplay-screencapturekit');
  assert.equal(bundle.screenPayload.attachState, 'attached');
  assert.equal(bundle.screenPayload.liveSurfaceRef, '.sciforge/vision-runs/vscode-provider-ready-probe-only/virtual-display-provider/live-surface.json');
  assert.equal(bundle.screenPayload.surfaceTransport, 'webrtc');
  assert.equal(bundle.manifest.status, 'blocked');
  assert.equal(bundle.manifest.userAcceptanceEligible, false);
  assert.match(String(bundle.blockedReason), /probe-only/);
});

test('VSCode VirtualAppScreen smoke represents closed-loop evidence without user-acceptance overclaim', () => {
  const bundle = buildVirtualAppScreenVsCodeSmokeBundle({
    runId: 'vscode-provider-executed',
    platform: 'darwin',
    nodePackageAvailability: { 'node-mac-virtual-display': true },
    permissionGrants: {
      'permission:macos/screen-recording': true,
      'permission:macos/accessibility': true,
    },
    executionMode: 'provider-executed',
    executionEvidence: {
      sessionCreated: true,
      vscodeLaunched: true,
      liveFrameAttached: true,
      pointerInputExecuted: true,
      keyboardInputExecuted: true,
      beforeAfterVerified: true,
      guiPresented: true,
    },
  });

  assert.equal(bundle.providerReady, true);
  assert.equal(bundle.executionEvidenceComplete, true);
  assert.equal(bundle.userAcceptanceEvidenceComplete, false);
  assert.equal(bundle.screenPayload.status, 'ready');
  assert.equal(bundle.screenPayload.attachState, 'attached');
  assert.equal(bundle.screenPayload.sessionRef, 'computer-use:session/vscode-provider-executed/virtual-display-session.json');
  assert.equal(bundle.screenPayload.targetWindowRef, 'window:vscode-provider-executed/vscode/main');
  assert.equal(bundle.screenPayload.liveSurfaceRef, '.sciforge/vision-runs/vscode-provider-executed/virtual-display-provider/live-surface.json');
  assert.equal(bundle.screenPayload.currentFrameRef, '.sciforge/vision-runs/vscode-provider-executed/virtual-display-provider/frames/after.json');
  assert.equal(bundle.providerLifecycle.createSession.refs.sessionRef, bundle.screenPayload.sessionRef);
  assert.equal(bundle.providerLifecycle.launchApp.refs.targetWindowRef, bundle.screenPayload.targetWindowRef);
  assert.equal(bundle.providerLifecycle.attachSurface.refs.liveSurfaceRef, bundle.records.liveSurfaceRef);
  assert.equal(bundle.providerLifecycle.readFrame.refs.currentFrameRef, bundle.screenPayload.currentFrameRef);
  assert.deepEqual(bundle.providerLifecycle.sendInputIntent.refs.inputIntentRefs, [bundle.records.inputIntentRef]);
  assert.equal(bundle.providerLifecycle.createSession.providerExecuted, false);
  assert.equal(bundle.providerLifecycle.launchApp.providerExecuted, false);
  assert.equal(bundle.providerLifecycle.attachSurface.providerExecuted, false);
  assert.equal(bundle.providerLifecycle.readFrame.providerExecuted, false);
  assert.equal(bundle.providerLifecycle.sendInputIntent.providerExecuted, false);
  assert.equal(bundle.providerLifecycle.sendInputIntent.mutatingActionExecuted, true);
  assert.equal(bundle.manifest.status, 'blocked');
  assert.equal(bundle.manifest.userAcceptanceEligible, false);
  assert.equal(bundle.manifest.diagnosticOnly, true);
  assert.deepEqual(bundle.manifest.validation.missingRefs, []);
  assert.deepEqual(bundle.manifest.inputIntentRefs, [bundle.records.inputIntentRef]);
  assert.deepEqual(bundle.manifest.executorEventRefs, [bundle.records.executorEventRef]);
  assert.deepEqual(bundle.manifest.beforeAfterFrameRefs, [bundle.records.beforeAfterRef]);
  assert.deepEqual(bundle.manifest.guiPresentRefs, [bundle.records.guiPresentRef]);
  const primaryEvidenceClaim = bundle.manifest.evidenceClaims[0];
  if (!primaryEvidenceClaim) assert.fail('expected primary evidence claim');
  assert.ok(Array.isArray(primaryEvidenceClaim.evidenceRefs));
  const primaryEvidenceRefs = primaryEvidenceClaim.evidenceRefs;
  assert.ok(primaryEvidenceRefs.includes(bundle.records.providerLifecycleRef));
  assert.ok(primaryEvidenceRefs.includes(bundle.records.createSessionRef));
  assert.ok(primaryEvidenceRefs.includes(bundle.records.sendInputIntentRef));
  assert.match(String(bundle.blockedReason), /user acceptance is disabled/);
  assert.ok(bundle.manifest.evidenceClaims.some((claim) => (
    claim.kind === 'real-virtual-app-screen'
    && claim.status === 'diagnostic-only'
    && claim.userAcceptanceEligible === false
  )));
  assert.equal(bundle.manifest.metadata?.editorProfileRef, bundle.records.editorProfileRef);
});

test('VSCode VirtualAppScreen smoke writer materializes blocked refs by default', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vas-vscode-smoke-'));
  try {
    const bundle = await writeVirtualAppScreenVsCodeSmokeBundle(workspace, {
      runId: 'writer-blocked-vscode',
      platform: 'darwin',
      nodePackageAvailability: { 'node-mac-virtual-display': false },
    });
    const manifest = JSON.parse(await readFile(join(workspace, 'virtual-app-screen-user-acceptance-manifest.json'), 'utf8')) as Record<string, unknown>;
    const diagnostic = JSON.parse(await readFile(join(workspace, 'virtual-display-provider/blocked.json'), 'utf8')) as Record<string, unknown>;

    assert.equal(manifest.userAcceptanceEligible, false);
    assert.equal(manifest.diagnosticOnly, true);
    assert.equal(diagnostic.providerReady, false);
    assert.equal(diagnostic.executionEvidenceComplete, false);
    assert.ok(['blocked', 'requires-handoff'].includes(bundle.manifest.status));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('VSCode VirtualAppScreen smoke execute path writes provider execution evidence without fallback', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vas-vscode-smoke-execute-'));
  try {
    const bundle = await writeVirtualAppScreenVsCodeSmokeBundle(workspace, {
      runId: 'writer-execute-vscode',
      platform: 'darwin',
      executionMode: 'provider-executed',
      nodePackageAvailability: { 'node-mac-virtual-display': false },
    });
    const manifest = JSON.parse(await readFile(join(workspace, 'virtual-app-screen-user-acceptance-manifest.json'), 'utf8')) as Record<string, unknown>;
    const diagnostic = JSON.parse(await readFile(join(workspace, 'virtual-display-provider/blocked.json'), 'utf8')) as Record<string, unknown>;
    const execution = JSON.parse(await readFile(join(workspace, 'virtual-display-provider/provider-execution.json'), 'utf8')) as Record<string, unknown>;

    assert.equal(bundle.executionMode, 'provider-executed');
    assert.equal(bundle.executionEvidenceComplete, false);
    assert.equal(manifest.userAcceptanceEligible, false);
    assert.equal(manifest.diagnosticOnly, true);
    assert.equal(diagnostic.providerExecutionRef, '.sciforge/vision-runs/writer-execute-vscode/virtual-display-provider/provider-execution.json');
    assert.equal(execution.schemaVersion, 'sciforge.computer-use.macos-native-vscode-virtual-display-execution.v1');
    assert.equal(execution.status, 'blocked');
    assert.match(String(execution.blockedReason), /node-mac-virtual-display/);
    assert.doesNotMatch(JSON.stringify(execution), /serve-web|code-server|openvscode|noVNC|Xvfb|QEMU|VNC/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('VSCode VirtualAppScreen smoke writer materializes completed current-run refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vas-vscode-smoke-complete-'));
  try {
    const bundle = await writeVirtualAppScreenVsCodeSmokeBundle(workspace, {
      runId: 'writer-completed-vscode',
      platform: 'darwin',
      executionMode: 'provider-executed',
      nodePackageAvailability: { 'node-mac-virtual-display': true },
      permissionGrants: {
        'permission:macos/screen-recording': true,
        'permission:macos/accessibility': true,
      },
      executionEvidence: {
        sessionCreated: true,
        vscodeLaunched: true,
        liveFrameAttached: true,
        pointerInputExecuted: true,
        keyboardInputExecuted: true,
        beforeAfterVerified: true,
        guiPresented: true,
      },
    });
    const manifest = JSON.parse(await readFile(join(workspace, 'virtual-app-screen-user-acceptance-manifest.json'), 'utf8')) as Record<string, unknown>;
    const editorProfile = JSON.parse(await readFile(join(workspace, 'app-profiles/vscode-editor-low-risk.json'), 'utf8')) as Record<string, unknown>;
    const inputIntent = JSON.parse(await readFile(join(workspace, 'virtual-display-provider/input-intents/click-and-type.json'), 'utf8')) as Record<string, unknown>;
    const executorEvent = JSON.parse(await readFile(join(workspace, 'virtual-display-provider/executor-events/click-and-type.json'), 'utf8')) as Record<string, unknown>;
    const liveSurface = JSON.parse(await readFile(join(workspace, 'virtual-display-provider/live-surface.json'), 'utf8')) as Record<string, unknown>;
    const providerLifecycle = JSON.parse(await readFile(join(workspace, 'virtual-display-provider/provider-lifecycle.json'), 'utf8')) as Record<string, unknown>;
    const createSession = JSON.parse(await readFile(join(workspace, 'virtual-display-provider/lifecycle/create-session.json'), 'utf8')) as Record<string, unknown>;
    const sendInputIntent = JSON.parse(await readFile(join(workspace, 'virtual-display-provider/lifecycle/send-input-intent.json'), 'utf8')) as Record<string, unknown>;
    const replay = JSON.parse(await readFile(join(workspace, 'virtual-display-provider/replay.json'), 'utf8')) as Record<string, unknown>;
    const evidenceLedger = JSON.parse(await readFile(join(workspace, 'virtual-display-provider/evidence-ledger.json'), 'utf8')) as Record<string, unknown>;

    assert.equal(bundle.executionEvidenceComplete, true);
    assert.equal(bundle.userAcceptanceEvidenceComplete, false);
    assert.equal(manifest.userAcceptanceEligible, false);
    assert.equal(manifest.diagnosticOnly, true);
    assert.equal(editorProfile.schemaVersion, 'sciforge.computer-use.virtual-app-screen-editor-profile.v1');
    assert.equal(editorProfile.profileId, 'vscode-editor-low-risk');
    assert.equal(inputIntent.schemaVersion, 'sciforge.computer-use.input-intent.v1');
    assert.equal(inputIntent.kind, 'focus-editor-temp-artifact-and-type');
    assert.equal(inputIntent.nonDestructive, true);
    assert.equal(inputIntent.beforeFrameRef, '.sciforge/vision-runs/writer-completed-vscode/virtual-display-provider/frames/before.json');
    assert.equal(inputIntent.afterFrameRef, '.sciforge/vision-runs/writer-completed-vscode/virtual-display-provider/frames/after.json');
    assert.equal(inputIntent.executorEventRef, bundle.records.executorEventRef);
    assert.equal(inputIntent.sendInputIntentRef, bundle.records.sendInputIntentRef);
    assert.deepEqual(inputIntent.beforeAfterFrameRefs, [bundle.records.beforeAfterRef]);
    assert.deepEqual(inputIntent.verificationRefs, [bundle.records.verificationRef]);
    assert.equal(executorEvent.status, 'completed');
    assert.equal(executorEvent.sharedSystemInputUsed, false);
    assert.equal(executorEvent.providerLifecycleRef, bundle.records.providerLifecycleRef);
    assert.equal(executorEvent.sendInputIntentRef, bundle.records.sendInputIntentRef);
    assert.equal(liveSurface.sessionRef, bundle.screenPayload.sessionRef);
    assert.equal(liveSurface.currentFrameRef, bundle.screenPayload.currentFrameRef);
    assert.equal(liveSurface.attachSurfaceRef, bundle.records.attachSurfaceRef);
    assert.equal(liveSurface.readFrameRef, bundle.records.readFrameRef);
    assert.equal(providerLifecycle.schemaVersion, 'sciforge.computer-use.virtual-app-screen-provider-lifecycle.v1');
    assert.equal(providerLifecycle.providerExecuted, false);
    assert.deepEqual(providerLifecycle.chain, [
      bundle.records.createSessionRef,
      bundle.records.launchAppRef,
      bundle.records.attachSurfaceRef,
      bundle.records.readFrameRef,
      bundle.records.sendInputIntentRef,
    ]);
    assert.equal(createSession.operation, 'createSession');
    assert.equal(createSession.providerExecuted, false);
    assert.equal(sendInputIntent.operation, 'sendInputIntent');
    assert.equal(sendInputIntent.status, 'ready');
    assert.equal(sendInputIntent.providerExecuted, false);
    assert.equal(sendInputIntent.mutatingActionExecuted, true);
    assert.equal(replay.schemaVersion, 'sciforge.computer-use.virtual-app-screen-replay.v1');
    assert.ok(Array.isArray(evidenceLedger.refs));
    assert.ok((evidenceLedger.refs as string[]).includes(bundle.records.providerLifecycleRef));
    assert.ok((evidenceLedger.refs as string[]).includes(bundle.records.createSessionRef));
    assert.ok((evidenceLedger.refs as string[]).includes(bundle.records.inputIntentRef));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('VSCode VirtualAppScreen smoke CLI writes blocked output without claiming acceptance', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vas-vscode-smoke-cli-'));
  try {
    const { stdout } = await execFileAsync('node', [
      '--import',
      'tsx',
      'tools/computer-use-next/virtual-app-screen-vscode-smoke.ts',
      '--out-dir',
      workspace,
      '--run-id',
      'cli-vscode-smoke',
      '--platform',
      'darwin',
    ]);
    const manifest = JSON.parse(await readFile(join(workspace, 'virtual-app-screen-user-acceptance-manifest.json'), 'utf8')) as Record<string, unknown>;

    assert.match(stdout, /\[(blocked|requires-handoff)\] wrote sciforge\.computer-use\.virtual-app-screen-vscode-smoke\.v1/);
    assert.match(stdout, /userAcceptanceEligible=false/);
    assert.equal(manifest.userAcceptanceEligible, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
