import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ComputerUseConfig, ScreenshotRef } from '../computer-use/types.js';
import { screenshotToExecutorPoint } from './computer-use-grounding.js';

test('window screenshot coordinate mapping accounts for asymmetric macOS window shadow', () => {
  const config = {
    desktopPlatform: 'darwin',
    executorCoordinateScale: 2,
    windowTarget: { coordinateSpace: 'window-local' },
  } as ComputerUseConfig;
  const screenshot = {
    width: 3248,
    height: 1968,
    windowTarget: {
      coordinateSpace: 'window-local',
      bounds: { x: 0, y: 42, width: 1512, height: 872 },
    },
  } as ScreenshotRef;

  const mapped = screenshotToExecutorPoint(1717.16, 130.2, screenshot, config);

  assert.equal(mapped.mapping, 'window-screenshot-content-bounds');
  assert.equal(mapped.shadowPaddingX, 112);
  assert.ok((mapped.topShadowPaddingY ?? 0) < (mapped.bottomShadowPaddingY ?? 0));
  assert.ok(mapped.x > 795 && mapped.x < 810);
  assert.ok(mapped.y > 80 && mapped.y < 86);
});
