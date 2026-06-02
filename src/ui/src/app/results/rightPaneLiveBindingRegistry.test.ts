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
    liveBindingAttachGrantRef: 'computer-use:provider-session/run-a/live-binding-attach-grant.json',
    surfaceTransportRef: 'computer-use:session/run-a/surface-transport.json',
    currentFrameSequence: {
      ref: 'computer-use:session/run-a/frame-sequence.json',
      sequence: 7,
    },
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
    liveBindingAttachGrantRef: 'computer-use:provider-session/run-a/live-binding-attach-grant.json',
    surfaceTransportRef: 'computer-use:session/run-a/surface-transport.json',
    currentFrameSequence: {
      ref: 'computer-use:session/run-a/frame-sequence.json',
      sequence: 7,
    },
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
    liveBindingAttachGrantRef: 'computer-use:provider-session/restore/live-binding-attach-grant.json',
    surfaceTransportRef: 'computer-use:session/restore/surface-transport.json',
    currentFrameSequence: {
      ref: 'computer-use:session/restore/frame-sequence.json',
      sequence: 11,
    },
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
  assert.equal(binding?.liveBindingAttachGrantRef, 'computer-use:provider-session/restore/live-binding-attach-grant.json');
  assert.equal(binding?.surfaceTransportRef, 'computer-use:session/restore/surface-transport.json');
  assert.deepEqual(binding?.currentFrameSequence, {
    ref: 'computer-use:session/restore/frame-sequence.json',
    sequence: 11,
  });
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
    liveBindingAttachGrantRef: 'computer-use:provider-session/restore/live-binding-attach-grant.json',
    surfaceTransportRef: 'computer-use:session/restore/surface-transport.json',
    currentFrameSequence: {
      ref: 'computer-use:session/restore/frame-sequence.json',
      sequence: 11,
    },
    adapterReadinessRef: 'computer-use:session/restore/adapter-readiness.json',
    evidenceLedgerRef: 'computer-use:session/restore/evidence-ledger.json',
    blockedReason: 'Waiting for provider reconnect.',
  });
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
    liveBindingAttachGrantRef: 'computer-use:provider-session/reconnect/live-binding-attach-grant.json',
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
      liveBindingAttachGrantRef: 'computer-use:provider-session/reconnect/live-binding-attach-grant.json',
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
      liveBindingAttachGrantRef: 'computer-use:provider-session/reconnect/live-binding-attach-grant.json',
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
    liveBindingAttachGrantRef: 'computer-use:provider-session/reconnect/live-binding-attach-grant.json',
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
    observedLiveBindingAttachGrantRef: 'computer-use:provider-session/reconnect/live-binding-attach-grant.json',
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
    sameLiveBindingAttachGrantRef: true,
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
  assert.equal(resizeCheckpoint?.sameLiveBindingAttachGrantRef, true);
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
    liveBindingAttachGrantRef: 'computer-use:provider-session/blocked-reconnect/live-binding-attach-grant.json',
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
  assert.equal(checkpoint?.sameLiveBindingAttachGrantRef, false);
  assert.deepEqual(checkpoint?.mismatchedRefEvidence, ['sessionRef']);
  assert.deepEqual(checkpoint?.missingRefEvidence, [
    'providerSessionOwnerRef:observed',
    'providerSessionReconnectRef:observed',
    'liveBindingAttachGrantRef:observed',
  ]);
  assert.equal(checkpoint?.blockedRef, 'computer-use:screen-reconnect/virtual-app-screen-blocked-reconnect-screen-1/blocked/ref-evidence.json');
  assert.match(checkpoint?.blockedReason ?? '', /expected and observed refs match/);
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
