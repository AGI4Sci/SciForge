export interface RuntimeProviderProxyHealthzDiagnostic {
  category: string;
  ok: boolean;
  retryable: boolean;
  httpStatus?: number;
  releaseAcceptance: 'not-evaluated';
}

export interface RuntimeProviderPreflightProxyOptions {
  upstreamBaseUrl?: string;
}

export interface RuntimeProviderPreflightManifestInput {
  serviceEnv: NodeJS.ProcessEnv;
  runtimeEnv: NodeJS.ProcessEnv;
  proxyOptions: RuntimeProviderPreflightProxyOptions;
  checkedHealthz?: RuntimeProviderProxyHealthzDiagnostic;
  checkedAt?: string;
}

export function buildRuntimeProviderPreflightManifest(input: RuntimeProviderPreflightManifestInput) {
  const runtimeApiKeyPresentInServiceEnv = Boolean(stringValue(input.serviceEnv.SCIFORGE_RUNTIME_API_KEY));
  const runtimeApiKeyPresentInLocalConfig = !runtimeApiKeyPresentInServiceEnv
    && Boolean(stringValue(input.runtimeEnv.SCIFORGE_RUNTIME_API_KEY));
  const upstreamBaseUrlPresent = Boolean(input.proxyOptions.upstreamBaseUrl);
  const upstreamKeySourceKind = runtimeApiKeyPresentInServiceEnv
    ? 'env'
    : runtimeApiKeyPresentInLocalConfig
      ? 'config-debug-fallback'
      : 'missing';
  const upstreamBaseUrlPresentInServiceEnv = Boolean(
    stringValue(input.serviceEnv.SCIFORGE_PROXY_UPSTREAM_BASE_URL)
    || stringValue(input.serviceEnv.SCIFORGE_RUNTIME_BASE_URL),
  );
  const upstreamBaseUrlSourceKind = upstreamBaseUrlPresentInServiceEnv
    ? 'env'
    : upstreamBaseUrlPresent
      ? 'config'
      : 'missing';
  const category = runtimeProviderPreflightCategory({
    runtimeApiKeyPresentInServiceEnv,
    upstreamBaseUrlPresent,
    healthzCategory: input.checkedHealthz?.category,
  });
  return {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv,
    upstreamBaseUrlPresent,
    upstreamKeySourceKind,
    upstreamBaseUrlSourceKind,
    category,
    owner: runtimeProviderPreflightOwner(category),
    policyViolations: [],
    missingEnv: [
      ...(runtimeApiKeyPresentInServiceEnv ? [] : ['SCIFORGE_RUNTIME_API_KEY']),
      ...(upstreamBaseUrlPresent ? [] : ['SCIFORGE_PROXY_UPSTREAM_BASE_URL']),
    ],
    evidenceMode: 'current-env-diagnostic-only',
    checkedHealthz: input.checkedHealthz,
    nextActions: runtimeProviderPreflightNextActions({
      runtimeApiKeyPresentInServiceEnv,
      upstreamBaseUrlPresent,
      category,
    }),
  };
}

export function normalizeRuntimeProviderProxyHealthzResponse(
  responseOk: boolean,
  parsed: unknown,
): RuntimeProviderProxyHealthzDiagnostic {
  const upstream = isRecord(parsed) && isRecord(parsed.upstream) ? parsed.upstream : {};
  const category = stringValue(upstream.category) || (responseOk ? 'ready' : 'unknown');
  return {
    category,
    ok: upstream.ok === true || category === 'ready',
    retryable: upstream.retryable === true,
    ...(typeof upstream.httpStatus === 'number' ? { httpStatus: upstream.httpStatus } : {}),
    releaseAcceptance: 'not-evaluated',
  };
}

export function runtimeProviderProxyBaseUrl(env: NodeJS.ProcessEnv, defaultProxyBaseUrl: string) {
  const configured = stringValue(env.SCIFORGE_PROXY_BASE_URL) || defaultProxyBaseUrl;
  const trimmed = configured.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
}

function runtimeProviderPreflightCategory(input: {
  runtimeApiKeyPresentInServiceEnv: boolean;
  upstreamBaseUrlPresent: boolean;
  healthzCategory?: string;
}) {
  if (!input.runtimeApiKeyPresentInServiceEnv) return 'missing-runtime-env';
  if (!input.upstreamBaseUrlPresent) return 'missing-upstream';
  if (isRuntimeProviderPreflightCategory(input.healthzCategory)) return input.healthzCategory;
  return 'unknown';
}

function isRuntimeProviderPreflightCategory(value: string | undefined) {
  return value === 'ready'
    || value === 'provider-auth'
    || value === 'rate-limited'
    || value === 'upstream-outage'
    || value === 'repo-bug';
}

function runtimeProviderPreflightOwner(category: string) {
  if (category === 'provider-auth' || category === 'rate-limited' || category === 'upstream-outage') return 'provider';
  if (category === 'repo-bug' || category === 'unknown') return 'repo';
  return 'environment';
}

function runtimeProviderPreflightNextActions(input: {
  runtimeApiKeyPresentInServiceEnv: boolean;
  upstreamBaseUrlPresent: boolean;
  category: string;
}) {
  const actions: Array<{ label: string; command?: string; writesRepo: boolean }> = [];
  if (!input.runtimeApiKeyPresentInServiceEnv) {
    actions.push({
      label: 'Set SCIFORGE_RUNTIME_API_KEY in the Runtime Codex launch environment.',
      writesRepo: false,
    });
  }
  if (!input.upstreamBaseUrlPresent) {
    actions.push({
      label: 'Set SCIFORGE_PROXY_UPSTREAM_BASE_URL or ignored local provider base URL for the Runtime Codex proxy.',
      writesRepo: false,
    });
  }
  if (input.category === 'provider-auth' || input.category === 'rate-limited' || input.category === 'upstream-outage') {
    actions.push({
      label: `Resolve provider-side ${input.category} before live repair can pass.`,
      writesRepo: false,
    });
  }
  actions.push({
    label: 'Rerun provider preflight and strict Runtime Codex browser acceptance.',
    command: 'npm run smoke:runtime-provider-preflight && npm run smoke:runtime-codex-browser-acceptance:strict',
    writesRepo: true,
  });
  return actions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
