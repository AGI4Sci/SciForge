import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { normalizeInstanceName, parallelProfile } from '../../src/runtime/parallel-instance-profile';

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
  upstreamBaseUrlSourceKind: 'env' | 'missing';
  upstreamServiceKind: 'model-router' | 'non-model-router' | 'missing';
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
  checkedInference?: {
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

type CurrentModelRouterOptions = {
  upstreamBaseUrl: string;
  defaultModel: string;
};

const cases: Array<{ label: string; category: string; ok: boolean; retryable: boolean; httpStatus?: number; forbidden: string[] }> = [
  {
    label: 'provider auth',
    category: 'provider-auth',
    ok: false,
    retryable: false,
    httpStatus: 403,
    forbidden: ['provider_bad_auth', 'Authorization: Bearer', 'sk-auth-secret', 'https://tokens.provider.example/oauth/token'],
  },
  {
    label: 'rate limited',
    category: 'rate-limited',
    ok: false,
    retryable: true,
    httpStatus: 429,
    forbidden: ['quota exhausted', 'sk-rate-secret'],
  },
  {
    label: 'upstream outage',
    category: 'upstream-outage',
    ok: false,
    retryable: true,
    httpStatus: 502,
    forbidden: ['provider gateway failure', 'sk-outage-secret', '<html>'],
  },
  {
    label: 'repo bug',
    category: 'repo-bug',
    ok: false,
    retryable: false,
    httpStatus: 400,
    forbidden: ['bad proxy request', 'sk-repo-secret'],
  },
];

const ready = await requestModelRouterHealthzFixture({
  category: 'ready',
  ok: true,
  retryable: false,
});
assert.equal(ready.json.ok, true);
assert.equal(ready.json.service, 'sciforge.model-router');
assert.equal(ready.json.upstream.category, 'ready');
assert.equal(ready.json.upstream.retryable, false);
assert.equal(ready.json.upstream.releaseAcceptance, 'not-evaluated');
assert.equal(ready.json.upstream.audit, undefined);
assertNoLeak(ready.text, ['bailian/deepseek-v4-flash', 'sk-server-side-secret', 'sk-client-secret']);

for (const testCase of cases) {
  const result = await requestModelRouterHealthzFixture(testCase);
  assert.equal(result.json.ok, false, testCase.label);
  assert.equal(result.json.service, 'sciforge.model-router', testCase.label);
  assert.equal(result.json.upstream.category, testCase.category, testCase.label);
  assert.equal(result.json.upstream.retryable, testCase.retryable, testCase.label);
  assert.equal(result.json.upstream.releaseAcceptance, 'not-evaluated', testCase.label);
  assertNoLeak(result.text, [
    ...testCase.forbidden,
    'sk-server-side-secret',
    'sk-client-secret',
  ]);
}

const currentEnvManifest = await writeCurrentEnvProviderPreflightManifest();

console.log(`[ok] runtime provider upstream preflight classifies config-missing/provider-auth/rate-limited/upstream-outage/repo-bug without leaking secrets; current-env=${currentEnvManifest.category}; wrote docs/test-artifacts/runtime-provider-preflight/manifest.json; this is diagnostic-only, not browser release acceptance`);

async function requestModelRouterHealthzFixture(fixture: {
  category: string;
  ok: boolean;
  retryable: boolean;
  httpStatus?: number;
}) {
  const server = createServer((request, response) => {
    assert.equal(request.url, '/healthz');
    assert.equal(request.method, 'GET');
    response.writeHead(fixture.ok ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      ok: fixture.ok,
      service: 'sciforge.model-router',
      checkedAt: new Date().toISOString(),
      upstream: {
        category: fixture.category,
        ok: fixture.ok,
        retryable: fixture.retryable,
        ...(typeof fixture.httpStatus === 'number' ? { httpStatus: fixture.httpStatus } : {}),
        releaseAcceptance: 'not-evaluated',
      },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    const text = await response.text();
    return {
      status: response.status,
      text,
      json: JSON.parse(text),
    };
  } finally {
    await closeServer(server);
  }
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
  const options = resolveCurrentModelRouterOptions(process.env);
  const runtimeApiKeyPresentInServiceEnv = Boolean(process.env.SCIFORGE_RUNTIME_API_KEY?.trim());
  const upstreamBaseUrlPresent = Boolean(options.upstreamBaseUrl);
  const upstreamProbe = upstreamBaseUrlPresent
    ? await requestDirectModelRouterHealthz(options.upstreamBaseUrl)
    : undefined;
  const upstreamServiceKind: CurrentEnvProviderPreflightManifest['upstreamServiceKind'] = !upstreamBaseUrlPresent
    ? 'missing'
    : upstreamProbe?.json.service === 'sciforge.model-router'
      ? 'model-router'
      : 'non-model-router';
  const upstreamKeySourceKind = runtimeApiKeyPresentInServiceEnv
    ? 'env'
    : configSecretFallbackPaths.length > 0
      ? 'config-debug-fallback'
      : 'missing';
  const upstreamBaseUrlSourceKind = upstreamBaseUrlPresent ? 'env' : 'missing';
  const healthz = runtimeApiKeyPresentInServiceEnv && upstreamBaseUrlPresent
    ? currentHealthzFromModelRouterProbe(upstreamProbe)
    : undefined;
  const inference = runtimeApiKeyPresentInServiceEnv && upstreamBaseUrlPresent && upstreamServiceKind === 'model-router' && healthz?.ok
    ? await requestCurrentInferencePreflight(options)
    : undefined;
  const category = currentEnvCategory({
    runtimeApiKeyPresentInServiceEnv,
    upstreamBaseUrlPresent,
    upstreamServiceKind,
    configSecretFallbackPaths,
    healthzCategory: healthz?.category,
    inferenceCategory: inference?.category,
  });
  const manifest: CurrentEnvProviderPreflightManifest = {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: new Date().toISOString(),
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv,
    upstreamBaseUrlPresent,
    upstreamKeySourceKind,
    upstreamBaseUrlSourceKind,
    upstreamServiceKind,
    configPathsChecked,
    configSecretFallbackPaths,
    category,
    owner: currentEnvOwner(category),
    policyViolations: [
      ...(!runtimeApiKeyPresentInServiceEnv && configSecretFallbackPaths.length > 0
        ? ['config-file-secret-fallback-cannot-satisfy-browser-release-acceptance']
        : []),
      ...(upstreamServiceKind === 'non-model-router'
        ? ['runtime-provider-upstream-must-be-model-router']
        : []),
    ],
    missingEnv: [
      ...(runtimeApiKeyPresentInServiceEnv ? [] : ['SCIFORGE_RUNTIME_API_KEY']),
      ...(upstreamBaseUrlPresent ? [] : ['SCIFORGE_MODEL_ROUTER_BASE_URL']),
    ],
    checkedHealthz: healthz,
    checkedInference: inference,
    evidenceMode: 'current-env-diagnostic-only',
    nextActions: currentEnvNextActions({
      runtimeApiKeyPresentInServiceEnv,
      upstreamBaseUrlPresent,
      upstreamServiceKind,
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

async function requestCurrentInferencePreflight(options: CurrentModelRouterOptions): Promise<CurrentEnvProviderPreflightManifest['checkedInference']> {
  if (await upstreamBaseUrlIsModelRouter(options.upstreamBaseUrl)) {
    return requestCurrentModelRouterInferencePreflight(options);
  }
  return {
    category: 'repo-bug',
    ok: false,
    retryable: false,
    releaseAcceptance: 'not-evaluated',
  };
}

function resolveCurrentModelRouterOptions(
  env: NodeJS.ProcessEnv,
): CurrentModelRouterOptions {
  const upstreamBaseUrl = normalizeModelRouterOpenAiBaseUrl(
    env.SCIFORGE_MODEL_ROUTER_BASE_URL
      ?? env.SCIFORGE_MODEL_ROUTER_URL
      ?? modelRouterLoopbackBaseUrl(env),
  );
  return {
    upstreamBaseUrl,
    defaultModel: env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS?.trim()
      || env.SCIFORGE_RUNTIME_MODEL?.trim()
      || 'sciforge-router',
  };
}

function normalizeModelRouterOpenAiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.pathname === '' || url.pathname === '/') url.pathname = '/v1';
    if (!url.pathname.match(/\/v1$/i)) url.pathname = `${url.pathname.replace(/\/+$/, '')}/v1`;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

function modelRouterLoopbackBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const port = env.SCIFORGE_MODEL_ROUTER_PORT?.trim();
  if (!port) return undefined;
  const host = env.SCIFORGE_MODEL_ROUTER_HOST?.trim() || '127.0.0.1';
  return `http://${host}:${port}/v1`;
}

function currentHealthzFromModelRouterProbe(
  result: Awaited<ReturnType<typeof requestDirectModelRouterHealthz>> | undefined,
): CurrentEnvProviderPreflightManifest['checkedHealthz'] {
  if (!result) {
    return {
      category: 'upstream-outage',
      ok: false,
      retryable: true,
      releaseAcceptance: 'not-evaluated',
    };
  }
  if (result.json.service !== 'sciforge.model-router') {
    return {
      category: 'repo-bug',
      ok: false,
      retryable: false,
      ...(typeof result.status === 'number' ? { httpStatus: result.status } : {}),
      releaseAcceptance: 'not-evaluated',
    };
  }
  return {
    category: String(result.json.upstream?.category ?? (result.status === 200 ? 'ready' : 'unknown')),
    ok: result.json.upstream?.ok === true || result.status === 200,
    retryable: result.json.upstream?.retryable === true,
    ...(typeof result.json.upstream?.httpStatus === 'number' ? { httpStatus: result.json.upstream.httpStatus } : {}),
    releaseAcceptance: 'not-evaluated',
  };
}

async function requestCurrentModelRouterInferencePreflight(options: CurrentModelRouterOptions): Promise<CurrentEnvProviderPreflightManifest['checkedInference']> {
  try {
    const runtimeApiKey = process.env.SCIFORGE_RUNTIME_API_KEY?.trim();
    const response = await fetch(`${options.upstreamBaseUrl.replace(/\/+$/, '')}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(runtimeApiKey ? { authorization: `Bearer ${runtimeApiKey}` } : {}),
      },
      body: JSON.stringify({
        model: process.env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS?.trim()
          || 'sciforge-router',
        input: 'Return OK.',
        max_output_tokens: 8,
      }),
    });
    const parsed = await response.json().catch(() => ({}));
    const code = isRecord(parsed)
      ? stringValue(parsed.code)
        ?? stringValue((isRecord(parsed.error) ? parsed.error : {}).code)
        ?? stringValue((isRecord(parsed.error) ? parsed.error : {}).type)
      : undefined;
    const category = response.ok
      ? 'ready'
      : runtimeProviderProxyDiagnosticCategory(response.status, code ?? '');
    return {
      category,
      ok: response.ok,
      retryable: runtimeProviderProxyDiagnosticRetryable(response.status, category),
      httpStatus: response.status,
      releaseAcceptance: 'not-evaluated',
    };
  } catch {
    return {
      category: 'upstream-outage',
      ok: false,
      retryable: true,
      releaseAcceptance: 'not-evaluated',
    };
  }
}

async function upstreamBaseUrlIsModelRouter(upstreamBaseUrl: string): Promise<boolean> {
  if (!upstreamBaseUrl.trim()) return false;
  const result = await requestDirectModelRouterHealthz(upstreamBaseUrl);
  return result.json.service === 'sciforge.model-router';
}

async function requestDirectModelRouterHealthz(upstreamBaseUrl: string) {
  try {
    const response = await fetch(`${serviceBaseUrlFromOpenAiBaseUrl(upstreamBaseUrl)}/healthz`, {
      signal: AbortSignal.timeout(3_500),
    });
    const text = await response.text();
    const parsed = JSON.parse(text) as {
      service?: string;
      upstream?: {
        category?: string;
        ok?: boolean;
        retryable?: boolean;
        httpStatus?: number;
      };
    };
    return {
      status: response.status,
      text,
      json: parsed,
    };
  } catch {
    return {
      status: 0,
      text: '',
      json: {},
    };
  }
}

function serviceBaseUrlFromOpenAiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function currentEnvCategory(input: {
  runtimeApiKeyPresentInServiceEnv: boolean;
  upstreamBaseUrlPresent: boolean;
  upstreamServiceKind: CurrentEnvProviderPreflightManifest['upstreamServiceKind'];
  configSecretFallbackPaths: string[];
  healthzCategory?: string;
  inferenceCategory?: string;
}): CurrentEnvProviderPreflightCategory {
  if (!input.runtimeApiKeyPresentInServiceEnv && input.configSecretFallbackPaths.length > 0) return 'config-secret-source';
  if (!input.runtimeApiKeyPresentInServiceEnv) return 'missing-runtime-env';
  if (!input.upstreamBaseUrlPresent) return 'missing-upstream';
  if (input.upstreamServiceKind !== 'model-router') return 'repo-bug';
  if (isCurrentEnvProviderPreflightCategory(input.inferenceCategory) && input.inferenceCategory !== 'ready') {
    return input.inferenceCategory;
  }
  if (isCurrentEnvProviderPreflightCategory(input.healthzCategory)) return input.healthzCategory;
  if (input.inferenceCategory === 'ready') return 'ready';
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
  upstreamServiceKind: CurrentEnvProviderPreflightManifest['upstreamServiceKind'];
  upstreamKeySourceKind: CurrentEnvProviderPreflightManifest['upstreamKeySourceKind'];
  category: CurrentEnvProviderPreflightCategory;
}): CurrentEnvProviderPreflightManifest['nextActions'] {
  const actions: CurrentEnvProviderPreflightManifest['nextActions'] = [];
  if (!input.runtimeApiKeyPresentInServiceEnv) {
    actions.push({
      label: 'Set SCIFORGE_RUNTIME_API_KEY in the service environment that launches Runtime Codex through Model Router.',
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
      label: 'Set SCIFORGE_MODEL_ROUTER_BASE_URL to the Model Router /v1 base URL.',
      writesRepo: false,
    });
  }
  if (input.upstreamServiceKind === 'non-model-router') {
    actions.push({
      label: 'Start SciForge Model Router and point Runtime Codex/provider preflight at its public /v1 endpoint, not a member model upstream.',
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

function runtimeProviderProxyDiagnosticCategory(status: number, code: string): CurrentEnvProviderPreflightCategory {
  if (status === 401 || status === 403 || /unauthorized|forbidden|auth/i.test(code)) return 'provider-auth';
  if (status === 429 || /rate|quota/i.test(code)) return 'rate-limited';
  if ((status >= 500 && status <= 599) || /unavailable|timeout|gateway/i.test(code)) return 'upstream-outage';
  return 'repo-bug';
}

function runtimeProviderProxyDiagnosticRetryable(status: number, category: string): boolean {
  if (category === 'rate-limited' || category === 'upstream-outage') return true;
  return status === 408 || status === 409;
}

function runtimeApiKeyPresentInConfig(path: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isRecord(parsed)) return false;
    const llm = isRecord(parsed.llm) ? parsed.llm : {};
    return Boolean(
      stringValue(parsed.apiKey) ||
      stringValue(llm.apiKey) ||
      stringValue(llm.upstreamApiKey),
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
  if (manifest.checkedInference) {
    assert.equal(manifest.runtimeApiKeyPresentInServiceEnv, true);
    assert.equal(manifest.upstreamBaseUrlPresent, true);
    assert.equal(manifest.checkedInference.releaseAcceptance, 'not-evaluated');
    assert.ok(isCurrentEnvProviderPreflightCategory(manifest.checkedInference.category));
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
