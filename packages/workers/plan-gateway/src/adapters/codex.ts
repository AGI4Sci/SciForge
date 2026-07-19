import type { CodingPlanAdapter, CodingPlanRoute } from '../contract';
import type { TraceCorrelation } from '@sciforge/full-trace';
import { PlanGatewayRequestError } from '../contract';
import { isLoopbackHost } from '../network-policy';

export const CODEX_PLAN_ADAPTER_ID = 'codex';
export const CODEX_PLAN_PROVIDER_ID = 'sciforge-plan-gateway';
export const CODEX_PLAN_UPSTREAM_BASE_URL = 'https://chatgpt.com/backend-api/codex';

export const CODEX_PLAN_ALLOWED_ROUTES = [
  { method: 'GET', path: '/models' },
  { method: 'POST', path: '/responses' },
  { method: 'POST', path: '/responses/compact' },
] as const satisfies readonly CodingPlanRoute[];

export function createCodexPlanAdapter(): CodingPlanAdapter {
  return {
    id: CODEX_PLAN_ADAPTER_ID,
    upstreamBaseUrl: CODEX_PLAN_UPSTREAM_BASE_URL,
    wireProtocol: 'responses',
    allowedRoutes: CODEX_PLAN_ALLOWED_ROUTES,
    createRuntimeConfig: createCodexPlanRuntimeConfig,
    validateRequest(request) {
      const authorization = request.headers.authorization;
      if (!authorization || !/^Bearer\s+\S+/i.test(authorization)) {
        throw new PlanGatewayRequestError(
          401,
          'PLAN_AUTH_REQUIRED',
          'Codex ChatGPT authentication is required for coding-plan access.',
        );
      }
    },
    transformForwardHeaders(headers) {
      return new Headers(headers);
    },
    inspectTraceRequest: inspectCodexTraceRequest,
  };
}

export function extractCodexTraceCorrelation(input: Readonly<{
  headers: Headers;
  body: Uint8Array;
}>): Partial<TraceCorrelation> {
  return inspectCodexTraceRequest(input).correlation ?? {};
}

function inspectCodexTraceRequest(input: Readonly<{
  headers: Headers;
  body: Uint8Array;
}>): ReturnType<NonNullable<CodingPlanAdapter['inspectTraceRequest']>> {
  const rawBody = Buffer.from(input.body).toString('utf8');
  if (!rawBody.trim()) return {};
  let request: unknown;
  try {
    request = JSON.parse(rawBody) as unknown;
  } catch {
    return { traceBody: '[Unparseable Codex request body omitted]' };
  }
  if (!isRecord(request) || !isRecord(request.client_metadata)) return {};
  const clientMetadata = request.client_metadata;
  const encoded = clientMetadata['x-codex-turn-metadata'];
  if (encoded === undefined) return {};
  let metadata: unknown;
  try {
    metadata = typeof encoded === 'string' ? JSON.parse(encoded) as unknown : encoded;
  } catch {
    delete clientMetadata['x-codex-turn-metadata'];
    return { traceBody: request };
  }
  clientMetadata['x-codex-turn-metadata'] = metadata;
  return {
    ...(isRecord(metadata) ? {
      correlation: compactCorrelation({
        runtimeId: stringValue(metadata.runtime_id),
        threadId: stringValue(metadata.gui_thread_id) ?? stringValue(metadata.thread_id),
        turnId: stringValue(metadata.turn_id),
      }),
    } : {}),
    traceBody: request,
  };
}

export function createCodexPlanRuntimeConfig(localBaseUrl: string): string {
  const baseUrl = normalizeLocalBaseUrl(localBaseUrl);
  return [
    `model_provider = "${CODEX_PLAN_PROVIDER_ID}"`,
    '',
    `[model_providers.${CODEX_PLAN_PROVIDER_ID}]`,
    'name = "SciForge Plan Gateway"',
    `base_url = "${escapeTomlString(baseUrl)}"`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    'supports_websockets = false',
    '',
  ].join('\n');
}

function normalizeLocalBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) {
    throw new Error('Codex Plan Gateway base URL must use loopback HTTP.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Codex Plan Gateway base URL must not contain credentials, query, or fragment.');
  }
  url.pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function escapeTomlString(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function compactCorrelation(
  values: Record<'runtimeId' | 'threadId' | 'turnId', string | undefined>,
): Partial<TraceCorrelation> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
