import assert from 'node:assert/strict';
import test from 'node:test';

import { parseVirtualAppScreenRuntimeCommand } from './virtual-app-screen-command.js';
import {
  attachVirtualAppScreenSession,
  virtualAppScreenSessionManagerResultToVirtualScreenData,
} from './virtual-app-screen-session-manager.js';
import {
  createVirtualAppScreenNativeExecutor,
  registerVirtualAppScreenNativeExecutor,
} from './virtual-app-screen-native-executor.js';
import {
  readVirtualAppScreenNativeHostSessionRecord,
  resetVirtualAppScreenNativeHostSessionStoreForTests,
} from './virtual-app-screen-native-host-session-store.js';
import {
  createVirtualDisplayProviderContract,
  probeVirtualDisplayProviders,
  type VirtualDisplayProviderInvokeIntent,
  type VirtualDisplayProviderInvokeResult,
  type VirtualDisplayProviderL1Contract,
  type VirtualDisplayProviderOperationOptions,
  type VirtualDisplayProviderReadinessStatus,
  type VirtualDisplayReadiness,
} from './virtual-display-provider.js';

const lifecycleIntents = ['probe', 'createSession', 'launchApp', 'attachSurface', 'readFrame'] as const;
type LifecycleIntent = typeof lifecycleIntents[number];

test('VirtualAppScreen native executor fails closed when any provider lifecycle operation is blocked', async (t) => {
  for (const blockedIntent of lifecycleIntents) {
    await t.test(blockedIntent, async () => {
      const command = parsedAttachCommand();
      const calls: string[] = [];
      const provider = fakeProvider({
        calls,
        status: 'ready',
        statusByIntent: { [blockedIntent]: 'blocked' },
        readiness: blockedIntent === 'probe' ? blockedReadiness() : readyReadiness(),
        blockedReason: `${blockedIntent} is blocked by provider readiness.`,
      });
      const executor = createVirtualAppScreenNativeExecutor({
        executorId: `native-session-manager:${blockedIntent}-blocked-test`,
        providerId: `provider:${blockedIntent}-blocked-test`,
        supportedProfiles: ['vscode-editor'],
        provider,
      });

      const result = await executor.attach(command);
      const data = virtualAppScreenSessionManagerResultToVirtualScreenData(command, result);
      const expectedCalls: string[] = lifecycleIntents.slice(0, lifecycleIntents.indexOf(blockedIntent) + 1);
      if (lifecycleIntents.indexOf(blockedIntent) > lifecycleIntents.indexOf('createSession')) {
        expectedCalls.push('closeSession');
      }

      assert.deepEqual(calls, expectedCalls);
      assert.equal(result.status, 'blocked');
      assert.equal(result.executorId, `native-session-manager:${blockedIntent}-blocked-test`);
      assert.equal(result.evidence.providerExecuted, false);
      assert.equal(result.evidence.nativeSessionCreated, false);
      assert.equal(result.evidence.liveFrameAttached, false);
      assert.equal(result.evidence.currentFrameMaterialized, false);
      assert.match(result.blockedReason ?? '', new RegExp(`${blockedIntent} was not ready`));
      assert.equal(result.refs.sessionRef, undefined);
      assert.equal(result.refs.targetWindowRef, undefined);
      assert.equal(result.refs.liveSurfaceRef, undefined);
      assert.equal(result.refs.frameStreamRef, undefined);
      assert.equal(result.refs.currentFrameRef, undefined);
      assert.equal(data.attachState, 'blocked');
      assert.equal(data.sessionRef, undefined);
      assert.equal(data.liveSurfaceRef, undefined);
      assert.equal(data.frameStreamRef, undefined);
      assert.equal(data.currentFrameRef, undefined);
    });
  }
});

test('VirtualAppScreen native executor attaches only after provider create launch attach and readFrame refs exist', async () => {
  const command = parsedAttachCommand();
  const calls: string[] = [];
  const provider = fakeProvider({ calls, status: 'ready', readiness: readyReadiness() });
  const unregister = registerVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:attached-test',
    providerId: 'provider:attached-test',
    supportedProfiles: ['vscode-editor'],
    provider,
  });
  try {
    const result = await attachVirtualAppScreenSession(command);
    const data = virtualAppScreenSessionManagerResultToVirtualScreenData(command, result);

    assert.deepEqual(calls, ['probe', 'createSession', 'launchApp', 'attachSurface', 'readFrame']);
    assert.equal(result.status, 'attached');
    assert.equal(result.executorId, 'native-session-manager:attached-test');
    assert.equal(result.providerId, 'virtual-display.macos.cgvirtualdisplay-screencapturekit');
    assert.equal(result.evidence.providerExecuted, true);
    assert.equal(result.evidence.mutatingActionExecuted, false);
    assert.equal(result.evidence.nativeSessionCreated, true);
    assert.equal(result.evidence.liveFrameAttached, true);
    assert.equal(result.evidence.currentFrameMaterialized, true);
    assert.equal(result.evidence.isolationVerified, true);
    assert.equal(result.evidence.providerSessionGrantValidated, true);
    assert.equal(result.evidence.platformDriverReady, true);
    assert.equal(result.evidence.permissionRequired, true);
    assert.equal(result.evidence.permissionGranted, true);
    assert.equal(result.evidence.backgroundRenderable, true);
    assert.equal(result.evidence.diagnosticOnly, false);
    assert.equal(result.evidence.affectsPhysicalDisplay, false);
    assert.equal(result.evidence.requiresFocusSteal, false);
    assert.equal(result.evidence.sharedSystemInputUsed, false);
    assert.equal(result.evidence.systemPointerMoved, false);
    assert.equal(result.evidence.systemKeyboardEventsSent, false);
    assert.match(result.refs.sessionRef ?? '', /^computer-use:native-host\/sessions\/session-1\/session\.json$/);
    assert.equal(result.refs.targetWindowRef, 'window:native-executor-test/vscode/main');
    assert.match(result.refs.liveSurfaceRef ?? '', /^computer-use:native-host\/surfaces\//);
    assert.match(result.refs.surfaceTransportRef ?? '', /^computer-use:native-host\/surfaces\//);
    assert.match(result.refs.frameStreamRef ?? '', /^computer-use:native-host\/surfaces\//);
    assert.match(result.refs.currentFrameRef ?? '', /^computer-use:native-host\/frames\//);
    assert.match(result.refs.frameTransportContractRef ?? '', /^computer-use:native-host\/surfaces\//);
    assert.equal(result.refs.adapterReadinessRef, '.sciforge/vision-runs/native-executor-test/virtual-display-provider/adapter-readiness.json');
    assert.equal(result.refs.platformDriverRef, 'computer-use:session/native-executor-test/platform-driver.json');
    assert.equal(result.refs.permissionRef, 'permission:macos/screen-recording');
    assert.equal(result.refs.evidenceLedgerRef, 'computer-use:native-host/ledgers/session-1/evidence-ledger.json');
    assert.equal(result.refs.currentRunPointerRef, 'computer-use:native-host/runs/session-1/current-run-pointer.json');
    assert.deepEqual(result.refs.hostLifecycleReplayRefs, [
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0001-session.created.json',
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0002-app.launched.json',
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0003-surface.attached.json',
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0004-grant.validated.json',
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0005-frame.read.json',
    ]);
    assert.deepEqual(result.refs.minimalEvidenceReplayRefs, [
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0001-session.created.json',
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0003-surface.attached.json',
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0004-grant.validated.json',
      'computer-use:native-host/ledgers/session-1/evidence-ledger.json/events/0005-frame.read.json',
    ]);
    assert.equal(result.refs.guiPresentRef, 'gui.present:native-executor-test/screen-pane');
    assert.match(result.refs.liveBindingAttachGrantRef ?? '', /^computer-use:native-host\/grants\//);
    assert.match(result.refs.grantValidationRef ?? '', /^computer-use:native-host\/ledgers\/session-1\/evidence-ledger\.json\/events\/\d+-grant\.validated\.json$/);
    assert.match(result.refs.surfaceOwnerRef ?? '', /^computer-use:native-host\/surfaces\//);
    assert.match(result.refs.displayOwnerRef ?? '', /^computer-use:native-host\/surfaces\//);
    assert.equal(result.evidence.surfaceTransport?.transport, 'webrtc');
    assert.equal(result.evidence.surfaceTransport?.surfaceTransportRef, result.refs.surfaceTransportRef);
    assert.equal(result.evidence.surfaceTransport?.currentFrameSequence, 7);
    for (const ref of [
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/adapter-readiness.json',
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/lifecycle-ledger.json#createSession',
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/lifecycle-ledger.json#launchApp',
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/lifecycle-ledger.json#attachSurface',
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/surface-transport.json',
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/frame-transport-contract.json',
      'computer-use:session/native-executor-test/frames/current.png',
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/evidence-ledger.json',
      'computer-use:session/native-executor-test/platform-driver.json',
      'permission:macos/screen-recording',
      'gui.present:native-executor-test/screen-pane',
    ]) {
      assert.ok(result.evidence.evidenceRefs.includes(ref), `missing evidence ref ${ref}`);
    }
    assert.ok(result.evidence.evidenceRefs.includes(result.refs.evidenceLedgerRef));
    assert.ok(result.evidence.evidenceRefs.includes(result.refs.currentRunPointerRef!));
    for (const ref of result.refs.hostLifecycleReplayRefs ?? []) {
      assert.ok(result.evidence.evidenceRefs.includes(ref), `missing lifecycle replay ref ${ref}`);
    }
    for (const ref of result.refs.minimalEvidenceReplayRefs ?? []) {
      assert.ok(result.evidence.evidenceRefs.includes(ref), `missing replay ref ${ref}`);
    }
    assert.ok(result.evidence.evidenceRefs.includes(result.refs.liveBindingAttachGrantRef!));
    assert.ok(result.evidence.evidenceRefs.includes(result.refs.grantValidationRef!));
    assert.ok(result.evidence.evidenceRefs.includes(result.refs.providerSessionOwnerRef!));
    assert.ok(result.evidence.evidenceRefs.includes(result.refs.providerSessionReconnectRef!));
    assert.equal(data.status, 'ready');
    assert.equal(data.attachState, 'attached');
    assert.equal(data.surfaceMode, 'live');
    assert.equal(data.surfaceTransport, 'webrtc');
    assert.equal(data.hostSessionRef, result.refs.sessionRef);
    assert.equal(data.currentRunPointerRef, result.refs.currentRunPointerRef);
    assert.deepEqual(data.hostLifecycleReplayRefs, result.refs.hostLifecycleReplayRefs);
    assert.deepEqual(data.minimalEvidenceReplayRefs, result.refs.minimalEvidenceReplayRefs);
    assert.equal(data.surfaceOwnerRef, result.refs.surfaceOwnerRef);
    assert.equal(data.displayOwnerRef, result.refs.displayOwnerRef);
    assert.equal(data.liveBindingAttachGrantRef, result.refs.liveBindingAttachGrantRef);
    assert.equal(data.grantValidationRef, result.refs.grantValidationRef);
    assert.equal(data.liveBindingAttachGrantStatus, 'validated');
    assert.equal(data.grantValidationStatus, 'validated');
    assert.deepEqual(data.frameTransport, {
      ref: result.refs.frameTransportContractRef,
      transport: 'webrtc',
      diagnosticOnly: false,
      sequence: 7,
    });
    assert.equal(data.currentFrameRef, result.refs.currentFrameRef);
  } finally {
    unregister();
  }
});

test('VirtualAppScreen native executor resolves app profiles before invoking provider target kind', async () => {
  const command = parsedAttachCommand();
  const calls: string[] = [];
  const operationOptionsByIntent: Partial<Record<LifecycleIntent, VirtualDisplayProviderOperationOptions | undefined>> = {};
  const provider = fakeProvider({
    calls,
    status: 'ready',
    readiness: readyReadiness(),
    operationOptionsByIntent,
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:profile-resolver-test',
    providerId: 'provider:profile-resolver-test',
    supportedProfiles: ['vscode-editor'],
    provider,
  });

  const result = await executor.attach(command);

  assert.equal(result.status, 'attached', result.blockedReason);
  for (const intent of lifecycleIntents) {
    assert.equal(operationOptionsByIntent[intent]?.targetAppKind, 'vscode');
    assert.equal(operationOptionsByIntent[intent]?.targetAppName, 'VSCode');
  }
  assert.equal(result.refs.targetAppRef, 'app:profile/vscode-editor');
});

test('VirtualAppScreen native executor blocks unknown app profiles instead of falling back to provider generic', async () => {
  const command = parsedAttachCommand('unknown-editor', 'app:profile/unknown-editor');
  const calls: string[] = [];
  const provider = fakeProvider({
    calls,
    status: 'ready',
    readiness: readyReadiness(),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:unknown-profile-test',
    providerId: 'provider:unknown-profile-test',
    supportedProfiles: ['*'],
    provider,
  });

  const result = await executor.attach(command);

  assert.deepEqual(calls, []);
  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /unknown-editor/);
  assert.equal(result.evidence.providerExecuted, false);
});

test('VirtualAppScreen native executor registers the Host binding for returned public session refs', async () => {
  resetVirtualAppScreenNativeHostSessionStoreForTests();
  const command = parsedAttachCommand();
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-executor:host-binding-test',
    providerId: 'provider:host-binding-test',
    provider: fakeProvider({ calls: [], readiness: readyReadiness() }),
  });
  try {
    const result = await executor.attach(command);
    assert.equal(result.status, 'attached');
    assert.ok(result.refs.sessionRef);
    assert.ok(result.refs.screenRef);

    const record = readVirtualAppScreenNativeHostSessionRecord({
      sessionRef: result.refs.sessionRef,
      screenRef: result.refs.screenRef,
    });
    assert.ok(record);
    assert.equal(record.sessionRef, result.refs.sessionRef);
    assert.equal(record.screenRef, result.refs.screenRef);
    assert.equal(record.liveSurfaceRef, result.refs.liveSurfaceRef);
    assert.equal(record.frameStreamRef, result.refs.frameStreamRef);
    assert.equal(record.currentFrameRef, result.refs.currentFrameRef);
    assert.equal(record.adapterReadinessRef, result.refs.adapterReadinessRef);
    assert.equal(record.evidenceLedgerRef, result.refs.evidenceLedgerRef);
    assert.equal(record.liveBindingAttachGrantRef, result.refs.liveBindingAttachGrantRef);
    assert.equal(record.grantValidationRef, result.refs.grantValidationRef);
    assert.equal(record.owner, 'NativeVirtualAppScreenHost');
    assert.equal(record.singleInteractiveTruth, true);
  } finally {
    resetVirtualAppScreenNativeHostSessionStoreForTests();
  }
});

test('VirtualAppScreen native executor rejects provider chains missing required attached refs', async (t) => {
  const cases: Array<{
    name: string;
    missingReason: RegExp;
    omitRefsByIntent: Partial<Record<LifecycleIntent, string[]>>;
  }> = [
    {
      name: 'createSession.sessionRef',
      missingReason: /createSession\.sessionRef/,
      omitRefsByIntent: { createSession: ['sessionRef'] },
    },
    {
      name: 'launchApp.targetWindowRef',
      missingReason: /launchApp\.targetWindowRef/,
      omitRefsByIntent: { launchApp: ['targetWindowRef'] },
    },
    {
      name: 'attachSurface.liveSurfaceRef',
      missingReason: /attachSurface\.liveSurfaceRef/,
      omitRefsByIntent: { attachSurface: ['liveSurfaceRef'] },
    },
    {
      name: 'attachSurface.frameStreamRef',
      missingReason: /attachSurface\.frameStreamRef/,
      omitRefsByIntent: { attachSurface: ['frameStreamRef'] },
    },
    {
      name: 'readFrame.currentFrameRef',
      missingReason: /readFrame\.currentFrameRef/,
      omitRefsByIntent: { readFrame: ['currentFrameRef'] },
    },
    {
      name: 'surfaceTransport',
      missingReason: /surfaceTransport/,
      omitRefsByIntent: {
        attachSurface: ['currentRunRef', 'surfaceTransportRef', 'frameTransportContractRef', 'mediaChannelRef', 'dataChannelRef'],
        readFrame: ['currentRunRef', 'surfaceTransportRef', 'frameTransportContractRef', 'frameTelemetryRef', 'mediaChannelRef', 'dataChannelRef', 'currentFrameSequence'],
      },
    },
    {
      name: 'adapterReadinessRef',
      missingReason: /adapterReadinessRef/,
      omitRefsByIntent: {
        probe: ['adapterReadinessRef'],
        createSession: ['adapterReadinessRef'],
        attachSurface: ['adapterReadinessRef'],
        readFrame: ['adapterReadinessRef'],
      },
    },
    {
      name: 'evidenceLedgerRef',
      missingReason: /evidenceLedgerRef/,
      omitRefsByIntent: {
        createSession: ['evidenceLedgerRef'],
        launchApp: ['evidenceLedgerRef'],
        attachSurface: ['evidenceLedgerRef'],
        readFrame: ['evidenceLedgerRef'],
      },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const command = parsedAttachCommand();
      const calls: string[] = [];
      const provider = fakeProvider({
        calls,
        status: 'ready',
        readiness: readyReadiness(),
        omitRefsByIntent: testCase.omitRefsByIntent,
      });
      const executor = createVirtualAppScreenNativeExecutor({
        executorId: `native-session-manager:${testCase.name}-missing-test`,
        providerId: `provider:${testCase.name}-missing-test`,
        supportedProfiles: ['*'],
        provider,
      });

      const result = await executor.attach(command);

      assert.deepEqual(
        calls,
        testCase.name === 'createSession.sessionRef'
          ? ['probe', 'createSession', 'launchApp', 'attachSurface', 'readFrame']
          : ['probe', 'createSession', 'launchApp', 'attachSurface', 'readFrame', 'closeSession'],
      );
      assert.equal(result.status, 'blocked');
      assert.match(result.blockedReason ?? '', testCase.missingReason);
      assert.equal(result.evidence.providerExecuted, false);
      assert.equal(result.refs.sessionRef, undefined);
      assert.equal(result.refs.liveSurfaceRef, undefined);
      assert.equal(result.refs.currentFrameRef, undefined);
    });
  }
});

test('VirtualAppScreen native executor rejects stale or cross-session provider lifecycle refs', async (t) => {
  const cases: Array<{
    name: string;
    mismatchReason: RegExp;
    overrideRefsByIntent: Partial<Record<LifecycleIntent, Record<string, string | undefined>>>;
  }> = [
    {
      name: 'readFrame currentRunRef from stale run',
      mismatchReason: /readFrame\.currentRunRef did not match createSession\.currentRunRef/,
      overrideRefsByIntent: {
        readFrame: {
          currentRunRef: '.sciforge/vision-runs/stale-run/current-run.json',
          surfaceTransportRef: '.sciforge/vision-runs/stale-run/virtual-display-provider/surface-transport.json',
          frameTransportContractRef: '.sciforge/vision-runs/stale-run/virtual-display-provider/frame-transport-contract.json',
          frameTelemetryRef: '.sciforge/vision-runs/stale-run/virtual-display-provider/frame-telemetry.json',
          mediaChannelRef: '.sciforge/vision-runs/stale-run/virtual-display-provider/webrtc-video-track/live',
          dataChannelRef: '.sciforge/vision-runs/stale-run/virtual-display-provider/webrtc-data-channel/control',
        },
      },
    },
    {
      name: 'readFrame sessionRef from stale session',
      mismatchReason: /readFrame\.sessionRef did not match createSession\.sessionRef/,
      overrideRefsByIntent: {
        readFrame: {
          sessionRef: 'computer-use:session/stale/session.json',
        },
      },
    },
    {
      name: 'readFrame liveSurfaceRef from different surface',
      mismatchReason: /readFrame\.liveSurfaceRef did not match attachSurface\.liveSurfaceRef/,
      overrideRefsByIntent: {
        readFrame: {
          liveSurfaceRef: 'computer-use:session/native-executor-test/other-live-surface.json',
        },
      },
    },
    {
      name: 'attachSurface targetWindowRef from different launch window',
      mismatchReason: /attachSurface\.targetWindowRef did not match launchApp\.targetWindowRef/,
      overrideRefsByIntent: {
        attachSurface: {
          targetWindowRef: 'window:stale-run/vscode/main',
        },
      },
    },
    {
      name: 'readFrame sequence moved backwards',
      mismatchReason: /readFrame\.currentFrameSequence moved backwards/,
      overrideRefsByIntent: {
        attachSurface: { currentFrameSequence: '8' },
        readFrame: { currentFrameSequence: '7' },
      },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const command = parsedAttachCommand();
      const calls: string[] = [];
      const provider = fakeProvider({
        calls,
        status: 'ready',
        readiness: readyReadiness(),
        overrideRefsByIntent: testCase.overrideRefsByIntent,
      });
      const executor = createVirtualAppScreenNativeExecutor({
        executorId: `native-session-manager:${testCase.name}-stale-test`,
        providerId: `provider:${testCase.name}-stale-test`,
        supportedProfiles: ['*'],
        provider,
      });

      const result = await executor.attach(command);

      assert.deepEqual(calls, ['probe', 'createSession', 'launchApp', 'attachSurface', 'readFrame', 'closeSession']);
      assert.equal(result.status, 'blocked');
      assert.match(result.blockedReason ?? '', testCase.mismatchReason);
      assert.equal(result.evidence.providerExecuted, false);
      assert.equal(result.refs.sessionRef, undefined);
      assert.equal(result.refs.liveSurfaceRef, undefined);
      assert.equal(result.refs.currentFrameRef, undefined);
    });
  }
});

test('VirtualAppScreen native executor rejects unsafe explicit surface transport descriptors', async () => {
  const command = parsedAttachCommand();
  const calls: string[] = [];
  const provider = fakeProvider({ calls, status: 'ready', readiness: readyReadiness() });
  const attachSurface = provider.attachSurface;
  provider.attachSurface = async (operationOptions) => ({
    ...await attachSurface(operationOptions),
    surfaceTransport: {
      schemaVersion: 'sciforge.virtual-display.surface-transport.v1',
      owner: 'VirtualDisplayProvider',
      providerId: 'virtual-display.macos.cgvirtualdisplay-screencapturekit',
      transport: 'mjpeg',
      surfaceTransportRef: 'https://provider.invalid/raw-transport',
      liveSurfaceRef: 'computer-use:session/native-executor-test/live-surface.json',
      frameStreamRef: 'computer-use:session/native-executor-test/frame-stream.json',
      currentFrameRef: 'computer-use:session/native-executor-test/frames/current.png',
      frameTransportContractRef: '.sciforge/vision-runs/native-executor-test/virtual-display-provider/frame-transport-contract.json',
      diagnosticOnly: false,
      productFallback: false,
      singleInteractiveTruth: true,
    } as unknown as VirtualDisplayProviderInvokeResult['surfaceTransport'],
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:unsafe-surface-transport-test',
    providerId: 'provider:unsafe-surface-transport-test',
    supportedProfiles: ['*'],
    provider,
  });

  const result = await executor.attach(command);

  assert.deepEqual(calls, ['probe', 'createSession', 'launchApp', 'attachSurface', 'readFrame', 'closeSession']);
  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /unsafe provider surface transport/);
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.refs.sessionRef, undefined);
  assert.equal(result.refs.liveSurfaceRef, undefined);
  assert.equal(result.refs.currentFrameRef, undefined);
});

test('VirtualAppScreen native executor preserves dry-run and no-executor fail-closed behavior', async () => {
  const command = parsedAttachCommand();
  const calls: string[] = [];
  const provider = fakeProvider({ calls, status: 'ready', readiness: readyReadiness() });
  const unregister = registerVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:dry-run-test',
    providerId: 'provider:dry-run-test',
    supportedProfiles: ['vscode-editor'],
    provider,
  });
  try {
    const dryRun = await attachVirtualAppScreenSession(command, { dryRun: true });

    assert.deepEqual(calls, []);
    assert.equal(dryRun.status, 'blocked');
    assert.match(dryRun.blockedReason ?? '', /dry-run/);
    assert.equal(dryRun.evidence.providerExecuted, false);
    assert.equal(dryRun.refs.sessionRef, undefined);
    assert.equal(dryRun.refs.liveSurfaceRef, undefined);
    assert.equal(dryRun.refs.currentFrameRef, undefined);
  } finally {
    unregister();
  }

  const noExecutor = await attachVirtualAppScreenSession(command);

  assert.deepEqual(calls, []);
  assert.equal(noExecutor.status, 'blocked');
  assert.equal(noExecutor.executorId, 'virtual-app-screen-session-manager:none');
  assert.match(noExecutor.blockedReason ?? '', /No runtime-owned native VirtualAppScreen session executor/);
  assert.equal(noExecutor.evidence.providerExecuted, false);
  assert.equal(noExecutor.refs.sessionRef, undefined);
  assert.equal(noExecutor.refs.liveSurfaceRef, undefined);
  assert.equal(noExecutor.refs.currentFrameRef, undefined);
});

test('VirtualAppScreen native executor rejects projection-only provider contracts without native execution evidence', async () => {
  const command = parsedAttachCommand();
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:projection-only-test',
    providerId: 'provider:projection-only-test',
    supportedProfiles: ['vscode-editor'],
    provider: createVirtualDisplayProviderContract({
      runId: 'projection-only-test',
      targetAppKind: 'vscode',
      probeBundle: probeVirtualDisplayProviders({
        platform: 'darwin',
        targetAppKind: 'vscode',
        nodePackageAvailability: { 'node-mac-virtual-display': true },
        permissionGrants: {
          'permission:macos/screen-recording': true,
          'permission:macos/accessibility': true,
        },
      }),
    }),
  });

  const result = await executor.attach(command);

  assert.equal(result.status, 'blocked');
  assert.equal(result.evidence.providerExecuted, false);
  assert.match(result.blockedReason ?? '', /native provider execution evidence/);
  assert.equal(result.refs.sessionRef, undefined);
  assert.equal(result.refs.liveSurfaceRef, undefined);
  assert.equal(result.refs.currentFrameRef, undefined);
});

function parsedAttachCommand(profile = 'vscode-editor', targetAppRef = `app:profile/${profile}`) {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    `--profile "${profile}"`,
    `--target-app-ref "${targetAppRef}"`,
    '--screen-ref "virtual-app-screen:native-executor-test/screen"',
    '--activation-ref "computer-use:native-executor-test/attach-request.json"',
    '--adapter-readiness-ref "computer-use:native-executor-test/provider-readiness.json"',
    '--platform-driver-ref "computer-use:session/native-executor-test/platform-driver.json"',
    '--evidence-ledger-ref "ledger:computer-use/native-executor-test/screen-activation.json"',
    '--gui-present-ref "gui.present:native-executor-test/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function readyReadiness() {
  const readiness = probeVirtualDisplayProviders({
    platform: 'darwin',
    targetAppKind: 'vscode',
    nodePackageAvailability: { 'node-mac-virtual-display': true },
    permissionGrants: {
      'permission:macos/screen-recording': true,
      'permission:macos/accessibility': true,
    },
  }).selectedReadiness;
  assert.ok(readiness);
  return readiness;
}

function blockedReadiness() {
  const readiness = probeVirtualDisplayProviders({
    platform: 'darwin',
    targetAppKind: 'vscode',
    nodePackageAvailability: { 'node-mac-virtual-display': false },
  }).selectedReadiness;
  assert.ok(readiness);
  return readiness;
}

function fakeProvider(options: {
  calls: string[];
  status?: VirtualDisplayProviderReadinessStatus;
  statusByIntent?: Partial<Record<VirtualDisplayProviderInvokeIntent, VirtualDisplayProviderReadinessStatus>>;
  readiness: VirtualDisplayReadiness;
  blockedReason?: string;
  omitRefsByIntent?: Partial<Record<VirtualDisplayProviderInvokeIntent, string[]>>;
  overrideRefsByIntent?: Partial<Record<VirtualDisplayProviderInvokeIntent, Record<string, string | undefined>>>;
  operationOptionsByIntent?: Partial<Record<LifecycleIntent, VirtualDisplayProviderOperationOptions | undefined>>;
}): VirtualDisplayProviderL1Contract {
  const call = (intent: VirtualDisplayProviderInvokeIntent) => (_operationOptions?: VirtualDisplayProviderOperationOptions) => {
    options.calls.push(intent);
    if (options.operationOptionsByIntent && lifecycleIntents.includes(intent as LifecycleIntent)) {
      options.operationOptionsByIntent[intent as LifecycleIntent] = _operationOptions;
    }
    const status = options.statusByIntent?.[intent] ?? options.status ?? 'ready';
    return fakeInvokeResult({
      intent,
      status,
      readiness: options.readiness,
      blockedReason: options.blockedReason,
      omitRefs: options.omitRefsByIntent?.[intent] ?? [],
      overrideRefs: options.overrideRefsByIntent?.[intent] ?? {},
    });
  };
  return {
    probe: call('probe'),
    createSession: call('createSession'),
    launchApp: call('launchApp'),
    attachSurface: call('attachSurface'),
    readFrame: call('readFrame'),
    sendInputIntent: call('sendInputIntent'),
    pause: call('pause'),
    resume: call('resume'),
    handoff: call('handoff'),
    closeSession: call('closeSession'),
  };
}

function fakeInvokeResult(options: {
  intent: VirtualDisplayProviderInvokeIntent;
  status: VirtualDisplayProviderReadinessStatus;
  readiness: VirtualDisplayReadiness;
  blockedReason?: string;
  omitRefs: string[];
  overrideRefs: Record<string, string | undefined>;
}): VirtualDisplayProviderInvokeResult {
  const refs = {
    currentRunRef: '.sciforge/vision-runs/native-executor-test/current-run.json',
    adapterReadinessRef: '.sciforge/vision-runs/native-executor-test/virtual-display-provider/adapter-readiness.json',
    blockedRef: options.status === 'ready' ? undefined : '.sciforge/vision-runs/native-executor-test/virtual-display-provider/blocked.json',
    sessionRef: 'computer-use:session/native-executor-test/session.json',
    sessionLeaseRef: '.sciforge/vision-runs/native-executor-test/virtual-display-provider/session-lease.json',
    displayGroupRef: 'virtual-display-group:native-executor-test',
    screenRef: 'virtual-app-screen:native-executor-test/screen',
    targetAppRef: 'app:native-executor-test/vscode',
    targetWindowRef: 'window:native-executor-test/vscode/main',
    liveSurfaceRef: 'computer-use:session/native-executor-test/live-surface.json',
    surfaceTransportRef: '.sciforge/vision-runs/native-executor-test/virtual-display-provider/surface-transport.json',
    frameStreamRef: 'computer-use:session/native-executor-test/frame-stream.json',
    currentFrameRef: 'computer-use:session/native-executor-test/frames/current.png',
    frameTransportContractRef: '.sciforge/vision-runs/native-executor-test/virtual-display-provider/frame-transport-contract.json',
    frameTelemetryRef: '.sciforge/vision-runs/native-executor-test/virtual-display-provider/frame-telemetry.json',
    mediaChannelRef: '.sciforge/vision-runs/native-executor-test/virtual-display-provider/webrtc-video-track/live',
    dataChannelRef: '.sciforge/vision-runs/native-executor-test/virtual-display-provider/webrtc-data-channel/control',
    currentFrameSequence: '7',
    lifecycleEventRef: `.sciforge/vision-runs/native-executor-test/virtual-display-provider/lifecycle-ledger.json#${options.intent}`,
    lifecycleLedgerRef: '.sciforge/vision-runs/native-executor-test/virtual-display-provider/lifecycle-ledger.json',
    evidenceLedgerRef: '.sciforge/vision-runs/native-executor-test/virtual-display-provider/evidence-ledger.json',
  };
  for (const key of options.omitRefs) {
    delete refs[key as keyof typeof refs];
  }
  for (const [key, value] of Object.entries(options.overrideRefs)) {
    if (value === undefined) {
      delete refs[key as keyof typeof refs];
    } else {
      refs[key as keyof typeof refs] = value;
    }
  }
  return {
    schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1',
    intent: options.intent,
    providerId: options.readiness.providerId,
    status: options.status,
    refs,
    readiness: options.readiness,
    blockedReason: options.status === 'ready' ? undefined : options.blockedReason,
    providerExecuted: true,
    mutatingActionExecuted: false,
    rawPayloadWritten: false,
  };
}
