import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureSelectedDesktopWindowTarget,
  createMacOSScreencaptureFallbackDesktopWindowCaptureProvider,
  MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID,
} from './window-capture.js';

test('desktop window capture records explicit region fallback reason and keeps screenshot refs bounded', async () => {
  const provider = createMacOSScreencaptureFallbackDesktopWindowCaptureProvider({
    commandExists: async () => true,
    createTempFile: async () => ({ path: '/tmp/sciforge-window-capture-test.png', cleanup: () => undefined }),
    readFile: async () => Buffer.from('png-bytes'),
    runner: {
      async execFile(command, args) {
        assert.equal(command, 'screencapture');
        assert.deepEqual(args, ['-x', '-R', '10,20,300,200', '/tmp/sciforge-window-capture-test.png']);
        return {};
      },
    },
  });

  const result = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    selection: {
      kind: 'region',
      selectionSource: 'user',
      regionRef: 'desktop-region:user-selected/save-button',
      screenId: 'screen:main',
      bounds: { x: 10, y: 20, width: 300, height: 200 },
      scale: 2,
    },
  }, {
    platform: 'darwin',
    providers: [provider],
    now: () => '2026-06-06T00:00:00.000Z',
  });

  assert.equal(result.status, 'captured');
  assert.equal(result.providerId, MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID);
  assert.equal(result.captureRef, 'capture:macos-screencapture:region');
  assert.equal(result.imageRef, 'image:macos-screencapture:region');
  assert.equal(result.regionRef, 'desktop-region:user-selected/save-button');
  assert.equal(result.windowRef, null);
  assert.equal(result.screenId, 'screen:main');
  assert.deepEqual(result.bounds, { x: 10, y: 20, width: 300, height: 200 });
  assert.equal(result.scale, 2);
  assert.equal(result.privacy.refsOnly, true);
  assert.equal(result.privacy.rawPayloadReturned, false);
  assert.equal(result.privacy.includedRefScope, 'selected-region-only');
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === 'desktop.window-capture.fallback.user-selected-screen-region'), true);
  assert.doesNotMatch(JSON.stringify(result), /data:image|base64|png-bytes|\/tmp\/sciforge-window-capture-test\.png/i);
});

test('desktop window capture blocks full-screen fallback unless a bounded reason is recorded', async () => {
  const selection = {
    kind: 'window' as const,
    selectionSource: 'user' as const,
    windowRef: 'window:editor:main',
    screenId: 'screen:main',
    bounds: { x: 100, y: 120, width: 800, height: 600 },
    scale: 2,
  };
  const missingReason = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    selection,
  }, {
    platform: 'darwin',
    providers: [{
      providerId: 'test-full-screen-provider',
      priority: 10,
      supportedPlatforms: ['darwin'],
      isAvailable: async () => true,
      captureSelectedTarget: async () => ({
        captureKind: 'full-screen',
        fullScreenFallback: true,
        bytes: Buffer.from('png-bytes'),
      }),
    }],
  });

  assert.equal(missingReason.status, 'blocked');
  assert.equal(missingReason.fallbackReason, null);
  assert.equal(missingReason.diagnostics[0]?.code, 'desktop.window-capture.full-screen-fallback-reason-required');

  const recordedReason = await captureSelectedDesktopWindowTarget({
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    selection,
  }, {
    platform: 'darwin',
    providers: [{
      providerId: 'test-full-screen-provider',
      priority: 10,
      supportedPlatforms: ['darwin'],
      isAvailable: async () => true,
      captureSelectedTarget: async () => ({
        captureKind: 'full-screen',
        fullScreenFallback: true,
        fullScreenFallbackReason: 'occlusion',
        screenshotRef: 'screenshot:test-full-screen-provider:window',
        cropRef: 'crop:test-full-screen-provider:window',
        bytes: Buffer.from('png-bytes'),
      }),
    }],
    now: () => '2026-06-06T00:00:00.000Z',
  });

  assert.equal(recordedReason.status, 'captured');
  assert.equal(recordedReason.fallbackReason, 'occlusion');
  assert.match(recordedReason.screenshotRef ?? '', /^desktop-window-capture:/);
  assert.match(recordedReason.cropRef ?? '', /^desktop-window-capture:/);
  assert.equal(recordedReason.diagnostics.some((diagnostic) => diagnostic.fallbackReason === 'occlusion'), true);
  assert.doesNotMatch(JSON.stringify(recordedReason), /data:image|base64|png-bytes/i);
});
