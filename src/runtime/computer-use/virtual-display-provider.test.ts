import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VIRTUAL_DISPLAY_FRAME_TELEMETRY_SCHEMA,
  VIRTUAL_DISPLAY_FRAME_TRANSPORT_CONTRACT_SCHEMA,
  VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS,
  VIRTUAL_DISPLAY_SURFACE_TRANSPORT_DESCRIPTOR_SCHEMA,
  buildVirtualDisplayScreenPayload,
  buildVirtualDisplayPlatformReadinessRecords,
  createVirtualDisplayProviderContract,
  describeVirtualDisplayProviders,
  isVirtualDisplayReadinessControllable,
  invokeVirtualDisplayProvider,
  probeVirtualDisplayProviders,
  queryVirtualDisplayProviders,
  readVirtualDisplayProvider,
  selectVirtualDisplayProviderProbe,
  summarizeVirtualDisplayFrameTelemetry,
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
  assert.equal(macos?.supportedTransports.some((transport) => /vnc|rdp|mjpeg/i.test(transport)), false);
  assert.equal(macos?.capabilities.affectsPhysicalDisplay, false);
  assert.equal(macos?.capabilities.requiresFocusSteal, false);
  assert.equal(macos?.capabilities.sharedSystemInputUsed, false);
  assert.equal(macos?.capabilities.sendInputIntent, true);
  assert.ok(macos?.permissionRefs?.includes('permission:macos/screen-recording'));
});

test('VirtualDisplayProvider L1 contract exposes refs-first lifecycle method projections', () => {
  assert.deepEqual(Object.keys(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS), [
    'probe',
    'createSession',
    'launchApp',
    'attachSurface',
    'readFrame',
    'sendInputIntent',
    'pause',
    'resume',
    'handoff',
    'closeSession',
  ]);
  assert.ok(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS.attachSurface.includes('currentRunRef'));
  assert.ok(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS.attachSurface.includes('surfaceTransportRef'));
  assert.ok(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS.attachSurface.includes('frameTransportContractRef'));
  assert.ok(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS.attachSurface.includes('lifecycleLedgerRef'));
  assert.ok(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS.readFrame.includes('surfaceTransportRef'));
  assert.ok(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS.readFrame.includes('currentFrameSequence'));
  assert.ok(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS.readFrame.includes('evidenceLedgerRef'));
  assert.ok(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS.sendInputIntent.includes('inputHotPathRef'));
  assert.ok(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS.sendInputIntent.includes('inputLeaseRef'));
  assert.ok(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS.pause.includes('lifecycleEventRef'));
  assert.ok(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS.resume.includes('sessionLeaseRef'));
  assert.ok(VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS.handoff.includes('handoffRef'));

  const contract = createVirtualDisplayProviderContract({
    runId: 'contract-ready',
    targetAppKind: 'vscode',
    probeBundle: readyMacosProbe(),
  });

  const session = contract.createSession({ runId: 'contract-ready' });
  assert.equal(session.status, 'ready');
  assert.equal(session.refs.sessionRef, 'computer-use:session/contract-ready/virtual-display-session.json');
  assert.equal(session.refs.currentRunRef, '.sciforge/vision-runs/contract-ready/current-run.json');
  assert.equal(session.refs.sessionLeaseRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/session-lease.json');
  assert.equal(session.refs.lifecycleLedgerRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/lifecycle-ledger.json');
  assert.equal(session.refs.lifecycleEventRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/lifecycle-ledger.json#create-session');
  assert.equal(session.refs.evidenceLedgerRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/evidence-ledger.json');
  assert.equal(session.refs.beforeFrameRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/frames/before.json');
  assert.equal(session.refs.afterFrameRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/frames/after.json');
  assert.equal(session.mutatingActionExecuted, false);
  assert.equal(session.rawPayloadWritten, false);

  const launch = contract.launchApp({ runId: 'contract-ready' });
  assert.equal(launch.status, 'ready');
  assert.equal(launch.refs.lifecycleEventRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/lifecycle-ledger.json#launch-app');

  const attach = contract.attachSurface({ runId: 'contract-ready' });
  assert.equal(attach.status, 'ready');
  assert.equal(attach.refs.lifecycleEventRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/lifecycle-ledger.json#attach-surface');
  assert.equal(attach.refs.surfaceTransportRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/surface-transport.json');
  assert.equal(attach.refs.frameTransportContractRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/frame-transport-contract.json');
  assert.equal(attach.refs.evidenceLedgerRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/evidence-ledger.json');
  assert.equal(attach.surfaceTransport?.schemaVersion, VIRTUAL_DISPLAY_SURFACE_TRANSPORT_DESCRIPTOR_SCHEMA);
  assert.equal(attach.surfaceTransport?.transport, 'webrtc');
  assert.equal(attach.surfaceTransport?.surfaceTransportRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/surface-transport.json');
  assert.equal(attach.surfaceTransport?.frameTransportContractRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/frame-transport-contract.json');
  assert.equal(attach.surfaceTransport?.diagnosticOnly, false);
  assert.equal(attach.surfaceTransport?.productFallback, false);

  const frame = contract.readFrame({ runId: 'contract-ready' });
  assert.equal(frame.status, 'ready');
  assert.equal(frame.refs.currentFrameRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/frames/after.json');
  assert.equal(frame.refs.surfaceTransportRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/surface-transport.json');
  assert.equal(frame.refs.frameTransportContractRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/frame-transport-contract.json');
  assert.equal(frame.refs.frameTelemetryRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/frame-telemetry.json');
  assert.equal(frame.refs.currentFrameSequence, '3');
  assert.equal(frame.surfaceTransport?.currentFrameRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/frames/after.json');
  assert.equal(frame.surfaceTransport?.currentFrameSequence, 3);
  assert.equal(frame.mutatingActionExecuted, false);

  const input = contract.sendInputIntent({ runId: 'contract-ready' });
  assert.equal(input.status, 'ready');
  assert.equal(input.mutatingActionExecuted, true);
  assert.equal(input.refs.inputHotPathRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/input-hot-path.json');
  assert.deepEqual(input.refs.inputIntentRefs, ['.sciforge/vision-runs/contract-ready/virtual-display-provider/input-intents/click-and-type.json']);
  assert.equal(input.refs.inputLeaseRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/input-lease.json');
  assert.equal(input.refs.evidenceLedgerRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/evidence-ledger.json');

  const pause = contract.pause({ runId: 'contract-ready' });
  assert.equal(pause.status, 'ready');
  assert.equal(pause.refs.lifecycleEventRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/lifecycle-ledger.json#pause');
  const resume = contract.resume({ runId: 'contract-ready' });
  assert.equal(resume.status, 'ready');
  assert.equal(resume.refs.lifecycleEventRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/lifecycle-ledger.json#resume');
  const handoff = contract.handoff({ runId: 'contract-ready' });
  assert.equal(handoff.status, 'ready');
  assert.equal(handoff.refs.handoffRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/lifecycle-ledger.json#handoff');
  const close = contract.closeSession({ runId: 'contract-ready' });
  assert.equal(close.status, 'ready');
  assert.equal(close.refs.lifecycleEventRef, '.sciforge/vision-runs/contract-ready/virtual-display-provider/lifecycle-ledger.json#close-session');
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

  assert.equal(missingPermission.status, 'permission-missing');
  assert.equal(missingPermission.selectedReadiness?.installationStatus, 'installed');
  assert.equal(missingPermission.selectedReadiness?.installState, 'installed');
  assert.equal(missingPermission.selectedReadiness?.readinessStatus, 'permission-missing');
  assert.equal(missingPermission.selectedReadiness?.inputSupported, false);
  assert.deepEqual(missingPermission.selectedReadiness?.permissions.missingRefs, ['permission:macos/accessibility']);
  assert.match(String(missingPermission.blockedReason), /permission or driver readiness is not proven/);
});

test('VirtualDisplayProvider accepts only the local native macOS provider for VSCode readiness', () => {
  const bundle = readyMacosProbe();

  assert.equal(bundle.status, 'ready');
  assert.equal(bundle.targetAppKind, 'vscode');
  assert.equal(bundle.selectedProviderId, 'virtual-display.macos.cgvirtualdisplay-screencapturekit');
  assert.equal(bundle.selectedReadiness?.selectedTransport, 'webrtc');
  assert.equal(bundle.selectedReadiness?.providerKind, 'cgvirtualdisplay-screencapturekit');
  assert.equal(bundle.selectedReadiness?.readinessStatus, 'ready');
  assert.equal(bundle.selectedReadiness?.permissions.state, 'granted');
  assert.equal(bundle.selectedReadiness?.backgroundRenderability.proven, true);
  assert.equal(bundle.selectedReadiness?.physicalDesktopImpact.impact, 'none');
  assert.equal(bundle.selectedReadiness?.inputIsolation.isolated, true);
  assert.equal(bundle.selectedReadiness?.frameTransportReadiness?.contractSchemaVersion, VIRTUAL_DISPLAY_FRAME_TRANSPORT_CONTRACT_SCHEMA);
  assert.equal(bundle.selectedReadiness?.frameTransportReadiness?.telemetrySchemaVersion, VIRTUAL_DISPLAY_FRAME_TELEMETRY_SCHEMA);
  assert.equal(bundle.selectedReadiness?.frameTransportReadiness?.lowLatency, true);
  assert.equal(bundle.selectedReadiness?.frameTransportReadiness?.p50EndToEndMs, 35);
  assert.equal(bundle.selectedReadiness?.frameTransportReadiness?.p95EndToEndMs, 37);
  assert.equal(bundle.selectedReadiness?.frameTransportReadiness?.currentFrameSequence, 3);
  assert.equal(bundle.selectedReadiness?.frameTransportReadiness?.dropRate, 0.25);
  assert.equal(bundle.selectedReadiness?.frameTransportReadiness?.backpressureEventCount, 1);
  assert.equal(bundle.selectedReadiness?.frameTransportReadiness?.frameStreamIsTruthSource, false);
  assert.equal(bundle.selectedReadiness?.inputHotPath?.priority, 'input-first');
  assert.equal(bundle.selectedReadiness?.inputHotPath?.blockedByScreenshot, false);
  assert.equal(bundle.selectedReadiness?.inputHotPath?.blockedByOcr, false);
  assert.equal(bundle.selectedReadiness?.inputHotPath?.blockedByReplay, false);
  assert.equal(bundle.selectedReadiness?.inputHotPath?.blockedByEvidenceCapture, false);
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
  assert.equal(adapterReadiness.frameTransportReadiness?.frameStreamIsTruthSource, false);
});

test('VirtualDisplayProvider emits platform readiness records for macOS, Linux, and Windows', () => {
  const records = buildVirtualDisplayPlatformReadinessRecords({
    darwin: {
      nodePackageAvailability: { 'node-mac-virtual-display': true },
      permissionGrants: {
        'permission:macos/screen-recording': true,
        'permission:macos/accessibility': true,
      },
    },
    linux: {
      commandAvailability: { xpra: false },
    },
    win32: {
      manualRequirementAvailability: { 'windows-idd-virtual-display-driver': true },
      permissionGrants: { 'permission:windows/idd-driver-authorized': false },
    },
  });

  assert.deepEqual(records.map((record) => record.platform), ['darwin', 'linux', 'win32']);
  assert.deepEqual(records.map((record) => record.providerKind), [
    'cgvirtualdisplay-screencapturekit',
    'xpra-app-session',
    'windows-indirect-display-driver',
  ]);
  assert.deepEqual(records.map((record) => record.installState), ['installed', 'installable', 'installed']);
  assert.deepEqual(records.map((record) => record.status), ['ready', 'blocked', 'permission-missing']);
  assert.equal(records[0]?.backgroundRenderability.proven, true);
  assert.equal(records[0]?.physicalDesktopImpact.impact, 'none');
  assert.equal(records[0]?.inputIsolation.isolated, true);
  assert.deepEqual(records[2]?.permissions.missingRefs, ['permission:windows/idd-driver-authorized']);
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
  assert.equal(readyPayload.surfaceTransportRef, '.sciforge/vision-runs/ready-vscode/virtual-display-provider/surface-transport.json');
  assert.equal(readyPayload.surfaceTransportDescriptor?.schemaVersion, VIRTUAL_DISPLAY_SURFACE_TRANSPORT_DESCRIPTOR_SCHEMA);
  assert.equal(readyPayload.surfaceTransportDescriptor?.transport, 'webrtc');
  assert.equal(readyPayload.surfaceTransportDescriptor?.singleInteractiveTruth, true);
  assert.equal(readyPayload.frameTransportContractRef, '.sciforge/vision-runs/ready-vscode/virtual-display-provider/frame-transport-contract.json');
  assert.equal(readyPayload.frameTelemetryRef, '.sciforge/vision-runs/ready-vscode/virtual-display-provider/frame-telemetry.json');
  assert.equal(readyPayload.mediaChannelRef, '.sciforge/vision-runs/ready-vscode/virtual-display-provider/webrtc-video-track/live');
  assert.equal(readyPayload.dataChannelRef, '.sciforge/vision-runs/ready-vscode/virtual-display-provider/webrtc-data-channel/control');
  assert.equal(readyPayload.currentFrameSequence, 3);
  assert.equal(readyPayload.frameTransport?.schemaVersion, VIRTUAL_DISPLAY_FRAME_TRANSPORT_CONTRACT_SCHEMA);
  assert.equal(readyPayload.frameTransport?.media.kind, 'webrtc-video-track');
  assert.equal(readyPayload.frameTransport?.data.kind, 'webrtc-data-channel');
  assert.deepEqual(readyPayload.frameTransport?.data.carries, ['input-intent', 'frame-ack', 'telemetry', 'reconnect']);
  assert.equal(readyPayload.frameTransport?.singleInteractiveTruth, true);
  assert.deepEqual(readyPayload.frameTransport?.diagnosticOnlyBackings, { vnc: true, novnc: true, rdp: true, mjpeg: true });
  assert.deepEqual(readyPayload.frameTransport?.productFallbackBackings, { vnc: false, novnc: false, rdp: false, mjpeg: false });
  assert.equal(readyPayload.frameTelemetry?.schemaVersion, VIRTUAL_DISPLAY_FRAME_TELEMETRY_SCHEMA);
  assert.equal(readyPayload.frameTelemetry?.p50EndToEndMs, 35);
  assert.equal(readyPayload.frameTelemetry?.p95EndToEndMs, 37);
  assert.equal(readyPayload.frameTelemetry?.latencyBoundSatisfied, true);
  assert.equal(readyPayload.frameTelemetry?.totalDroppedFrames, 1);
  assert.equal(readyPayload.frameTelemetry?.backpressureEventCount, 1);
  assert.equal(readyPayload.frameTelemetry?.policy.frameStreamIsTruthSource, false);
  assert.equal(readyPayload.inputHotPath?.priority, 'input-first');
  assert.equal(readyPayload.inputHotPath?.blockedByScreenshot, false);
  assert.equal(readyPayload.inputHotPath?.blockedByOcr, false);
  assert.equal(readyPayload.inputHotPath?.blockedByReplay, false);
  assert.equal(readyPayload.inputHotPath?.blockedByEvidenceCapture, false);
  assert.deepEqual(readyPayload.inputIntentRefs, ['.sciforge/vision-runs/ready-vscode/virtual-display-provider/input-intents/click-and-type.json']);
  assert.deepEqual(readyPayload.beforeAfterFrameRefs, ['.sciforge/vision-runs/ready-vscode/virtual-display-provider/before-after/input.json']);
  assert.equal(readyPayload.isolationFlags.diagnosticOnly, false);
  assert.deepEqual(readyPayload.diagnosticOnlyTransports, { vnc: true, novnc: true, rdp: true, mjpeg: true });
  assert.deepEqual(readyPayload.productFallbackTransports, { vnc: false, novnc: false, rdp: false, mjpeg: false });
});

test('VirtualDisplayProvider never turns missing provider or permission state into a fallback pass', () => {
  const noProvider = probeVirtualDisplayProviders({
    platform: 'freebsd',
    targetAppKind: 'vscode',
  });
  assert.equal(noProvider.status, 'blocked');
  assert.equal(noProvider.selectedProviderId, undefined);
  assert.equal(noProvider.selectedReadiness, undefined);

  const noProviderPayload = buildVirtualDisplayScreenPayload({
    runId: 'no-provider',
    targetAppKind: 'vscode',
    probeBundle: noProvider,
  });
  assert.equal(noProviderPayload.status, 'blocked');
  assert.equal(noProviderPayload.liveSurfaceRef, undefined);
  assert.equal(noProviderPayload.frameStreamRef, undefined);
  assert.equal(noProviderPayload.currentFrameRef, undefined);
  assert.equal(noProviderPayload.isolationFlags.diagnosticOnly, true);

  const permissionMissing = probeVirtualDisplayProviders({
    platform: 'darwin',
    targetAppKind: 'vscode',
    nodePackageAvailability: { 'node-mac-virtual-display': true },
    permissionGrants: {
      'permission:macos/screen-recording': false,
      'permission:macos/accessibility': true,
    },
  });
  const permissionPayload = buildVirtualDisplayScreenPayload({
    runId: 'permission-missing',
    targetAppKind: 'vscode',
    probeBundle: permissionMissing,
  });
  assert.equal(permissionMissing.status, 'permission-missing');
  assert.equal(permissionPayload.status, 'permission-missing');
  assert.equal(permissionPayload.attachState, 'permission-missing');
  assert.equal(permissionPayload.liveSurfaceRef, undefined);
  assert.equal(permissionPayload.currentFrameRef, undefined);
});

test('VirtualDisplayProvider summarizes bounded frame latency, drops, and backpressure', () => {
  const summary = summarizeVirtualDisplayFrameTelemetry([
    { sequence: 1, endToEndMs: 12, bufferedFrames: 0, maxBufferedFrames: 2, frameBytes: 1000 },
    { sequence: 2, endToEndMs: 18, bufferedFrames: 2, maxBufferedFrames: 2, skippedBackpressure: 1, droppedSinceLastFrame: 2, frameBytes: 1400 },
    { sequence: 4, endToEndMs: 44, bufferedFrames: 1, maxBufferedFrames: 2, frameBytes: 1200 },
    { sequence: 5, endToEndMs: 51, bufferedFrames: 0, maxBufferedFrames: 2, frameBytes: 1250 },
  ], {
    currentFrameRef: '.sciforge/vision-runs/latency/virtual-display-provider/frames/current.json',
    latencyBoundMs: 50,
  });

  assert.equal(summary.schemaVersion, VIRTUAL_DISPLAY_FRAME_TELEMETRY_SCHEMA);
  assert.equal(summary.sampleCount, 4);
  assert.equal(summary.firstSequence, 1);
  assert.equal(summary.currentFrameSequence, 5);
  assert.equal(summary.sequenceGapCount, 1);
  assert.equal(summary.p50EndToEndMs, 18);
  assert.equal(summary.p95EndToEndMs, 51);
  assert.equal(summary.maxEndToEndMs, 51);
  assert.equal(summary.latencyBoundMs, 50);
  assert.equal(summary.latencyBoundSatisfied, false);
  assert.equal(summary.totalDroppedFrames, 2);
  assert.equal(summary.dropRate, 0.3333);
  assert.equal(summary.backpressureEventCount, 1);
  assert.equal(summary.totalSkippedBackpressure, 1);
  assert.equal(summary.currentBufferedFrames, 0);
  assert.equal(summary.maxBufferedFrames, 2);
  assert.equal(summary.maxFrameBytes, 1400);
  assert.equal(summary.currentFrameRef, '.sciforge/vision-runs/latency/virtual-display-provider/frames/current.json');
  assert.equal(summary.policy.queueMode, 'drop-oldest-keep-current');
  assert.equal(summary.policy.frameStreamIsTruthSource, false);
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
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.mutatingActionExecuted, false);
  assert.equal(blocked.rawPayloadWritten, false);
  assert.equal(blocked.refs.sessionRef, undefined);
  assert.equal(blocked.refs.currentFrameRef, undefined);
  assert.equal(blocked.refs.inputLeaseRef, undefined);
  assert.match(String(blocked.refs.blockedRef), /virtual-display-provider\/blocked\.json/);

  const permissionBlocked = invokeVirtualDisplayProvider({
    intent: 'sendInputIntent',
    runId: 'invoke-permission-missing',
    targetAppKind: 'vscode',
    probeOptions: {
      platform: 'darwin',
      nodePackageAvailability: { 'node-mac-virtual-display': true },
      permissionGrants: {
        'permission:macos/screen-recording': false,
        'permission:macos/accessibility': true,
      },
    },
  });
  assert.equal(permissionBlocked.status, 'permission-missing');
  assert.equal(permissionBlocked.mutatingActionExecuted, false);
  assert.equal(permissionBlocked.rawPayloadWritten, false);
  assert.equal(permissionBlocked.refs.inputIntentRefs, undefined);
  assert.equal(permissionBlocked.refs.inputLeaseRef, undefined);
  assert.match(String(permissionBlocked.refs.blockedRef), /virtual-display-provider\/blocked\.json/);

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
    intent: 'sendInputIntent',
    runId: 'invoke-ready',
    targetAppKind: 'vscode',
    probeBundle: readyProbe,
  });
  assert.equal(input.status, 'ready');
  assert.equal(input.mutatingActionExecuted, true);
  assert.deepEqual(input.refs.beforeAfterFrameRefs, ['.sciforge/vision-runs/invoke-ready/virtual-display-provider/before-after/input.json']);
  assert.deepEqual(input.refs.executorEventRefs, ['.sciforge/vision-runs/invoke-ready/virtual-display-provider/executor-events/click-and-type.json']);
});
