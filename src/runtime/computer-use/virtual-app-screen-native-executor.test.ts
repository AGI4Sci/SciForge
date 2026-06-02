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
      const expectedCalls = lifecycleIntents.slice(0, lifecycleIntents.indexOf(blockedIntent) + 1);

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
    assert.equal(result.evidence.affectsPhysicalDisplay, false);
    assert.equal(result.evidence.requiresFocusSteal, false);
    assert.equal(result.evidence.sharedSystemInputUsed, false);
    assert.equal(result.evidence.systemPointerMoved, false);
    assert.equal(result.evidence.systemKeyboardEventsSent, false);
    assert.equal(result.refs.sessionRef, 'computer-use:session/native-executor-test/session.json');
    assert.equal(result.refs.targetWindowRef, 'window:native-executor-test/vscode/main');
    assert.equal(result.refs.liveSurfaceRef, 'computer-use:session/native-executor-test/live-surface.json');
    assert.equal(result.refs.surfaceTransportRef, '.sciforge/vision-runs/native-executor-test/virtual-display-provider/surface-transport.json');
    assert.equal(result.refs.frameStreamRef, 'computer-use:session/native-executor-test/frame-stream.json');
    assert.equal(result.refs.currentFrameRef, 'computer-use:session/native-executor-test/frames/current.png');
    assert.equal(result.refs.frameTransportContractRef, '.sciforge/vision-runs/native-executor-test/virtual-display-provider/frame-transport-contract.json');
    assert.equal(result.refs.adapterReadinessRef, '.sciforge/vision-runs/native-executor-test/virtual-display-provider/adapter-readiness.json');
    assert.equal(result.refs.evidenceLedgerRef, '.sciforge/vision-runs/native-executor-test/virtual-display-provider/evidence-ledger.json');
    assert.equal(result.refs.guiPresentRef, 'gui.present:native-executor-test/screen-pane');
    assert.equal(result.refs.liveBindingAttachGrantRef, 'computer-use:provider-session/virtual-app-screen-native-executor-test-screen-computer-use-session-native-execu/live-binding-attach-grant.json');
    assert.equal(result.evidence.surfaceTransport?.transport, 'webrtc');
    assert.equal(result.evidence.surfaceTransport?.surfaceTransportRef, '.sciforge/vision-runs/native-executor-test/virtual-display-provider/surface-transport.json');
    assert.equal(result.evidence.surfaceTransport?.currentFrameSequence, 7);
    assert.deepEqual(result.evidence.evidenceRefs, [
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/adapter-readiness.json',
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/lifecycle-ledger.json#createSession',
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/lifecycle-ledger.json#launchApp',
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/lifecycle-ledger.json#attachSurface',
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/surface-transport.json',
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/frame-transport-contract.json',
      'computer-use:session/native-executor-test/frames/current.png',
      '.sciforge/vision-runs/native-executor-test/virtual-display-provider/evidence-ledger.json',
      'gui.present:native-executor-test/screen-pane',
      'computer-use:provider-session/virtual-app-screen-native-executor-test-screen-computer-use-session-native-execu/owner.json',
      'computer-use:provider-session/virtual-app-screen-native-executor-test-screen-computer-use-session-native-execu/reconnect.json',
      'computer-use:provider-session/virtual-app-screen-native-executor-test-screen-computer-use-session-native-execu/live-binding-attach-grant.json',
    ]);
    assert.equal(data.status, 'ready');
    assert.equal(data.attachState, 'attached');
    assert.equal(data.surfaceMode, 'live');
    assert.equal(data.surfaceTransport, 'webrtc');
    assert.equal(data.liveBindingAttachGrantRef, result.refs.liveBindingAttachGrantRef);
    assert.deepEqual(data.frameTransport, {
      ref: '.sciforge/vision-runs/native-executor-test/virtual-display-provider/frame-transport-contract.json',
      transport: 'webrtc',
      diagnosticOnly: false,
      sequence: 7,
    });
    assert.equal(data.currentFrameRef, 'computer-use:session/native-executor-test/frames/current.png');
  } finally {
    unregister();
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

      assert.deepEqual(calls, ['probe', 'createSession', 'launchApp', 'attachSurface', 'readFrame']);
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

      assert.deepEqual(calls, ['probe', 'createSession', 'launchApp', 'attachSurface', 'readFrame']);
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

  assert.deepEqual(calls, ['probe', 'createSession', 'launchApp', 'attachSurface', 'readFrame']);
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

function parsedAttachCommand() {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--profile "vscode-editor"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--screen-ref "virtual-app-screen:native-executor-test/screen"',
    '--activation-ref "computer-use:native-executor-test/attach-request.json"',
    '--adapter-readiness-ref "computer-use:native-executor-test/provider-readiness.json"',
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
}): VirtualDisplayProviderL1Contract {
  const call = (intent: VirtualDisplayProviderInvokeIntent) => (_operationOptions?: VirtualDisplayProviderOperationOptions) => {
    options.calls.push(intent);
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
