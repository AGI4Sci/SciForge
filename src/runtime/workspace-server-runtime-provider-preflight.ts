export interface RuntimeProviderProxyHealthzDiagnostic {
  category: string;
  ok: boolean;
  retryable: boolean;
  httpStatus?: number;
  releaseAcceptance: 'not-evaluated';
}

export type RuntimeProviderProxyInferenceDiagnostic = RuntimeProviderProxyHealthzDiagnostic;

export interface RuntimeProviderProxyInferenceRequestCandidate {
  endpoint: '/v1/responses' | '/v1/chat/completions';
  body: Record<string, unknown>;
}

export interface RuntimeProviderPreflightProxyOptions {
  upstreamBaseUrl?: string;
}

export interface RuntimeProviderPreflightManifestInput {
  serviceEnv: NodeJS.ProcessEnv;
  runtimeEnv: NodeJS.ProcessEnv;
  proxyOptions: RuntimeProviderPreflightProxyOptions;
  checkedHealthz?: RuntimeProviderProxyHealthzDiagnostic;
  checkedInference?: RuntimeProviderProxyInferenceDiagnostic;
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
    inferenceCategory: input.checkedInference?.category,
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
    ...(input.checkedInference ? { checkedInference: input.checkedInference } : {}),
    nextActions: runtimeProviderPreflightNextActions({
      runtimeApiKeyPresentInServiceEnv,
      upstreamBaseUrlPresent,
      category,
    }),
  };
}

export function normalizeRuntimeProviderProxyInferenceResponse(
  responseOk: boolean,
  httpStatus: number,
  parsed: unknown,
): RuntimeProviderProxyInferenceDiagnostic {
  const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : {};
  const status = numberValue(error.status) ?? httpStatus;
  const errorCode = stringValue(error.code);
  const category = responseOk && !errorCode
    ? 'ready'
    : runtimeProviderProxyDiagnosticCategory(status, errorCode);
  return {
    category,
    ok: responseOk && category === 'ready',
    retryable: runtimeProviderProxyDiagnosticRetryable(status, category),
    ...(category !== 'ready' && Number.isInteger(status) && status > 0 ? { httpStatus: status } : {}),
    releaseAcceptance: 'not-evaluated',
  };
}

export function runtimeProviderProxyInferenceRequestCandidates(model: string): RuntimeProviderProxyInferenceRequestCandidate[] {
  const selectedModel = stringValue(model) || 'sciforge-router';
  return [{
    endpoint: '/v1/responses',
    body: {
      model: selectedModel,
      input: 'Reply with exactly OK.',
      stream: false,
      max_output_tokens: 8,
    },
  }, {
    endpoint: '/v1/chat/completions',
    body: {
      model: selectedModel,
      messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
      stream: false,
      max_tokens: 8,
    },
  }];
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
  const configured = stringValue(env.SCIFORGE_PROXY_BASE_URL)
    || proxyBaseUrlFromPortEnv(env)
    || defaultProxyBaseUrl;
  const trimmed = configured.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
}

function proxyBaseUrlFromPortEnv(env: NodeJS.ProcessEnv) {
  const port = stringValue(env.SCIFORGE_PROXY_PORT);
  if (!port || !/^\d+$/.test(port)) return undefined;
  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65_535) return undefined;
  const configuredHost = stringValue(env.SCIFORGE_PROXY_HOST);
  const host = !configuredHost || configuredHost === '0.0.0.0' || configuredHost === '::'
    ? '127.0.0.1'
    : configuredHost;
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  try {
    return new URL(`http://${urlHost}:${parsedPort}`).toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function runtimeProviderPreflightCategory(input: {
  runtimeApiKeyPresentInServiceEnv: boolean;
  upstreamBaseUrlPresent: boolean;
  healthzCategory?: string;
  inferenceCategory?: string;
}) {
  if (!input.runtimeApiKeyPresentInServiceEnv) return 'missing-runtime-env';
  if (!input.upstreamBaseUrlPresent) return 'missing-upstream';
  const healthzCategory = isRuntimeProviderPreflightCategory(input.healthzCategory)
    ? input.healthzCategory
    : undefined;
  const inferenceCategory = isRuntimeProviderPreflightCategory(input.inferenceCategory)
    ? input.inferenceCategory
    : undefined;
  if (inferenceCategory && inferenceCategory !== 'ready') return inferenceCategory;
  if (healthzCategory && healthzCategory !== 'ready') return healthzCategory;
  if (inferenceCategory === 'ready' || healthzCategory === 'ready') return 'ready';
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

function runtimeProviderProxyDiagnosticCategory(status: number, code: string) {
  if (status === 401 || status === 403 || /unauthorized|forbidden|auth/i.test(code)) return 'provider-auth';
  if (status === 429 || /rate|quota/i.test(code)) return 'rate-limited';
  if ((status >= 500 && status <= 599) || /unavailable|timeout|gateway/i.test(code)) return 'upstream-outage';
  return 'repo-bug';
}

function runtimeProviderProxyDiagnosticRetryable(status: number, category: string) {
  if (category === 'rate-limited' || category === 'upstream-outage') return true;
  return status === 408 || status === 409;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
