import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  parseVirtualAppScreenRuntimeCommand,
  virtualAppScreenRuntimeCommandRunId,
} from '../virtual-app-screen-command.js';
import {
  attachVirtualAppScreenSession,
  virtualAppScreenSessionManagerResultToVirtualScreenData,
} from '../virtual-app-screen-session-manager.js';
import { createVirtualAppScreenNativeExecutor } from '../virtual-app-screen-native-executor.js';
import {
  probeVirtualDisplayProviders,
  type VirtualDisplayProviderOperationOptions,
  type VirtualDisplayReadiness,
} from '../virtual-display-provider.js';
import {
  MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
  createMacosVirtualDisplayProvider,
  type MacosVirtualDisplayProviderOperation,
} from './macos-virtual-display-provider.js';

const lifecycle: MacosVirtualDisplayProviderOperation[] = ['probe', 'createSession', 'launchApp', 'attachSurface', 'readFrame'];

test('macOS VirtualDisplayProvider defaults to fail-closed without side-effect hooks', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions(),
  });

  const probe = await provider.probe({ runId: 'macos-provider-no-hooks', targetAppKind: 'vscode' });

  assert.equal(probe.status, 'blocked');
  assert.equal(probe.providerId, MACOS_VIRTUAL_DISPLAY_PROVIDER_ID);
  assert.equal(probe.providerExecuted, false);
  assert.match(probe.blockedReason ?? '', /side-effect hook is not registered/);
  assert.equal(probe.refs.sessionRef, '.sciforge/vision-runs/macos-provider-no-hooks/virtual-display-provider/session.json');
  assert.equal(probe.refs.liveSurfaceRef, undefined);
  assert.equal(probe.rawPayloadWritten, false);
});

test('macOS VirtualDisplayProvider side-effect hooks can drive a native VirtualAppScreen attach', async () => {
  const calls: string[] = [];
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions(),
    hooks: Object.fromEntries(lifecycle.map((operation) => [
      operation,
      (options: VirtualDisplayProviderOperationOptions) => {
        calls.push(operation);
        return {
          providerExecuted: true,
          providerEvidenceWritten: true,
          readiness: readyReadiness(),
          refs: providerOwnedRefsFor(operation, options.runId, options.targetAppKind ?? 'vscode'),
        };
      },
    ])),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-side-effect-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['vscode-editor'],
    provider,
  });

  const command = parsedAttachCommand();
  const runId = virtualAppScreenRuntimeCommandRunId(command);
  const providerRoot = `.sciforge/vision-runs/${runId}/virtual-display-provider`;
  const result = await executor.attach(command);
  const data = virtualAppScreenSessionManagerResultToVirtualScreenData(command, result);

  assert.deepEqual(calls, lifecycle);
  assert.equal(result.status, 'attached');
  assert.equal(result.providerId, MACOS_VIRTUAL_DISPLAY_PROVIDER_ID);
  assert.equal(result.evidence.providerExecuted, true);
  assert.equal(result.evidence.nativeSessionCreated, true);
  assert.equal(result.evidence.liveFrameAttached, true);
  assert.equal(result.evidence.currentFrameMaterialized, true);
  assert.equal(result.refs.sessionRef, `${providerRoot}/session.json`);
  assert.equal(result.refs.liveSurfaceRef, `${providerRoot}/live-surface.json`);
  assert.equal(result.refs.currentFrameRef, `${providerRoot}/frames/current.png`);
  assert.equal(data.attachState, 'attached');
  assert.equal(data.surfaceMode, 'live');
});

test('macOS VirtualDisplayProvider blocks native attach when a lifecycle hook is missing', async () => {
  const calls: string[] = [];
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions(),
    hooks: Object.fromEntries(lifecycle
      .filter((operation) => operation !== 'readFrame')
      .map((operation) => [
        operation,
        (options: VirtualDisplayProviderOperationOptions) => {
          calls.push(operation);
          return {
            providerExecuted: true,
            providerEvidenceWritten: true,
            readiness: readyReadiness(),
            refs: providerOwnedRefsFor(operation, options.runId, options.targetAppKind ?? 'vscode'),
          };
        },
      ])),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-missing-read-frame-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['*'],
    provider,
  });

  const result = await executor.attach(parsedAttachCommand());

  assert.deepEqual(calls, ['probe', 'createSession', 'launchApp', 'attachSurface']);
  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /readFrame side-effect hook is not registered/);
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.refs.currentFrameRef, undefined);
});

test('macOS VirtualDisplayProvider hook errors fail closed without raw provider payload', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions(),
    hooks: {
      probe: () => {
        throw new Error('native helper crashed with local implementation detail');
      },
    },
  });

  const result = await provider.probe({ runId: 'macos-provider-hook-error', targetAppKind: 'vscode' });

  assert.equal(result.status, 'blocked');
  assert.equal(result.providerExecuted, false);
  assert.match(result.blockedReason ?? '', /native helper crashed/);
  assert.equal(result.rawPayloadWritten, false);
});

test('macOS VirtualDisplayProvider hook must return provider-owned refs before ready', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions(),
    hooks: Object.fromEntries(lifecycle.map((operation) => [
      operation,
      () => ({ providerExecuted: true, readiness: readyReadiness() }),
    ])),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-provider-no-hook-refs-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['vscode-editor'],
    provider,
  });

  const result = await executor.attach(parsedAttachCommand());

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /hook did not return required provider-owned refs/);
  assert.equal(result.evidence.providerExecuted, false);
});

test('macOS VirtualDisplayProvider hook must write provider-owned evidence records before ready', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: readyProbeOptions(),
    hooks: Object.fromEntries(lifecycle.map((operation) => [
      operation,
      (options: VirtualDisplayProviderOperationOptions) => ({
        providerExecuted: true,
        readiness: readyReadiness(),
        refs: providerOwnedRefsFor(operation, options.runId, options.targetAppKind ?? 'vscode'),
      }),
    ])),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-provider-no-evidence-written-test',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['vscode-editor'],
    provider,
  });

  const result = await executor.attach(parsedAttachCommand());

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /hook did not write provider-owned evidence records/);
  assert.equal(result.evidence.providerExecuted, false);
});

test('macOS VirtualDisplayProvider stays generic and does not import smoke or VSCode bridge paths', async () => {
  const source = await readFile(fileURLToPath(new URL('./macos-virtual-display-provider.ts', import.meta.url)), 'utf8');

  assert.doesNotMatch(source, /tools\/computer-use-next|virtual-app-screen-vscode-smoke/);
  assert.doesNotMatch(source, /Visual Studio Code\.app|sciforge-vscode-virtual-app-screen-bridge|extensionDevelopmentPath/);
});

test('macOS VirtualDisplayProvider refs are generic for non-VSCode app kinds', async () => {
  const provider = createMacosVirtualDisplayProvider({
    probeOptions: {
      ...readyProbeOptions(),
      targetAppKind: 'generic',
    },
    hooks: Object.fromEntries(lifecycle.map((operation) => [
      operation,
      (options: VirtualDisplayProviderOperationOptions) => ({
        providerExecuted: true,
        providerEvidenceWritten: true,
        readiness: readyReadiness('generic'),
        refs: providerOwnedRefsFor(operation, options.runId, options.targetAppKind ?? 'generic'),
      }),
    ])),
  });
  const readFrame = await provider.readFrame({ runId: 'macos-generic-provider', targetAppKind: 'generic' });

  assert.equal(readFrame.status, 'ready');
  assert.equal(readFrame.providerExecuted, true);
  assert.equal(readFrame.refs.targetAppRef, 'app:macos-generic-provider/generic');
  assert.equal(readFrame.refs.targetWindowRef, 'window:macos-generic-provider/generic/main');
  assert.equal(readFrame.refs.liveSurfaceRef, '.sciforge/vision-runs/macos-generic-provider/virtual-display-provider/live-surface.json');
  assert.equal(readFrame.refs.frameStreamRef, '.sciforge/vision-runs/macos-generic-provider/virtual-display-provider/frame-stream.json');
  assert.equal(readFrame.refs.currentFrameRef, '.sciforge/vision-runs/macos-generic-provider/virtual-display-provider/frames/current.png');
});

function parsedAttachCommand() {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--profile "vscode-editor"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--screen-ref "virtual-app-screen:macos-side-effect-test/screen"',
    '--activation-ref "computer-use:macos-side-effect-test/attach-request.json"',
    '--adapter-readiness-ref "computer-use:macos-side-effect-test/provider-readiness.json"',
    '--evidence-ledger-ref "ledger:computer-use/macos-side-effect-test/screen-activation.json"',
    '--gui-present-ref "gui.present:macos-side-effect-test/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function readyProbeOptions() {
  return {
    platform: 'darwin',
    targetAppKind: 'vscode',
    nodePackageAvailability: { 'node-mac-virtual-display': true },
    permissionGrants: {
      'permission:macos/screen-recording': true,
      'permission:macos/accessibility': true,
    },
  };
}

function readyReadiness(targetAppKind = 'vscode'): VirtualDisplayReadiness {
  const readiness = probeVirtualDisplayProviders({
    ...readyProbeOptions(),
    targetAppKind,
  }).selectedReadiness;
  assert.ok(readiness);
  return readiness;
}

function providerOwnedRefsFor(
  operation: MacosVirtualDisplayProviderOperation,
  runIdInput: string,
  targetAppKind: string,
) {
  const runId = runIdInput.replace(/[^a-zA-Z0-9._:-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'macos-provider';
  const targetKind = targetAppKind.replace(/[^a-zA-Z0-9._:-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'generic';
  const root = `.sciforge/vision-runs/${runId}`;
  const providerRoot = `${root}/virtual-display-provider`;
  return {
    currentRunRef: `${root}/current-run.json`,
    adapterReadinessRef: `${providerRoot}/adapter-readiness.json`,
    sessionRef: `${providerRoot}/session.json`,
    sessionLeaseRef: `${providerRoot}/session-lease.json`,
    targetAppRef: `app:${runId}/${targetKind}`,
    targetWindowRef: operation === 'probe' || operation === 'createSession' ? undefined : `window:${runId}/${targetKind}/main`,
    liveSurfaceRef: operation === 'attachSurface' || operation === 'readFrame' ? `${providerRoot}/live-surface.json` : undefined,
    surfaceTransportRef: operation === 'attachSurface' || operation === 'readFrame' ? `${providerRoot}/surface-transport.json` : undefined,
    frameStreamRef: operation === 'attachSurface' || operation === 'readFrame' ? `${providerRoot}/frame-stream.json` : undefined,
    currentFrameRef: operation === 'readFrame' ? `${providerRoot}/frames/current.png` : undefined,
    frameTransportContractRef: operation === 'attachSurface' || operation === 'readFrame' ? `${providerRoot}/frame-transport-contract.json` : undefined,
    frameTelemetryRef: operation === 'attachSurface' || operation === 'readFrame' ? `${providerRoot}/frame-telemetry.json` : undefined,
    mediaChannelRef: operation === 'attachSurface' || operation === 'readFrame' ? `${providerRoot}/webrtc-video-track/live` : undefined,
    dataChannelRef: operation === 'attachSurface' || operation === 'readFrame' ? `${providerRoot}/webrtc-data-channel/control` : undefined,
    currentFrameSequence: operation === 'readFrame' ? '1' : undefined,
    evidenceLedgerRef: `${providerRoot}/evidence-ledger.json`,
  };
}
