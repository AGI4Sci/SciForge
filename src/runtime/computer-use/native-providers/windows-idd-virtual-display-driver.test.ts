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
  WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
  createWindowsIddVirtualDisplayProvider,
} from './windows-idd-virtual-display-provider.js';
import {
  createWindowsIddVirtualDisplayDriverHooks,
  type WindowsIddVirtualDisplayDriverDependencies,
} from './windows-idd-virtual-display-driver.js';
import {
  nativeDriverInputControlDefaultRefs,
  type NativeVirtualDisplayDriverInputControlContext,
} from './native-driver-input-control.js';

test('Windows IDD opt-in driver hooks can drive native attach with current-session surface transport refs', async () => {
  const writes: Array<{ ref: string; data: unknown }> = [];
  const deps = fakeDriverDependencies({ writes });
  const provider = createWindowsIddVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createWindowsIddVirtualDisplayDriverHooks({
      platform: 'win32',
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      outDir: '/tmp/sciforge-windows-idd-driver-test',
      dependencies: deps,
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:windows-idd-opt-in-driver-test',
    providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });

  const command = parsedAttachCommand();
  const result = await executor.attach(command);
  const runId = virtualAppScreenRuntimeCommandRunId(command);
  const providerRoot = `.sciforge/vision-runs/${runId}/virtual-display-provider`;

  assert.equal(result.status, 'attached');
  assert.equal(result.providerId, WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID);
  assert.equal(result.evidence.providerExecuted, true);
  assert.equal(result.refs.sessionRef, `${providerRoot}/session.json`);
  assert.equal(result.refs.targetWindowRef, `window:${runId}/generic-editor/main`);
  assert.equal(result.refs.liveSurfaceRef, `${providerRoot}/live-surface.json`);
  assert.equal(result.refs.frameStreamRef, `${providerRoot}/frame-stream.json`);
  assert.equal(result.refs.currentFrameRef, `${providerRoot}/frames/current.json`);
  assert.equal(result.refs.surfaceTransportRef, `${providerRoot}/surface-transport.json`);
  assert.equal(result.refs.frameTransportContractRef, `${providerRoot}/frame-transport-contract.json`);
  assert.equal(result.evidence.surfaceTransport?.owner, 'VirtualDisplayProvider');
  assert.equal(result.evidence.surfaceTransport?.providerId, WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID);
  assert.equal(result.evidence.surfaceTransport?.diagnosticOnly, false);
  assert.equal(result.evidence.surfaceTransport?.productFallback, false);
  assert.equal(result.evidence.surfaceTransport?.singleInteractiveTruth, true);
  assert.equal(result.evidence.surfaceTransport?.currentFrameSequence, 1);
  assert.ok(writes.some((write) => write.ref.endsWith('/session.json')));
  assert.ok(writes.some((write) => write.ref.endsWith('/display.json')));
  assert.ok(writes.some((write) => write.ref.includes('/generic-editor/main')));
  assert.ok(writes.some((write) => write.ref.endsWith('/surface-transport.json')));
  assert.ok(writes.some((write) => write.ref.endsWith('/frame-transport-contract.json')));
  assert.ok(writes.some((write) => write.ref.endsWith('/frames/current.json')));
});

test('Windows IDD opt-in driver readFrame stays anchored to attached session refs across operation run ids', async () => {
  const captureRunDirRefs: string[] = [];
  const provider = createWindowsIddVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createWindowsIddVirtualDisplayDriverHooks({
      platform: 'win32',
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        captureFrame: (input) => {
          captureRunDirRefs.push(input.runDirRef);
          return {
            frameRef: `${input.runDirRef}/virtual-display-provider/frames/current.json`,
            screenshotRef: `${input.runDirRef}/virtual-display-provider/frames/current.png`,
            frameRecord: {
              schemaVersion: 'sciforge.computer-use.screen-frame.v1',
              providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
              screenshotBytes: 1024,
              currentRunOnly: true,
            },
          };
        },
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:windows-idd-readframe-current-session-test',
    providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const providerRoot = requiredString(attachResult.refs.sessionRef).replace(/\/session\.json$/u, '');
  const attachedRunDir = providerRoot.replace(/\/virtual-display-provider$/u, '');

  const readFrame = await provider.readFrame({
    runId: 'windows-idd-driver-readframe-other-run',
    targetAppKind: 'generic-editor',
  });

  assert.equal(readFrame.status, 'ready');
  assert.equal(readFrame.refs.currentFrameRef, `${providerRoot}/frames/current.json`);
  assert.equal(readFrame.refs.currentScreenshotRef, `${providerRoot}/frames/current.png`);
  assert.equal(readFrame.refs.currentFrameSequence, '2');
  assert.equal(captureRunDirRefs[captureRunDirRefs.length - 1], attachedRunDir);
  assert.notEqual(captureRunDirRefs[captureRunDirRefs.length - 1], '.sciforge/vision-runs/windows-idd-driver-readframe-other-run');
});

test('Windows IDD opt-in driver exposes provider-owned input and control hook evidence refs', async () => {
  const deps = fakeDriverDependencies({
    sendInputIntent: (context) => ({ ok: true, refs: inputControlRefs(context), mutatingActionExecuted: true, providerEvidenceWritten: true }),
    pauseAgentQueue: (context) => ({ ok: true, refs: inputControlRefs(context), mutatingActionExecuted: true, providerEvidenceWritten: true }),
    resumeAgentQueue: (context) => ({ ok: true, refs: inputControlRefs(context), mutatingActionExecuted: true, providerEvidenceWritten: true }),
    safeStopSession: (context) => ({ ok: true, refs: inputControlRefs(context), mutatingActionExecuted: true, providerEvidenceWritten: true }),
  });
  const provider = createWindowsIddVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createWindowsIddVirtualDisplayDriverHooks({
      platform: 'win32',
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: deps,
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:windows-idd-input-control-test',
    providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const sessionRef = requiredString(attachResult.refs.sessionRef);
  const providerRoot = sessionRef.replace(/\/session\.json$/u, '');

  const sendInput = await provider.sendInputIntent(inputOperationOptions('windows-idd-driver-input', 'tap', sessionRef));
  const pause = await provider.pause(inputOperationOptions('windows-idd-driver-pause', 'takeover', sessionRef));
  const resume = await provider.resume(inputOperationOptions('windows-idd-driver-resume', 'resume-agent', sessionRef));
  const stop = await provider.closeSession(inputOperationOptions('windows-idd-driver-stop', 'stop-session', sessionRef));

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

test('Windows IDD opt-in driver input hook fails closed without provider-owned evidence refs', async () => {
  const provider = createWindowsIddVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createWindowsIddVirtualDisplayDriverHooks({
      platform: 'win32',
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        sendInputIntent: () => ({ ok: true, refs: {}, mutatingActionExecuted: true, providerEvidenceWritten: true }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:windows-idd-input-missing-refs-test',
    providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());

  const result = await provider.sendInputIntent(inputOperationOptions(
    'windows-idd-driver-input-missing-refs',
    'tap',
    requiredString(attachResult.refs.sessionRef),
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /did not return required provider-owned evidence refs/);
  assert.equal(result.mutatingActionExecuted, false);
});

test('Windows IDD opt-in driver input hook fails closed without evidence-written proof', async () => {
  const provider = createWindowsIddVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createWindowsIddVirtualDisplayDriverHooks({
      platform: 'win32',
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        sendInputIntent: (context) => ({ ok: true, refs: inputControlRefs(context), mutatingActionExecuted: true }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:windows-idd-input-no-evidence-written-test',
    providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());

  const result = await provider.sendInputIntent(inputOperationOptions(
    'windows-idd-driver-input-no-evidence-written',
    'tap',
    requiredString(attachResult.refs.sessionRef),
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /providerEvidenceWritten=true/);
  assert.equal(result.mutatingActionExecuted, false);
});

test('Windows IDD opt-in driver input hook fails closed for a stale session or missing mutation evidence', async () => {
  const provider = createWindowsIddVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createWindowsIddVirtualDisplayDriverHooks({
      platform: 'win32',
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        sendInputIntent: (context) => ({ ok: true, refs: inputControlRefs(context) }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:windows-idd-input-stale-session-test',
    providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());

  const staleSession = await provider.sendInputIntent(inputOperationOptions('windows-idd-driver-input-stale-session', 'tap', 'computer-use:session/stale/session.json'));
  assert.equal(staleSession.status, 'blocked');
  assert.match(staleSession.blockedReason ?? '', /sessionRef does not match/);

  const missingMutation = await provider.sendInputIntent(inputOperationOptions(
    'windows-idd-driver-input-missing-mutation',
    'tap',
    requiredString(attachResult.refs.sessionRef),
  ));
  assert.equal(missingMutation.status, 'blocked');
  assert.match(missingMutation.blockedReason ?? '', /mutatingActionExecuted=true/);
});

test('Windows IDD opt-in driver probe fails closed when platform, driver, permission, or capture evidence is missing', async (t) => {
  const cases: Array<{
    name: string;
    driverOptions?: Parameters<typeof createWindowsIddVirtualDisplayDriverHooks>[0];
    deps?: Partial<WindowsIddVirtualDisplayDriverDependencies>;
    reason: RegExp;
    status: 'blocked' | 'permission-missing';
  }> = [
    {
      name: 'wrong platform',
      driverOptions: { platform: 'darwin' },
      reason: /requires a win32 host platform/,
      status: 'blocked',
    },
    {
      name: 'missing driver api',
      deps: { loadIddDriverApi: () => undefined },
      reason: /driver API is not available/,
      status: 'blocked',
    },
    {
      name: 'missing installed driver',
      deps: { probeDriverInstalled: () => ({ ok: false, detail: 'service not present' }) },
      reason: /not installed: service not present/,
      status: 'blocked',
    },
    {
      name: 'missing authorization',
      deps: { probeDriverAuthorized: () => ({ ok: false, detail: 'not authorized' }) },
      reason: /authorization is not proven: not authorized/,
      status: 'permission-missing',
    },
    {
      name: 'missing capture api',
      deps: {
        probeCaptureAvailable: () => ({ ok: false, detail: 'capture interface absent' }),
      },
      reason: /frame capture API is not available: capture interface absent/,
      status: 'blocked',
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const provider = createWindowsIddVirtualDisplayProvider({
        probeOptions: readyProbeOptions('generic-editor'),
        hooks: createWindowsIddVirtualDisplayDriverHooks({
          platform: 'win32',
          targetApp: { kind: 'generic-editor', command: 'research-editor' },
          probeOptions: readyProbeOptions('generic-editor'),
          dependencies: fakeDriverDependencies(testCase.deps ?? {}),
          ...(testCase.driverOptions ?? {}),
        }),
      });

      const result = await provider.probe({ runId: `windows-idd-driver-${testCase.name}`, targetAppKind: 'generic-editor' });

      assert.equal(result.status, testCase.status);
      assert.equal(result.providerExecuted, true);
      assert.equal(result.rawPayloadWritten, false);
      assert.match(result.blockedReason ?? '', testCase.reason);
      assert.equal(result.refs.liveSurfaceRef, undefined);
      assert.equal(result.refs.currentFrameRef, undefined);
    });
  }
});

test('Windows IDD opt-in driver fails closed when launch cannot materialize a target window', async () => {
  const provider = createWindowsIddVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createWindowsIddVirtualDisplayDriverHooks({
      platform: 'win32',
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        findTargetWindow: () => undefined,
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:windows-idd-driver-no-window-test',
    providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
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

test('Windows IDD opt-in driver fails closed when readFrame capture fails', async () => {
  const provider = createWindowsIddVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createWindowsIddVirtualDisplayDriverHooks({
      platform: 'win32',
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        captureFrame: () => {
          throw new Error('capture denied');
        },
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:windows-idd-driver-capture-failed-test',
    providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
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

test('Windows IDD opt-in driver source stays generic and avoids disallowed fallback paths', async () => {
  const source = await readFile(fileURLToPath(new URL('./windows-idd-virtual-display-driver.ts', import.meta.url)), 'utf8');

  assert.doesNotMatch(source, /tools\/computer-use-next|virtual-app-screen-vscode-smoke/);
  assert.doesNotMatch(source, /Visual Studio Code\.app|sciforge-vscode-virtual-app-screen-bridge|extensionDevelopmentPath/);
  assert.doesNotMatch(source, /RDP|QEMU|noVNC|Xvfb|Playwright|DOM shortcut/);
});

function parsedAttachCommand() {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--profile "generic-editor"',
    '--target-app-ref "app:profile/generic-editor"',
    '--screen-ref "virtual-app-screen:windows-idd-driver-test/screen"',
    '--activation-ref "computer-use:windows-idd-driver-test/attach-request.json"',
    '--adapter-readiness-ref "computer-use:windows-idd-driver-test/provider-readiness.json"',
    '--evidence-ledger-ref "ledger:computer-use/windows-idd-driver-test/screen-activation.json"',
    '--gui-present-ref "gui.present:windows-idd-driver-test/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
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

function fakeDriverDependencies(overrides: Partial<WindowsIddVirtualDisplayDriverDependencies> & {
  writes?: Array<{ ref: string; data: unknown }>;
} = {}): WindowsIddVirtualDisplayDriverDependencies {
  const writes = overrides.writes ?? [];
  return {
    platform: () => 'win32',
    loadIddDriverApi: () => ({
      driverName: 'fake-idd-driver-api',
    }),
    probeDriverInstalled: () => ({ ok: true }),
    probeDriverAuthorized: () => ({ ok: true }),
    probeCaptureAvailable: () => ({ ok: true }),
    createVirtualDisplay: () => ({
      displayId: 'idd-display-7',
      adapterId: 'adapter-1',
      targetId: 'target-1',
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
      name: 'SciForge Test IDD Display',
    }),
    launchApp: () => ({
      pids: [4242],
      details: { launchMode: 'fake-windows-command' },
    }),
    findTargetWindow: () => ({
      pid: 4242,
      hwnd: '0x0000002a',
      title: 'Untitled',
      x: 32,
      y: 32,
      width: 1000,
      height: 700,
    }),
    attachWindowToDisplay: () => ({
      ok: true,
      surfaceId: 'surface-7',
      details: { mode: 'fake-idd-surface' },
    }),
    captureFrame: (input) => ({
      frameRef: `${input.runDirRef}/virtual-display-provider/frames/current.json`,
      screenshotRef: `${input.runDirRef}/virtual-display-provider/frames/current.png`,
      frameRecord: {
        schemaVersion: 'sciforge.computer-use.screen-frame.v1',
        providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
        screenshotBytes: 1024,
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
    platform: 'win32',
    targetAppKind,
    manualRequirementAvailability: {
      'windows-idd-virtual-display-driver': true,
    },
    permissionGrants: {
      'permission:windows/idd-driver-authorized': true,
    },
  };
}
