import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  parseVirtualAppScreenRuntimeCommand,
  virtualAppScreenRuntimeCommandRunId,
} from '../virtual-app-screen-command.js';
import { sanitizeId } from '../utils.js';
import { createVirtualAppScreenNativeExecutor } from '../virtual-app-screen-native-executor.js';
import { probeVirtualDisplayProviders, type VirtualDisplayReadiness } from '../virtual-display-provider.js';
import {
  LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
  createLinuxXpraVirtualDisplayProvider,
} from './linux-xpra-virtual-display-provider.js';
import type { PlatformVirtualDisplayProviderHooks } from './platform-virtual-display-provider-shell.js';
import {
  WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
  createWindowsIddVirtualDisplayProvider,
} from './windows-idd-virtual-display-provider.js';

const lifecycle = ['probe', 'createSession', 'launchApp', 'attachSurface', 'readFrame'] as const;

test('Linux Xpra provider shell defaults to fail-closed without side-effect hooks', async () => {
  const provider = createLinuxXpraVirtualDisplayProvider({
    probeOptions: readyLinuxProbeOptions(),
  });

  const probe = await provider.probe({ runId: 'linux-xpra-no-hooks', targetAppKind: 'generic' });

  assert.equal(probe.status, 'blocked');
  assert.equal(probe.providerId, LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID);
  assert.equal(probe.providerExecuted, false);
  assert.equal(probe.rawPayloadWritten, false);
  assert.match(probe.blockedReason ?? '', /Linux Xpra VirtualDisplayProvider probe side-effect hook is not registered/);
  assert.equal(probe.refs.sessionRef, '.sciforge/vision-runs/linux-xpra-no-hooks/virtual-display-provider/session.json');
  assert.equal(probe.refs.liveSurfaceRef, undefined);
  assert.equal(probe.refs.currentFrameRef, undefined);
});

test('Windows IDD provider shell defaults to fail-closed without side-effect hooks', async () => {
  const provider = createWindowsIddVirtualDisplayProvider({
    probeOptions: readyWindowsProbeOptions(),
  });

  const probe = await provider.probe({ runId: 'windows-idd-no-hooks', targetAppKind: 'generic' });

  assert.equal(probe.status, 'blocked');
  assert.equal(probe.providerId, WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID);
  assert.equal(probe.providerExecuted, false);
  assert.equal(probe.rawPayloadWritten, false);
  assert.match(probe.blockedReason ?? '', /Windows IDD VirtualDisplayProvider probe side-effect hook is not registered/);
  assert.equal(probe.refs.sessionRef, '.sciforge/vision-runs/windows-idd-no-hooks/virtual-display-provider/session.json');
  assert.equal(probe.refs.liveSurfaceRef, undefined);
  assert.equal(probe.refs.currentFrameRef, undefined);
});

test('Linux and Windows provider shells can drive native attach only through injected hooks', async (t) => {
  const cases = [
    {
      name: 'linux',
      providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
      provider: createLinuxXpraVirtualDisplayProvider({
        probeOptions: readyLinuxProbeOptions(),
        hooks: readyHooks(() => readyLinuxReadiness()),
      }),
    },
    {
      name: 'windows',
      providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
      provider: createWindowsIddVirtualDisplayProvider({
        probeOptions: readyWindowsProbeOptions(),
        hooks: readyHooks(() => readyWindowsReadiness()),
      }),
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const executor = createVirtualAppScreenNativeExecutor({
        executorId: `native-session-manager:${testCase.name}-provider-shell-test`,
        providerId: testCase.providerId,
        supportedProfiles: ['generic-editor'],
        provider: testCase.provider,
        targetAppKind: 'generic-editor',
      });

      const command = parsedAttachCommand(testCase.name);
      const result = await executor.attach(command);
      const runId = sanitizeId(virtualAppScreenRuntimeCommandRunId(command));
      const providerRoot = `.sciforge/vision-runs/${runId}/virtual-display-provider`;

      assert.equal(result.status, 'attached');
      assert.equal(result.providerId, testCase.providerId);
      assert.equal(result.evidence.providerExecuted, true);
      assert.equal(result.evidence.surfaceTransport?.owner, 'VirtualDisplayProvider');
      assert.equal(result.evidence.surfaceTransport?.transport, 'webrtc');
      assert.match(requiredString(result.refs.sessionRef), /^computer-use:native-host\/sessions\//u);
      assert.match(requiredString(result.refs.liveSurfaceRef), /^computer-use:native-host\/surfaces\//u);
      assert.match(requiredString(result.refs.currentFrameRef), /^computer-use:native-host\/frames\//u);
      assert.match(requiredString(result.refs.surfaceTransportRef), /^computer-use:native-host\/surfaces\//u);
      assert.match(requiredString(result.refs.frameTransportContractRef), /^computer-use:native-host\/surfaces\//u);
      for (const ref of [
        `${providerRoot}/session.json`,
        `${providerRoot}/frames/current.png`,
        `${providerRoot}/surface-transport.json`,
        `${providerRoot}/frame-transport-contract.json`,
      ]) {
        assert.ok(result.evidence.evidenceRefs.includes(ref), `missing provider evidence ref ${ref}`);
      }
    });
  }
});

test('Linux and Windows provider shells reject ready hooks without provider-owned refs', async () => {
  const provider = createLinuxXpraVirtualDisplayProvider({
    probeOptions: readyLinuxProbeOptions(),
    hooks: readyHooksWithoutRefs(() => readyLinuxReadiness()),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:linux-provider-shell-no-refs-test',
    providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });

  const result = await executor.attach(parsedAttachCommand('linux-no-hook-refs'));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /hook did not return required provider-owned refs/);
  assert.equal(result.evidence.providerExecuted, false);
});

test('Linux and Windows provider shells reject ready hooks that did not write provider evidence records', async () => {
  const provider = createLinuxXpraVirtualDisplayProvider({
    probeOptions: readyLinuxProbeOptions(),
    hooks: readyHooksWithoutEvidenceWritten(() => readyLinuxReadiness()),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:linux-provider-shell-no-evidence-written-test',
    providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: ['generic-editor'],
    provider,
    targetAppKind: 'generic-editor',
  });

  const result = await executor.attach(parsedAttachCommand('linux-no-evidence-written'));

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /hook did not write provider-owned evidence records/);
  assert.equal(result.evidence.providerExecuted, false);
});

test('Linux and Windows provider shell files stay generic and source-boundary clean', async () => {
  const sources = await Promise.all([
    readFile(fileURLToPath(new URL('./platform-virtual-display-provider-shell.ts', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('./linux-xpra-virtual-display-provider.ts', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('./windows-idd-virtual-display-provider.ts', import.meta.url)), 'utf8'),
  ]);

  for (const source of sources) {
    assert.doesNotMatch(source, /tools\/computer-use-next|virtual-app-screen-vscode-smoke/);
    assert.doesNotMatch(source, /Visual Studio Code\.app|sciforge-vscode-virtual-app-screen-bridge|extensionDevelopmentPath/);
    assert.doesNotMatch(source, /Xvfb|noVNC|RDP|QEMU/);
  }
});

function readyHooks(readiness: () => VirtualDisplayReadiness): PlatformVirtualDisplayProviderHooks {
  return Object.fromEntries(lifecycle.map((operation) => [
    operation,
    (options) => ({
      providerExecuted: true,
      providerEvidenceWritten: true,
      readiness: readiness(),
      refs: providerOwnedRefsFor(operation, options.runId || 'provider-shell-test', options.targetAppKind ?? 'generic-editor'),
    }),
  ]));
}

function readyHooksWithoutRefs(readiness: () => VirtualDisplayReadiness): PlatformVirtualDisplayProviderHooks {
  return Object.fromEntries(lifecycle.map((operation) => [
    operation,
    () => ({ providerExecuted: true, readiness: readiness() }),
  ]));
}

function readyHooksWithoutEvidenceWritten(readiness: () => VirtualDisplayReadiness): PlatformVirtualDisplayProviderHooks {
  return Object.fromEntries(lifecycle.map((operation) => [
    operation,
    (options) => ({
      providerExecuted: true,
      readiness: readiness(),
      refs: providerOwnedRefsFor(operation, options.runId || 'provider-shell-test', options.targetAppKind ?? 'generic-editor'),
    }),
  ]));
}

function providerOwnedRefsFor(operation: typeof lifecycle[number], runIdInput: string, targetAppKind: string) {
  const runId = sanitizeId(runIdInput);
  const targetKind = sanitizeId(targetAppKind);
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

function parsedAttachCommand(runId: string) {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--profile "generic-editor"',
    '--target-app-ref "app:profile/generic-editor"',
    `--screen-ref "virtual-app-screen:${runId}-provider-shell-test/screen"`,
    `--activation-ref "computer-use:${runId}-provider-shell-test/attach-request.json"`,
    `--adapter-readiness-ref "computer-use:${runId}-provider-shell-test/provider-readiness.json"`,
    `--evidence-ledger-ref "ledger:computer-use/${runId}-provider-shell-test/screen-activation.json"`,
    `--gui-present-ref "gui.present:${runId}-provider-shell-test/screen-pane"`,
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function requiredString(value: string | string[] | undefined) {
  assert.equal(typeof value, 'string');
  return value as string;
}

function readyLinuxProbeOptions() {
  return {
    platform: 'linux',
    targetAppKind: 'generic-editor',
    commandAvailability: { xpra: true },
  };
}

function readyWindowsProbeOptions() {
  return {
    platform: 'win32',
    targetAppKind: 'generic-editor',
    manualRequirementAvailability: {
      'windows-idd-virtual-display-driver': true,
    },
    permissionGrants: {
      'permission:windows/idd-driver-authorized': true,
    },
  };
}

function readyLinuxReadiness(): VirtualDisplayReadiness {
  const readiness = probeVirtualDisplayProviders(readyLinuxProbeOptions()).selectedReadiness;
  assert.ok(readiness);
  return readiness;
}

function readyWindowsReadiness(): VirtualDisplayReadiness {
  const readiness = probeVirtualDisplayProviders(readyWindowsProbeOptions()).selectedReadiness;
  assert.ok(readiness);
  return readiness;
}
