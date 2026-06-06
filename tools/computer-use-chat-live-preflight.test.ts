import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildComputerUseChatLivePreflightManifest } from './computer-use-chat-live-preflight.js';

test('computer-use chat live preflight checks Runtime Codex base URL via /health', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:5176',
      SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:5174',
      SCIFORGE_PROXY_URL: 'http://127.0.0.1:5175/healthz',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.test/v1',
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
  assert.ok(requestedUrls.includes('http://127.0.0.1:5175/healthz?check=upstream'));
});

test('computer-use chat live preflight checks provider proxy base URL via upstream /healthz', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:5176/health',
      SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:5174/health',
      SCIFORGE_PROXY_URL: 'http://127.0.0.1:5175',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.test/v1',
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
  assert.ok(requestedUrls.includes('http://127.0.0.1:5175/healthz?check=upstream'));
  assert.ok(!requestedUrls.includes('http://127.0.0.1:5175'));
});

test('computer-use chat live preflight blocks provider proxy JSON health body that reports not ready', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:5176/health',
      SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:5174/health',
      SCIFORGE_PROXY_URL: 'http://127.0.0.1:5175',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.test/v1',
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
      if (href === 'http://127.0.0.1:5175/healthz?check=upstream') {
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
  assert.ok(requestedUrls.includes('http://127.0.0.1:5175/healthz?check=upstream'));
  const providerCheck = manifest.serviceChecks.find((check) => check.id === 'provider-proxy');
  assert.equal(providerCheck?.status, 'fail');
  assert.match(providerCheck?.error ?? '', /not ready|upstream-outage/i);
});

test('computer-use chat live preflight trusts workspace runtime-provider preflight over transient provider probe timeout', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:5176/health',
      SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:5174/health',
      SCIFORGE_PROXY_URL: 'http://127.0.0.1:5175',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.test/v1',
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
      if (href === 'http://127.0.0.1:5175/healthz?check=upstream') {
        throw new DOMException('This operation was aborted', 'AbortError');
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch,
  });

  assert.equal(manifest.status, 'ready');
  assert.ok(requestedUrls.includes('http://127.0.0.1:5175/healthz?check=upstream'));
  assert.equal(manifest.runtimeProviderPreflight?.status, 'ready');
  assert.equal(manifest.serviceChecks.find((check) => check.id === 'provider-proxy')?.status, 'pass');
});

test('computer-use chat live preflight does not use Model Router fallback when proxy URL is explicit', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:5176/health',
      SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:5174/health',
      SCIFORGE_PROXY_URL: 'http://127.0.0.1:15175',
      SCIFORGE_MODEL_ROUTER_PORT: '13892',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.test/v1',
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
  assert.ok(requestedUrls.includes('http://127.0.0.1:15175/healthz?check=upstream'));
  assert.ok(!requestedUrls.includes('http://127.0.0.1:13892/healthz?check=upstream'));
});

test('computer-use chat live preflight does not use Model Router fallback when proxy port is explicit', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_PORT: '19080',
      SCIFORGE_WORKSPACE_PORT: '15174',
      SCIFORGE_UI_PORT: '15173',
      SCIFORGE_PROXY_PORT: '15175',
      SCIFORGE_MODEL_ROUTER_PORT: '13892',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.test/v1',
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
  assert.ok(requestedUrls.includes('http://127.0.0.1:15175/healthz?check=upstream'));
  assert.ok(!requestedUrls.includes('http://127.0.0.1:13892/healthz?check=upstream'));
});

test('computer-use chat live preflight falls back to Model Router port when managed provider proxy is unavailable', async () => {
  const requestedUrls: string[] = [];
  const manifest = await buildComputerUseChatLivePreflightManifest({
    env: {
      SCIFORGE_RUNTIME_API_KEY: 'test-runtime-key',
      SCIFORGE_RUNTIME_CODEX_PORT: '19080',
      SCIFORGE_WORKSPACE_PORT: '15174',
      SCIFORGE_UI_PORT: '15173',
      SCIFORGE_MODEL_ROUTER_PORT: '13892',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example.test/v1',
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
      if (href === 'http://127.0.0.1:3891/healthz?check=upstream') {
        return jsonResponse({ ok: false }, 503);
      }
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
  assert.ok(requestedUrls.includes('http://127.0.0.1:3891/healthz?check=upstream'));
  assert.ok(requestedUrls.includes('http://127.0.0.1:13892/healthz?check=upstream'));
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
