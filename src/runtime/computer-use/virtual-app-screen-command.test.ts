import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseVirtualAppScreenRuntimeCommand,
  virtualAppScreenRuntimeCommandTraceDetail,
  virtualAppScreenRuntimeCommandVirtualScreenData,
} from './virtual-app-screen-command.js';

test('VirtualAppScreen runtime command parses right pane screen attach as refs-first fail-closed request', () => {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--profile "vscode-editor"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--screen-ref "virtual-app-screen:session-screen/screen-request"',
    '--activation-ref "computer-use:screen-activation/session-screen/attach-request.json"',
    '--adapter-readiness-ref "computer-use:screen-activation/session-screen/provider-readiness.json"',
    '--evidence-ledger-ref "ledger:computer-use/session-screen/screen-activation.json"',
    '--gui-present-ref "gui.present:session-screen/screen-pane-activation"',
  ].join(' '));

  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') return;

  assert.equal(parsed.command.action, 'screen-attach');
  assert.equal(parsed.command.source, 'right-pane-screen');
  assert.equal(parsed.command.profile, 'vscode-editor');
  assert.deepEqual(parsed.command.refs, {
    readinessRef: 'computer-use:screen-activation/session-screen/provider-readiness.json',
    screenRef: 'virtual-app-screen:session-screen/screen-request',
    targetAppRef: 'app:profile/vscode-editor',
    targetWindowRef: undefined,
    sessionRef: undefined,
    displayGroupRef: undefined,
    surfaceRef: undefined,
    activationRef: 'computer-use:screen-activation/session-screen/attach-request.json',
    permissionHandoffRef: undefined,
    permissionRef: undefined,
    permissionRecheckRef: undefined,
    platformDriverRef: undefined,
    blockedRef: undefined,
    evidenceLedgerRef: 'ledger:computer-use/session-screen/screen-activation.json',
    guiPresentRef: 'gui.present:session-screen/screen-pane-activation',
  });

  const data = virtualAppScreenRuntimeCommandVirtualScreenData(parsed.command);
  assert.equal(data.status, 'blocked');
  assert.equal(data.attachState, 'blocked');
  assert.equal(data.surfaceMode, 'empty');
  assert.equal(data.providerReadinessRef, 'computer-use:screen-activation/session-screen/provider-readiness.json');
  assert.equal(data.handoffRef, 'computer-use:screen-activation/session-screen/attach-request.json');
  assert.equal(data.runSummary.productRuntimeAccepted, true);
  assert.equal(data.runSummary.realNativeSidecarExecuted, false);
  assert.equal(data.isolationFlags.affectsPhysicalDisplay, false);
  assert.equal(data.isolationFlags.systemPointerMoved, false);
  assert.equal('sessionRef' in data, false);
  assert.equal('liveSurfaceRef' in data, false);
  assert.equal('currentFrameRef' in data, false);
});

test('VirtualAppScreen runtime command accepts spaced computer use attach aliases without requiring a session', () => {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer use screen attach',
    '--source right-pane-virtual-app-screen',
    '--target-app-ref "app:profile/jupyter"',
    '--screen-ref "virtual-app-screen:jupyter/screen"',
    '--display-group-ref "display-group:jupyter"',
    '--surface-ref "computer-use:jupyter/live-surface.json"',
    '--provider-readiness-ref "computer-use:jupyter/readiness.json"',
  ].join(' '));

  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') return;

  assert.equal(parsed.command.action, 'screen-attach');
  assert.equal(parsed.command.refs.surfaceRef, 'computer-use:jupyter/live-surface.json');
  assert.equal(parsed.command.refs.readinessRef, 'computer-use:jupyter/readiness.json');
  const data = virtualAppScreenRuntimeCommandVirtualScreenData(parsed.command);
  assert.equal(data.requestedSurfaceRef, 'computer-use:jupyter/live-surface.json');
  assert.equal('liveSurfaceRef' in data, false);
});

test('VirtualAppScreen runtime command preserves only Host-owned preflight refs', () => {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--target-app-ref "app:profile/vscode-editor"',
    '--screen-ref "virtual-app-screen:preflight/screen-request"',
    '--activation-ref "computer-use:screen-activation/preflight/attach-request.json"',
    '--adapter-readiness-ref "computer-use:native-host/preflights/preflight/adapter-readiness.json"',
    '--preflight-ref "computer-use:native-host/preflights/preflight/preflight.json"',
    '--preflight-ledger-ref "computer-use:native-host/preflights/preflight/preflight-ledger.json"',
    '--preflight-ledger-entry-ref "computer-use:native-host/preflights/preflight/preflight-ledger.json/events/0001-preflight.recorded.json"',
    '--host-readiness-ref "computer-use:native-host/preflights/preflight/host-readiness.json"',
  ].join(' '));

  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') return;

  assert.equal(parsed.command.refs.preflightRef, 'computer-use:native-host/preflights/preflight/preflight.json');
  assert.equal(parsed.command.refs.preflightLedgerRef, 'computer-use:native-host/preflights/preflight/preflight-ledger.json');
  assert.equal(parsed.command.refs.preflightLedgerEntryRef, 'computer-use:native-host/preflights/preflight/preflight-ledger.json/events/0001-preflight.recorded.json');
  assert.equal(parsed.command.refs.hostReadinessRef, 'computer-use:native-host/preflights/preflight/host-readiness.json');
  const data = virtualAppScreenRuntimeCommandVirtualScreenData(parsed.command);
  assert.equal(data.preflightRef, 'computer-use:native-host/preflights/preflight/preflight.json');
  assert.deepEqual(data.nativeHostPreflight, {
    preflightRef: 'computer-use:native-host/preflights/preflight/preflight.json',
    preflightLedgerRef: 'computer-use:native-host/preflights/preflight/preflight-ledger.json',
    preflightLedgerEntryRef: 'computer-use:native-host/preflights/preflight/preflight-ledger.json/events/0001-preflight.recorded.json',
    hostReadinessRef: 'computer-use:native-host/preflights/preflight/host-readiness.json',
    adapterReadinessRef: 'computer-use:native-host/preflights/preflight/adapter-readiness.json',
  });
  assert.ok(data.verificationRefs.includes('computer-use:native-host/preflights/preflight/preflight-ledger.json/events/0001-preflight.recorded.json'));

  const placeholder = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--target-app-ref "app:profile/vscode-editor"',
    '--screen-ref "virtual-app-screen:placeholder-preflight/screen-request"',
    '--activation-ref "computer-use:screen-activation/placeholder-preflight/attach-request.json"',
    '--adapter-readiness-ref "computer-use:screen-activation/placeholder-preflight/provider-readiness.json"',
    '--preflight-ref "computer-use:screen-activation/placeholder-preflight/preflight.json"',
    '--preflight-ledger-ref "computer-use:native-host/readiness/placeholder-preflight/preflight-ledger.json"',
    '--preflight-ledger-entry-ref "computer-use:screen-activation/placeholder-preflight/preflight-ledger.json/events/0001-preflight.recorded.json"',
    '--host-readiness-ref "computer-use:native-host/readiness/placeholder-preflight/host-readiness.json"',
  ].join(' '));

  assert.equal(placeholder.kind, 'parsed');
  if (placeholder.kind !== 'parsed') return;
  assert.equal(placeholder.command.refs.preflightRef, undefined);
  assert.equal(placeholder.command.refs.preflightLedgerRef, undefined);
  assert.equal(placeholder.command.refs.preflightLedgerEntryRef, undefined);
  assert.equal(placeholder.command.refs.hostReadinessRef, undefined);
  assert.equal(virtualAppScreenRuntimeCommandVirtualScreenData(placeholder.command).nativeHostPreflight, undefined);
});

test('VirtualAppScreen runtime command parses permission handoff from right pane controller', () => {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use permission-handoff',
    '--source right-pane-screen',
    '--target-ref "computer-use:session/permission-screen/handoff/platform-gates.json"',
    '--permission-ref "computer-use:session/permission-screen/permissions/platform-gates.json"',
    '--recheck-ref "computer-use:session/permission-screen/recheck/platform-gates.json"',
    '--provider-readiness-ref "computer-use:session/permission-screen/provider-readiness.json"',
    '--platform-driver-ref "computer-use:session/permission-screen/platform-driver.json"',
    '--screen-ref "virtual-app-screen:permission-screen/screen-request"',
    '--session-ref "computer-use:session/permission-screen/session.json"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--blocked-ref "computer-use:session/permission-screen/blocked/permission.json"',
    '--evidence-ledger-ref "ledger:computer-use/permission-screen/permission-handoff.json"',
    '--gui-present-ref "gui.present:permission-screen/permission-handoff"',
  ].join(' '));

  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') return;

  assert.equal(parsed.command.action, 'permission-handoff');
  assert.equal(parsed.command.refs.permissionHandoffRef, 'computer-use:session/permission-screen/handoff/platform-gates.json');
  assert.equal(parsed.command.refs.permissionRecheckRef, 'computer-use:session/permission-screen/recheck/platform-gates.json');
  const data = virtualAppScreenRuntimeCommandVirtualScreenData(parsed.command);
  assert.equal(data.status, 'requires-handoff');
  assert.equal(data.attachState, 'requires-handoff');
  assert.equal(data.permissionGranted, false);
  assert.equal(data.permissionHandoffRef, 'computer-use:session/permission-screen/handoff/platform-gates.json');
  assert.equal(data.permissionRecheckRef, 'computer-use:session/permission-screen/recheck/platform-gates.json');
  assert.equal(data.requestedSessionRef, 'computer-use:session/permission-screen/session.json');
  assert.equal('sessionRef' in data, false);
});

test('VirtualAppScreen runtime command parses permission recheck and trace detail', () => {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use permission-recheck',
    '--source right-pane-screen',
    '--target-ref "computer-use:screen/recheck/platform-gates.json"',
    '--adapter-readiness-ref "computer-use:screen/provider-readiness.json"',
    '--screen-ref "virtual-app-screen:screen/recheck"',
    '--target-app-ref "app:profile/vscode-editor"',
  ].join(' '));

  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') return;

  assert.equal(parsed.command.action, 'permission-recheck');
  assert.equal(parsed.command.refs.permissionRecheckRef, 'computer-use:screen/recheck/platform-gates.json');
  assert.deepEqual(virtualAppScreenRuntimeCommandTraceDetail(parsed.command), {
    source: 'right-pane-screen',
    route: 'virtual-app-screen-permission-recheck',
    action: 'permission-recheck',
    refs: parsed.command.refs,
    profile: undefined,
    terminalEquivalent: true,
    providerExecuted: false,
    failClosed: true,
    singleInteractiveTruth: true,
  });
});

test('VirtualAppScreen runtime command parses screen reconnect as current-session refs only', () => {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen reconnect',
    '--source right-pane-screen',
    '--reason tab-switch',
    '--screen-ref "virtual-app-screen:reconnect/screen-1"',
    '--session-ref "computer-use:session/reconnect/session.json"',
    '--live-surface-ref "computer-use:session/reconnect/live-surface.json"',
    '--frame-stream-ref "computer-use:session/reconnect/frame-stream.json"',
    '--current-frame-ref "computer-use:session/reconnect/frames/current.png"',
    '--current-frame-sequence 42',
    '--provider-session-owner-ref "computer-use:provider-session/reconnect/owner.json"',
    '--provider-session-reconnect-ref "computer-use:provider-session/reconnect/reconnect.json"',
    '--surface-identity-ref "computer-use:provider-session/reconnect/surface-identity.json"',
    '--surface-owner-ref "computer-use:native-host/surfaces/reconnect/surface-owner.json"',
    '--display-owner-ref "computer-use:native-host/surfaces/reconnect/display-owner.json"',
    '--live-binding-attach-grant-ref "computer-use:provider-session/reconnect/live-binding-attach-grant.json"',
    '--grant-validation-ref "computer-use:provider-session/reconnect/grant-validation.json"',
    '--surface-transport-ref "computer-use:session/reconnect/surface-transport.json"',
  ].join(' '));

  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') return;

  assert.equal(parsed.command.action, 'screen-reconnect');
  assert.equal(parsed.command.reconnectReason, 'tab-switch');
  assert.equal(parsed.command.currentFrameSequence, 42);
  assert.equal(parsed.command.refs.readinessRef, 'computer-use:provider-session/reconnect/reconnect.json');
  assert.equal(parsed.command.refs.screenRef, 'virtual-app-screen:reconnect/screen-1');
  assert.equal(parsed.command.refs.sessionRef, 'computer-use:session/reconnect/session.json');
  assert.equal(parsed.command.refs.liveSurfaceRef, 'computer-use:session/reconnect/live-surface.json');
  assert.equal(parsed.command.refs.surfaceRef, 'computer-use:session/reconnect/live-surface.json');
  assert.equal(parsed.command.refs.frameStreamRef, 'computer-use:session/reconnect/frame-stream.json');
  assert.equal(parsed.command.refs.currentFrameRef, 'computer-use:session/reconnect/frames/current.png');
  assert.equal(parsed.command.refs.providerSessionOwnerRef, 'computer-use:provider-session/reconnect/owner.json');
  assert.equal(parsed.command.refs.providerSessionReconnectRef, 'computer-use:provider-session/reconnect/reconnect.json');
  assert.equal(parsed.command.refs.surfaceIdentityRef, 'computer-use:provider-session/reconnect/surface-identity.json');
  assert.equal(parsed.command.refs.surfaceOwnerRef, 'computer-use:native-host/surfaces/reconnect/surface-owner.json');
  assert.equal(parsed.command.refs.displayOwnerRef, 'computer-use:native-host/surfaces/reconnect/display-owner.json');
  assert.equal(parsed.command.refs.liveBindingAttachGrantRef, 'computer-use:provider-session/reconnect/live-binding-attach-grant.json');
  assert.equal(parsed.command.refs.grantValidationRef, 'computer-use:provider-session/reconnect/grant-validation.json');
  assert.equal(parsed.command.refs.surfaceTransportRef, 'computer-use:session/reconnect/surface-transport.json');

  assert.deepEqual(virtualAppScreenRuntimeCommandTraceDetail(parsed.command), {
    source: 'right-pane-screen',
    route: 'virtual-app-screen-screen-reconnect',
    action: 'screen-reconnect',
    refs: parsed.command.refs,
    profile: undefined,
    reconnectReason: 'tab-switch',
    currentFrameSequence: 42,
    terminalEquivalent: true,
    providerExecuted: false,
    failClosed: true,
    singleInteractiveTruth: true,
  });

  const data = virtualAppScreenRuntimeCommandVirtualScreenData(parsed.command);
  assert.equal(data.status, 'blocked');
  assert.equal(data.attachState, 'blocked');
  assert.equal(data.sessionRef, 'computer-use:session/reconnect/session.json');
  assert.equal(data.liveSurfaceRef, 'computer-use:session/reconnect/live-surface.json');
  assert.equal(data.frameStreamRef, 'computer-use:session/reconnect/frame-stream.json');
  assert.equal(data.currentFrameRef, 'computer-use:session/reconnect/frames/current.png');
  assert.equal(data.providerSessionOwnerRef, 'computer-use:provider-session/reconnect/owner.json');
  assert.equal(data.providerSessionReconnectRef, 'computer-use:provider-session/reconnect/reconnect.json');
  assert.equal(data.surfaceIdentityRef, 'computer-use:provider-session/reconnect/surface-identity.json');
  assert.equal(data.surfaceOwnerRef, 'computer-use:native-host/surfaces/reconnect/surface-owner.json');
  assert.equal(data.displayOwnerRef, 'computer-use:native-host/surfaces/reconnect/display-owner.json');
  assert.equal(data.liveBindingAttachGrantRef, 'computer-use:provider-session/reconnect/live-binding-attach-grant.json');
  assert.equal(data.grantValidationRef, 'computer-use:provider-session/reconnect/grant-validation.json');
  assert.equal(data.surfaceTransportRef, 'computer-use:session/reconnect/surface-transport.json');
  assert.deepEqual(data.currentFrameSequence, {
    ref: 'computer-use:session/reconnect/frames/current.png',
    sequence: 42,
  });
  assert.equal(data.runSummary.reconnectReason, 'tab-switch');
});

test('VirtualAppScreen runtime command accepts reconnect aliases and rejects missing or unsafe reconnect refs', () => {
  const alias = parseVirtualAppScreenRuntimeCommand([
    '/computer use screen reconnect',
    '--source right-pane-virtual-app-screen',
    '--reason provider-reconnect',
    '--screen-ref "virtual-app-screen:reconnect/screen-1"',
    '--session-ref "computer-use:session/reconnect/session.json"',
    '--surface-ref "computer-use:session/reconnect/live-surface.json"',
    '--frame-stream-ref "computer-use:session/reconnect/frame-stream.json"',
    '--current-frame-ref "computer-use:session/reconnect/frames/current.png"',
    '--current-frame-sequence 7',
    '--provider-session-owner-ref "computer-use:provider-session/reconnect/owner.json"',
    '--reconnect-ref "computer-use:provider-session/reconnect/reconnect.json"',
    '--surface-identity-ref "computer-use:provider-session/reconnect/surface-identity.json"',
    '--surface-owner-ref "computer-use:native-host/surfaces/reconnect/surface-owner.json"',
    '--display-owner-ref "computer-use:native-host/surfaces/reconnect/display-owner.json"',
    '--live-binding-attach-grant-ref "computer-use:provider-session/reconnect/live-binding-attach-grant.json"',
    '--grant-validation-ref "computer-use:provider-session/reconnect/grant-validation.json"',
    '--surface-transport-ref "computer-use:session/reconnect/surface-transport.json"',
  ].join(' '));

  assert.equal(alias.kind, 'parsed');
  if (alias.kind === 'parsed') {
    assert.equal(alias.command.reconnectReason, 'provider-reconnect');
    assert.equal(alias.command.refs.providerSessionReconnectRef, 'computer-use:provider-session/reconnect/reconnect.json');
    assert.equal(alias.command.refs.surfaceIdentityRef, 'computer-use:provider-session/reconnect/surface-identity.json');
    assert.equal(alias.command.refs.surfaceOwnerRef, 'computer-use:native-host/surfaces/reconnect/surface-owner.json');
    assert.equal(alias.command.refs.displayOwnerRef, 'computer-use:native-host/surfaces/reconnect/display-owner.json');
    assert.equal(alias.command.refs.liveBindingAttachGrantRef, 'computer-use:provider-session/reconnect/live-binding-attach-grant.json');
    assert.equal(alias.command.refs.grantValidationRef, 'computer-use:provider-session/reconnect/grant-validation.json');
  }

  assert.deepEqual(parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen reconnect',
    '--source right-pane-screen',
    '--reason resize',
    '--screen-ref "virtual-app-screen:reconnect/screen-1"',
  ].join(' ')), {
    kind: 'invalid',
    reason: 'VirtualAppScreen screen reconnect requires --provider-session-reconnect-ref or --reconnect-ref.',
  });

  assert.deepEqual(parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen reconnect',
    '--source right-pane-screen',
    '--reason resize',
    '--screen-ref "virtual-app-screen:reconnect/screen-1"',
    '--session-ref "computer-use:session/reconnect/session.json"',
    '--surface-ref "computer-use:session/reconnect/live-surface.json"',
    '--frame-stream-ref "computer-use:session/reconnect/frame-stream.json"',
    '--current-frame-ref "computer-use:session/reconnect/frames/current.png"',
    '--current-frame-sequence 1',
    '--provider-session-owner-ref "computer-use:provider-session/reconnect/owner.json"',
    '--reconnect-ref "computer-use:provider-session/reconnect/reconnect.json"',
    '--surface-identity-ref "computer-use:provider-session/reconnect/surface-identity.json"',
    '--surface-owner-ref "computer-use:native-host/surfaces/reconnect/surface-owner.json"',
    '--display-owner-ref "computer-use:native-host/surfaces/reconnect/display-owner.json"',
    '--live-binding-attach-grant-ref "computer-use:provider-session/reconnect/live-binding-attach-grant.json"',
    '--grant-validation-ref "computer-use:provider-session/reconnect/grant-validation.json"',
  ].join(' ')), {
    kind: 'invalid',
    reason: 'VirtualAppScreen screen reconnect requires --surface-transport-ref.',
  });

  assert.deepEqual(parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen reconnect',
    '--source right-pane-screen',
    '--reason resize',
    '--screen-ref "virtual-app-screen:reconnect/screen-1"',
    '--session-ref "computer-use:session/reconnect/session.json"',
    '--surface-ref "computer-use:session/reconnect/live-surface.json"',
    '--frame-stream-ref "computer-use:session/reconnect/frame-stream.json"',
    '--current-frame-ref "computer-use:session/reconnect/frames/current.png"',
    '--current-frame-sequence 1',
    '--provider-session-owner-ref "computer-use:provider-session/reconnect/owner.json"',
    '--reconnect-ref "javascript:alert(1)"',
    '--surface-identity-ref "computer-use:provider-session/reconnect/surface-identity.json"',
    '--surface-owner-ref "computer-use:native-host/surfaces/reconnect/surface-owner.json"',
    '--display-owner-ref "computer-use:native-host/surfaces/reconnect/display-owner.json"',
    '--live-binding-attach-grant-ref "computer-use:provider-session/reconnect/live-binding-attach-grant.json"',
    '--grant-validation-ref "computer-use:provider-session/reconnect/grant-validation.json"',
    '--surface-transport-ref "computer-use:session/reconnect/surface-transport.json"',
  ].join(' ')), {
    kind: 'invalid',
    reason: 'VirtualAppScreen runtime command ref --reconnect-ref is unsafe.',
  });
});

test('VirtualAppScreen runtime command rejects missing required refs and unsafe refs', () => {
  assert.deepEqual(parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--target-app-ref "app:profile/vscode-editor"',
    '--activation-ref "computer-use:screen/attach.json"',
  ].join(' ')), {
    kind: 'invalid',
    reason: 'VirtualAppScreen runtime command requires --adapter-readiness-ref or --provider-readiness-ref.',
  });

  assert.deepEqual(parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--target-app-ref "app:profile/vscode-editor"',
    '--activation-ref "data:image/png;base64,abc"',
    '--adapter-readiness-ref "computer-use:screen/readiness.json"',
  ].join(' ')), {
    kind: 'invalid',
    reason: 'VirtualAppScreen runtime command ref --activation-ref is unsafe.',
  });

  assert.deepEqual(parseVirtualAppScreenRuntimeCommand([
    '/computer-use permission-handoff',
    '--source right-pane-screen',
    '--provider-readiness-ref "computer-use:screen/readiness.json"',
  ].join(' ')), {
    kind: 'invalid',
    reason: 'VirtualAppScreen permission handoff requires --target-ref or --handoff-ref.',
  });
});
