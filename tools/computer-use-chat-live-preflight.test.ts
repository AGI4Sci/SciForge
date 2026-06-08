import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildComputerUseChatLivePreflightManifest } from './computer-use-chat-live-preflight.js';

test('computer-use chat live preflight checks Runtime Codex and Model Router base URLs via health endpoints', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:5176',
      SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:5174',
      SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:5175/v1',
      SCIFORGE_VISION_INPUT_ADAPTER: 'window-action-session',
      SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'window-action-session',
      SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT: '0',
      SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN: '0',
      SCIFORGE_VISION_TEST_ACTION_FIXTURES: '0',
    },
    localConfigs: [],
    fetchImpl: (async (url) => {
      requestedUrls.push(String(url));
      if (String(url).endsWith('/api/sciforge/runtime-provider-preflight/manifest')) {
        return jsonResponse({
          manifest: {
            category: 'ready',
            runtimeApiKeyPresentInServiceEnv: true,
            upstreamBaseUrlPresent: true,
            missingEnv: [],
            policyViolations: [],
          },
        });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch,
  });

  assert.equal(manifest.status, 'ready');
  assert.match(manifest.suggestedSmokePrompt, /human-readable evidence labels/);
  assert.match(manifest.suggestedSmokePrompt, /Do not type raw JSON, filesystem paths, filenames, or evidence ref strings/);
  assert.ok(requestedUrls.includes('http://127.0.0.1:5174/health'));
  assert.ok(!requestedUrls.includes('http://127.0.0.1:5174'));
  assert.ok(requestedUrls.includes('http://127.0.0.1:5176/health'));
  assert.ok(!requestedUrls.includes('http://127.0.0.1:5176'));
  assert.ok(requestedUrls.includes('http://127.0.0.1:5175/healthz'));
  assert.ok(!requestedUrls.includes('http://127.0.0.1:5175/healthz?check=upstream'));
  assert.ok(!requestedUrls.some((url) => url.includes('provider.example.test')));
});

test('computer-use chat live preflight checks Model Router URL via /healthz', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:5176/health',
      SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:5174/health',
      SCIFORGE_MODEL_ROUTER_URL: 'http://127.0.0.1:5175/v1',
      SCIFORGE_VISION_INPUT_ADAPTER: 'window-action-session',
      SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'window-action-session',
      SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT: '0',
      SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN: '0',
      SCIFORGE_VISION_TEST_ACTION_FIXTURES: '0',
    },
    localConfigs: [],
    fetchImpl: (async (url) => {
      requestedUrls.push(String(url));
      if (String(url).endsWith('/api/sciforge/runtime-provider-preflight/manifest')) {
        return jsonResponse({
          manifest: {
            category: 'ready',
            runtimeApiKeyPresentInServiceEnv: true,
            upstreamBaseUrlPresent: true,
            missingEnv: [],
            policyViolations: [],
          },
        });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch,
  });

  assert.equal(manifest.status, 'ready');
  assert.ok(requestedUrls.includes('http://127.0.0.1:5175/healthz'));
  assert.ok(!requestedUrls.includes('http://127.0.0.1:5175/v1'));
  assert.ok(!requestedUrls.some((url) => url.includes('check=upstream')));
});

test('computer-use chat live preflight blocks Model Router JSON health body that reports not ready', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:5176/health',
      SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:5174/health',
      SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:5175/v1',
      SCIFORGE_VISION_INPUT_ADAPTER: 'window-action-session',
      SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'window-action-session',
      SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT: '0',
      SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN: '0',
      SCIFORGE_VISION_TEST_ACTION_FIXTURES: '0',
    },
    localConfigs: [],
    fetchImpl: (async (url) => {
      const href = String(url);
      requestedUrls.push(href);
      if (href.endsWith('/api/sciforge/runtime-provider-preflight/manifest')) {
        return jsonResponse({
          manifest: {
            category: 'ready',
            runtimeApiKeyPresentInServiceEnv: true,
            upstreamBaseUrlPresent: true,
            missingEnv: [],
            policyViolations: [],
          },
        });
      }
      if (href === 'http://127.0.0.1:5175/healthz') {
        return jsonResponse({
          ok: false,
          upstream: {
            category: 'upstream-outage',
            ok: false,
            retryable: true,
          },
        });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch,
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(requestedUrls.includes('http://127.0.0.1:5175/healthz'));
  const routerCheck = manifest.serviceChecks.find((check) => check.id === 'model-router');
  assert.equal(routerCheck?.status, 'fail');
  assert.match(routerCheck?.error ?? '', /not ready|upstream-outage/i);
});

test('computer-use chat live preflight trusts workspace runtime-provider preflight over transient Model Router probe timeout', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:5176/health',
      SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:5174/health',
      SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:5175/v1',
      SCIFORGE_VISION_INPUT_ADAPTER: 'window-action-session',
      SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'window-action-session',
      SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT: '0',
      SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN: '0',
      SCIFORGE_VISION_TEST_ACTION_FIXTURES: '0',
    },
    localConfigs: [],
    fetchImpl: (async (url) => {
      const href = String(url);
      requestedUrls.push(href);
      if (href.endsWith('/api/sciforge/runtime-provider-preflight/manifest')) {
        return jsonResponse({
          manifest: {
            category: 'ready',
            runtimeApiKeyPresentInServiceEnv: true,
            upstreamBaseUrlPresent: true,
            missingEnv: [],
            policyViolations: [],
            checkedHealthz: {
              category: 'ready',
              ok: true,
              httpStatus: 200,
            },
          },
        });
      }
      if (href === 'http://127.0.0.1:5175/healthz') {
        throw new DOMException('This operation was aborted', 'AbortError');
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch,
  });

  assert.equal(manifest.status, 'ready');
  assert.ok(requestedUrls.includes('http://127.0.0.1:5175/healthz'));
  assert.equal(manifest.runtimeProviderPreflight?.status, 'ready');
  assert.equal(manifest.serviceChecks.find((check) => check.id === 'model-router')?.status, 'pass');
});

test('computer-use chat live preflight uses explicit Model Router base URL instead of default port', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:5176/health',
      SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:5174/health',
      SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://127.0.0.1:15175/v1',
      SCIFORGE_MODEL_ROUTER_PORT: '13892',
      SCIFORGE_VISION_INPUT_ADAPTER: 'window-action-session',
      SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'window-action-session',
      SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT: '0',
      SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN: '0',
      SCIFORGE_VISION_TEST_ACTION_FIXTURES: '0',
    },
    localConfigs: [],
    fetchImpl: readyFetchRecording(requestedUrls),
  });

  assert.equal(manifest.status, 'ready');
  assert.ok(requestedUrls.includes('http://127.0.0.1:15175/healthz'));
  assert.ok(!requestedUrls.includes('http://127.0.0.1:13892/healthz'));
});

test('computer-use chat live preflight uses explicit Model Router port', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_PORT: '19080',
      SCIFORGE_WORKSPACE_PORT: '15174',
      SCIFORGE_UI_PORT: '15173',
      SCIFORGE_MODEL_ROUTER_PORT: '15175',
      SCIFORGE_VISION_INPUT_ADAPTER: 'window-action-session',
      SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'window-action-session',
      SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT: '0',
      SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN: '0',
      SCIFORGE_VISION_TEST_ACTION_FIXTURES: '0',
    },
    localConfigs: [],
    fetchImpl: readyFetchRecording(requestedUrls),
  });

  assert.equal(manifest.status, 'ready');
  assert.ok(requestedUrls.includes('http://127.0.0.1:15175/healthz'));
  assert.ok(!requestedUrls.includes('http://127.0.0.1:3891/healthz'));
});

test('computer-use chat live preflight does not use legacy proxy upstream env as Model Router base', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_PORT: '19080',
      SCIFORGE_WORKSPACE_PORT: '15174',
      SCIFORGE_UI_PORT: '15173',
      SCIFORGE_MODEL_ROUTER_PORT: '13892',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.test/v1',
      SCIFORGE_RUNTIME_BASE_URL: 'https://runtime-provider.example.test/v1',
      SCIFORGE_VISION_INPUT_ADAPTER: 'window-action-session',
      SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'window-action-session',
      SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT: '0',
      SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN: '0',
      SCIFORGE_VISION_TEST_ACTION_FIXTURES: '0',
    },
    localConfigs: [],
    fetchImpl: (async (url) => {
      const href = String(url);
      requestedUrls.push(href);
      if (href.endsWith('/api/sciforge/runtime-provider-preflight/manifest')) {
        return jsonResponse({
          manifest: {
            category: 'ready',
            runtimeApiKeyPresentInServiceEnv: true,
            upstreamBaseUrlPresent: true,
            missingEnv: [],
            policyViolations: [],
          },
        });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch,
  });

  assert.equal(manifest.status, 'ready');
  assert.ok(requestedUrls.includes('http://127.0.0.1:13892/healthz'));
  assert.ok(!requestedUrls.some((url) => url.includes('provider.example.test')));
  assert.ok(!requestedUrls.some((url) => url.includes('runtime-provider.example.test')));
  assert.ok(!requestedUrls.some((url) => url.includes('check=upstream')));
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function readyFetchRecording(requestedUrls: string[]): typeof fetch {
  return (async (url) => {
    const href = String(url);
    requestedUrls.push(href);
    if (href.endsWith('/api/sciforge/runtime-provider-preflight/manifest')) {
      return jsonResponse({
        manifest: {
          category: 'ready',
          runtimeApiKeyPresentInServiceEnv: true,
          upstreamBaseUrlPresent: true,
          missingEnv: [],
          policyViolations: [],
        },
      });
    }
    return jsonResponse({ ok: true });
  }) as typeof fetch;
}
