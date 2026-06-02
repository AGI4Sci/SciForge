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
  assert.ok(payload.permissionHandoffRefs?.includes(`computer-use:screen-activation/${scope}/permission-handoff/macos-screen-recording.json`));
  assert.ok(payload.permissionHandoffRefs?.includes(`computer-use:screen-activation/${scope}/permission-handoff/macos-accessibility.json`));
  assert.ok(payload.permissionHandoffRefs?.includes(`computer-use:screen-activation/${scope}/permission-handoff/macos-automation.json`));
  assert.ok(payload.permissionHandoffRefs?.includes(`computer-use:screen-activation/${scope}/permission-handoff/macos-virtual-display-helper.json`));
  assert.ok(payload.permissionHandoffRefs?.includes(`computer-use:screen-activation/${scope}/permission-handoff/linux-xpra-install.json`));
  assert.ok(payload.permissionHandoffRefs?.includes(`computer-use:screen-activation/${scope}/permission-handoff/linux-xpra-session-permission.json`));
  assert.ok(payload.permissionHandoffRefs?.includes(`computer-use:screen-activation/${scope}/permission-handoff/windows-idd-driver-install.json`));
  assert.equal(payload.permissionRecheckRef, `computer-use:screen-activation/${scope}/permission-recheck.json`);
  assert.equal(payload.recheckRef, `computer-use:screen-activation/${scope}/permission-recheck.json`);
  assert.ok(payload.permissionRecheckRefs?.includes(`computer-use:screen-activation/${scope}/permission-recheck/windows-idd-driver-install.json`));
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
              sessionRef: 'computer-use:session/run-live-vscode/session.json',
              screenRef: 'virtual-app-screen:run-live-vscode/screen',
              liveSurfaceRef: 'computer-use:session/run-live-vscode/live-surface.json',
              surfaceTransport: 'webrtc',
              surfaceTransportRef: 'computer-use:session/run-live-vscode/surface-transport.json',
              surfaceTransportDescriptor: {
                owner: 'VirtualDisplayProvider',
                providerId: 'provider:run-live-vscode',
                transport: 'webrtc',
                surfaceTransportRef: 'computer-use:session/run-live-vscode/surface-transport.json',
                liveSurfaceRef: 'computer-use:session/run-live-vscode/live-surface.json',
                frameStreamRef: 'computer-use:session/run-live-vscode/frame-stream.json',
                currentFrameRef: 'computer-use:session/run-live-vscode/frames/current.png',
                currentFrameSequence: 31,
                diagnosticOnly: false,
                productFallback: false,
                singleInteractiveTruth: true,
              },
              frameStreamRef: 'computer-use:session/run-live-vscode/frame-stream.json',
              providerSessionOwnerRef: 'computer-use:provider-session/run-live-vscode/owner.json',
              providerSessionReconnectRef: 'computer-use:provider-session/run-live-vscode/reconnect.json',
              liveBindingAttachGrantRef: 'computer-use:provider-session/run-live-vscode/live-binding-attach-grant.json',
              platformDriverRef: 'computer-use:session/run-live-vscode/platform-driver.json',
              platformDriverStatus: 'ready',
              permissionStatus: 'granted',
              permissionGranted: true,
              evidenceLedgerRef: 'computer-use:session/run-live-vscode/evidence-ledger.json',
              providerExecuted: true,
              currentFrameSequence: {
                ref: 'computer-use:session/run-live-vscode/frame-sequence.json',
                status: 'running',
                sequence: 31,
              },
              currentFrameRef: 'computer-use:session/run-live-vscode/frames/current.png',
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
  assert.equal(payload.liveSurfaceRef, 'computer-use:session/run-live-vscode/live-surface.json');
  assert.equal(payload.surfaceTransport, 'webrtc');
  assert.equal(payload.surfaceTransportRef, 'computer-use:session/run-live-vscode/surface-transport.json');
  assert.equal(payload.frameStreamRef, 'computer-use:session/run-live-vscode/frame-stream.json');
  assert.equal(payload.providerSessionOwnerRef, 'computer-use:provider-session/run-live-vscode/owner.json');
  assert.equal(payload.providerSessionReconnectRef, 'computer-use:provider-session/run-live-vscode/reconnect.json');
  assert.equal(payload.liveBindingAttachGrantRef, 'computer-use:provider-session/run-live-vscode/live-binding-attach-grant.json');
  assert.deepEqual(payload.currentFrameSequence, {
    ref: 'computer-use:session/run-live-vscode/frame-sequence.json',
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

test('screen pane model extracts live binding refs from surface transport descriptors', () => {
  const payload = virtualScreenPayloadFromArtifact({
    id: 'descriptor-live-screen',
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

  assert.equal(payload?.surfaceMode, 'live');
  assert.equal(payload?.liveSurfaceRef, 'computer-use:session/descriptor/live-surface.json');
  assert.equal(payload?.surfaceTransport, 'native-frame-stream');
  assert.equal(payload?.surfaceTransportRef, 'computer-use:session/descriptor/surface-transport.json');
  assert.equal(payload?.frameStreamRef, 'computer-use:session/descriptor/frame-stream.json');
  assert.equal(payload?.currentFrameRef, 'computer-use:session/descriptor/frames/current.png');
  assert.equal(payload?.providerSessionOwnerRef, 'computer-use:provider-session/descriptor/owner.json');
  assert.equal(payload?.providerSessionReconnectRef, 'computer-use:provider-session/descriptor/reconnect.json');
  assert.equal(payload?.liveBindingAttachGrantRef, 'computer-use:provider-session/descriptor/live-binding-attach-grant.json');
  assert.deepEqual(payload?.currentFrameSequence, {
    ref: 'computer-use:session/descriptor/frames/current.png',
    label: undefined,
    status: undefined,
    transport: 'native-frame-stream',
    diagnosticOnly: undefined,
    sequence: 0,
  });
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
