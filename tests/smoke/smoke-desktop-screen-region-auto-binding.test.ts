import assert from 'node:assert/strict';
import test from 'node:test';

import { bindScreenRegionToWindow } from '../../src/desktop/screen-region-auto-binding.js';

test('screen region auto binding binds a high-confidence selected region to one window ref', () => {
  const screenBounds = { x: 120, y: 140, width: 240, height: 160 };
  const result = bindScreenRegionToWindow({
    screenBounds,
    screenId: 'display:built-in',
    scale: 2,
    windows: [
      windowCandidate({
        windowRef: 'desktop-window:paper-reader:window-1',
        ownerId: 'owner:paper-reader',
        bounds: { x: 80, y: 100, width: 520, height: 380 },
        screenId: 'display:built-in',
        scale: 2,
      }),
      windowCandidate({
        windowRef: 'desktop-window:spreadsheet:window-2',
        ownerId: 'owner:spreadsheet',
        bounds: { x: 620, y: 100, width: 500, height: 360 },
        screenId: 'display:built-in',
        scale: 2,
      }),
    ],
  });

  assert.equal(result.status, 'bound');
  assert.equal(result.bindingStatus, 'high-confidence');
  assert.equal(result.windowRef, 'desktop-window:paper-reader:window-1');
  assert.deepEqual(result.bounds, screenBounds);
  assert.equal(result.screenId, 'display:built-in');
  assert.equal(result.scale, 2);
  assert.equal(result.candidates?.[0]?.windowRef, 'desktop-window:paper-reader:window-1');
  assert.equal(result.candidates?.[0]?.overlapRatio, 1);
  assertNoRawPayload(result);
});

test('screen region auto binding leaves a region unbound when overlap is below threshold', () => {
  const result = bindScreenRegionToWindow({
    screenBounds: { x: 100, y: 100, width: 200, height: 120 },
    windows: [
      windowCandidate({
        windowRef: 'desktop-window:small-overlap:window-1',
        ownerId: 'owner:small-overlap',
        bounds: { x: 190, y: 140, width: 60, height: 50 },
      }),
    ],
  });

  assert.equal(result.status, 'unbound');
  assert.equal(result.bindingStatus, 'low-confidence');
  assert.equal(result.windowRef, undefined);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'desktop.screen-region-binding.low-confidence'));
  assert.equal(result.candidates?.[0]?.centerInside, true);
  assert.ok((result.candidates?.[0]?.overlapRatio ?? 1) < 0.7);
});

test('screen region auto binding leaves a region unbound when two windows are close contenders', () => {
  const result = bindScreenRegionToWindow({
    screenBounds: { x: 100, y: 100, width: 100, height: 100 },
    windows: [
      windowCandidate({
        windowRef: 'desktop-window:top:window-1',
        ownerId: 'owner:top',
        bounds: { x: 100, y: 100, width: 100, height: 100 },
      }),
      windowCandidate({
        windowRef: 'desktop-window:second:window-2',
        ownerId: 'owner:second',
        bounds: { x: 90, y: 90, width: 100, height: 110 },
      }),
    ],
  });

  assert.equal(result.status, 'unbound');
  assert.equal(result.bindingStatus, 'multi-window-conflict');
  assert.equal(result.windowRef, undefined);
  assert.deepEqual(result.candidates?.map((candidate) => candidate.windowRef), [
    'desktop-window:top:window-1',
    'desktop-window:second:window-2',
  ]);
});

test('screen region auto binding filters SciForge, overlay, system, invisible, minimized, and tiny windows', () => {
  const result = bindScreenRegionToWindow({
    screenBounds: { x: 500, y: 300, width: 100, height: 80 },
    excludedOwnerIds: ['owner:sciforge-main'],
    windows: [
      windowCandidate({
        windowRef: 'desktop-window:sciforge:main',
        ownerId: 'owner:sciforge-main',
        bounds: { x: 0, y: 0, width: 1400, height: 900 },
        title: 'data:image/png;base64,SECRET_MAIN_WINDOW',
      }),
      windowCandidate({
        windowRef: 'desktop-window:sciforge:overlay',
        ownerId: 'owner:sciforge-overlay',
        role: 'overlay',
        bounds: { x: 0, y: 0, width: 1400, height: 900 },
        rawDom: '<input value="SECRET_DOM">',
      }),
      windowCandidate({
        windowRef: 'desktop-window:system:menu-bar',
        ownerId: 'owner:system-menu',
        role: 'menu-bar',
        bounds: { x: 0, y: 0, width: 1400, height: 24 },
      }),
      windowCandidate({
        windowRef: 'desktop-window:system:dock',
        ownerId: 'owner:system-dock',
        role: 'dock',
        bounds: { x: 0, y: 850, width: 1400, height: 50 },
      }),
      windowCandidate({
        windowRef: 'desktop-window:hidden:window',
        ownerId: 'owner:hidden',
        visible: false,
        bounds: { x: 400, y: 260, width: 300, height: 220 },
      }),
      windowCandidate({
        windowRef: 'desktop-window:minimized:window',
        ownerId: 'owner:minimized',
        minimized: true,
        bounds: { x: 400, y: 260, width: 300, height: 220 },
      }),
      windowCandidate({
        windowRef: 'desktop-window:tiny:window',
        ownerId: 'owner:tiny',
        bounds: { x: 540, y: 330, width: 12, height: 12 },
      }),
      windowCandidate({
        windowRef: 'desktop-window:target:window',
        ownerId: 'owner:target',
        bounds: { x: 460, y: 260, width: 340, height: 260 },
      }),
    ],
  });

  assert.equal(result.status, 'bound');
  assert.equal(result.windowRef, 'desktop-window:target:window');
  assert.deepEqual(result.candidates?.map((candidate) => candidate.windowRef), [
    'desktop-window:target:window',
  ]);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'desktop.screen-region-binding.filtered-candidates'));
  assertNoRawPayload(result);
});

test('screen region auto binding preserves negative-coordinate and Retina selection metadata', () => {
  const screenBounds = { x: -1180, y: 120, width: 320, height: 180 };
  const result = bindScreenRegionToWindow({
    screenBounds,
    screenId: 'display:left-retina',
    scale: 2,
    windows: [
      windowCandidate({
        windowRef: 'desktop-window:left-display:window-1',
        ownerId: 'owner:left-display',
        bounds: { x: -1280, y: 0, width: 640, height: 480 },
        screenId: 'display:left-retina',
        scale: 2,
      }),
      windowCandidate({
        windowRef: 'desktop-window:main-display:window-2',
        ownerId: 'owner:main-display',
        bounds: { x: -1280, y: 0, width: 640, height: 480 },
        screenId: 'display:main',
        scale: 1,
      }),
    ],
  });

  assert.equal(result.status, 'bound');
  assert.equal(result.windowRef, 'desktop-window:left-display:window-1');
  assert.deepEqual(result.bounds, screenBounds);
  assert.equal(result.screenId, 'display:left-retina');
  assert.equal(result.scale, 2);
  assert.equal(result.candidates?.[0]?.screenId, 'display:left-retina');
  assert.equal(result.candidates?.[0]?.scale, 2);
});

test('screen region auto binding fails closed on permission failure with bounded diagnostics only', () => {
  const result = bindScreenRegionToWindow({
    screenBounds: { x: 20, y: 30, width: 200, height: 120 },
    permissionStatus: 'denied',
    windows: [
      windowCandidate({
        windowRef: 'desktop-window:secret:window',
        ownerId: 'owner:secret',
        bounds: { x: 0, y: 0, width: 500, height: 400 },
        title: 'SECRET_TOKEN_SHOULD_NOT_LEAK',
      }),
    ],
  });

  assert.equal(result.status, 'unbound');
  assert.equal(result.bindingStatus, 'permission-failure');
  assert.deepEqual(result.candidates, []);
  assert.ok(result.diagnostics.length <= 6);
  assert.ok(result.diagnostics.every((diagnostic) => diagnostic.message.length <= 240));
  assertNoRawPayload(result);
});

function windowCandidate(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    role: 'window',
    visible: true,
    minimized: false,
    ...overrides,
  };
}

function assertNoRawPayload(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /data:image/i);
  assert.doesNotMatch(serialized, /base64/i);
  assert.doesNotMatch(serialized, /SECRET/i);
  assert.doesNotMatch(serialized, /rawDom/i);
  assert.doesNotMatch(serialized, /<input/i);
}
