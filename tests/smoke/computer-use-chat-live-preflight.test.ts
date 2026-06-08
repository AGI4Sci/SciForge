import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildComputerUseChatLivePreflightManifest,
} from '../../tools/computer-use-chat-live-preflight.js';

test('Computer Use chat live preflight reports ready without printing secret env values', async () => {
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: readyEnv(),
    localConfigs: [],
    now: () => new Date('2026-05-29T00:00:00.000Z'),
    fetchImpl: readyFetch,
  });

  assert.equal(manifest.schemaVersion, 'sciforge.computer-use.chat-live-preflight.v1');
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.releaseAcceptance, 'not-evaluated');
  assert.deepEqual(manifest.missingEnv, []);
  assert.deepEqual(manifest.policyViolations, []);
  assert.equal(manifest.serviceChecks.every((check) => check.status === 'pass'), true);
  assert.match(manifest.suggestedSmokePrompt, /local visible report artifact/);
  assert.match(manifest.suggestedSmokePrompt, /local text editor/);
  assert.match(manifest.suggestedSmokePrompt, /Do not type the report into search, filter, chat, address/i);
  assert.doesNotMatch(manifest.suggestedSmokePrompt, /Do not click, type, scroll/i);
  const text = JSON.stringify(manifest);
  assert.equal(text.includes('sk-live-secret'), false);
  assert.equal(text.includes('https://provider.example/v1'), false);
  assert.ok(manifest.requiredEnv.some((entry) => entry.name === 'SCIFORGE_RUNTIME_API_KEY' && entry.present && entry.valuePrinted === false));
  assert.ok(manifest.requiredEnv.some((entry) => entry.name === 'SCIFORGE_MODEL_ROUTER_BASE_URL' && entry.present && entry.valuePrinted === false));
  assert.equal(manifest.requiredEnv.some((entry) => entry.name === 'SCIFORGE_PROXY_UPSTREAM_BASE_URL'), false);
  assert.equal(manifest.serviceChecks.some((check) => check.id === 'model-router' && check.label === 'Model Router'), true);
  assert.equal(manifest.serviceChecks.some((check) => check.id === 'provider-proxy'), false);
  assert.equal(manifest.requiredEnv.some((entry) => entry.name === 'SCIFORGE_VISION_KV_GROUND_URL'), false);
  assert.deepEqual(manifest.runtimeProviderPreflight?.checkedInference, {
    category: 'ready',
    ok: true,
    httpStatus: 200,
    retryable: false,
  });
});

test('Computer Use chat live preflight writes blocked diagnostics for missing env and unhealthy services', async () => {
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT: '1',
      SCIFORGE_VISION_TEST_ACTION_FIXTURES: '1',
      SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN: '1',
    },
    localConfigs: [],
    now: () => new Date('2026-05-29T00:00:00.000Z'),
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes('/api/sciforge/runtime-provider-preflight/manifest')) {
        return jsonResponse({
          ok: true,
          manifest: runtimeProviderPreflightBlocked(),
        });
      }
      if (url.includes('6173/health')) return jsonResponse({ ok: true });
      throw new Error(`Authorization: Bearer sk-health-secret failed for ${url}?token=raw-secret`);
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.deepEqual(manifest.missingEnv, [
    'SCIFORGE_RUNTIME_API_KEY',
    'SCIFORGE_MODEL_ROUTER_BASE_URL or SCIFORGE_MODEL_ROUTER_URL or SCIFORGE_MODEL_ROUTER_PORT',
    'SCIFORGE_VISION_INPUT_ADAPTER',
    'SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER',
  ]);
  assert.ok(manifest.requiredEnv.some((entry) => (
    entry.name === 'SCIFORGE_VISION_DESKTOP_BRIDGE'
    && entry.present
    && entry.source === 'runtime-default'
  )));
  assert.deepEqual(manifest.policyViolations, [
    'shared-system-input-cannot-satisfy-chat-e2e-preflight',
    'test-action-fixtures-cannot-satisfy-real-chat-e2e',
    'desktop-bridge-dry-run-cannot-satisfy-real-chat-e2e',
  ]);
  assert.equal(manifest.serviceChecks.find((check) => check.id === 'workspace-writer')?.status, 'pass');
  assert.ok(manifest.serviceChecks.some((check) => check.status === 'fail'));
  const text = JSON.stringify(manifest);
  assert.equal(text.includes('sk-health-secret'), false);
  assert.equal(text.includes('raw-secret'), false);
  assert.ok(manifest.nextActions.some((action) => action.label.includes('Set required service environment variables')));
  assert.ok(manifest.nextActions.some((action) => action.label.includes('Clear real-run policy blockers')));
});

test('Computer Use chat live preflight accepts ignored local config presence without printing values', async () => {
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'sk-runtime-env-secret',
      SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:3892/v1',
      SCIFORGE_UI_URL: 'http://127.0.0.1:5173/',
      SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:6173/health',
      SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:18080/health',
    },
    localConfigs: [{
      path: 'config.local.json',
      config: {
        textLLM: {
          env: {
            SCIFORGE_TEXT_API_KEY: 'sk-local-text-secret',
            SCIFORGE_TEXT_BASE_URL: 'https://user:pass@text-provider.example/v1?token=raw-token',
          },
        },
        visionLLM: {
          env: {
            SCIFORGE_VISION_API_KEY: 'sk-local-vision-secret',
            SCIFORGE_VISION_BASE_URL: 'https://vision-provider.example/v1',
          },
        },
        visionSense: {
          desktopBridgeEnabled: true,
          inputAdapter: 'remote-desktop',
          independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
        },
      },
    }],
    fetchImpl: readyFetch,
  });

  assert.equal(manifest.status, 'ready');
  assert.deepEqual(manifest.missingEnv, []);
  assert.ok(manifest.requiredEnv.some((entry) => (
    entry.name === 'SCIFORGE_RUNTIME_API_KEY'
    && entry.present
    && entry.source === 'env'
    && entry.valuePrinted === false
  )));
  assert.deepEqual(manifest.localConfigSources, [{
    path: 'config.local.json',
    present: true,
    valuePrinted: false,
  }]);
  const text = JSON.stringify(manifest);
  assert.equal(text.includes('sk-runtime-env-secret'), false);
  assert.equal(text.includes('sk-local-text-secret'), false);
  assert.equal(text.includes('sk-local-vision-secret'), false);
  assert.equal(text.includes('text-provider.example'), false);
  assert.equal(text.includes('vision-provider.example'), false);
  assert.equal(text.includes('raw-token'), false);
});

test('Computer Use chat live preflight blocks when local member model config exists but Runtime service env does not', async () => {
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:3892/v1',
      SCIFORGE_UI_URL: 'http://127.0.0.1:5173/',
      SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:6173/health',
      SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:18080/health',
    },
    localConfigs: [{
      path: 'config.local.json',
      config: {
        textLLM: {
          env: {
            SCIFORGE_TEXT_API_KEY: 'sk-local-text-secret',
            SCIFORGE_TEXT_BASE_URL: 'https://text-provider.example/v1',
          },
        },
        visionSense: {
          desktopBridgeEnabled: true,
          inputAdapter: 'remote-desktop',
          independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
        },
      },
    }],
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes('/api/sciforge/runtime-provider-preflight/manifest')) {
        return jsonResponse({
          ok: true,
          manifest: runtimeProviderPreflightBlocked(),
        });
      }
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/health')) return jsonResponse({ ok: true, ready: true });
      return htmlResponse('<!doctype html><html><body>SciForge</body></html>');
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.missingEnv.includes('SCIFORGE_RUNTIME_API_KEY'));
  assert.equal(manifest.runtimeProviderPreflight?.runtimeApiKeyPresentInServiceEnv, false);
  assert.deepEqual(manifest.runtimeProviderPreflight?.missingEnv, ['SCIFORGE_RUNTIME_API_KEY']);
  assert.ok(manifest.nextActions.some((action) => action.label.includes('Repair Runtime Codex provider preflight')));
  const text = JSON.stringify(manifest);
  assert.equal(text.includes('sk-local-text-secret'), false);
  assert.equal(text.includes('text-provider.example'), false);
});

test('Computer Use chat live preflight exposes non-secret runtime inference probe diagnostics', async () => {
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: readyEnv(),
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes('/api/sciforge/runtime-provider-preflight/manifest')) {
        return jsonResponse({
          ok: true,
          manifest: runtimeProviderPreflightInferenceBlocked(),
        });
      }
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/health')) return jsonResponse({ ok: true, ready: true });
      return htmlResponse('<!doctype html><html><body>SciForge</body></html>');
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.runtimeProviderPreflight?.category, 'provider-auth');
  assert.deepEqual(manifest.runtimeProviderPreflight?.checkedHealthz, {
    category: 'ready',
    ok: true,
    httpStatus: 200,
    retryable: false,
  });
  assert.deepEqual(manifest.runtimeProviderPreflight?.checkedInference, {
    category: 'provider-auth',
    ok: false,
    httpStatus: 403,
    retryable: false,
  });
  const text = JSON.stringify(manifest);
  assert.equal(text.includes('sk-live-secret'), false);
  assert.equal(text.includes('provider.example'), false);
});

test('Computer Use chat live preflight whitelists runtime provider diagnostic categories', async () => {
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: readyEnv(),
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes('/api/sciforge/runtime-provider-preflight/manifest')) {
        return jsonResponse({
          ok: true,
          manifest: {
            ...runtimeProviderPreflightInferenceBlocked(),
            category: 'provider-auth https://provider.example/raw sk-live-secret',
            checkedInference: {
              category: 'provider-auth https://provider.example/raw sk-live-secret',
              ok: false,
              httpStatus: 403,
              retryable: false,
            },
          },
        });
      }
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/health')) return jsonResponse({ ok: true, ready: true });
      return htmlResponse('<!doctype html><html><body>SciForge</body></html>');
    },
  });

  assert.equal(manifest.runtimeProviderPreflight?.category, 'unknown');
  assert.equal(manifest.runtimeProviderPreflight?.checkedInference?.category, 'unknown');
  const text = JSON.stringify(manifest);
  assert.equal(text.includes('sk-live-secret'), false);
  assert.equal(text.includes('provider.example/raw'), false);
});

test('Computer Use chat live preflight does not treat member model local config as Runtime or Router env', async () => {
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: readyEnv({ withoutRuntimeProvider: true }),
    localConfigs: [{
      path: 'config.computer-use.local.json',
      config: {
        textLLM: {
          env: {
            SCIFORGE_TEXT_API_KEY: 'sk-text-llm-secret',
            SCIFORGE_TEXT_BASE_URL: 'https://text-provider.example/v1',
          },
        },
        visionSense: {
          allowSharedSystemInput: true,
          testActionFixtureMode: 'fixtures',
          dryRun: 'yes',
        },
      },
    }],
    fetchImpl: readyFetch,
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.missingEnv.includes('SCIFORGE_RUNTIME_API_KEY'), true);
  assert.equal(manifest.missingEnv.includes('SCIFORGE_MODEL_ROUTER_BASE_URL or SCIFORGE_MODEL_ROUTER_URL or SCIFORGE_MODEL_ROUTER_PORT'), true);
  assert.deepEqual(manifest.policyViolations, [
    'shared-system-input-cannot-satisfy-chat-e2e-preflight',
    'test-action-fixtures-cannot-satisfy-real-chat-e2e',
    'desktop-bridge-dry-run-cannot-satisfy-real-chat-e2e',
  ]);
  const text = JSON.stringify(manifest);
  assert.equal(text.includes('sk-text-llm-secret'), false);
  assert.equal(text.includes('text-provider.example'), false);
});

test('Computer Use chat live preflight lets request-level shared input false override local config', async () => {
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: readyEnv({ withoutDesktopBridge: true }),
    localConfigs: [{
      path: 'config.local.json',
      config: {
        visionSense: {
          allowSharedSystemInput: true,
        },
      },
    }],
    requestVisionAllowSharedSystemInput: false,
    fetchImpl: readyFetch,
  });

  assert.equal(manifest.status, 'ready');
  assert.deepEqual(manifest.policyViolations, []);
  assert.deepEqual(manifest.requestConfigAssumptions, { visionAllowSharedSystemInput: false });
  assert.ok(manifest.requiredEnv.some((entry) => (
    entry.name === 'SCIFORGE_VISION_DESKTOP_BRIDGE'
    && entry.present
    && entry.source === 'runtime-default'
  )));
});

function readyEnv(options: { withoutRuntimeProvider?: boolean; withoutDesktopBridge?: boolean } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    SCIFORGE_RUNTIME_API_KEY: 'sk-live-secret',
    SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:3892/v1',
    SCIFORGE_VISION_DESKTOP_BRIDGE: '1',
    SCIFORGE_VISION_INPUT_ADAPTER: 'remote-desktop',
    SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'sciforge-simulated-remote-desktop',
    SCIFORGE_UI_URL: 'http://127.0.0.1:5173/',
    SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:6173/health',
    SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:18080/health',
  };
  if (options.withoutRuntimeProvider) {
    delete env.SCIFORGE_RUNTIME_API_KEY;
    delete env.SCIFORGE_MODEL_ROUTER_BASE_URL;
  }
  if (options.withoutDesktopBridge) {
    delete env.SCIFORGE_VISION_DESKTOP_BRIDGE;
  }
  return env;
}

async function readyFetch(input: URL | RequestInfo): Promise<Response> {
  const url = String(input);
  if (url.includes('/api/sciforge/runtime-provider-preflight/manifest')) {
    return jsonResponse({
      ok: true,
      manifest: runtimeProviderPreflightReady(),
    });
  }
  if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
  if (url.endsWith('/health')) return jsonResponse({ ok: true, ready: true });
  return htmlResponse('<!doctype html><html><body>SciForge</body></html>');
}

function runtimeProviderPreflightReady() {
  return {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    releaseAcceptance: 'not-evaluated',
    evidenceMode: 'current-env-diagnostic-only',
    category: 'ready',
    runtimeApiKeyPresentInServiceEnv: true,
    upstreamBaseUrlPresent: true,
    upstreamKeySourceKind: 'env',
    upstreamBaseUrlSourceKind: 'env',
    missingEnv: [],
    policyViolations: [],
    checkedHealthz: { category: 'ready', ok: true, httpStatus: 200, retryable: false },
    checkedInference: { category: 'ready', ok: true, httpStatus: 200, retryable: false },
  };
}

function runtimeProviderPreflightInferenceBlocked() {
  return {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    releaseAcceptance: 'not-evaluated',
    evidenceMode: 'current-env-diagnostic-only',
    category: 'provider-auth',
    runtimeApiKeyPresentInServiceEnv: true,
    upstreamBaseUrlPresent: true,
    upstreamKeySourceKind: 'env',
    upstreamBaseUrlSourceKind: 'env',
    missingEnv: [],
    policyViolations: [],
    checkedHealthz: { category: 'ready', ok: true, httpStatus: 200, retryable: false },
    checkedInference: { category: 'provider-auth', ok: false, httpStatus: 403, retryable: false },
  };
}

function runtimeProviderPreflightBlocked() {
  return {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    releaseAcceptance: 'not-evaluated',
    evidenceMode: 'current-env-diagnostic-only',
    category: 'missing-runtime-env',
    runtimeApiKeyPresentInServiceEnv: false,
    upstreamBaseUrlPresent: true,
    upstreamKeySourceKind: 'config-debug-fallback',
    upstreamBaseUrlSourceKind: 'config',
    missingEnv: ['SCIFORGE_RUNTIME_API_KEY'],
    policyViolations: [],
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
}
