import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRuntimeProviderPreflightManifest,
  normalizeRuntimeProviderProxyHealthzResponse,
  runtimeProviderProxyBaseUrl,
} from './workspace-server-runtime-provider-preflight.js';

test('buildRuntimeProviderPreflightManifest reports missing runtime service env without changing response shape', () => {
  const manifest = buildRuntimeProviderPreflightManifest({
    serviceEnv: {},
    runtimeEnv: {},
    proxyOptions: {},
    checkedAt: '2026-05-29T00:00:00.000Z',
  });

  assert.deepEqual(manifest, {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: '2026-05-29T00:00:00.000Z',
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv: false,
    upstreamBaseUrlPresent: false,
    upstreamKeySourceKind: 'missing',
    upstreamBaseUrlSourceKind: 'missing',
    category: 'missing-runtime-env',
    owner: 'environment',
    policyViolations: [],
    missingEnv: ['SCIFORGE_RUNTIME_API_KEY', 'SCIFORGE_PROXY_UPSTREAM_BASE_URL'],
    evidenceMode: 'current-env-diagnostic-only',
    checkedHealthz: undefined,
    nextActions: [
      {
        label: 'Set SCIFORGE_RUNTIME_API_KEY in the Runtime Codex launch environment.',
        writesRepo: false,
      },
      {
        label: 'Set SCIFORGE_PROXY_UPSTREAM_BASE_URL or ignored local provider base URL for the Runtime Codex proxy.',
        writesRepo: false,
      },
      {
        label: 'Rerun provider preflight and strict Runtime Codex browser acceptance.',
        command: 'npm run smoke:runtime-provider-preflight && npm run smoke:runtime-codex-browser-acceptance:strict',
        writesRepo: true,
      },
    ],
  });
});

test('buildRuntimeProviderPreflightManifest preserves provider healthz diagnostics and source kinds', () => {
  const manifest = buildRuntimeProviderPreflightManifest({
    serviceEnv: {
      SCIFORGE_RUNTIME_API_KEY: 'sk-service',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.test/v1',
    },
    runtimeEnv: {
      SCIFORGE_RUNTIME_API_KEY: 'sk-runtime',
    },
    proxyOptions: {
      upstreamBaseUrl: 'https://provider.test/v1',
    },
    checkedHealthz: {
      category: 'provider-auth',
      ok: false,
      retryable: false,
      httpStatus: 401,
      releaseAcceptance: 'not-evaluated',
    },
    checkedAt: '2026-05-29T00:01:00.000Z',
  });

  assert.equal(manifest.runtimeApiKeyPresentInServiceEnv, true);
  assert.equal(manifest.upstreamBaseUrlPresent, true);
  assert.equal(manifest.upstreamKeySourceKind, 'env');
  assert.equal(manifest.upstreamBaseUrlSourceKind, 'env');
  assert.equal(manifest.category, 'provider-auth');
  assert.equal(manifest.owner, 'provider');
  assert.deepEqual(manifest.missingEnv, []);
  assert.deepEqual(manifest.checkedHealthz, {
    category: 'provider-auth',
    ok: false,
    retryable: false,
    httpStatus: 401,
    releaseAcceptance: 'not-evaluated',
  });
  assert.equal(manifest.nextActions[0]?.label, 'Resolve provider-side provider-auth before live repair can pass.');
});

test('buildRuntimeProviderPreflightManifest reports config fallbacks without requiring service base URL', () => {
  const manifest = buildRuntimeProviderPreflightManifest({
    serviceEnv: {},
    runtimeEnv: {
      SCIFORGE_RUNTIME_API_KEY: 'sk-config',
    },
    proxyOptions: {
      upstreamBaseUrl: 'https://config-provider.test/v1',
    },
    checkedAt: '2026-05-29T00:02:00.000Z',
  });

  assert.equal(manifest.upstreamKeySourceKind, 'config-debug-fallback');
  assert.equal(manifest.upstreamBaseUrlSourceKind, 'config');
  assert.equal(manifest.category, 'missing-runtime-env');
  assert.deepEqual(manifest.missingEnv, ['SCIFORGE_RUNTIME_API_KEY']);
});

test('normalizeRuntimeProviderProxyHealthzResponse reads upstream diagnostics and falls back to response status', () => {
  assert.deepEqual(
    normalizeRuntimeProviderProxyHealthzResponse(false, {
      upstream: {
        category: 'rate-limited',
        ok: false,
        retryable: true,
        httpStatus: 429,
      },
    }),
    {
      category: 'rate-limited',
      ok: false,
      retryable: true,
      httpStatus: 429,
      releaseAcceptance: 'not-evaluated',
    },
  );

  assert.deepEqual(normalizeRuntimeProviderProxyHealthzResponse(true, {}), {
    category: 'ready',
    ok: true,
    retryable: false,
    releaseAcceptance: 'not-evaluated',
  });
});

test('runtimeProviderProxyBaseUrl normalizes proxy base URL and strips OpenAI-compatible v1 suffix', () => {
  assert.equal(
    runtimeProviderProxyBaseUrl({ SCIFORGE_PROXY_BASE_URL: 'http://127.0.0.1:8787/v1///' }, 'http://fallback/v1'),
    'http://127.0.0.1:8787',
  );
  assert.equal(
    runtimeProviderProxyBaseUrl({ SCIFORGE_PROXY_PORT: '3893' }, 'http://fallback/v1'),
    'http://127.0.0.1:3893',
  );
  assert.equal(
    runtimeProviderProxyBaseUrl({ SCIFORGE_PROXY_HOST: '0.0.0.0', SCIFORGE_PROXY_PORT: '3893' }, 'http://fallback/v1'),
    'http://127.0.0.1:3893',
  );
  assert.equal(runtimeProviderProxyBaseUrl({}, 'http://fallback/v1'), 'http://fallback');
});
