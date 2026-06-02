import assert from 'node:assert/strict';
import test from 'node:test';

import { parseVirtualScreenInputIntentCommand } from './input-intent-command.js';
import {
  createVirtualAppScreenInputRuntimeProviderExecutor,
  registerVirtualAppScreenInputRuntimeProviderExecutor,
  resetVirtualAppScreenInputRuntimeExecutorsForTests,
  runVirtualAppScreenInputRuntime,
  tryRunVirtualAppScreenInputRuntimeNativeHost,
} from './virtual-app-screen-input-runtime.js';
import { parseVirtualAppScreenRuntimeCommand } from './virtual-app-screen-command.js';
import {
  recordVirtualAppScreenProviderSession,
  resetVirtualAppScreenProviderSessionStoreForTests,
} from './virtual-app-screen-provider-session-store.js';
import {
  recordVirtualAppScreenNativeHostSession,
  resetVirtualAppScreenNativeHostSessionStoreForTests,
} from './virtual-app-screen-native-host-session-store.js';
import {
  buildVirtualDisplaySurfaceTransportDescriptor,
  createVirtualDisplayProviderContract,
  probeVirtualDisplayProviders,
  type VirtualDisplayProviderInvokeIntent,
  type VirtualDisplayProviderInvokeResult,
  type VirtualDisplayProviderL1Contract,
  type VirtualDisplayProviderOperationOptions,
  type VirtualDisplayProviderReadinessStatus,
  type VirtualDisplayReadiness,
} from './virtual-display-provider.js';
import {
  ContractSmokeNativeHostPlatformAdapter,
  InMemoryNativeVirtualAppScreenHost,
} from '../../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';

test('VirtualAppScreen input runtime executes canvas input through a provider executor with bounded evidence refs', async () => {
  const command = parsedCanvasInputCommand();
  const calls: string[] = [];
  const provider = fakeProvider({ calls, readiness: readyReadiness() });
  const unregister = registerVirtualAppScreenInputRuntimeProviderExecutor({
    executorId: 'input-runtime:provider-test',
    providerId: 'provider:input-runtime-test',
    provider,
  });
  try {
    const result = await runVirtualAppScreenInputRuntime(command);

    assert.deepEqual(calls, ['probe', 'sendInputIntent']);
    assert.equal(result.status, 'executed');
    assert.equal(result.executorId, 'input-runtime:provider-test');
    assert.equal(result.evidence.providerExecuted, true);
    assert.equal(result.evidence.mutatingActionExecuted, true);
    assert.equal(result.evidence.beforeAfterFrameMaterialized, true);
    assert.deepEqual(result.routeDecision.providerOperations, ['probe', 'sendInputIntent']);
    assert.deepEqual(result.routeDecision.inputIntentRefs, ['computer-use:session/input-runtime-test/input-intents/click.json']);
    assert.deepEqual(result.routeDecision.executorEventRefs, ['computer-use:session/input-runtime-test/executor-events/click.json']);
    assert.deepEqual(result.routeDecision.beforeAfterFrameRefs, ['computer-use:session/input-runtime-test/before-after/click.json']);
    assert.deepEqual(result.routeDecision.verificationRefs, ['computer-use:session/input-runtime-test/verification/click.json']);

    const data = result.virtualScreenData;
    assert.equal(data.status, 'ready');
    assert.equal(data.attachState, 'observe-only');
    assert.equal(data.surfaceMode, 'replay');
    assert.equal(data.sessionRef, 'computer-use:session/input-runtime-test/session.json');
    assert.equal(data.currentFrameRef, 'computer-use:session/input-runtime-test/frames/after.png');
    assert.equal(data.beforeFrameRef, 'computer-use:session/input-runtime-test/frames/before.png');
    assert.equal(data.afterFrameRef, 'computer-use:session/input-runtime-test/frames/after.png');
    assert.equal((data.isolationFlags as Record<string, unknown>).providerExecuted, true);
    assert.equal((data.runSummary as Record<string, unknown>).providerExecuted, true);
  } finally {
    unregister();
    resetVirtualAppScreenInputRuntimeExecutorsForTests();
  }
});

test('VirtualAppScreen input runtime executes canvas input through a recorded Native Host binding', async () => {
  const fixture = nativeHostInputFixture();
  try {
    const result = await tryRunVirtualAppScreenInputRuntimeNativeHost(fixture.command, {
      executorId: 'input-runtime:native-host-test',
      providerId: 'native-virtual-app-screen-host',
    });

    assert.ok(result);
    assert.equal(result.status, 'executed');
    assert.equal(result.executorId, 'input-runtime:native-host-test');
    assert.equal(result.providerId, 'native-virtual-app-screen-host');
    assert.deepEqual(result.routeDecision.providerOperations, ['sendInputIntent', 'readFrame']);
    assert.equal(result.evidence.providerExecuted, true);
    assert.equal(result.evidence.mutatingActionExecuted, true);
    assert.match(String(result.routeDecision.evidenceLedgerRef), /^computer-use:native-host\/ledgers\//);
    assert.equal(result.virtualScreenData.evidenceLedgerRef, fixture.evidenceLedgerRef);
    assert.equal((result.virtualScreenData.runSummary as Record<string, unknown>).completionEligible, false);

    const ledger = fixture.host.getLedger(fixture.sessionId);
    assert.ok(ledger);
    assert.equal(ledger.entries.some((entry) => entry.type === 'human-input.accepted'), true);
    assert.equal(ledger.entries.filter((entry) => entry.type === 'frame.read').length, 2);
    const inputIntentRefs = result.routeDecision.inputIntentRefs as string[];
    assert.equal(ledger.entries.at(-2)?.refs.inputIntentRef, inputIntentRefs[0]);
  } finally {
    resetVirtualAppScreenProviderSessionStoreForTests();
    resetVirtualAppScreenNativeHostSessionStoreForTests();
  }
});

test('VirtualAppScreen input runtime rejects projection-only provider contracts', async () => {
  const command = parsedCanvasInputCommand();
  const executor = createVirtualAppScreenInputRuntimeProviderExecutor({
    executorId: 'input-runtime:projection-only-test',
    providerId: 'provider:projection-only-test',
    provider: createVirtualDisplayProviderContract({
      runId: 'input-runtime-projection-only-test',
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

  const result = await runVirtualAppScreenInputRuntime(command, { executors: [executor] });

  assert.equal(result.status, 'blocked');
  assert.match(result.message, /provider execution evidence/);
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.routeDecision.providerExecuted, false);
  assert.equal(result.virtualScreenData.status, 'blocked');
});

test('VirtualAppScreen input runtime maps lease controls to provider lifecycle operations', async (t) => {
  const cases = [
    { kind: 'takeover', expectedCalls: ['probe', 'pause'], controlRefField: 'takeoverRef', agentQueueStatus: 'paused' },
    { kind: 'pause-agent', expectedCalls: ['probe', 'pause'], controlRefField: 'pauseRef', agentQueueStatus: 'paused' },
    { kind: 'resume-agent', expectedCalls: ['probe', 'resume', 'readFrame'], controlRefField: 'resumeRef', agentQueueStatus: 'resume-after-current-frame' },
    { kind: 'stop-session', expectedCalls: ['probe', 'closeSession'], controlRefField: 'stopRef', agentQueueStatus: 'paused-for-safe-stop' },
  ] as const;

  for (const testCase of cases) {
    await t.test(testCase.kind, async () => {
      const command = parsedControlInputCommand(testCase.kind);
      const calls: string[] = [];
      const provider = fakeProvider({ calls, readiness: readyReadiness() });
      const executor = createVirtualAppScreenInputRuntimeProviderExecutor({
        executorId: `input-runtime:${testCase.kind}-test`,
        providerId: `provider:${testCase.kind}-test`,
        provider,
      });

      const result = await runVirtualAppScreenInputRuntime(command, { executors: [executor] });

      assert.deepEqual(calls, testCase.expectedCalls);
      assert.equal(result.status, 'executed');
      assert.equal(result.evidence.providerExecuted, true);
      assert.equal(result.routeDecision.controlKind, testCase.kind);
      assert.equal(result.routeDecision.agentQueueRef, 'computer-use:session/input-runtime-test/agent-queue/control.json');
      assert.equal(result.routeDecision.agentQueueStatus, testCase.agentQueueStatus);
      const controlPlanePolicy = result.routeDecision.controlPlanePolicy as Record<string, unknown>;
      assert.equal(controlPlanePolicy.agentQueueStatus, testCase.agentQueueStatus);
      assert.equal(controlPlanePolicy.closesUserRealApp, false);
      assert.equal(controlPlanePolicy.physicalDesktopInputAllowed, false);
      assert.equal(controlPlanePolicy.safeStopMode, testCase.kind === 'stop-session' ? 'safe-close-or-pause-virtual-session-only' : undefined);
      assert.equal(result.routeDecision.closesUserRealApp, false);
      assert.equal(result.virtualScreenData[testCase.controlRefField], `computer-use:session/input-runtime-test/leases/${testCase.kind}.json`);
      assert.equal(result.virtualScreenData.agentQueueRef, result.routeDecision.agentQueueRef);
      assert.deepEqual((result.virtualScreenData.runSummary as Record<string, unknown>).controlPlanePolicy, controlPlanePolicy);
      assert.equal((result.virtualScreenData.runSummary as Record<string, unknown>).closesUserRealApp, false);
      if (testCase.kind === 'resume-agent') {
        assert.equal(result.routeDecision.currentFrameRefreshRef, 'computer-use:session/input-runtime-test/frames/current-frame-refresh.json');
        assert.equal(result.routeDecision.currentFrameRef, 'computer-use:session/input-runtime-test/frames/after.png');
        assert.equal(result.virtualScreenData.currentFrameRefreshRef, result.routeDecision.currentFrameRefreshRef);
      } else {
        assert.equal(result.routeDecision.currentFrameRefreshRef, undefined);
      }
      if (testCase.kind === 'stop-session') {
        assert.equal(result.routeDecision.safeStopRef, 'computer-use:session/input-runtime-test/safe-stop/stop-session.json');
        assert.equal(result.routeDecision.safeStopMode, 'safe-close-or-pause-virtual-session-only');
        assert.equal(result.virtualScreenData.safeStopRef, result.routeDecision.safeStopRef);
      } else {
        assert.equal(result.routeDecision.safeStopRef, undefined);
      }
    });
  }
});

test('VirtualAppScreen input runtime fails closed when provider evidence is incomplete', async () => {
  const command = parsedCanvasInputCommand();
  const calls: string[] = [];
  const provider = fakeProvider({
    calls,
    readiness: readyReadiness(),
    omitRefsByIntent: {
      probe: ['beforeFrameRef', 'afterFrameRef', 'beforeAfterFrameRefs'],
      sendInputIntent: ['beforeAfterFrameRefs'],
    },
  });
  const executor = createVirtualAppScreenInputRuntimeProviderExecutor({
    executorId: 'input-runtime:missing-evidence-test',
    providerId: 'provider:missing-evidence-test',
    provider,
  });

  const result = await runVirtualAppScreenInputRuntime(command, { executors: [executor] });

  assert.deepEqual(calls, ['probe', 'sendInputIntent']);
  assert.equal(result.status, 'blocked-no-provider');
  assert.match(result.message, /before\/after\/beforeAfterFrameRefs/);
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.virtualScreenData.status, 'blocked');
});

test('VirtualAppScreen input runtime fails closed when provider omits current-session refs from executed evidence', async (t) => {
  const cases: Array<{
    name: string;
    expectedReason: RegExp;
    omitRefsByIntent?: Partial<Record<VirtualDisplayProviderInvokeIntent, string[]>>;
    overrideRefsByIntent?: Partial<Record<VirtualDisplayProviderInvokeIntent, Record<string, string | undefined>>>;
  }> = [
    {
      name: 'sendInputIntent sessionRef missing',
      expectedReason: /sendInputIntent\.sessionRef was missing|provider sessionRef was missing/,
      omitRefsByIntent: {
        sendInputIntent: ['sessionRef'],
      },
    },
    {
      name: 'sendInputIntent inputLeaseRef missing',
      expectedReason: /sendInputIntent\.inputLeaseRef was missing|provider inputLeaseRef was missing/,
      omitRefsByIntent: {
        sendInputIntent: ['inputLeaseRef'],
      },
    },
    {
      name: 'sendInputIntent sessionRef stale',
      expectedReason: /sessionRef did not match/,
      overrideRefsByIntent: {
        sendInputIntent: {
          sessionRef: 'computer-use:session/stale/session.json',
        },
      },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const command = parsedCanvasInputCommand();
      const calls: string[] = [];
      const provider = fakeProvider({
        calls,
        readiness: readyReadiness(),
        omitRefsByIntent: testCase.omitRefsByIntent,
        overrideRefsByIntent: testCase.overrideRefsByIntent,
      });
      const executor = createVirtualAppScreenInputRuntimeProviderExecutor({
        executorId: `input-runtime:${testCase.name}-current-session-test`,
        providerId: `provider:${testCase.name}-current-session-test`,
        provider,
      });

      const result = await runVirtualAppScreenInputRuntime(command, { executors: [executor] });

      assert.deepEqual(calls, ['probe', 'sendInputIntent']);
      assert.equal(result.status, 'blocked-no-provider');
      assert.match(result.message, testCase.expectedReason);
      assert.equal(result.evidence.providerExecuted, false);
      assert.equal(result.routeDecision.providerExecuted, false);
    });
  }
});

test('VirtualAppScreen resume fails closed when refreshed frame belongs to another session', async () => {
  const command = parsedControlInputCommand('resume-agent');
  const calls: string[] = [];
  const provider = fakeProvider({
    calls,
    readiness: readyReadiness(),
    overrideRefsByIntent: {
      readFrame: {
        sessionRef: 'computer-use:session/stale/session.json',
      },
    },
  });
  const executor = createVirtualAppScreenInputRuntimeProviderExecutor({
    executorId: 'input-runtime:resume-stale-frame-session-test',
    providerId: 'provider:resume-stale-frame-session-test',
    provider,
  });

  const result = await runVirtualAppScreenInputRuntime(command, { executors: [executor] });

  assert.deepEqual(calls, ['probe', 'resume', 'readFrame']);
  assert.equal(result.status, 'blocked-no-provider');
  assert.match(result.message, /readFrame\.sessionRef did not match command\.sessionRef/);
  assert.equal(result.evidence.providerExecuted, false);
});

test('VirtualAppScreen control runtime fails closed without agent queue evidence', async () => {
  const command = parsedControlInputCommand('takeover');
  const calls: string[] = [];
  const provider = fakeProvider({
    calls,
    readiness: readyReadiness(),
    omitRefsByIntent: {
      pause: ['agentQueueRef'],
    },
  });
  const executor = createVirtualAppScreenInputRuntimeProviderExecutor({
    executorId: 'input-runtime:missing-agent-queue-test',
    providerId: 'provider:missing-agent-queue-test',
    provider,
  });

  const result = await runVirtualAppScreenInputRuntime(command, { executors: [executor] });

  assert.deepEqual(calls, ['probe', 'pause']);
  assert.equal(result.status, 'blocked-no-provider');
  assert.match(result.message, /agentQueueRef/);
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.routeDecision.agentQueueStatus, 'paused');
  assert.match(String(result.routeDecision.agentQueueRef), /control-plane\/takeover\/agent-queue\.json$/);
});

test('VirtualAppScreen resume fails closed without current frame refresh evidence', async () => {
  const command = parsedControlInputCommand('resume-agent');
  const calls: string[] = [];
  const provider = fakeProvider({
    calls,
    readiness: readyReadiness(),
    omitRefsByIntent: {
      resume: ['currentFrameRefreshRef'],
      readFrame: ['currentFrameRefreshRef'],
    },
  });
  const executor = createVirtualAppScreenInputRuntimeProviderExecutor({
    executorId: 'input-runtime:missing-current-frame-refresh-test',
    providerId: 'provider:missing-current-frame-refresh-test',
    provider,
  });

  const result = await runVirtualAppScreenInputRuntime(command, { executors: [executor] });

  assert.deepEqual(calls, ['probe', 'resume', 'readFrame']);
  assert.equal(result.status, 'blocked-no-provider');
  assert.match(result.message, /currentFrameRefreshRef/);
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.routeDecision.resumeRequiresCurrentFrame, true);
});

test('VirtualAppScreen stop fails closed without safe stop evidence', async () => {
  const command = parsedControlInputCommand('stop-session');
  const calls: string[] = [];
  const provider = fakeProvider({
    calls,
    readiness: readyReadiness(),
    omitRefsByIntent: {
      closeSession: ['safeStopRef'],
    },
  });
  const executor = createVirtualAppScreenInputRuntimeProviderExecutor({
    executorId: 'input-runtime:missing-safe-stop-test',
    providerId: 'provider:missing-safe-stop-test',
    provider,
  });

  const result = await runVirtualAppScreenInputRuntime(command, { executors: [executor] });

  assert.deepEqual(calls, ['probe', 'closeSession']);
  assert.equal(result.status, 'blocked-no-provider');
  assert.match(result.message, /safeStopRef/);
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.routeDecision.safeStopMode, 'safe-close-or-pause-virtual-session-only');
  assert.equal(result.routeDecision.closesUserRealApp, false);
});

function nativeHostInputFixture() {
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const created = host.createSession(
    { profileId: 'native-host-input-runtime', defaultSurfaceTransport: 'native-frame-stream' },
    { allowBackgroundRendering: true, allowSharedSystemInput: false },
    {
      currentRunRef: 'computer-use:run/native-host-input-runtime/current-run.json',
      evidenceRootRef: 'computer-use:run/native-host-input-runtime/evidence',
      guiPresentRef: 'gui.present:native-host-input-runtime/screen-pane',
    },
  );
  assert.equal(created.status, 'ok');
  assert.equal(host.launchOrAttachApp(created.value.sessionId, {
    appId: 'contract-smoke',
    appRef: 'app:contract-smoke',
  }).status, 'ok');
  const attached = host.attachSurface(created.value.sessionId, {
    screenRef: 'virtual-app-screen:native-host-input-runtime/screen',
    targetWindowRef: 'window:native-host-input-runtime/main',
    transport: 'native-frame-stream',
  });
  assert.equal(attached.status, 'ok');
  const presented = host.presentSurface(created.value.sessionId, attached.value.liveBindingAttachGrantRef);
  assert.equal(presented.status, 'ok');
  const firstFrame = host.readFrame(created.value.sessionId);
  assert.equal(firstFrame.status, 'ok');

  const inputLeaseRef = 'computer-use:native-host/input-runtime/leases/active.json';
  const actionAdapterRef = 'computer-use:native-host/input-runtime/adapters/contract-smoke.json';
  const evidenceLedgerRef = created.value.ledgerRef;
  const command = parsedNativeHostCanvasInputCommand({
    sessionRef: created.value.sessionRef,
    screenRef: attached.value.screenRef,
    targetAppRef: 'app:contract-smoke',
    targetWindowRef: attached.value.targetWindowRef,
    frameRef: firstFrame.value.frameRef,
    inputLeaseRef,
    actionAdapterRef,
    adapterReadinessRef: created.value.readiness.adapterReadinessRef,
    evidenceLedgerRef,
  });

  recordVirtualAppScreenNativeHostSession({
    host,
    session: created.value,
    surface: attached.value,
    frame: firstFrame.value,
    refs: {
      inputLeaseRef,
      actionAdapterRef,
      adapterReadinessRef: created.value.readiness.adapterReadinessRef,
      evidenceLedgerRef,
      grantValidationRef: presented.value.validationLedgerEntryRef,
    },
  });
  recordVirtualAppScreenProviderSession(parsedNativeHostAttachCommand({
    screenRef: attached.value.screenRef,
    targetAppRef: 'app:contract-smoke',
    adapterReadinessRef: created.value.readiness.adapterReadinessRef,
    evidenceLedgerRef,
  }), {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-session-manager.v1',
    status: 'attached',
    executorId: 'native-session-manager:native-host-input-runtime-test',
    providerId: 'native-virtual-app-screen-host',
    refs: {
      currentRunRef: created.value.evidenceContext.currentRunRef,
      sessionRef: created.value.sessionRef,
      liveSurfaceRef: attached.value.liveSurfaceRef,
      surfaceTransportRef: attached.value.surfaceTransportRef,
      frameStreamRef: attached.value.frameStreamRef,
      currentFrameRef: firstFrame.value.frameRef,
      frameTransportContractRef: attached.value.frameTransportContractRef,
      frameTelemetryRef: attached.value.frameTelemetryRef,
      mediaChannelRef: attached.value.mediaChannelRef,
      dataChannelRef: attached.value.dataChannelRef,
      liveBindingAttachGrantRef: attached.value.liveBindingAttachGrantRef,
      grantValidationRef: presented.value.validationLedgerEntryRef,
      surfaceOwnerRef: attached.value.surfaceOwnerRef,
      displayOwnerRef: attached.value.displayOwnerRef,
      screenRef: attached.value.screenRef,
      targetAppRef: 'app:contract-smoke',
      targetWindowRef: attached.value.targetWindowRef,
      inputLeaseRef,
      actionAdapterRef,
      adapterReadinessRef: created.value.readiness.adapterReadinessRef,
      evidenceLedgerRef,
      guiPresentRef: created.value.evidenceContext.guiPresentRef,
    },
    evidence: {
      providerExecuted: true,
      mutatingActionExecuted: false,
      nativeSessionCreated: true,
      liveFrameAttached: true,
      currentFrameMaterialized: true,
      guiPresented: true,
      isolationVerified: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      surfaceTransport: buildVirtualDisplaySurfaceTransportDescriptor({
        providerId: 'native-virtual-app-screen-host',
        transport: 'native-frame-stream',
        surfaceTransportRef: attached.value.surfaceTransportRef,
        liveSurfaceRef: attached.value.liveSurfaceRef,
        frameStreamRef: attached.value.frameStreamRef,
        currentFrameRef: firstFrame.value.frameRef,
        frameTransportContractRef: attached.value.frameTransportContractRef!,
        frameTelemetryRef: attached.value.frameTelemetryRef,
        mediaChannelRef: attached.value.mediaChannelRef,
        dataChannelRef: attached.value.dataChannelRef,
        currentFrameSequence: firstFrame.value.frameSequence,
      }),
      evidenceRefs: [
        attached.value.liveBindingAttachGrantRef,
        presented.value.validationLedgerEntryRef!,
        evidenceLedgerRef,
        firstFrame.value.frameRef,
      ],
    },
  });

  return {
    host,
    sessionId: created.value.sessionId,
    command,
    evidenceLedgerRef,
  };
}

function parsedCanvasInputCommand() {
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-canvas',
    '--kind click',
    '--session-ref "computer-use:session/input-runtime-test/session.json"',
    '--screen-ref "virtual-app-screen:input-runtime-test/screen"',
    '--target-app-ref "app:profile/vscode"',
    '--target-window-ref "window:input-runtime-test/main"',
    '--frame-ref "computer-use:session/input-runtime-test/frames/current.png"',
    '--input-lease-ref "computer-use:session/input-runtime-test/leases/active.json"',
    '--action-adapter-ref "computer-use:session/input-runtime-test/adapters/native-window.json"',
    '--adapter-readiness-ref "computer-use:session/input-runtime-test/readiness/native-window.json"',
    '--evidence-ledger-ref "computer-use:session/input-runtime-test/evidence-ledger.json"',
    '--frame-width 1440',
    '--frame-height 900',
    '--x-ratio 0.125',
    '--y-ratio 0.5',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed input command');
  return parsed.command;
}

function parsedNativeHostAttachCommand(refs: {
  screenRef: string;
  targetAppRef: string;
  adapterReadinessRef: string;
  evidenceLedgerRef: string;
}) {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--profile "contract-smoke"',
    `--target-app-ref "${refs.targetAppRef}"`,
    `--screen-ref "${refs.screenRef}"`,
    '--activation-ref "computer-use:native-host/input-runtime/activation.json"',
    `--adapter-readiness-ref "${refs.adapterReadinessRef}"`,
    `--evidence-ledger-ref "${refs.evidenceLedgerRef}"`,
    '--gui-present-ref "gui.present:native-host-input-runtime/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed attach command');
  return parsed.command;
}

function parsedNativeHostCanvasInputCommand(refs: {
  sessionRef: string;
  screenRef: string;
  targetAppRef: string;
  targetWindowRef: string;
  frameRef: string;
  inputLeaseRef: string;
  actionAdapterRef: string;
  adapterReadinessRef: string;
  evidenceLedgerRef: string;
}) {
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-canvas',
    '--kind click',
    `--session-ref "${refs.sessionRef}"`,
    `--screen-ref "${refs.screenRef}"`,
    `--target-app-ref "${refs.targetAppRef}"`,
    `--target-window-ref "${refs.targetWindowRef}"`,
    `--frame-ref "${refs.frameRef}"`,
    `--input-lease-ref "${refs.inputLeaseRef}"`,
    `--action-adapter-ref "${refs.actionAdapterRef}"`,
    `--adapter-readiness-ref "${refs.adapterReadinessRef}"`,
    `--evidence-ledger-ref "${refs.evidenceLedgerRef}"`,
    '--frame-width 1440',
    '--frame-height 900',
    '--x-ratio 0.125',
    '--y-ratio 0.5',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed input command');
  return parsed.command;
}

function parsedControlInputCommand(kind: 'takeover' | 'pause-agent' | 'resume-agent' | 'stop-session') {
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-control',
    `--kind ${kind}`,
    '--session-ref "computer-use:session/input-runtime-test/session.json"',
    '--screen-ref "virtual-app-screen:input-runtime-test/screen"',
    '--target-app-ref "app:profile/vscode"',
    '--target-window-ref "window:input-runtime-test/main"',
    '--input-lease-ref "computer-use:session/input-runtime-test/leases/active.json"',
    '--user-lease-ref "computer-use:session/input-runtime-test/leases/user.json"',
    '--agent-lease-ref "computer-use:session/input-runtime-test/leases/agent.json"',
    '--active-lease-owner-ref "computer-use:session/input-runtime-test/leases/owner-agent.json"',
    '--active-lease-owner-role agent',
    `--lease-control-ref "computer-use:session/input-runtime-test/leases/${kind}.json"`,
    '--action-adapter-ref "computer-use:session/input-runtime-test/adapters/native-window.json"',
    '--adapter-readiness-ref "computer-use:session/input-runtime-test/readiness/native-window.json"',
    '--evidence-ledger-ref "computer-use:session/input-runtime-test/evidence-ledger.json"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed input command');
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
  const refs: Record<string, string | string[] | undefined> = {
    currentRunRef: '.sciforge/vision-runs/input-runtime-test/current-run.json',
    adapterReadinessRef: '.sciforge/vision-runs/input-runtime-test/virtual-display-provider/adapter-readiness.json',
    blockedRef: options.status === 'ready' ? undefined : '.sciforge/vision-runs/input-runtime-test/virtual-display-provider/blocked.json',
    sessionRef: 'computer-use:session/input-runtime-test/session.json',
    inputLeaseRef: 'computer-use:session/input-runtime-test/leases/active.json',
    actionAdapterRef: 'computer-use:session/input-runtime-test/adapters/native-window.json',
    evidenceLedgerRef: 'computer-use:session/input-runtime-test/evidence-ledger.json',
    currentFrameRef: 'computer-use:session/input-runtime-test/frames/after.png',
    beforeFrameRef: 'computer-use:session/input-runtime-test/frames/before.png',
    afterFrameRef: 'computer-use:session/input-runtime-test/frames/after.png',
    beforeAfterFrameRefs: ['computer-use:session/input-runtime-test/before-after/click.json'],
    inputIntentRefs: ['computer-use:session/input-runtime-test/input-intents/click.json'],
    executorEventRefs: ['computer-use:session/input-runtime-test/executor-events/click.json'],
    verificationRefs: ['computer-use:session/input-runtime-test/verification/click.json'],
  };
  if (options.intent === 'pause' || options.intent === 'resume' || options.intent === 'closeSession') {
    refs.agentQueueRef = 'computer-use:session/input-runtime-test/agent-queue/control.json';
  }
  if (options.intent === 'resume' || options.intent === 'readFrame') {
    refs.currentFrameRefreshRef = 'computer-use:session/input-runtime-test/frames/current-frame-refresh.json';
  }
  if (options.intent === 'closeSession') {
    refs.safeStopRef = 'computer-use:session/input-runtime-test/safe-stop/stop-session.json';
  }
  for (const key of options.omitRefs) {
    delete refs[key];
  }
  for (const [key, value] of Object.entries(options.overrideRefs)) {
    if (value === undefined) {
      delete refs[key];
    } else {
      refs[key] = value;
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
    mutatingActionExecuted: options.intent !== 'probe',
    rawPayloadWritten: false,
  };
}
