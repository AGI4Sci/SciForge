import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { VirtualScreenPayload } from '../../../../../packages/presentation/components';
import {
  rightPaneVirtualScreenActivationCommand,
  rightPaneVirtualScreenPayloadWithLiveBindingRegistry,
} from './rightPaneScreenController';
import {
  createRightPaneActiveVirtualAppScreenRegistry,
  updateRightPaneActiveVirtualAppScreenRegistry,
} from './rightPaneLiveBindingRegistry';

test('right pane screen controller owns Screen activation without executing Computer Use directly', () => {
  const controllerSource = readFileSync(new URL('./rightPaneScreenController.ts', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');
  const adapterSource = readFileSync(new URL('./screenPaneHostAdapter.tsx', import.meta.url), 'utf8');

  assert.match(controllerSource, /export function useRightPaneScreenController/);
  assert.match(controllerSource, /rightPaneVirtualScreenPayload/);
  assert.match(controllerSource, /resultTab !== 'screen'/);
  assert.match(controllerSource, /emittedActivationKeys/);
  assert.match(rendererSource, /useRightPaneScreenController/);
  assert.match(adapterSource, /payload:\s*providedPayload/);
  assert.match(adapterSource, /attachVirtualAppScreenSurface/);
  assert.match(adapterSource, /data-host-presentation-boundary="virtual-app-screen-ref-bridge"/);
  assert.doesNotMatch(controllerSource, /sendBrowserHostSessionAction|startBrowserHostSession|executeScoped|runComputerUse|invokeWorkspaceModule/);
  assert.doesNotMatch(adapterSource, /rightPaneVirtualScreenActivationCommand|sendBrowserHostSessionAction|startBrowserHostSession|executeScoped|runComputerUse|attachVirtualAppScreenSession|registerVirtualAppScreenSessionExecutor/);
});

test('right pane screen activation command is refs-first and fail-closed', () => {
  const payload = {
    status: 'blocked',
    attachState: 'blocked',
    targetAppRef: 'app:profile/vscode-editor',
    screenRef: 'virtual-app-screen:session-screen/screen-request',
    preflightRef: 'computer-use:native-host/preflights/session-screen/preflight.json',
    preflightLedgerRef: 'computer-use:native-host/preflights/session-screen/preflight-ledger.json',
    preflightLedgerEntryRef: 'computer-use:native-host/preflights/session-screen/preflight-ledger.json/events/0001-preflight.recorded.json',
    hostReadinessRef: 'computer-use:native-host/preflights/session-screen/host-readiness.json',
    adapterReadinessRef: 'computer-use:screen-activation/session-screen/provider-readiness.json',
    blockedRef: 'computer-use:screen-activation/session-screen/blocked/no-native-session.json',
    handoffRef: 'computer-use:screen-activation/session-screen/attach-request.json',
    evidenceLedgerRef: 'ledger:computer-use/session-screen/screen-activation.json',
    guiPresentRefs: ['gui.present:session-screen/screen-pane-activation'],
  } as VirtualScreenPayload & Record<string, unknown>;

  const command = rightPaneVirtualScreenActivationCommand(payload);

  assert.equal(command?.label, 'Attach VirtualAppScreen');
  assert.equal(command?.targetRef, 'computer-use:screen-activation/session-screen/attach-request.json');
  assert.equal(command?.commandKey, 'computer-use:screen-activation/session-screen/attach-request.json');
  assert.equal(command?.commandText, [
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--profile "vscode-editor"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--screen-ref "virtual-app-screen:session-screen/screen-request"',
    '--activation-ref "computer-use:screen-activation/session-screen/attach-request.json"',
    '--adapter-readiness-ref "computer-use:screen-activation/session-screen/provider-readiness.json"',
    '--preflight-ref "computer-use:native-host/preflights/session-screen/preflight.json"',
    '--preflight-ledger-ref "computer-use:native-host/preflights/session-screen/preflight-ledger.json"',
    '--preflight-ledger-entry-ref "computer-use:native-host/preflights/session-screen/preflight-ledger.json/events/0001-preflight.recorded.json"',
    '--host-readiness-ref "computer-use:native-host/preflights/session-screen/host-readiness.json"',
    '--evidence-ledger-ref "ledger:computer-use/session-screen/screen-activation.json"',
    '--gui-present-ref "gui.present:session-screen/screen-pane-activation"',
  ].join(' '));
  assert.doesNotMatch(command?.commandText ?? '', /providerRoute|providerUrl|data:image|base64|executorLease|desktopBridge/);

  assert.equal(rightPaneVirtualScreenActivationCommand({ ...payload, sessionRef: 'computer-use:session/session-screen/session.json' }), undefined);
  assert.equal(rightPaneVirtualScreenActivationCommand({ ...payload, adapterReadinessRef: undefined }), undefined);
  assert.equal(rightPaneVirtualScreenActivationCommand({ ...payload, status: 'ready', attachState: 'attached' }), undefined);
});

test('right pane screen activation command probes attach before default permission placeholders', () => {
  const payload: VirtualScreenPayload = {
    status: 'blocked',
    attachState: 'blocked',
    surfaceMode: 'empty',
    targetAppRef: 'app:profile/vscode-editor',
    screenRef: 'virtual-app-screen:placeholder/screen-request',
    adapterReadinessRef: 'computer-use:screen-activation/placeholder/provider-readiness.json',
    handoffRef: 'computer-use:screen-activation/placeholder/attach-request.json',
    permissionRequired: true,
    permissionGranted: false,
    permissionStatus: 'missing',
    platformDriverStatus: 'missing',
    permissionHandoffRef: 'computer-use:screen-activation/placeholder/permission-handoff.json',
    permissionHandoffRefs: [
      'computer-use:screen-activation/placeholder/permission-handoff/macos-screen-recording.json',
    ],
    permissionRecheckRef: 'computer-use:screen-activation/placeholder/permission-recheck.json',
    evidenceLedgerRef: 'ledger:computer-use/placeholder/screen-activation.json',
    guiPresentRefs: ['gui.present:placeholder/screen-pane-activation'],
  };

  const command = rightPaneVirtualScreenActivationCommand(payload);

  assert.equal(command?.label, 'Attach VirtualAppScreen');
  assert.equal(command?.targetRef, 'computer-use:screen-activation/placeholder/attach-request.json');
  assert.match(command?.commandText ?? '', /^\/computer-use screen attach /);
  assert.doesNotMatch(command?.commandText ?? '', /permission-handoff/);
});

test('right pane screen activation command ignores screen activation preflight placeholders', () => {
  const payload: VirtualScreenPayload = {
    status: 'blocked',
    attachState: 'blocked',
    targetAppRef: 'app:profile/vscode-editor',
    screenRef: 'virtual-app-screen:placeholder-preflight/screen-request',
    preflightRef: 'computer-use:screen-activation/placeholder-preflight/preflight.json',
    preflightLedgerRef: 'ledger:computer-use/placeholder-preflight/preflight-ledger.json',
    preflightLedgerEntryRef: 'computer-use:screen-activation/placeholder-preflight/preflight-ledger.json/events/0001-preflight.recorded.json',
    hostReadinessRef: 'computer-use:screen-activation/placeholder-preflight/host-readiness.json',
    adapterReadinessRef: 'computer-use:screen-activation/placeholder-preflight/provider-readiness.json',
    handoffRef: 'computer-use:screen-activation/placeholder-preflight/attach-request.json',
  };

  const command = rightPaneVirtualScreenActivationCommand(payload);

  assert.equal(command?.label, 'Attach VirtualAppScreen');
  assert.doesNotMatch(command?.commandText ?? '', /--preflight-ref/);
  assert.doesNotMatch(command?.commandText ?? '', /--preflight-ledger-ref/);
  assert.doesNotMatch(command?.commandText ?? '', /--preflight-ledger-entry-ref/);
  assert.doesNotMatch(command?.commandText ?? '', /--host-readiness-ref/);
});

test('right pane screen activation command reconnects blocked current-session refs without new attach', () => {
  const payload = {
    status: 'blocked',
    attachState: 'blocked',
    surfaceMode: 'empty',
    targetAppRef: 'app:profile/vscode-editor',
    screenRef: 'virtual-app-screen:reconnect/screen-request',
    sessionRef: 'computer-use:native-host/sessions/reconnect/session.json',
    liveSurfaceRef: 'computer-use:native-host/surfaces/reconnect/live-surface.json',
    frameStreamRef: 'computer-use:native-host/surfaces/reconnect/frame-stream.json',
    currentFrameRef: 'computer-use:native-host/frames/reconnect/current.png',
    currentFrameSequence: {
      ref: 'computer-use:native-host/frames/reconnect/current.png',
      sequence: 9,
    },
    providerSessionOwnerRef: 'computer-use:provider-session/reconnect/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/reconnect/reconnect.json',
    surfaceIdentityRef: 'computer-use:provider-session/reconnect/surface-identity.json',
    surfaceOwnerRef: 'computer-use:native-host/surfaces/reconnect/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/surfaces/reconnect/display-owner.json',
    liveBindingAttachGrantRef: 'computer-use:native-host/grants/reconnect/live-binding-attach-grant.json',
    grantValidationRef: 'computer-use:native-host/ledgers/reconnect/evidence-ledger.json/events/0004-grant.validated.json',
    surfaceTransportRef: 'computer-use:native-host/surfaces/reconnect/surface-transport.json',
    adapterReadinessRef: 'computer-use:native-host/readiness/reconnect/provider-readiness.json',
    evidenceLedgerRef: 'computer-use:native-host/ledgers/reconnect/evidence-ledger.json',
    guiPresentRefs: ['gui.present:reconnect/screen-pane'],
  } as VirtualScreenPayload & Record<string, unknown>;

  const command = rightPaneVirtualScreenActivationCommand(payload);

  assert.equal(command?.label, 'Reconnect VirtualAppScreen');
  assert.equal(command?.targetRef, 'computer-use:provider-session/reconnect/reconnect.json');
  assert.equal(command?.commandKey, 'computer-use:provider-session/reconnect/reconnect.json:computer-use:native-host/grants/reconnect/live-binding-attach-grant.json:computer-use:native-host/ledgers/reconnect/evidence-ledger.json/events/0004-grant.validated.json:computer-use:native-host/frames/reconnect/current.png:9');
  assert.equal(command?.commandText, [
    '/computer-use screen reconnect',
    '--source right-pane-screen',
    '--reason provider-reconnect',
    '--screen-ref "virtual-app-screen:reconnect/screen-request"',
    '--session-ref "computer-use:native-host/sessions/reconnect/session.json"',
    '--live-surface-ref "computer-use:native-host/surfaces/reconnect/live-surface.json"',
    '--frame-stream-ref "computer-use:native-host/surfaces/reconnect/frame-stream.json"',
    '--current-frame-ref "computer-use:native-host/frames/reconnect/current.png"',
    '--current-frame-sequence 9',
    '--provider-session-owner-ref "computer-use:provider-session/reconnect/owner.json"',
    '--provider-session-reconnect-ref "computer-use:provider-session/reconnect/reconnect.json"',
    '--surface-identity-ref "computer-use:provider-session/reconnect/surface-identity.json"',
    '--surface-owner-ref "computer-use:native-host/surfaces/reconnect/surface-owner.json"',
    '--display-owner-ref "computer-use:native-host/surfaces/reconnect/display-owner.json"',
    '--live-binding-attach-grant-ref "computer-use:native-host/grants/reconnect/live-binding-attach-grant.json"',
    '--grant-validation-ref "computer-use:native-host/ledgers/reconnect/evidence-ledger.json/events/0004-grant.validated.json"',
    '--surface-transport-ref "computer-use:native-host/surfaces/reconnect/surface-transport.json"',
    '--adapter-readiness-ref "computer-use:native-host/readiness/reconnect/provider-readiness.json"',
    '--evidence-ledger-ref "computer-use:native-host/ledgers/reconnect/evidence-ledger.json"',
    '--gui-present-ref "gui.present:reconnect/screen-pane"',
  ].join(' '));
  assert.doesNotMatch(command?.commandText ?? '', /screen attach|runComputerUse|executeScoped|desktopBridge/);

  assert.equal(rightPaneVirtualScreenActivationCommand({
    ...payload,
    status: 'ready',
    attachState: 'attached',
    surfaceMode: 'live',
  }), undefined);
  assert.equal(rightPaneVirtualScreenActivationCommand({
    ...payload,
    providerSessionReconnectRef: undefined,
  }), undefined);
  assert.equal(rightPaneVirtualScreenActivationCommand({
    ...payload,
    surfaceIdentityRef: undefined,
  } as VirtualScreenPayload & Record<string, unknown>), undefined);
  assert.equal(rightPaneVirtualScreenActivationCommand({
    ...payload,
    surfaceOwnerRef: undefined,
  } as VirtualScreenPayload & Record<string, unknown>), undefined);
  assert.equal(rightPaneVirtualScreenActivationCommand({
    ...payload,
    displayOwnerRef: undefined,
  } as VirtualScreenPayload & Record<string, unknown>), undefined);
  assert.equal(rightPaneVirtualScreenActivationCommand({
    ...payload,
    liveBindingAttachGrantRef: undefined,
  }), undefined);
  assert.equal(rightPaneVirtualScreenActivationCommand({
    ...payload,
    grantValidationRef: undefined,
  }), undefined);
  assert.equal(rightPaneVirtualScreenActivationCommand({
    ...payload,
    sessionRef: 'computer-use:session/reconnect/session.json',
  }), undefined);
  assert.equal(rightPaneVirtualScreenActivationCommand({
    ...payload,
    liveBindingAttachGrantRef: 'computer-use:provider-session/reconnect/live-binding-attach-grant.json',
  }), undefined);
});

test('right pane screen activation command routes authorization-incomplete payloads to permission handoff', () => {
  const payload: VirtualScreenPayload = {
    status: 'requires-handoff',
    attachState: 'requires-handoff',
    targetAppRef: 'app:profile/vscode-editor',
    screenRef: 'virtual-app-screen:permission-screen/screen-request',
    sessionRef: 'computer-use:session/permission-screen/session.json',
    preflightRef: 'computer-use:native-host/preflights/permission-screen/preflight.json',
    preflightLedgerRef: 'computer-use:native-host/preflights/permission-screen/preflight-ledger.json',
    preflightLedgerEntryRef: 'computer-use:native-host/preflights/permission-screen/preflight-ledger.json/events/0001-preflight.recorded.json',
    hostReadinessRef: 'computer-use:native-host/preflights/permission-screen/host-readiness.json',
    adapterReadinessRef: 'computer-use:session/permission-screen/provider-readiness.json',
    platformDriverRef: 'computer-use:session/permission-screen/platform-driver.json',
    platformDriverStatus: 'not-installed',
    blockedRef: 'computer-use:session/permission-screen/blocked/permission.json',
    permissionRef: 'computer-use:session/permission-screen/permissions/platform-gates.json',
    permissionStatus: 'missing',
    permissionRequired: true,
    permissionGranted: false,
    permissionHandoffRef: 'computer-use:session/permission-screen/handoff/platform-gates.json',
    permissionRecheckRef: 'computer-use:session/permission-screen/recheck/platform-gates.json',
    evidenceLedgerRef: 'ledger:computer-use/permission-screen/permission-handoff.json',
    guiPresentRefs: ['gui.present:permission-screen/permission-handoff'],
  };

  const command = rightPaneVirtualScreenActivationCommand(payload);

  assert.equal(command?.label, 'Resolve Screen Permissions');
  assert.equal(command?.targetRef, 'computer-use:session/permission-screen/handoff/platform-gates.json');
  assert.equal(command?.commandKey, 'computer-use:session/permission-screen/handoff/platform-gates.json:computer-use:session/permission-screen/recheck/platform-gates.json');
  assert.equal(command?.commandText, [
    '/computer-use permission-handoff',
    '--source right-pane-screen',
    '--target-ref "computer-use:session/permission-screen/handoff/platform-gates.json"',
    '--permission-ref "computer-use:session/permission-screen/permissions/platform-gates.json"',
    '--recheck-ref "computer-use:session/permission-screen/recheck/platform-gates.json"',
    '--provider-readiness-ref "computer-use:session/permission-screen/provider-readiness.json"',
    '--platform-driver-ref "computer-use:session/permission-screen/platform-driver.json"',
    '--preflight-ref "computer-use:native-host/preflights/permission-screen/preflight.json"',
    '--preflight-ledger-ref "computer-use:native-host/preflights/permission-screen/preflight-ledger.json"',
    '--preflight-ledger-entry-ref "computer-use:native-host/preflights/permission-screen/preflight-ledger.json/events/0001-preflight.recorded.json"',
    '--host-readiness-ref "computer-use:native-host/preflights/permission-screen/host-readiness.json"',
    '--screen-ref "virtual-app-screen:permission-screen/screen-request"',
    '--session-ref "computer-use:session/permission-screen/session.json"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--blocked-ref "computer-use:session/permission-screen/blocked/permission.json"',
    '--evidence-ledger-ref "ledger:computer-use/permission-screen/permission-handoff.json"',
    '--gui-present-ref "gui.present:permission-screen/permission-handoff"',
  ].join(' '));
  assert.doesNotMatch(command?.commandText ?? '', /noVNC|desktop fallback|shell fallback|desktopBridge|runComputerUse|executeScoped/i);
});

test('right pane screen activation command auto rechecks restored permissions when gates are ready', () => {
  const payload: VirtualScreenPayload = {
    status: 'requires-handoff',
    attachState: 'requires-handoff',
    targetAppRef: 'app:profile/vscode-editor',
    screenRef: 'virtual-app-screen:permission-restored/screen-request',
    sessionRef: 'computer-use:session/permission-restored/session.json',
    preflightRef: 'computer-use:native-host/preflights/permission-restored/preflight.json',
    preflightLedgerRef: 'computer-use:native-host/preflights/permission-restored/preflight-ledger.json',
    preflightLedgerEntryRef: 'computer-use:native-host/preflights/permission-restored/preflight-ledger.json/events/0001-preflight.recorded.json',
    hostReadinessRef: 'computer-use:native-host/preflights/permission-restored/host-readiness.json',
    adapterReadinessRef: 'computer-use:session/permission-restored/provider-readiness.json',
    platformDriverRef: 'computer-use:session/permission-restored/platform-driver.json',
    platformDriverStatus: 'ready',
    blockedRef: 'computer-use:session/permission-restored/blocked/permission.json',
    permissionRef: 'computer-use:session/permission-restored/permissions/platform-gates.json',
    permissionStatus: 'granted',
    permissionRequired: true,
    permissionGranted: true,
    permissionHandoffRef: 'computer-use:session/permission-restored/handoff/platform-gates.json',
    permissionRecheckRef: 'computer-use:session/permission-restored/recheck/platform-gates.json',
    evidenceLedgerRef: 'ledger:computer-use/permission-restored/permission-recheck.json',
    guiPresentRefs: ['gui.present:permission-restored/permission-recheck'],
  };

  const command = rightPaneVirtualScreenActivationCommand(payload);

  assert.equal(command?.label, 'Recheck Screen Permissions');
  assert.equal(command?.targetRef, 'computer-use:session/permission-restored/recheck/platform-gates.json');
  assert.equal(command?.commandKey, 'computer-use:session/permission-restored/recheck/platform-gates.json:computer-use:session/permission-restored/provider-readiness.json:permission-ready');
  assert.equal(command?.commandText, [
    '/computer-use permission-recheck',
    '--source right-pane-screen',
    '--target-ref "computer-use:session/permission-restored/recheck/platform-gates.json"',
    '--adapter-readiness-ref "computer-use:session/permission-restored/provider-readiness.json"',
    '--permission-ref "computer-use:session/permission-restored/permissions/platform-gates.json"',
    '--platform-driver-ref "computer-use:session/permission-restored/platform-driver.json"',
    '--preflight-ref "computer-use:native-host/preflights/permission-restored/preflight.json"',
    '--preflight-ledger-ref "computer-use:native-host/preflights/permission-restored/preflight-ledger.json"',
    '--preflight-ledger-entry-ref "computer-use:native-host/preflights/permission-restored/preflight-ledger.json/events/0001-preflight.recorded.json"',
    '--host-readiness-ref "computer-use:native-host/preflights/permission-restored/host-readiness.json"',
    '--screen-ref "virtual-app-screen:permission-restored/screen-request"',
    '--session-ref "computer-use:session/permission-restored/session.json"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--blocked-ref "computer-use:session/permission-restored/blocked/permission.json"',
    '--evidence-ledger-ref "ledger:computer-use/permission-restored/permission-recheck.json"',
    '--gui-present-ref "gui.present:permission-restored/permission-recheck"',
  ].join(' '));
  assert.doesNotMatch(command?.commandText ?? '', /permission-handoff|screen attach|runComputerUse|executeScoped/);

  const missingPermissionCommand = rightPaneVirtualScreenActivationCommand({
    ...payload,
    permissionStatus: 'missing',
    permissionGranted: false,
  });

  assert.equal(missingPermissionCommand?.label, 'Resolve Screen Permissions');
  assert.match(missingPermissionCommand?.commandText ?? '', /^\/computer-use permission-handoff /);
});

test('right pane screen controller merges same-screen live registry refs before reconnecting restored payloads', () => {
  const registry = updateRightPaneActiveVirtualAppScreenRegistry(createRightPaneActiveVirtualAppScreenRegistry(), {
    screenRef: 'virtual-app-screen:restore-reconnect/screen-request',
    tabId: 'custom:screen:restore:1',
    sessionRef: 'computer-use:native-host/sessions/restore-reconnect/session.json',
    liveSurfaceRef: 'computer-use:native-host/surfaces/restore-reconnect/live-surface.json',
    frameStreamRef: 'computer-use:native-host/surfaces/restore-reconnect/frame-stream.json',
    currentFrameRef: 'computer-use:native-host/frames/restore-reconnect/current.png',
    providerSessionOwnerRef: 'computer-use:provider-session/restore-reconnect/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/restore-reconnect/reconnect.json',
    surfaceIdentityRef: 'computer-use:provider-session/restore-reconnect/surface-identity.json',
    surfaceOwnerRef: 'computer-use:native-host/surfaces/restore-reconnect/surface-owner.json',
    displayOwnerRef: 'computer-use:native-host/surfaces/restore-reconnect/display-owner.json',
    liveBindingAttachGrantRef: 'computer-use:native-host/grants/restore-reconnect/live-binding-attach-grant.json',
    grantValidationRef: 'computer-use:native-host/ledgers/restore-reconnect/evidence-ledger.json/events/0004-grant.validated.json',
    surfaceTransportRef: 'computer-use:native-host/surfaces/restore-reconnect/surface-transport.json',
    currentFrameSequence: {
      ref: 'computer-use:native-host/frames/restore-reconnect/current.png',
      sequence: 14,
    },
    adapterReadinessRef: 'computer-use:native-host/readiness/restore-reconnect/provider-readiness.json',
    evidenceLedgerRef: 'computer-use:native-host/ledgers/restore-reconnect/evidence-ledger.json',
  });

  const restored = rightPaneVirtualScreenPayloadWithLiveBindingRegistry({
    status: 'blocked',
    attachState: 'blocked',
    surfaceMode: 'empty',
    targetAppRef: 'app:profile/vscode-editor',
    screenRef: 'virtual-app-screen:restore-reconnect/screen-request',
    blockedRef: 'computer-use:native-host/blocked/restore-reconnect/restored.json',
    blockedReason: 'Restored screen is waiting for provider reconnect.',
  }, registry, 'custom:screen:restore:1').payload;
  const command = rightPaneVirtualScreenActivationCommand(restored);

  assert.equal(restored.sessionRef, 'computer-use:native-host/sessions/restore-reconnect/session.json');
  assert.equal(restored.liveSurfaceRef, 'computer-use:native-host/surfaces/restore-reconnect/live-surface.json');
  assert.equal(restored.providerSessionReconnectRef, 'computer-use:provider-session/restore-reconnect/reconnect.json');
  assert.equal((restored as Record<string, unknown>).surfaceIdentityRef, 'computer-use:provider-session/restore-reconnect/surface-identity.json');
  assert.equal((restored as Record<string, unknown>).surfaceOwnerRef, 'computer-use:native-host/surfaces/restore-reconnect/surface-owner.json');
  assert.equal((restored as Record<string, unknown>).displayOwnerRef, 'computer-use:native-host/surfaces/restore-reconnect/display-owner.json');
  assert.equal(restored.liveBindingAttachGrantRef, 'computer-use:native-host/grants/restore-reconnect/live-binding-attach-grant.json');
  assert.equal(restored.grantValidationRef, 'computer-use:native-host/ledgers/restore-reconnect/evidence-ledger.json/events/0004-grant.validated.json');
  assert.equal(command?.label, 'Reconnect VirtualAppScreen');
  assert.equal(command?.targetRef, 'computer-use:provider-session/restore-reconnect/reconnect.json');
  assert.match(command?.commandText ?? '', /^\/computer-use screen reconnect /);
  assert.match(command?.commandText ?? '', /--surface-identity-ref "computer-use:provider-session\/restore-reconnect\/surface-identity\.json"/);
  assert.match(command?.commandText ?? '', /--surface-owner-ref "computer-use:native-host\/surfaces\/restore-reconnect\/surface-owner\.json"/);
  assert.match(command?.commandText ?? '', /--display-owner-ref "computer-use:native-host\/surfaces\/restore-reconnect\/display-owner\.json"/);
  assert.match(command?.commandText ?? '', /--live-binding-attach-grant-ref "computer-use:native-host\/grants\/restore-reconnect\/live-binding-attach-grant\.json"/);
  assert.match(command?.commandText ?? '', /--grant-validation-ref "computer-use:native-host\/ledgers\/restore-reconnect\/evidence-ledger\.json\/events\/0004-grant\.validated\.json"/);
  assert.doesNotMatch(command?.commandText ?? '', /screen attach|permission-handoff|runComputerUse|executeScoped/);
});
