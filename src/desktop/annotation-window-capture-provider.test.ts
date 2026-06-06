import assert from 'node:assert/strict';
import test from 'node:test';

import { DESKTOP_ANNOTATION_OVERLAY_CAPTURE_SCHEMA } from './annotation-overlay.js';
import { createDesktopAnnotationWindowCaptureProvider } from './annotation-window-capture-provider.js';

test('desktop annotation window capture metadata keeps fresh screenshot and window-local crop refs distinct', async () => {
  const provider = createDesktopAnnotationWindowCaptureProvider({
    platform: 'darwin',
    providers: [{
      providerId: 'test-window-capture-provider',
      priority: 100,
      supportedPlatforms: ['darwin'],
      isAvailable: () => true,
      captureSelectedTarget: async () => ({
        captureRef: 'capture:test-window-capture-provider:window',
        imageRef: 'image:test-window-capture-provider:window',
        screenshotRef: 'desktop-window-capture:workspace-a/session-a/screenshot/fresh-window-frame',
        cropRef: 'desktop-window-capture:workspace-a/session-a/crop/window-local-selection',
        hash: 'sha256:' + '1'.repeat(64),
        capturedAt: '2026-06-06T00:00:00.000Z',
      }),
    }],
  });

  const output = await provider.captureSelection({
    schemaVersion: DESKTOP_ANNOTATION_OVERLAY_CAPTURE_SCHEMA,
    captureId: 'capture-1',
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    windowRef: 'desktop-window:plotter:window-1',
    targetRef: 'desktop-window:plotter:window-1',
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    screenId: 'display-1',
    scale: 2,
    windowBounds: { x: 10, y: 20, width: 800, height: 600 },
    screenBounds: { x: 110, y: 80, width: 200, height: 120 },
    bounds: { x: 100, y: 60, width: 200, height: 120 },
    windowLocalBounds: { x: 100, y: 60, width: 200, height: 120 },
    normalizedBounds: { x: 0.125, y: 0.1, width: 0.25, height: 0.2 },
    overlayExclusion: { hidden: true, clickThrough: true },
  });

  assert.equal(output.status, 'captured');
  assert.equal(output.metadata?.windowCaptureRef, 'capture:test-window-capture-provider:window');
  assert.equal(output.metadata?.windowCaptureImageRef, 'image:test-window-capture-provider:window');
  assert.equal(output.metadata?.windowCaptureScreenshotRef, 'desktop-window-capture:workspace-a/session-a/screenshot/fresh-window-frame');
  assert.equal(output.metadata?.windowCaptureCropRef, 'desktop-window-capture:workspace-a/session-a/crop/window-local-selection');
  assert.deepEqual(output.metadata?.windowLocalBounds, { x: 100, y: 60, width: 200, height: 120 });
  assert.deepEqual(output.metadata?.provenanceRefs, [
    'capture:desktop-window-capture:test-window-capture-provider:window',
    'image:desktop-window-capture:test-window-capture-provider:window',
    'desktop-window-capture:workspace-a/session-a/screenshot/fresh-window-frame',
    'desktop-window-capture:workspace-a/session-a/crop/window-local-selection',
  ]);
  assert.doesNotMatch(JSON.stringify(output), /data:image|base64/i);
});
