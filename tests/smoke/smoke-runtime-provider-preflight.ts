import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { resolveProxyCliOptions } from '../../packages/backend/src/cli-config';
import { startCodexResponsesProxyServer } from '../../packages/backend/src/proxy';
import { normalizeInstanceName, parallelProfile } from '../../src/runtime/parallel-instance-profile';

type Fixture = {
  status: number;
  contentType: string;
  body: string;
};

type CurrentEnvProviderPreflightCategory =
  | 'ready'
  | 'config-secret-source'
  | 'missing-runtime-env'
  | 'missing-upstream'
  | 'provider-auth'
  | 'rate-limited'
  | 'upstream-outage'
  | 'repo-bug'
  | 'unknown';

type CurrentEnvProviderPreflightManifest = {
  schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1';
  checkedAt: string;
  releaseAcceptance: 'not-evaluated';
  runtimeApiKeyPresentInServiceEnv: boolean;
  upstreamBaseUrlPresent: boolean;
  upstreamKeySourceKind: 'env' | 'config-debug-fallback' | 'missing';
  upstreamBaseUrlSourceKind: 'env' | 'config' | 'missing';
  configPathsChecked: string[];
  configSecretFallbackPaths: string[];
  category: CurrentEnvProviderPreflightCategory;
  owner: 'environment' | 'provider' | 'repo';
  policyViolations: string[];
  missingEnv: string[];
  checkedHealthz?: {
    category: string;
    ok: boolean;
    retryable: boolean;
    httpStatus?: number;
    releaseAcceptance: 'not-evaluated';
  };
  evidenceMode: 'current-env-diagnostic-only';
  nextActions: Array<{
    label: string;
    command?: string;
    writesRepo: boolean;
  }>;
};

const cases: Array<{ label: string; fixture: Fixture; category: string; retryable: boolean; forbidden: string[] }> = [
  {
    label: 'provider auth',
    category: 'provider-auth',
    retryable: false,
    fixture: {
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'provider_bad_auth',
          message: 'Authorization: Bearer sk-auth-secret was rejected by https://tokens.provider.example/oauth/token',
        },
      }),
    },
    forbidden: ['provider_bad_auth', 'Authorization: Bearer', 'sk-auth-secret', 'https://tokens.provider.example/oauth/token'],
  },
  {
    label: 'rate limited',
    category: 'rate-limited',
    retryable: true,
    fixture: {
      status: 429,
      contentType: 'text/plain',
      body: 'quota exhausted for sk-rate-secret',
    },
    forbidden: ['quota exhausted', 'sk-rate-secret'],
  },
  {
    label: 'upstream outage',
    category: 'upstream-outage',
    retryable: true,
    fixture: {
      status: 502,
      contentType: 'text/html',
      body: '<html><body>provider gateway failure sk-outage-secret</body></html>',
    },
    forbidden: ['provider gateway failure', 'sk-outage-secret', '<html>'],
  },
  {
    label: 'repo bug',
    category: 'repo-bug',
    retryable: false,
    fixture: {
      status: 400,
      contentType: 'application/json',
      body: '{"error":{"message":"bad proxy request containing sk-repo-secret"}}',
    },
    forbidden: ['bad proxy request', 'sk-repo-secret'],
  },
];

const configMissing = await requestConfigMissingPreflight();
assert.equal(configMissing.json.ok, false);
assert.equal(configMissing.json.upstream.category, 'config-missing');
assert.equal(configMissing.json.upstream.releaseAcceptance, 'not-evaluated');
assertNoLeak(configMissing.text, ['sk-client-secret']);

const ready = await requestFixturePreflight({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    object: 'list',
    data: [{ id: 'bailian/deepseek-v4-flash', object: 'model' }],
  }),
});
assert.equal(ready.json.ok, true);
assert.equal(ready.json.upstream.category, 'ready');
assert.equal(ready.json.upstream.retryable, false);
assert.equal(ready.json.upstream.releaseAcceptance, 'not-evaluated');
assert.equal(ready.json.upstream.audit, undefined);
assertNoLeak(ready.text, ['bailian/deepseek-v4-flash', 'sk-server-side-secret', 'sk-client-secret']);

for (const testCase of cases) {
  const result = await requestFixturePreflight(testCase.fixture);
  assert.equal(result.json.ok, false, testCase.label);
  assert.equal(result.json.upstream.category, testCase.category, testCase.label);
  assert.equal(result.json.upstream.retryable, testCase.retryable, testCase.label);
  assert.equal(result.json.upstream.releaseAcceptance, 'not-evaluated', testCase.label);
  assert.equal(result.json.upstream.audit.rawProviderBody, 'suppressed', testCase.label);
  assert.match(result.json.upstream.audit.bodySha256, /^sha256:[a-f0-9]{64}$/, testCase.label);
  assertNoLeak(result.text, [
    ...testCase.forbidden,
    'sk-server-side-secret',
    'sk-client-secret',
  ]);
}

const currentEnvManifest = await writeCurrentEnvProviderPreflightManifest();

console.log(`[ok] runtime provider upstream preflight classifies config-missing/provider-auth/rate-limited/upstream-outage/repo-bug without leaking secrets; current-env=${currentEnvManifest.category}; wrote docs/test-artifacts/runtime-provider-preflight/manifest.json; this is diagnostic-only, not browser release acceptance`);

async function requestConfigMissingPreflight() {
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: '',
    port: 0,
  });
  try {
    return await requestPreflight(proxy.url, false);
  } finally {
    await proxy.close();
  }
}

async function requestFixturePreflight(fixture: Fixture) {
  const upstream = await startFixtureServer(fixture);
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    upstreamApiKey: 'sk-server-side-secret',
    port: 0,
  });
  try {
    return await requestPreflight(proxy.url, true);
  } finally {
    await proxy.close();
    await closeServer(upstream);
  }
}

async function startFixtureServer(fixture: Fixture): Promise<Server> {
  const server = createServer((request, response) => {
    assert.equal(request.url, '/v1/models');
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.authorization, 'Bearer sk-server-side-secret');
    response.writeHead(fixture.status, { 'content-type': fixture.contentType });
    response.end(fixture.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function requestPreflight(proxyUrl: string, withClientAuth: boolean) {
  const response = await fetch(`${proxyUrl}/healthz?check=upstream`, {
    headers: withClientAuth ? { authorization: 'Bearer sk-client-secret' } : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    json: JSON.parse(text),
  };
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function assertNoLeak(text: string, forbidden: string[]) {
  for (const value of forbidden) {
    assert.equal(text.includes(value), false, `preflight response leaked: ${value}`);
  }
}

async function writeCurrentEnvProviderPreflightManifest(): Promise<CurrentEnvProviderPreflightManifest> {
  const root = process.cwd();
  const outputPath = join(root, 'docs', 'test-artifacts', 'runtime-provider-preflight', 'manifest.json');
  const requestedInstance = normalizeInstanceName(process.env.SCIFORGE_INSTANCE_ID ?? process.env.SCIFORGE_PARALLEL_INSTANCE);
  const instanceProfile = parallelProfile(requestedInstance);
  const configPathsChecked = uniqueStrings([
    process.env.SCIFORGE_CONFIG_PATH,
    instanceProfile.configPath,
    'config.local.json',
  ].flatMap((path) => typeof path === 'string' && path.trim() ? [path.trim()] : []))
    .filter((path) => existsSync(resolve(root, path)));
  const configSecretFallbackPaths = configPathsChecked.filter((path) => runtimeApiKeyPresentInConfig(resolve(root, path)));
  const options = resolveProxyCliOptions([], process.env);
  const runtimeApiKeyPresentInServiceEnv = Boolean(process.env.SCIFORGE_RUNTIME_API_KEY?.trim());
  const upstreamBaseUrlPresent = Boolean(options.upstreamBaseUrl);
  const upstreamKeySourceKind = runtimeApiKeyPresentInServiceEnv
    ? 'env'
    : configSecretFallbackPaths.length > 0
      ? 'config-debug-fallback'
      : 'missing';
  const upstreamBaseUrlSourceKind = process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL?.trim()
    ? 'env'
    : upstreamBaseUrlPresent
      ? 'config'
      : 'missing';
  const healthz = runtimeApiKeyPresentInServiceEnv && upstreamBaseUrlPresent
    ? await requestCurrentHealthzPreflight(options)
    : undefined;
  const category = currentEnvCategory({
    runtimeApiKeyPresentInServiceEnv,
    upstreamBaseUrlPresent,
    configSecretFallbackPaths,
    healthzCategory: healthz?.category,
  });
  const manifest: CurrentEnvProviderPreflightManifest = {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: new Date().toISOString(),
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv,
    upstreamBaseUrlPresent,
    upstreamKeySourceKind,
    upstreamBaseUrlSourceKind,
    configPathsChecked,
    configSecretFallbackPaths,
    category,
    owner: currentEnvOwner(category),
    policyViolations: !runtimeApiKeyPresentInServiceEnv && configSecretFallbackPaths.length > 0
      ? ['config-file-secret-fallback-cannot-satisfy-browser-release-acceptance']
      : [],
    missingEnv: [
      ...(runtimeApiKeyPresentInServiceEnv ? [] : ['SCIFORGE_RUNTIME_API_KEY']),
      ...(upstreamBaseUrlPresent ? [] : ['SCIFORGE_PROXY_UPSTREAM_BASE_URL']),
    ],
    checkedHealthz: healthz,
    evidenceMode: 'current-env-diagnostic-only',
    nextActions: currentEnvNextActions({
      runtimeApiKeyPresentInServiceEnv,
      upstreamBaseUrlPresent,
      upstreamKeySourceKind,
      category,
    }),
  };
  assertCurrentEnvProviderPreflightManifest(manifest);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
  assertNoLeak(JSON.stringify(manifest), [
    process.env.SCIFORGE_RUNTIME_API_KEY ?? '',
    process.env[process.env.SCIFORGE_PROXY_API_KEY_ENV ?? ''] ?? '',
  ].filter(Boolean));
  return manifest;
}

async function requestCurrentHealthzPreflight(options: ReturnType<typeof resolveProxyCliOptions>): Promise<CurrentEnvProviderPreflightManifest['checkedHealthz']> {
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: options.upstreamBaseUrl,
    upstreamApiKey: options.upstreamApiKey,
    port: 0,
  });
  try {
    const result = await requestPreflight(proxy.url, false);
    return {
      category: String(result.json.upstream.category),
      ok: result.json.upstream.ok === true,
      retryable: result.json.upstream.retryable === true,
      ...(typeof result.json.upstream.httpStatus === 'number' ? { httpStatus: result.json.upstream.httpStatus } : {}),
      releaseAcceptance: 'not-evaluated',
    };
  } finally {
    await proxy.close();
  }
}

function currentEnvCategory(input: {
  runtimeApiKeyPresentInServiceEnv: boolean;
  upstreamBaseUrlPresent: boolean;
  configSecretFallbackPaths: string[];
  healthzCategory?: string;
}): CurrentEnvProviderPreflightCategory {
  if (!input.runtimeApiKeyPresentInServiceEnv && input.configSecretFallbackPaths.length > 0) return 'config-secret-source';
  if (!input.runtimeApiKeyPresentInServiceEnv) return 'missing-runtime-env';
  if (!input.upstreamBaseUrlPresent) return 'missing-upstream';
  if (isCurrentEnvProviderPreflightCategory(input.healthzCategory)) return input.healthzCategory;
  return 'unknown';
}

function isCurrentEnvProviderPreflightCategory(value: string | undefined): value is CurrentEnvProviderPreflightCategory {
  return value === 'ready' ||
    value === 'provider-auth' ||
    value === 'rate-limited' ||
    value === 'upstream-outage' ||
    value === 'repo-bug';
}

function currentEnvOwner(category: CurrentEnvProviderPreflightCategory): CurrentEnvProviderPreflightManifest['owner'] {
  if (category === 'provider-auth' || category === 'rate-limited' || category === 'upstream-outage') return 'provider';
  if (category === 'repo-bug' || category === 'unknown') return 'repo';
  return 'environment';
}

function currentEnvNextActions(input: {
  runtimeApiKeyPresentInServiceEnv: boolean;
  upstreamBaseUrlPresent: boolean;
  upstreamKeySourceKind: CurrentEnvProviderPreflightManifest['upstreamKeySourceKind'];
  category: CurrentEnvProviderPreflightCategory;
}): CurrentEnvProviderPreflightManifest['nextActions'] {
  const actions: CurrentEnvProviderPreflightManifest['nextActions'] = [];
  if (!input.runtimeApiKeyPresentInServiceEnv) {
    actions.push({
      label: 'Set SCIFORGE_RUNTIME_API_KEY in the service environment that launches Runtime Codex/provider proxy.',
      writesRepo: false,
    });
  }
  if (input.upstreamKeySourceKind === 'config-debug-fallback') {
    actions.push({
      label: 'Keep ignored config apiKey only for local proxy debugging; it cannot satisfy browser/release acceptance.',
      writesRepo: false,
    });
  }
  if (!input.upstreamBaseUrlPresent) {
    actions.push({
      label: 'Set SCIFORGE_PROXY_UPSTREAM_BASE_URL in service env or a non-secret ignored config upstreamBaseUrl.',
      writesRepo: false,
    });
  }
  if (input.category === 'provider-auth' || input.category === 'rate-limited' || input.category === 'upstream-outage') {
    actions.push({
      label: `Resolve provider-side ${input.category} before browser/release acceptance can pass.`,
      writesRepo: false,
    });
  }
  actions.push({
    label: 'Rerun current provider preflight and then strict Runtime Codex browser acceptance.',
    command: 'npm run smoke:runtime-provider-preflight && npm run smoke:runtime-codex-browser-acceptance:strict',
    writesRepo: true,
  });
  return actions;
}

function runtimeApiKeyPresentInConfig(path: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isRecord(parsed)) return false;
    const llm = isRecord(parsed.llm) ? parsed.llm : {};
    const codexProxy = isRecord(parsed.codexProxy) ? parsed.codexProxy : {};
    return Boolean(
      stringValue(parsed.apiKey) ||
      stringValue(llm.apiKey) ||
      stringValue(llm.upstreamApiKey) ||
      stringValue(codexProxy.apiKey),
    );
  } catch {
    return false;
  }
}

function assertCurrentEnvProviderPreflightManifest(manifest: CurrentEnvProviderPreflightManifest): void {
  assert.equal(manifest.schemaVersion, 'sciforge.runtime-provider-preflight.current-env.v1');
  assert.equal(manifest.releaseAcceptance, 'not-evaluated');
  assert.equal(manifest.evidenceMode, 'current-env-diagnostic-only');
  assert.ok(manifest.checkedAt.trim());
  assert.doesNotThrow(() => new Date(manifest.checkedAt).toISOString());
  assert.ok(manifest.nextActions.length > 0);
  if (!manifest.runtimeApiKeyPresentInServiceEnv && manifest.configSecretFallbackPaths.length > 0) {
    assert.ok(manifest.configSecretFallbackPaths.length > 0);
    assert.ok(manifest.policyViolations.includes('config-file-secret-fallback-cannot-satisfy-browser-release-acceptance'));
  }
  if (manifest.checkedHealthz) {
    assert.equal(manifest.runtimeApiKeyPresentInServiceEnv, true);
    assert.equal(manifest.upstreamBaseUrlPresent, true);
    assert.equal(manifest.checkedHealthz.releaseAcceptance, 'not-evaluated');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
