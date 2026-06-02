import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  parseVirtualAppScreenRuntimeCommand,
  virtualAppScreenRuntimeCommandRunId,
} from '../virtual-app-screen-command.js';
import {
  createVirtualAppScreenNativeExecutor,
} from '../virtual-app-screen-native-executor.js';
import {
  LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
  createLinuxXpraVirtualDisplayProvider,
} from './linux-xpra-virtual-display-provider.js';
import {
  createLinuxXpraVirtualDisplayDriverHooks,
  type LinuxXpraVirtualDisplayDriverDependencies,
} from './linux-xpra-virtual-display-driver.js';
import {
  nativeDriverInputControlDefaultRefs,
  type NativeVirtualDisplayDriverInputControlContext,
} from './native-driver-input-control.js';

test('Linux Xpra opt-in driver hooks can drive native attach with Host-backed refs', async () => {
  const writes: Array<{ ref: string; data: unknown }> = [];
  const deps = fakeDriverDependencies({ writes });
  const provider = createLinuxXpraVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createLinuxXpraVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      outDir: '/tmp/sciforge-linux-xpra-driver-test',
      dependencies: deps,
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:linux-xpra-opt-in-driver-test',
    providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });

  const command = parsedAttachCommand();
  const result = await executor.attach(command);
  const runId = virtualAppScreenRuntimeCommandRunId(command);
  const providerRoot = `.sciforge/vision-runs/${runId}/virtual-display-provider`;

  assert.equal(result.status, 'attached');
  assert.equal(result.providerId, LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID);
  assert.equal(result.evidence.providerExecuted, true);
  assert.equal(result.refs.targetWindowRef, `window:${runId}/generic-editor/main`);
  assertNativeHostAttachRefs(result, LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID);
  assertProviderEvidenceRefs(result.evidence.evidenceRefs, providerRoot);
  assertProviderWrites(writes, providerRoot, `window:${runId}/generic-editor/main`);
});

test('Linux Xpra opt-in driver readFrame stays anchored to attached session refs across operation run ids', async () => {
  const captureRunDirRefs: string[] = [];
  const provider = createLinuxXpraVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createLinuxXpraVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        captureSessionFrame: (input) => {
          captureRunDirRefs.push(input.runDirRef);
          return {
            frameRef: `${input.runDirRef}/virtual-display-provider/frames/current.json`,
            screenshotRef: `${input.runDirRef}/virtual-display-provider/frames/current.png`,
            frameRecord: {
              schemaVersion: 'sciforge.computer-use.screen-frame.v1',
              providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
              screenshotBytes: 2048,
              currentRunOnly: true,
            },
          };
        },
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:linux-xpra-readframe-current-session-test',
    providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  assert.match(requiredString(attachResult.refs.sessionRef), /^computer-use:native-host\/sessions\//u);
  const providerRoot = providerRootFromEvidenceRefs(attachResult.evidence.evidenceRefs);
  const attachedRunDir = providerRoot.replace(/\/virtual-display-provider$/u, '');

  const readFrame = await provider.readFrame({
    runId: 'linux-xpra-driver-readframe-other-run',
    targetAppKind: 'generic-editor',
  });

  assert.equal(readFrame.status, 'ready');
  assert.equal(readFrame.refs.currentFrameRef, `${providerRoot}/frames/current.json`);
  assert.equal(readFrame.refs.currentScreenshotRef, `${providerRoot}/frames/current.png`);
  assert.equal(readFrame.refs.currentFrameSequence, '2');
  assert.equal(captureRunDirRefs[captureRunDirRefs.length - 1], attachedRunDir);
  assert.notEqual(captureRunDirRefs[captureRunDirRefs.length - 1], '.sciforge/vision-runs/linux-xpra-driver-readframe-other-run');
});

test('Linux Xpra opt-in driver exposes provider-owned input and control hook evidence refs', async () => {
  const deps = fakeDriverDependencies({
    sendInputIntent: (context) => ({ ok: true, refs: inputControlRefs(context), mutatingActionExecuted: true, providerEvidenceWritten: true }),
    pauseAgentQueue: (context) => ({ ok: true, refs: inputControlRefs(context), mutatingActionExecuted: true, providerEvidenceWritten: true }),
    resumeAgentQueue: (context) => ({ ok: true, refs: inputControlRefs(context), mutatingActionExecuted: true, providerEvidenceWritten: true }),
    safeStopSession: (context) => ({ ok: true, refs: inputControlRefs(context), mutatingActionExecuted: true, providerEvidenceWritten: true }),
  });
  const provider = createLinuxXpraVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createLinuxXpraVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: deps,
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:linux-xpra-input-control-test',
    providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);
  const providerRoot = sessionRef.replace(/\/session\.json$/u, '');

  const sendInput = await provider.sendInputIntent(inputOperationOptions('linux-xpra-driver-input', 'tap', sessionRef));
  const pause = await provider.pause(inputOperationOptions('linux-xpra-driver-pause', 'takeover', sessionRef));
  const resume = await provider.resume(inputOperationOptions('linux-xpra-driver-resume', 'resume-agent', sessionRef));
  const stop = await provider.closeSession(inputOperationOptions('linux-xpra-driver-stop', 'stop-session', sessionRef));

  assert.equal(sendInput.status, 'ready');
  assert.equal(sendInput.providerExecuted, true);
  assert.equal(sendInput.mutatingActionExecuted, true);
  assert.deepEqual(sendInput.refs.inputIntentRefs, [`${providerRoot}/input-intents/sendInputIntent-tap.json`]);
  assert.equal(pause.status, 'ready');
  assert.equal(pause.refs.agentQueueRef, `${providerRoot}/control-plane/pause-takeover/agent-queue.json`);
  assert.equal(resume.status, 'ready');
  assert.equal(resume.refs.currentFrameRefreshRef, `${providerRoot}/control-plane/resume-resume-agent/current-frame-refresh.json`);
  assert.equal(stop.status, 'ready');
  assert.equal(stop.refs.safeStopRef, `${providerRoot}/control-plane/closeSession-stop-session/safe-stop.json`);
});

test('Linux Xpra opt-in driver input hook fails closed without provider-owned evidence refs', async () => {
  const provider = createLinuxXpraVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createLinuxXpraVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        sendInputIntent: () => ({ ok: true, refs: {}, mutatingActionExecuted: true, providerEvidenceWritten: true }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:linux-xpra-input-missing-refs-test',
    providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const result = await provider.sendInputIntent(inputOperationOptions(
    'linux-xpra-driver-input-missing-refs',
    'tap',
    sessionRef,
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /did not return required provider-owned evidence refs/);
  assert.equal(result.mutatingActionExecuted, false);
});

test('Linux Xpra opt-in driver input hook fails closed without evidence-written proof', async () => {
  const provider = createLinuxXpraVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createLinuxXpraVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        sendInputIntent: (context) => ({ ok: true, refs: inputControlRefs(context), mutatingActionExecuted: true }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:linux-xpra-input-no-evidence-written-test',
    providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const result = await provider.sendInputIntent(inputOperationOptions(
    'linux-xpra-driver-input-no-evidence-written',
    'tap',
    sessionRef,
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /providerEvidenceWritten=true/);
  assert.equal(result.mutatingActionExecuted, false);
});

test('Linux Xpra opt-in driver input hook fails closed for a stale session or missing mutation evidence', async () => {
  const provider = createLinuxXpraVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createLinuxXpraVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        sendInputIntent: (context) => ({ ok: true, refs: inputControlRefs(context) }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:linux-xpra-input-stale-session-test',
    providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const staleSession = await provider.sendInputIntent(inputOperationOptions('linux-xpra-driver-input-stale-session', 'tap', 'computer-use:session/stale/session.json'));
  assert.equal(staleSession.status, 'blocked');
  assert.match(staleSession.blockedReason ?? '', /sessionRef does not match/);

  const missingMutation = await provider.sendInputIntent(inputOperationOptions(
    'linux-xpra-driver-input-missing-mutation',
    'tap',
    sessionRef,
  ));
  assert.equal(missingMutation.status, 'blocked');
  assert.match(missingMutation.blockedReason ?? '', /mutatingActionExecuted=true/);
});

test('Linux Xpra opt-in driver probe fails closed when command, capture, or input is missing', async (t) => {
  const cases: Array<{
    name: string;
    deps: Partial<LinuxXpraVirtualDisplayDriverDependencies>;
    reason: RegExp;
  }> = [
    {
      name: 'missing xpra',
      deps: { commandExists: () => false },
      reason: /xpra command is not available/,
    },
    {
      name: 'capture not proven',
      deps: { probeFrameCapture: () => ({ ok: false, detail: 'capture disabled' }) },
      reason: /frame capture is not proven.*capture disabled/,
    },
    {
      name: 'input isolation not proven',
      deps: { probeInputIsolation: () => ({ ok: false, detail: 'at-spi bridge unavailable' }) },
      reason: /isolated input adapter is not proven.*at-spi bridge unavailable/,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const provider = createLinuxXpraVirtualDisplayProvider({
        probeOptions: readyProbeOptions('generic-editor'),
        hooks: createLinuxXpraVirtualDisplayDriverHooks({
          targetApp: { kind: 'generic-editor', command: 'research-editor' },
          probeOptions: readyProbeOptions('generic-editor'),
          dependencies: fakeDriverDependencies(testCase.deps),
        }),
      });

      const result = await provider.probe({ runId: `linux-xpra-driver-${testCase.name}`, targetAppKind: 'generic-editor' });

      assert.equal(result.status, 'blocked');
      assert.equal(result.providerExecuted, true);
      assert.equal(result.rawPayloadWritten, false);
      assert.match(result.blockedReason ?? '', testCase.reason);
      assert.equal(result.refs.sessionRef, `.sciforge/vision-runs/linux-xpra-driver-${testCase.name.replaceAll(' ', '-')}/virtual-display-provider/session.json`);
      assert.equal(result.refs.currentFrameRef, undefined);
    });
  }
});

test('Linux Xpra opt-in driver fails closed when target window is not materialized', async () => {
  const provider = createLinuxXpraVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createLinuxXpraVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        waitForTargetWindow: () => undefined,
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:linux-xpra-driver-no-window-test',
    providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });

  const result = await executor.attach(parsedAttachCommand());

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /could not find a target app window/);
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.refs.liveSurfaceRef, undefined);
  assert.equal(result.refs.currentFrameRef, undefined);
});

test('Linux Xpra opt-in driver fails closed when readFrame capture fails', async () => {
  const provider = createLinuxXpraVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createLinuxXpraVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        captureSessionFrame: () => {
          throw new Error('capture denied');
        },
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:linux-xpra-driver-capture-failed-test',
    providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });

  const result = await executor.attach(parsedAttachCommand());

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /readFrame capture failed/);
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.refs.currentFrameRef, undefined);
});

test('Linux Xpra opt-in driver files stay generic and source-boundary clean', async () => {
  const driverSource = await readFile(fileURLToPath(new URL('./linux-xpra-virtual-display-driver.ts', import.meta.url)), 'utf8');
  const helperSource = await readFile(fileURLToPath(new URL('./linux-xpra-driver-helpers.ts', import.meta.url)), 'utf8');

  for (const source of [driverSource, helperSource]) {
    assert.doesNotMatch(source, /tools\/computer-use-next|virtual-app-screen-vscode-smoke/);
    assert.doesNotMatch(source, /Visual Studio Code\.app|sciforge-vscode-virtual-app-screen-bridge|extensionDevelopmentPath/);
    assert.doesNotMatch(source, /Xvfb|noVNC|RDP|QEMU|serve-web|code-server|OpenVSCode/);
  }
});

function parsedAttachCommand() {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--profile "generic-editor"',
    '--target-app-ref "app:profile/generic-editor"',
    '--screen-ref "virtual-app-screen:linux-xpra-driver-test/screen"',
    '--activation-ref "computer-use:linux-xpra-driver-test/attach-request.json"',
    '--adapter-readiness-ref "computer-use:linux-xpra-driver-test/provider-readiness.json"',
    '--evidence-ledger-ref "ledger:computer-use/linux-xpra-driver-test/screen-activation.json"',
    '--gui-present-ref "gui.present:linux-xpra-driver-test/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

type AttachResultLike = {
  refs: {
    sessionRef?: string | string[];
    liveSurfaceRef?: string | string[];
    surfaceTransportRef?: string | string[];
    frameStreamRef?: string | string[];
    currentFrameRef?: string | string[];
    frameTransportContractRef?: string | string[];
    frameTelemetryRef?: string | string[];
    mediaChannelRef?: string | string[];
    dataChannelRef?: string | string[];
    liveBindingAttachGrantRef?: string | string[];
    grantValidationRef?: string | string[];
    surfaceOwnerRef?: string | string[];
    displayOwnerRef?: string | string[];
    evidenceLedgerRef?: string | string[];
  };
  evidence: {
    surfaceTransport?: {
      owner?: string;
      providerId?: string;
      transport?: string;
      surfaceTransportRef?: string;
      liveSurfaceRef?: string;
      frameStreamRef?: string;
      currentFrameRef?: string;
      frameTransportContractRef?: string;
      frameTelemetryRef?: string;
      mediaChannelRef?: string;
      dataChannelRef?: string;
      currentFrameSequence?: number;
      diagnosticOnly?: boolean;
      productFallback?: boolean;
      singleInteractiveTruth?: boolean;
    };
    evidenceRefs: string[];
  };
};

function assertNativeHostAttachRefs(result: AttachResultLike, providerId: string) {
  assert.match(requiredString(result.refs.sessionRef), /^computer-use:native-host\/sessions\/session-\d+\/session\.json$/u);
  assert.match(requiredString(result.refs.liveSurfaceRef), /^computer-use:native-host\/surfaces\/.+\/live-surface\.json$/u);
  assert.match(requiredString(result.refs.surfaceTransportRef), /^computer-use:native-host\/surfaces\/.+\/surface-transport\.json$/u);
  assert.match(requiredString(result.refs.frameStreamRef), /^computer-use:native-host\/surfaces\/.+\/frame-stream\.json$/u);
  assert.match(requiredString(result.refs.currentFrameRef), /^computer-use:native-host\/frames\/.+\/\d{4}\.png$/u);
  assert.match(requiredString(result.refs.frameTransportContractRef), /^computer-use:native-host\/surfaces\/.+\/frame-transport-contract\.json$/u);
  assert.match(requiredString(result.refs.frameTelemetryRef), /^computer-use:native-host\/surfaces\/.+\/frame-telemetry\.json$/u);
  assert.match(requiredString(result.refs.mediaChannelRef), /^computer-use:native-host\/surfaces\/.+\/webrtc-video-track\/live$/u);
  assert.match(requiredString(result.refs.dataChannelRef), /^computer-use:native-host\/surfaces\/.+\/webrtc-data-channel\/control$/u);
  assert.match(requiredString(result.refs.liveBindingAttachGrantRef), /^computer-use:native-host\/grants\/.+\/live-binding-attach-grant\.json$/u);
  assert.match(requiredString(result.refs.grantValidationRef), /^computer-use:native-host\/ledgers\/session-\d+\/evidence-ledger\.json\/events\/\d+-grant\.validated\.json$/u);
  assert.match(requiredString(result.refs.surfaceOwnerRef), /^computer-use:native-host\/surfaces\/.+\/surface-owner\.json$/u);
  assert.match(requiredString(result.refs.displayOwnerRef), /^computer-use:native-host\/surfaces\/.+\/display-owner\.json$/u);
  assert.match(requiredString(result.refs.evidenceLedgerRef), /^computer-use:native-host\/ledgers\/session-\d+\/evidence-ledger\.json$/u);
  assert.equal(result.evidence.surfaceTransport?.owner, 'VirtualDisplayProvider');
  assert.equal(result.evidence.surfaceTransport?.providerId, providerId);
  assert.equal(result.evidence.surfaceTransport?.transport, 'webrtc');
  assert.equal(result.evidence.surfaceTransport?.diagnosticOnly, false);
  assert.equal(result.evidence.surfaceTransport?.productFallback, false);
  assert.equal(result.evidence.surfaceTransport?.singleInteractiveTruth, true);
  assert.equal(result.evidence.surfaceTransport?.currentFrameSequence, 1);
  assert.equal(result.evidence.surfaceTransport?.surfaceTransportRef, result.refs.surfaceTransportRef);
  assert.equal(result.evidence.surfaceTransport?.liveSurfaceRef, result.refs.liveSurfaceRef);
  assert.equal(result.evidence.surfaceTransport?.frameStreamRef, result.refs.frameStreamRef);
  assert.equal(result.evidence.surfaceTransport?.currentFrameRef, result.refs.currentFrameRef);
  assert.equal(result.evidence.surfaceTransport?.frameTransportContractRef, result.refs.frameTransportContractRef);
  assert.equal(result.evidence.surfaceTransport?.frameTelemetryRef, result.refs.frameTelemetryRef);
  assert.equal(result.evidence.surfaceTransport?.mediaChannelRef, result.refs.mediaChannelRef);
  assert.equal(result.evidence.surfaceTransport?.dataChannelRef, result.refs.dataChannelRef);
  for (const ref of [
    result.refs.evidenceLedgerRef,
    result.refs.liveBindingAttachGrantRef,
    result.refs.grantValidationRef,
    result.refs.surfaceOwnerRef,
    result.refs.displayOwnerRef,
    result.refs.surfaceTransportRef,
    result.refs.frameTransportContractRef,
    result.refs.currentFrameRef,
  ]) {
    assert.ok(result.evidence.evidenceRefs.includes(requiredString(ref)));
  }
}

function assertProviderEvidenceRefs(evidenceRefs: string[], providerRoot: string) {
  for (const ref of [
    `${providerRoot}/adapter-readiness.json`,
    `${providerRoot}/lifecycle-ledger.json#createSession`,
    `${providerRoot}/lifecycle-ledger.json#launchApp`,
    `${providerRoot}/lifecycle-ledger.json#attachSurface`,
    `${providerRoot}/surface-transport.json`,
    `${providerRoot}/frame-transport-contract.json`,
    `${providerRoot}/frames/current.json`,
    `${providerRoot}/evidence-ledger.json`,
  ]) {
    assert.ok(evidenceRefs.includes(ref), `missing provider evidence ref ${ref}`);
  }
}

function assertProviderWrites(
  writes: Array<{ ref: string; data: unknown }>,
  providerRoot: string,
  targetWindowRef: string,
) {
  for (const ref of [
    `${providerRoot}/session.json`,
    targetWindowRef,
    `${providerRoot}/live-surface.json`,
    `${providerRoot}/surface-transport.json`,
    `${providerRoot}/frame-transport-contract.json`,
    `${providerRoot}/frames/current.json`,
  ]) {
    assert.ok(writes.some((write) => write.ref === ref), `missing provider write ${ref}`);
  }
}

function providerRootFromEvidenceRefs(evidenceRefs: string[]) {
  const currentFrameRef = evidenceRefs.find((ref) => ref.endsWith('/virtual-display-provider/frames/current.json'));
  if (typeof currentFrameRef !== 'string') {
    throw new Error('missing provider current frame evidence ref');
  }
  return currentFrameRef.replace(/\/frames\/current\.json$/u, '');
}

function providerSessionRefFromAttachEvidence(result: AttachResultLike) {
  return `${providerRootFromEvidenceRefs(result.evidence.evidenceRefs)}/session.json`;
}

function inputOperationOptions(runId: string, kind: string, sessionRef: string) {
  return {
    runId,
    targetAppKind: 'generic-editor',
    inputIntent: {
      source: kind === 'tap' ? 'virtual-app-screen-canvas' : 'virtual-app-screen-control',
      kind,
      controlKind: kind === 'tap' ? undefined : kind,
      refs: {
        sessionRef,
        frameRef: `computer-use:session/${runId}/frames/current.json`,
      },
    },
  };
}

function inputControlRefs(context: NativeVirtualDisplayDriverInputControlContext) {
  return nativeDriverInputControlDefaultRefs({
    providerRootRef: requiredString(context.refs.providerRootRef),
    operation: context.operation,
    operationOptions: context.operationOptions,
  });
}

function requiredString(value: string | string[] | undefined) {
  assert.equal(typeof value, 'string');
  return value as string;
}

function fakeDriverDependencies(overrides: Partial<LinuxXpraVirtualDisplayDriverDependencies> & {
  writes?: Array<{ ref: string; data: unknown }>;
} = {}): LinuxXpraVirtualDisplayDriverDependencies {
  const writes = overrides.writes ?? [];
  return {
    commandExists: () => true,
    probeInputIsolation: () => ({ ok: true }),
    probeFrameCapture: () => ({ ok: true }),
    startSession: () => ({
      sessionId: 'sciforge-test-xpra',
      display: ':2301',
      width: 1440,
      height: 900,
      stdout: 'started',
    }),
    launchApp: () => ({
      pids: [5151],
      details: { launchMode: 'fake-xpra-control' },
    }),
    waitForTargetWindow: () => ({
      id: '7',
      pid: 5151,
      title: 'Research Editor',
      x: 32,
      y: 32,
      width: 1200,
      height: 760,
      raw: { title: 'Research Editor' },
    }),
    captureSessionFrame: (input) => ({
      frameRef: `${input.runDirRef}/virtual-display-provider/frames/current.json`,
      screenshotRef: `${input.runDirRef}/virtual-display-provider/frames/current.png`,
      frameRecord: {
        schemaVersion: 'sciforge.computer-use.screen-frame.v1',
        providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
        screenshotBytes: 2048,
        currentRunOnly: true,
      },
    }),
    writeJsonRef: (_outDir, _runDirRef, ref, data) => {
      writes.push({ ref, data });
    },
    ...overrides,
  };
}

function readyProbeOptions(targetAppKind: string) {
  return {
    platform: 'linux',
    targetAppKind,
    commandAvailability: { xpra: true },
  };
}
