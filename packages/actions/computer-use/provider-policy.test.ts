import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computerUseActionRequestExecutorProvider,
  computerUseCaptureHostPortProvider,
  computerUseCaptureDiagnostics,
  computerUseCaptureProviderIds,
  computerUseCaptureProviderName,
  computerUseExecuteHostPortProvider,
  computerUseHostPortLists,
  computerUseHostPortProviderIds,
  computerUseHostPortsContractIds,
  computerUseHostPortsPolicySummary,
  computerUseTraceHandoffContract,
  computerUseWindowCaptureProvider,
} from './provider-policy.js';

test('computer use capture provider policy owns stable provider ids', () => {
  assert.equal(
    computerUseCaptureProviderName({ desktopPlatform: 'darwin', captureScope: 'display' }),
    computerUseCaptureProviderIds.macosDisplayCapture,
  );
  assert.equal(
    computerUseCaptureProviderName({ desktopPlatform: 'macos', captureScope: 'window' }),
    computerUseCaptureProviderIds.macosWindowCapture,
  );
  assert.equal(
    computerUseCaptureProviderName({ desktopPlatform: 'linux', captureScope: 'display' }),
    'linux-display-capture-provider',
  );
});

test('computer use window capture policy reports unsupported providers consistently', () => {
  assert.equal(
    computerUseWindowCaptureProvider({ desktopPlatform: 'linux', windowId: 42 }),
    'linux-window-provider-unavailable',
  );
  assert.equal(
    computerUseWindowCaptureProvider({ desktopPlatform: '', windowId: 42 }),
    'unknown-window-provider-unavailable',
  );
  assert.equal(
    computerUseWindowCaptureProvider({ desktopPlatform: 'darwin', windowId: 42 }),
    computerUseCaptureProviderIds.macosWindowCapture,
  );
  assert.equal(
    computerUseWindowCaptureProvider({ desktopPlatform: 'linux', dryRun: true, windowId: 42 }),
    computerUseCaptureProviderIds.dryRunWindowPng,
  );
  assert.equal(computerUseCaptureDiagnostics.displayProviderResult.code, 'capture.display.provider-result');
  assert.equal(computerUseCaptureDiagnostics.focusRegionProviderResult.code, 'capture.focus-region.provider-result');
  assert.equal(computerUseCaptureDiagnostics.windowProviderResult.code, 'capture.window.provider-result');
  assert.equal(computerUseCaptureDiagnostics.windowUnsupportedProvider.code, 'capture.window.unsupported-provider');
});

test('computer use host port policy names thin host adapter providers', () => {
  assert.equal(computerUseHostPortsContractIds.schemaVersion, 'sciforge.computer-use.host-ports.v1');
  assert.deepEqual(computerUseHostPortLists.required, ['capture', 'plan', 'locate', 'execute', 'verify']);
  assert.deepEqual(computerUseHostPortLists.forbidden, ['requestApproval', 'gui.present', 'gui.ask_user']);
  assert.equal(
    computerUseCaptureHostPortProvider({ enabled: true, mode: 'app-window' }),
    computerUseHostPortProviderIds.targetWindowCapture,
  );
  assert.equal(
    computerUseCaptureHostPortProvider({ enabled: false, mode: 'app-window' }),
    computerUseHostPortProviderIds.displayCapture,
  );
  assert.equal(
    computerUseActionRequestExecutorProvider({ desktopPlatform: 'Darwin', dryRun: false }),
    'darwin-host-port-executor',
  );
  assert.equal(
    computerUseExecuteHostPortProvider({ desktopPlatform: 'Darwin', dryRun: false }),
    'darwin-generic-gui-executor',
  );
  assert.equal(
    computerUseExecuteHostPortProvider({ desktopPlatform: 'Darwin', dryRun: true }),
    'dry-run-generic-gui-executor',
  );

  const policy = computerUseHostPortsPolicySummary({
    desktopPlatform: 'darwin',
    windowTarget: { enabled: true, mode: 'window-id' },
  });
  assert.equal(policy.providers.capture, computerUseHostPortProviderIds.targetWindowCapture);
  assert.equal(policy.providers.crop, computerUseHostPortProviderIds.focusRegionCrop);
  assert.equal(policy.providers.writeTrace, computerUseHostPortProviderIds.writeTrace);
  assert.equal(policy.traceHandoff.presentationTarget, computerUseTraceHandoffContract.presentationTarget);
  assert.deepEqual(policy.traceHandoff.forbiddenInlinePayloads, ['rawScreenshot', 'base64', 'data:image']);
});
