import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVirtualDisplayScreenPayload,
  describeVirtualDisplayProviders,
  isVirtualDisplayReadinessControllable,
  invokeVirtualDisplayProvider,
  probeVirtualDisplayProviders,
  queryVirtualDisplayProviders,
  readVirtualDisplayProvider,
  selectVirtualDisplayProviderProbe,
  virtualDisplayReadinessToAdapterReadiness,
} from './virtual-display-provider.js';

function readyMacosProbe() {
  return probeVirtualDisplayProviders({
    platform: 'darwin',
    targetAppKind: 'VS Code',
    nodePackageAvailability: { 'node-mac-virtual-display': true },
    permissionGrants: {
      'permission:macos/screen-recording': true,
      'permission:macos/accessibility': true,
    },
  });
}

test('VirtualDisplayProvider catalog exposes one local native truth source per platform', () => {
  const darwin = describeVirtualDisplayProviders('darwin');
  const linux = describeVirtualDisplayProviders('linux');
  const win32 = describeVirtualDisplayProviders('win32');

  assert.deepEqual(darwin.map((provider) => provider.providerId), [
    'virtual-display.macos.cgvirtualdisplay-screencapturekit',
  ]);
  assert.deepEqual(linux.map((provider) => provider.providerId), ['virtual-display.linux.xpra']);
  assert.deepEqual(win32.map((provider) => provider.providerId), ['virtual-display.windows.idd']);
  assert.ok([...darwin, ...linux, ...win32].every((provider) => provider.schemaVersion === 'sciforge.virtual-display.provider-description.v1'));

  const macos = darwin[0];
  assert.deepEqual(macos?.supportedTransports, ['webrtc', 'native-frame-stream']);
  assert.equal(macos?.capabilities.affectsPhysicalDisplay, false);
  assert.equal(macos?.capabilities.requiresFocusSteal, false);
  assert.equal(macos?.capabilities.sharedSystemInputUsed, false);
  assert.ok(macos?.permissionRefs?.includes('permission:macos/screen-recording'));
});

test('VirtualDisplayProvider probe fail-closes when macOS virtual display package or permissions are missing', () => {
  const missingPackage = probeVirtualDisplayProviders({
    platform: 'darwin',
    targetAppKind: 'vscode',
    nodePackageAvailability: { 'node-mac-virtual-display': false },
  });

  assert.equal(missingPackage.status, 'blocked');
  assert.equal(missingPackage.selectedProviderId, 'virtual-display.macos.cgvirtualdisplay-screencapturekit');
  assert.equal(missingPackage.selectedReadiness?.installationStatus, 'installable');
  assert.equal(missingPackage.selectedReadiness?.captureSupported, false);
  assert.match(String(missingPackage.blockedReason), /installable but not installed/);
  assert.equal(isVirtualDisplayReadinessControllable(missingPackage.selectedReadiness), false);

  const missingPermission = probeVirtualDisplayProviders({
    platform: 'darwin',
    targetAppKind: 'vscode',
    nodePackageAvailability: { 'node-mac-virtual-display': true },
    permissionGrants: {
      'permission:macos/screen-recording': true,
      'permission:macos/accessibility': false,
    },
  });

  assert.equal(missingPermission.status, 'blocked');
  assert.equal(missingPermission.selectedReadiness?.installationStatus, 'installed');
  assert.equal(missingPermission.selectedReadiness?.inputSupported, false);
  assert.match(String(missingPermission.blockedReason), /permission or driver readiness is not proven/);
});

test('VirtualDisplayProvider accepts only the local native macOS provider for VSCode readiness', () => {
  const bundle = readyMacosProbe();

  assert.equal(bundle.status, 'ready');
  assert.equal(bundle.targetAppKind, 'vscode');
  assert.equal(bundle.selectedProviderId, 'virtual-display.macos.cgvirtualdisplay-screencapturekit');
  assert.equal(bundle.selectedReadiness?.selectedTransport, 'webrtc');
  assert.equal(bundle.selectedReadiness?.backgroundRenderable, true);
  assert.equal(bundle.selectedReadiness?.affectsPhysicalDisplay, false);
  assert.equal(bundle.selectedReadiness?.requiresFocusSteal, false);
  assert.equal(bundle.selectedReadiness?.sharedSystemInputUsed, false);
  assert.equal(isVirtualDisplayReadinessControllable(bundle.selectedReadiness), true);

  const adapterReadiness = virtualDisplayReadinessToAdapterReadiness(bundle.selectedReadiness!);
  assert.equal(adapterReadiness.captureSupported, true);
  assert.equal(adapterReadiness.backgroundRenderable, true);
  assert.deepEqual(adapterReadiness.supportedActions, ['click', 'type_text', 'drag', 'scroll', 'hotkey', 'menu_command']);
  assert.ok(adapterReadiness.schemaRefs.includes('sciforge.virtual-display.readiness.v1'));
});

test('VirtualDisplayProvider screen payload emits live refs only for controllable readiness', () => {
  const blocked = probeVirtualDisplayProviders({
    platform: 'darwin',
    targetAppKind: 'vscode',
    nodePackageAvailability: { 'node-mac-virtual-display': false },
  });
  const blockedPayload = buildVirtualDisplayScreenPayload({
    runId: 'blocked-vscode',
    targetAppKind: 'vscode',
    targetAppName: 'VSCode',
    probeBundle: blocked,
  });

  assert.equal(blockedPayload.status, 'blocked');
  assert.equal(blockedPayload.attachState, 'adapter-unavailable');
  assert.equal(blockedPayload.currentFrameRef, undefined);
  assert.equal(blockedPayload.sessionRef, undefined);
  assert.equal(blockedPayload.isolationFlags.diagnosticOnly, true);
  assert.match(String(blockedPayload.blockedReason), /not installed/);

  const readyPayload = buildVirtualDisplayScreenPayload({
    runId: 'ready-vscode',
    targetAppKind: 'vscode',
    targetAppName: 'VSCode',
    probeBundle: readyMacosProbe(),
  });

  assert.equal(readyPayload.status, 'ready');
  assert.equal(readyPayload.attachState, 'attached');
  assert.equal(readyPayload.sessionRef, 'computer-use:session/ready-vscode/virtual-display-session.json');
  assert.equal(readyPayload.currentFrameRef, '.sciforge/vision-runs/ready-vscode/virtual-display-provider/frames/after.json');
  assert.deepEqual(readyPayload.inputIntentRefs, ['.sciforge/vision-runs/ready-vscode/virtual-display-provider/input-intents/click-and-type.json']);
  assert.deepEqual(readyPayload.beforeAfterFrameRefs, ['.sciforge/vision-runs/ready-vscode/virtual-display-provider/before-after/input.json']);
  assert.equal(readyPayload.isolationFlags.diagnosticOnly, false);
});

test('VirtualDisplayProvider keeps Linux Xpra as the only Linux provider', () => {
  const blocked = probeVirtualDisplayProviders({
    platform: 'linux',
    targetAppKind: 'vscode',
    commandAvailability: { xpra: false },
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.selectedProviderId, 'virtual-display.linux.xpra');
  assert.equal(blocked.probes.length, 1);

  const ready = probeVirtualDisplayProviders({
    platform: 'linux',
    targetAppKind: 'vscode',
    commandAvailability: { xpra: true },
  });
  const selected = selectVirtualDisplayProviderProbe(ready.probes);

  assert.equal(ready.status, 'ready');
  assert.equal(selected?.description.providerId, 'virtual-display.linux.xpra');
  assert.deepEqual(selected?.description.supportedTransports, ['webrtc', 'native-frame-stream']);
});

test('VirtualDisplayProvider supports describe/query/read plus fail-closed invoke intents', () => {
  const queried = queryVirtualDisplayProviders({
    platform: 'darwin',
    targetAppKind: 'vscode',
    supportedTransport: 'webrtc',
    supportedInputAdapter: 'ax',
  });
  assert.deepEqual(queried.map((provider) => provider.providerId), ['virtual-display.macos.cgvirtualdisplay-screencapturekit']);

  const provider = readVirtualDisplayProvider('virtual-display.macos.cgvirtualdisplay-screencapturekit', { platform: 'darwin' });
  assert.equal(provider?.backendKind, 'cgvirtualdisplay-screencapturekit');

  const blocked = invokeVirtualDisplayProvider({
    intent: 'createSession',
    runId: 'invoke-blocked',
    targetAppKind: 'vscode',
    probeOptions: {
      platform: 'darwin',
      nodePackageAvailability: { 'node-mac-virtual-display': false },
    },
  });
  assert.equal(blocked.status, 'requires-handoff');
  assert.equal(blocked.mutatingActionExecuted, false);
  assert.equal(blocked.rawPayloadWritten, false);
  assert.match(String(blocked.refs.blockedRef), /virtual-display-provider\/blocked\.json/);

  const readyProbe = readyMacosProbe();
  const createSession = invokeVirtualDisplayProvider({
    intent: 'createSession',
    runId: 'invoke-ready',
    targetAppKind: 'vscode',
    probeBundle: readyProbe,
  });
  assert.equal(createSession.status, 'ready');
  assert.equal(createSession.refs.sessionRef, 'computer-use:session/invoke-ready/virtual-display-session.json');
  assert.equal(createSession.refs.screenRef, 'virtual-app-screen:invoke-ready/screen');

  const input = invokeVirtualDisplayProvider({
    intent: 'executeInputIntent',
    runId: 'invoke-ready',
    targetAppKind: 'vscode',
    probeBundle: readyProbe,
  });
  assert.equal(input.status, 'ready');
  assert.equal(input.mutatingActionExecuted, true);
  assert.deepEqual(input.refs.beforeAfterFrameRefs, ['.sciforge/vision-runs/invoke-ready/virtual-display-provider/before-after/input.json']);
  assert.deepEqual(input.refs.executorEventRefs, ['.sciforge/vision-runs/invoke-ready/virtual-display-provider/executor-events/click-and-type.json']);
});
