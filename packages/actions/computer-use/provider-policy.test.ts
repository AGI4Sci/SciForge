import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computerUseCaptureDiagnostics,
  computerUseCaptureProviderIds,
  computerUseCaptureProviderName,
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
