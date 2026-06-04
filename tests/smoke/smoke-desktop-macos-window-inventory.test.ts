import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDesktopAnnotationMacosWindowInventoryProvider,
  createDesktopAnnotationWindowCaptureProvider,
} from '../../src/desktop/index.js';

test('desktop macOS window inventory maps CG windows to bounded auto-binding candidates', () => {
  const inventory = createDesktopAnnotationMacosWindowInventoryProvider({
    platform: 'darwin',
    probeScreenRecording: () => ({ ok: true }),
    inventoryMacosCgWindows: () => [
      {
        pid: 4242,
        windowNumber: 92817,
        ownerName: 'Paper Reader',
        title: 'Paper Reader - Figure 1',
        layer: 0,
        x: -120,
        y: 40,
        width: 900,
        height: 640,
        rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
      },
      {
        pid: 111,
        windowNumber: 111,
        ownerName: 'SciForge',
        title: 'SciForge',
        layer: 0,
        x: 0,
        y: 0,
        width: 1200,
        height: 900,
      },
      {
        pid: 222,
        windowNumber: 222,
        ownerName: 'Dock',
        title: 'Dock',
        layer: 0,
        x: 0,
        y: 860,
        width: 1440,
        height: 40,
      },
      {
        pid: 333,
        windowNumber: 333,
        ownerName: 'Tiny App',
        title: 'Tiny',
        layer: 0,
        x: 10,
        y: 10,
        width: 20,
        height: 20,
      },
      {
        pid: 444,
        windowNumber: 444,
        ownerName: 'Menu',
        title: 'Menu bar',
        layer: 24,
        x: 0,
        y: 0,
        width: 1440,
        height: 24,
      },
      {
        pid: 555,
        windowNumber: 555,
        ownerName: 'Secrets',
        title: 'token=SECRET_TOKEN_SHOULD_NOT_LEAK',
        layer: 0,
        x: 20,
        y: 20,
        width: 640,
        height: 480,
      },
    ],
  });

  assert.equal(inventory.screenRegionBindingPermissionStatus(), 'granted');
  const candidates = inventory.screenRegionBindingWindows();
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.windowRef), [
    'desktop-window:macos-cg-window-id:92817:pid:4242',
    'desktop-window:macos-cg-window-id:555:pid:555',
  ]);
  assert.deepEqual(candidates[0]?.bounds, { x: -120, y: 40, width: 900, height: 640 });
  assert.equal(candidates[0]?.appName, 'Paper Reader');
  assert.equal(candidates[0]?.title, 'Paper Reader - Figure 1');
  assert.equal(candidates[0]?.pid, 4242);
  assert.equal(candidates[0]?.cgWindowId, 92817);
  assert.equal(candidates[1]?.title, undefined);
  assertNoRawWindowPayload(candidates);
});

test('desktop macOS window inventory drives screen-region auto-binding without leaking raw windows', async () => {
  const inventory = createDesktopAnnotationMacosWindowInventoryProvider({
    platform: 'darwin',
    probeScreenRecording: () => ({ ok: true }),
    inventoryMacosCgWindows: () => [{
      pid: 777,
      windowNumber: 78123,
      ownerName: 'Plotter',
      title: 'Plotter - Figure 2',
      layer: 0,
      x: 300,
      y: 100,
      width: 700,
      height: 500,
      rawWindowList: [{ title: 'SECRET_WINDOW_LIST_SHOULD_NOT_LEAK' }],
    }],
  });
  const provider = createDesktopAnnotationWindowCaptureProvider({
    platform: 'darwin',
    screenId: 'display-1',
    scale: 2,
    screenRegionBindingWindows: inventory.screenRegionBindingWindows,
    screenRegionBindingPermissionStatus: inventory.screenRegionBindingPermissionStatus,
    providers: [{
      providerId: 'test-window-capture-provider',
      priority: 100,
      supportedPlatforms: ['darwin'],
      isAvailable: () => true,
      captureSelectedTarget: async () => ({
        captureRef: 'capture:test-window-capture-provider:region',
        imageRef: 'image:test-window-capture-provider:region',
        hash: 'sha256:' + 'f'.repeat(64),
        capturedAt: '2026-06-04T00:00:00.000Z',
      }),
    }],
  });

  const output = await provider.captureSelection({
    schemaVersion: 'sciforge.desktop.annotation-overlay.capture.v1',
    captureId: 'capture-fixed',
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    targetRef: 'screen-region:selection-auto-bound',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    screenBounds: { x: 320, y: 180, width: 360, height: 240 },
    bounds: { x: 320, y: 180, width: 360, height: 240 },
    normalizedBounds: { x: 0.222222, y: 0.2, width: 0.25, height: 0.266667 },
    overlayExclusion: { hidden: true, clickThrough: true },
  });

  const outputMetadata = asRecord(output.metadata);
  const windowBinding = asRecord(outputMetadata.windowBinding);
  assert.equal(windowBinding.status, 'auto-bound');
  assert.equal(windowBinding.windowRef, 'desktop-window:macos-cg-window-id:78123:pid:777');
  assert.equal(windowBinding.cgWindowId, undefined);
  assertNoRawWindowPayload(output);
});

test('desktop macOS window inventory reports permission failure without candidates', () => {
  const inventory = createDesktopAnnotationMacosWindowInventoryProvider({
    platform: 'darwin',
    probeScreenRecording: () => ({ ok: false, detail: 'not authorized' }),
    inventoryMacosCgWindows: () => {
      throw new Error('should not enumerate when screen recording is denied');
    },
  });

  assert.equal(inventory.screenRegionBindingPermissionStatus(), 'denied');
  assert.deepEqual(inventory.screenRegionBindingWindows(), []);
});

function assertNoRawWindowPayload(value: unknown): void {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /rawWindowList/i);
  assert.doesNotMatch(text, /SECRET_WINDOW/i);
  assert.doesNotMatch(text, /SECRET_TOKEN/i);
  assert.doesNotMatch(text, /data:image\//i);
  assert.doesNotMatch(text, /base64/i);
}

function asRecord(value: unknown): Record<string, any> {
  assert.ok(value && typeof value === 'object');
  return value as Record<string, any>;
}
