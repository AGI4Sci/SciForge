import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ComputerUseConfig } from './types.js';
import { resolveMacOpenAppTarget } from './executor.js';
import { defaultMacBundleIdForAppName, parseWindowTarget } from './window-target.js';
import { bindWindowTargetFromOpenAppAction } from '../vision-sense/computer-use-window-session.js';
import { rebindWindowTargetForPromptAppAlias } from '../vision-sense/sense-provider.js';

test('window target parsing binds localized Finder by stable bundle id', () => {
  assert.equal(defaultMacBundleIdForAppName('Finder'), 'com.apple.finder');
  assert.equal(defaultMacBundleIdForAppName('\u8bbf\u8fbe'), 'com.apple.finder');
  assert.equal(defaultMacBundleIdForAppName('Browser'), 'com.apple.Safari');
  assert.equal(defaultMacBundleIdForAppName('browser'), 'com.apple.Safari');
  assert.equal(defaultMacBundleIdForAppName('\u6d4f\u89c8\u5668'), 'com.apple.Safari');

  const finderTarget = parseWindowTarget({ windowTarget: { appName: 'Finder' } }, {});
  assert.equal(finderTarget.mode, 'app-window');
  assert.equal(finderTarget.appName, 'Finder');
  assert.equal(finderTarget.bundleId, 'com.apple.finder');

  const browserTarget = parseWindowTarget({ windowTarget: { mode: 'app-window', appName: 'Browser' } }, {});
  assert.equal(browserTarget.mode, 'app-window');
  assert.equal(browserTarget.appName, 'Browser');
  assert.equal(browserTarget.bundleId, 'com.apple.Safari');

  const explicitTarget = parseWindowTarget(
    { windowTarget: { appName: 'Finder', bundleId: 'example.override' } },
    {},
  );
  assert.equal(explicitTarget.bundleId, 'example.override');
});

test('open_app session binding preserves stable Finder target identity', () => {
  const config: ComputerUseConfig = {
    desktopBridgeEnabled: true,
    dryRun: true,
    captureDisplays: [1],
    desktopPlatform: 'darwin',
    windowTarget: {
      enabled: false,
      required: false,
      mode: 'display',
      coordinateSpace: 'screen',
      inputIsolation: 'best-effort',
    },
    maxSteps: 3,
    allowHighRiskActions: false,
    planner: { allowOpenAiRuntime: false, timeoutMs: 1000, maxTokens: 256 },
    grounder: { timeoutMs: 1000, allowServiceLocalPaths: false },
    testActionFixtureMode: false,
    testOnlyPlannedActions: [],
  };

  bindWindowTargetFromOpenAppAction(config, { type: 'open_app', appName: 'Finder' });

  assert.equal(config.windowTarget.mode, 'app-window');
  assert.equal(config.windowTarget.appName, 'Finder');
  assert.equal(config.windowTarget.bundleId, 'com.apple.finder');
  assert.equal(config.windowTarget.coordinateSpace, 'window-local');
});

test('open_app alias resolution prefers the resolved app bundle over the generic label', () => {
  const previousAliases = process.env.SCIFORGE_VISION_APP_ALIASES_JSON;
  process.env.SCIFORGE_VISION_APP_ALIASES_JSON = JSON.stringify({ Browser: 'Google Chrome' });

  try {
    assert.deepEqual(resolveMacOpenAppTarget('Browser'), {
      appName: 'Google Chrome',
      bundleId: 'com.google.Chrome',
    });
  } finally {
    if (previousAliases === undefined) {
      delete process.env.SCIFORGE_VISION_APP_ALIASES_JSON;
    } else {
      process.env.SCIFORGE_VISION_APP_ALIASES_JSON = previousAliases;
    }
  }
});

test('prompt app rebind preserves stable Finder target identity', () => {
  const previousAliases = process.env.SCIFORGE_VISION_APP_ALIASES_JSON;
  process.env.SCIFORGE_VISION_APP_ALIASES_JSON = JSON.stringify({ Finder: 'Finder' });
  const config: ComputerUseConfig = {
    desktopBridgeEnabled: true,
    dryRun: true,
    captureDisplays: [1],
    desktopPlatform: 'darwin',
    windowTarget: {
      enabled: false,
      required: false,
      mode: 'display',
      coordinateSpace: 'screen',
      inputIsolation: 'best-effort',
    },
    maxSteps: 3,
    allowHighRiskActions: false,
    planner: { allowOpenAiRuntime: false, timeoutMs: 1000, maxTokens: 256 },
    grounder: { timeoutMs: 1000, allowServiceLocalPaths: false },
    testActionFixtureMode: false,
    testOnlyPlannedActions: [],
  };

  try {
    rebindWindowTargetForPromptAppAlias(config, 'Open Finder and show the saved file');

    assert.equal(config.windowTarget.mode, 'app-window');
    assert.equal(config.windowTarget.appName, 'Finder');
    assert.equal(config.windowTarget.bundleId, 'com.apple.finder');
    assert.equal(config.windowTarget.coordinateSpace, 'window-local');
  } finally {
    if (previousAliases === undefined) {
      delete process.env.SCIFORGE_VISION_APP_ALIASES_JSON;
    } else {
      process.env.SCIFORGE_VISION_APP_ALIASES_JSON = previousAliases;
    }
  }
});
