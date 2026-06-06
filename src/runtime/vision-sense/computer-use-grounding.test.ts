import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ComputerUseConfig, ScreenshotRef } from '../computer-use/types.js';
import {
  buildFocusRegionFromVisionSense,
  buildRegionSemanticVerifierFromVisionSense,
  buildVerifierPlanningFeedbackFromVisionSense,
  resolveActionGrounding,
  screenshotToExecutorPoint,
} from './computer-use-grounding.js';

function baseConfig(): ComputerUseConfig {
  return {
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
    runId: 'grounding-diagnostics-test',
    maxSteps: 4,
    allowHighRiskActions: false,
    planner: { allowOpenAiRuntime: false, timeoutMs: 1000, maxTokens: 512 },
    grounder: {
      timeoutMs: 1000,
      allowServiceLocalPaths: false,
      upload: { strategy: 'inline' },
    },
    testActionFixtureMode: false,
    testOnlyPlannedActions: [],
  };
}

function screenshotRef(absPath = '/tmp/sciforge-grounding-diagnostics-before.png'): ScreenshotRef {
  return {
    id: 'screen-1',
    path: '.sciforge/vision-runs/grounding-diagnostics-test/step-000-before.png',
    absPath,
    displayId: 1,
    captureScope: 'display',
    captureProvider: 'test-capture',
    width: 1476,
    height: 1125,
    sha256: 'abc123',
    bytes: 1234,
  };
}

function fetchStub(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    return handler(url, init);
  }) as typeof fetch;
}

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

test('remote-desktop independent adapter grounds target descriptions without legacy service', async () => {
  const config = {
    ...baseConfig(),
    inputAdapter: 'remote-desktop',
    independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
    grounder: {
      timeoutMs: 1000,
      allowServiceLocalPaths: false,
      upload: { strategy: 'inline' as const },
    },
  };

  const result = await resolveActionGrounding(
    { type: 'click', targetDescription: 'blank editor body' },
    [screenshotRef()],
    config,
  );

  assert.equal(result.ok, true);
  assert.equal(result.action.type, 'click');
  assert.equal(result.grounding?.provider, 'ts-target-bound-independent-input-grounder');
  assert.equal(Object.hasOwn(result.grounding ?? {}, 'legacyAdapterUsed'), false);
  assert.equal(result.grounding?.sharedSystemInputUsed, false);
});

test('coarse-to-fine helpers run in TypeScript without Python bridge', async () => {
  const previous = process.env.SCIFORGE_VISION_SENSE_PYTHON;
  process.env.SCIFORGE_VISION_SENSE_PYTHON = '/definitely/missing/python';
  try {
    const focusRegion = await buildFocusRegionFromVisionSense(screenshotRef(), {
      localX: 481.18,
      localY: 1060.88,
      targetDescription: 'Submit button',
    });

    assert.deepEqual(focusRegion, {
      sourceScreenshotRef: '.sciforge/vision-runs/grounding-diagnostics-test/step-000-before.png',
      coordinateFrame: 'source-screenshot-pixels',
      x: 301,
      y: 825,
      width: 360,
      height: 300,
      centerX: 481.18,
      centerY: 1060.88,
      sourceWidth: 1476,
      sourceHeight: 1125,
      reason: 'Submit button',
    });

    const feedback = await buildVerifierPlanningFeedbackFromVisionSense({
      action: { type: 'click', targetDescription: 'Submit button' },
      status: 'failed',
      grounding: { status: 'ok', localX: 481.18, localY: 1060.88, targetDescription: 'Submit button' },
      pixelDiff: { possiblyNoEffect: true, pairs: [{ changedByteRatio: 0.0001, possiblyNoEffect: true }] },
      visualFocus: { region: focusRegion },
      failureReason: 'button did not react',
    });

    assert.match(feedback, /pixel=no-visible-effect/);
    assert.match(feedback, /target="Submit button"/);
    assert.match(feedback, /focus=bbox\(301,825,360,300\)/);
    assert.match(feedback, /next=replan/);
    assert.match(feedback, /produced no visible window effect/);

    const semantic = await buildRegionSemanticVerifierFromVisionSense({
      action: { type: 'click', targetDescription: 'Submit button' },
      status: 'done',
      grounding: { targetDescription: 'Submit button' },
      pixelDiff: { possiblyNoEffect: false, pairs: [{ changedByteRatio: 0.01 }] },
      focusPixelDiff: { possiblyNoEffect: true, pairs: [{ possiblyNoEffect: true }] },
      visualFocus: { region: focusRegion },
    });

    assert.equal(semantic?.schemaVersion, 'sciforge.vision-sense.region-semantic-verifier.v1');
    assert.equal(semantic?.verdict, 'off-target-or-unrelated-window-change');
    assert.equal(semantic?.targetDescription, 'Submit button');
    assert.equal((semantic?.focusRegion as Record<string, unknown>)?.x, 301);
    assert.equal(semantic?.focusChanged, false);
    assert.equal(semantic?.windowChanged, true);
    assert.equal(semantic?.possiblyNoEffect, true);
    assert.match(String(semantic?.summary), /regionSemantic=off-target-or-unrelated-window-change/);
  } finally {
    if (previous === undefined) delete process.env.SCIFORGE_VISION_SENSE_PYTHON;
    else process.env.SCIFORGE_VISION_SENSE_PYTHON = previous;
  }
});

test('Model Router grounding translator failure does not call direct grounding services', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', fetchStub(async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));

  const result = await resolveActionGrounding(
    { type: 'click', targetDescription: 'Submit button' },
    [screenshotRef()],
    baseConfig(),
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail('missing Model Router grounding coordinates should fail closed');
  assert.deepEqual(calls, []);
  assert.match(result.reason, /Model Router grounding translator/);
  assert.equal(result.grounding?.provider, 'model-router.capability.computer-use.grounding-translator');
  assert.equal(result.grounding?.reason, 'missing model-router grounding translator result');
  assert.doesNotMatch(JSON.stringify(result.grounding), /health|predict|legacy|127\.0\.0\.1|18081/i);
});
