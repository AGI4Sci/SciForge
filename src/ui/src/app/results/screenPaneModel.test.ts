import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeArtifact, SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import {
  rightPaneVirtualScreenPayload,
  virtualScreenPayloadFromArtifact,
} from './screenPaneModel';

test('screen pane model normalizes Computer Use artifacts into refs-first replay payloads', () => {
  const screenRef = 'computer-use:session/run-screen/virtual-screens.json#screen-1';
  const artifact: RuntimeArtifact = {
    id: 'computer-use-screen-run',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    metadata: { runId: 'run-screen' },
    data: {
      title: 'Live-looking legacy payload',
      status: 'ready',
      attachState: 'requires-user-handoff',
      surfaceMode: 'live',
      sessionRef: 'computer-use:session/run-screen/manifest.json',
      displayGroupRef: 'computer-use:session/run-screen/display-group.json',
      screenRef,
      screen: { width: 1440, height: 900, label: 'screen-1' },
      targetAppRef: 'app:vscode',
      targetWindowRef: 'window:vscode/main',
      frameStreamRef: 'computer-use:session/run-screen/frame-stream.json',
      visibleScreenRefs: [screenRef],
      visibleCursorRefs: ['computer-use:session/run-screen/cursors/agent.json'],
      frameRefs: [{
        ref: 'computer-use:session/run-screen/frames/after.png',
        screenRef,
        framePreviewUrl: 'data:image/png;base64,SHOULD_NOT_SURVIVE',
        safePreviewUrl: '/api/sciforge/preview/raw?ref=computer-use%3Asession%2Frun-screen%2Fframes%2Fafter.png',
        frameDataRef: 'computer-use:session/run-screen/frame-data/after.json',
        beforeEvidenceRef: 'computer-use:session/run-screen/evidence/before.json',
        afterEvidenceRef: 'computer-use:session/run-screen/evidence/after.json',
        cursorOverlayRefs: ['computer-use:session/run-screen/overlays/cursors.json'],
        leaseOwnerRefs: ['computer-use:session/run-screen/leases/screen-1.json'],
        proposalRef: 'computer-use:session/run-screen/proposals/click.json',
      }],
      replayRef: 'computer-use:session/run-screen/replay.json',
      validationRef: 'computer-use:session/run-screen/validation.json',
      evidenceBundleIndexRef: 'computer-use:session/run-screen/evidence/index.json',
      permissionRef: 'computer-use:permission/run-screen.json',
      sidecarBindingRef: 'computer-use:session/run-screen/sidecar/binding.json',
      sidecarCapabilitiesRef: 'computer-use:session/run-screen/sidecar/capabilities.json',
      sidecarDiscoveryRef: 'computer-use:session/run-screen/sidecar/discovery.json',
      rawScreenshot: 'data:image/png;base64,NOPE',
      providerRoute: 'https://provider.example.test/private',
      executorLease: { screenId: 'NOPE' },
    },
  };

  const payload = virtualScreenPayloadFromArtifact(artifact, testConfig());

  assert.ok(payload);
  assert.equal(payload.title, 'Live-looking legacy payload');
  assert.equal(payload.status, 'ready');
  assert.equal(payload.attachState, 'requires-handoff');
  assert.equal(payload.surfaceMode, 'replay');
  assert.equal(payload.displayGroupRef, 'computer-use:session/run-screen/display-group.json');
  assert.equal(payload.screenRef, screenRef);
  assert.deepEqual(payload.visibleScreenRefs, [screenRef]);
  assert.deepEqual(payload.screen, { width: 1440, height: 900, label: 'screen-1' });
  assert.equal(payload.targetAppRef, 'app:vscode');
  assert.equal(payload.targetWindowRef, 'window:vscode/main');
  assert.equal(payload.frameStreamRef, 'computer-use:session/run-screen/frame-stream.json');
  assert.equal(payload.currentFrameRef, 'computer-use:session/run-screen/frames/after.png');
  assert.equal(payload.frameRefs?.length, 1);
  assert.equal(payload.frameRefs?.[0]?.screenRef, screenRef);
  assert.equal(payload.frameRefs?.[0]?.framePreviewUrl, '/api/sciforge/preview/raw?ref=computer-use%3Asession%2Frun-screen%2Fframes%2Fafter.png');
  assert.deepEqual(payload.actorCursorRefs, ['computer-use:session/run-screen/cursors/agent.json']);
  assert.deepEqual(payload.annotationOverlayRefs, ['computer-use:session/run-screen/overlays/cursors.json']);
  assert.deepEqual(payload.annotationProposalRefs, ['computer-use:session/run-screen/proposals/click.json']);
  assert.equal(payload.inputLeaseRef, 'computer-use:session/run-screen/leases/screen-1.json');
  assert.equal(payload.actionAdapterRef, 'computer-use:session/run-screen/sidecar/binding.json');
  assert.equal(payload.adapterReadinessRef, 'computer-use:session/run-screen/sidecar/capabilities.json');
  assert.ok(payload.artifactRefs?.includes('computer-use:session/run-screen/display-group.json'));
  assert.ok(payload.verificationRefs?.includes('computer-use:session/run-screen/sidecar/discovery.json'));
  assert.ok(payload.verificationRefs?.includes('computer-use:permission/run-screen.json'));

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /rawScreenshot|providerRoute|executorLease|SHOULD_NOT_SURVIVE|data:image|base64|screenId/);
});

test('screen pane model uses the active run only and does not reuse stale session screen artifacts', () => {
  const oldArtifact: RuntimeArtifact = {
    id: 'old-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    metadata: { runId: 'run-old-screen' },
    data: {
      sessionRef: 'computer-use:session/run-old-screen/session.json',
      frameRefs: ['.sciforge/computer-use/run-old-screen/latest.png'],
      replayRef: 'computer-use:replay/run-old-screen/replay.json',
    },
  };
  const session = emptySession({ artifacts: [oldArtifact], runs: [run('run-old-screen'), run('run-current-no-screen')] });

  const payload = rightPaneVirtualScreenPayload(session, run('run-current-no-screen'), testConfig());

  assert.equal(payload.status, 'blocked');
  assert.equal(payload.attachState, 'blocked');
  assert.equal(payload.currentFrameRef, undefined);
  assert.equal(payload.replayRef, undefined);
  assert.equal(payload.sessionRef, undefined);
  assert.equal(payload.targetAppRef, 'app:profile/vscode-editor');
  assert.equal(payload.screenRef, 'virtual-app-screen:run-current-no-screen/screen-request');
  assert.equal(payload.adapterReadinessRef, 'computer-use:screen-activation/run-current-no-screen/provider-readiness.json');
  assert.equal(payload.blockedRef, 'computer-use:screen-activation/run-current-no-screen/blocked/no-native-session.json');
  assert.deepEqual(payload.guiPresentRefs, ['gui.present:run-current-no-screen/screen-pane-activation']);
  assert.equal(JSON.stringify(payload).includes('run-old-screen'), false);
});

test('screen pane model prefers newer live VirtualAppScreen evidence over older blocked artifacts', () => {
  const blockedArtifact: RuntimeArtifact = {
    id: 'blocked-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      status: 'blocked',
      attachState: 'blocked',
      surfaceMode: 'empty',
      screenRef: 'virtual-app-screen:blocked/screen-request',
      targetAppRef: 'app:profile/vscode-editor',
      adapterReadinessRef: 'computer-use:screen-activation/blocked/provider-readiness.json',
      blockedRef: 'computer-use:screen-activation/blocked/blocked/no-native-session.json',
      blockedReason: 'Old blocked projection.',
    },
  };
  const liveArtifact: RuntimeArtifact = {
    id: 'live-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: liveNativeHostScreenData('live-selected'),
  };
  const session = emptySession({ artifacts: [blockedArtifact, liveArtifact] });

  const payload = rightPaneVirtualScreenPayload(session, undefined, testConfig());

  assert.equal(payload.surfaceMode, 'live');
  assert.equal(payload.presentationState, 'live');
  assert.equal(payload.attachState, 'attached');
  assert.equal(payload.screenRef, 'virtual-app-screen:live-selected/screen-request');
  assert.equal(payload.currentFrameRef, 'computer-use:native-host/frames/live-selected/current.png');
  assert.equal(payload.blockedRef, undefined);
  assert.equal(payload.blockedReason, undefined);
});

test('screen pane model lets newer same-id run raw artifacts replace stale session artifacts', () => {
  const staleArtifact: RuntimeArtifact = {
    id: 'same-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      status: 'blocked',
      attachState: 'blocked',
      screenRef: 'virtual-app-screen:same-screen/stale',
      blockedRef: 'computer-use:screen-activation/same-screen/stale-blocked.json',
    },
  };
  const activeRun = run('run-same-screen', {
    raw: {
      payload: {
        artifacts: [{
          id: 'same-screen',
          type: 'computer-use-virtual-screen',
          data: liveNativeHostScreenData('same-screen-live'),
        }],
      },
    },
  } as Partial<SciForgeRun>);
  const session = emptySession({ artifacts: [staleArtifact], runs: [activeRun] });

  const payload = rightPaneVirtualScreenPayload(session, activeRun, testConfig());

  assert.equal(payload.surfaceMode, 'live');
  assert.equal(payload.screenRef, 'virtual-app-screen:same-screen-live/screen-request');
  assert.equal(payload.blockedRef, undefined);
});

test('screen pane model emits activation refs when Screen is opened without a current session', () => {
  const session = emptySession({ sessionId: 'session needs screen' });
  const scope = 'session-needs-screen/custom-screen-204-1';

  const payload = rightPaneVirtualScreenPayload(session, undefined, testConfig(), 'en-US', {
    activeTabId: 'custom:screen:204:1',
    bootstrapWindowMs: 12000,
  });

  assert.equal(payload.status, 'blocked');
  assert.equal(payload.attachState, 'blocked');
  assert.equal(payload.surfaceMode, 'empty');
  assert.equal(payload.presentationState, 'permission');
  assert.equal(payload.presentationStateReason, 'permission-gate');
  assert.deepEqual(payload.presentationStateReasonRefs, [
    `computer-use:screen-activation/${scope}/permissions/platform-gates.json`,
    `computer-use:screen-activation/${scope}/permission-handoff.json`,
    `computer-use:screen-activation/${scope}/permission-recheck.json`,
  ]);
  assert.equal(payload.targetAppRef, 'app:profile/vscode-editor');
  assert.equal(payload.screenRef, `virtual-app-screen:${scope}/screen-request`);
  assert.equal(payload.adapterReadinessRef, `computer-use:screen-activation/${scope}/provider-readiness.json`);
  assert.equal(payload.platformDriverRef, `computer-use:screen-activation/${scope}/platform-driver.json`);
  assert.equal(payload.platformDriverStatus, 'missing');
  assert.equal(payload.blockedRef, `computer-use:screen-activation/${scope}/blocked/no-native-session.json`);
  assert.equal(payload.handoffRef, `computer-use:screen-activation/${scope}/attach-request.json`);
  assert.equal(payload.permissionRef, `computer-use:screen-activation/${scope}/permissions/platform-gates.json`);
  assert.equal(payload.permissionStatus, 'missing');
  assert.equal(payload.permissionRequired, true);
  assert.equal(payload.permissionGranted, false);
  assert.equal(payload.permissionHandoffRef, `computer-use:screen-activation/${scope}/permission-handoff.json`);
  assert.deepEqual(payload.permissionHandoffRefs, [`computer-use:screen-activation/${scope}/permission-handoff.json`]);
  assert.equal(payload.permissionRecheckRef, `computer-use:screen-activation/${scope}/permission-recheck.json`);
  assert.equal(payload.recheckRef, `computer-use:screen-activation/${scope}/permission-recheck.json`);
  assert.deepEqual(payload.permissionRecheckRefs, [`computer-use:screen-activation/${scope}/permission-recheck.json`]);
  assert.doesNotMatch(JSON.stringify(payload), /macos|linux|windows|xpra|idd/i);
  assert.equal(payload.evidenceLedgerRef, `ledger:computer-use/${scope}/screen-activation.json`);
  assert.deepEqual(payload.guiPresentRefs, [`gui.present:${scope}/screen-pane-activation`]);
  assert.match(payload.blockedReason ?? '', /12000ms bootstrap window/);
  assert.deepEqual(payload.events?.[0], {
    label: 'screen-activation-policy',
    ref: `computer-use:screen-activation/${scope}/attach-request.json`,
    status: 'new-screen-window',
  });
  assert.ok(payload.events?.some((event) => event.label === 'provider-readiness' && event.ref === `computer-use:screen-activation/${scope}/provider-readiness.json`));
  assert.ok(payload.events?.some((event) => event.label === 'permission-handoff' && event.ref === `computer-use:screen-activation/${scope}/permission-handoff.json`));
  assert.ok(payload.events?.some((event) => event.label === 'permission-recheck' && event.ref === `computer-use:screen-activation/${scope}/permission-recheck.json`));
  assert.equal(payload.isolationFlags?.diagnosticOnly, true);
  assert.equal(payload.isolationFlags?.affectsPhysicalDisplay, false);
  assert.doesNotMatch(JSON.stringify(payload), /noVNC|desktop fallback|shell fallback|desktopBridge/i);
});

test('screen pane model emits one canonical presentation state for conflicting blocked permission and replay evidence', () => {
  const payload = virtualScreenPayloadFromArtifact({
    id: 'conflicting-screen-state',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      status: 'blocked',
      attachState: 'blocked',
      surfaceMode: 'live',
      sessionRef: 'computer-use:native-host/sessions/conflict/session.json',
      liveSurfaceRef: 'computer-use:native-host/surfaces/conflict/live-surface.json',
      frameStreamRef: 'computer-use:native-host/surfaces/conflict/frame-stream.json',
      currentFrameRef: 'computer-use:native-host/frames/conflict/0001.png',
      replayRef: 'computer-use:native-host/replay/conflict/replay.json',
      blockedRef: 'computer-use:native-host/blocked/conflict.json',
      permissionRef: 'computer-use:native-host/permissions/conflict/platform-gates.json',
      permissionRequired: true,
      permissionGranted: false,
      permissionStatus: 'missing',
      permissionHandoffRef: 'computer-use:native-host/permissions/conflict/handoff.json',
      permissionRecheckRef: 'computer-use:native-host/permissions/conflict/recheck.json',
      frameRefs: [{
        ref: 'computer-use:native-host/frames/conflict/0001.png',
        screenRef: 'virtual-app-screen:conflict/screen',
      }],
    },
  }, testConfig());

  assert.ok(payload);
  assert.equal(payload.status, 'blocked');
  assert.equal(payload.surfaceMode, 'replay');
  assert.equal(payload.presentationState, 'permission');
  assert.equal(payload.presentationStateReason, 'permission-gate');
  assert.deepEqual(payload.presentationStateReasonRefs, [
    'computer-use:native-host/permissions/conflict/platform-gates.json',
    'computer-use:native-host/permissions/conflict/handoff.json',
    'computer-use:native-host/permissions/conflict/recheck.json',
  ]);
});

test('screen pane model does not share activation placeholders between custom screen tabs', () => {
  const session = emptySession({ sessionId: 'session needs screen' });
  const first = rightPaneVirtualScreenPayload(session, undefined, testConfig(), 'en-US', {
    activeTabId: 'custom:screen:204:1',
  });
  const second = rightPaneVirtualScreenPayload(session, undefined, testConfig(), 'en-US', {
    activeTabId: 'custom:screen:205:2',
  });

  assert.notEqual(first.screenRef, second.screenRef);
  assert.notEqual(first.handoffRef, second.handoffRef);
  assert.notEqual(first.adapterReadinessRef, second.adapterReadinessRef);
  assert.notEqual(first.blockedRef, second.blockedRef);
});

test('screen pane model represents platform permission handoffs with provider readiness and UI evidence refs', () => {
  const cases = [
    {
      id: 'macos-permissions',
      blockedReason: 'macOS Screen Recording, Accessibility, Automation, and virtual display helper are missing.',
      providerReadinessRef: 'computer-use:session/macos/readiness/provider.json',
      platformDriverRef: 'computer-use:session/macos/platform-driver/helper.json',
      permissionRef: 'computer-use:session/macos/permissions/platform.json',
      handoffs: [
        'computer-use:session/macos/handoff/screen-recording.json',
        'computer-use:session/macos/handoff/accessibility.json',
        'computer-use:session/macos/handoff/automation.json',
        'computer-use:session/macos/handoff/virtual-display-helper.json',
      ],
      rechecks: [
        'computer-use:session/macos/recheck/screen-recording.json',
        'computer-use:session/macos/recheck/accessibility.json',
        'computer-use:session/macos/recheck/automation.json',
        'computer-use:session/macos/recheck/virtual-display-helper.json',
      ],
    },
    {
      id: 'linux-xpra',
      blockedReason: 'Linux Xpra install and session permission are missing.',
      providerReadinessRef: 'computer-use:session/linux/readiness/provider.json',
      platformDriverRef: 'computer-use:session/linux/platform-driver/xpra.json',
      permissionRef: 'computer-use:session/linux/permissions/xpra-session.json',
      handoffs: [
        'computer-use:session/linux/handoff/xpra-install.json',
        'computer-use:session/linux/handoff/xpra-session-permission.json',
      ],
      rechecks: [
        'computer-use:session/linux/recheck/xpra-install.json',
        'computer-use:session/linux/recheck/xpra-session-permission.json',
      ],
    },
    {
      id: 'windows-idd',
      blockedReason: 'Windows IDD driver install is missing.',
      providerReadinessRef: 'computer-use:session/windows/readiness/provider.json',
      platformDriverRef: 'computer-use:session/windows/platform-driver/idd.json',
      permissionRef: 'computer-use:session/windows/permissions/idd-driver.json',
      handoffs: ['computer-use:session/windows/handoff/idd-driver-install.json'],
      rechecks: ['computer-use:session/windows/recheck/idd-driver-install.json'],
    },
  ];

  for (const testCase of cases) {
    const payload = virtualScreenPayloadFromArtifact({
      id: testCase.id,
      type: 'computer-use-virtual-screen',
      producerScenario: 'computer-use',
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      data: {
        status: 'requires-handoff',
        attachState: 'requires-handoff',
        targetAppRef: `app:${testCase.id}/native-app`,
        screenRef: `virtual-app-screen:${testCase.id}/screen`,
        blockedRef: `computer-use:session/${testCase.id}/blocked/permission.json`,
        blockedReason: testCase.blockedReason,
        providerReadinessRef: testCase.providerReadinessRef,
        platformDriverRef: testCase.platformDriverRef,
        platformDriverStatus: 'not-installed',
        permissionRef: testCase.permissionRef,
        permissionStatus: 'missing',
        permissionRequired: true,
        permissionGranted: false,
        permissionHandoffRefs: testCase.handoffs,
        permissionRecheckRefs: testCase.rechecks,
        evidenceLedgerRef: `ledger:computer-use/${testCase.id}/permission.json`,
        guiPresentRefs: [`gui.present:${testCase.id}/permission-handoff`],
      },
    }, testConfig());

    assert.equal(payload?.status, 'blocked');
    assert.equal(payload?.attachState, 'requires-handoff');
    assert.equal(payload?.surfaceMode, 'empty');
    assert.equal(payload?.adapterReadinessRef, testCase.providerReadinessRef);
    assert.equal(payload?.platformDriverRef, testCase.platformDriverRef);
    assert.equal(payload?.platformDriverStatus, 'not-installed');
    assert.equal(payload?.permissionRef, testCase.permissionRef);
    assert.equal(payload?.permissionStatus, 'missing');
    assert.equal(payload?.permissionRequired, true);
    assert.equal(payload?.permissionGranted, false);
    assert.deepEqual(payload?.permissionHandoffRefs, testCase.handoffs);
    assert.equal(payload?.permissionHandoffRef, testCase.handoffs[0]);
    assert.deepEqual(payload?.permissionRecheckRefs, testCase.rechecks);
    assert.equal(payload?.permissionRecheckRef, testCase.rechecks[0]);
    assert.equal(payload?.recheckRef, testCase.rechecks[0]);
    assert.ok(payload?.verificationRefs?.includes(testCase.providerReadinessRef));
    assert.ok(payload?.verificationRefs?.includes(testCase.rechecks[0]));
    assert.deepEqual(payload?.guiPresentRefs, [`gui.present:${testCase.id}/permission-handoff`]);
    assert.equal(payload?.blockedReason, testCase.blockedReason);
    assert.doesNotMatch(JSON.stringify(payload), /noVNC|desktop fallback|shell fallback|desktopBridge/i);
  }
});

test('screen pane model consumes blocked artifact refs without fabricating live bindings', () => {
  const activeRun = run('run-blocked-screen-refs', {
    raw: {
      data: {
        output: {
          artifacts: [{
            id: 'blocked-virtual-screen',
            type: 'computer-use-virtual-screen',
            producerScenario: 'computer-use',
            schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
            data: {
              status: 'blocked',
              attachState: 'blocked',
              surfaceMode: 'empty',
              targetAppRef: 'app:profile/vscode-editor',
              screenRef: 'virtual-app-screen:run-blocked-screen-refs/screen',
              adapterReadinessRef: 'computer-use:screen-activation/run-blocked-screen-refs/provider-readiness.json',
              platformDriverRef: 'computer-use:screen-activation/run-blocked-screen-refs/platform-driver.json',
              blockedRef: 'computer-use:screen-activation/run-blocked-screen-refs/blocked/no-native-session.json',
              handoffRef: 'computer-use:screen-activation/run-blocked-screen-refs/attach-request.json',
              permissionRef: 'computer-use:screen-activation/run-blocked-screen-refs/permissions/platform-gates.json',
              permissionRequired: true,
              permissionGranted: false,
              permissionHandoffRef: 'computer-use:screen-activation/run-blocked-screen-refs/permission-handoff.json',
              permissionHandoffRefs: [
                'computer-use:screen-activation/run-blocked-screen-refs/permission-handoff.json',
                'computer-use:screen-activation/run-blocked-screen-refs/permission-handoff/macos-screen-recording.json',
              ],
              permissionRecheckRef: 'computer-use:screen-activation/run-blocked-screen-refs/permission-recheck.json',
              evidenceLedgerRef: 'ledger:computer-use/run-blocked-screen-refs/screen-activation.json',
              guiPresentRefs: ['gui.present:run-blocked-screen-refs/screen-pane-activation'],
            },
          }],
        },
      },
    },
  });
  const session = emptySession({ runs: [activeRun] });

  const payload = rightPaneVirtualScreenPayload(session, activeRun, testConfig());

  assert.equal(payload.status, 'blocked');
  assert.equal(payload.attachState, 'blocked');
  assert.equal(payload.surfaceMode, 'empty');
  assert.equal(payload.screenRef, 'virtual-app-screen:run-blocked-screen-refs/screen');
  assert.equal(payload.adapterReadinessRef, 'computer-use:screen-activation/run-blocked-screen-refs/provider-readiness.json');
  assert.equal(payload.blockedRef, 'computer-use:screen-activation/run-blocked-screen-refs/blocked/no-native-session.json');
  assert.equal(payload.handoffRef, 'computer-use:screen-activation/run-blocked-screen-refs/attach-request.json');
  assert.equal(payload.permissionHandoffRef, 'computer-use:screen-activation/run-blocked-screen-refs/permission-handoff.json');
  assert.deepEqual(payload.permissionHandoffRefs, [
    'computer-use:screen-activation/run-blocked-screen-refs/permission-handoff.json',
    'computer-use:screen-activation/run-blocked-screen-refs/permission-handoff/macos-screen-recording.json',
  ]);
  assert.equal(payload.evidenceLedgerRef, 'ledger:computer-use/run-blocked-screen-refs/screen-activation.json');
  assert.deepEqual(payload.guiPresentRefs, ['gui.present:run-blocked-screen-refs/screen-pane-activation']);
  assert.equal(payload.sessionRef || undefined, undefined);
  assert.equal(payload.currentFrameRef || undefined, undefined);
  assert.equal(payload.liveSurfaceRef || undefined, undefined);
  assert.equal(payload.frameStreamRef || undefined, undefined);
});

test('screen pane model preserves Host-owned preflight refs without attached session', () => {
  const payload = virtualScreenPayloadFromArtifact({
    id: 'host-owned-preflight-only',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      status: 'blocked',
      attachState: 'blocked',
      surfaceMode: 'empty',
      targetAppRef: 'app:profile/vscode-editor',
      screenRef: 'virtual-app-screen:preflight-only/screen-request',
      blockedRef: 'computer-use:native-host/preflights/preflight-1/blocked.json',
      blockedReason: 'Native Host preflight recorded missing platform gates before attach.',
      nativeHostPreflight: {
        preflightRef: 'computer-use:native-host/preflights/preflight-1/preflight.json',
        preflightLedgerRef: 'computer-use:native-host/preflights/preflight-1/preflight-ledger.json',
        preflightLedgerEntryRef: 'computer-use:native-host/preflights/preflight-1/preflight-ledger.json/events/0001-preflight.recorded.json',
        hostReadinessRef: 'computer-use:native-host/preflights/preflight-1/host-readiness.json',
        adapterReadinessRef: 'computer-use:native-host/preflights/preflight-1/adapter-readiness.json',
        platformDriverRefs: ['computer-use:native-host/preflights/preflight-1/platform-driver.json'],
        permissionRefs: ['computer-use:native-host/preflights/preflight-1/permissions/platform-gates.json'],
        providerReadinessRefs: ['computer-use:native-host/preflights/preflight-1/provider-readiness.json'],
      },
    },
  }, testConfig());

  assert.ok(payload);
  assert.equal(payload.sessionRef || undefined, undefined);
  assert.equal(payload.liveSurfaceRef || undefined, undefined);
  assert.equal(payload.frameStreamRef || undefined, undefined);
  assert.equal(payload.currentFrameRef || undefined, undefined);
  assert.equal((payload as Record<string, unknown>).preflightRef, 'computer-use:native-host/preflights/preflight-1/preflight.json');
  assert.equal((payload as Record<string, unknown>).preflightLedgerRef, 'computer-use:native-host/preflights/preflight-1/preflight-ledger.json');
  assert.equal((payload as Record<string, unknown>).preflightLedgerEntryRef, 'computer-use:native-host/preflights/preflight-1/preflight-ledger.json/events/0001-preflight.recorded.json');
  assert.equal((payload as Record<string, unknown>).hostReadinessRef, 'computer-use:native-host/preflights/preflight-1/host-readiness.json');
  assert.equal(payload.adapterReadinessRef, 'computer-use:native-host/preflights/preflight-1/adapter-readiness.json');
  assert.equal(payload.platformDriverRef, 'computer-use:native-host/preflights/preflight-1/platform-driver.json');
  assert.equal(payload.permissionRef, 'computer-use:native-host/preflights/preflight-1/permissions/platform-gates.json');
  assert.deepEqual((payload as Record<string, unknown>).providerReadinessRefs, ['computer-use:native-host/preflights/preflight-1/provider-readiness.json']);
  assert.deepEqual((payload as Record<string, unknown>).nativeHostPreflight, {
    preflightRef: 'computer-use:native-host/preflights/preflight-1/preflight.json',
    preflightLedgerRef: 'computer-use:native-host/preflights/preflight-1/preflight-ledger.json',
    preflightLedgerEntryRef: 'computer-use:native-host/preflights/preflight-1/preflight-ledger.json/events/0001-preflight.recorded.json',
    hostReadinessRef: 'computer-use:native-host/preflights/preflight-1/host-readiness.json',
    adapterReadinessRef: 'computer-use:native-host/preflights/preflight-1/adapter-readiness.json',
    platformDriverRefs: ['computer-use:native-host/preflights/preflight-1/platform-driver.json'],
    permissionRefs: ['computer-use:native-host/preflights/preflight-1/permissions/platform-gates.json'],
    providerReadinessRefs: ['computer-use:native-host/preflights/preflight-1/provider-readiness.json'],
  });
  assert.ok(payload.artifactRefs?.includes('computer-use:native-host/preflights/preflight-1/preflight.json'));
  assert.ok(payload.artifactRefs?.includes('computer-use:native-host/preflights/preflight-1/preflight-ledger.json'));
  assert.ok(payload.verificationRefs?.includes('computer-use:native-host/preflights/preflight-1/preflight-ledger.json/events/0001-preflight.recorded.json'));
  assert.ok(payload.verificationRefs?.includes('computer-use:native-host/preflights/preflight-1/host-readiness.json'));
  assert.doesNotMatch(JSON.stringify(payload), /computer-use:screen-activation\/preflight-only\/preflight/);
});

test('screen pane model does not promote screen activation placeholders to Host preflight refs', () => {
  const payload = virtualScreenPayloadFromArtifact({
    id: 'placeholder-preflight-looking-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      status: 'blocked',
      attachState: 'blocked',
      surfaceMode: 'empty',
      targetAppRef: 'app:profile/vscode-editor',
      screenRef: 'virtual-app-screen:placeholder-preflight/screen-request',
      adapterReadinessRef: 'computer-use:screen-activation/placeholder-preflight/provider-readiness.json',
      nativeHostPreflight: {
        preflightRef: 'computer-use:screen-activation/placeholder-preflight/preflight.json',
        preflightLedgerRef: 'ledger:computer-use/placeholder-preflight/preflight.json',
        preflightLedgerEntryRef: 'computer-use:screen-activation/placeholder-preflight/preflight-ledger.json/events/0001-preflight.recorded.json',
        hostReadinessRef: 'computer-use:screen-activation/placeholder-preflight/host-readiness.json',
      },
      nativeHost: {
        preflight: {
          preflightRef: 'computer-use:native-host/readiness/placeholder-preflight/preflight.json',
          preflightLedgerRef: 'computer-use:native-host/readiness/placeholder-preflight/preflight-ledger.json',
          preflightLedgerEntryRef: 'computer-use:native-host/readiness/placeholder-preflight/preflight-ledger.json/events/0001-preflight.recorded.json',
          hostReadinessRef: 'computer-use:native-host/readiness/placeholder-preflight/host-readiness.json',
        },
      },
      preflightRef: 'computer-use:screen-activation/placeholder-preflight/preflight.json',
      preflightLedgerEntryRef: 'computer-use:screen-activation/placeholder-preflight/preflight-ledger.json/events/0001-preflight.recorded.json',
    },
  }, testConfig());

  assert.ok(payload);
  assert.equal((payload as Record<string, unknown>).preflightRef, undefined);
  assert.equal((payload as Record<string, unknown>).preflightLedgerRef, undefined);
  assert.equal((payload as Record<string, unknown>).preflightLedgerEntryRef, undefined);
  assert.equal((payload as Record<string, unknown>).hostReadinessRef, undefined);
  assert.equal((payload as Record<string, unknown>).nativeHostPreflight, undefined);
  assert.equal(payload.verificationRefs?.some((ref) => ref.includes('/placeholder-preflight/preflight')), false);
  assert.equal(payload.artifactRefs?.some((ref) => ref.includes('/placeholder-preflight/preflight')), false);
  assert.doesNotMatch(JSON.stringify(payload), /computer-use:native-host\/readiness\/placeholder-preflight/);
  assert.equal(payload.adapterReadinessRef, 'computer-use:screen-activation/placeholder-preflight/provider-readiness.json');
});

test('screen pane model extracts nested run artifacts and keeps static frames in replay mode', () => {
  const activeRun = run('run-nested-screen', {
    raw: {
      data: {
        output: {
          artifacts: [{
            id: 'nested-screen',
            type: 'computer-use-virtual-screen',
            data: {
              sessionRef: 'computer-use:session/run-nested-screen/session.json',
              frameRefs: ['.sciforge/computer-use/run-nested-screen/latest.png'],
              replayRef: 'computer-use:replay/run-nested-screen/replay.json',
              attachState: 'replay',
              isolationFlags: { diagnosticOnly: true, sharedSystemInputUsed: false },
            },
          }],
        },
      },
    },
  });
  const session = emptySession({ runs: [activeRun] });

  const payload = rightPaneVirtualScreenPayload(session, activeRun, testConfig());

  assert.equal(payload.status, 'ready');
  assert.equal(payload.attachState, 'replay');
  assert.equal(payload.surfaceMode, 'replay');
  assert.equal(payload.currentFrameRef, '.sciforge/computer-use/run-nested-screen/latest.png');
  assert.equal(payload.frameRefs?.[0]?.framePreviewUrl, '/api/sciforge/preview/raw?ref=.sciforge%2Fcomputer-use%2Frun-nested-screen%2Flatest.png&workspacePath=%2Ftmp%2Fsciforge');
  assert.equal(payload.replayRef, 'computer-use:replay/run-nested-screen/replay.json');
  assert.deepEqual(payload.isolationFlags, { diagnosticOnly: true, sharedSystemInputUsed: false });
});

test('screen pane model preserves host-owned live surface refs for attached screen artifacts', () => {
  const activeRun = run('run-live-vscode', {
    raw: {
      data: {
        output: {
          artifacts: [{
            id: 'live-vscode-screen',
            type: 'computer-use-virtual-screen',
            data: {
              title: 'VSCode live screen',
              status: 'ready',
              attachState: 'attached',
              surfaceMode: 'live',
              targetAppRef: 'app:run-live-vscode/vscode',
              targetWindowRef: 'window:run-live-vscode/vscode/main',
              sessionRef: 'computer-use:native-host/sessions/session-run-live-vscode/session.json',
              hostSessionRef: 'computer-use:native-host/sessions/session-run-live-vscode/session.json',
              screenRef: 'virtual-app-screen:run-live-vscode/screen',
              liveSurfaceRef: 'computer-use:native-host/surfaces/run-live-vscode/live-surface.json',
              surfaceTransport: 'webrtc',
              surfaceTransportRef: 'computer-use:native-host/surfaces/run-live-vscode/surface-transport.json',
              surfaceTransportDescriptor: {
                owner: 'VirtualDisplayProvider',
                providerId: 'provider:run-live-vscode',
                transport: 'webrtc',
                surfaceTransportRef: 'computer-use:native-host/surfaces/run-live-vscode/surface-transport.json',
                liveSurfaceRef: 'computer-use:native-host/surfaces/run-live-vscode/live-surface.json',
                frameStreamRef: 'computer-use:native-host/surfaces/run-live-vscode/frame-stream.json',
                currentFrameRef: 'computer-use:native-host/frames/run-live-vscode/0031.png',
                currentFrameSequence: 31,
                diagnosticOnly: false,
                productFallback: false,
                singleInteractiveTruth: true,
              },
              frameStreamRef: 'computer-use:native-host/surfaces/run-live-vscode/frame-stream.json',
              surfaceOwnerRef: 'computer-use:native-host/surfaces/run-live-vscode/surface-owner.json',
              displayOwnerRef: 'computer-use:native-host/surfaces/run-live-vscode/display-owner.json',
              providerSessionOwnerRef: 'computer-use:native-host/provider-sessions/run-live-vscode/owner.json',
              providerSessionReconnectRef: 'computer-use:native-host/reconnect/run-live-vscode/reconnect.json',
              liveBindingAttachGrantRef: 'computer-use:native-host/grants/run-live-vscode/live-binding-attach-grant.json',
              liveBindingAttachGrantStatus: 'validated',
              grantValidationRef: 'computer-use:native-host/ledgers/session-run-live-vscode/evidence-ledger.json/events/0031-grant.validated.json',
              grantValidationStatus: 'validated',
              platformDriverRef: 'computer-use:native-host/platform-drivers/run-live-vscode/platform-driver.json',
              platformDriverStatus: 'ready',
              permissionStatus: 'granted',
              permissionGranted: true,
              evidenceLedgerRef: 'computer-use:native-host/ledgers/session-run-live-vscode/evidence-ledger.json',
              providerExecuted: true,
              currentFrameSequence: {
                ref: 'computer-use:native-host/surfaces/run-live-vscode/frame-sequence.json',
                status: 'running',
                sequence: 31,
              },
              currentFrameRef: 'computer-use:native-host/frames/run-live-vscode/0031.png',
              isolationFlags: {
                backgroundRenderable: true,
                affectsPhysicalDisplay: false,
                requiresFocusSteal: false,
                sharedSystemInputUsed: false,
                systemPointerMoved: false,
                systemKeyboardEventsSent: false,
                singleInteractiveTruth: true,
                secondInteractiveSurfacePresent: false,
                diagnosticOnly: false,
              },
            },
          }],
        },
      },
    },
  });
  const session = emptySession({ runs: [activeRun] });

  const payload = rightPaneVirtualScreenPayload(session, activeRun, testConfig());

  assert.equal(payload.status, 'ready');
  assert.equal(payload.attachState, 'attached');
  assert.equal(payload.surfaceMode, 'live');
  assert.equal(payload.sessionRef, 'computer-use:native-host/sessions/session-run-live-vscode/session.json');
  assert.equal(payload.hostSessionRef, 'computer-use:native-host/sessions/session-run-live-vscode/session.json');
  assert.equal(payload.liveSurfaceRef, 'computer-use:native-host/surfaces/run-live-vscode/live-surface.json');
  assert.equal(payload.surfaceTransport, 'webrtc');
  assert.equal(payload.surfaceTransportRef, 'computer-use:native-host/surfaces/run-live-vscode/surface-transport.json');
  assert.equal(payload.frameStreamRef, 'computer-use:native-host/surfaces/run-live-vscode/frame-stream.json');
  assert.equal(payload.surfaceOwnerRef, 'computer-use:native-host/surfaces/run-live-vscode/surface-owner.json');
  assert.equal(payload.displayOwnerRef, 'computer-use:native-host/surfaces/run-live-vscode/display-owner.json');
  assert.equal(payload.providerSessionOwnerRef, 'computer-use:native-host/provider-sessions/run-live-vscode/owner.json');
  assert.equal(payload.providerSessionReconnectRef, 'computer-use:native-host/reconnect/run-live-vscode/reconnect.json');
  assert.equal(payload.liveBindingAttachGrantRef, 'computer-use:native-host/grants/run-live-vscode/live-binding-attach-grant.json');
  assert.equal(payload.grantValidationRef, 'computer-use:native-host/ledgers/session-run-live-vscode/evidence-ledger.json/events/0031-grant.validated.json');
  assert.equal(payload.evidenceLedgerRef, 'computer-use:native-host/ledgers/session-run-live-vscode/evidence-ledger.json');
  assert.deepEqual(payload.currentFrameSequence, {
    ref: 'computer-use:native-host/surfaces/run-live-vscode/frame-sequence.json',
    label: undefined,
    status: 'running',
    transport: undefined,
    diagnosticOnly: undefined,
    sequence: 31,
  });
  assert.deepEqual(payload.isolationFlags, {
    backgroundRenderable: true,
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    singleInteractiveTruth: true,
    secondInteractiveSurfacePresent: false,
    diagnosticOnly: false,
  });
});

test('screen pane model treats stream-quality fallbackRequired as provider fallback evidence', () => {
  const liveNativeHostData = (scope: string, fallbackRequired: boolean) => ({
    status: 'ready',
    attachState: 'attached',
    surfaceMode: 'live',
    targetAppRef: `app:${scope}/vscode`,
    targetWindowRef: `window:${scope}/vscode/main`,
    sessionRef: `computer-use:native-host/sessions/session-${scope}/session.json`,
    hostSessionRef: `computer-use:native-host/sessions/session-${scope}/session.json`,
    screenRef: `virtual-app-screen:${scope}/screen`,
    liveSurfaceRef: `computer-use:native-host/surfaces/${scope}/live-surface.json`,
    surfaceTransport: 'webrtc',
    surfaceTransportRef: `computer-use:native-host/surfaces/${scope}/surface-transport.json`,
    surfaceTransportDescriptor: {
      owner: 'VirtualDisplayProvider',
      providerId: `provider:${scope}`,
      transport: 'webrtc',
      surfaceTransportRef: `computer-use:native-host/surfaces/${scope}/surface-transport.json`,
      liveSurfaceRef: `computer-use:native-host/surfaces/${scope}/live-surface.json`,
      frameStreamRef: `computer-use:native-host/surfaces/${scope}/frame-stream.json`,
      currentFrameRef: `computer-use:native-host/frames/${scope}/0042.png`,
      frameTransportContractRef: `computer-use:native-host/surfaces/${scope}/frame-transport-contract.json`,
      frameTelemetryRef: `computer-use:native-host/surfaces/${scope}/frame-telemetry.json`,
      currentFrameSequence: 42,
      diagnosticOnly: false,
      productFallback: false,
      singleInteractiveTruth: true,
    },
    frameStreamRef: `computer-use:native-host/surfaces/${scope}/frame-stream.json`,
    surfaceOwnerRef: `computer-use:native-host/surfaces/${scope}/surface-owner.json`,
    displayOwnerRef: `computer-use:native-host/surfaces/${scope}/display-owner.json`,
    providerSessionOwnerRef: `computer-use:native-host/provider-sessions/${scope}/owner.json`,
    providerSessionReconnectRef: `computer-use:native-host/reconnect/${scope}/reconnect.json`,
    liveBindingAttachGrantRef: `computer-use:native-host/grants/${scope}/live-binding-attach-grant.json`,
    liveBindingAttachGrantStatus: 'validated',
    grantValidationRef: `computer-use:native-host/ledgers/session-${scope}/evidence-ledger.json/events/0042-grant.validated.json`,
    grantValidationStatus: 'validated',
    platformDriverRef: `computer-use:native-host/platform-drivers/${scope}/platform-driver.json`,
    platformDriverStatus: 'ready',
    permissionStatus: 'granted',
    permissionGranted: true,
    evidenceLedgerRef: `computer-use:native-host/ledgers/session-${scope}/evidence-ledger.json`,
    providerExecuted: true,
    frameTransport: {
      ref: `computer-use:native-host/surfaces/${scope}/frame-transport-contract.json`,
      status: 'ready',
      transport: 'webrtc',
    },
    frameTelemetry: {
      ref: `computer-use:native-host/surfaces/${scope}/frame-telemetry.json`,
      status: fallbackRequired ? 'degraded' : 'ready',
      transport: 'webrtc',
      sequence: 42,
      fallbackRequired,
    },
    streamQuality: {
      ref: `computer-use:native-host/surfaces/${scope}/stream-quality.json`,
      status: fallbackRequired ? 'degraded' : 'ready',
      fallbackRequired,
      degradationRef: fallbackRequired ? `computer-use:native-host/surfaces/${scope}/stream-quality-degradation.json` : undefined,
    },
    currentFrameSequence: {
      ref: `computer-use:native-host/surfaces/${scope}/frame-sequence.json`,
      status: 'running',
      sequence: 42,
    },
    currentFrameRef: `computer-use:native-host/frames/${scope}/0042.png`,
    isolationFlags: {
      backgroundRenderable: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      singleInteractiveTruth: true,
      secondInteractiveSurfacePresent: false,
      diagnosticOnly: false,
    },
  });
  const degraded = virtualScreenPayloadFromArtifact({
    id: 'stream-quality-degraded-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: liveNativeHostData('stream-quality-degraded', true),
  }, testConfig());
  const healthy = virtualScreenPayloadFromArtifact({
    id: 'stream-quality-healthy-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: liveNativeHostData('stream-quality-healthy', false),
  }, testConfig());

  assert.equal(degraded?.surfaceMode, 'fallback');
  assert.equal(degraded?.presentationState, 'fallback');
  assert.equal(degraded?.presentationStateReason, 'stream-quality-fallback-required');
  assert.deepEqual(degraded?.presentationStateReasonRefs, [
    'computer-use:native-host/surfaces/stream-quality-degraded/stream-quality.json',
    'computer-use:native-host/surfaces/stream-quality-degraded/frame-telemetry.json',
    'computer-use:native-host/surfaces/stream-quality-degraded/stream-quality-degradation.json',
  ]);
  assert.equal(degraded?.liveSurfaceRef, 'computer-use:native-host/surfaces/stream-quality-degraded/live-surface.json');
  assert.equal(degraded?.frameTelemetry?.ref, 'computer-use:native-host/surfaces/stream-quality-degraded/frame-telemetry.json');
  assert.equal(healthy?.surfaceMode, 'live');
  assert.equal(healthy?.presentationState, 'live');
  assert.equal(healthy?.frameTelemetry?.ref, 'computer-use:native-host/surfaces/stream-quality-healthy/frame-telemetry.json');
});

test('screen pane model downgrades legacy provider/session refs even when live-shaped fields are present', () => {
  const payload = virtualScreenPayloadFromArtifact({
    id: 'descriptor-legacy-live-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      status: 'ready',
      attachState: 'attached',
      surfaceMode: 'live',
      targetAppRef: 'app:descriptor-native-app',
      sessionRef: 'computer-use:session/descriptor/session.json',
      screenRef: 'virtual-app-screen:descriptor/screen',
      providerSession: {
        ownerRef: 'computer-use:provider-session/descriptor/owner.json',
        reconnectRef: 'computer-use:provider-session/descriptor/reconnect.json',
        attachGrantRef: 'computer-use:provider-session/descriptor/live-binding-attach-grant.json',
        attachGrantStatus: 'validated',
        validationRef: 'computer-use:provider-session/descriptor/grant-validation.json',
        validationStatus: 'validated',
      },
      surfaceTransportDescriptor: {
        owner: 'VirtualDisplayProvider',
        providerId: 'provider:descriptor',
        transport: 'native-frame-stream',
        surfaceTransportRef: 'computer-use:session/descriptor/surface-transport.json',
        liveSurfaceRef: 'computer-use:session/descriptor/live-surface.json',
        frameStreamRef: 'computer-use:session/descriptor/frame-stream.json',
        currentFrameRef: 'computer-use:session/descriptor/frames/current.png',
        currentFrameSequence: 0,
        diagnosticOnly: false,
        productFallback: false,
        singleInteractiveTruth: true,
      },
      platformDriverRef: 'computer-use:session/descriptor/platform-driver.json',
      platformDriverStatus: 'ready',
      permissionStatus: 'granted',
      permissionGranted: true,
      evidenceLedgerRef: 'computer-use:session/descriptor/evidence-ledger.json',
      providerExecuted: true,
      isolationFlags: {
        backgroundRenderable: true,
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        singleInteractiveTruth: true,
        secondInteractiveSurfacePresent: false,
        diagnosticOnly: false,
      },
    },
  }, testConfig());

  assert.equal(payload?.surfaceMode, 'replay');
  assert.equal(payload?.liveSurfaceRef, 'computer-use:session/descriptor/live-surface.json');
  assert.equal(payload?.surfaceTransport, 'native-frame-stream');
  assert.equal(payload?.surfaceTransportRef, 'computer-use:session/descriptor/surface-transport.json');
  assert.equal(payload?.frameStreamRef, 'computer-use:session/descriptor/frame-stream.json');
  assert.equal(payload?.currentFrameRef, 'computer-use:session/descriptor/frames/current.png');
  assert.equal(payload?.providerSessionOwnerRef, 'computer-use:provider-session/descriptor/owner.json');
  assert.equal(payload?.providerSessionReconnectRef, 'computer-use:provider-session/descriptor/reconnect.json');
  assert.equal(payload?.liveBindingAttachGrantRef, 'computer-use:provider-session/descriptor/live-binding-attach-grant.json');
  assert.equal(payload?.grantValidationRef, 'computer-use:provider-session/descriptor/grant-validation.json');
  assert.deepEqual(payload?.currentFrameSequence, {
    ref: 'computer-use:session/descriptor/frames/current.png',
    label: undefined,
    status: undefined,
    transport: 'native-frame-stream',
    diagnosticOnly: undefined,
    sequence: 0,
  });
});

test('screen pane model does not mark native host refs live without surface owner evidence', () => {
  const payload = virtualScreenPayloadFromArtifact({
    id: 'missing-native-host-owner-evidence',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      status: 'ready',
      attachState: 'attached',
      surfaceMode: 'live',
      targetAppRef: 'app:missing-owner/vscode',
      targetWindowRef: 'window:missing-owner/vscode/main',
      sessionRef: 'computer-use:native-host/sessions/session-missing-owner/session.json',
      hostSessionRef: 'computer-use:native-host/sessions/session-missing-owner/session.json',
      screenRef: 'virtual-app-screen:missing-owner/screen',
      liveSurfaceRef: 'computer-use:native-host/surfaces/missing-owner/live-surface.json',
      surfaceTransport: 'native-frame-stream',
      surfaceTransportRef: 'computer-use:native-host/surfaces/missing-owner/surface-transport.json',
      surfaceTransportDescriptor: {
        owner: 'VirtualDisplayProvider',
        transport: 'native-frame-stream',
        surfaceTransportRef: 'computer-use:native-host/surfaces/missing-owner/surface-transport.json',
        liveSurfaceRef: 'computer-use:native-host/surfaces/missing-owner/live-surface.json',
        frameStreamRef: 'computer-use:native-host/surfaces/missing-owner/frame-stream.json',
        currentFrameRef: 'computer-use:native-host/frames/missing-owner/0007.png',
        currentFrameSequence: 7,
        diagnosticOnly: false,
        productFallback: false,
        singleInteractiveTruth: true,
      },
      frameStreamRef: 'computer-use:native-host/surfaces/missing-owner/frame-stream.json',
      displayOwnerRef: 'computer-use:native-host/surfaces/missing-owner/display-owner.json',
      providerSessionOwnerRef: 'computer-use:native-host/provider-sessions/missing-owner/owner.json',
      providerSessionReconnectRef: 'computer-use:native-host/reconnect/missing-owner/reconnect.json',
      liveBindingAttachGrantRef: 'computer-use:native-host/grants/missing-owner/live-binding-attach-grant.json',
      liveBindingAttachGrantStatus: 'validated',
      grantValidationRef: 'computer-use:native-host/ledgers/session-missing-owner/evidence-ledger.json/events/0007-grant.validated.json',
      grantValidationStatus: 'validated',
      platformDriverRef: 'computer-use:native-host/platform-drivers/missing-owner/platform-driver.json',
      platformDriverStatus: 'ready',
      permissionStatus: 'granted',
      permissionGranted: true,
      evidenceLedgerRef: 'computer-use:native-host/ledgers/session-missing-owner/evidence-ledger.json',
      providerExecuted: true,
      currentFrameSequence: {
        ref: 'computer-use:native-host/surfaces/missing-owner/frame-sequence.json',
        sequence: 7,
      },
      currentFrameRef: 'computer-use:native-host/frames/missing-owner/0007.png',
      isolationFlags: {
        backgroundRenderable: true,
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        singleInteractiveTruth: true,
        secondInteractiveSurfacePresent: false,
        diagnosticOnly: false,
      },
    },
  }, testConfig());

  assert.equal(payload?.attachState, 'attached');
  assert.equal(payload?.surfaceMode, 'replay');
  assert.equal(payload?.surfaceOwnerRef || undefined, undefined);
  assert.equal(payload?.displayOwnerRef, 'computer-use:native-host/surfaces/missing-owner/display-owner.json');
});

test('screen pane model downgrades active run artifacts that only look shape-compatible with live attach', () => {
  const activeRun = run('run-arbitrary-shape-compatible-screen', {
    raw: {
      data: {
        output: {
          artifacts: [{
            id: 'hand-written-live-looking-screen',
            type: 'computer-use-virtual-screen',
            producerScenario: 'computer-use',
            schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
            data: {
              status: 'ready',
              attachState: 'attached',
              surfaceMode: 'live',
              sessionRef: 'computer-use:session/arbitrary/session.json',
              screenRef: 'virtual-app-screen:arbitrary/screen',
              liveSurfaceRef: 'computer-use:session/arbitrary/live-surface.json',
              surfaceTransport: 'native-frame-stream',
              surfaceTransportRef: 'computer-use:session/arbitrary/surface-transport.json',
              surfaceTransportDescriptor: {
                owner: 'VirtualDisplayProvider',
                providerId: 'provider:arbitrary',
                transport: 'native-frame-stream',
                surfaceTransportRef: 'computer-use:session/arbitrary/surface-transport.json',
                liveSurfaceRef: 'computer-use:session/arbitrary/live-surface.json',
                frameStreamRef: 'computer-use:session/arbitrary/frame-stream.json',
                currentFrameRef: 'computer-use:session/arbitrary/frames/current.png',
                currentFrameSequence: 7,
                diagnosticOnly: false,
                productFallback: false,
                singleInteractiveTruth: true,
              },
              frameStreamRef: 'computer-use:session/arbitrary/frame-stream.json',
              currentFrameRef: 'computer-use:session/arbitrary/frames/current.png',
              currentFrameSequence: {
                ref: 'computer-use:session/arbitrary/frame-sequence.json',
                sequence: 7,
              },
              isolationFlags: {
                backgroundRenderable: true,
                affectsPhysicalDisplay: false,
                requiresFocusSteal: false,
                sharedSystemInputUsed: false,
                systemPointerMoved: false,
                systemKeyboardEventsSent: false,
                singleInteractiveTruth: true,
                secondInteractiveSurfacePresent: false,
                diagnosticOnly: false,
              },
            },
          }],
        },
      },
    },
  });
  const session = emptySession({ runs: [activeRun] });

  const payload = rightPaneVirtualScreenPayload(session, activeRun, testConfig());

  assert.equal(payload.attachState, 'attached');
  assert.equal(payload.surfaceMode, 'replay');
  assert.equal(payload.sessionRef, 'computer-use:session/arbitrary/session.json');
  assert.equal(payload.liveSurfaceRef, 'computer-use:session/arbitrary/live-surface.json');
  assert.equal(payload.platformDriverStatus || undefined, undefined);
  assert.equal((payload as Record<string, unknown>).providerExecuted, undefined);
  assert.equal(payload.evidenceLedgerRef || undefined, undefined);
  assert.equal(payload.providerSessionOwnerRef || undefined, undefined);
  assert.equal(payload.providerSessionReconnectRef || undefined, undefined);
});

test('screen pane model downgrades live-looking payloads when a second interactive surface is present', () => {
  const payload = virtualScreenPayloadFromArtifact({
    id: 'unsafe-live-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      status: 'ready',
      attachState: 'attached',
      surfaceMode: 'live',
      sessionRef: 'computer-use:session/unsafe-live/session.json',
      liveSurfaceRef: 'computer-use:session/unsafe-live/live-surface.json',
      frameStreamRef: 'computer-use:session/unsafe-live/frame-stream.json',
      currentFrameRef: 'computer-use:session/unsafe-live/frames/current.png',
      isolationFlags: {
        singleInteractiveTruth: false,
        secondInteractiveSurfacePresent: true,
      },
    },
  }, testConfig());

  assert.equal(payload?.surfaceMode, 'replay');
  assert.equal(payload?.liveSurfaceRef, 'computer-use:session/unsafe-live/live-surface.json');
});

test('screen pane model does not mark live mode without provider ownership and sequence refs', () => {
  const payload = virtualScreenPayloadFromArtifact({
    id: 'missing-live-binding-refs',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      status: 'ready',
      attachState: 'attached',
      surfaceMode: 'live',
      sessionRef: 'computer-use:session/missing-live/session.json',
      liveSurfaceRef: 'computer-use:session/missing-live/live-surface.json',
      surfaceTransport: 'native-frame-stream',
      frameStreamRef: 'computer-use:session/missing-live/frame-stream.json',
      currentFrameRef: 'computer-use:session/missing-live/frames/current.png',
      isolationFlags: {
        backgroundRenderable: true,
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        singleInteractiveTruth: true,
        secondInteractiveSurfacePresent: false,
        diagnosticOnly: false,
      },
    },
  }, testConfig());

  assert.equal(payload?.attachState, 'attached');
  assert.equal(payload?.surfaceMode, 'replay');
  assert.equal(payload?.providerSessionOwnerRef, '');
  assert.equal(payload?.providerSessionReconnectRef, '');
  assert.equal(payload?.surfaceTransportRef, '');
  assert.equal(payload?.currentFrameSequence, undefined);
});

function testConfig(): SciForgeConfig {
  return {
    workspacePath: '/tmp/sciforge',
    locale: 'en-US',
  } as SciForgeConfig;
}

function run(id: string, overrides: Partial<SciForgeRun> = {}): SciForgeRun {
  return {
    id,
    scenarioId: 'computer-use',
    status: 'completed',
    createdAt: '2026-06-01T00:00:00.000Z',
    completedAt: '2026-06-01T00:00:01.000Z',
    ...overrides,
  } as SciForgeRun;
}

function liveNativeHostScreenData(scope: string): Record<string, unknown> {
  const screenRef = `virtual-app-screen:${scope}/screen-request`;
  const currentFrameRef = `computer-use:native-host/frames/${scope}/current.png`;
  const liveSurfaceRef = `computer-use:native-host/surfaces/${scope}/live-surface.json`;
  const frameStreamRef = `computer-use:native-host/surfaces/${scope}/frame-stream.json`;
  const surfaceTransportRef = `computer-use:native-host/surfaces/${scope}/surface-transport.json`;
  return {
    status: 'ready',
    attachState: 'attached',
    surfaceMode: 'live',
    screenRef,
    targetAppRef: 'app:profile/vscode-editor',
    targetWindowRef: `window:${scope}/main`,
    sessionRef: `computer-use:native-host/sessions/${scope}/session.json`,
    hostSessionRef: `computer-use:native-host/sessions/${scope}/session.json`,
    liveSurfaceRef,
    surfaceTransport: 'native-frame-stream',
    surfaceTransportRef,
    surfaceOwnerRef: `computer-use:native-host/surfaces/${scope}/surface-owner.json`,
    displayOwnerRef: `computer-use:native-host/surfaces/${scope}/display-owner.json`,
    providerSessionOwnerRef: `computer-use:native-host/provider-session/${scope}/owner.json`,
    providerSessionReconnectRef: `computer-use:native-host/provider-session/${scope}/reconnect.json`,
    liveBindingAttachGrantRef: `computer-use:native-host/grants/${scope}/live-binding-attach-grant.json`,
    liveBindingAttachGrantStatus: 'validated',
    grantValidationRef: `computer-use:native-host/ledgers/${scope}/evidence-ledger.json/events/0004-grant.validated.json`,
    grantValidationStatus: 'validated',
    frameStreamRef,
    currentFrameRef,
    currentFrameSequence: {
      ref: currentFrameRef,
      transport: 'native-frame-stream',
      sequence: 1,
    },
    surfaceTransportDescriptor: {
      schemaVersion: 'sciforge.virtual-display.surface-transport.v1',
      owner: 'VirtualDisplayProvider',
      providerId: 'native-virtual-app-screen-host',
      transport: 'native-frame-stream',
      surfaceTransportRef,
      liveSurfaceRef,
      frameStreamRef,
      currentFrameRef,
      frameTransportContractRef: `computer-use:native-host/surfaces/${scope}/frame-transport-contract.json`,
      frameTelemetryRef: `computer-use:native-host/surfaces/${scope}/frame-telemetry.json`,
      currentFrameSequence: 1,
      diagnosticOnly: false,
      productFallback: false,
      singleInteractiveTruth: true,
    },
    inputLeaseRef: `computer-use:native-host/leases/${scope}/input-lease.json`,
    actionAdapterRef: `computer-use:native-host/adapters/${scope}/action-adapter.json`,
    adapterReadinessRef: `computer-use:native-host/readiness/${scope}/provider-readiness.json`,
    platformDriverRef: `computer-use:native-host/platform-drivers/${scope}/ready.json`,
    platformDriverStatus: 'ready',
    permissionRef: `computer-use:native-host/permissions/${scope}/screen-recording.json`,
    permissionStatus: 'granted',
    permissionRequired: true,
    permissionGranted: true,
    evidenceLedgerRef: `computer-use:native-host/ledgers/${scope}/evidence-ledger.json`,
    providerExecuted: true,
    isolationFlags: {
      backgroundRenderable: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      singleInteractiveTruth: true,
      secondInteractiveSurfacePresent: false,
      diagnosticOnly: false,
    },
  };
}

function emptySession(overrides: Partial<SciForgeSession> = {}): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-empty',
    scenarioId: 'literature-evidence-review',
    title: 'empty',
    createdAt: '2026-06-01T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}
