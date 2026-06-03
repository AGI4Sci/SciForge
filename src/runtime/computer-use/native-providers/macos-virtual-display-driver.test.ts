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
  MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
  createMacosVirtualDisplayProvider,
} from './macos-virtual-display-provider.js';
import {
  createMacosVirtualDisplayDriverHooks,
  type MacosVirtualDisplayDriverDependencies,
} from './macos-virtual-display-driver.js';
import {
  nativeDriverInputControlDefaultRefs,
  type NativeVirtualDisplayDriverInputControlContext,
} from './native-driver-input-control.js';
import {
  defaultLaunchMacosTargetApp,
  findMacosTargetProcessIds,
  macosEditableWindowReadinessEvidence,
  selectMacosAxWindowForCgWindow,
  selectMacosCgTargetWindow,
} from './macos-native-driver-helpers.js';

test('macOS opt-in driver hooks can drive native attach with Host-backed surface transport refs', async () => {
  const writes: Array<{ ref: string; data: unknown }> = [];
  const deps = fakeDriverDependencies({ writes });
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      outDir: '/tmp/sciforge-macos-driver-test',
      dependencies: deps,
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-opt-in-driver-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });

  const command = parsedAttachCommand();
  const result = await executor.attach(command);
  const runId = virtualAppScreenRuntimeCommandRunId(command);
  const providerRoot = `.sciforge/vision-runs/${runId}/virtual-display-provider`;

  assert.equal(result.status, 'attached');
  assert.equal(result.providerId, MACOS_VIRTUAL_DISPLAY_PROVIDER_ID);
  assert.equal(result.evidence.providerExecuted, true);
  assert.equal(result.refs.targetWindowRef, `window:${runId}/generic-editor/main`);
  assertNativeHostAttachRefs(result, MACOS_VIRTUAL_DISPLAY_PROVIDER_ID);
  assertProviderEvidenceRefs(result.evidence.evidenceRefs, providerRoot);
  assertProviderWrites(writes, providerRoot, `window:${runId}/generic-editor/main`);
});

test('macOS opt-in driver display evidence excludes raw native display internals', async () => {
  const writes: Array<{ ref: string; data: unknown }> = [];
  const deps = fakeDriverDependencies({
    writes,
    createVirtualDisplay: () => ({
      displayId: 777,
      displayIndex: 3,
      x: 1600,
      y: 0,
      width: 1440,
      height: 900,
      name: 'SciForge Test Display',
      raw: {
        providerPayload: 'SECRET_TOKEN=display-secret',
        path: '/Users/example/native-display.json',
      },
    }),
  });
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      outDir: '/tmp/sciforge-macos-driver-test',
      dependencies: deps,
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-display-evidence-redaction-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });

  const result = await executor.attach(parsedAttachCommand());
  assert.equal(result.status, 'attached', result.blockedReason);
  const sessionWrite = writes.find((write) => write.ref.endsWith('/session.json'));
  const displayWrite = writes.find((write) => write.ref.endsWith('/display.json'));
  assert.ok(sessionWrite);
  assert.ok(displayWrite);

  for (const write of [sessionWrite, displayWrite]) {
    const text = JSON.stringify(write.data);
    assert.doesNotMatch(text, /raw|providerPayload|SECRET|TOKEN|\/Users/u);
    assert.match(text, /"displayId":777/u);
  }
});

test('macOS opt-in driver readFrame stays anchored to attached session refs across operation run ids', async () => {
  const captureRunDirRefs: string[] = [];
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        captureDisplayFrame: (input) => {
          captureRunDirRefs.push(input.runDirRef);
          return {
            frameRef: `${input.runDirRef}/virtual-display-provider/frames/current.json`,
            screenshotRef: `${input.runDirRef}/virtual-display-provider/frames/current.png`,
            frameRecord: {
              schemaVersion: 'sciforge.computer-use.screen-frame.v1',
              providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
              screenshotBytes: 1024,
              currentRunOnly: true,
            },
          };
        },
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-readframe-current-session-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  assert.match(requiredString(attachResult.refs.sessionRef), /^computer-use:native-host\/sessions\//u);
  const providerRoot = providerRootFromEvidenceRefs(attachResult.evidence.evidenceRefs);
  const attachedRunDir = providerRoot.replace(/\/virtual-display-provider$/u, '');

  const readFrame = await provider.readFrame({
    runId: 'macos-driver-readframe-other-run',
    targetAppKind: 'generic-editor',
  });

  assert.equal(readFrame.status, 'ready');
  assert.equal(readFrame.refs.currentFrameRef, `${providerRoot}/frames/current.json`);
  assert.equal(readFrame.refs.currentScreenshotRef, `${providerRoot}/frames/current.png`);
  assert.equal(readFrame.refs.currentFrameSequence, '2');
  assert.equal(captureRunDirRefs[captureRunDirRefs.length - 1], attachedRunDir);
  assert.notEqual(captureRunDirRefs[captureRunDirRefs.length - 1], '.sciforge/vision-runs/macos-driver-readframe-other-run');
});

test('macOS opt-in driver exposes provider-owned input and control hook evidence refs', async () => {
  const deps = fakeDriverDependencies({
    probeInputAdapterCapability: () => ({ ok: true, mechanism: 'pid-scoped-ax' }),
    sendInputIntent: inputControlResult,
    pauseAgentQueue: inputControlResult,
    resumeAgentQueue: inputControlResult,
    safeStopSession: inputControlResult,
  });
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: deps,
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-input-control-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);
  const providerRoot = sessionRef.replace(/\/session\.json$/u, '');

  const sendInput = await provider.sendInputIntent(inputOperationOptions('macos-driver-input', 'tap', sessionRef));
  const pause = await provider.pause(inputOperationOptions('macos-driver-pause', 'takeover', sessionRef));
  const resume = await provider.resume(inputOperationOptions('macos-driver-resume', 'resume-agent', sessionRef));
  const stop = await provider.closeSession(inputOperationOptions('macos-driver-stop', 'stop-session', sessionRef));

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

test('macOS opt-in driver updates target window state after isolated placement before input probes', async () => {
  const observedProbeBounds: Array<{
    cgX?: number;
    cgY?: number;
    cgWidth?: number;
    cgHeight?: number;
    axX?: number;
    axY?: number;
    axWidth?: number;
    axHeight?: number;
  }> = [];
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        waitForTargetWindow: () => ({
          cgWindow: {
            pid: 4242,
            windowNumber: 19,
            ownerName: 'Research Editor',
            title: 'Untitled',
            layer: 0,
            x: 0,
            y: 0,
            width: 1000,
            height: 700,
          },
          axWindow: {
            pid: 4242,
            windowIndex: 1,
            title: 'Untitled',
            x: 0,
            y: 0,
            width: 1000,
            height: 700,
          },
        }),
        probeInputAdapterCapability: (context) => {
          const targetWindow = context.platformState.targetWindow as {
            cgWindow?: { x?: number; y?: number; width?: number; height?: number };
            axWindow?: { x?: number; y?: number; width?: number; height?: number };
          } | undefined;
          const bounds = {
            cgX: targetWindow?.cgWindow?.x,
            cgY: targetWindow?.cgWindow?.y,
            cgWidth: targetWindow?.cgWindow?.width,
            cgHeight: targetWindow?.cgWindow?.height,
            axX: targetWindow?.axWindow?.x,
            axY: targetWindow?.axWindow?.y,
            axWidth: targetWindow?.axWindow?.width,
            axHeight: targetWindow?.axWindow?.height,
          };
          observedProbeBounds.push(bounds);
          return bounds.cgX === 1632
            && bounds.cgY === 32
            && bounds.cgWidth === 1376
            && bounds.cgHeight === 836
            && bounds.axX === 1632
            && bounds.axY === 32
            && bounds.axWidth === 1376
            && bounds.axHeight === 836
            ? { ok: true, mechanism: 'pid-scoped-ax' }
            : { ok: false, detail: 'stale-target-window-bounds' };
        },
        sendInputIntent: inputControlResult,
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-moved-window-state-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  assert.equal(attachResult.status, 'attached', attachResult.blockedReason);
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const sendInput = await provider.sendInputIntent(inputOperationOptions(
    'macos-driver-moved-window-state',
    'tap',
    sessionRef,
  ));

  assert.equal(sendInput.status, 'ready', sendInput.blockedReason);
  assert.deepEqual(observedProbeBounds, [{
    cgX: 1632,
    cgY: 32,
    cgWidth: 1376,
    cgHeight: 836,
    axX: 1632,
    axY: 32,
    axWidth: 1376,
    axHeight: 836,
  }]);
});

test('macOS opt-in driver blocks input when safe input adapter capability is not proven', async () => {
  let hookCalls = 0;
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        sendInputIntent: (context) => {
          hookCalls += 1;
          return inputControlResult(context);
        },
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-input-capability-default-blocked-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  assert.equal(attachResult.status, 'attached');
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const result = await provider.sendInputIntent(inputOperationOptions(
    'macos-driver-input-capability-default-blocked',
    'tap',
    sessionRef,
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /safe macOS AX\/app-protocol input adapter capability is not proven/);
  assert.equal(result.mutatingActionExecuted, false);
  assert.equal(hookCalls, 0);
});

test('macOS opt-in driver rejects forbidden input adapter capability mechanisms before calling hook', async () => {
  let hookCalls = 0;
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        probeInputAdapterCapability: () => ({ ok: true, mechanism: 'CGEvent' as 'pid-scoped-ax' }),
        sendInputIntent: (context) => {
          hookCalls += 1;
          return inputControlResult(context);
        },
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-input-capability-forbidden-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  assert.equal(attachResult.status, 'attached');
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const result = await provider.sendInputIntent(inputOperationOptions(
    'macos-driver-input-capability-forbidden',
    'tap',
    sessionRef,
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /forbidden macOS input adapter mechanism/i);
  assert.equal(result.mutatingActionExecuted, false);
  assert.equal(hookCalls, 0);
});

test('macOS opt-in driver redacts unsafe input adapter capability diagnostics', async () => {
  let hookCalls = 0;
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        probeInputAdapterCapability: () => ({
          ok: false,
          detail: 'SECRET_TOKEN=capability-secret /Users/example/raw computer-use:native-host/sessions/session-1',
        }),
        sendInputIntent: (context) => {
          hookCalls += 1;
          return inputControlResult(context);
        },
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-input-capability-redaction-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  assert.equal(attachResult.status, 'attached');
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const result = await provider.sendInputIntent(inputOperationOptions(
    'macos-driver-input-capability-redaction',
    'tap',
    sessionRef,
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /safe macOS AX\/app-protocol input adapter capability is not proven/);
  assert.doesNotMatch(result.blockedReason ?? '', /SECRET|TOKEN|\/Users|computer-use:native-host\/sessions/u);
  assert.equal(result.mutatingActionExecuted, false);
  assert.equal(hookCalls, 0);
});

test('macOS opt-in driver redacts forbidden input adapter mechanism values', async () => {
  let hookCalls = 0;
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        probeInputAdapterCapability: () => ({
          ok: true,
          mechanism: '/Users/example/SECRET_TOKEN=mechanism' as 'pid-scoped-ax',
        }),
        sendInputIntent: (context) => {
          hookCalls += 1;
          return inputControlResult(context);
        },
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-input-mechanism-redaction-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  assert.equal(attachResult.status, 'attached');
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const result = await provider.sendInputIntent(inputOperationOptions(
    'macos-driver-input-mechanism-redaction',
    'tap',
    sessionRef,
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /forbidden macOS input adapter mechanism/);
  assert.doesNotMatch(result.blockedReason ?? '', /SECRET|TOKEN|\/Users|mechanism=/u);
  assert.equal(result.mutatingActionExecuted, false);
  assert.equal(hookCalls, 0);
});

test('macOS opt-in driver rejects input adapter capability refs outside the current provider root', async () => {
  let hookCalls = 0;
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        probeInputAdapterCapability: () => ({
          ok: true,
          mechanism: 'pid-scoped-ax',
          refs: {
            verificationRefs: [
              '.sciforge/vision-runs/stale-run/virtual-display-provider/verification/capability.json',
            ],
          },
        }),
        sendInputIntent: (context) => {
          hookCalls += 1;
          return inputControlResult(context);
        },
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-input-capability-stale-refs-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  assert.equal(attachResult.status, 'attached');
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const result = await provider.sendInputIntent(inputOperationOptions(
    'macos-driver-input-capability-stale-refs',
    'tap',
    sessionRef,
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /capability evidence refs outside the current provider root/);
  assert.doesNotMatch(result.blockedReason ?? '', /\.sciforge\/vision-runs\/stale-run/u);
  assert.equal(result.mutatingActionExecuted, false);
  assert.equal(hookCalls, 0);
});

test('macOS opt-in driver input hook fails closed without provider-owned evidence refs', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        probeInputAdapterCapability: () => ({ ok: true, mechanism: 'pid-scoped-ax' }),
        sendInputIntent: () => ({ ok: true, refs: {}, mutatingActionExecuted: true, providerEvidenceWritten: true }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-input-missing-refs-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const result = await provider.sendInputIntent(inputOperationOptions(
    'macos-driver-input-missing-refs',
    'tap',
    sessionRef,
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /did not return required provider-owned evidence refs/);
  assert.equal(result.mutatingActionExecuted, false);
});

test('macOS opt-in driver input hook fails closed when evidence refs leave the current provider root', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        probeInputAdapterCapability: () => ({ ok: true, mechanism: 'pid-scoped-ax' }),
        sendInputIntent: (context) => ({
          ...inputControlResult(context),
          refs: {
            ...inputControlRefs(context),
            inputIntentRefs: [
              '/Users/example/SECRET_TOKEN=stale-input-ref',
            ],
          },
        }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-input-stale-refs-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const result = await provider.sendInputIntent(inputOperationOptions(
    'macos-driver-input-stale-refs',
    'tap',
    sessionRef,
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /outside the current provider root/);
  assert.doesNotMatch(result.blockedReason ?? '', /SECRET|TOKEN|\/Users|stale-input-ref/u);
  assert.equal(result.mutatingActionExecuted, false);
});

test('macOS opt-in driver input hook fails closed when evidence refs traverse out of the provider root', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        probeInputAdapterCapability: () => ({ ok: true, mechanism: 'pid-scoped-ax' }),
        sendInputIntent: (context) => ({
          ...inputControlResult(context),
          refs: {
            ...inputControlRefs(context),
            verificationRefs: [`${requiredString(context.refs.providerRootRef)}/../escape.json`],
          },
        }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-input-traversal-refs-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const result = await provider.sendInputIntent(inputOperationOptions(
    'macos-driver-input-traversal-refs',
    'tap',
    sessionRef,
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /outside the current provider root|unsafe logical ref/);
  assert.equal(result.mutatingActionExecuted, false);
});

test('macOS opt-in driver input hook fails closed without physical desktop isolation proof', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        probeInputAdapterCapability: () => ({ ok: true, mechanism: 'pid-scoped-ax' }),
        sendInputIntent: (context) => ({
          ok: true,
          refs: inputControlRefs(context),
          mutatingActionExecuted: true,
          providerEvidenceWritten: true,
        }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-input-no-isolation-proof-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const result = await provider.sendInputIntent(inputOperationOptions(
    'macos-driver-input-no-isolation-proof',
    'tap',
    sessionRef,
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /physical desktop effects/);
  assert.match(result.blockedReason ?? '', /affectsPhysicalDisplay=false/);
  assert.match(result.blockedReason ?? '', /systemPointerMoved=false/);
  assert.equal(result.mutatingActionExecuted, false);
});

test('macOS opt-in driver input hook fails closed without evidence-written proof', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        probeInputAdapterCapability: () => ({ ok: true, mechanism: 'pid-scoped-ax' }),
        sendInputIntent: (context) => ({ ok: true, refs: inputControlRefs(context), mutatingActionExecuted: true }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-input-no-evidence-written-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const result = await provider.sendInputIntent(inputOperationOptions(
    'macos-driver-input-no-evidence-written',
    'tap',
    sessionRef,
  ));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /providerEvidenceWritten=true/);
  assert.equal(result.mutatingActionExecuted, false);
});

test('macOS opt-in driver input hook fails closed for a stale session or missing mutation evidence', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        probeInputAdapterCapability: () => ({ ok: true, mechanism: 'pid-scoped-ax' }),
        sendInputIntent: (context) => ({ ok: true, refs: inputControlRefs(context) }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-input-stale-session-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const staleSession = await provider.sendInputIntent(inputOperationOptions('macos-driver-input-stale-session', 'tap', 'computer-use:session/stale/session.json'));
  assert.equal(staleSession.status, 'blocked');
  assert.match(staleSession.blockedReason ?? '', /sessionRef does not match/);

  const missingMutation = await provider.sendInputIntent(inputOperationOptions(
    'macos-driver-input-missing-mutation',
    'tap',
    sessionRef,
  ));
  assert.equal(missingMutation.status, 'blocked');
  assert.match(missingMutation.blockedReason ?? '', /mutatingActionExecuted=true/);
});

test('macOS opt-in driver probe fails closed when package, command, or permissions are missing', async (t) => {
  const cases: Array<{
    name: string;
    deps: Partial<MacosVirtualDisplayDriverDependencies>;
    probeOptions?: ReturnType<typeof readyProbeOptions>;
    reason: RegExp;
    status: 'blocked' | 'permission-missing';
  }> = [
    {
      name: 'missing package',
      deps: { loadVirtualDisplayPackage: () => undefined },
      reason: /node-mac-virtual-display is not available/,
      status: 'blocked',
    },
    {
      name: 'missing screencapture',
      deps: { commandExists: () => false },
      reason: /screencapture is not available/,
      status: 'blocked',
    },
    {
      name: 'missing screen recording',
      deps: { probeScreenRecording: () => ({ ok: false, detail: 'not authorized' }) },
      probeOptions: {
        ...readyProbeOptions('generic-editor'),
        permissionGrants: {
          'permission:macos/accessibility': true,
          'permission:macos/screen-recording': false,
        },
      },
      reason: /Screen Recording permission is not proven/,
      status: 'permission-missing',
    },
    {
      name: 'missing accessibility',
      deps: { probeAccessibility: () => ({ ok: false, detail: 'not authorized' }) },
      reason: /Accessibility permission is not proven/,
      status: 'permission-missing',
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const provider = createMacosVirtualDisplayProvider({
        probeOptions: readyProbeOptions('generic-editor'),
        hooks: createMacosVirtualDisplayDriverHooks({
          targetApp: { kind: 'generic-editor', command: 'research-editor' },
          probeOptions: testCase.probeOptions ?? readyProbeOptions('generic-editor'),
          dependencies: fakeDriverDependencies(testCase.deps),
        }),
      });

      const result = await provider.probe({ runId: `macos-driver-${testCase.name}`, targetAppKind: 'generic-editor' });

      assert.equal(result.status, testCase.status);
      assert.equal(result.providerExecuted, true);
      assert.equal(result.rawPayloadWritten, false);
      assert.match(result.blockedReason ?? '', testCase.reason);
      assert.equal(result.refs.sessionRef, `.sciforge/vision-runs/macos-driver-${testCase.name.replaceAll(' ', '-')}/virtual-display-provider/session.json`);
      assert.equal(result.refs.currentFrameRef, undefined);
    });
  }
});

test('macOS opt-in driver accepts real Screen Recording preflight proof without a test permission grant', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: {
      ...readyProbeOptions('generic-editor'),
      permissionGrants: {
        'permission:macos/accessibility': true,
      },
    },
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: {
        ...readyProbeOptions('generic-editor'),
        permissionGrants: {
          'permission:macos/accessibility': true,
        },
      },
      dependencies: fakeDriverDependencies({
        probeScreenRecording: () => ({ ok: true }),
      }),
    }),
  });

  const result = await provider.probe({ runId: 'macos-driver-screen-recording-preflight', targetAppKind: 'generic-editor' });

  assert.equal(result.status, 'ready');
  assert.equal(result.providerExecuted, true);
  assert.equal(result.refs.currentFrameRef, undefined);
});

test('macOS opt-in driver does not treat test permission grants as Screen Recording proof', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        probeScreenRecording: () => ({ ok: false, detail: 'not authorized' }),
      }),
    }),
  });

  const result = await provider.probe({ runId: 'macos-driver-screen-recording-grant-is-not-proof', targetAppKind: 'generic-editor' });

  assert.equal(result.status, 'permission-missing');
  assert.equal(result.providerExecuted, true);
  assert.match(result.blockedReason ?? '', /Screen Recording permission is not proven/);
});

test('macOS opt-in driver fails closed when launch cannot materialize a target window', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        waitForTargetWindow: () => undefined,
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-driver-no-window-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
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

test('macOS opt-in driver destroys the virtual display when post-create launch is blocked', async () => {
  const destroyedDisplayIds: number[] = [];
  class VirtualDisplay {
    readonly displayId = 780;

    createVirtualDisplay(input: { width: number; height: number; displayName: string }) {
      return {
        id: this.displayId,
        index: 6,
        x: 1600,
        y: 0,
        width: input.width,
        height: input.height,
        name: input.displayName,
      };
    }

    destroyVirtualDisplay() {
      destroyedDisplayIds.push(this.displayId);
      return true;
    }
  }
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        createVirtualDisplay: undefined,
        loadVirtualDisplayPackage: () => VirtualDisplay,
        waitForTargetWindow: () => undefined,
        listDisplays: () => [{
          id: 780,
          index: 6,
          x: 1600,
          y: 0,
          width: 1440,
          height: 900,
          main: false,
        }],
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-driver-no-window-cleanup-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });

  const result = await executor.attach(parsedAttachCommand());

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /could not find a target app window/);
  assert.deepEqual(destroyedDisplayIds, [780]);
});

test('macOS opt-in driver fails closed when readFrame capture fails', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: fakeDriverDependencies({
        captureDisplayFrame: () => {
          throw new Error('capture denied');
        },
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-driver-capture-failed-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
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

test('macOS opt-in driver can launch an explicit generic command without an injected launcher', async () => {
  let observedPids: number[] = [];
  const deps = fakeDriverDependencies({
    launchApp: undefined,
    waitForTargetWindow: (input) => {
      observedPids = input.pids;
      return {
        cgWindow: {
          pid: input.pids[0] ?? 0,
          windowNumber: 21,
          ownerName: 'Generic Command App',
          title: 'Generic command window',
          layer: 0,
          x: 1600,
          y: 0,
          width: 1000,
          height: 700,
        },
        axWindow: {
          pid: input.pids[0] ?? 0,
          windowIndex: 1,
          title: 'Generic command window',
          x: 1600,
          y: 0,
          width: 1000,
          height: 700,
        },
      };
    },
  });
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-command'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: {
        kind: 'generic-command',
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 50)'],
      },
      probeOptions: readyProbeOptions('generic-command'),
      dependencies: deps,
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-command-launch-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-command'],
    provider,
    targetAppKind: 'generic-command',
  });

  const result = await executor.attach(parsedAttachCommand('generic-command'));

  assert.equal(result.status, 'attached', result.blockedReason);
  assert.ok(observedPids.length >= 1);
  assert.equal(observedPids.every((pid) => Number.isInteger(pid) && pid > 0), true);
  assert.match(requiredString(result.refs.sessionRef), /^computer-use:native-host\/sessions\//u);
});

test('macOS real driver accepts node-mac-virtual-display class exports', async () => {
  const calls: Array<{ width: number; height: number; name: string; displayName: string }> = [];
  class VirtualDisplay {
    readonly displayId = 778;

    createVirtualDisplay(input: { width: number; height: number; name: string; displayName: string }) {
      calls.push(input);
      return {
        id: this.displayId,
        index: 4,
        x: 1600,
        y: 0,
        width: input.width,
        height: input.height,
        name: input.displayName,
      };
    }
  }
  const deps = fakeDriverDependencies({
    createVirtualDisplay: undefined,
    loadVirtualDisplayPackage: () => VirtualDisplay,
    listDisplays: () => [{
      id: 778,
      index: 4,
      x: 1600,
      y: 0,
      width: 1440,
      height: 900,
      main: false,
    }],
  });
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: deps,
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-class-export-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });

  const result = await executor.attach(parsedAttachCommand());

  assert.equal(result.status, 'attached', result.blockedReason);
  assert.deepEqual(calls, [{
    width: 1440,
    height: 900,
    name: 'SciForge VirtualAppScreen',
    displayName: 'SciForge VirtualAppScreen',
  }]);
  assert.match(requiredString(result.refs.sessionRef), /^computer-use:native-host\/sessions\//u);
});

test('macOS closeSession destroys node-mac-virtual-display class instances after safe stop evidence', async () => {
  const destroyedDisplayIds: number[] = [];
  class VirtualDisplay {
    readonly displayId = 779;

    createVirtualDisplay(input: { width: number; height: number; displayName: string }) {
      return {
        id: this.displayId,
        index: 5,
        x: 1600,
        y: 0,
        width: input.width,
        height: input.height,
        name: input.displayName,
      };
    }

    destroyVirtualDisplay() {
      destroyedDisplayIds.push(this.displayId);
      return true;
    }
  }
  const deps = fakeDriverDependencies({
    createVirtualDisplay: undefined,
    loadVirtualDisplayPackage: () => VirtualDisplay,
    probeInputAdapterCapability: () => ({ ok: true, mechanism: 'pid-scoped-ax' }),
    safeStopSession: inputControlResult,
    listDisplays: () => [{
      id: 779,
      index: 5,
      x: 1600,
      y: 0,
      width: 1440,
      height: 900,
      main: false,
    }],
  });
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('generic-editor'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: { kind: 'generic-editor', command: 'research-editor' },
      probeOptions: readyProbeOptions('generic-editor'),
      dependencies: deps,
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-class-destroy-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });
  const attachResult = await executor.attach(parsedAttachCommand());
  assert.equal(attachResult.status, 'attached', attachResult.blockedReason);
  const sessionRef = providerSessionRefFromAttachEvidence(attachResult);

  const stop = await provider.closeSession(inputOperationOptions('macos-driver-destroy-class-export', 'stop-session', sessionRef));

  assert.equal(stop.status, 'ready', stop.blockedReason);
  assert.deepEqual(destroyedDisplayIds, [779]);
});

test('macOS real driver default launcher supports bundle id and app path targets', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner = {
    execFileSync: (command: string, args: string[]) => {
      calls.push({ command, args });
      if (command === 'ps') return '9123\tcom.example.Editor\n9124\t/Applications/Example Editor.app\n';
      return '';
    },
  };

  const bundleLaunch = defaultLaunchMacosTargetApp(
    { kind: 'generic-editor', bundleId: 'com.example.Editor' },
    { runId: 'macos-bundle-launch-test', targetAppKind: 'generic-editor' },
    runner,
  );
  const pathLaunch = defaultLaunchMacosTargetApp(
    { kind: 'generic-editor', appPath: '/Applications/Example Editor.app' },
    { runId: 'macos-path-launch-test', targetAppKind: 'generic-editor' },
    runner,
  );

  assert.deepEqual(calls.filter((call) => call.command === 'open'), [
    { command: 'open', args: ['-b', 'com.example.Editor', '--background'] },
    { command: 'open', args: ['-a', '/Applications/Example Editor.app', '--background'] },
  ]);
  assert.deepEqual(bundleLaunch.pids, []);
  assert.equal(bundleLaunch.details?.launchMode, 'bundleId');
  assert.deepEqual(pathLaunch.pids, []);
  assert.equal(pathLaunch.details?.launchMode, 'appPath');

  const explicitDiscoveryLaunch = defaultLaunchMacosTargetApp(
    { kind: 'generic-editor', bundleId: 'com.example.Editor', processMatch: 'com\\.example\\.Editor' },
    { runId: 'macos-bundle-launch-discovery-test', targetAppKind: 'generic-editor' },
    runner,
  );
  assert.deepEqual(explicitDiscoveryLaunch.pids, [9123]);
});

test('macOS real driver target discovery matches process name and window title beyond child pids', () => {
  const matchedPids = findMacosTargetProcessIds('Example Editor|Helper', {
    execFileSync: () => '712\tExample Editor\n713\tUnrelated\n714\tEditor Helper\n',
  });

  const targetWindow = selectMacosCgTargetWindow([
    {
      pid: 4242,
      windowNumber: 1,
      ownerName: 'Child Process',
      title: 'Wrong window',
      layer: 0,
      x: 0,
      y: 0,
      width: 900,
      height: 700,
    },
    {
      pid: 712,
      windowNumber: 2,
      ownerName: 'Example Editor',
      title: 'Project Notes - SciForge',
      layer: 0,
      x: 1600,
      y: 0,
      width: 700,
      height: 500,
    },
  ], {
    pids: [4242, ...matchedPids],
    windowTitlePattern: 'SciForge$',
  });

  assert.deepEqual(matchedPids, [712, 714]);
  assert.equal(targetWindow?.pid, 712);
  assert.equal(targetWindow?.title, 'Project Notes - SciForge');
});

test('macOS target window readiness rejects shell, auth, protected, and read-only document titles', () => {
  const targetWindow = selectMacosCgTargetWindow([
    cgWindow(500, 1, 'Microsoft Word - Open Recent', 1200, 900),
    cgWindow(500, 2, 'Templates - Microsoft Word', 1180, 860),
    cgWindow(500, 3, 'Sign In to Microsoft Office', 1000, 760),
    cgWindow(500, 4, 'Quarterly Plan [Protected View]', 960, 740),
    cgWindow(500, 5, 'Quarterly Plan (Read-Only)', 940, 720),
    cgWindow(500, 6, 'Quarterly Plan.docx', 900, 700),
  ], {
    pids: [500],
    windowTitlePattern: '.*',
    editableWindowReadiness: {
      required: true,
      mode: 'document',
      requireNonEmptyTitle: true,
      rejectTitlePattern: 'Open Recent|Templates|Sign In|Protected View|Read-Only',
    },
  } as any);

  assert.equal(targetWindow?.windowNumber, 6);
  assert.equal(targetWindow?.title, 'Quarterly Plan.docx');
});

test('macOS target window readiness binds AX evidence to the selected CG window', () => {
  const targetCgWindow = cgWindow(500, 6, 'Quarterly Plan.docx', 900, 700);
  const wrongAxWindow = {
    pid: 500,
    windowIndex: 1,
    title: 'Microsoft Word - Open Recent',
    x: 1600,
    y: 0,
    width: 900,
    height: 700,
  };
  const matchingAxWindow = {
    pid: 500,
    windowIndex: 2,
    title: 'Quarterly Plan.docx',
    x: 1604,
    y: 4,
    width: 892,
    height: 692,
  };

  const selectedAxWindow = selectMacosAxWindowForCgWindow([
    wrongAxWindow,
    matchingAxWindow,
  ], targetCgWindow);

  assert.equal(selectedAxWindow?.windowIndex, 2);
  const wrongEvidence = macosEditableWindowReadinessEvidence({
    required: true,
    mode: 'document',
    requireAxWindow: true,
    requireNonEmptyTitle: true,
    rejectTitlePattern: 'Open Recent|Templates|Sign In|Protected View|Read-Only',
  }, targetCgWindow, wrongAxWindow);
  assert.equal(wrongEvidence.axWindowPresent, false);
  assert.equal(wrongEvidence.axWindowMatchesTarget, false);
  assert.equal(wrongEvidence.accepted, false);
});

test('macOS opt-in driver fails closed with public editable readiness reason when AX window is missing', async () => {
  const writes: Array<{ ref: string; data: unknown }> = [];
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('word'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: {
        kind: 'word',
        command: 'research-word',
        windowTitlePattern: '.*',
        editableWindowReadiness: {
          required: true,
          mode: 'document',
          requireAxWindow: true,
          requireNonEmptyTitle: true,
          rejectTitlePattern: 'Open Recent|Templates|Sign In|Protected View|Read-Only',
        },
      } as any,
      probeOptions: readyProbeOptions('word'),
      dependencies: fakeDriverDependencies({
        writes,
        waitForTargetWindow: () => ({
          cgWindow: {
            pid: 4242,
            windowNumber: 41,
            ownerName: 'Microsoft Word',
            title: 'Quarterly Plan.docx',
            layer: 0,
            x: 1600,
            y: 0,
            width: 1000,
            height: 700,
          },
          axWindow: undefined,
        }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-editable-readiness-no-ax-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['word'],
    provider,
    targetAppKind: 'word',
  });

  const result = await executor.attach(parsedAttachCommand('word'));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /editable target window readiness was not proven/i);
  assert.doesNotMatch(result.blockedReason ?? '', /VirtualDisplayProvider|Accessibility window identity|AX/u);
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.refs.liveSurfaceRef, undefined);
  const targetWindowWrite = writes.find((write) =>
    (write.data as { schemaVersion?: string }).schemaVersion === 'sciforge.virtual-display.macos.target-window.v1');
  assert.ok(targetWindowWrite);
  assert.match(JSON.stringify(targetWindowWrite?.data), /editableWindowReadiness/u);
});

test('macOS opt-in driver fails closed when editable readiness AX evidence belongs to a different same-pid window', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('word'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: {
        kind: 'word',
        command: 'research-word',
        windowTitlePattern: '.*',
        editableWindowReadiness: {
          required: true,
          mode: 'document',
          requireAxWindow: true,
          requireNonEmptyTitle: true,
          rejectTitlePattern: 'Open Recent|Templates|Sign In|Protected View|Read-Only',
        },
      } as any,
      probeOptions: readyProbeOptions('word'),
      dependencies: fakeDriverDependencies({
        waitForTargetWindow: () => ({
          cgWindow: {
            pid: 4242,
            windowNumber: 41,
            ownerName: 'Microsoft Word',
            title: 'Quarterly Plan.docx',
            layer: 0,
            x: 1600,
            y: 0,
            width: 1000,
            height: 700,
          },
          axWindow: {
            pid: 4242,
            windowIndex: 2,
            title: 'Microsoft Word - Open Recent',
            x: 1600,
            y: 0,
            width: 1000,
            height: 700,
          },
        }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-editable-readiness-wrong-ax-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['word'],
    provider,
    targetAppKind: 'word',
  });

  const result = await executor.attach(parsedAttachCommand('word'));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /editable target window readiness was not proven/i);
  assert.equal(result.evidence.providerExecuted, false);
});

test('macOS opt-in driver fails closed on invalid programmatic editable readiness reject regex', async () => {
  const destroyedDisplayIds: number[] = [];
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions('word'),
    hooks: createMacosVirtualDisplayDriverHooks({
      targetApp: {
        kind: 'word',
        command: 'research-word',
        windowTitlePattern: '.*',
        editableWindowReadiness: {
          required: true,
          mode: 'document',
          requireAxWindow: true,
          requireNonEmptyTitle: true,
          rejectTitlePattern: '[',
        },
      } as any,
      probeOptions: readyProbeOptions('word'),
      dependencies: fakeDriverDependencies({
        createVirtualDisplay: () => ({
          displayId: 777,
          displayIndex: 3,
          x: 1600,
          y: 0,
          width: 1440,
          height: 900,
          name: 'SciForge Test Display',
          destroy: () => {
            destroyedDisplayIds.push(777);
          },
        }),
      }),
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-editable-readiness-invalid-regex-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['word'],
    provider,
    targetAppKind: 'word',
  });

  const result = await executor.attach(parsedAttachCommand('word'));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /Invalid macOS target app editableWindowReadiness\.rejectTitlePattern regex/u);
  assert.deepEqual(destroyedDisplayIds, [777]);
  assert.equal(result.refs.liveSurfaceRef, undefined);
});

test('macOS opt-in driver files stay generic and source-boundary clean', async () => {
  const driverSource = await readFile(fileURLToPath(new URL('./macos-virtual-display-driver.ts', import.meta.url)), 'utf8');
  const helperSource = await readFile(fileURLToPath(new URL('./macos-native-driver-helpers.ts', import.meta.url)), 'utf8');

  for (const source of [driverSource, helperSource]) {
    assert.doesNotMatch(source, /tools\/computer-use-next|virtual-app-screen-vscode-smoke/);
    assert.doesNotMatch(source, /Visual Studio Code\.app|sciforge-vscode-virtual-app-screen-bridge|extensionDevelopmentPath/);
  }
});

function parsedAttachCommand(targetKind = 'generic-editor') {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    `--profile "${targetKind}"`,
    `--target-app-ref "app:profile/${targetKind}"`,
    '--screen-ref "virtual-app-screen:macos-driver-test/screen"',
    '--activation-ref "computer-use:macos-driver-test/attach-request.json"',
    '--adapter-readiness-ref "computer-use:macos-driver-test/provider-readiness.json"',
    '--evidence-ledger-ref "ledger:computer-use/macos-driver-test/screen-activation.json"',
    '--gui-present-ref "gui.present:macos-driver-test/screen-pane"',
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

function inputControlResult(context: NativeVirtualDisplayDriverInputControlContext) {
  return {
    ok: true,
    refs: inputControlRefs(context),
    mutatingActionExecuted: true,
    providerEvidenceWritten: true,
    affectsPhysicalDisplay: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
  };
}

function cgWindow(
  pid: number,
  windowNumber: number,
  title: string,
  width: number,
  height: number,
) {
  return {
    pid,
    windowNumber,
    ownerName: 'Microsoft Office',
    title,
    layer: 0,
    x: 1600,
    y: 0,
    width,
    height,
  };
}

function requiredString(value: string | string[] | undefined) {
  assert.equal(typeof value, 'string');
  return value as string;
}

function fakeDriverDependencies(overrides: Partial<MacosVirtualDisplayDriverDependencies> & {
  writes?: Array<{ ref: string; data: unknown }>;
} = {}): MacosVirtualDisplayDriverDependencies {
  const writes = overrides.writes ?? [];
  return {
    loadVirtualDisplayPackage: () => ({ createVirtualDisplay: true }),
    commandExists: () => true,
    probeScreenRecording: () => ({ ok: true }),
    probeAccessibility: () => ({ ok: true }),
    createVirtualDisplay: () => ({
      displayId: 777,
      displayIndex: 3,
      x: 1600,
      y: 0,
      width: 1440,
      height: 900,
      name: 'SciForge Test Display',
    }),
    listDisplays: () => [{
      id: 777,
      index: 3,
      x: 1600,
      y: 0,
      width: 1440,
      height: 900,
      main: false,
    }],
    launchApp: () => ({
      pids: [4242],
      details: { launchMode: 'fake-command' },
    }),
    waitForTargetWindow: () => ({
      cgWindow: {
        pid: 4242,
        windowNumber: 19,
        ownerName: 'Research Editor',
        title: 'Untitled',
        layer: 0,
        x: 1600,
        y: 0,
        width: 1000,
        height: 700,
      },
      axWindow: {
        pid: 4242,
        windowIndex: 1,
        title: 'Untitled',
        x: 1600,
        y: 0,
        width: 1000,
        height: 700,
      },
    }),
    moveWindow: () => ({
      ok: true,
      stdout: 'moved',
      targetBounds: {
        x: 1632,
        y: 32,
        width: 1376,
        height: 836,
      },
    }),
    captureDisplayFrame: (input) => ({
      frameRef: `${input.runDirRef}/virtual-display-provider/frames/current.json`,
      screenshotRef: `${input.runDirRef}/virtual-display-provider/frames/current.png`,
      frameRecord: {
        schemaVersion: 'sciforge.computer-use.screen-frame.v1',
        providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
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
    platform: 'darwin',
    targetAppKind,
    nodePackageAvailability: { 'node-mac-virtual-display': true },
    permissionGrants: {
      'permission:macos/screen-recording': true,
      'permission:macos/accessibility': true,
    },
  };
}
