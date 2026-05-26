import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { ComputerUseConfig, ScreenshotRef } from '../computer-use/types.js';
import { resolveActionGrounding, screenshotToExecutorPoint } from './computer-use-grounding.js';

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
      baseUrl: 'http://127.0.0.1:18081/',
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

function diagnosticsFrom(grounding: Record<string, unknown> | undefined) {
  assert.ok(grounding);
  assert.ok(Array.isArray(grounding.diagnostics));
  return grounding.diagnostics as Array<Record<string, unknown>>;
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

test('KV-Ground grounding records /health preflight diagnostics alongside /predict/ attempts', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-grounding-diagnostics-'));
  const screenshotPath = join(tempDir, 'before.png');
  await writeFile(
    screenshotPath,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwNfWQAAAABJRU5ErkJggg==', 'base64'),
  );
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const calls: Array<{ url: string; method: string | undefined }> = [];
  t.mock.method(globalThis, 'fetch', fetchStub(async (url, init) => {
    calls.push({ url, method: init?.method });
    if (url.endsWith('/health')) {
      return new Response(JSON.stringify({
        ok: true,
        model_dir: '/models/kv-ground',
        cuda_available: true,
        gpu_count: 1,
        inline_image_supported: true,
        max_inline_image_bytes: 20971520,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/predict/')) {
      return new Response(JSON.stringify({
        coordinates: [481.18, 1060.88],
        text: "click(start_box='[326, 943]')",
        raw_text: "click(start_box='[326, 943]')",
        image_size: { width: 1476, height: 1125 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    assert.fail(`unexpected URL ${url}`);
  }));

  const result = await resolveActionGrounding(
    { type: 'click', targetDescription: 'Submit button' },
    [screenshotRef(screenshotPath)],
    baseConfig(),
  );

  if (result.ok !== true) assert.fail(result.reason);
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [
    ['GET', 'http://127.0.0.1:18081/health'],
    ['POST', 'http://127.0.0.1:18081/predict/'],
  ]);
  const diagnostics = diagnosticsFrom(result.grounding);
  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0]?.stage, 'health');
  assert.equal(diagnostics[0]?.method, 'GET');
  assert.equal(diagnostics[0]?.status, 'ok');
  assert.equal((diagnostics[0]?.responseBody as Record<string, unknown>).ok, true);
  assert.equal((diagnostics[0]?.responseBody as Record<string, unknown>).inline_image_supported, true);
  assert.equal(diagnostics[1]?.stage, 'predict');
  assert.equal(diagnostics[1]?.method, 'POST');
  assert.equal(diagnostics[1]?.status, 'ok');
  assert.equal(result.grounding?.healthUrl, 'http://127.0.0.1:18081/health');
  assert.equal(result.grounding?.grounderUrl, 'http://127.0.0.1:18081/predict/');
  assert.deepEqual([result.grounding?.x, result.grounding?.y], [481.18, 1060.88]);
  assert.equal(result.grounding?.rawText, "click(start_box='[326, 943]')");
  assert.deepEqual(result.grounding?.imageSize, { width: 1476, height: 1125 });
});

test('KV-Ground health connection refused is recorded as blocked diagnostic evidence without live service', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', fetchStub(async (url) => {
    calls.push(url);
    if (url.endsWith('/health')) {
      const error = new TypeError('fetch failed') as Error & { cause?: unknown };
      error.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:18081'), {
        code: 'ECONNREFUSED',
        errno: -61,
        address: '127.0.0.1',
        port: 18081,
      });
      throw error;
    }
    assert.fail('predict should not run after failed health preflight');
  }));

  const result = await resolveActionGrounding(
    { type: 'click', targetDescription: 'Submit button' },
    [screenshotRef()],
    baseConfig(),
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail('connection refused health preflight should fail closed');
  assert.deepEqual(calls, ['http://127.0.0.1:18081/health']);
  assert.match(result.reason, /\/health/);
  assert.match(result.reason, /ECONNREFUSED/);
  const diagnostics = diagnosticsFrom(result.grounding);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.stage, 'health');
  assert.equal(diagnostics[0]?.status, 'failed');
  assert.equal(diagnostics[0]?.blocked, true);
  assert.match(JSON.stringify(diagnostics[0]), /ECONNREFUSED/);
  assert.match(JSON.stringify(diagnostics[0]), /127\.0\.0\.1/);
  assert.match(JSON.stringify(diagnostics[0]), /18081/);
});
