import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRightPaneActiveVirtualAppScreenRegistry,
  mergeRightPaneActiveVirtualAppScreenBinding,
  rightPaneActiveVirtualAppScreenBindingFor,
  rightPaneActiveVirtualAppScreenBindingFromPayload,
  rightPaneVirtualAppScreenReconnectCheckpoint,
  rightPaneVirtualAppScreenPlaceholderRefs,
  updateRightPaneActiveVirtualAppScreenRegistry,
} from './rightPaneLiveBindingRegistry';

test('active VirtualAppScreen registry maps screen refs to live binding refs', () => {
  const binding = rightPaneActiveVirtualAppScreenBindingFromPayload({
    screenRef: 'virtual-app-screen:run-a/screen-1',
    sessionRef: 'computer-use:session/run-a/session.json',
    liveSurfaceRef: 'computer-use:session/run-a/live-surface.json',
    frameStreamRef: 'computer-use:session/run-a/frame-stream.json',
    currentFrameRef: 'computer-use:session/run-a/frames/current.png',
    inputLeaseRef: 'computer-use:session/run-a/input-lease.json',
    providerSessionOwnerRef: 'computer-use:provider-session/run-a/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/run-a/reconnect.json',
    surfaceIdentityRef: 'computer-use:provider-session/run-a/surface-identity.json',
    surfaceOwnerRef: 'computer-use:native-host/surfaces/run-a/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/surfaces/run-a/display-owner.json',
    liveBindingAttachGrantRef: 'computer-use:provider-session/run-a/live-binding-attach-grant.json',
    grantValidationRef: 'computer-use:provider-session/run-a/grant-validation.json',
    surfaceTransportRef: 'computer-use:session/run-a/surface-transport.json',
    currentFrameSequence: {
      ref: 'computer-use:session/run-a/frame-sequence.json',
      sequence: 7,
    },
    preflightRef: 'computer-use:native-host/preflights/run-a/preflight.json',
    preflightLedgerRef: 'computer-use:native-host/preflights/run-a/preflight-ledger.json',
    preflightLedgerEntryRef: 'computer-use:native-host/preflights/run-a/preflight-ledger.json/events/0001-preflight.recorded.json',
    hostReadinessRef: 'computer-use:native-host/preflights/run-a/host-readiness.json',
    adapterReadinessRef: 'computer-use:session/run-a/adapter-readiness.json',
    evidenceLedgerRef: 'computer-use:session/run-a/evidence-ledger.json',
    blockedRef: 'computer-use:session/run-a/blocked/platform.json',
    blockedReason: 'Platform authorization is incomplete.',
  }, 'custom:screen:204:1');
  const registry = updateRightPaneActiveVirtualAppScreenRegistry(
    createRightPaneActiveVirtualAppScreenRegistry(),
    binding,
  );

  assert.deepEqual(rightPaneActiveVirtualAppScreenBindingFor(registry, {
    screenRef: 'virtual-app-screen:run-a/screen-1',
  }), {
    screenRef: 'virtual-app-screen:run-a/screen-1',
    tabId: 'custom:screen:204:1',
    sessionRef: 'computer-use:session/run-a/session.json',
    liveSurfaceRef: 'computer-use:session/run-a/live-surface.json',
    frameStreamRef: 'computer-use:session/run-a/frame-stream.json',
    currentFrameRef: 'computer-use:session/run-a/frames/current.png',
    inputLeaseRef: 'computer-use:session/run-a/input-lease.json',
    providerSessionOwnerRef: 'computer-use:provider-session/run-a/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/run-a/reconnect.json',
    surfaceIdentityRef: 'computer-use:provider-session/run-a/surface-identity.json',
    surfaceOwnerRef: 'computer-use:native-host/surfaces/run-a/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/surfaces/run-a/display-owner.json',
    liveBindingAttachGrantRef: 'computer-use:provider-session/run-a/live-binding-attach-grant.json',
    grantValidationRef: 'computer-use:provider-session/run-a/grant-validation.json',
    surfaceTransportRef: 'computer-use:session/run-a/surface-transport.json',
    currentFrameSequence: {
      ref: 'computer-use:session/run-a/frame-sequence.json',
      sequence: 7,
    },
    preflightRef: 'computer-use:native-host/preflights/run-a/preflight.json',
    preflightLedgerRef: 'computer-use:native-host/preflights/run-a/preflight-ledger.json',
    preflightLedgerEntryRef: 'computer-use:native-host/preflights/run-a/preflight-ledger.json/events/0001-preflight.recorded.json',
    hostReadinessRef: 'computer-use:native-host/preflights/run-a/host-readiness.json',
    adapterReadinessRef: 'computer-use:session/run-a/adapter-readiness.json',
    evidenceLedgerRef: 'computer-use:session/run-a/evidence-ledger.json',
    blockedRef: 'computer-use:session/run-a/blocked/platform.json',
    blockedReason: 'Platform authorization is incomplete.',
  });
  assert.equal(
    rightPaneActiveVirtualAppScreenBindingFor(registry, { tabId: 'custom:screen:204:1' })?.liveSurfaceRef,
    'computer-use:session/run-a/live-surface.json',
  );
});

test('active VirtualAppScreen registry preserves per-screen refs across restore and reconnect', () => {
  const first = updateRightPaneActiveVirtualAppScreenRegistry(createRightPaneActiveVirtualAppScreenRegistry(), {
    screenRef: 'virtual-app-screen:restore/screen-1',
    tabId: 'custom:screen:204:1',
    sessionRef: 'computer-use:session/restore/session.json',
    liveSurfaceRef: 'computer-use:session/restore/live-surface.json',
    frameStreamRef: 'computer-use:session/restore/frame-stream.json',
    currentFrameRef: 'computer-use:session/restore/frames/current.png',
    inputLeaseRef: 'computer-use:session/restore/input-lease.json',
    providerSessionOwnerRef: 'computer-use:provider-session/restore/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/restore/reconnect.json',
    surfaceIdentityRef: 'computer-use:provider-session/restore/surface-identity.json',
    surfaceOwnerRef: 'computer-use:native-host/surfaces/restore/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/surfaces/restore/display-owner.json',
    liveBindingAttachGrantRef: 'computer-use:provider-session/restore/live-binding-attach-grant.json',
    grantValidationRef: 'computer-use:provider-session/restore/grant-validation.json',
    surfaceTransportRef: 'computer-use:session/restore/surface-transport.json',
    currentFrameSequence: {
      ref: 'computer-use:session/restore/frame-sequence.json',
      sequence: 11,
    },
    preflightRef: 'computer-use:native-host/preflights/restore/preflight.json',
    preflightLedgerRef: 'computer-use:native-host/preflights/restore/preflight-ledger.json',
    preflightLedgerEntryRef: 'computer-use:native-host/preflights/restore/preflight-ledger.json/events/0001-preflight.recorded.json',
    hostReadinessRef: 'computer-use:native-host/preflights/restore/host-readiness.json',
    adapterReadinessRef: 'computer-use:session/restore/adapter-readiness.json',
    evidenceLedgerRef: 'computer-use:session/restore/evidence-ledger.json',
  });
  const restored = updateRightPaneActiveVirtualAppScreenRegistry(first, {
    screenRef: 'virtual-app-screen:restore/screen-1',
    tabId: 'custom:screen:restored:1',
    blockedReason: 'Waiting for provider reconnect.',
  });
  const binding = rightPaneActiveVirtualAppScreenBindingFor(restored, { tabId: 'custom:screen:restored:1' });

  assert.equal(binding?.sessionRef, 'computer-use:session/restore/session.json');
  assert.equal(binding?.liveSurfaceRef, 'computer-use:session/restore/live-surface.json');
  assert.equal(binding?.frameStreamRef, 'computer-use:session/restore/frame-stream.json');
  assert.equal(binding?.currentFrameRef, 'computer-use:session/restore/frames/current.png');
  assert.equal(binding?.inputLeaseRef, 'computer-use:session/restore/input-lease.json');
  assert.equal(binding?.providerSessionOwnerRef, 'computer-use:provider-session/restore/owner.json');
  assert.equal(binding?.providerSessionReconnectRef, 'computer-use:provider-session/restore/reconnect.json');
  assert.equal(binding?.surfaceIdentityRef, 'computer-use:provider-session/restore/surface-identity.json');
  assert.equal(binding?.surfaceOwnerRef, 'computer-use:native-host/surfaces/restore/surface-owner.json');
  assert.equal(binding?.displayOwnerRef, 'computer-use:native-host/surfaces/restore/display-owner.json');
  assert.equal(binding?.liveBindingAttachGrantRef, 'computer-use:provider-session/restore/live-binding-attach-grant.json');
  assert.equal(binding?.grantValidationRef, 'computer-use:provider-session/restore/grant-validation.json');
  assert.equal(binding?.surfaceTransportRef, 'computer-use:session/restore/surface-transport.json');
  assert.deepEqual(binding?.currentFrameSequence, {
    ref: 'computer-use:session/restore/frame-sequence.json',
    sequence: 11,
  });
  assert.equal(binding?.preflightRef, 'computer-use:native-host/preflights/restore/preflight.json');
  assert.equal(binding?.preflightLedgerRef, 'computer-use:native-host/preflights/restore/preflight-ledger.json');
  assert.equal(binding?.preflightLedgerEntryRef, 'computer-use:native-host/preflights/restore/preflight-ledger.json/events/0001-preflight.recorded.json');
  assert.equal(binding?.hostReadinessRef, 'computer-use:native-host/preflights/restore/host-readiness.json');
  assert.equal(binding?.adapterReadinessRef, 'computer-use:session/restore/adapter-readiness.json');
  assert.equal(binding?.evidenceLedgerRef, 'computer-use:session/restore/evidence-ledger.json');
  assert.equal(binding?.blockedReason, 'Waiting for provider reconnect.');
  assert.deepEqual(mergeRightPaneActiveVirtualAppScreenBinding({
    screenRef: 'virtual-app-screen:restore/screen-1',
    status: 'blocked',
  }, binding), {
    screenRef: 'virtual-app-screen:restore/screen-1',
    status: 'blocked',
    sessionRef: 'computer-use:session/restore/session.json',
    liveSurfaceRef: 'computer-use:session/restore/live-surface.json',
    frameStreamRef: 'computer-use:session/restore/frame-stream.json',
    currentFrameRef: 'computer-use:session/restore/frames/current.png',
    inputLeaseRef: 'computer-use:session/restore/input-lease.json',
    providerSessionOwnerRef: 'computer-use:provider-session/restore/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/restore/reconnect.json',
    surfaceIdentityRef: 'computer-use:provider-session/restore/surface-identity.json',
    surfaceOwnerRef: 'computer-use:native-host/surfaces/restore/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/surfaces/restore/display-owner.json',
    liveBindingAttachGrantRef: 'computer-use:provider-session/restore/live-binding-attach-grant.json',
    grantValidationRef: 'computer-use:provider-session/restore/grant-validation.json',
    surfaceTransportRef: 'computer-use:session/restore/surface-transport.json',
    currentFrameSequence: {
      ref: 'computer-use:session/restore/frame-sequence.json',
      sequence: 11,
    },
    preflightRef: 'computer-use:native-host/preflights/restore/preflight.json',
    preflightLedgerRef: 'computer-use:native-host/preflights/restore/preflight-ledger.json',
    preflightLedgerEntryRef: 'computer-use:native-host/preflights/restore/preflight-ledger.json/events/0001-preflight.recorded.json',
    hostReadinessRef: 'computer-use:native-host/preflights/restore/host-readiness.json',
    adapterReadinessRef: 'computer-use:session/restore/adapter-readiness.json',
    evidenceLedgerRef: 'computer-use:session/restore/evidence-ledger.json',
    blockedReason: 'Waiting for provider reconnect.',
  });
});

test('active VirtualAppScreen registry drops non-preflight refs from cached Host preflight evidence', () => {
  const screenRef = 'virtual-app-screen:preflight-sanitize/screen-1';
  const invalidBinding = rightPaneActiveVirtualAppScreenBindingFromPayload({
    screenRef,
    preflightRef: 'computer-use:screen-activation/preflight-sanitize/preflight.json',
    preflightLedgerRef: 'computer-use:native-host/readiness/preflight-sanitize/preflight-ledger.json',
    preflightLedgerEntryRef: 'ledger:computer-use/preflight-sanitize/preflight-ledger.json/events/0001-preflight.recorded.json',
    hostReadinessRef: 'computer-use:native-host/readiness/preflight-sanitize/host-readiness.json',
  });

  assert.deepEqual(invalidBinding, { screenRef });

  const polluted = updateRightPaneActiveVirtualAppScreenRegistry({
    byScreenRef: {
      [screenRef]: {
        screenRef,
        preflightRef: 'computer-use:native-host/readiness/preflight-sanitize/old-preflight.json',
        preflightLedgerRef: 'computer-use:native-host/readiness/preflight-sanitize/old-preflight-ledger.json',
        preflightLedgerEntryRef: 'computer-use:native-host/readiness/preflight-sanitize/old-preflight-ledger.json/events/0001-preflight.recorded.json',
        hostReadinessRef: 'computer-use:native-host/readiness/preflight-sanitize/old-host-readiness.json',
      },
    },
    screenRefByTabId: {},
  }, {
    screenRef,
    tabId: 'custom:screen:preflight-sanitize',
  });
  const restored = rightPaneActiveVirtualAppScreenBindingFor(polluted, { tabId: 'custom:screen:preflight-sanitize' });

  assert.equal(restored?.preflightRef, undefined);
  assert.equal(restored?.preflightLedgerRef, undefined);
  assert.equal(restored?.preflightLedgerEntryRef, undefined);
  assert.equal(restored?.hostReadinessRef, undefined);

  const merged = mergeRightPaneActiveVirtualAppScreenBinding({
    screenRef,
    status: 'blocked',
    preflightRef: 'computer-use:screen-activation/preflight-sanitize/new-preflight.json',
    preflightLedgerRef: 'computer-use:native-host/readiness/preflight-sanitize/new-preflight-ledger.json',
  }, {
    screenRef,
    preflightRef: 'computer-use:native-host/readiness/preflight-sanitize/cached-preflight.json',
    hostReadinessRef: 'computer-use:native-host/readiness/preflight-sanitize/cached-host-readiness.json',
  });

  assert.equal(merged.preflightRef, undefined);
  assert.equal(merged.preflightLedgerRef, undefined);
  assert.equal(merged.hostReadinessRef, undefined);
});

test('active VirtualAppScreen registry writes reconnect checkpoints across tab switch and resize', () => {
  const registry = updateRightPaneActiveVirtualAppScreenRegistry(createRightPaneActiveVirtualAppScreenRegistry(), {
    screenRef: 'virtual-app-screen:reconnect/screen-1',
    tabId: 'custom:screen:one',
    sessionRef: 'computer-use:session/reconnect/session.json',
    liveSurfaceRef: 'computer-use:session/reconnect/live-surface.json',
    frameStreamRef: 'computer-use:session/reconnect/frame-stream.json',
    currentFrameRef: 'computer-use:session/reconnect/frames/current.png',
    inputLeaseRef: 'computer-use:session/reconnect/input-lease.json',
    providerSessionOwnerRef: 'computer-use:provider-session/reconnect/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/reconnect/reconnect.json',
    surfaceIdentityRef: 'computer-use:provider-session/reconnect/surface-identity.json',
    surfaceOwnerRef: 'computer-use:native-host/surfaces/reconnect/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/surfaces/reconnect/display-owner.json',
    liveBindingAttachGrantRef: 'computer-use:provider-session/reconnect/live-binding-attach-grant.json',
    grantValidationRef: 'computer-use:provider-session/reconnect/grant-validation.json',
    surfaceTransportRef: 'computer-use:session/reconnect/surface-transport.json',
    currentFrameSequence: {
      ref: 'computer-use:session/reconnect/frame-sequence.json',
      sequence: 19,
    },
    adapterReadinessRef: 'computer-use:session/reconnect/adapter-readiness.json',
    evidenceLedgerRef: 'computer-use:session/reconnect/evidence-ledger.json',
  });
  const tabSwitched = updateRightPaneActiveVirtualAppScreenRegistry(registry, {
    screenRef: 'virtual-app-screen:reconnect/screen-1',
    tabId: 'custom:screen:two',
  });

  const tabSwitchCheckpoint = rightPaneVirtualAppScreenReconnectCheckpoint(tabSwitched, {
    tabId: 'custom:screen:two',
    reason: 'tab-switch',
    observed: {
      sessionRef: 'computer-use:session/reconnect/session.json',
      liveSurfaceRef: 'computer-use:session/reconnect/live-surface.json',
      frameStreamRef: 'computer-use:session/reconnect/frame-stream.json',
      providerSessionOwnerRef: 'computer-use:provider-session/reconnect/owner.json',
      providerSessionReconnectRef: 'computer-use:provider-session/reconnect/reconnect.json',
      surfaceIdentityRef: 'computer-use:provider-session/reconnect/surface-identity.json',
      surfaceOwnerRef: 'computer-use:native-host/surfaces/reconnect/surface-owner.json',
      displayOwnerRef: 'computer-use:native-host/surfaces/reconnect/display-owner.json',
      liveBindingAttachGrantRef: 'computer-use:provider-session/reconnect/live-binding-attach-grant.json',
      grantValidationRef: 'computer-use:provider-session/reconnect/grant-validation.json',
      surfaceTransportRef: 'computer-use:session/reconnect/surface-transport.json',
      currentFrameSequence: {
        ref: 'computer-use:session/reconnect/frame-sequence.json',
        sequence: 19,
      },
    },
  });
  const resizeCheckpoint = rightPaneVirtualAppScreenReconnectCheckpoint(tabSwitched, {
    screenRef: 'virtual-app-screen:reconnect/screen-1',
    reason: 'resize',
    checkpointRef: 'computer-use:screen-reconnect/reconnect/resize-checkpoint.json',
    observed: {
      sessionRef: 'computer-use:session/reconnect/session.json',
      liveSurfaceRef: 'computer-use:session/reconnect/live-surface.json',
      frameStreamRef: 'computer-use:session/reconnect/frame-stream.json',
      providerSessionOwnerRef: 'computer-use:provider-session/reconnect/owner.json',
      providerSessionReconnectRef: 'computer-use:provider-session/reconnect/reconnect.json',
      surfaceIdentityRef: 'computer-use:provider-session/reconnect/surface-identity.json',
      surfaceOwnerRef: 'computer-use:native-host/surfaces/reconnect/surface-owner.json',
      displayOwnerRef: 'computer-use:native-host/surfaces/reconnect/display-owner.json',
      liveBindingAttachGrantRef: 'computer-use:provider-session/reconnect/live-binding-attach-grant.json',
      grantValidationRef: 'computer-use:provider-session/reconnect/grant-validation.json',
      surfaceTransportRef: 'computer-use:session/reconnect/surface-transport.json',
      currentFrameSequence: {
        ref: 'computer-use:session/reconnect/frame-sequence.json',
        sequence: 19,
      },
    },
  });

  assert.deepEqual(tabSwitchCheckpoint, {
    schemaVersion: 'sciforge.ui.right-pane.virtual-app-screen-reconnect.v1',
    checkpointRef: 'computer-use:screen-reconnect/virtual-app-screen-reconnect-screen-1/tab-switch.json',
    reason: 'tab-switch',
    screenRef: 'virtual-app-screen:reconnect/screen-1',
    tabId: 'custom:screen:two',
    sessionRef: 'computer-use:session/reconnect/session.json',
    liveSurfaceRef: 'computer-use:session/reconnect/live-surface.json',
    frameStreamRef: 'computer-use:session/reconnect/frame-stream.json',
    currentFrameRef: 'computer-use:session/reconnect/frames/current.png',
    inputLeaseRef: 'computer-use:session/reconnect/input-lease.json',
    providerSessionOwnerRef: 'computer-use:provider-session/reconnect/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/reconnect/reconnect.json',
    surfaceIdentityRef: 'computer-use:provider-session/reconnect/surface-identity.json',
    surfaceOwnerRef: 'computer-use:native-host/surfaces/reconnect/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/surfaces/reconnect/display-owner.json',
    liveBindingAttachGrantRef: 'computer-use:provider-session/reconnect/live-binding-attach-grant.json',
    grantValidationRef: 'computer-use:provider-session/reconnect/grant-validation.json',
    surfaceTransportRef: 'computer-use:session/reconnect/surface-transport.json',
    currentFrameSequence: {
      ref: 'computer-use:session/reconnect/frame-sequence.json',
      sequence: 19,
    },
    observedSessionRef: 'computer-use:session/reconnect/session.json',
    observedLiveSurfaceRef: 'computer-use:session/reconnect/live-surface.json',
    observedFrameStreamRef: 'computer-use:session/reconnect/frame-stream.json',
    observedProviderSessionOwnerRef: 'computer-use:provider-session/reconnect/owner.json',
    observedProviderSessionReconnectRef: 'computer-use:provider-session/reconnect/reconnect.json',
    observedSurfaceIdentityRef: 'computer-use:provider-session/reconnect/surface-identity.json',
    observedSurfaceOwnerRef: 'computer-use:native-host/surfaces/reconnect/surface-owner.json',
    observedDisplayOwnerRef: 'computer-use:native-host/surfaces/reconnect/display-owner.json',
    observedLiveBindingAttachGrantRef: 'computer-use:provider-session/reconnect/live-binding-attach-grant.json',
    observedGrantValidationRef: 'computer-use:provider-session/reconnect/grant-validation.json',
    observedSurfaceTransportRef: 'computer-use:session/reconnect/surface-transport.json',
    observedCurrentFrameSequence: {
      ref: 'computer-use:session/reconnect/frame-sequence.json',
      sequence: 19,
    },
    adapterReadinessRef: 'computer-use:session/reconnect/adapter-readiness.json',
    evidenceLedgerRef: 'computer-use:session/reconnect/evidence-ledger.json',
    sameSessionRef: true,
    sameLiveSurfaceRef: true,
    sameFrameStreamRef: true,
    sameProviderSessionOwnerRef: true,
    sameProviderSessionReconnectRef: true,
    sameSurfaceIdentityRef: true,
    sameSurfaceOwnerRef: true,
    sameDisplayOwnerRef: true,
    sameLiveBindingAttachGrantRef: true,
    sameGrantValidationRef: true,
    missingRefEvidence: [],
    mismatchedRefEvidence: [],
    singleInteractiveTruth: true,
    secondInteractiveSurfacePresent: false,
  });
  assert.equal(resizeCheckpoint?.checkpointRef, 'computer-use:screen-reconnect/reconnect/resize-checkpoint.json');
  assert.equal(resizeCheckpoint?.sameSessionRef, true);
  assert.equal(resizeCheckpoint?.sameLiveSurfaceRef, true);
  assert.equal(resizeCheckpoint?.sameFrameStreamRef, true);
  assert.equal(resizeCheckpoint?.sameProviderSessionOwnerRef, true);
  assert.equal(resizeCheckpoint?.sameProviderSessionReconnectRef, true);
  assert.equal(resizeCheckpoint?.sameSurfaceIdentityRef, true);
  assert.equal(resizeCheckpoint?.sameSurfaceOwnerRef, true);
  assert.equal(resizeCheckpoint?.sameDisplayOwnerRef, true);
  assert.equal(resizeCheckpoint?.sameLiveBindingAttachGrantRef, true);
  assert.equal(resizeCheckpoint?.sameGrantValidationRef, true);
  assert.deepEqual(resizeCheckpoint?.missingRefEvidence, []);
  assert.equal(resizeCheckpoint?.secondInteractiveSurfacePresent, false);
});

test('active VirtualAppScreen reconnect checkpoints expose blocked evidence for missing or changed observed refs', () => {
  const registry = updateRightPaneActiveVirtualAppScreenRegistry(createRightPaneActiveVirtualAppScreenRegistry(), {
    screenRef: 'virtual-app-screen:blocked-reconnect/screen-1',
    tabId: 'custom:screen:blocked',
    sessionRef: 'computer-use:session/blocked-reconnect/session.json',
    liveSurfaceRef: 'computer-use:session/blocked-reconnect/live-surface.json',
    frameStreamRef: 'computer-use:session/blocked-reconnect/frame-stream.json',
    providerSessionOwnerRef: 'computer-use:provider-session/blocked-reconnect/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/blocked-reconnect/reconnect.json',
    surfaceIdentityRef: 'computer-use:provider-session/blocked-reconnect/surface-identity.json',
    surfaceOwnerRef: 'computer-use:native-host/surfaces/blocked-reconnect/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/surfaces/blocked-reconnect/display-owner.json',
    liveBindingAttachGrantRef: 'computer-use:provider-session/blocked-reconnect/live-binding-attach-grant.json',
    grantValidationRef: 'computer-use:provider-session/blocked-reconnect/grant-validation.json',
  });

  const checkpoint = rightPaneVirtualAppScreenReconnectCheckpoint(registry, {
    tabId: 'custom:screen:blocked',
    reason: 'provider-reconnect',
    observed: {
      sessionRef: 'computer-use:session/blocked-reconnect/other-session.json',
      liveSurfaceRef: 'computer-use:session/blocked-reconnect/live-surface.json',
      frameStreamRef: 'computer-use:session/blocked-reconnect/frame-stream.json',
    },
  });

  assert.equal(checkpoint?.sameSessionRef, false);
  assert.equal(checkpoint?.sameLiveSurfaceRef, true);
  assert.equal(checkpoint?.sameFrameStreamRef, true);
  assert.equal(checkpoint?.sameProviderSessionOwnerRef, false);
  assert.equal(checkpoint?.sameProviderSessionReconnectRef, false);
  assert.equal(checkpoint?.sameSurfaceIdentityRef, false);
  assert.equal(checkpoint?.sameSurfaceOwnerRef, false);
  assert.equal(checkpoint?.sameDisplayOwnerRef, false);
  assert.equal(checkpoint?.sameLiveBindingAttachGrantRef, false);
  assert.equal(checkpoint?.sameGrantValidationRef, false);
  assert.deepEqual(checkpoint?.mismatchedRefEvidence, ['sessionRef']);
  assert.deepEqual(checkpoint?.missingRefEvidence, [
    'providerSessionOwnerRef:observed',
    'providerSessionReconnectRef:observed',
    'surfaceIdentityRef:observed',
    'surfaceOwnerRef:observed',
    'displayOwnerRef:observed',
    'liveBindingAttachGrantRef:observed',
    'grantValidationRef:observed',
  ]);
  assert.equal(checkpoint?.blockedRef, 'computer-use:screen-reconnect/virtual-app-screen-blocked-reconnect-screen-1/blocked/ref-evidence.json');
  assert.match(checkpoint?.blockedReason ?? '', /expected and observed refs match/);
});

test('active VirtualAppScreen registry blocks same-screen surface identity drift', () => {
  const registry = updateRightPaneActiveVirtualAppScreenRegistry(createRightPaneActiveVirtualAppScreenRegistry(), {
    screenRef: 'virtual-app-screen:identity-drift/screen-1',
    tabId: 'custom:screen:identity:1',
    sessionRef: 'computer-use:session/identity-drift/session.json',
    liveSurfaceRef: 'computer-use:session/identity-drift/live-surface.json',
    frameStreamRef: 'computer-use:session/identity-drift/frame-stream.json',
    currentFrameRef: 'computer-use:session/identity-drift/frames/current.png',
    providerSessionOwnerRef: 'computer-use:provider-session/identity-drift/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/identity-drift/reconnect.json',
    surfaceIdentityRef: 'computer-use:provider-session/identity-drift/surface-identity.json',
    surfaceOwnerRef: 'computer-use:native-host/surfaces/identity-drift/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/surfaces/identity-drift/display-owner.json',
    liveBindingAttachGrantRef: 'computer-use:provider-session/identity-drift/live-binding-attach-grant.json',
    grantValidationRef: 'computer-use:provider-session/identity-drift/grant-validation.json',
    surfaceTransportRef: 'computer-use:session/identity-drift/surface-transport.json',
    currentFrameSequence: {
      ref: 'computer-use:session/identity-drift/frames/current.png',
      sequence: 4,
    },
  });

  const updated = updateRightPaneActiveVirtualAppScreenRegistry(registry, {
    screenRef: 'virtual-app-screen:identity-drift/screen-1',
    tabId: 'custom:screen:identity:2',
    currentFrameRef: 'computer-use:session/identity-drift/frames/current-5.png',
    currentFrameSequence: {
      ref: 'computer-use:session/identity-drift/frames/current-5.png',
      sequence: 5,
    },
    surfaceOwnerRef: 'computer-use:native-host/surfaces/identity-drift/other-surface-owner.json',
  });
  const binding = rightPaneActiveVirtualAppScreenBindingFor(updated, { tabId: 'custom:screen:identity:2' });

  assert.equal(binding?.currentFrameRef, 'computer-use:session/identity-drift/frames/current-5.png');
  assert.deepEqual(binding?.currentFrameSequence, {
    ref: 'computer-use:session/identity-drift/frames/current-5.png',
    sequence: 5,
  });
  assert.equal(binding?.surfaceOwnerRef, 'computer-use:native-host/surfaces/identity-drift/surface-owner.json');
  assert.equal(binding?.blockedRef, 'computer-use:screen-reconnect/virtual-app-screen-identity-drift-screen-1/blocked/surface-identity.json');
  assert.match(binding?.blockedReason ?? '', /surface identity/);
  assert.match(binding?.blockedReason ?? '', /surfaceOwnerRef/);
});

test('active VirtualAppScreen placeholder refs do not collide across custom screen tabs', () => {
  const first = rightPaneVirtualAppScreenPlaceholderRefs({
    sessionId: 'session needs screen',
    activeTabId: 'custom:screen:204:1',
  });
  const second = rightPaneVirtualAppScreenPlaceholderRefs({
    sessionId: 'session needs screen',
    activeTabId: 'custom:screen:205:2',
  });

  assert.notEqual(first.scope, second.scope);
  assert.notEqual(first.screenRef, second.screenRef);
  assert.notEqual(first.activationRef, second.activationRef);
  assert.notEqual(first.blockedRef, second.blockedRef);
  assert.equal(first.screenRef, 'virtual-app-screen:session-needs-screen/custom-screen-204-1/screen-request');
  assert.equal(second.screenRef, 'virtual-app-screen:session-needs-screen/custom-screen-205-2/screen-request');
  assert.match(first.guiPresentRef, /custom-screen-204-1/);
  assert.match(second.guiPresentRef, /custom-screen-205-2/);
});
