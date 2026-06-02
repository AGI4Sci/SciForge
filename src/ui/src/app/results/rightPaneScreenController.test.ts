import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { VirtualScreenPayload } from '../../../../../packages/presentation/components';
import { rightPaneVirtualScreenActivationCommand } from './rightPaneScreenController';

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
  const payload: VirtualScreenPayload = {
    status: 'blocked',
    attachState: 'blocked',
    targetAppRef: 'app:profile/vscode-editor',
    screenRef: 'virtual-app-screen:session-screen/screen-request',
    adapterReadinessRef: 'computer-use:screen-activation/session-screen/provider-readiness.json',
    blockedRef: 'computer-use:screen-activation/session-screen/blocked/no-native-session.json',
    handoffRef: 'computer-use:screen-activation/session-screen/attach-request.json',
    evidenceLedgerRef: 'ledger:computer-use/session-screen/screen-activation.json',
    guiPresentRefs: ['gui.present:session-screen/screen-pane-activation'],
  };

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

test('right pane screen activation command reconnects blocked current-session refs without new attach', () => {
  const payload: VirtualScreenPayload = {
    status: 'blocked',
    attachState: 'blocked',
    surfaceMode: 'empty',
    targetAppRef: 'app:profile/vscode-editor',
    screenRef: 'virtual-app-screen:reconnect/screen-request',
    sessionRef: 'computer-use:session/reconnect/session.json',
    liveSurfaceRef: 'computer-use:session/reconnect/live-surface.json',
    frameStreamRef: 'computer-use:session/reconnect/frame-stream.json',
    currentFrameRef: 'computer-use:session/reconnect/frames/current.png',
    currentFrameSequence: {
      ref: 'computer-use:session/reconnect/frame-sequence.json',
      sequence: 9,
    },
    providerSessionOwnerRef: 'computer-use:provider-session/reconnect/owner.json',
    providerSessionReconnectRef: 'computer-use:provider-session/reconnect/reconnect.json',
    liveBindingAttachGrantRef: 'computer-use:provider-session/reconnect/live-binding-attach-grant.json',
    surfaceTransportRef: 'computer-use:session/reconnect/surface-transport.json',
    adapterReadinessRef: 'computer-use:session/reconnect/provider-readiness.json',
    evidenceLedgerRef: 'ledger:computer-use/reconnect/screen-reconnect.json',
    guiPresentRefs: ['gui.present:reconnect/screen-pane'],
  };

  const command = rightPaneVirtualScreenActivationCommand(payload);

  assert.equal(command?.label, 'Reconnect VirtualAppScreen');
  assert.equal(command?.targetRef, 'computer-use:provider-session/reconnect/reconnect.json');
  assert.equal(command?.commandKey, 'computer-use:provider-session/reconnect/reconnect.json:computer-use:provider-session/reconnect/live-binding-attach-grant.json:computer-use:session/reconnect/frames/current.png:9');
  assert.equal(command?.commandText, [
    '/computer-use screen reconnect',
    '--source right-pane-screen',
    '--reason provider-reconnect',
    '--screen-ref "virtual-app-screen:reconnect/screen-request"',
    '--session-ref "computer-use:session/reconnect/session.json"',
    '--live-surface-ref "computer-use:session/reconnect/live-surface.json"',
    '--frame-stream-ref "computer-use:session/reconnect/frame-stream.json"',
    '--current-frame-ref "computer-use:session/reconnect/frames/current.png"',
    '--current-frame-sequence 9',
    '--provider-session-owner-ref "computer-use:provider-session/reconnect/owner.json"',
    '--provider-session-reconnect-ref "computer-use:provider-session/reconnect/reconnect.json"',
    '--live-binding-attach-grant-ref "computer-use:provider-session/reconnect/live-binding-attach-grant.json"',
    '--surface-transport-ref "computer-use:session/reconnect/surface-transport.json"',
    '--adapter-readiness-ref "computer-use:session/reconnect/provider-readiness.json"',
    '--evidence-ledger-ref "ledger:computer-use/reconnect/screen-reconnect.json"',
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
    liveBindingAttachGrantRef: undefined,
  }), undefined);
});

test('right pane screen activation command routes authorization-incomplete payloads to permission handoff', () => {
  const payload: VirtualScreenPayload = {
    status: 'requires-handoff',
    attachState: 'requires-handoff',
    targetAppRef: 'app:profile/vscode-editor',
    screenRef: 'virtual-app-screen:permission-screen/screen-request',
    sessionRef: 'computer-use:session/permission-screen/session.json',
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
    '--screen-ref "virtual-app-screen:permission-screen/screen-request"',
    '--session-ref "computer-use:session/permission-screen/session.json"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--blocked-ref "computer-use:session/permission-screen/blocked/permission.json"',
    '--evidence-ledger-ref "ledger:computer-use/permission-screen/permission-handoff.json"',
    '--gui-present-ref "gui.present:permission-screen/permission-handoff"',
  ].join(' '));
  assert.doesNotMatch(command?.commandText ?? '', /noVNC|desktop fallback|shell fallback|desktopBridge|runComputerUse|executeScoped/i);
});
